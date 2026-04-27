//! Integration tests: IPC / repository layer contracts.
//!
//! Verifies that the data-access layer respects its contracts on both
//! the happy path and the negative/edge-case paths — without starting Tauri.
//!
//! These tests catch regressions where a refactoring changes the behaviour of
//! core repository operations (save/find/delete/duplicate detection).
//!
//!   cargo test --test ipc_contracts -- --nocapture

use rheolab_enterprise::commands::experiments::types::StoredExperiment;
use rheolab_enterprise::db::migration::run_migrations;
use rheolab_enterprise::db::repositories::experiments::{
    ExperimentRepository, SqliteExperimentRepository,
};
use rusqlite::Connection;
use serde_json::json;

// ── Test helpers ──────────────────────────────────────────────────────────────

fn migrated_conn() -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory DB");
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    run_migrations(&conn).expect("migration");
    conn
}

/// Insert a minimal User row so experiments can satisfy the FK constraint.
fn insert_test_user(conn: &Connection, user_id: &str) {
    conn.execute(
        "INSERT OR IGNORE INTO User (id, role, isActive) VALUES (?1, 'admin', 1)",
        rusqlite::params![user_id],
    )
    .unwrap();
}

/// Build a minimal `StoredExperiment` sufficient for persistence tests.
fn minimal_experiment(id: &str, user_id: &str) -> StoredExperiment {
    StoredExperiment {
        id: id.to_string(),
        created_at: "2025-01-01T00:00:00Z".to_string(),
        updated_at: "2025-01-01T00:00:00Z".to_string(),
        name: format!("Test Experiment {id}"),
        field_name: None,
        operator_name: None,
        well_number: None,
        test_id: None,
        original_filename: format!("{id}.csv"),
        test_date: "2025-01-01".to_string(),
        instrument_type: "FANN".to_string(),
        geometry: None,
        geometry_source: None,
        water_source: "tap".to_string(),
        water_params: None,
        fluid_type: "water".to_string(),
        test_group: "fracturing".to_string(),
        test_sub_group: None,
        test_category: None,
        test_type: None,
        dominant_pattern: None,
        metrics: json!({}),
        raw_points: vec![],
        calibration: None,
        reagents: vec![],
        max_viscosity: None,
        avg_viscosity: None,
        user: Some(
            rheolab_enterprise::commands::experiments::types::StoredExperimentUser {
                id: user_id.to_string(),
                name: "Test User".to_string(),
                email: None,
            },
        ),
        laboratory: None,
        parsed_by: None,
        parse_source: None,
        time_range_min: None,
        time_range_max: None,
        viscosity_min: None,
        pressure_max: None,
        extra_fields: None,
    }
}

// ── find_by_id ────────────────────────────────────────────────────────────────

#[test]
fn find_by_id_unknown_returns_none() {
    let conn = migrated_conn();
    let repo = SqliteExperimentRepository;
    let result = repo
        .find_by_id(&conn, "00000000-0000-0000-0000-000000000000")
        .expect("find_by_id must not error for unknown id");
    assert!(result.is_none(), "unknown id must return None");
}

#[test]
fn find_by_id_empty_string_returns_none() {
    let conn = migrated_conn();
    let repo = SqliteExperimentRepository;
    let result = repo
        .find_by_id(&conn, "")
        .expect("find_by_id must not panic on empty string");
    assert!(result.is_none(), "empty id must return None");
}

// ── find_duplicate ────────────────────────────────────────────────────────────

#[test]
fn find_duplicate_no_match_returns_none() {
    let conn = migrated_conn();
    let repo = SqliteExperimentRepository;
    let result = repo
        .find_duplicate(&conn, "nonexistent.csv", "2025-01-01", "No Such Experiment")
        .expect("find_duplicate must not error when no match");
    assert!(result.is_none());
}

#[test]
fn find_duplicate_empty_inputs_returns_none() {
    let conn = migrated_conn();
    let repo = SqliteExperimentRepository;
    let result = repo
        .find_duplicate(&conn, "", "", "")
        .expect("find_duplicate must not panic on empty strings");
    assert!(result.is_none());
}

