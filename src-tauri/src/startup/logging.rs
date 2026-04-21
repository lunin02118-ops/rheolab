//! Startup logging helpers — file-based diagnostic log with rotation.
//!
//! Used exclusively during app bootstrap (before the tauri_plugin_log system
//! is initialised) so we can capture early failures that would otherwise
//! disappear with a silent window close.

use std::fs::OpenOptions;
use std::io::Write;

/// Directory for startup logs.
pub fn startup_log_dir() -> std::path::PathBuf {
    dirs::data_local_dir()
        .unwrap_or_default()
        .join("com.rheolab.enterprise")
}

/// Append a timestamped message to `startup.log`.
pub fn log_to_file(message: &str) {
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
pub fn rotate_startup_log(keep: usize) {
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
