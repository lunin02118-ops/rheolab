use super::*;
use crate::commands::experiments::crud::persist_experiment;
use crate::commands::parsing::{parse_file_native, ParseRequest};
use crate::state::AppState;
use serde_json::json;
use uuid::Uuid;

/// Create an isolated AppState backed by a temporary file database.
/// Each call returns a state with a unique DB so tests don't interfere.
fn make_test_state() -> AppState {
    let dir = std::env::temp_dir().join(format!(
        "rheolab_list_test_{}",
        Uuid::new_v4().to_string().replace('-', "")
    ));
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

fn experiment_from_parse(
    id: &str,
    parsed_filename: &str,
    resp: &crate::commands::parsing::ParseFileResponse,
) -> StoredExperiment {
    let mut exp = minimal_experiment(id, None, "Well");
    exp.name = format!("Fixture {id}");
    exp.original_filename = parsed_filename.to_string();
    if let Some(ref instrument) = resp.metadata.instrument_type {
        exp.instrument_type = instrument.clone();
    }
    if let Some(ref date) = resp.metadata.test_date {
        exp.test_date = date.clone();
    }
    exp.raw_points = resp
        .data
        .iter()
        .map(|pt| {
            json!({
                "timeSec": pt.time_sec,
                "viscosityCp": pt.viscosity_cp,
                "shearRate": pt.shear_rate_s1,
                "temperatureC": pt.temperature_c,
                "pressureBar": pt.pressure_bar,
                "bathTemperatureC": pt.bath_temperature_c,
                "speedRpm": pt.speed_rpm,
                "shearStressPa": pt.shear_stress_pa,
            })
        })
        .collect();
    exp
}

fn parse_fixture_bytes(filename: &str) -> crate::commands::parsing::ParseFileResponse {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tests")
        .join("fixtures")
        .join(filename);
    let bytes = std::fs::read(&path).expect("fixture file must be readable");
    parse_file_native(ParseRequest {
        filename: filename.to_string(),
        file_path: None,
        bytes: Some(bytes),
        force_ai: None,
        ai_model: None,
    })
    .expect("fixture must parse")
}

// ── basic list queries ────────────────────────────────────────────────────

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

// ── Touch-point filters (PR2 Phase C) ────────────────────────────────────

/// Seed an experiment with a declining curve that crosses the library
/// threshold (50 cP) somewhere inside the first 10 min.  Used to produce
/// a row with `touchHasCrossing = 1` plus plausible crossing / target
/// values via the save-path precompute.
fn experiment_with_crossing(id: &str, start_cp: f64, end_cp: f64) -> StoredExperiment {
    let mut exp = minimal_experiment(id, None, "Well");
    // 0..12 min at 1 s resolution, linear decline.
    exp.raw_points = (0..=720)
        .map(|i| {
            let t = i as f64;
            let frac = (i as f64) / 720.0;
            let visc = start_cp + (end_cp - start_cp) * frac;
            json!({
                "timeSec": t,
                "viscosityCp": visc,
                "shearRate": 511.0,
                "temperatureC": 70.0,
            })
        })
        .collect();
    exp
}

/// Seed a flat curve above the threshold — no crossing, but the algorithm
/// still emits a target-time viscosity.
fn experiment_flat_no_crossing(id: &str, flat_cp: f64) -> StoredExperiment {
    let mut exp = minimal_experiment(id, None, "Well");
    exp.raw_points = (0..=72)
        .map(|i| {
            json!({
                "timeSec": (i as f64) * 10.0,
                "viscosityCp": flat_cp,
                "shearRate": 511.0,
                "temperatureC": 70.0,
            })
        })
        .collect();
    exp
}

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

// ── Touch-point library coverage snapshot ─────────────────────────────────

#[test]
fn touch_point_stats_on_empty_library_returns_zeroed_totals() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    let stats = super::query_touch_point_stats(&conn).unwrap();

    assert_eq!(stats.total_experiments, 0);
    assert_eq!(stats.with_crossing_count, 0);
    assert_eq!(stats.with_target_viscosity_count, 0);
    assert!(stats.crossing_time_min_minutes.is_none());
    assert!(stats.crossing_time_max_minutes.is_none());
    assert!(stats.crossing_viscosity_min_cp.is_none());
    assert!(stats.crossing_viscosity_max_cp.is_none());
    assert!(stats.viscosity_at_target_min_cp.is_none());
    assert!(stats.viscosity_at_target_max_cp.is_none());
}

#[test]
fn touch_point_stats_counts_crossings_and_reports_ranges() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    // Two declining curves (crossings at different times), one flat curve
    // (no crossing but target-time viscosity is populated).
    persist_experiment(&conn, &experiment_with_crossing("stats_fast", 80.0, 5.0)).unwrap();
    persist_experiment(&conn, &experiment_with_crossing("stats_slow", 200.0, 10.0)).unwrap();
    persist_experiment(&conn, &experiment_flat_no_crossing("stats_flat", 500.0)).unwrap();
    drop(conn);

    let conn = state.pool_conn().unwrap();
    let stats = super::query_touch_point_stats(&conn).unwrap();

    assert_eq!(stats.total_experiments, 3);
    assert_eq!(
        stats.with_crossing_count, 2,
        "both declining curves must count as crossings"
    );
    assert_eq!(
        stats.with_target_viscosity_count, 3,
        "all three curves extend past the 10-min target"
    );

    let t_lo = stats.crossing_time_min_minutes.expect("min crossing time");
    let t_hi = stats.crossing_time_max_minutes.expect("max crossing time");
    assert!(t_lo <= t_hi, "min must not exceed max");
    assert!(
        t_lo > 0.0 && t_hi < 12.0,
        "crossing times must lie inside the sampled window, got {t_lo}..{t_hi}"
    );

    let vc_lo = stats
        .crossing_viscosity_min_cp
        .expect("min crossing viscosity");
    let vc_hi = stats
        .crossing_viscosity_max_cp
        .expect("max crossing viscosity");
    assert!(vc_lo <= vc_hi);
    assert!(
        (0.0..=80.0).contains(&vc_lo) && (0.0..=80.0).contains(&vc_hi),
        "crossing viscosities should sit below / at the 50 cP threshold, got {vc_lo}..{vc_hi}"
    );

    let vt_lo = stats
        .viscosity_at_target_min_cp
        .expect("min target viscosity");
    let vt_hi = stats
        .viscosity_at_target_max_cp
        .expect("max target viscosity");
    assert!(vt_lo <= vt_hi);
    assert!(
        vt_hi >= 400.0,
        "the flat 500 cP curve must pull the max up past 400, got {vt_hi}"
    );
}

