//! Touch-point filter tests (PR2 Phase C).

use super::*;
use super::fixtures::*;
use crate::commands::experiments::crud::persist_experiment;
use serde_json::json;

#[test]
fn list_item_exposes_precomputed_touch_point_columns() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    persist_experiment(&conn, &experiment_with_crossing("tp_item_01", 200.0, 10.0)).unwrap();
    drop(conn);

    let (experiments, total) = query_experiments_list_sql(&state, &default_query()).unwrap();
    assert_eq!(total, 1);
    let item = &experiments[0];

    assert_eq!(item.touch_has_crossing, Some(true));
    assert!(
        item.touch_crossing_time_min.is_some(),
        "crossing time must be exposed on the list item"
    );
    assert!(
        item.touch_crossing_viscosity_cp.is_some(),
        "crossing viscosity must be exposed on the list item"
    );
    assert!(
        item.touch_viscosity_at_target_cp.is_some(),
        "target-time viscosity must be exposed on the list item"
    );
    assert_eq!(
        item.touch_precompute_version,
        Some(crate::db::touch_point_precompute::TOUCH_PRECOMPUTE_VERSION),
        "list item must carry the algorithm version so the UI can invalidate"
    );
}

#[test]
fn filter_has_crossing_yes_returns_only_crossing_rows() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    persist_experiment(&conn, &experiment_with_crossing("tp_yes_01", 200.0, 10.0)).unwrap();
    persist_experiment(&conn, &experiment_flat_no_crossing("tp_yes_02", 120.0)).unwrap();
    persist_experiment(&conn, &experiment_with_crossing("tp_yes_03", 180.0, 5.0)).unwrap();
    drop(conn);

    let q = query_with("hasCrossing", "yes");
    let (experiments, total) = query_experiments_list_sql(&state, &q).unwrap();
    assert_eq!(total, 2, "only the two declining curves should match");
    let ids: Vec<&str> = experiments.iter().map(|e| e.id.as_str()).collect();
    assert!(ids.contains(&"tp_yes_01"));
    assert!(ids.contains(&"tp_yes_03"));
    assert!(!ids.contains(&"tp_yes_02"));
}

#[test]
fn filter_has_crossing_no_returns_only_flat_rows() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    persist_experiment(&conn, &experiment_with_crossing("tp_no_01", 200.0, 10.0)).unwrap();
    persist_experiment(&conn, &experiment_flat_no_crossing("tp_no_02", 120.0)).unwrap();
    drop(conn);

    let q = query_with("hasCrossing", "no");
    let (experiments, total) = query_experiments_list_sql(&state, &q).unwrap();
    assert_eq!(total, 1);
    assert_eq!(experiments[0].id, "tp_no_02");
}

#[test]
fn filter_has_crossing_ignores_unknown_tokens() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    persist_experiment(&conn, &experiment_with_crossing("tp_ign_01", 200.0, 10.0)).unwrap();
    persist_experiment(&conn, &experiment_flat_no_crossing("tp_ign_02", 120.0)).unwrap();
    drop(conn);

    // "maybe" is not a recognised token — filter must not be applied.
    let q = query_with("hasCrossing", "maybe");
    let (experiments, total) = query_experiments_list_sql(&state, &q).unwrap();
    assert_eq!(total, 2);
    assert_eq!(experiments.len(), 2);
}

#[test]
fn filter_crossing_time_range_narrows_results() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    // Slower decline crosses 50 cP near the 10-min mark.
    persist_experiment(
        &conn,
        &experiment_with_crossing("tp_time_slow", 200.0, 10.0),
    )
    .unwrap();
    // Steeper decline crosses 50 cP much earlier (~3 min).
    persist_experiment(&conn, &experiment_with_crossing("tp_time_fast", 80.0, 5.0)).unwrap();
    // Flat curve — no crossing — must always be excluded by a time range.
    persist_experiment(&conn, &experiment_flat_no_crossing("tp_time_flat", 120.0)).unwrap();
    drop(conn);

    // Narrow range inside the slower decline's crossing minute.
    let q: ExperimentsListQuery = serde_json::from_value(json!({
        "crossingTimeMin": "5",
        "crossingTimeMax": "12",
    }))
    .unwrap();
    let (experiments, total) = query_experiments_list_sql(&state, &q).unwrap();
    assert!(
        total >= 1,
        "at least the slow decline must land inside 5..12 min"
    );
    let ids: Vec<&str> = experiments.iter().map(|e| e.id.as_str()).collect();
    assert!(ids.contains(&"tp_time_slow"));
    assert!(
        !ids.contains(&"tp_time_flat"),
        "flat curves must never match a crossing-time range"
    );
}

