#![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Schema for the unified SQLite database.
//!
//! All 21 tables, indexes, FTS5 virtual table, and triggers are defined
//! in a single consolidated V1_DDL constant.  All DDL uses `IF NOT EXISTS`
//! so `run_migrations` is safe to call on every startup — fresh DB or not.
//!
//! Schema versioning is tracked in the `schema_meta` table (singleton row,
//! id = 1). This table is created as part of V1_DDL so it is present on
//! both fresh installs and legacy databases upgraded from pre-versioned builds.
//!
//! **Downgrade policy**: schema_version only ever increases. If a user
//! downgrades the application binary the `schema_meta.schema_version` value
//! will be higher than `CURRENT_SCHEMA_VERSION`; `run_migrations` logs a
//! warning but does not attempt to reverse the schema — the caller should
//! handle this before touching user data.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

/// Current schema version embedded at compile time.
///
/// Increment this constant **and** add a corresponding `V{N}_MIGRATION` block
/// to `run_migrations` whenever a destructive schema change is needed (e.g.
/// `ALTER TABLE`, dropping a column, changing a column type).
/// Pure additions (new tables / indexes) are safe to add directly to V1_DDL
/// using `IF NOT EXISTS` without bumping the version.
pub const CURRENT_SCHEMA_VERSION: i64 = 1;

/// Information returned after a successful migration run.
///
/// Serialised and emitted to the frontend as the `startup_completed` Tauri event
/// so the UI can detect post-update first runs and offer recovery options.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    /// The schema version that is now active.
    pub schema_version: i64,
    /// `true` when schema_meta did not previously exist (first ever run / fresh install).
    pub was_fresh_install: bool,
    /// The app version string compiled into this binary (current version).
    pub app_version: String,
    /// The app version stored in schema_meta *before* this run, if any.
    /// `None` on a fresh install.  Different from `app_version` when the user
    /// has just upgraded from a previous release.
    pub previous_app_version: Option<String>,
    /// `true` when `previous_app_version` differs from `app_version` (i.e. this
    /// is the first run after an application update).
    pub version_changed: bool,
}

