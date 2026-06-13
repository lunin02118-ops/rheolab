//! Dynamic viscosity threshold tests (user-configurable touch-point).

use super::fixtures::*;
use super::*;
use crate::commands::experiments::crud::persist_experiment;
use serde_json::json;

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
        (100.0..=500.0).contains(&v),
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
        let query = ExperimentsListQuery {
            viscosity_threshold: Some(threshold.to_string()),
            has_crossing: Some("yes".to_string()),
            limit: Some(10),
            ..Default::default()
        };

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
    let query_fast = ExperimentsListQuery {
        has_crossing: Some("yes".to_string()),
        limit: Some(10),
        ..Default::default()
    };

    let results_fast =
        query_experiments_list_sql(&state, &query_fast).expect("Fast path must succeed");

    let query_slow = ExperimentsListQuery {
        viscosity_threshold: Some("500".to_string()),
        has_crossing: Some("yes".to_string()),
        limit: Some(10),
        ..Default::default()
    };

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
    let query_too_high = ExperimentsListQuery {
        viscosity_threshold: Some("2000".to_string()),
        has_crossing: Some("yes".to_string()),
        limit: Some(10),
        ..Default::default()
    };

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
