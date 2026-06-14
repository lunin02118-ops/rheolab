//! RheoLab Enterprise — Tauri Application Library
//!
//! Top-level orchestration only. Functionality is split into domain modules:
//!   * `commands::*`  — IPC command handlers
//!   * `db`           — SQLite pool, migrations, repositories
//!   * `error`        — central `AppError` + `Result` alias
//!   * `state`        — `AppState` (pool, dirs, license engine)
//!   * `startup`      — logging, `.setup()` body, and the IPC registry macro
//!   * `types`        — cross-module data transfer types
//!   * `utils`        — pure helpers (validation, pagination, …)
//!
//! The `run()` function wires the Tauri builder chain together and calls
//! `register_tauri_commands!()` (defined in `startup/commands_registry.rs`)
//! to attach every IPC handler at once.

pub mod analysis_cache;
pub mod commands;
pub mod db;
pub mod error;
pub mod ipc_policy;
pub mod runtime;
pub mod startup;
pub mod state;
pub mod types;
pub mod utils;

#[cfg(not(test))]
use startup::logging::{log_to_file, rotate_startup_log};
#[cfg(not(test))]
use tauri_plugin_log::log::LevelFilter;

/// Initialize and run the Tauri application.
#[cfg(not(test))]
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
    //   --js-flags=--max-old-space-size=512                              (V8 heap ceiling)
    //   --renderer-process-limit=1                                       (single-window cap)
    //
    // WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS env var is used by the E2E harness
    // to inject --remote-debugging-port=9222. WebView2 merges both sources
    // automatically (env var is appended to AdditionalBrowserArguments).
    if let Ok(e2e_args) = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") {
        if !e2e_args.is_empty() {
            log_to_file(&format!(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS (E2E)={}",
                e2e_args
            ));
        }
    }

    // Logging: app at Info in release / Debug in debug builds; dependencies
    // (tauri, updater, reqwest, hyper, rustls, wry) muted to Warn in release
    // so the rotated app.log stays small and signal-rich.
    let app_log_level = if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    };
    let dependency_log_level = if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Warn
    };

    let run_result = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("app.log".into()),
                    },
                ))
                .level(app_log_level)
                .level_for("tauri", dependency_log_level)
                .level_for("tauri_plugin_updater", dependency_log_level)
                .level_for("reqwest", dependency_log_level)
                .level_for("hyper", dependency_log_level)
                .level_for("rustls", dependency_log_level)
                .level_for("wry", dependency_log_level)
                .max_file_size(2_000_000) // rotate app.log at ~2 MB
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .build(),
        )
        .setup(|app| startup::setup::run_app_setup(app))
        .invoke_handler(register_tauri_commands!())
        .run(tauri::generate_context!());
    if let Err(e) = run_result {
        log_to_file(&format!("error while running tauri application: {}", e));
        std::process::exit(1);
    }
}

#[cfg(test)]
pub fn run() {}

// ── specta TypeScript bindings export test ────────────────────────────────
/// Run `cargo test export_ts_bindings -- --nocapture` from src-tauri/ to regenerate.
#[cfg(test)]
mod type_export_tests {
    #[test]
    fn export_ts_bindings() {
        use specta_typescript::{BigIntExportBehavior, Typescript};
        let out_path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/types/generated.d.ts");
        Typescript::default()
            .bigint(BigIntExportBehavior::Number)
            .framework_header(
                "// Auto-generated by specta — do NOT edit manually.\n\
                 // Regenerated each time the app is launched in debug mode.\n\
                 // DO NOT edit this file — run `cargo test export_ts_bindings` in src-tauri/ to regenerate.",
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

        rotated_logs.sort_by_key(|log| std::cmp::Reverse(log.file_name()));

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
