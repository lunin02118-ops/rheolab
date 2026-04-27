//! Touch-point library coverage snapshot tests.

use super::fixtures::*;
use crate::commands::experiments::crud::persist_experiment;

#[test]
fn touch_point_stats_on_empty_library_returns_zeroed_totals() {
    let state = make_test_state();
    let conn = state.pool_conn().unwrap();
    let stats = super::super::query_touch_point_stats(&conn).unwrap();

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
    let stats = super::super::query_touch_point_stats(&conn).unwrap();

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
    let stats = super::super::query_touch_point_stats(&conn).unwrap();

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
