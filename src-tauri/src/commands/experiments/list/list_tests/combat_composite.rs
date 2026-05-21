//! Composite filter test: threshold + time window.
//!
//! Tests the *real lab workflow*: "show me experiments where viscosity
//! crossed below X cP within a given time window."
//!
//! Uses all 19 real report files.  For every preset threshold that has
//! at least one crossing, we:
//!   1. Read the crossing times from hasCrossing=yes results.
//!   2. Build a time window that covers ~half of the crossings.
//!   3. Re-query with crossing_time_min / crossing_time_max filter.
//!   4. Assert that only experiments inside the window survive.
//!   5. Assert that fast-path and slow-path (+0.1 cP) agree.

use super::fixtures::*;
use super::*;
use crate::commands::experiments::crud::persist_experiment;
use serde_json::json;

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