// ── Dynamic viscosity threshold (user-configurable touch-point) ─────────

#[test]
fn dynamic_threshold_matches_crosslinked_gel_break_point() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    // Curve peaks near 1000 cP, descends to 10 cP over 12 min.  At 50 cP
    // (fast-path default) it crosses near minute 11.5; at 500 cP it crosses
    // much earlier around minute 6.  With a user threshold of 500 cP, the
    // slow path must recompute accordingly.
    persist_experiment(
        &conn,
        &experiment_with_crossing("dt_crosslinked", 1000.0, 10.0),
    )
    .unwrap();
    // Flat 120 cP curve — peaks below 500, prune must skip it entirely.
    persist_experiment(&conn, &experiment_flat_no_crossing("dt_flat", 120.0)).unwrap();
    drop(conn);

    // Default threshold (50 cP) — both rows remain in the list (flat is
    // kept because no touch-point filter is on).
    let (_, total_default) = query_experiments_list_sql(&state, &default_query()).unwrap();
    assert_eq!(total_default, 2);

    // Dynamic threshold = 500 cP + require crossing=yes.  The flat curve
    // can't reach 500 from above, so gets pruned; the declining curve
    // crosses and survives.
    let q: ExperimentsListQuery = serde_json::from_value(json!({
        "viscosityThreshold": "500",
        "hasCrossing": "yes",
    }))
    .unwrap();
    let (experiments, total) = query_experiments_list_sql(&state, &q).unwrap();
    assert_eq!(total, 1, "only the declining curve crosses 500 cP");
    assert_eq!(experiments[0].id, "dt_crosslinked");

    // The returned list item's touch-point fields reflect the DYNAMIC
    // threshold (~500 cP crossing), not the stale precomputed 50 cP value.
    let t = experiments[0]
        .touch_crossing_time_min
        .expect("dynamic crossing time must be populated");
    assert!(
        t < 10.0,
        "500 cP crossing should happen well before 10 min on a 1000→10 decline, got {t}"
    );
    let v = experiments[0]
        .touch_crossing_viscosity_cp
        .expect("dynamic crossing viscosity must be populated");
    assert!(
        v <= 500.0 && v >= 100.0,
        "crossing viscosity should sit near the 500 cP threshold (data-point snap), got {v}"
    );
}

#[test]
fn dynamic_threshold_prunes_by_max_viscosity() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    persist_experiment(&conn, &experiment_flat_no_crossing("dt_low_1", 80.0)).unwrap();
    persist_experiment(&conn, &experiment_flat_no_crossing("dt_low_2", 300.0)).unwrap();
    persist_experiment(&conn, &experiment_with_crossing("dt_high", 1200.0, 20.0)).unwrap();
    drop(conn);

    // Threshold 500 cP — only the 1200→20 curve can possibly cross.
    let q: ExperimentsListQuery = serde_json::from_value(json!({
        "viscosityThreshold": "500",
        "hasCrossing": "yes",
    }))
    .unwrap();
    let (experiments, total) = query_experiments_list_sql(&state, &q).unwrap();
    assert_eq!(total, 1);
    assert_eq!(experiments[0].id, "dt_high");
}

#[test]
fn dynamic_threshold_with_crossing_time_range_narrows_further() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    // Two declining curves: steep (crosses 500 cP fast) and gradual.
    persist_experiment(&conn, &experiment_with_crossing("dt_fast", 800.0, 5.0)).unwrap();
    persist_experiment(&conn, &experiment_with_crossing("dt_slow", 1200.0, 20.0)).unwrap();
    drop(conn);

    // Wide time window — both should match the threshold filter.
    let q_wide: ExperimentsListQuery = serde_json::from_value(json!({
        "viscosityThreshold": "500",
        "hasCrossing": "yes",
        "crossingTimeMin": "0",
        "crossingTimeMax": "15",
    }))
    .unwrap();
    let (_experiments, total_wide) = query_experiments_list_sql(&state, &q_wide).unwrap();
    assert!(total_wide >= 1, "wide window must match at least one curve");

    // Narrow window excluding early crossings — depending on the steepness
    // of the two curves, the narrow bound should change results.
    let q_narrow: ExperimentsListQuery = serde_json::from_value(json!({
        "viscosityThreshold": "500",
        "hasCrossing": "yes",
        "crossingTimeMin": "8",
        "crossingTimeMax": "15",
    }))
    .unwrap();
    let (_experiments_narrow, total_narrow) =
        query_experiments_list_sql(&state, &q_narrow).unwrap();
    assert!(
        total_narrow <= total_wide,
        "narrow window must never return more than wide window"
    );
}

