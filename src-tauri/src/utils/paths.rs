//! Path utilities for the application

use crate::error::Result;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Get the path to the pending restore file
pub fn get_pending_restore_path(app: &AppHandle) -> Result<PathBuf> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data_dir.join("pending_restore.db"))
}

/// Get the path to the restore log file
pub fn get_restore_log_path(app: &AppHandle) -> Result<PathBuf> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data_dir.join("restore.log"))
}

/// Append a message to the restore log
pub fn log_restore(app: &AppHandle, msg: &str) {
    if let Ok(log_path) = get_restore_log_path(app) {
        let timestamp = chrono::Utc::now().to_rfc3339();
        let log_entry = format!("[{}] {}\n", timestamp, msg);
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_path)
            .and_then(|mut file| {
                use std::io::Write;
                file.write_all(log_entry.as_bytes())
            });
    }
}
