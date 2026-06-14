//! Backup restore, import, and merge logic.

use crate::commands::licensing::{can_write_via_engine, require_write_license};
use crate::error::{command_boundary, AppError, Result};
use crate::state::AppState;
use crate::types::{BackupResult, MergeResult};
use crate::utils::{get_pending_restore_path, log_restore};
use chrono::Utc;
use rusqlite;
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, State};

use super::validate::sanitize_backup_filename;

/// RAII guard that restores `PRAGMA foreign_keys = ON` when dropped.
///
/// Use this whenever FK checks are temporarily disabled (e.g. during merge).
/// The guard ensures FK checks are restored on **every** exit path — normal
/// return, early `?` propagation, or even panic.
struct FkGuard<'a> {
    conn: &'a rusqlite::Connection,
}

impl<'a> FkGuard<'a> {
    fn new(conn: &'a rusqlite::Connection) -> Result<Self> {
        conn.execute_batch("PRAGMA foreign_keys = OFF")?;
        Ok(Self { conn })
    }
}

impl<'a> Drop for FkGuard<'a> {
    fn drop(&mut self) {
        if let Err(e) = self.conn.execute_batch("PRAGMA foreign_keys = ON") {
            tracing::error!("FkGuard: failed to restore foreign_keys=ON: {}", e);
        }
    }
}

/// RAII guard that removes a temporary directory on every exit path.
struct TempDirGuard {
    path: PathBuf,
}

impl TempDirGuard {
    fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        match fs::remove_dir_all(&self.path) {
            Ok(()) => {}
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => tracing::warn!(
                "TempDirGuard: failed to remove {}: {}",
                self.path.display(),
                e
            ),
        }
    }
}

fn validate_restore_backup_integrity(path: &Path) -> Result<()> {
    let conn =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;

    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(AppError::BadRequest(format!(
            "Backup integrity check failed: {integrity}"
        )));
    }

    let has_experiment_table: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='Experiment'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);
    if !has_experiment_table {
        return Err(AppError::BadRequest(
            "Backup is not a RheoLab database".into(),
        ));
    }

    Ok(())
}

/// Restore from a backup (schedules restore and requests app restart)
#[tauri::command]
pub async fn backup_restore(
    app: AppHandle,
    state: State<'_, AppState>,
    filename: String,
) -> Result<BackupResult> {
    command_boundary(
        "backup_restore",
        None,
        backup_restore_inner(app, state, filename),
    )
    .await
}

async fn backup_restore_inner(
    app: AppHandle,
    state: State<'_, AppState>,
    filename: String,
) -> Result<BackupResult> {
    require_write_license(&state).await?;

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

    validate_restore_backup_integrity(&backup_path)?;

    // Copy to pending restore location
    let pending_path = get_pending_restore_path(&app)?;
    fs::copy(&backup_path, &pending_path)?;

    tracing::info!("Scheduled restore from: {}", filename);

    // Request app restart - this function never returns
    #[allow(unreachable_code)]
    {
        app.restart();
        Ok(BackupResult::ok())
    }
}

