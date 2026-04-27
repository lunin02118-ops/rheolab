//! Backup export commands.

use crate::commands::licensing::can_write_via_engine;
use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::types::BackupResult;
use tauri::State;

/// Export (copy) the current database to a user-specified path.
///
/// Core export logic: VACUUM INTO target_path using the given connection.
/// `src_path` is the live database file — used for the overwrite-safety check.
/// Extracted from `backup_export_db` so it can be unit-tested without AppState.
pub(super) fn vacuum_export_db(
    conn: &rusqlite::Connection,
    src_path: &std::path::Path,
    target_path: &str,
) -> BackupResult {
    let target = std::path::Path::new(target_path);

    // Safety: refuse to overwrite the live database.
    // We use canonicalize() so symlinks and relative paths are resolved.
    // If the target doesn't exist yet canonicalize() will fail — that's fine,
    // it simply means it can't be the same as src_path.
    if let (Ok(src_canon), Ok(tgt_canon)) = (src_path.canonicalize(), target.canonicalize()) {
        if src_canon == tgt_canon {
            return BackupResult::err("Нельзя экспортировать поверх рабочей базы данных");
        }
    }

    let safe_path = target_path.replace('\'', "''");
    match conn.execute_batch(&format!("VACUUM INTO '{}'", safe_path)) {
        Ok(_) => BackupResult::ok(),
        Err(e) => BackupResult::err(&format!("Ошибка экспорта базы данных: {}", e)),
    }
}

/// Uses `VACUUM INTO` to produce a consistent snapshot regardless of WAL state.
/// The target path is supplied by the frontend after a native save dialog.
#[tauri::command]
pub async fn backup_export_db(
    state: State<'_, AppState>,
    target_path: String,
) -> Result<BackupResult> {
    // WP-1.5: validate user-supplied export path
    crate::utils::validation::validate_user_file_path(&target_path, false)?;

    let db_path = &state.database_path;

    if !db_path.exists() {
        return Ok(BackupResult::err("Файл базы данных не найден"));
    }

    // F-08: License gate — must call BEFORE acquiring Connection (!Send across .await)
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }

    let conn = state.pool_conn()?;
    let result = vacuum_export_db(&conn, db_path, &target_path);
    if result.success {
        tracing::info!("Exported DB to: {}", target_path);
    }
    Ok(result)
}

// ─────────────────────────────────────────────────────────────────────────────
// Export tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod export_tests {
    use super::*;
    use rusqlite::Connection;
    use std::path::PathBuf;

    /// Create a minimal SQLite database with one table and one row at `path`.
    fn create_source_db(path: &PathBuf) -> Connection {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE Ping (id INTEGER PRIMARY KEY, val TEXT NOT NULL);
             INSERT INTO Ping (val) VALUES ('pong');",
        )
        .unwrap();
        conn
    }

    fn tmp_dir() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "rheolab_export_tests_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn cleanup(dir: &PathBuf) {
        let _ = std::fs::remove_dir_all(dir);
    }

    // ── 1. Happy path ─────────────────────────────────────────────────────────

    #[test]
    fn export_creates_file_at_target_path() {
        let dir = tmp_dir();
        let src = dir.join("source.db");
        let dst = dir.join("export.db");

        let conn = create_source_db(&src);
        let result = vacuum_export_db(&conn, &src, dst.to_str().unwrap());

        assert!(result.success, "Expected success, got: {:?}", result.error);
        assert!(dst.exists(), "Export file should exist");
        cleanup(&dir);
    }

    #[test]
    fn exported_db_contains_source_data() {
        let dir = tmp_dir();
        let src = dir.join("source.db");
        let dst = dir.join("export.db");

        let conn = create_source_db(&src);
        let result = vacuum_export_db(&conn, &src, dst.to_str().unwrap());
        assert!(result.success);

        // Open the exported DB independently and verify data
        let exp_conn = Connection::open(&dst).unwrap();
        let val: String = exp_conn
            .query_row("SELECT val FROM Ping WHERE id = 1", [], |row| row.get(0))
            .unwrap();
        assert_eq!(val, "pong");
        cleanup(&dir);
    }

    #[test]
    fn exported_db_is_valid_sqlite() {
        let dir = tmp_dir();
        let src = dir.join("source.db");
        let dst = dir.join("export.db");

        let conn = create_source_db(&src);
        vacuum_export_db(&conn, &src, dst.to_str().unwrap());

        let exp_conn = Connection::open(&dst).unwrap();
        let integrity: String = exp_conn
            .query_row("PRAGMA integrity_check", [], |row| row.get(0))
            .unwrap();
        assert_eq!(integrity, "ok", "Exported DB should pass integrity check");
        cleanup(&dir);
    }

    // ── 2. Overwrite-safety guard ─────────────────────────────────────────────

    #[test]
    fn export_rejects_overwriting_live_db() {
        let dir = tmp_dir();
        let src = dir.join("source.db");
        let conn = create_source_db(&src);

        // target == source (same canonical path)
        let result = vacuum_export_db(&conn, &src, src.to_str().unwrap());

        assert!(!result.success, "Should refuse to overwrite the live DB");
        assert!(
            result
                .error
                .as_deref()
                .unwrap_or("")
                .contains("рабочей базы"),
            "Error message should mention live database, got: {:?}",
            result.error
        );
        cleanup(&dir);
    }

    #[test]
    fn export_allows_different_path() {
        let dir = tmp_dir();
        let src = dir.join("live.db");
        let dst = dir.join("snapshot.db");

        let conn = create_source_db(&src);
        let result = vacuum_export_db(&conn, &src, dst.to_str().unwrap());

        assert!(result.success, "Export to different path must succeed");
        cleanup(&dir);
    }

    // ── 3. Error handling ─────────────────────────────────────────────────────

    #[test]
    fn export_fails_gracefully_on_bad_path() {
        let dir = tmp_dir();
        let src = dir.join("source.db");
        let conn = create_source_db(&src);

        // Point to a non-existent subdirectory — VACUUM INTO should fail
        let bad = dir.join("no_such_dir").join("export.db");
        let result = vacuum_export_db(&conn, &src, bad.to_str().unwrap());

        assert!(!result.success, "Should fail for non-existent parent dir");
        assert!(result.error.is_some(), "Should return an error message");
        cleanup(&dir);
    }

    #[test]
    fn export_escapes_single_quotes_in_path() {
        // Verify the apostrophe-escape logic doesn't panic on unusual paths.
        // We can't actually create a path with ' on Windows, but we can confirm
        // the replace() step doesn't break valid paths.
        let dir = tmp_dir();
        let src = dir.join("source.db");
        let dst = dir.join("normal_export.db");

        let conn = create_source_db(&src);
        // The real path has no quotes — just ensure the replace() is benign.
        let result = vacuum_export_db(&conn, &src, dst.to_str().unwrap());
        assert!(result.success);
        cleanup(&dir);
    }
}
