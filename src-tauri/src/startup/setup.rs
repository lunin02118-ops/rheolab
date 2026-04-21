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
    match AppState::build(app_data_dir) {
        Ok(app_state) => {
            log_to_file("AppState created successfully");

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
                        tracing::info!("Background license check: starting online validation");
                        let result = engine.check(&state.db_pool).await;
                        engine.diag(&format!(
                            "bg check done: status={:?} source={:?}",
                            result.status, result.source
                        ));
                        log_to_file(&format!(
                            "[LIC-DIAG] bg check done: status={:?}",
                            result.status
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
