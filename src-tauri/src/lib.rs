//! RheoLab Enterprise - Tauri Application Library
//!
//! This module provides the core functionality for the Tauri desktop application.

pub mod commands;
pub mod db;
pub mod error;
pub mod state;
pub mod types;
pub mod utils;

use state::AppState;
use std::fs::OpenOptions;
use std::io::Write;
use tauri::Manager;

/// Directory for startup logs.
fn startup_log_dir() -> std::path::PathBuf {
    dirs::data_local_dir()
        .unwrap_or_default()
        .join("com.rheolab.enterprise")
}

/// Log to file for debugging.
fn log_to_file(message: &str) {
    let log_path = startup_log_dir().join("startup.log");

    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let _ = writeln!(file, "[{}] {}", timestamp, message);
    }
}

/// Rotate `startup.log` when it exceeds 512 KB.
///
/// Renames the current log to `startup-YYYY-MM-DD-HHMMSS.log` and deletes
/// rotated files beyond the `keep` most recent ones.
fn rotate_startup_log(keep: usize) {
    let log_dir = startup_log_dir();
    let log_path = log_dir.join("startup.log");

    let should_rotate = std::fs::metadata(&log_path)
        .map(|m| m.len() > 512 * 1024)
        .unwrap_or(false);

    if !should_rotate {
        return;
    }

    let ts = chrono::Local::now().format("%Y-%m-%d-%H%M%S");
    let rotated = log_dir.join(format!("startup-{}.log", ts));
    let _ = std::fs::rename(&log_path, &rotated);

    // Collect rotated logs and keep only the newest `keep` files.
    let mut rotated_logs: Vec<_> = std::fs::read_dir(&log_dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name();
            let n = name.to_string_lossy();
            n.starts_with("startup-") && n.ends_with(".log")
        })
        .collect();

    rotated_logs.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    for old in rotated_logs.iter().skip(keep) {
        let _ = std::fs::remove_file(old.path());
    }
}

