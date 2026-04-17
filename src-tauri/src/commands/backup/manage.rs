//! Backup CRUD management commands.

use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::types::{BackupInfo, BackupResult};
use chrono::Utc;
use std::fs;
use tauri::State;

use super::validate::sanitize_backup_filename;

/// List all local backups
#[tauri::command]
pub async fn backup_list(state: State<'_, AppState>) -> Result<Vec<BackupInfo>> {
    let backups_dir = &state.backups_dir;

    if !backups_dir.exists() {
        return Ok(vec![]);
    }

    let entries =
        fs::read_dir(backups_dir)?;

    let mut backups: Vec<BackupInfo> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();

            if path.extension()?.to_str()? != "db" {
                return None;
            }

            let metadata = fs::metadata(&path).ok()?;
            let modified = metadata.modified().ok()?;
            let datetime: chrono::DateTime<Utc> = modified.into();

            Some(BackupInfo {
                name: entry.file_name().to_string_lossy().to_string(),
                date: datetime.to_rfc3339(),
                size: metadata.len(),
            })
        })
        .collect();

    // Sort by date descending (newest first)
    backups.sort_by(|a, b| b.date.cmp(&a.date));

    Ok(backups)
}

/// Create a new backup
#[tauri::command]
pub async fn backup_create(state: State<'_, AppState>) -> Result<BackupResult> {
    let db_path = &state.database_path;
    let backups_dir = &state.backups_dir;

    if !db_path.exists() {
        return Ok(BackupResult::err("Database file not found"));
    }

    // Ensure backup directory exists
    if !backups_dir.exists() {
        fs::create_dir_all(backups_dir)?;
    }

    // Create backup filename with timestamp
    let timestamp = Utc::now().format("%Y-%m-%dT%H-%M-%S").to_string();
    let backup_name = format!("backup-{}.db", timestamp);
    let backup_path = backups_dir.join(&backup_name);

    // Use VACUUM INTO for a safe hot backup — SQLite checkpoints WAL and writes a
    // consistent snapshot to the destination without closing the live connection.
    // (Previously fs::copy was used, which could produce a corrupt DB copy
    //  whenever WAL frames had not been checkpointed.)
    let conn = state.pool_conn()?;
    let backup_path_str = backup_path.to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{}'", backup_path_str))?;

    // Verify backup integrity: open the backup file and run integrity_check.
    // On failure, delete the corrupt backup and return an error.
    {
        let verify_conn = rusqlite::Connection::open_with_flags(
            &backup_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|e| {
            let _ = fs::remove_file(&backup_path);
            AppError::Sql(e)
        })?;

        let result: String = verify_conn
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .map_err(|e| {
                let _ = fs::remove_file(&backup_path);
                AppError::Sql(e)
            })?;

        if result != "ok" {
            let _ = fs::remove_file(&backup_path);
            return Err(format!("Backup integrity check failed: {}", result).into());
        }
    }

    tracing::info!("Created backup: {} (integrity verified)", backup_name);
    Ok(BackupResult::ok_with_name(backup_name))
}

/// Delete a backup file
#[tauri::command]
pub async fn backup_delete(
    state: State<'_, AppState>,
    filename: String,
) -> Result<BackupResult> {
    sanitize_backup_filename(&filename)?;

    let backup_path = state.backups_dir.join(&filename);

    // Additional canonical path check to prevent symlink-based traversal
    if backup_path.exists() {
        if let Ok(canonical) = backup_path.canonicalize() {
            if let Ok(base) = state.backups_dir.canonicalize() {
                if !canonical.starts_with(&base) {
                    return Err("Path traversal detected".into());
                }
            }
        }
    }

    if !backup_path.exists() {
        return Ok(BackupResult::err("Backup file not found"));
    }

    fs::remove_file(&backup_path)?;

    tracing::info!("Deleted backup: {}", filename);
    Ok(BackupResult::ok())
}

/// Open the backups folder in the system file manager
#[tauri::command]
pub async fn backup_open_folder(state: State<'_, AppState>) -> Result<()> {
    let backups_dir = &state.backups_dir;

    // Ensure directory exists
    if !backups_dir.exists() {
        fs::create_dir_all(backups_dir)?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(backups_dir)
            .spawn()?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(backups_dir)
            .spawn()?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(backups_dir)
            .spawn()?;
    }

    Ok(())
}