#[test]
fn filter_crossing_viscosity_range_narrows_results() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    persist_experiment(
        &conn,
        &experiment_with_crossing("tp_vcross_01", 200.0, 10.0),
    )
    .unwrap();
    persist_experiment(&conn, &experiment_flat_no_crossing("tp_vcross_flat", 500.0)).unwrap();
    drop(conn);

    // Crossing viscosity lands near 50 cP by construction — wrap it.
    let q: ExperimentsListQuery = serde_json::from_value(json!({
        "crossingViscosityMin": "30",
        "crossingViscosityMax": "80",
    }))
    .unwrap();
    let (experiments, total) = query_experiments_list_sql(&state, &q).unwrap();
    assert_eq!(total, 1, "only the declining curve should match this range");
    assert_eq!(experiments[0].id, "tp_vcross_01");
}

#[test]
fn filter_viscosity_at_target_range_narrows_results() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    // Flat 500 cP curve at 10 min — viscosity_at_target ≈ 500.
    persist_experiment(&conn, &experiment_flat_no_crossing("tp_target_high", 500.0)).unwrap();
    // Flat 120 cP curve at 10 min — viscosity_at_target ≈ 120.
    persist_experiment(&conn, &experiment_flat_no_crossing("tp_target_low", 120.0)).unwrap();
    drop(conn);

    let q: ExperimentsListQuery = serde_json::from_value(json!({
        "viscosityAtTargetMin": "400",
        "viscosityAtTargetMax": "600",
    }))
    .unwrap();
    let (experiments, total) = query_experiments_list_sql(&state, &q).unwrap();
    assert_eq!(total, 1, "only the 500 cP flat curve should match");
    assert_eq!(experiments[0].id, "tp_target_high");
}

#[test]
fn filter_combines_touch_point_with_other_filters() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    // Both rows have a crossing; the waterSource is different.
    let mut exp_a = experiment_with_crossing("tp_combo_01", 200.0, 10.0);
    exp_a.water_source = "Lake 274".to_string();
    let mut exp_b = experiment_with_crossing("tp_combo_02", 200.0, 10.0);
    exp_b.water_source = "River".to_string();
    persist_experiment(&conn, &exp_a).unwrap();
    persist_experiment(&conn, &exp_b).unwrap();
    drop(conn);

    let q: ExperimentsListQuery = serde_json::from_value(json!({
        "hasCrossing": "yes",
        "waterSource": "Lake 274",
    }))
    .unwrap();
    let (experiments, total) = query_experiments_list_sql(&state, &q).unwrap();
    assert_eq!(
        total, 1,
        "hasCrossing + waterSource filters must AND together"
    );
    assert_eq!(experiments[0].id, "tp_combo_01");
}

#[test]
fn filter_pending_backfill_rows_are_excluded_by_touch_point_range() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    // Save a row, then simulate pre-v0002 state by clearing its precompute
    // columns.  A subsequent range filter must NOT pick this row up — the
    // backfill task is responsible for filling it in.
    persist_experiment(
        &conn,
        &experiment_with_crossing("tp_pending_01", 200.0, 10.0),
    )
    .unwrap();
    // Simulate pre-v0002 / pre-v0003 state: clear BOTH legacy columns
    // (v0002 schema) AND the v0003 side-table rows.  The backfill task
    // is responsible for (re)populating everything on next launch.
    conn.execute(
        "UPDATE Experiment SET touchHasCrossing = NULL, touchCrossingTimeMin = NULL, \
         touchCrossingViscosityCp = NULL, touchViscosityAtTargetCp = NULL, \
         touchPrecomputeVersion = NULL WHERE id = 'tp_pending_01'",
        [],
    )
    .unwrap();
    conn.execute(
        "DELETE FROM TouchPointPrecompute WHERE experimentId = 'tp_pending_01'",
        [],
    )
    .unwrap();
    drop(conn);

    let q: ExperimentsListQuery = serde_json::from_value(json!({
        "crossingTimeMin": "0",
        "crossingTimeMax": "60",
    }))
    .unwrap();
    let (experiments, total) = query_experiments_list_sql(&state, &q).unwrap();
    assert_eq!(
        total, 0,
        "pending-backfill rows must be hidden by a touch-point range filter"
    );
    assert!(experiments.is_empty());
}
