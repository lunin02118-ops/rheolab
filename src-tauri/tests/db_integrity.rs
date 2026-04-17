//! Integration tests: database schema integrity and migration correctness.
//!
//! Verifies that `run_migrations` produces a correct, consistent SQLite schema
//! every time it is called — on a fresh database and on a pre-existing one.
//!
//!   cargo test --test db_integrity -- --nocapture

use rheolab_enterprise::db::migration::{run_migrations, CURRENT_SCHEMA_VERSION};
use rusqlite::Connection;

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Create an in-memory SQLite connection with migrations applied.
fn migrated_conn() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory DB");
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;",
    )
    .expect("PRAGMA setup");
    run_migrations(&conn).expect("migration must succeed");
    conn
}

// ── Migration correctness ──────────────────────────────────────────────────────

#[test]
fn migration_succeeds_on_fresh_db() {
    let conn = Connection::open_in_memory().expect("in-memory DB");
    let result = run_migrations(&conn).expect("migration must not fail");
    assert_eq!(result.schema_version, CURRENT_SCHEMA_VERSION);
    assert!(result.was_fresh_install, "first run should be detected as fresh install");
}

#[test]
fn migration_is_idempotent() {
    let conn = Connection::open_in_memory().expect("in-memory DB");
    run_migrations(&conn).expect("first migration run");
    // Running twice must not error out (all DDL uses IF NOT EXISTS / INSERT OR IGNORE).
    let result = run_migrations(&conn).expect("second migration run must succeed");
    assert_eq!(result.schema_version, CURRENT_SCHEMA_VERSION);
    assert!(!result.was_fresh_install, "second run should not be treated as fresh install");
}

#[test]
fn schema_meta_version_matches_constant() {
    let conn = migrated_conn();
    let version: i64 = conn
        .query_row(
            "SELECT schema_version FROM schema_meta WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .expect("schema_meta row must exist");
    assert_eq!(version, CURRENT_SCHEMA_VERSION);
}

// ── Required tables present ───────────────────────────────────────────────────

#[test]
fn required_tables_exist() {
    let conn = migrated_conn();
    let required_tables = [
        "schema_meta",
        "User",
        "Settings",
        "APIKey",
        "SystemState",
        "ReagentCatalog",
        "Laboratory",
        "Operator",
        "Experiment",
        "ExperimentData",
        "ExperimentReagent",
        "Calibration",
        "WaterSourceCatalog",
    ];
    for table in &required_tables {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                rusqlite::params![table],
                |row| row.get(0),
            )
            .unwrap_or(0);
        assert_eq!(count, 1, "table '{table}' must exist after migration");
    }
}

// ── PRAGMA verification ───────────────────────────────────────────────────────

#[test]
fn foreign_keys_pragma_on_after_migration() {
    // A connection with foreign_keys = ON explicitly set.
    let conn = Connection::open_in_memory().expect("in-memory DB");
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    run_migrations(&conn).expect("migration");
    let fk: i32 = conn
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .unwrap();
    assert_eq!(fk, 1, "PRAGMA foreign_keys must be ON");
}

// ── FK constraint enforcement ─────────────────────────────────────────────────

#[test]
fn fk_prevents_orphan_experiment_data() {
    let conn = migrated_conn();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

    // Attempt to insert ExperimentData without a parent Experiment row.
    let result = conn.execute(
        "INSERT INTO ExperimentData (experimentId, dataBlob, encoding, pointCount, createdAt, updatedAt)
         VALUES ('no-such-id', X'', 'columnar-v1-zstd', 0, datetime('now'), datetime('now'))",
        [],
    );
    assert!(
        result.is_err(),
        "FK constraint must reject orphan ExperimentData"
    );
}