/// Apply the full schema and seed default data.
///
/// Idempotent — every `CREATE TABLE / INDEX / TRIGGER` uses `IF NOT EXISTS`.
/// Default reagents are seeded via `INSERT OR IGNORE`, so:
///   - Fresh install  → all defaults inserted.
///   - App update     → new defaults from updated source are inserted;
///                      existing rows (same name) left untouched.
///   - User data      → custom reagents, experiments, etc. are never affected.
///
/// # Schema versioning
/// `schema_meta` (id = 1) records the last seen schema_version and the
/// app version that ran the migration.  This is the prerequisite for
/// startup recovery detection (Phase 3.3).
pub fn run_migrations(conn: &Connection) -> Result<MigrationResult, rusqlite::Error> {
    // Step 1: Apply all registered migrations in version order.  Every
    // statement uses IF NOT EXISTS so this is safe on any existing database.
    for migration in super::migrations::MIGRATIONS {
        migration.up(conn).map_err(|e| match e {
            super::migrations::MigrationError::Sqlite(inner) => inner,
        })?;
    }

    // Step 2: Check whether schema_meta already existed before this run and
    // capture the previously-stored app version for post-update detection.
    let existing_row: Option<(i64, String)> = conn
        .query_row(
            "SELECT schema_version, app_version FROM schema_meta WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let was_fresh_install = existing_row.is_none();
    let previous_app_version: Option<String> = existing_row.map(|(_, ver)| ver);
    let app_version = env!("CARGO_PKG_VERSION").to_string();
    let version_changed = previous_app_version
        .as_deref()
        .map_or(false, |prev| prev != app_version);

    // Step 3: Upsert schema_meta so it always reflects this run.
    conn.execute(
        "INSERT INTO schema_meta (id, schema_version, app_version, migrated_at)
         VALUES (1, ?1, ?2, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
             schema_version = excluded.schema_version,
             app_version    = excluded.app_version,
             migrated_at    = excluded.migrated_at",
        rusqlite::params![CURRENT_SCHEMA_VERSION, app_version],
    )?;

    // Always attempt to seed default reagents.
    // seed_default_reagents uses INSERT OR IGNORE so it is safe to call on
    // every startup: existing rows (matched by UNIQUE name) are skipped,
    // user-created reagents with different names are never touched.
    if let Err(e) = crate::commands::reagents::seed_default_reagents(conn) {
        tracing::warn!("Reagent seed error (non-fatal): {}", e);
    }

    if version_changed {
        tracing::info!(
            "App updated: {} → {} (schema version: {})",
            previous_app_version.as_deref().unwrap_or("unknown"),
            app_version,
            CURRENT_SCHEMA_VERSION,
        );
    } else {
        tracing::info!(
            "Database schema ready (version: {}, app: {}, fresh_install: {})",
            CURRENT_SCHEMA_VERSION, app_version, was_fresh_install,
        );
    }

    Ok(MigrationResult {
        schema_version: CURRENT_SCHEMA_VERSION,
        was_fresh_install,
        app_version,
        previous_app_version,
        version_changed,
    })
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::v0001_initial::V1_DDL;

    // ── Helpers ──────────────────────────────────────────────────────────

    fn open() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
            .unwrap_or(0)
    }

    fn insert_user(conn: &Connection, id: &str) {
        conn.execute(
            "INSERT INTO User (id, name, email, role, isActive, createdAt, updatedAt) \
             VALUES (?1, ?2, ?3, 'operator', 1, datetime('now'), datetime('now'))",
            rusqlite::params![id, id, format!("{id}@test")],
        )
        .unwrap();
    }

    fn insert_experiment(conn: &Connection, id: &str, user_id: &str) {
        conn.execute(
            "INSERT INTO Experiment \
             (id, createdAt, updatedAt, originalFilename, testDate, instrumentType, \
              geometry, geometrySource, durationSeconds, avgTemperatureC, \
              maxViscosity, avgViscosity, name, fieldName, operatorName, wellNumber, \
              testId, waterSource, waterParams, fluidType, testGroup, testSubGroup, \
              metrics, rawPoints, calibration, userId, laboratoryId, parsedBy, \
              parseSource, timeRangeMin, timeRangeMax, viscosityMin, pressureMax, extraFields) \
             VALUES (?1,datetime('now'),datetime('now'),'f.csv',datetime('now'), \
              'Chandler',NULL,NULL,600,60.0,500,250,?2,'Field','Op','W1','T1', \
              'River','{}','Crosslinked','Rheology',NULL,'{}','[]',NULL,?3, \
              NULL,NULL,NULL,0.0,600.0,10,0.0,'{}')",
            rusqlite::params![id, format!("Exp {id}"), user_id],
        )
        .unwrap();
    }

    // ── Schema tests ─────────────────────────────────────────────────────

    #[test]
    fn migration_v1_creates_all_tables() {
        let conn = open();
        run_migrations(&conn).unwrap();

        let tables: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master \
                 WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'fts_%' \
                 ORDER BY name",
            )
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();

        let expected = vec![
            "APIKey", "Calibration", "ConflictRecord",
            "Experiment", "ExperimentData", "ExperimentPayload", "ExperimentReagent",
            "ImportBatch", "Laboratory", "MergeEvent", "Operator", "ParserArtifact",
            "ReagentCatalog", "ReportArtifact", "SearchProjectionLog",
            "Settings", "SyncInbox", "SyncOutbox",
            "SystemState", "User", "WaterSourceCatalog",
            // lowercase names sort after all uppercase-starting names in SQLite binary order
            "schema_meta",
        ];
        assert_eq!(tables, expected, "All 22 tables should be created by V1_DDL");
    }

    #[test]
    fn migration_is_idempotent() {
        let conn = open();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap(); // second call must not fail
        // Idempotency is guaranteed by IF NOT EXISTS DDL; schema_meta upsert (ON CONFLICT)
        // ensures the second run is also safe.
    }

    // ── Reagent seeding tests ─────────────────────────────────────────────

    /// Fresh install: default catalog is populated automatically.
    #[test]
    fn fresh_install_seeds_default_reagents() {
        let conn = open();
        run_migrations(&conn).unwrap();

        let n = count(&conn, "ReagentCatalog");
        assert!(n > 0, "Default reagents must be seeded on a fresh install, got 0");
    }

    /// Running migrations a second time (simulating app update / restart)
    /// must not duplicate default reagents.
    #[test]
    fn update_does_not_duplicate_default_reagents() {
        let conn = open();
        run_migrations(&conn).unwrap();
        let after_first = count(&conn, "ReagentCatalog");

        run_migrations(&conn).unwrap();
        let after_second = count(&conn, "ReagentCatalog");

        assert_eq!(
            after_first, after_second,
            "Running migrations twice must not create duplicate reagents \
             (got {after_first} then {after_second})"
        );
    }

    /// User's custom reagents must survive app updates (multiple migration runs).
    #[test]
    fn user_custom_reagents_preserved_across_updates() {
        let conn = open();
        run_migrations(&conn).unwrap();

        // User adds a custom reagent that is NOT in the default catalog
        conn.execute(
            "INSERT INTO ReagentCatalog \
             (id, name, category, manufacturer, country, description, \
              activeSubstance, form, createdAt, updatedAt) \
             VALUES ('custom-1','МояДобавка-XL','Viscosifier','ООО Лаб', \
              'Россия','Кастомный реагент',NULL,'Liquid',datetime('now'),datetime('now'))",
            [],
        )
        .unwrap();

        let before = count(&conn, "ReagentCatalog");

        // Simulate 3 app restarts / updates
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();

        let after = count(&conn, "ReagentCatalog");
        assert_eq!(before, after, "Custom reagent must not be deleted or duplicated by migration runs");

        let still_there: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ReagentCatalog WHERE name = 'МояДобавка-XL'",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        assert_eq!(still_there, 1, "Custom reagent 'МояДобавка-XL' must still exist after updates");
    }

    /// Default reagent that was *deleted* by the user gets re-seeded on next
    /// startup.  This is intentional catalog behaviour — defaults are always
    /// available after a restart.
    #[test]
    fn deleted_default_reagent_is_reseeded_on_restart() {
        let conn = open();
        run_migrations(&conn).unwrap();

        // Grab the name of the first default reagent
        let first_default: String = conn
            .query_row(
                "SELECT name FROM ReagentCatalog WHERE id LIKE 'seed_%' LIMIT 1",
                [],
                |r| r.get(0),
            )
            .expect("At least one seed reagent must exist");

        // User deletes it
        conn.execute(
            "DELETE FROM ReagentCatalog WHERE name = ?1",
            rusqlite::params![&first_default],
        )
        .unwrap();

        let gone: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ReagentCatalog WHERE name = ?1",
                rusqlite::params![&first_default],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(gone, 0, "Reagent must be deleted before restart test");

        // Simulate app restart
        run_migrations(&conn).unwrap();

        let restored: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ReagentCatalog WHERE name = ?1",
                rusqlite::params![&first_default],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(restored, 1, "Deleted default reagent must be re-seeded on next startup");
    }

    // ── Experiment / user data preservation tests ────────────────────────

    /// Experiments inserted before a simulated app update must survive.
    #[test]
    fn experiments_preserved_across_updates() {
        let conn = open();
        run_migrations(&conn).unwrap();

        insert_user(&conn, "u1");
        insert_experiment(&conn, "exp-1", "u1");
        insert_experiment(&conn, "exp-2", "u1");

        let before = count(&conn, "Experiment");
        assert_eq!(before, 2);

        // Simulate 3 app updates
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();

        assert_eq!(
            count(&conn, "Experiment"), 2,
            "Experiments must not be deleted or duplicated by migration runs"
        );
    }

    /// All user data tables remain intact after a migration run.
    #[test]
    fn all_user_data_preserved_after_migration() {
        let conn = open();
        run_migrations(&conn).unwrap();

        insert_user(&conn, "u2");
        insert_experiment(&conn, "exp-a", "u2");

        // Add a laboratory
        conn.execute(
            "INSERT INTO Laboratory (id, name, createdAt, updatedAt) \
             VALUES ('lab1','ЦЗЛ Нефтяник',datetime('now'),datetime('now'))",
            [],
        )
        .unwrap();

        // Add an operator
        conn.execute(
            "INSERT INTO Operator (id, name, position, isActive, createdAt, updatedAt) \
             VALUES ('op1','Иванов И.И.','Инженер',1,datetime('now'),datetime('now'))",
            [],
        )
        .unwrap();

        // Add a custom reagent with an experiment link
        conn.execute(
            "INSERT INTO ReagentCatalog (id, name, category, manufacturer, country, \
             description, activeSubstance, form, createdAt, updatedAt) \
             VALUES ('r1','Кастом-1','Breaker','ООО','Россия','desc',NULL,'Powder', \
             datetime('now'),datetime('now'))",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ExperimentReagent \
             (id, experimentId, reagentId, reagentName, category, concentration, unit) \
             VALUES ('er1','exp-a','r1','Кастом-1','Breaker',0.5,'kg/m³')",
            [],
        )
        .unwrap();

        // Snapshot counts
        let exp_cnt    = count(&conn, "Experiment");
        let lab_cnt    = count(&conn, "Laboratory");
        let op_cnt     = count(&conn, "Operator");
        let er_cnt     = count(&conn, "ExperimentReagent");
        let reag_count_before = count(&conn, "ReagentCatalog");

        // Simulate app update
        run_migrations(&conn).unwrap();

        assert_eq!(count(&conn, "Experiment"),       exp_cnt,  "Experiments");
        assert_eq!(count(&conn, "Laboratory"),        lab_cnt,  "Laboratories");
        assert_eq!(count(&conn, "Operator"),          op_cnt,   "Operators");
        assert_eq!(count(&conn, "ExperimentReagent"), er_cnt,   "ExperimentReagent links");
        assert_eq!(count(&conn, "ReagentCatalog"),   reag_count_before, "ReagentCatalog total");
    }

    // ── FK integrity tests ───────────────────────────────────────────────

    #[test]
    fn experiment_data_fk_cascades_on_delete() {
        let conn = open();
        run_migrations(&conn).unwrap();

        // Verify FK is declared on ExperimentData.
        let fk_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_foreign_key_list('ExperimentData')",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        assert_eq!(fk_count, 1, "ExperimentData must have exactly one FK (to Experiment)");

        insert_user(&conn, "u3");
        insert_experiment(&conn, "exp-fk", "u3");

        conn.execute(
            "INSERT INTO ExperimentData \
             (experimentId, dataBlob, encoding, pointCount, createdAt, updatedAt) \
             VALUES ('exp-fk', X'deadbeef', 'columnar-v1-zstd', 1, datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();

        assert_eq!(count(&conn, "ExperimentData"), 1);

        conn.execute_batch("PRAGMA foreign_keys = ON; DELETE FROM Experiment WHERE id='exp-fk';").unwrap();

        assert_eq!(
            count(&conn, "ExperimentData"), 0,
            "ExperimentData row must be cascade-deleted with its parent Experiment"
        );
    }

    // ── schema_meta tests ─────────────────────────────────────────────────

    /// Fresh install: schema_meta row is created with correct values.
    #[test]
    fn schema_meta_created_on_fresh_db() {
        let conn = open();
        let result = run_migrations(&conn).unwrap();

        assert_eq!(result.schema_version, CURRENT_SCHEMA_VERSION);
        assert!(result.was_fresh_install, "First run must report was_fresh_install = true");
        assert!(!result.app_version.is_empty(), "app_version must not be empty");

        // Verify the row actually exists in the DB
        let (db_version, db_app_ver): (i64, String) = conn
            .query_row(
                "SELECT schema_version, app_version FROM schema_meta WHERE id = 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .expect("schema_meta row must exist after run_migrations");

        assert_eq!(db_version, CURRENT_SCHEMA_VERSION);
        assert_eq!(db_app_ver, result.app_version);
    }

    /// Running migrations twice must not create two rows (singleton constraint).
    #[test]
    fn schema_meta_stays_singleton_on_second_run() {
        let conn = open();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();

        let row_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_meta", [], |r| r.get(0))
            .unwrap();
        assert_eq!(row_count, 1, "schema_meta must remain a single-row singleton");
    }

    /// Second call to run_migrations must report was_fresh_install = false.
    #[test]
    fn was_fresh_install_false_on_second_run() {
        let conn = open();
        let first = run_migrations(&conn).unwrap();
        assert!(first.was_fresh_install);

        let second = run_migrations(&conn).unwrap();
        assert!(
            !second.was_fresh_install,
            "Second run must report was_fresh_install = false (row already present)"
        );
    }

    /// A database that has all tables but no schema_meta row (legacy upgrade)
    /// is handled gracefully: schema_meta is created without error.
    #[test]
    fn legacy_db_without_schema_meta_row_is_upgraded() {
        let conn = open();
        // Run V1_DDL manually, then delete the schema_meta row to simulate a
        // pre-schema_meta database that already has the table created but empty.
        conn.execute_batch(V1_DDL).unwrap();
        conn.execute("DELETE FROM schema_meta", []).unwrap();

        let result = run_migrations(&conn).unwrap();

        // The missing row is treated as a fresh install (row was absent)
        assert_eq!(result.schema_version, CURRENT_SCHEMA_VERSION);

        // Verify row was inserted
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM schema_meta WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1, "schema_meta row must be created after upgrade");
    }

    /// Fresh install: previous_app_version is None and version_changed is false.
    #[test]
    fn fresh_install_no_previous_version() {
        let conn = open();
        let result = run_migrations(&conn).unwrap();

        assert!(
            result.previous_app_version.is_none(),
            "fresh install must have no previous_app_version"
        );
        assert!(
            !result.version_changed,
            "fresh install must not report version_changed"
        );
    }

    /// Second run with same version: previous_app_version == current, version_changed = false.
    #[test]
    fn same_version_restart_has_no_version_change() {
        let conn = open();
        let first = run_migrations(&conn).unwrap();
        let second = run_migrations(&conn).unwrap();

        assert_eq!(
            second.previous_app_version.as_deref(),
            Some(first.app_version.as_str()),
            "second run must see the version stored by the first run as previous"
        );
        assert!(
            !second.version_changed,
            "restarting with the same version must not set version_changed"
        );
    }

    /// WP-4.1 acceptance criterion: run_migrations() must produce an identical
    /// schema to applying V1_DDL directly.
    #[test]
    fn schema_identity_with_raw_ddl() {
        let conn_a = open();
        run_migrations(&conn_a).unwrap();

        let conn_b = open();
        conn_b.execute_batch(V1_DDL).unwrap();

        fn dump(conn: &Connection) -> Vec<String> {
            let mut stmt = conn
                .prepare(
                    "SELECT type, name, sql FROM sqlite_master \
                     WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' \
                     ORDER BY type, name",
                )
                .unwrap();
            stmt.query_map([], |r| {
                Ok(format!(
                    "{}:{}:{}",
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?
                ))
            })
            .unwrap()
            .map(|r| r.unwrap())
            .collect()
        }

        assert_eq!(
            dump(&conn_a),
            dump(&conn_b),
            "run_migrations() must produce identical schema to direct V1_DDL execution"
        );
    }
}