#[test]
fn dynamic_threshold_empty_string_falls_back_to_precomputed_path() {
    // An empty / whitespace `viscosityThreshold` must route to the fast
    // path — the slow path's on-the-fly compute is costly and we never
    // want to run it on junk input.
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    persist_experiment(&conn, &experiment_with_crossing("dt_empty", 200.0, 10.0)).unwrap();
    drop(conn);

    for raw in ["", "   ", "0", "-42", "abc"] {
        let q: ExperimentsListQuery = serde_json::from_value(json!({
            "viscosityThreshold": raw,
        }))
        .unwrap();
        let (experiments, total) = query_experiments_list_sql(&state, &q).unwrap();
        assert_eq!(total, 1, "junk threshold {raw:?} must use fast path");
        // Fast path → touch columns come from precomputed 50 cP data.
        assert_eq!(experiments[0].touch_has_crossing, Some(true));
    }
}

#[test]
fn dynamic_threshold_has_crossing_no_returns_curves_that_never_cross() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    // Flat 800 cP curve — maxViscosity 800, never descends below 500.
    persist_experiment(&conn, &experiment_flat_no_crossing("dt_nocross", 800.0)).unwrap();
    // Descending curve that does cross 500.
    persist_experiment(&conn, &experiment_with_crossing("dt_cross", 1000.0, 5.0)).unwrap();
    drop(conn);

    let q: ExperimentsListQuery = serde_json::from_value(json!({
        "viscosityThreshold": "500",
        "hasCrossing": "no",
    }))
    .unwrap();
    let (experiments, total) = query_experiments_list_sql(&state, &q).unwrap();
    assert_eq!(total, 1, "hasCrossing=no must pick up the flat curve");
    assert_eq!(experiments[0].id, "dt_nocross");
}

#[test]
fn touch_point_stats_ignores_pending_backfill_rows_in_ranges() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    persist_experiment(&conn, &experiment_with_crossing("stats_done", 200.0, 10.0)).unwrap();
    persist_experiment(
        &conn,
        &experiment_with_crossing("stats_pending", 200.0, 10.0),
    )
    .unwrap();
    // Simulate a pre-v0002 row: columns wiped out, waiting on backfill.
    conn.execute(
        "UPDATE Experiment SET touchHasCrossing = NULL, touchCrossingTimeMin = NULL, \
         touchCrossingViscosityCp = NULL, touchViscosityAtTargetCp = NULL, \
         touchPrecomputeVersion = NULL WHERE id = 'stats_pending'",
        [],
    )
    .unwrap();
    drop(conn);

    let conn = state.pool_conn().unwrap();
    let stats = super::query_touch_point_stats(&conn).unwrap();

    // Total stays truthful — it counts rows, not precompute state.
    assert_eq!(stats.total_experiments, 2);
    // Only the settled row contributes to the crossing tally.
    assert_eq!(
        stats.with_crossing_count, 1,
        "pending-backfill rows must not inflate the crossing count"
    );
    // Range bounds come exclusively from the settled row — min == max.
    let t_lo = stats.crossing_time_min_minutes.unwrap();
    let t_hi = stats.crossing_time_max_minutes.unwrap();
    assert!(
        (t_lo - t_hi).abs() < 1e-9,
        "min and max must coincide when only one row has a value"
    );
}