/// Import an external `.db` file by **merging** its experiments into the
/// current working database.
///
/// Flow:
/// 1. Copy the source file (+ WAL/SHM if present) to a temp location.
/// 2. Open the temp copy read-write, checkpoint WAL, validate.
/// 3. Create a pre-merge backup of the current database.
/// 4. ATTACH the temp copy with FK checks OFF.
/// 5. For each table, compute column intersection and INSERT OR IGNORE.
/// 6. Rebuild the FTS5 index.
/// 7. Return merge statistics (imported / skipped).
///
/// FK checks are disabled during the merge to avoid failures when reference
/// table rows are skipped due to UNIQUE collisions (e.g. a User with the same
/// email but different id).  The source DB is structurally valid, so the
/// resulting data is consistent.
///
/// No app restart is needed — the data is available immediately.
#[tauri::command]
pub async fn backup_import_db(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<MergeResult> {
    command_boundary(
        "backup_import_db",
        None,
        backup_import_db_inner(state, file_path),
    )
    .await
}

async fn backup_import_db_inner(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<MergeResult> {
    // WP-1.5: validate user-supplied path (null bytes, sensitive dirs)
    let source_path = crate::utils::validation::validate_user_file_path(&file_path, true)?;
    let source = source_path.as_path();

    if source.extension().and_then(|e| e.to_str()) != Some("db") {
        return Ok(MergeResult::err("Файл должен иметь расширение .db"));
    }

    // WP-1.5: reject files > 2 GB
    crate::utils::validation::validate_file_size(source, 2 * 1024 * 1024 * 1024)?;

    // F-08: License gate — must call BEFORE acquiring Connection (!Send across .await)
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }

    // Move all heavy FS + DB work into a controlled blocking task so we
    // never occupy a tokio worker thread for the duration of the merge.
    let db_pool = state.db_pool.clone();
    let backups_dir = state.backups_dir.clone();
    let source_owned = source_path.clone();

    tokio::task::spawn_blocking(move || {
        let source = source_owned.as_path();

        // --- 1. Copy to temp location so we can safely checkpoint WAL ---------------
        let temp_dir = backups_dir.join("_import_temp");
        if !temp_dir.exists() {
            fs::create_dir_all(&temp_dir)?;
        }
        let _temp_cleanup = TempDirGuard::new(temp_dir.clone());
        let temp_db = temp_dir.join("import.db");

        // Copy main file
        fs::copy(source, &temp_db)?;

        // Copy WAL / SHM companions if they exist alongside the source
        let source_wal = source.with_extension("db-wal");
        let source_shm = source.with_extension("db-shm");
        if source_wal.exists() {
            let _ = fs::copy(&source_wal, temp_dir.join("import.db-wal"));
        }
        if source_shm.exists() {
            let _ = fs::copy(&source_shm, temp_dir.join("import.db-shm"));
        }

        // --- 2. Open read-write, checkpoint WAL, validate --------------------------
        let total_in_source: u64;
        {
            let conn = rusqlite::Connection::open_with_flags(
                &temp_db,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
            )?;

            // Consolidate WAL into the main file
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)");

            // Check for expected tables
            let has_experiment: bool = conn
                .query_row(
                    "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='Experiment'",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or(false);

            if !has_experiment {
                return Ok(MergeResult::err(
                    "Файл не содержит таблицу Experiment — это не база данных RheoLab",
                ));
            }

            total_in_source = conn
                .query_row("SELECT COUNT(*) FROM Experiment", [], |row| row.get(0))
                .unwrap_or(0);
        }

        // Clean up WAL/SHM that are no longer needed after checkpoint
        let _ = fs::remove_file(temp_dir.join("import.db-wal"));
        let _ = fs::remove_file(temp_dir.join("import.db-shm"));

        // --- 3. Pre-merge backup of the current database (fail-closed) ------------
        {
            let conn = db_pool.get().map_err(AppError::Pool)?;
            let timestamp = Utc::now().format("%Y-%m-%dT%H-%M-%S").to_string();
            let backup_name = format!("pre-import-{}.db", timestamp);
            let backup_path = backups_dir.join(&backup_name);
            let backup_path_str = backup_path.to_string_lossy().replace('\'', "''");
            conn.execute_batch(&format!("VACUUM INTO '{}'", backup_path_str))
                .inspect_err(|e| tracing::error!("Pre-import backup failed: {}", e))?;
            tracing::info!("Created pre-import backup: {}", backup_name);
        }

        // --- 4. ATTACH + MERGE with FK checks OFF (RAII guard) ---------------------
        //
        // The FK integrity check is now inside merge_attached_databases,
        // BEFORE the transaction commits.  See DB-002 note in that
        // function: any violation aborts the merge via RAII rollback,
        // so reaching this scope means the merge committed cleanly.
        let imported = {
            let conn = db_pool.get().map_err(AppError::Pool)?;

            // FkGuard: FK OFF now, ON guaranteed when `_fk_guard` drops (any path).
            let _fk_guard = FkGuard::new(&conn)?;

            let temp_db_str = temp_db.to_string_lossy().replace('\'', "''");
            conn.execute_batch(&format!("ATTACH DATABASE '{}' AS src", temp_db_str))?;

            let merge_result = merge_attached_databases(&conn, true);

            // Always detach, even on merge error
            let _ = conn.execute_batch("DETACH DATABASE src");

            let (new_count, _) = merge_result?;
            new_count
        };

        let skipped = total_in_source.saturating_sub(imported);
        tracing::info!(
            "Merge complete: imported={}, skipped={}, source_total={}",
            imported,
            skipped,
            total_in_source,
        );

        Ok(MergeResult::ok(imported, skipped))
    })
    .await?
}

/// Run `PRAGMA foreign_key_check` and return human-readable warnings.\n/// Empty vec means no violations.
fn check_foreign_key_violations(conn: &rusqlite::Connection) -> Vec<String> {
    let mut warnings = Vec::new();
    if let Ok(mut stmt) = conn.prepare("PRAGMA foreign_key_check") {
        if let Ok(rows) = stmt.query_map([], |row| {
            let table: String = row.get(0)?;
            let rowid: i64 = row.get(1)?;
            let parent: String = row.get(2)?;
            let fkid: i64 = row.get(3)?;
            Ok(format!(
                "FK violation: table={}, rowid={}, parent={}, fkid={}",
                table, rowid, parent, fkid
            ))
        }) {
            for row in rows.flatten() {
                warnings.push(row);
            }
        }
    }
    warnings
}

/// Compute column names present in both `main.<table>` and `src.<table>`.
fn get_common_columns(conn: &rusqlite::Connection, table: &str) -> Vec<String> {
    let fetch = |schema: &str| -> Vec<String> {
        let sql = format!("PRAGMA {}.table_info({})", schema, table);
        conn.prepare(&sql)
            .and_then(|mut stmt| {
                stmt.query_map([], |row| row.get::<_, String>(1))
                    .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
            })
            .unwrap_or_default()
    };

    let main_cols = fetch("main");
    let src_cols = fetch("src");
    let src_set: std::collections::HashSet<&str> = src_cols.iter().map(|s| s.as_str()).collect();

    main_cols
        .into_iter()
        .filter(|c| src_set.contains(c.as_str()))
        .collect()
}

fn table_exists(conn: &rusqlite::Connection, schema: &str, table: &str) -> bool {
    conn.query_row(
        &format!("SELECT COUNT(*) > 0 FROM {schema}.sqlite_master WHERE type='table' AND name=?1"),
        [table],
        |row| row.get(0),
    )
    .unwrap_or(false)
}

fn merge_experiment_reagents(tx: &rusqlite::Transaction<'_>) -> Result<()> {
    let common_cols = get_common_columns(tx, "ExperimentReagent");
    let required = ["id", "experimentId", "concentration", "unit"];
    if required
        .iter()
        .any(|col| !common_cols.iter().any(|common| common == col))
    {
        tracing::warn!(
            "Merge table ExperimentReagent skipped: missing required common columns ({:?})",
            common_cols
        );
        return Ok(());
    }

    let has_src_reagent_id = common_cols.iter().any(|col| col == "reagentId");
    let has_src_reagent_name = common_cols.iter().any(|col| col == "reagentName");
    let has_src_category = common_cols.iter().any(|col| col == "category");
    let has_src_catalog = table_exists(tx, "src", "ReagentCatalog");

    let src_reagent_id = if has_src_reagent_id {
        "er.reagentId"
    } else {
        "NULL"
    };
    let src_reagent_name = if has_src_reagent_name {
        "er.reagentName"
    } else {
        "NULL"
    };
    let src_category = if has_src_category {
        "er.category"
    } else {
        "NULL"
    };
    let src_batch_number = if common_cols.iter().any(|col| col == "batchNumber") {
        "er.batchNumber"
    } else {
        "NULL"
    };
    let src_production_date = if common_cols.iter().any(|col| col == "productionDate") {
        "er.productionDate"
    } else {
        "NULL"
    };

    let catalog_join = if has_src_catalog && has_src_reagent_id {
        "LEFT JOIN src.ReagentCatalog src_rc ON src_rc.id = er.reagentId"
    } else {
        ""
    };
    let catalog_name = if has_src_catalog && has_src_reagent_id {
        "src_rc.name"
    } else {
        "NULL"
    };
    let sql = format!(
        r#"
        INSERT OR IGNORE INTO main.ExperimentReagent
            (id, experimentId, reagentId, reagentName, category, concentration, unit, batchNumber, productionDate)
        SELECT
            er.id,
            er.experimentId,
            CASE
                WHEN {src_reagent_id} IS NULL OR TRIM({src_reagent_id}) = '' THEN NULL
                WHEN EXISTS (
                    SELECT 1 FROM main.ReagentCatalog main_rc
                    WHERE main_rc.id = {src_reagent_id}
                ) THEN {src_reagent_id}
                WHEN {catalog_name} IS NOT NULL THEN (
                    SELECT main_rc.id
                    FROM main.ReagentCatalog main_rc
                    WHERE main_rc.name = {catalog_name} COLLATE NOCASE
                    ORDER BY main_rc.id
                    LIMIT 1
                )
                WHEN {src_reagent_name} IS NOT NULL THEN (
                    SELECT main_rc.id
                    FROM main.ReagentCatalog main_rc
                    WHERE main_rc.name = {src_reagent_name} COLLATE NOCASE
                    ORDER BY main_rc.id
                    LIMIT 1
                )
                ELSE NULL
            END,
            {src_reagent_name},
            {src_category},
            er.concentration,
            er.unit,
            {src_batch_number},
            {src_production_date}
        FROM src.ExperimentReagent er
        {catalog_join}
        "#
    );

    tx.execute_batch(&sql)?;
    Ok(())
}

/// Tables to merge in FK-safe order (parents before children).
const MERGE_TABLES: &[&str] = &[
    "Laboratory",
    "WaterSourceCatalog",
    "ReagentCatalog",
    "User",
    "Settings",
    "Experiment",
    "ExperimentData",
    "ExperimentRheologyParameter",
    "ExperimentReagent",
    "Calibration",
    "ImportBatch",
    "ExperimentPayload",
    "ParserArtifact",
    "ReportArtifact",
];

/// Core merge logic: ATTACH source DB and INSERT OR IGNORE common columns.
///
/// The connection MUST have FK checks already disabled and the source DB
/// already ATTACHed as `src`.  Returns `(imported_experiments, total_in_source)`.
fn merge_attached_databases(conn: &rusqlite::Connection, has_fts: bool) -> Result<(u64, u64)> {
    let before: u64 = conn
        .query_row("SELECT COUNT(*) FROM main.Experiment", [], |row| row.get(0))
        .unwrap_or(0);

    // RAII transaction — auto-rolls back on early return or panic.
    let tx = conn.unchecked_transaction()?;

    for table in MERGE_TABLES {
        if !table_exists(&tx, "src", table) {
            continue;
        }

        if *table == "ExperimentReagent" {
            merge_experiment_reagents(&tx)?;
            continue;
        }

        let common_cols = get_common_columns(&tx, table);
        if common_cols.is_empty() {
            continue;
        }

        let cols_csv = common_cols.join(", ");
        let sql = format!(
            "INSERT OR IGNORE INTO main.{t} ({cols}) SELECT {cols} FROM src.{t}",
            t = table,
            cols = cols_csv
        );

        if let Err(e) = tx.execute_batch(&sql) {
            tracing::warn!("Merge table {} failed: {} — skipping", table, e);
        }
    }

    // Rebuild FTS5 index if present
    if has_fts {
        if let Err(e) =
            tx.execute_batch("INSERT INTO main.fts_experiment(fts_experiment) VALUES('rebuild')")
        {
            tracing::warn!("FTS5 rebuild failed: {}", e);
        }
    }

    // DB-002 (audit-preflight): fail-closed FK integrity check BEFORE commit.
    //
    // The merge ran with FK enforcement disabled to allow tables to be
    // populated in any order.  Re-enable enforcement now and run
    // `PRAGMA foreign_key_check` while still inside the transaction —
    // any violation aborts the merge via the RAII drop of `tx`, leaving
    // main DB in its pre-merge state.  Previously violations were merely
    // logged and the merge committed with orphaned rows; the user saw
    // a green success result and silently broken cascade behaviour.
    tx.execute_batch("PRAGMA foreign_keys = ON").ok();
    let violations = check_foreign_key_violations(&tx);
    if !violations.is_empty() {
        tracing::warn!(
            "Aborting import: {} FK violation(s) detected — main DB unchanged",
            violations.len()
        );
        // Drop tx before returning (RAII rollback).
        drop(tx);
        return Err(AppError::BadRequest(format!(
            "Импорт отменён: внешняя БД содержит {} нарушений целостности \
             (foreign key) после merge. Главная база оставлена БЕЗ изменений. \
             Используйте чистый бэкап или восстановите источник. Подробности \
             в логах. Первые: {}",
            violations.len(),
            violations
                .iter()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
                .join("; ")
        )));
    }

    tx.commit()?;

    let after: u64 = conn
        .query_row("SELECT COUNT(*) FROM main.Experiment", [], |row| row.get(0))
        .unwrap_or(0);

    Ok((after - before, before))
}

/// Swap `pending_restore.db` → main DB *before* the connection pool is opened.
///
/// Must be called before [`AppState::build`] to avoid OS-level file-lock
/// conflicts (os error 32 / os error 1224).  Returns `true` if a restore
/// was performed.
///
/// **Audit-v2 DB-007 / DB-008 — re-verification before swap:**
///
/// `pending_restore.db` is created in `backup_restore` *after* the source
/// file has been validated, but the file then sits on disk until the next
/// app start.  Anything that can write to `app_data_dir` between those
/// two points (a malicious helper, ransomware, an interrupted disk write,
/// a renamed-in-place file) could substitute the verified file with one
/// that is corrupt, foreign, or carries a future schema_version.  If we
/// blindly swapped that file in we would either:
///
/// 1. Corrupt the user's primary DB with junk bytes (data loss),
/// 2. Boot against an attacker-controlled SQLite (privilege escalation
///    paths through SQL functions / loadable extensions),
/// 3. Or come up on a future schema_version we cannot migrate down,
///    leaving the app permanently unable to start.
///
/// Mitigation: every pending file is re-verified via [`verify_pending_db`]
/// **immediately** before the rename.  A failure quarantines the bad file
/// to `pending_restore.db.rejected.<unix_ts>` (so the next boot is clean
/// instead of looping on the same broken file) and returns `Err`.  The
/// caller in `setup.rs` logs the failure but does not abort startup —
/// the main DB is left untouched and the app boots normally.
pub fn pre_startup_restore(
    app_data_dir: &std::path::Path,
    db_path: &std::path::Path,
) -> std::io::Result<bool> {
    let pending_path = app_data_dir.join("pending_restore.db");
    if !pending_path.exists() {
        return Ok(false);
    }

    tracing::info!("pre_startup_restore: pending file found, verifying before swap");

    // Audit-v2 DB-007/008: re-verify the pending file just before the
    // file rename.  See the function-level note above for the threat
    // model this closes.
    if let Err(e) = verify_pending_db(&pending_path) {
        tracing::error!("pre_startup_restore: REFUSING to swap unverified DB: {}", e);

        // Quarantine the bad file so we don't retry the same broken
        // file on every subsequent boot.  Best-effort: if the rename
        // fails (read-only fs / permission error / target exists) fall
        // back to deletion so the boot is at least self-healing.
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        let rejected_path =
            pending_path.with_file_name(format!("pending_restore.db.rejected.{timestamp}"));
        if let Err(rename_err) = fs::rename(&pending_path, &rejected_path) {
            tracing::warn!(
                "pre_startup_restore: failed to quarantine bad pending file ({}); deleting instead",
                rename_err
            );
            let _ = fs::remove_file(&pending_path);
        } else {
            tracing::warn!(
                "pre_startup_restore: quarantined bad pending file to: {}",
                rejected_path.display()
            );
        }

        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "Pending restore DB failed verification: {e}. \
                 Quarantined file (no swap performed). \
                 Main database left intact."
            ),
        ));
    }

    tracing::info!("pre_startup_restore: pending file verified, swapping database");

    // No pool is open yet — deletions are safe
    let _ = fs::remove_file(db_path);
    let _ = fs::remove_file(db_path.with_extension("db-wal"));
    let _ = fs::remove_file(db_path.with_extension("db-shm"));

    fs::copy(&pending_path, db_path)?;
    fs::remove_file(&pending_path)?;

    tracing::info!("pre_startup_restore: database swapped successfully");
    Ok(true)
}

