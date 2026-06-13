#[cfg(test)]
use super::conflicts::CONFLICT_STATUSES;
#[cfg(test)]
use super::helpers::*;
#[cfg(test)]
use super::sync::{INBOX_STATUSES, OUTBOX_STATUSES};

#[cfg(test)]
use rusqlite::{params, Connection};

#[test]
fn import_batch_lifecycle() {
    let conn = setup_test_db();

    let batch_id = create_import_batch(
        &conn,
        Some("lab-001"),
        Some("RheoLab"),
        Some("2.0.0"),
        Some("admin"),
        Some("export.json"),
        None,
    )
    .unwrap();

    assert!(!batch_id.is_empty());

    finalise_import_batch(&conn, &batch_id, 5, 2, "completed").unwrap();

    let row: (i64, i64, String) = conn
        .query_row(
            "SELECT experimentsImported, duplicatesDetected, status FROM ImportBatch WHERE id = ?1",
            params![batch_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();

    assert_eq!(row.0, 5);
    assert_eq!(row.1, 2);
    assert_eq!(row.2, "completed");
}

fn insert_test_user(conn: &Connection) {
    conn.execute(
        "INSERT OR IGNORE INTO User (id, email, name) VALUES ('admin', 'admin@test', 'Admin')",
        [],
    )
    .unwrap();
}

fn insert_test_experiment(conn: &Connection, id: &str) {
    insert_test_user(conn);
    conn.execute(
        &format!(
            "INSERT INTO Experiment (id, name, originalFilename, testDate, instrumentType, \
             waterSource, fluidType, testGroup, metrics, rawPoints, userId, \
             maxViscosity, createdAt, updatedAt) \
             VALUES ('{}', 'Test', 'file.csv', '2025-01-01', 'OFITE', 'tap', 'Linear', \
             'Rheology', '{{}}', '[]', 'admin', 100, '2025-01-01', '2025-01-01')",
            id
        ),
        [],
    )
    .unwrap();
}

fn setup_test_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
    crate::db::migration::run_migrations(&conn).unwrap();
    conn
}

#[test]
fn experiment_payload_versioning() {
    let conn = setup_test_db();
    insert_test_experiment(&conn, "exp1");

    let id1 = create_experiment_payload(
        &conn,
        ExperimentPayloadInsert {
            experiment_id: "exp1",
            import_batch_id: None,
            payload_json: r#"{"version":1}"#,
            source_lab_id: None,
            source_system: None,
            source_app_version: None,
            is_canonical: true,
        },
    )
    .unwrap();
    let id2 = create_experiment_payload(
        &conn,
        ExperimentPayloadInsert {
            experiment_id: "exp1",
            import_batch_id: None,
            payload_json: r#"{"version":2}"#,
            source_lab_id: None,
            source_system: None,
            source_app_version: None,
            is_canonical: false,
        },
    )
    .unwrap();

    assert_ne!(id1, id2);

    let v2: i64 = conn
        .query_row(
            "SELECT payloadVersion FROM ExperimentPayload WHERE id = ?1",
            params![id2],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(v2, 2);
}

#[test]
fn parser_artifact_creation() {
    let conn = setup_test_db();
    insert_test_experiment(&conn, "exp2");

    let id =
        create_parser_artifact(&conn, "exp2", None, "1.0.0", "v1", r#"{"points":[]}"#).unwrap();

    let fp: String = conn
        .query_row(
            "SELECT contentFingerprint FROM ParserArtifact WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .unwrap();

    assert_eq!(fp, content_fingerprint(r#"{"points":[]}"#));
}

#[test]
fn sync_outbox_append() {
    let conn = setup_test_db();

    let id =
        append_sync_outbox(&conn, "experiment", "exp1", "create", r#"{"name":"Test"}"#).unwrap();

    let (status, retry): (String, i64) = conn
        .query_row(
            "SELECT status, retryCount FROM SyncOutbox WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert_eq!(status, "pending");
    assert_eq!(retry, 0);
}

#[test]
fn search_projection_log() {
    let conn = setup_test_db();
    insert_test_experiment(&conn, "exp1");

    log_search_projection(
        &conn,
        Some("exp1"),
        "upsert",
        "v1",
        Some(r#"{"fields":["name"]}"#),
    )
    .unwrap();

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM SearchProjectionLog", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn report_artifact_creation() {
    let conn = setup_test_db();
    insert_test_experiment(&conn, "exp3");

    let id = create_report_artifact(
        &conn,
        ReportArtifactInsert {
            experiment_id: "exp3",
            import_batch_id: None,
            report_type: "pdf",
            template_version: Some("1.0"),
            settings_json: None,
            storage_path: Some("/reports/exp3.pdf"),
            binary_sha256: Some("abc123"),
            size_bytes: Some(102400),
        },
    )
    .unwrap();

    let (rt, sz): (String, i64) = conn
        .query_row(
            "SELECT reportType, sizeBytes FROM ReportArtifact WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();

    assert_eq!(rt, "pdf");
    assert_eq!(sz, 102400);
}

// ---------------------------------------------------------------------------
// B.4 — IPC input validation
// ---------------------------------------------------------------------------

#[test]
fn conflict_statuses_contains_expected_values() {
    assert!(CONFLICT_STATUSES.contains(&"open"));
    assert!(CONFLICT_STATUSES.contains(&"resolved"));
    assert!(!CONFLICT_STATUSES.contains(&"unknown"));
    assert!(!CONFLICT_STATUSES.contains(&""));
}

#[test]
fn outbox_statuses_contains_expected_values() {
    assert!(OUTBOX_STATUSES.contains(&"pending"));
    assert!(OUTBOX_STATUSES.contains(&"failed"));
    assert!(OUTBOX_STATUSES.contains(&"synced"));
    assert!(!OUTBOX_STATUSES.contains(&"unknown"));
    assert!(!OUTBOX_STATUSES.contains(&""));
}

#[test]
fn inbox_statuses_contains_expected_values() {
    assert!(INBOX_STATUSES.contains(&"pending"));
    assert!(INBOX_STATUSES.contains(&"processed"));
    assert!(INBOX_STATUSES.contains(&"failed"));
    assert!(!INBOX_STATUSES.contains(&"unknown"));
    assert!(!INBOX_STATUSES.contains(&""));
}