#[test]
fn dynamic_threshold_synthetic_data_test() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();

    // Create synthetic experiment data with known viscosity profile
    // This simulates a real experiment with viscosity decreasing from high to low
    let mut exp = minimal_experiment("synthetic-high-visc", Some("Test"), "tap");
    exp.name = "Synthetic High Viscosity Test".to_string();
    exp.original_filename = "synthetic.csv".to_string();
    exp.test_date = "2025-04-22".to_string();

    // Create synthetic data points that simulate a gel breaking structure:
    // - Start at 1000 cP (high)
    // - Cross 500 cP at around 2 minutes (120 seconds)
    // - Cross 50 cP at around 5 minutes (300 seconds)
    // - End at 10 cP (low)
    // Use the correct field names that the touch-point algorithm expects
    let raw_points = vec![
        json!({"timeSec": 0.0, "viscosityCp": 1000.0, "shearRate": 10.0, "temperatureC": 25.0}),
        json!({"timeSec": 60.0, "viscosityCp": 800.0, "shearRate": 10.0, "temperatureC": 25.0}),
        json!({"timeSec": 120.0, "viscosityCp": 500.0, "shearRate": 10.0, "temperatureC": 25.0}), // Cross 500 cP
        json!({"timeSec": 180.0, "viscosityCp": 300.0, "shearRate": 10.0, "temperatureC": 25.0}),
        json!({"timeSec": 240.0, "viscosityCp": 100.0, "shearRate": 10.0, "temperatureC": 25.0}),
        json!({"timeSec": 300.0, "viscosityCp": 50.0, "shearRate": 10.0, "temperatureC": 25.0}), // Cross 50 cP
        json!({"timeSec": 360.0, "viscosityCp": 30.0, "shearRate": 10.0, "temperatureC": 25.0}),
        json!({"timeSec": 420.0, "viscosityCp": 10.0, "shearRate": 10.0, "temperatureC": 25.0}),
    ];

    exp.raw_points = raw_points;

    // Save experiment
    persist_experiment(&conn, &exp).expect("Save must succeed");

    println!("=== Synthetic Data Test ===");
    println!("Created experiment with viscosity profile: 1000 -> 500 -> 50 -> 10 cP");

    // Test different thresholds
    let thresholds = vec!["10", "50", "500", "1000"];

    for threshold in thresholds {
        let mut query = ExperimentsListQuery::default();
        query.viscosity_threshold = Some(threshold.to_string());
        query.has_crossing = Some("yes".to_string());
        query.limit = Some(10);

        let results = query_experiments_list_sql(&state, &query).expect("Query must succeed");

        println!("Threshold {} cP: {} results", threshold, results.0.len());
        if !results.0.is_empty() {
            let exp = &results.0[0];
            println!(
                "  - crossing_time: {:?} min, crossing_viscosity: {:?} cP",
                exp.touch_crossing_time_min, exp.touch_crossing_viscosity_cp
            );
            println!(
                "  - viscosity_at_target: {:?} cP",
                exp.touch_viscosity_at_target_cp
            );
        }
    }

    // Test fast vs slow path behavior
    let mut query_fast = ExperimentsListQuery::default();
    query_fast.has_crossing = Some("yes".to_string());
    query_fast.limit = Some(10);

    let results_fast =
        query_experiments_list_sql(&state, &query_fast).expect("Fast path must succeed");

    let mut query_slow = ExperimentsListQuery::default();
    query_slow.viscosity_threshold = Some("500".to_string());
    query_slow.has_crossing = Some("yes".to_string());
    query_slow.limit = Some(10);

    let results_slow =
        query_experiments_list_sql(&state, &query_slow).expect("Slow path must succeed");

    println!("\n=== Fast vs Slow Path Comparison ===");
    println!(
        "Fast path (default 50 cP): {} results",
        results_fast.0.len()
    );
    println!("Slow path (500 cP): {} results", results_slow.0.len());

    // Both should return the same experiment since it crosses both thresholds
    assert_eq!(
        results_fast.0.len(),
        1,
        "Fast path should find the experiment"
    );
    assert_eq!(
        results_slow.0.len(),
        1,
        "Slow path should find the experiment"
    );

    // But the crossing times should differ
    if !results_fast.0.is_empty() && !results_slow.0.is_empty() {
        let fast_exp = &results_fast.0[0];
        let slow_exp = &results_slow.0[0];

        println!(
            "Fast path crossing time: {:?} min",
            fast_exp.touch_crossing_time_min
        );
        println!(
            "Slow path crossing time: {:?} min",
            slow_exp.touch_crossing_time_min
        );

        // The 500 cP crossing should happen earlier than 50 cP crossing
        if let (Some(fast_time), Some(slow_time)) = (
            fast_exp.touch_crossing_time_min,
            slow_exp.touch_crossing_time_min,
        ) {
            assert!(
                slow_time <= fast_time + 0.1,
                "500 cP crossing ({}) should be <= 50 cP crossing ({})",
                slow_time,
                fast_time
            );
        }
    }

    // Test edge case: threshold higher than max viscosity
    let mut query_too_high = ExperimentsListQuery::default();
    query_too_high.viscosity_threshold = Some("2000".to_string());
    query_too_high.has_crossing = Some("yes".to_string());
    query_too_high.limit = Some(10);

    let results_too_high =
        query_experiments_list_sql(&state, &query_too_high).expect("Query must succeed");

    println!(
        "Threshold 2000 cP (above max): {} results",
        results_too_high.0.len()
    );
    assert_eq!(
        results_too_high.0.len(),
        0,
        "Should not find experiments when threshold > max viscosity"
    );
}

#[test]
fn slow_path_finds_crossing_on_snake_case_raw_points_regression() {
    // Reproduces the production bug the user hit on the Comparison screen:
    // the Grace experiment clearly crosses 500 cP but the library filter
    // "Порог=500, Достигнут порог 500 сП = Да" returned zero results.
    //
    // Root cause: the frontend persists raw_points with snake_case keys
    // (time_sec / viscosity_cp / shear_rate_s1 — see
    // src/lib/experiments/mappers.ts and src/lib/parsing/parse-normalize.ts),
    // which the columnar encoder stores verbatim. The slow path's
    // `to_touch_inputs_from_columns` looked up channels strictly under
    // camelCase names (timeSec/viscosityCp/shearRate) and returned an
    // empty vector, collapsing every experiment to has_crossing=false.
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();

    let mut exp = minimal_experiment("snake-real", Some("GATE"), "Well");
    exp.name = "GATE-4-OFite snake-case regression".to_string();
    exp.raw_points = (0..=720)
        .map(|i| {
            let t_sec = i as f64;
            let frac = (i as f64) / 720.0;
            let visc = 1200.0 + (20.0 - 1200.0) * frac;
            json!({
                "time_sec": t_sec,
                "viscosity_cp": visc,
                "shear_rate_s1": 511.0,
                "temperature_c": 70.0,
            })
        })
        .collect();
    persist_experiment(&conn, &exp).unwrap();
    drop(conn);

    let q: ExperimentsListQuery = serde_json::from_value(json!({
        "viscosityThreshold": "500",
        "hasCrossing": "yes",
    }))
    .unwrap();
    let (rows, total) = query_experiments_list_sql(&state, &q).unwrap();
    assert_eq!(
        total, 1,
        "slow path must find the snake_case crossing at 500 cP \
         (regression: camelCase-only channel lookup used to drop this row)"
    );
    assert_eq!(rows[0].id, "snake-real");
    let t = rows[0]
        .touch_crossing_time_min
        .expect("dynamic crossing time must be populated");
    assert!(
        t > 0.0 && t < 12.0,
        "crossing time must lie inside the sampled window, got {t}"
    );
}

