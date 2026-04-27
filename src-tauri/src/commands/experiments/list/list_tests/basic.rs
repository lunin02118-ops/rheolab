//! Basic CRUD, pagination, and simple filter tests.

use super::*;
use super::fixtures::*;
use crate::commands::experiments::crud::persist_experiment;
use serde_json::json;

#[test]
fn empty_db_returns_zero_results() {
    let state = make_test_state();
    let (experiments, total) = query_experiments_list_sql(&state, &default_query()).unwrap();
    assert_eq!(total, 0);
    assert!(experiments.is_empty());
}

#[test]
fn inserted_experiment_is_returned() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    let exp = minimal_experiment("exp_list_01", Some("Mamontovskoe"), "Lake 274");
    persist_experiment(&conn, &exp).unwrap();
    drop(conn);

    let (experiments, total) = query_experiments_list_sql(&state, &default_query()).unwrap();
    assert_eq!(total, 1);
    assert_eq!(experiments[0].id, "exp_list_01");
}

#[test]
fn list_returns_correct_total_for_multiple_experiments() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    for i in 0..5 {
        let exp = minimal_experiment(&format!("exp_{:02}", i), None, "River");
        persist_experiment(&conn, &exp).unwrap();
    }
    drop(conn);

    let (_, total) = query_experiments_list_sql(&state, &default_query()).unwrap();
    assert_eq!(total, 5);
}

// ── pagination ────────────────────────────────────────────────────────────

#[test]
fn pagination_limit_restricts_page_size() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    for i in 0..8 {
        let exp = minimal_experiment(&format!("page_{:02}", i), None, "Well");
        persist_experiment(&conn, &exp).unwrap();
    }
    drop(conn);

    let query: ExperimentsListQuery =
        serde_json::from_value(json!({ "page": 1, "limit": 3 })).unwrap();
    let (experiments, total) = query_experiments_list_sql(&state, &query).unwrap();
    assert_eq!(total, 8, "total should reflect all 8 rows");
    assert_eq!(experiments.len(), 3, "page size should be capped at limit");
}

#[test]
fn pagination_second_page_returns_remaining_rows() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    for i in 0..5 {
        let exp = minimal_experiment(&format!("pg2_{:02}", i), None, "Well");
        persist_experiment(&conn, &exp).unwrap();
    }
    drop(conn);

    let q2: ExperimentsListQuery =
        serde_json::from_value(json!({ "page": 2, "limit": 3 })).unwrap();
    let (experiments, _) = query_experiments_list_sql(&state, &q2).unwrap();
    assert_eq!(
        experiments.len(),
        2,
        "second page should have 2 remaining rows"
    );
}

// ── field-name filter ────────────────────────────────────────────────────

#[test]
fn filter_by_field_name_returns_matching_rows_only() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    persist_experiment(
        &conn,
        &minimal_experiment("fn_a", Some("Mamontovskoe"), "Lake"),
    )
    .unwrap();
    persist_experiment(
        &conn,
        &minimal_experiment("fn_b", Some("Priobskoe"), "River"),
    )
    .unwrap();
    drop(conn);

    let query = query_with("fieldName", "Mamontovskoe");
    let (experiments, total) = query_experiments_list_sql(&state, &query).unwrap();
    assert_eq!(total, 1);
    assert_eq!(experiments[0].id, "fn_a");
}

// ── water source filter ───────────────────────────────────────────────────

#[test]
fn filter_by_water_source_returns_matching_rows_only() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    persist_experiment(&conn, &minimal_experiment("ws_a", None, "Lake 274")).unwrap();
    persist_experiment(&conn, &minimal_experiment("ws_b", None, "River")).unwrap();
    drop(conn);

    let query = query_with("waterSource", "Lake 274");
    let (experiments, total) = query_experiments_list_sql(&state, &query).unwrap();
    assert_eq!(total, 1);
    assert_eq!(experiments[0].id, "ws_a");
}

// ── filter-metadata cache ────────────────────────────────────────────────

#[test]
fn invalidate_cache_does_not_panic() {
    // Simple smoke test — should never panic
    invalidate_filter_metadata_cache();
    invalidate_filter_metadata_cache();
}