/// Initialize and run the Tauri application
pub fn run() {
    // Rotate previous startup log if it grew too large (keeps 7 archives).
    rotate_startup_log(7);

    log_to_file("=== Session boundary ===");
    log_to_file("=== RheoLab Enterprise Starting ===");
    log_to_file(&format!("PID: {}", std::process::id()));
    log_to_file(&format!("Current dir: {:?}", std::env::current_dir()));
    log_to_file(&format!("Exe path: {:?}", std::env::current_exe()));

    // Memory-related browser arguments are declared in tauri.conf.json via
    // "additionalBrowserArgs" on the window config (official Tauri v2 API).
    // This is the stable, schema-validated path — no env var injection needed.
    //
    // Flags set there:
    //   --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection  (wry defaults, must be re-declared)
    //   --disable-features=BackForwardCache,Vulkan                       (BFCache + Vulkan backend off)
    //   --disable-back-forward-cache                                     (canonical Chromium switch)
    //   --js-flags=--max-old-space-size=256                              (V8 GC threshold)
    //   --renderer-process-limit=1                                       (single-window cap)
    //
    // WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS env var is used by the E2E harness
    // to inject --remote-debugging-port=9222. WebView2 merges both sources
    // automatically (env var is appended to AdditionalBrowserArguments).
    if let Ok(e2e_args) = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
        if !e2e_args.is_empty() {
            log_to_file(&format!("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS (E2E)={}", e2e_args));
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_log::Builder::new()
            .target(tauri_plugin_log::Target::new(
                tauri_plugin_log::TargetKind::LogDir { file_name: Some("app.log".into()) }
            ))
            .max_file_size(2_000_000) // rotate app.log at ~2 MB
            .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
            .build())
        .setup(|app| {
            log_to_file("Setup started");

            // Pre-startup restore: swap pending_restore.db → rheolab.db BEFORE
            // the connection pool is opened.  This avoids os error 32/1224
            // (file locked by own process) that occurred when restore was
            // attempted after AppState::build().
            let app_data_dir = app.path().app_data_dir()
                .map_err(|e| format!("Failed to get app data dir: {e}"))?;
            {
                let db_path = std::env::var("RHEOLAB_E2E_DB_PATH")
                    .ok()
                    .map(std::path::PathBuf::from)
                    .unwrap_or_else(|| app_data_dir.join("rheolab.db"));
                match commands::backup::pre_startup_restore(&app_data_dir, &db_path) {
                    Ok(true)  => log_to_file("Pre-startup restore: database swapped"),
                    Ok(false) => {}
                    Err(e)    => log_to_file(&format!("Pre-startup restore error: {}", e)),
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
                            Ok(_) => log_to_file(&format!("specta: exported TypeScript bindings → {}", out_path.display())),
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
        })
        .invoke_handler(tauri::generate_handler![
            // Backup commands — RISK: HIGH (writes/deletes DB files)
            commands::backup::backup_list,
            commands::backup::backup_create,
            commands::backup::backup_restore,
            commands::backup::backup_delete,
            commands::backup::backup_open_folder,
            commands::backup::backup_import_db,
            commands::backup::backup_export_db,
            // API keys commands (desktop settings domain)
            commands::api_keys::api_keys_list,
            commands::api_keys::api_keys_create,
            commands::api_keys::api_keys_set_active,
            commands::api_keys::api_keys_delete,
            commands::api_keys::api_keys_active,
            commands::api_keys::api_keys_check_active,
            commands::api_keys::api_keys_validate,

            // Experiments commands — RISK: HIGH (writes user data)
            commands::experiments::experiments_list,
            commands::experiments::experiments_count,
            commands::experiments::experiments_get,
            commands::experiments::experiments_get_batch,
            commands::experiments::experiments_check_existence,
            commands::experiments::experiments_save,
            commands::experiments::experiments_delete,
            commands::experiments::experiments_last_context,
            commands::experiments::experiments_water_sources,
            commands::experiments::experiments_filter_metadata,
            commands::experiments::experiments_export_laboratories,
            commands::experiments::experiments_export_to_file,
            commands::experiments::experiments_import,
            // Reagents commands — RISK: MEDIUM (writes catalog data)
            commands::reagents::reagents_list,
            commands::reagents::reagents_create,
            commands::reagents::reagents_update,
            commands::reagents::reagents_delete,
            commands::reagents::reagents_export,
            commands::reagents::reagents_import,
            commands::reagents::reagents_seed,
            // Operator commands — RISK: MEDIUM (writes personnel data)
            commands::operators::operators_list,
            commands::operators::operators_create,
            commands::operators::operators_update,
            commands::operators::operators_delete,
            // Laboratory commands — RISK: MEDIUM (writes lab data)
            commands::laboratories::laboratories_list,
            commands::laboratories::laboratories_create,
            commands::laboratories::laboratories_update,
            commands::laboratories::laboratories_delete,
            // Test fixtures commands (desktop demo workflow)
            commands::fixtures::test_fixtures_list,
            commands::fixtures::test_fixtures_read,
            commands::fixtures::test_fixtures_parse,
            // Native parsing commands (desktop workflow without browser WASM bootstrap)
            commands::parsing::parsing_parse_file,
            commands::parsing::parsing_release_cache,
            // Native reports commands — RISK: LOW (license-gated, returns bytes)
            commands::reports::reports_generate_pdf,
            commands::reports::reports_generate_excel,
            // Native analysis pipeline commands
            commands::analysis::analysis_analyze_full,
            commands::analysis::analysis_detect_steps,
            commands::analysis::analysis_regroup_by_pattern,
            // Logger commands
            commands::logger::log_info,
            commands::logger::log_error,
            // Licensing commands — RISK: HIGH (activation/deactivation state)
            commands::licensing::licensing_machine_id,
            commands::licensing::licensing_was_ever_licensed,
            commands::licensing::licensing_checkpoint_db,
            commands::licensing::licensing_reset_experiments,
            commands::licensing::licensing_reset_all_experiments,
            // V2 License engine commands
            commands::licensing::licensing_check,
            commands::licensing::licensing_get_status,
            commands::licensing::licensing_activate_full,
            commands::licensing::licensing_deactivate,
            commands::licensing::licensing_can_save,
            commands::licensing::licensing_register_experiment,
            commands::licensing::get_update_channel,
            commands::licensing::is_e2e_mode,
            // V2 data flow commands — RISK: MEDIUM (writes sync/artifact data)
            commands::data_flows::import_batches_list,
            commands::data_flows::import_batches_get,
            commands::data_flows::experiment_payloads_list,
            commands::data_flows::parser_artifacts_list,
            commands::data_flows::parser_artifacts_get,
            commands::data_flows::report_artifacts_list,
            commands::data_flows::report_artifacts_save,
            commands::data_flows::report_artifacts_delete,
            commands::data_flows::search_projections_list,
            commands::data_flows::sync_status,
            commands::data_flows::sync_outbox_list,
            commands::data_flows::sync_outbox_mark_synced,
            commands::data_flows::sync_outbox_retry,
            commands::data_flows::sync_inbox_receive,
            commands::data_flows::sync_inbox_list,
            commands::data_flows::conflicts_list,
            commands::data_flows::conflicts_resolve,
            // Sync engine commands — RISK: HIGH (file-based delta sync, resolves conflicts)
            commands::sync_engine::sync_export_delta,
            commands::sync_engine::sync_import_delta,
            commands::sync_engine::sync_resolve_conflict,
            commands::sync_engine::sync_list_conflicts,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Run `cargo test export_ts_bindings -- --nocapture` from src-tauri/ to regenerate.
#[cfg(test)]
mod type_export_tests {
    #[test]
    fn export_ts_bindings() {
        use specta_typescript::{BigIntExportBehavior, Typescript};
        let out_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src/types/generated.d.ts");
        Typescript::default()
            .bigint(BigIntExportBehavior::Number)
            .framework_header(
                "// Auto-generated by specta — do NOT edit manually.\n\
                 // Run `cargo test export_ts_bindings` in src-tauri/ to regenerate.\n\
                 // DO NOT edit this file manually.",
            )
            .export_to(&out_path, &specta::export())
            .expect("Failed to export TypeScript bindings");
        println!("specta: wrote {}", out_path.display());
        assert!(out_path.exists(), "generated.d.ts was not created");
    }
}

#[cfg(test)]
mod log_rotation_tests {
    use std::fs;
    use std::io::Write as _;

    #[test]
    fn rotate_triggers_on_large_file_and_cleans_old() {
        let tmp = tempfile::tempdir().unwrap();
        let log_dir = tmp.path();
        let log_path = log_dir.join("startup.log");

        // Create a >512 KB file to trigger rotation.
        {
            let mut f = fs::File::create(&log_path).unwrap();
            f.write_all(&vec![b'x'; 600_000]).unwrap();
        }

        // Create 9 old rotated logs so cleanup kicks in.
        for i in 1..=9 {
            fs::write(
                log_dir.join(format!("startup-2025-01-{:02}-120000.log", i)),
                "old",
            )
            .unwrap();
        }

        // Inline the rotation logic (same algorithm as `rotate_startup_log`).
        let should_rotate = fs::metadata(&log_path)
            .map(|m| m.len() > 512 * 1024)
            .unwrap_or(false);
        assert!(should_rotate);

        let ts = chrono::Local::now().format("%Y-%m-%d-%H%M%S");
        let rotated = log_dir.join(format!("startup-{}.log", ts));
        fs::rename(&log_path, &rotated).unwrap();

        let keep = 7usize;
        let mut rotated_logs: Vec<_> = fs::read_dir(log_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                let name = e.file_name();
                let n = name.to_string_lossy();
                n.starts_with("startup-") && n.ends_with(".log")
            })
            .collect();

        rotated_logs.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

        for old in rotated_logs.iter().skip(keep) {
            fs::remove_file(old.path()).unwrap();
        }

        // After cleanup: 7 rotated logs, no startup.log.
        let remaining: Vec<_> = fs::read_dir(log_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".log"))
            .collect();
        assert_eq!(remaining.len(), 7);
        assert!(!log_path.exists());
    }

    #[test]
    fn rotate_skips_small_files() {
        let tmp = tempfile::tempdir().unwrap();
        let log_path = tmp.path().join("startup.log");

        fs::write(&log_path, "tiny log").unwrap();

        let should_rotate = fs::metadata(&log_path)
            .map(|m| m.len() > 512 * 1024)
            .unwrap_or(false);
        assert!(!should_rotate);
        assert!(log_path.exists());
    }
}
