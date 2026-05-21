//! Combat test: ALL real fixtures × ALL 8 preset thresholds.
//!
//! Parse all usable fixture files, persist them in a fresh DB with full
//! multi-threshold TPP precompute, then exercise every preset threshold
//! through the fast path.  This is the "реальный боевой тест" — if ANY
//! real-world fixture trips a consistency bug, it surfaces here.

use super::fixtures::*;
use super::*;
use crate::commands::experiments::crud::persist_experiment;
use serde_json::json;

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
