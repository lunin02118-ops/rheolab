//! Unit + integration tests for the touch-point precompute pipeline.
//! Exercises every submodule via the public re-exports on [`super`].

use super::*;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::collections::HashMap;

fn synthetic_crossing_points() -> Vec<Value> {
    // Linear decline 200 → 10 cP over 0..12 min at a constant shear
    // rate of 511 s⁻¹.  Crossing through 50 cP occurs near t = 9.5 min.
    let n = 121;
    let start = 200.0;
    let end = 10.0;
    (0..n)
        .map(|i| {
            let t = i as f64 * 6.0; // seconds, 0-720
            let visc = start + (end - start) * (i as f64 / (n - 1) as f64);
            json!({
                "timeSec": t,
                "viscosityCp": visc,
                "shearRate": 511.0,
                "temperatureC": 70.0,
            })
        })
        .collect()
}

fn synthetic_no_crossing_points() -> Vec<Value> {
    // Flat 150 cP curve that runs past the 10-min library target so
    // the algorithm can still emit a target-time viscosity even when
    // the 50 cP threshold is never hit.  0..12 min, 10 s step.
    (0..=72)
        .map(|i| {
            json!({
                "timeSec": (i as f64) * 10.0,
                "viscosityCp": 150.0,
                "shearRate": 511.0,
                "temperatureC": 70.0,
            })
        })
        .collect()
}

#[test]
fn compute_from_inputs_returns_none_for_empty_input() {
    assert!(compute_from_inputs(&[]).is_none());
}

#[test]
fn synthetic_crossing_is_detected() {
    let raw = synthetic_crossing_points();
    let inputs = to_touch_inputs(&raw);
    let out = compute_from_inputs(&inputs).expect("non-empty input yields Some");

    assert!(out.has_crossing, "linear decline should cross 50 cP");
    let time = out.crossing_time_min.expect("crossing time present");
    assert!(
        (7.0..=12.0).contains(&time),
        "crossing time must land inside the declining window, got {time}"
    );
    let vcp = out
        .crossing_viscosity_cp
        .expect("crossing viscosity present");
    assert!(
        vcp < 100.0,
        "crossing viscosity should be near the 50 cP target, got {vcp}"
    );
}

#[test]
fn flat_curve_produces_no_crossing_but_still_writes_target() {
    let raw = synthetic_no_crossing_points();
    let inputs = to_touch_inputs(&raw);
    let out = compute_from_inputs(&inputs).expect("flat input is still non-empty");

    assert!(!out.has_crossing);
    assert!(out.crossing_time_min.is_none());
    assert!(out.crossing_viscosity_cp.is_none());
    // Target-time viscosity should be populated — the 10-min mark
    // lives inside the sample range and the value is ~150 cP.
    let target = out
        .viscosity_at_target_cp
        .expect("target-time viscosity present");
    assert!(
        (100.0..=200.0).contains(&target),
        "target viscosity should reflect the flat curve, got {target}"
    );
}

#[test]
fn to_touch_inputs_tolerates_malformed_entries() {
    let raw = vec![
        json!({ "timeSec": 0.0, "viscosityCp": 100.0, "shearRate": 511.0 }),
        json!({ "not a point": true }),
        json!({ "timeSec": 60.0, "viscosityCp": 80.0, "shearRate": 511.0 }),
    ];
    let inputs = to_touch_inputs(&raw);
    // Malformed entries deserialise to RheoPoint::default() (time_sec=0,
    // viscosity=0) because every field is `#[serde(default)]`, so we do
    // get three points back — but the two real ones must still carry
    // their original values.
    assert_eq!(inputs.len(), 3);
    assert_eq!(inputs[0].time_min, 0.0);
    assert_eq!(inputs[0].viscosity_cp, 100.0);
    assert_eq!(inputs[2].time_min, 1.0);
    assert_eq!(inputs[2].viscosity_cp, 80.0);
}

#[test]
fn to_touch_inputs_from_columns_handles_missing_shear_rate() {
    let mut channels: HashMap<String, Vec<Option<f64>>> = HashMap::new();
    channels.insert(
        "timeSec".to_string(),
        vec![Some(0.0), Some(60.0), Some(120.0)],
    );
    channels.insert(
        "viscosityCp".to_string(),
        vec![Some(100.0), Some(80.0), Some(40.0)],
    );
    let inputs = to_touch_inputs_from_columns(&channels);

    assert_eq!(inputs.len(), 3);
    for p in &inputs {
        assert_eq!(p.shear_rate, 0.0, "missing shearRate must fall back to 0.0");
    }
}