/// Layered verification of a pending-restore SQLite file (audit-v2 DB-007/008).
///
/// The four layers are ordered cheapest-first so a malformed file is
/// rejected at the first layer it fails:
///
/// 1. **Magic bytes** — first 16 bytes must be `b"SQLite format 3\0"`.
///    Catches non-SQLite junk, truncated downloads, and partial writes.
/// 2. **`PRAGMA integrity_check`** — full B-tree walk.  Catches corruption
///    that the magic-byte check cannot see (bad page checksums, broken
///    free-list, etc.).
/// 3. **`schema_meta.schema_version`** — must be `≤ CURRENT_SCHEMA_VERSION`.
///    Refuses to swap in a future-version DB that we cannot run.  Missing
///    `schema_meta` is treated as version 0 (legacy pre-versioned DB),
///    which is always supported because `run_migrations` walks the
///    registry from there.
/// 4. **`Experiment` table presence** — final gate that distinguishes a
///    valid SQLite of *some* application from a RheoLab DB.
fn verify_pending_db(path: &Path) -> std::io::Result<()> {
    use std::io::Read;

    // Layer 1: magic bytes (cheap, fast, catches non-SQLite junk).
    let mut header = [0u8; 16];
    let mut file = std::fs::File::open(path)?;
    file.read_exact(&mut header)?;
    drop(file);
    const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";
    if &header != SQLITE_MAGIC {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "file does not start with SQLite magic bytes",
        ));
    }

    // Layer 2: open read-only, run integrity_check.
    let conn =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("cannot open as SQLite: {e}"),
                )
            })?;

    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|e| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("integrity_check query failed: {e}"),
            )
        })?;
    if integrity != "ok" {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("integrity_check returned: {integrity}"),
        ));
    }

    // Layer 3: schema_version must be one we can run.  Missing
    // schema_meta = legacy pre-versioned DB = version 0 (always OK).
    let pending_version: i64 = conn
        .query_row(
            "SELECT schema_version FROM schema_meta WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if pending_version > crate::db::migration::CURRENT_SCHEMA_VERSION {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "pending DB schema_version {} is newer than CURRENT_SCHEMA_VERSION {}; \
                 refusing to downgrade — install a newer build first",
                pending_version,
                crate::db::migration::CURRENT_SCHEMA_VERSION
            ),
        ));
    }

    // Layer 4: must contain the `Experiment` table — canonical RheoLab marker.
    let has_experiment_table: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='Experiment'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);
    if !has_experiment_table {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "pending DB does not contain the Experiment table — not a RheoLab database",
        ));
    }

    Ok(())
}