// ── delete ────────────────────────────────────────────────────────────────────

#[test]
fn delete_unknown_id_returns_false() {
    let conn = migrated_conn();
    let repo = SqliteExperimentRepository;
    let deleted = repo
        .delete(&conn, "00000000-dead-beef-0000-000000000000")
        .expect("delete must not error for unknown id");
    assert!(!deleted, "delete of non-existent id must return false");
}

// ── save → find roundtrip ─────────────────────────────────────────────────────

#[test]
fn save_and_find_roundtrip() {
    let conn = migrated_conn();
    let repo = SqliteExperimentRepository;
    let user_id = "local-admin";
    insert_test_user(&conn, user_id);

    let exp = minimal_experiment("exp-roundtrip-001", user_id);
    repo.save(&conn, &exp).expect("save must succeed");

    let found = repo
        .find_by_id(&conn, "exp-roundtrip-001")
        .expect("find_by_id after save must not error");

    assert!(found.is_some(), "saved experiment must be retrievable");
    let found = found.unwrap();
    assert_eq!(found.id, "exp-roundtrip-001");
    assert_eq!(found.name, exp.name);
    assert_eq!(found.instrument_type, "FANN");
    assert_eq!(found.water_source, "tap");
}

#[test]
fn save_is_upsert_not_duplicate() {
    let conn = migrated_conn();
    let repo = SqliteExperimentRepository;
    let user_id = "local-admin";
    insert_test_user(&conn, user_id);

    let mut exp = minimal_experiment("exp-upsert-001", user_id);
    repo.save(&conn, &exp).expect("first save");

    // Update the name and save again — must not create a duplicate row.
    exp.name = "Updated Name".to_string();
    repo.save(&conn, &exp).expect("second save (upsert)");

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM Experiment WHERE id = 'exp-upsert-001'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "upsert must not create a duplicate row");

    let found = repo.find_by_id(&conn, "exp-upsert-001").unwrap().unwrap();
    assert_eq!(found.name, "Updated Name", "upsert must update the name");
}

#[test]
fn delete_existing_returns_true() {
    let conn = migrated_conn();
    let repo = SqliteExperimentRepository;
    let user_id = "local-admin";
    insert_test_user(&conn, user_id);

    let exp = minimal_experiment("exp-delete-001", user_id);
    repo.save(&conn, &exp).expect("save");

    let deleted = repo.delete(&conn, "exp-delete-001").expect("delete");
    assert!(deleted, "delete of existing id must return true");

    let found = repo
        .find_by_id(&conn, "exp-delete-001")
        .expect("find after delete");
    assert!(found.is_none(), "deleted experiment must not be findable");
}

// ── duplicate detection ───────────────────────────────────────────────────────

#[test]
fn find_duplicate_detects_existing_experiment() {
    let conn = migrated_conn();
    let repo = SqliteExperimentRepository;
    let user_id = "local-admin";
    insert_test_user(&conn, user_id);

    let exp = minimal_experiment("exp-dup-001", user_id);
    repo.save(&conn, &exp).expect("save");

    // Duplicate detection uses (originalFilename, testDate, name).
    let dup = repo.find_duplicate(&conn, &exp.original_filename, &exp.test_date, &exp.name);
    assert!(dup.is_ok());
    let dup = dup.unwrap();
    assert!(dup.is_some(), "duplicate must be detected after save");
    let (dup_id, _created_at) = dup.unwrap();
    assert_eq!(dup_id, "exp-dup-001");
}

#[test]
fn find_duplicate_no_false_positive_different_name() {
    let conn = migrated_conn();
    let repo = SqliteExperimentRepository;
    let user_id = "local-admin";
    insert_test_user(&conn, user_id);

    let exp = minimal_experiment("exp-dup-002", user_id);
    repo.save(&conn, &exp).expect("save");

    // Same file + date but DIFFERENT name — must not be a duplicate.
    let result = repo
        .find_duplicate(
            &conn,
            &exp.original_filename,
            &exp.test_date,
            "Completely Different Name",
        )
        .expect("find_duplicate");
    assert!(
        result.is_none(),
        "different name must not trigger duplicate detection"
    );
}