#[test]
fn to_touch_inputs_from_columns_returns_empty_without_required_channels() {
    let mut channels: HashMap<String, Vec<Option<f64>>> = HashMap::new();
    channels.insert("temperatureC".to_string(), vec![Some(70.0)]);
    let inputs = to_touch_inputs_from_columns(&channels);
    assert!(
        inputs.is_empty(),
        "missing timeSec / viscosityCp must yield an empty input vector"
    );
}

#[test]
fn empty_precompute_result_has_has_crossing_false() {
    let e = PrecomputedTouchPoint::empty();
    assert!(!e.has_crossing);
    assert!(e.crossing_time_min.is_none());
    assert!(e.crossing_viscosity_cp.is_none());
    assert!(e.viscosity_at_target_cp.is_none());
}

#[test]
fn to_touch_inputs_from_columns_accepts_snake_case_channels() {
    // Real persisted experiments carry snake_case channel names
    // (time_sec / viscosity_cp / shear_rate_s1) — the columnar encoder
    // preserves the JSON keys verbatim. The lookup must recognise them
    // or the slow-path filter collapses every row to has_crossing=false.
    let mut channels: HashMap<String, Vec<Option<f64>>> = HashMap::new();
    channels.insert(
        "time_sec".to_string(),
        vec![Some(0.0), Some(60.0), Some(120.0)],
    );
    channels.insert(
        "viscosity_cp".to_string(),
        vec![Some(200.0), Some(150.0), Some(40.0)],
    );
    channels.insert(
        "shear_rate_s1".to_string(),
        vec![Some(511.0), Some(511.0), Some(511.0)],
    );
    let inputs = to_touch_inputs_from_columns(&channels);
    assert_eq!(inputs.len(), 3, "snake_case channels must be recognised");
    assert_eq!(inputs[0].viscosity_cp, 200.0);
    assert_eq!(inputs[1].time_min, 1.0);
    assert_eq!(inputs[2].shear_rate, 511.0);
}

#[test]
fn backfill_reprocesses_rows_with_outdated_precompute_version() {
    // A row written by a previous algorithm version (with a bogus
    // has_crossing=false verdict) must be picked up by the backfill
    // so the v2 alias-tolerant lookup can correct the result.
    use crate::db::migration::run_migrations;

    let conn = Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();

    // Seed the parent User row — Experiment.userId is NOT NULL with
    // FK → User(id), so a bare-minimum row gives the INSERT a target.
    conn.execute(
        "INSERT INTO User (id, name, email, role, isActive, createdAt, updatedAt) \
         VALUES ('test-user', 'Test User', 'test@example.com', 'admin', 1, \
                 '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')",
        [],
    )
    .unwrap();

    // Seed a minimal Experiment row — NOT NULL fields only.
    conn.execute(
        "INSERT INTO Experiment \
           (id, createdAt, updatedAt, originalFilename, testDate, instrumentType, \
            waterSource, fluidType, testGroup, name, rawPoints, metrics, userId, \
            touchPrecomputeVersion, touchHasCrossing) \
         VALUES (?1, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', \
                 'tp_stale.csv', '2024-01-01', 'BSL R1', \
                 'Well', 'Linear', 'Rheology', 'stale-v1', '[]', '{}', 'test-user', \
                 ?2, 0)",
        params!["exp_stale_v1", TOUCH_PRECOMPUTE_VERSION - 1],
    )
    .unwrap();

    // Seed a blob whose channel names are snake_case (production shape).
    let raw_points: Vec<Value> = (0..=120)
        .map(|i| {
            let t = i as f64 * 6.0;
            let frac = (i as f64) / 120.0;
            let v = 200.0 + (10.0 - 200.0) * frac;
            json!({
                "time_sec": t,
                "viscosity_cp": v,
                "shear_rate_s1": 511.0,
                "temperature_c": 70.0,
            })
        })
        .collect();
    let blob = crate::db::columnar::encode(&raw_points).unwrap();
    conn.execute(
        "INSERT INTO ExperimentData \
           (experimentId, dataBlob, encoding, pointCount, createdAt, updatedAt) \
         VALUES (?1, ?2, 'columnar-v1-zstd', ?3, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')",
        params!["exp_stale_v1", blob, raw_points.len() as i64],
    )
    .unwrap();

    // Running backfill must target the stale row and recompute.
    let stats = run_touch_point_backfill(&conn).unwrap();
    assert_eq!(stats.processed, 1, "stale v1 row must be reprocessed");

    // After backfill, v2 + has_crossing=true for a 200→10 cP curve.
    let (version, has_crossing): (i64, i64) = conn
        .query_row(
            "SELECT touchPrecomputeVersion, touchHasCrossing FROM Experiment WHERE id = ?1",
            params!["exp_stale_v1"],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(version, TOUCH_PRECOMPUTE_VERSION);
    assert_eq!(
        has_crossing, 1,
        "after re-precompute, curve that decisively crosses 50 cP must be flagged"
    );
}