/// Check and apply pending restore on startup
pub fn check_pending_restore(app: &AppHandle) -> Result<()> {
    let pending_path = get_pending_restore_path(app)?;

    if !pending_path.exists() {
        return Ok(());
    }

    log_restore(app, "Found pending restore file");
    tracing::info!("Found pending restore. Applying...");

    let state: State<AppState> = app.state();
    let db_path = &state.database_path;

    // HIGH-4: Best-effort orphan cleanup before restore.
    // Removes any ExperimentData rows with no parent Experiment row that may have
    // accumulated due to the pre-V10 missing FK. The PooledConnection guard is
    // dropped immediately after this block, returning the connection to the pool
    // before file-system operations begin.
    if let Ok(conn) = state.db_pool.get() {
        let result = conn.execute(
            "DELETE FROM ExperimentData WHERE experimentId NOT IN (SELECT id FROM Experiment)",
            [],
        );
        match result {
            Ok(n) if n > 0 => tracing::info!(
                "Pre-restore orphan cleanup: removed {} ExperimentData rows",
                n
            ),
            Err(e) => tracing::warn!("Pre-restore orphan cleanup failed (non-fatal): {}", e),
            _ => {}
        }
    } // PooledConnection dropped here — connection returned to pool before file ops

    // Delete old database and WAL files
    if db_path.exists() {
        if let Err(e) = fs::remove_file(db_path) {
            log_restore(app, &format!("Failed to delete old DB: {}", e));
            tracing::error!("Failed to delete old database: {}", e);
        } else {
            log_restore(app, "Deleted old DB");
        }
    }

    // Delete WAL and SHM files
    let wal_path = db_path.with_extension("db-wal");
    let shm_path = db_path.with_extension("db-shm");

    if wal_path.exists() {
        let _ = fs::remove_file(&wal_path);
        log_restore(app, "Deleted WAL file");
    }

    if shm_path.exists() {
        let _ = fs::remove_file(&shm_path);
        log_restore(app, "Deleted SHM file");
    }

    // Copy pending restore to database location
    match fs::copy(&pending_path, db_path) {
        Ok(_) => {
            log_restore(app, "Restored database successfully");
            tracing::info!("Database restored successfully");

            // Remove pending file
            if let Err(e) = fs::remove_file(&pending_path) {
                log_restore(app, &format!("Failed to delete pending file: {}", e));
            } else {
                log_restore(app, "Deleted pending file. Success.");
            }
        }
        Err(e) => {
            log_restore(app, &format!("CRITICAL ERROR restoring: {}", e));
            tracing::error!("CRITICAL ERROR restoring database: {}", e);
            return Err(format!("Failed to restore database: {}", e).into());
        }
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "restore_tests.rs"]
mod merge_tests;
