//! Tauri `.setup()` closure body — extracted for readability.
//!
//! Responsibilities:
//!   1. Pre-startup DB restore swap (before pool is opened).
//!   2. `AppState::build()` and `app.manage()`.
//!   3. Background tasks: emit `startup_completed`, online license check.
//!   4. Debug-only specta TypeScript bindings export.
//!   5. Main window lookup + optional DevTools auto-open.

use tauri::{App, Manager};

use crate::commands;
use crate::startup::logging::log_to_file;
use crate::state::AppState;

/// Body of the Tauri `.setup()` closure.
///
/// `lib.rs` adapts this into the closure signature that `.setup()` expects
/// via a thin one-line wrapper.
pub fn run_app_setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    log_to_file("Setup started");

    // Pre-startup restore: swap pending_restore.db → rheolab.db BEFORE
    // the connection pool is opened.  This avoids os error 32/1224
    // (file locked by own process) that occurred when restore was
    // attempted after AppState::build().
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    {
        let db_path = std::env::var("RHEOLAB_E2E_DB_PATH")
            .ok()
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| app_data_dir.join("rheolab.db"));
        match commands::backup::pre_startup_restore(&app_data_dir, &db_path) {
            Ok(true) => log_to_file("Pre-startup restore: database swapped"),
            Ok(false) => {}
            Err(e) => log_to_file(&format!("Pre-startup restore error: {}", e)),
        }
    }

    // Initialize application state
    let app_state_started = std::time::Instant::now();
    match AppState::build(app_data_dir) {
        Ok(app_state) => {
            log_to_file(&format!(
                "AppState created successfully ({} ms)",
                app_state_started.elapsed().as_millis()
            ));

            // Capture migration result before moving app_state into managed state.
            // Clone is cheap: all fields are String/bool/i64.
            let migration_result = app_state.migration_result.clone();
            app.manage(app_state);

            // Emit startup_completed after a short delay so the frontend
            // event listener is registered before the event fires.
            // The payload carries MigrationResult which tells the frontend
            // whether this is a post-update first run (version_changed = true).
            {
                let bg_handle = app.handle().clone();
                let mr = migration_result.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                    use tauri::Emitter as _;
                    if let Err(e) = bg_handle.emit("startup_completed", &mr) {
                        tracing::warn!("Failed to emit startup_completed: {}", e);
                    } else if mr.version_changed {
                        tracing::info!(
                            "startup_completed emitted (post-update: {} -> {})",
                            mr.previous_app_version.as_deref().unwrap_or("?"),
                            mr.app_version,
                        );
                    }
                });
            }

            // Background license check: perform the full online validation
            // (HTTP to the license server) after the window is visible.
            // This keeps the startup critical path network-free (~50 ms)
            // while still delivering an authoritative license status to the
            // frontend within a few seconds of launch.
            //
            // The result is emitted as a Tauri event so the frontend store
            // can update its state reactively without polling.
            {
                let bg_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Small delay so the window finishes its first paint before
                    // the network request starts on a shared worker thread.
                    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                    let state = bg_handle.state::<AppState>();
                    if let Some(engine) = &state.license_engine {
                        let started = std::time::Instant::now();
                        tracing::info!("Background license check: starting online validation");
                        let result = engine.check(&state.db_pool).await;
                        engine.diag(&format!(
                            "bg check done: status={:?} source={:?} elapsed_ms={}",
                            result.status,
                            result.source,
                            started.elapsed().as_millis()
                        ));
                        log_to_file(&format!(
                            "[LIC-DIAG] bg check done: status={:?} elapsed_ms={}",
                            result.status,
                            started.elapsed().as_millis()
                        ));
                        use tauri::Emitter as _;
                        if let Err(e) = bg_handle.emit("license_status_updated", &result) {
                            tracing::warn!("Failed to emit license_status_updated: {}", e);
                        } else {
                            tracing::info!(
                                "Background license check complete: status={:?}",
                                result.status
                            );
                        }
                    }
                });
            }

            // PR2: touch-point precompute backfill.  Walks rows added by a
            // pre-v0002 binary whose `touchPrecomputeVersion` column is
            // NULL and fills them in so the library-filter sidebar can
            // answer range queries immediately after an app update.
            //
            // Runs on a background thread (via `spawn_blocking` — the
            // work is CPU/IO-bound, not async) so a large library never
            // blocks the `.setup()` callback.  Startup intentionally uses
            // small batches and a short time budget; old imported DBs may
            // need several launches or an explicit maintenance action to
            // fully catch up, but the app should stay responsive.
            {
                let bg_handle = app.handle().clone();
                let emit_handle = app.handle().clone();
                let progress_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    // Let the window's first paint finish first so the
                    // initial frame is never delayed by DB work.
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;

                    let result = tauri::async_runtime::spawn_blocking(move || {
                        let state = bg_handle.state::<AppState>();

                        let started = std::time::Instant::now();
                        let mut total_processed = 0usize;
                        let mut total_skipped = 0usize;
                        let mut has_more = false;
                        let mut announced = false;
                        // Soft-cap on iterations so a corrupted DB can
                        // never keep the background thread busy forever.
                        let mut iterations = 0u32;
                        const STARTUP_BACKFILL_BATCH_LIMIT: usize = 50;
                        const MAX_ITERATIONS: u32 = 8;
                        const MAX_ELAPSED: std::time::Duration =
                            std::time::Duration::from_secs(8);
                        const BATCH_PAUSE: std::time::Duration =
                            std::time::Duration::from_millis(200);
                        loop {
                            if iterations > 0 && started.elapsed() >= MAX_ELAPSED {
                                has_more = true;
                                break;
                            }
                            iterations += 1;
                            // Acquire a fresh connection per iteration and
                            // release it before the next round.  The old
                            // code held ONE connection for the entire loop
                            // (potentially hundreds of seconds), starving
                            // concurrent IPC queries and inflating the WAL.
                            let conn = match state.pool_conn() {
                                Ok(c) => c,
                                Err(e) => {
                                    tracing::warn!(
                                        "touch-point backfill: pool_conn failed at iteration {}: {}",
                                        iterations,
                                        e,
                                    );
                                    break;
                                }
                            };
                            match crate::db::touch_point_precompute::run_touch_point_backfill_with_limit(
                                &conn,
                                STARTUP_BACKFILL_BATCH_LIMIT,
                            ) {
                                Ok(stats) => {
                                    total_processed += stats.processed;
                                    total_skipped += stats.skipped;
                                    has_more = stats.has_more;
                                    if stats.processed + stats.skipped > 0 {
                                        use tauri::Emitter as _;
                                        let event_name = if announced {
                                            "touch_point_backfill_progress"
                                        } else {
                                            announced = true;
                                            "touch_point_backfill_started"
                                        };
                                        if let Err(e) = progress_handle.emit(
                                            event_name,
                                            serde_json::json!({
                                                "processed": total_processed,
                                                "skipped": total_skipped,
                                                "iterations": iterations,
                                                "hasMore": has_more,
                                                "elapsedMs": started.elapsed().as_millis(),
                                            }),
                                        ) {
                                            tracing::warn!(
                                                "touch-point backfill: failed to emit {} event: {}",
                                                event_name,
                                                e,
                                            );
                                        }
                                    }
                                    if !stats.has_more || iterations >= MAX_ITERATIONS {
                                        break;
                                    }
                                }
                                Err(e) => {
                                    tracing::warn!(
                                        "touch-point backfill: aborted after {} iterations: {}",
                                        iterations,
                                        e
                                    );
                                    break;
                                }
                            }
                            // Release the connection *before* sleeping so
                            // user queries can proceed unimpeded.
                            drop(conn);
                            // Brief pause between batches to let pending
                            // read queries go through without WAL pressure.
                            std::thread::sleep(BATCH_PAUSE);
                        }
                        (
                            total_processed,
                            total_skipped,
                            iterations,
                            has_more,
                            started.elapsed().as_millis(),
                        )
                    })
                    .await;

                    match result {
                        Ok((processed, skipped, iterations, has_more, elapsed_ms))
                            if processed + skipped > 0 =>
                        {
                            tracing::info!(
                                "touch-point backfill: processed={} skipped={} iterations={} has_more={} elapsed_ms={}",
                                processed,
                                skipped,
                                iterations,
                                has_more,
                                elapsed_ms,
                            );
                            log_to_file(&format!(
                                "touch-point backfill: processed={} skipped={} iterations={} has_more={} elapsed_ms={}",
                                processed, skipped, iterations, has_more, elapsed_ms
                            ));
                            // Tell the frontend to refresh the library so
                            // the user sees updated touch-point filter data.
                            use tauri::Emitter as _;
                            if let Err(e) = emit_handle.emit(
                                "touch_point_backfill_complete",
                                serde_json::json!({
                                    "processed": processed,
                                    "skipped": skipped,
                                    "hasMore": has_more,
                                    "elapsedMs": elapsed_ms,
                                }),
                            ) {
                                tracing::warn!(
                                    "touch-point backfill: failed to emit completion event: {}",
                                    e,
                                );
                            }
                        }
                        Ok(_) => {
                            // Nothing to do — every row was already
                            // precomputed by the save-path. This is the
                            // steady-state for post-v0002 installs.
                        }
                        Err(e) => {
                            tracing::warn!("touch-point backfill: spawn_blocking panicked: {}", e);
                        }
                    }
                });
            }

            // Phase 4: auto-generate TypeScript bindings from Rust types.
            // Runs only in debug builds so CI and production are unaffected.
            #[cfg(debug_assertions)]
            {
                use specta_typescript::{BigIntExportBehavior, Typescript};
                let out_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../src/types/generated.d.ts");
                match Typescript::default()
                    .bigint(BigIntExportBehavior::Number)
                    .framework_header("// Auto-generated by specta — do NOT edit manually.\n// Regenerated each time the app is launched in debug mode.\n// DO NOT edit this file — run `cargo test export_ts_bindings` in src-tauri/ to regenerate.")
                    .export_to(&out_path, &specta::export())
                {
                    Ok(_) => log_to_file(&format!(
                        "specta: exported TypeScript bindings → {}",
                        out_path.display()
                    )),
                    Err(e) => log_to_file(&format!("specta: export failed: {}", e)),
                }
            }
        }
        Err(e) => {
            log_to_file(&format!("Failed to create AppState: {}", e));
            // Show a native blocking dialog so the user knows why the app
            // failed to start — otherwise the window silently disappears.
            use tauri_plugin_dialog::DialogExt;
            app.dialog()
                .message(format!(
                    "Failed to initialize the database:\n\n{}\n\nThe application will now close.",
                    e
                ))
                .title("Startup Error")
                .blocking_show();
            return Err(e);
        }
    }

    // Get main window
    let _window = match app.get_webview_window("main") {
        Some(w) => {
            log_to_file("Main window found");
            w
        }
        None => {
            log_to_file("ERROR: Main window not found!");
            return Err("Main window not found".into());
        }
    };

    // Optional: open DevTools for debugging
    #[cfg(debug_assertions)]
    if std::env::var("RHEOLAB_OPEN_DEVTOOLS").ok().as_deref() == Some("1") {
        log_to_file("Opening DevTools (RHEOLAB_OPEN_DEVTOOLS=1)...");
        _window.open_devtools();
    }

    log_to_file("Vite SPA mode — frontend loaded via frontendDist");
    log_to_file("Setup completed successfully");
    Ok(())
}
