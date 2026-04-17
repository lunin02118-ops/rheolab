use super::*;
use crate::commands::experiments::crud::persist_experiment;
use crate::state::AppState;
use serde_json::json;
use uuid::Uuid;

/// Create an isolated AppState backed by a temporary file database.
/// Each call returns a state with a unique DB so tests don't interfere.
fn make_test_state() -> AppState {
    let dir = std::env::temp_dir()
        .join(format!("rheolab_list_test_{}", Uuid::new_v4().to_string().replace('-', "")));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("test.db");
    let pool = crate::db::create_pool(&db_path).unwrap();
    let migration_result = {
        let conn = pool.get().unwrap();
        crate::db::migration::run_migrations(&conn).unwrap()
    };
    AppState {
        database_path: db_path,
        backups_dir: dir.join("backups"),
        app_data_dir: dir,
        db_pool: pool,
        license_engine: None,
        migration_result,
    }
}

fn minimal_experiment(id: &str, field: Option<&str>, water: &str) -> StoredExperiment {
    StoredExperiment {
        id: id.to_string(),
        created_at: "2024-01-01T10:00:00Z".to_string(),
        updated_at: "2024-01-01T10:00:00Z".to_string(),
        name: format!("Test {}", id),
        field_name: field.map(|s| s.to_string()),
        operator_name: None,
        well_number: None,
        test_id: None,
        original_filename: format!("{}.xlsx", id),
        test_date: "2024-01-01".to_string(),
        instrument_type: "BSL R1".to_string(),
        geometry: None,
        geometry_source: None,
        water_source: water.to_string(),
        water_params: None,
        fluid_type: "Linear".to_string(),
        test_group: "Test".to_string(),
        test_sub_group: None,
        metrics: json!({}),
        raw_points: vec![],
        calibration: None,
        reagents: vec![],
        max_viscosity: None,
        avg_viscosity: None,
        user: None,
        laboratory: None,
        parsed_by: None,
        parse_source: None,
        time_range_min: None,
        time_range_max: None,
        viscosity_min: None,
        pressure_max: None,
        extra_fields: None,
        test_category: None,
        test_type: None,
        dominant_pattern: None,
    }
}

fn default_query() -> ExperimentsListQuery {
    serde_json::from_value(json!({})).unwrap()
}

fn query_with(key: &str, val: &str) -> ExperimentsListQuery {
    serde_json::from_value(json!({ key: val })).unwrap()
}

// ── basic list queries ────────────────────────────────────────────────────

#[test]
fn empty_db_returns_zero_results() {
    let state = make_test_state();
    let (experiments, total) =
        query_experiments_list_sql(&state, &default_query()).unwrap();
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

    let (experiments, total) =
        query_experiments_list_sql(&state, &default_query()).unwrap();
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
    assert_eq!(experiments.len(), 2, "second page should have 2 remaining rows");
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
    persist_experiment(&conn, &minimal_experiment("fn_b", Some("Priobskoe"), "River")).unwrap();
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
