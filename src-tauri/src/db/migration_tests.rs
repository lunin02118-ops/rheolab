//! Tests for `db::migration`.
//!
//! Extracted from `migration.rs` to keep the production file below the 500-LOC
//! hygiene limit (WP-4.1 acceptance).

use super::*;
use crate::db::migrations::r#trait::Migration;
use crate::db::migrations::v0001_initial::V1_DDL;
use crate::db::migrations::v0002_touch_point_metrics::V0002TouchPointMetrics;
use crate::db::migrations::v0003_multi_threshold_touch_point::V0003MultiThresholdTouchPoint;
use crate::db::migrations::v0004_experiment_list_default_index::V0004ExperimentListDefaultIndex;
use crate::db::migrations::v0005_reagent_and_testtype_indexes::V0005ReagentAndTestTypeIndexes;
use crate::db::migrations::v0006_artifact_import_batch_indexes::V0006ArtifactImportBatchIndexes;
use crate::db::migrations::v0007_fk_indexes::V0007FkIndexes;

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
        "APIKey",
        "Calibration",
        "ConflictRecord",
        "Experiment",
        "ExperimentData",
        "ExperimentPayload",
        "ExperimentReagent",
        "ImportBatch",
        "Laboratory",
        "MergeEvent",
        "Operator",
        "ParserArtifact",
        "ReagentCatalog",
        "ReportArtifact",
        "SearchProjectionLog",
        "Settings",
        "SyncInbox",
        "SyncOutbox",
        "SystemState",
        // v0003 side table — one row per (experimentId, thresholdCp)
        // for multi-threshold touch-point precompute.  Sorts here in
        // SQLite's binary collation because uppercase `T` < `U`.
        "TouchPointPrecompute",
        "User",
        "WaterSourceCatalog",
        // lowercase names sort after all uppercase-starting names in SQLite binary order
        "schema_meta",
    ];
    assert_eq!(
        tables, expected,
        "All 23 tables should be created by V1_DDL + v0003 side table"
    );
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
    assert!(
        n > 0,
        "Default reagents must be seeded on a fresh install, got 0"
    );
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
    assert_eq!(
        before, after,
        "Custom reagent must not be deleted or duplicated by migration runs"
    );

    let still_there: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ReagentCatalog WHERE name = 'МояДобавка-XL'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    assert_eq!(
        still_there, 1,
        "Custom reagent 'МояДобавка-XL' must still exist after updates"
    );
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
    assert_eq!(
        restored, 1,
        "Deleted default reagent must be re-seeded on next startup"
    );
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
        count(&conn, "Experiment"),
        2,
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
    let exp_cnt = count(&conn, "Experiment");
    let lab_cnt = count(&conn, "Laboratory");
    let op_cnt = count(&conn, "Operator");
    let er_cnt = count(&conn, "ExperimentReagent");
    let reag_count_before = count(&conn, "ReagentCatalog");

    // Simulate app update
    run_migrations(&conn).unwrap();

    assert_eq!(count(&conn, "Experiment"), exp_cnt, "Experiments");
    assert_eq!(count(&conn, "Laboratory"), lab_cnt, "Laboratories");
    assert_eq!(count(&conn, "Operator"), op_cnt, "Operators");
    assert_eq!(
        count(&conn, "ExperimentReagent"),
        er_cnt,
        "ExperimentReagent links"
    );
    assert_eq!(
        count(&conn, "ReagentCatalog"),
        reag_count_before,
        "ReagentCatalog total"
    );
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
    assert_eq!(
        fk_count, 1,
        "ExperimentData must have exactly one FK (to Experiment)"
    );

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

    conn.execute_batch("PRAGMA foreign_keys = ON; DELETE FROM Experiment WHERE id='exp-fk';")
        .unwrap();

    assert_eq!(
        count(&conn, "ExperimentData"),
        0,
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
    assert!(
        result.was_fresh_install,
        "First run must report was_fresh_install = true"
    );
    assert!(
        !result.app_version.is_empty(),
        "app_version must not be empty"
    );

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
    assert_eq!(
        row_count, 1,
        "schema_meta must remain a single-row singleton"
    );
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
        .query_row("SELECT COUNT(*) FROM schema_meta WHERE id = 1", [], |r| {
            r.get(0)
        })
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
/// schema to applying every registered migration directly in order.
///
/// When a new migration is added to [`MIGRATIONS`], extend the raw path
/// (conn_b) to call `.up()` for that migration too so the identity check
/// stays meaningful.
#[test]
fn schema_identity_with_raw_ddl() {
    let conn_a = open();
    run_migrations(&conn_a).unwrap();

    let conn_b = open();
    conn_b.execute_batch(V1_DDL).unwrap();
    // v0002 — touch-point precompute columns + partial indexes.
    V0002TouchPointMetrics.up(&conn_b).unwrap();
    // v0003 — multi-threshold TouchPointPrecompute side table + partial
    // indexes + copy-forward of legacy 50 cP data.
    V0003MultiThresholdTouchPoint.up(&conn_b).unwrap();
    // v0004 — descending composite index for default Library list page.
    V0004ExperimentListDefaultIndex.up(&conn_b).unwrap();
    // v0005 — F6/F7 reagent NOCASE + testType composite indexes.
    V0005ReagentAndTestTypeIndexes.up(&conn_b).unwrap();
    // v0006 — F2 import-batch FK indexes for artifact tables.
    V0006ArtifactImportBatchIndexes.up(&conn_b).unwrap();
    // v0007 — DB-003 FK column indexes (Experiment.waterSourceId, ExperimentReagent.reagentId).
    V0007FkIndexes.up(&conn_b).unwrap();

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
        "run_migrations() must produce the same schema as sequentially applying every \
         registered migration on top of V1_DDL"
    );
}