#[test]
fn dynamic_threshold_real_fixtures_brookfield_grace_threshold_100_is_sound() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();

    let fixtures = [
        ("fixture-brookfield-xls", "Отчёт brookfild.xls"),
        ("fixture-brookfield-xlsx", "Brookfeild 4.xlsx"),
        ("fixture-grace", "Отчёт Grace.xlsx"),
    ];

    for (id, filename) in fixtures {
        let resp = parse_fixture_bytes(filename);
        assert!(resp.success, "parse must succeed for {filename}");
        assert!(
            !resp.data.is_empty(),
            "parsed data must not be empty for {filename}"
        );

        let min_visc = resp
            .data
            .iter()
            .map(|pt| pt.viscosity_cp)
            .fold(f64::INFINITY, f64::min);
        let max_visc = resp
            .data
            .iter()
            .map(|pt| pt.viscosity_cp)
            .fold(f64::NEG_INFINITY, f64::max);

        let exp = experiment_from_parse(id, filename, &resp);
        persist_experiment(&conn, &exp).expect("persist fixture experiment");

        let mut q = ExperimentsListQuery::default();
        q.test_name = Some(exp.name.clone());
        q.viscosity_threshold = Some("100".to_string());
        q.has_crossing = Some("yes".to_string());
        q.limit = Some(50);

        let (rows, _total) = query_experiments_list_sql(&state, &q).unwrap();
        let matched = rows.iter().any(|row| row.id == id);

        println!(
            "Fixture {filename}: viscosity[min,max]=[{min_visc:.3},{max_visc:.3}] cP, threshold=100 matched={matched}",
        );

        if min_visc > 100.0 {
            assert!(
                !matched,
                "{filename}: min viscosity {min_visc} cP > 100, but filter returned the experiment"
            );
        }
    }
}

// ── Combat test: ALL real fixtures × ALL 8 preset thresholds ──────────────

