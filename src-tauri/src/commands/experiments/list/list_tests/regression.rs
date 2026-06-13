//! Production-fixture regression tests (smaller scope; combat tests live
//! in `combat_thresholds.rs` and `combat_composite.rs`).

use super::fixtures::*;
use super::*;
use crate::commands::experiments::crud::persist_experiment;
use serde_json::json;

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

        let q = ExperimentsListQuery {
            test_name: Some(exp.name.clone()),
            viscosity_threshold: Some("100".to_string()),
            has_crossing: Some("yes".to_string()),
            limit: Some(50),
            ..Default::default()
        };

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