#[test]
fn fk_cascade_delete_removes_experiment_data() {
    let conn = migrated_conn();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

    // Insert a local user (required by Experiment FK).
    conn.execute(
        "INSERT OR IGNORE INTO User (id, role, isActive) VALUES ('test-user', 'admin', 1)",
        [],
    )
    .unwrap();

    let exp_id = "cascade-test-exp-001";

    // Insert parent Experiment.
    conn.execute(
        "INSERT INTO Experiment
            (id, name, originalFilename, testDate, instrumentType, waterSource,
             fluidType, testGroup, metrics, rawPoints, userId, createdAt, updatedAt)
         VALUES (?1, 'Test', 'file.csv', '2025-01-01', 'FANN', 'tap',
                 'water', 'fracturing', '{}', '[]', 'test-user',
                 datetime('now'), datetime('now'))",
        rusqlite::params![exp_id],
    )
    .unwrap();

    // Insert child ExperimentData.
    conn.execute(
        "INSERT INTO ExperimentData (experimentId, dataBlob, encoding, pointCount, createdAt, updatedAt)
         VALUES (?1, X'', 'columnar-v1-zstd', 0, datetime('now'), datetime('now'))",
        rusqlite::params![exp_id],
    )
    .unwrap();

    // Verify child exists.
    let child_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ExperimentData WHERE experimentId = ?1",
            rusqlite::params![exp_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(child_count, 1);

    // Delete parent — child must be removed by CASCADE.
    conn.execute("DELETE FROM Experiment WHERE id = ?1", rusqlite::params![exp_id])
        .unwrap();

    let after_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ExperimentData WHERE experimentId = ?1",
            rusqlite::params![exp_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(after_count, 0, "CASCADE DELETE must remove ExperimentData");
}

// ── UNIQUE constraint enforcement ─────────────────────────────────────────────

#[test]
fn unique_laboratory_name_enforced() {
    let conn = migrated_conn();
    conn.execute(
        "INSERT INTO Laboratory (id, name) VALUES ('lab-1', 'Alpha Lab')",
        [],
    )
    .unwrap();
    let result = conn.execute(
        "INSERT INTO Laboratory (id, name) VALUES ('lab-2', 'Alpha Lab')",
        [],
    );
    assert!(result.is_err(), "UNIQUE(name) on Laboratory must be enforced");
}

#[test]
fn unique_operator_name_enforced() {
    let conn = migrated_conn();
    conn.execute(
        "INSERT INTO Operator (id, name) VALUES ('op-1', 'John Doe')",
        [],
    )
    .unwrap();
    let result = conn.execute(
        "INSERT INTO Operator (id, name) VALUES ('op-2', 'John Doe')",
        [],
    );
    assert!(result.is_err(), "UNIQUE(name) on Operator must be enforced");
}

#[test]
fn unique_reagent_name_enforced() {
    let conn = migrated_conn();
    conn.execute(
        "INSERT INTO ReagentCatalog (id, name, category) VALUES ('r-1', 'Guar Gump', 'polymer')",
        [],
    )
    .unwrap();
    let result = conn.execute(
        "INSERT INTO ReagentCatalog (id, name, category) VALUES ('r-2', 'Guar Gump', 'polymer')",
        [],
    );
    assert!(result.is_err(), "UNIQUE(name) on ReagentCatalog must be enforced");
}

// ── Indexes present ───────────────────────────────────────────────────────────

#[test]
fn critical_indexes_present() {
    let conn = migrated_conn();
    let required_indexes = [
        "idx_experiment_user_created",
        "idx_experiment_lab_created",
        "idx_experiment_dedup",
        "idx_experiment_test_date",
        "idx_apikey_userid",
        "idx_operator_name",
        "idx_experiment_reagent_pair",
    ];
    for index in &required_indexes {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
                rusqlite::params![index],
                |row| row.get(0),
            )
            .unwrap_or(0);
        assert_eq!(count, 1, "index '{index}' must exist");
    }
}

// ── Default data seeded ────────────────────────────────────────────────────────

#[test]
fn default_reagents_seeded_on_fresh_install() {
    let conn = migrated_conn();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM ReagentCatalog", [], |row| row.get(0))
        .unwrap();
    assert!(count > 0, "default reagents must be seeded on fresh install");
}