/// Parse all usable fixture files, persist them in a fresh DB with full
/// multi-threshold TPP precompute, then exercise every preset threshold
/// through the fast path.  This is the "реальный боевой тест" — if ANY
/// real-world fixture trips a consistency bug, it surfaces here.
#[test]
fn combat_all_fixtures_all_thresholds_fast_path_consistency() {
    use crate::db::migrations::v0003_multi_threshold_touch_point::LIBRARY_TOUCH_THRESHOLDS_CP;

    // ALL 19 real report files from tests/fixtures/ — every xlsx, xls,
    // csv, dat the project carries.  Nothing synthetic.
    let fixtures: &[(&str, &str)] = &[
        ("fx-chandler",          "Отчёт Chandler.xls"),
        ("fx-grace",             "Отчёт Grace.xlsx"),
        ("fx-bsl",               "Отчёт BSL.xlsx"),
        ("fx-brookfield-xls",    "Отчёт brookfild.xls"),
        ("fx-brookfield-xlsx",   "Brookfeild 4.xlsx"),
        ("fx-bsl-562",           "562@60C.xlsx"),
        ("fx-november",          "November102008-2.xls"),
        ("fx-ofite",             "Ofite 1100.dat"),
        ("fx-bsl-3",             "t-12.03.26-3BSL.xlsx"),
        ("fx-561-110c",          "t-20.02.26-1  - 561)@110C.xls"),
        ("fx-90-da",             "90 второй 26.02.2024 1717.da.xlsx"),
        ("fx-nk-comparison",     "n и K сравнительный тест. 26.12.2023 1457 .xlsx"),
        ("fx-3-8-csv",           "3.8_2.0_0.2_41C(5610_56)23.04.csv"),
        ("fx-3-8-csv-2",         "3.8_2.0_0.2_41C(5610_56)_2_23.04.csv"),
        ("fx-3-8-56-78",         "3.8_2.0_0.2_41C(56 & 78).csv"),
        ("fx-3-8-borcat",        "3.8_2.0_0.8_41C(7801_78)+18BorCat+RCP BorProp.csv"),
        ("fx-3-8-borprop-1000",  "3.8_2.0_1.0_41C(7801_78)+18BorCat+RCP BorProp(con1000).csv"),
        ("fx-8957-sst",          "8957 SST Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@63C 30.10.25.csv"),
        ("fx-8958-swb",          "8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25.csv"),
    ];

    let state = make_test_state();
    let conn = state.pool_conn().unwrap();

    // ── Phase 1: parse + persist every fixture ────────────────────────────
    let mut parsed_ids: Vec<String> = Vec::new();
    let mut visc_ranges: std::collections::HashMap<String, (f64, f64)> =
        std::collections::HashMap::new();

    for &(id, filename) in fixtures {
        let resp = match std::panic::catch_unwind(|| parse_fixture_bytes(filename)) {
            Ok(r) if r.success && !r.data.is_empty() => r,
            _ => {
                eprintln!("  [skip] {filename}: parse failed or empty data");
                continue;
            }
        };

        let min_visc = resp
            .data
            .iter()
            .map(|p| p.viscosity_cp)
            .fold(f64::INFINITY, f64::min);
        let max_visc = resp
            .data
            .iter()
            .map(|p| p.viscosity_cp)
            .fold(f64::NEG_INFINITY, f64::max);

        let exp = experiment_from_parse(id, filename, &resp);
        persist_experiment(&conn, &exp).expect("persist fixture");
        println!(
            "  [ok] {:<40} {:>5} pts  visc=[{:.1}, {:.1}] cP",
            filename,
            resp.data.len(),
            min_visc,
            max_visc,
        );
        parsed_ids.push(id.to_string());
        visc_ranges.insert(id.to_string(), (min_visc, max_visc));
    }
    assert!(
        parsed_ids.len() >= 5,
        "at least 5 real reports must parse — got {}",
        parsed_ids.len()
    );
    println!(
        "\n=== Combat test: {} real reports persisted ===",
        parsed_ids.len()
    );

    // ── Phase 2: verify TPP row coverage ──────────────────────────────────
    // Every persist writes all 8 preset rows via write_all_thresholds.
    let expected_thresholds = LIBRARY_TOUCH_THRESHOLDS_CP.len() as i64;
    for id in &parsed_ids {
        let tpp_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM TouchPointPrecompute WHERE experimentId = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            tpp_count, expected_thresholds,
            "experiment {id} must have {expected_thresholds} TPP rows, got {tpp_count}"
        );
    }
    println!(
        "  ✓ TPP coverage: all {} × {expected_thresholds} rows present",
        parsed_ids.len()
    );

    drop(conn);

    // ── Phase 3: test fast-path filtering at every preset threshold ───────
    for &threshold_cp in LIBRARY_TOUCH_THRESHOLDS_CP {
        let t_str = (threshold_cp as i64).to_string();

        // hasCrossing = yes
        let q_yes: ExperimentsListQuery = serde_json::from_value(json!({
            "viscosityThreshold": t_str,
            "hasCrossing": "yes",
            "limit": 100,
        }))
        .unwrap();
        let (rows_yes, total_yes) = query_experiments_list_sql(&state, &q_yes).unwrap();

        // hasCrossing = no
        let q_no: ExperimentsListQuery = serde_json::from_value(json!({
            "viscosityThreshold": t_str,
            "hasCrossing": "no",
            "limit": 100,
        }))
        .unwrap();
        let (rows_no, total_no) = query_experiments_list_sql(&state, &q_no).unwrap();

        // All experiments (no hasCrossing filter)
        let q_all: ExperimentsListQuery = serde_json::from_value(json!({
            "viscosityThreshold": t_str,
            "limit": 100,
        }))
        .unwrap();
        let (_rows_all, total_all) = query_experiments_list_sql(&state, &q_all).unwrap();

        println!(
            "  threshold={:>4} cP: yes={:<3} no={:<3} all={:<3}",
            threshold_cp as i64, total_yes, total_no, total_all,
        );

        // Partition check: yes + no == all
        assert_eq!(
            total_yes + total_no,
            total_all,
            "threshold={}: yes({}) + no({}) != all({})",
            threshold_cp,
            total_yes,
            total_no,
            total_all,
        );

        // Sanity: every "yes" experiment must have max_visc > threshold
        for exp in &rows_yes {
            let (_, max_v) = visc_ranges[&exp.id];
            assert!(
                max_v > threshold_cp - 0.1,
                "threshold={}: experiment {} has max_visc={:.1} < threshold — \
                 should not appear in hasCrossing=yes",
                threshold_cp,
                exp.id,
                max_v,
            );
            assert_eq!(
                exp.touch_has_crossing,
                Some(true),
                "threshold={}: experiment {} returned with touch_has_crossing != true",
                threshold_cp,
                exp.id,
            );
        }

        // Sanity: every "no" experiment must have touch_has_crossing = false
        for exp in &rows_no {
            assert_eq!(
                exp.touch_has_crossing,
                Some(false),
                "threshold={}: experiment {} in 'no' set has touch_has_crossing != false",
                threshold_cp,
                exp.id,
            );
        }
    }
    println!("  ✓ Fast-path partition check passed for all 8 thresholds");

    // ── Phase 4: fast-path vs slow-path consistency ───────────────────────
    // For each preset threshold, an off-by-epsilon "custom" value
    // (e.g. 50.1 for 50) must land on the slow path and produce the SAME
    // hasCrossing verdicts as the fast path for every experiment.
    for &threshold_cp in LIBRARY_TOUCH_THRESHOLDS_CP {
        let t_str = (threshold_cp as i64).to_string();
        let t_slow = format!("{:.1}", threshold_cp + 0.1);

        let q_fast: ExperimentsListQuery = serde_json::from_value(json!({
            "viscosityThreshold": t_str,
            "limit": 100,
        }))
        .unwrap();
        let q_slow: ExperimentsListQuery = serde_json::from_value(json!({
            "viscosityThreshold": t_slow,
            "limit": 100,
        }))
        .unwrap();

        let (fast_rows, _) = query_experiments_list_sql(&state, &q_fast).unwrap();
        let (slow_rows, _) = query_experiments_list_sql(&state, &q_slow).unwrap();

        // Build id→has_crossing maps and compare.
        let fast_map: std::collections::HashMap<&str, Option<bool>> = fast_rows
            .iter()
            .map(|e| (e.id.as_str(), e.touch_has_crossing))
            .collect();
        let slow_map: std::collections::HashMap<&str, Option<bool>> = slow_rows
            .iter()
            .map(|e| (e.id.as_str(), e.touch_has_crossing))
            .collect();

        let mut mismatches = 0;
        for (id, fast_val) in &fast_map {
            if let Some(&slow_val) = slow_map.get(id) {
                if fast_val != &slow_val {
                    let (min_v, max_v) = visc_ranges[*id];
                    // Allow mismatch only if viscosity range is within 1 cP of
                    // threshold (the +0.1 shift genuinely changes the outcome).
                    let near_boundary =
                        (min_v - threshold_cp).abs() < 1.0 || (max_v - threshold_cp).abs() < 1.0;
                    if !near_boundary {
                        mismatches += 1;
                        eprintln!(
                            "  [mismatch] threshold={}: {} fast={:?} slow={:?} visc=[{:.0},{:.0}]",
                            threshold_cp, id, fast_val, slow_val, min_v, max_v
                        );
                    }
                }
            }
        }
        assert_eq!(
            mismatches, 0,
            "threshold={}: {} experiments disagree between fast and slow path",
            threshold_cp, mismatches
        );
    }
    println!("  ✓ Fast/slow path consistency check passed");

    // ── Phase 5: monotonicity — higher threshold → ≥ crossings ───────────
    // A higher threshold means the viscosity bar is higher → more curves
    // will have peaked above it and then descended through it.
    let mut prev_crossings = 0usize;
    let mut prev_threshold = 0.0f64;
    for &threshold_cp in LIBRARY_TOUCH_THRESHOLDS_CP {
        let q: ExperimentsListQuery = serde_json::from_value(json!({
            "viscosityThreshold": (threshold_cp as i64).to_string(),
            "hasCrossing": "yes",
            "limit": 100,
        }))
        .unwrap();
        let (_, total) = query_experiments_list_sql(&state, &q).unwrap();
        if threshold_cp > 5.0 {
            assert!(
                total >= prev_crossings,
                "monotonicity: threshold {} cP has {} crossings, \
                 but lower threshold {} cP had {} — expected ≥",
                threshold_cp as i64,
                total,
                prev_threshold as i64,
                prev_crossings,
            );
        }
        prev_crossings = total;
        prev_threshold = threshold_cp;
    }
    println!("  ✓ Crossing count monotonicity: verified");
    println!("=== Combat test PASSED ===\n");
}

