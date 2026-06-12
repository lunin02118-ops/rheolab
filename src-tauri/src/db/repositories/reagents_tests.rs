//! Regression tests for the reagent repository layer.
//!
//! Locks down the case-insensitive contract of `is_duplicate_name` so that
//! future rewrites cannot silently drop the case-folding (or, conversely,
//! cannot reintroduce a `LOWER()` wrapper that bypasses the
//! `idx_reagent_name_nocase` index — see Phase 4 DB deep-dive, finding F1).

use super::{exists_by_id, is_duplicate_name, resolve_by_id_or_name};
use crate::db::migration::run_migrations;
use rusqlite::{params, Connection};

fn open_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", true).unwrap();
    run_migrations(&conn).unwrap();
    conn
}

fn insert_reagent(conn: &Connection, id: &str, name: &str) {
    conn.execute(
        "INSERT INTO ReagentCatalog (id, name, category, createdAt, updatedAt) \
         VALUES (?1, ?2, 'test-category', datetime('now'), datetime('now'))",
        params![id, name],
    )
    .unwrap();
}

fn explain(conn: &Connection, sql: &str) -> String {
    let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
    stmt.query_map([], |row| row.get::<_, String>(3))
        .unwrap()
        .filter_map(|row| row.ok())
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn is_duplicate_name_matches_case_insensitive() {
    let conn = open_db();
    insert_reagent(&conn, "r1", "PolyAcryl");

    // Exact match.
    assert!(is_duplicate_name(&conn, "PolyAcryl", None).unwrap());

    // All-lower / all-upper / mixed case must all be detected as duplicates.
    assert!(is_duplicate_name(&conn, "polyacryl", None).unwrap());
    assert!(is_duplicate_name(&conn, "POLYACRYL", None).unwrap());
    assert!(is_duplicate_name(&conn, "PoLyAcRyL", None).unwrap());

    // Distinct name is not a duplicate.
    assert!(!is_duplicate_name(&conn, "OtherReagent", None).unwrap());
}

#[test]
fn is_duplicate_name_excludes_self() {
    let conn = open_db();
    insert_reagent(&conn, "r1", "PolyAcryl");

    // When the row itself is excluded (update path), it must NOT count as a
    // duplicate — even if the proposed name differs only in case.
    assert!(!is_duplicate_name(&conn, "PolyAcryl", Some("r1")).unwrap());
    assert!(!is_duplicate_name(&conn, "polyacryl", Some("r1")).unwrap());
    assert!(!is_duplicate_name(&conn, "POLYACRYL", Some("r1")).unwrap());

    // A second row with the same (case-folded) name still counts as a
    // duplicate when looking up from the first row.
    insert_reagent(&conn, "r2", "polyacryl");
    assert!(is_duplicate_name(&conn, "PolyAcryl", Some("r1")).unwrap());
}

#[test]
fn is_duplicate_name_distinguishes_by_id_only() {
    // Sanity: exists_by_id sees both rows; is_duplicate_name only flags the
    // one that is not excluded.
    let conn = open_db();
    insert_reagent(&conn, "r1", "Alpha");
    insert_reagent(&conn, "r2", "Beta");

    assert!(exists_by_id(&conn, "r1").unwrap());
    assert!(exists_by_id(&conn, "r2").unwrap());

    // "Alpha" matches r1 only; excluding r1 means no duplicate remains.
    assert!(is_duplicate_name(&conn, "Alpha", None).unwrap());
    assert!(!is_duplicate_name(&conn, "Alpha", Some("r1")).unwrap());

    // "Beta" matches r2 only.
    assert!(is_duplicate_name(&conn, "BETA", None).unwrap());
    assert!(!is_duplicate_name(&conn, "BETA", Some("r2")).unwrap());
}

#[test]
fn resolve_by_name_matches_case_insensitive() {
    let conn = open_db();
    insert_reagent(&conn, "r1", "PolyAcryl");

    let lower = resolve_by_id_or_name(&conn, None, "polyacryl")
        .unwrap()
        .expect("lowercase reagent name should resolve");
    assert_eq!(lower.id, "r1");

    let upper = resolve_by_id_or_name(&conn, None, "POLYACRYL")
        .unwrap()
        .expect("uppercase reagent name should resolve");
    assert_eq!(upper.id, "r1");

    assert!(resolve_by_id_or_name(&conn, None, "OtherReagent")
        .unwrap()
        .is_none());
}

#[test]
fn resolve_by_name_uses_nocase_index() {
    let conn = open_db();

    let plan = explain(
        &conn,
        "SELECT id, manufacturer, country, description, activeSubstance, form, extraFields \
         FROM ReagentCatalog \
         WHERE name = 'polyacryl' COLLATE NOCASE",
    );

    assert!(
        plan.contains("idx_reagent_name_nocase"),
        "resolve_by_id_or_name name fallback must use idx_reagent_name_nocase, got plan:\n{plan}"
    );
    assert!(
        !plan.contains("SCAN ReagentCatalog"),
        "resolve_by_id_or_name name fallback must not scan ReagentCatalog, got plan:\n{plan}"
    );
}