// ── Registry invariants (W3.4) ──────────────────────────────────────────

/// The MIGRATIONS registry must only contain monotonically-increasing,
/// strictly-positive, unique version numbers. `validate_registry()` exists
/// so CI catches typos at test time rather than at runtime.
#[test]
fn migration_registry_invariants_hold() {
    crate::db::migrations::validate_registry()
        .expect("MIGRATIONS registry must have strictly increasing positive versions");
    assert!(
        !crate::db::migrations::MIGRATIONS.is_empty(),
        "At least one migration must be registered — otherwise run_migrations cannot create schema_meta"
    );
}

/// The compile-time `CURRENT_SCHEMA_VERSION` constant and the last entry in
/// `MIGRATIONS` must agree. If a developer adds a migration but forgets to
/// bump the constant (or vice versa), this test catches the drift.
#[test]
fn current_schema_version_matches_last_registered_migration() {
    assert_eq!(
        CURRENT_SCHEMA_VERSION,
        crate::db::migrations::latest_registered_version(),
        "CURRENT_SCHEMA_VERSION must equal the last registered migration's version()"
    );
}

/// When `schema_meta.schema_version` already records the latest version,
/// calling `run_migrations` a second time must be a no-op at the migration
/// level — it only upserts the schema_meta row. We can't observe "skip"
/// directly without instrumentation, but we can verify the idempotent
/// outcome: the row count of schema_meta stays at 1 and schema_version is
/// unchanged.
#[test]
fn run_migrations_is_idempotent_across_restarts() {
    let conn = open();
    let first = run_migrations(&conn).unwrap();
    assert_eq!(first.schema_version, CURRENT_SCHEMA_VERSION);

    // Second call — simulates app restart.
    let second = run_migrations(&conn).unwrap();
    assert_eq!(second.schema_version, CURRENT_SCHEMA_VERSION);

    let schema_meta_rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM schema_meta", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        schema_meta_rows, 1,
        "schema_meta must remain a singleton row"
    );
}

/// Regression guard: if the stored schema_version is ahead of the binary's
/// CURRENT_SCHEMA_VERSION we log a warning but must not error out; the
/// application continues to start so the user can see the warning and
/// restore from backup.
#[test]
fn downgrade_scenario_does_not_error() {
    let conn = open();
    run_migrations(&conn).unwrap();
    // Fake a future schema_version as if a newer app build had run against
    // this DB previously.
    conn.execute(
        "UPDATE schema_meta SET schema_version = ?1 WHERE id = 1",
        rusqlite::params![CURRENT_SCHEMA_VERSION + 100],
    )
    .unwrap();

    let result = run_migrations(&conn);
    assert!(
        result.is_ok(),
        "downgrade (stored version > CURRENT_SCHEMA_VERSION) must not be a hard failure"
    );
}

/// Regression guard for audit-preflight DB-001:
///
/// On a downgrade (stored schema_version > CURRENT_SCHEMA_VERSION),
/// `run_migrations` must NOT rewrite `schema_meta.schema_version` back down
/// to CURRENT_SCHEMA_VERSION.  Doing so would silently mask the downgrade
/// from subsequent upgrade detection and from any UI that wants to offer
/// "restore from backup" recovery.
///
/// The truthful behavior is: leave the row alone, return a MigrationResult
/// whose `schema_version` reflects the actual (higher) stored value.
#[test]
fn downgrade_does_not_overwrite_schema_meta() {
    let conn = open();
    run_migrations(&conn).unwrap();
    let future_version = CURRENT_SCHEMA_VERSION + 100;
    let future_app_version = "9.9.9-future-build";
    conn.execute(
        "UPDATE schema_meta SET schema_version = ?1, app_version = ?2 WHERE id = 1",
        rusqlite::params![future_version, future_app_version],
    )
    .unwrap();

    let result = run_migrations(&conn).expect("downgrade must not be a hard failure");

    // (1) Returned result reflects the higher stored version, not the binary's.
    assert_eq!(
        result.schema_version, future_version,
        "MigrationResult must carry the actual stored schema_version on downgrade"
    );
    assert_eq!(
        result.previous_app_version.as_deref(),
        Some(future_app_version),
        "MigrationResult must report the prior (future) app_version on downgrade"
    );
    assert!(
        !result.was_fresh_install,
        "downgrade is not a fresh install"
    );

    // (2) schema_meta row in the DB itself must be UNCHANGED.
    let (db_version, db_app_version): (i64, String) = conn
        .query_row(
            "SELECT schema_version, app_version FROM schema_meta WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(
        db_version, future_version,
        "schema_meta.schema_version must NOT be downgraded by run_migrations \
         (audit-preflight DB-001 regression guard)"
    );
    assert_eq!(
        db_app_version, future_app_version,
        "schema_meta.app_version must NOT be overwritten on downgrade"
    );
}