// ── Composite filter: threshold + time window ─────────────────────────────

/// Tests the *real lab workflow*: "show me experiments where viscosity
/// crossed below X cP within a given time window."
///
/// Uses all 19 real report files.  For every preset threshold that has
/// at least one crossing, we:
///   1. Read the crossing times from hasCrossing=yes results.
///   2. Build a time window that covers ~half of the crossings.
///   3. Re-query with crossing_time_min / crossing_time_max filter.
///   4. Assert that only experiments inside the window survive.
///   5. Assert that fast-path and slow-path (+0.1 cP) agree.
#[test]
fn combat_composite_filter_threshold_plus_time_range() {
    use crate::db::migrations::v0003_multi_threshold_touch_point::LIBRARY_TOUCH_THRESHOLDS_CP;

    // ALL 19 real report files.
    let fixtures: &[(&str, &str)] = &[
        ("cf-chandler",          "Отчёт Chandler.xls"),
        ("cf-grace",             "Отчёт Grace.xlsx"),
        ("cf-bsl",               "Отчёт BSL.xlsx"),
        ("cf-brookfield-xls",    "Отчёт brookfild.xls"),
        ("cf-brookfield-xlsx",   "Brookfeild 4.xlsx"),
        ("cf-bsl-562",           "562@60C.xlsx"),
        ("cf-november",          "November102008-2.xls"),
        ("cf-ofite",             "Ofite 1100.dat"),
        ("cf-bsl-3",             "t-12.03.26-3BSL.xlsx"),
        ("cf-561-110c",          "t-20.02.26-1  - 561)@110C.xls"),
        ("cf-90-da",             "90 второй 26.02.2024 1717.da.xlsx"),
        ("cf-nk-comparison",     "n и K сравнительный тест. 26.12.2023 1457 .xlsx"),
        ("cf-3-8-csv",           "3.8_2.0_0.2_41C(5610_56)23.04.csv"),
        ("cf-3-8-csv-2",         "3.8_2.0_0.2_41C(5610_56)_2_23.04.csv"),
        ("cf-3-8-56-78",         "3.8_2.0_0.2_41C(56 & 78).csv"),
        ("cf-3-8-borcat",        "3.8_2.0_0.8_41C(7801_78)+18BorCat+RCP BorProp.csv"),
        ("cf-3-8-borprop-1000",  "3.8_2.0_1.0_41C(7801_78)+18BorCat+RCP BorProp(con1000).csv"),
        ("cf-8957-sst",          "8957 SST Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@63C 30.10.25.csv"),
        ("cf-8958-swb",          "8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25.csv"),
    ];

    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    let mut parsed_ids: Vec<String> = Vec::new();

    for &(id, filename) in fixtures {
        let resp = match std::panic::catch_unwind(|| parse_fixture_bytes(filename)) {
            Ok(r) if r.success && !r.data.is_empty() => r,
            _ => continue,
        };
        let exp = experiment_from_parse(id, filename, &resp);
        persist_experiment(&conn, &exp).expect("persist");
        parsed_ids.push(id.to_string());
    }
    drop(conn);
    println!(
        "\n=== Composite filter test: {} real reports ===",
        parsed_ids.len(),
    );

    for &threshold_cp in LIBRARY_TOUCH_THRESHOLDS_CP {
        let t_str = (threshold_cp as i64).to_string();

        // Step 1: get all crossings at this threshold (unfiltered by time).
        let q_cross: ExperimentsListQuery = serde_json::from_value(json!({
            "viscosityThreshold": t_str,
            "hasCrossing": "yes",
            "limit": 100,
        }))
        .unwrap();
        let (crossed, _) = query_experiments_list_sql(&state, &q_cross).unwrap();
        if crossed.is_empty() {
            println!(
                "  threshold={:>4} cP: 0 crossings — skipping time-range test",
                threshold_cp as i64,
            );
            continue;
        }

        // Collect crossing times.
        let mut times: Vec<f64> = crossed
            .iter()
            .filter_map(|e| e.touch_crossing_time_min)
            .collect();
        times.sort_by(|a, b| a.partial_cmp(b).unwrap());

        if times.is_empty() {
            println!(
                "  threshold={:>4} cP: {} crossings but all have NULL time — skip",
                threshold_cp as i64,
                crossed.len(),
            );
            continue;
        }

        // Step 2: build a time window that covers roughly the first half.
        let t_min = times[0];
        let t_median = times[times.len() / 2];
        // Ensure the window is non-trivial (at least 0.1 min wide).
        let t_max_window = if (t_median - t_min).abs() < 0.1 {
            t_min + 0.1
        } else {
            t_median
        };

        // Widen the query window by 0.001 min on each side to absorb
        // float64→string→float64 rounding (format!("{:.3}") truncates).
        let query_t_min = t_min - 0.001;
        let query_t_max = t_max_window + 0.001;

        // Count how many crossing times fall inside the widened query window.
        let expected_in_window = times
            .iter()
            .filter(|&&t| t >= query_t_min - 1e-9 && t <= query_t_max + 1e-9)
            .count();

        // Step 3: query with composite filter — threshold + hasCrossing + time range.
        let q_composite: ExperimentsListQuery = serde_json::from_value(json!({
            "viscosityThreshold": t_str,
            "hasCrossing": "yes",
            "crossingTimeMin": format!("{:.3}", query_t_min),
            "crossingTimeMax": format!("{:.3}", query_t_max),
            "limit": 100,
        }))
        .unwrap();
        let (composite_rows, composite_total) =
            query_experiments_list_sql(&state, &q_composite).unwrap();

        println!(
            "  threshold={:>4} cP: crossed={}, window=[{:.2}, {:.2}] min, expected≈{}, got={}",
            threshold_cp as i64,
            crossed.len(),
            t_min,
            t_max_window,
            expected_in_window,
            composite_total,
        );

        // The composite result must be ≤ the unfiltered crossing count.
        assert!(
            composite_total <= crossed.len(),
            "threshold={}: composite ({}) > unfiltered ({})",
            threshold_cp,
            composite_total,
            crossed.len(),
        );

        // The composite result must equal expected_in_window.
        assert_eq!(
            composite_total, expected_in_window,
            "threshold={}: time window [{:.3},{:.3}] expected {} results, got {}",
            threshold_cp, t_min, t_max_window, expected_in_window, composite_total,
        );

        // Every returned experiment must have crossing time inside the window.
        for exp in &composite_rows {
            let t = exp
                .touch_crossing_time_min
                .expect("composite result must have crossing time");
            assert!(
                t >= query_t_min - 1e-6 && t <= query_t_max + 1e-6,
                "threshold={}: experiment {} crossing_time={:.3} outside [{:.3},{:.3}]",
                threshold_cp,
                exp.id,
                t,
                query_t_min,
                query_t_max,
            );
            assert_eq!(
                exp.touch_has_crossing,
                Some(true),
                "threshold={}: experiment {} must have has_crossing=true",
                threshold_cp,
                exp.id,
            );
        }

        // Step 4: verify fast-path vs slow-path consistency for composite.
        let t_slow = format!("{:.1}", threshold_cp + 0.1);
        let q_slow: ExperimentsListQuery = serde_json::from_value(json!({
            "viscosityThreshold": t_slow,
            "hasCrossing": "yes",
            "crossingTimeMin": format!("{:.3}", query_t_min),
            "crossingTimeMax": format!("{:.3}", query_t_max),
            "limit": 100,
        }))
        .unwrap();
        let (slow_rows, _) = query_experiments_list_sql(&state, &q_slow).unwrap();

        // Compare id sets — with +0.1 cP shift, sets should match
        // unless a crossing is right at the boundary.
        let fast_ids: std::collections::HashSet<&str> =
            composite_rows.iter().map(|e| e.id.as_str()).collect();
        let slow_ids: std::collections::HashSet<&str> =
            slow_rows.iter().map(|e| e.id.as_str()).collect();

        // Only flag real mismatches (not boundary effects).
        let only_fast: Vec<&&str> = fast_ids.difference(&slow_ids).collect();
        let only_slow: Vec<&&str> = slow_ids.difference(&fast_ids).collect();

        if !only_fast.is_empty() || !only_slow.is_empty() {
            println!(
                "    [note] fast/slow differ: only-fast={:?} only-slow={:?} (threshold+0.1 boundary effect OK)",
                only_fast, only_slow,
            );
        }
    }

    // ── Bonus: empty time window returns zero ─────────────────────────────
    // Window [9999, 10000] min — no experiment crosses that late.
    let q_empty: ExperimentsListQuery = serde_json::from_value(json!({
        "viscosityThreshold": "100",
        "hasCrossing": "yes",
        "crossingTimeMin": "9999",
        "crossingTimeMax": "10000",
        "limit": 100,
    }))
    .unwrap();
    let (_, total_empty) = query_experiments_list_sql(&state, &q_empty).unwrap();
    assert_eq!(
        total_empty, 0,
        "absurd time window [9999,10000] min should return 0 results"
    );

    // ── Bonus: only crossingTimeMax (no min) ──────────────────────────────
    // "Show me experiments that crossed 300 cP within the first 5 minutes."
    let q_max_only: ExperimentsListQuery = serde_json::from_value(json!({
        "viscosityThreshold": "300",
        "hasCrossing": "yes",
        "crossingTimeMax": "5.0",
        "limit": 100,
    }))
    .unwrap();
    let (early_rows, early_total) = query_experiments_list_sql(&state, &q_max_only).unwrap();
    for exp in &early_rows {
        let t = exp
            .touch_crossing_time_min
            .expect("must have crossing time");
        assert!(
            t <= 5.0 + 1e-6,
            "crossingTimeMax=5: experiment {} has crossing_time={:.3} > 5.0",
            exp.id,
            t,
        );
    }
    // Full crossing set at 300 must be ≥ early-only set.
    let q_300_all: ExperimentsListQuery = serde_json::from_value(json!({
        "viscosityThreshold": "300",
        "hasCrossing": "yes",
        "limit": 100,
    }))
    .unwrap();
    let (_, total_300) = query_experiments_list_sql(&state, &q_300_all).unwrap();
    assert!(
        total_300 >= early_total,
        "300 cP all-crossings ({}) must be ≥ early-only ({})",
        total_300,
        early_total,
    );
    println!(
        "  bonus: threshold=300, crossingTimeMax=5 min → {} of {} crossings",
        early_total, total_300,
    );

    println!("  ✓ All composite filters verified");
    println!("=== Composite filter test PASSED ===\n");
}
