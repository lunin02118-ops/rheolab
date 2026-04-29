//! Basic CRUD, pagination, and simple filter tests.

use super::fixtures::*;
use super::*;
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

#[test]
fn projection_and_legacy_default_filter_results_match() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    persist_experiment(
        &conn,
        &minimal_experiment("parity_a", Some("Mamontovskoe"), "Lake"),
    )
    .unwrap();
    persist_experiment(
        &conn,
        &minimal_experiment("parity_b", Some("Priobskoe"), "River"),
    )
    .unwrap();

    // Force the public list function onto its legacy fallback path.
    conn.execute("DELETE FROM ExperimentListProjection", [])
        .unwrap();
    let query = query_with("fieldName", "Mamontovskoe");
    let (legacy_rows, legacy_total) = query_experiments_list_sql(&state, &query).unwrap();

    crate::db::repositories::experiment_projection::rebuild_projection_batch(&conn, None, 100)
        .unwrap();
    let (projection_rows, projection_total) = query_experiments_list_sql(&state, &query).unwrap();

    assert_eq!(legacy_total, projection_total);
    assert_eq!(
        legacy_rows.iter().map(|row| &row.id).collect::<Vec<_>>(),
        projection_rows
            .iter()
            .map(|row| &row.id)
            .collect::<Vec<_>>()
    );
}

#[test]
#[ignore = "manual Sprint 5 DB-level projection microbench"]
fn bench_library_projection_1k_synthetic() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    for i in 0..1_000 {
        let mut exp = minimal_experiment(
            &format!("bench_projection_{i:04}"),
            Some(if i % 2 == 0 { "North" } else { "South" }),
            if i % 3 == 0 { "Brine" } else { "Fresh" },
        );
        exp.test_date = format!("2026-04-{:02}", (i % 28) + 1);
        exp.instrument_type = if i % 2 == 0 { "Grace" } else { "BSL R1" }.to_string();
        exp.fluid_type = if i % 4 == 0 { "Crosslinked" } else { "Linear" }.to_string();
        persist_experiment(&conn, &exp).unwrap();
    }

    let query: ExperimentsListQuery =
        serde_json::from_value(json!({ "page": 1, "limit": 100, "fieldName": "North" })).unwrap();

    conn.execute("DELETE FROM ExperimentListProjection", [])
        .unwrap();
    let legacy_started = std::time::Instant::now();
    let (legacy_rows, legacy_total) = query_experiments_list_sql(&state, &query).unwrap();
    let legacy_ms = legacy_started.elapsed().as_millis();

    let mut after_id = None;
    loop {
        let batch = crate::db::repositories::experiment_projection::rebuild_projection_batch(
            &conn,
            after_id.as_deref(),
            250,
        )
        .unwrap();
        after_id = batch.last_experiment_id;
        if !batch.has_more {
            break;
        }
    }
    crate::db::repositories::experiment_projection::mark_full_rebuild_complete(&conn).unwrap();
    let facet_started = std::time::Instant::now();
    let facet_rows =
        crate::db::repositories::experiment_projection::rebuild_facet_cache(&conn).unwrap();
    let facet_rebuild_ms = facet_started.elapsed().as_millis();

    let projection_started = std::time::Instant::now();
    let (projection_rows, projection_total) = query_experiments_list_sql(&state, &query).unwrap();
    let projection_ms = projection_started.elapsed().as_millis();

    assert_eq!(legacy_total, projection_total);
    assert_eq!(legacy_rows.len(), projection_rows.len());

    eprintln!(
        "SPRINT5_PROJECTION_BENCH n=1000 filter=fieldName:North legacy_ms={} projection_ms={} facet_rebuild_ms={} facet_rows={}",
        legacy_ms, projection_ms, facet_rebuild_ms, facet_rows.facet_rows
    );
}

// ── filter-metadata cache ────────────────────────────────────────────────

#[test]
fn invalidate_cache_does_not_panic() {
    // Simple smoke test — should never panic
    invalidate_filter_metadata_cache();
    invalidate_filter_metadata_cache();
}
