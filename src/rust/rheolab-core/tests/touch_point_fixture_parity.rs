//! Real-fixture parity test: runs the Rust `calculate_smart_touch_points`
//! against the very same Grace 3600 JSON snapshot that the TypeScript
//! regression suite uses (`tests/fixtures/t-20.02.26-1-561-110C.json`),
//! and asserts the same contract:
//!
//!   * threshold crossing time falls in the 180–220 min window;
//!   * threshold viscosity lands on the actual data curve (≤ 50 cP);
//!   * all result coordinates are finite.
//!
//! If the Rust output drifts from the TS reference here, the frontend
//! chart and the PDF / Excel reports will disagree about where the
//! touch-point is — which is exactly the BUG #11 class that this file
//! is meant to lock down.

use rheolab_core::report_generator::touch_point::{
    calculate_smart_touch_points, SmartTouchPointOptions, TouchPointInput, TouchPointType,
};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

/// Load the JSON-encoded Grace 3600 fixture.  Path is resolved relative
/// to the workspace root so the test works both from `cargo test` in the
/// crate directory and from `cargo test --manifest-path …`.
fn load_fixture() -> Vec<TouchPointInput> {
    // `CARGO_MANIFEST_DIR` points at `src/rust/rheolab-core/`.  The
    // workspace root (`Rheolab/`) is exactly three levels up.
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .expect("cannot resolve workspace root from CARGO_MANIFEST_DIR");
    let fixture_path = workspace_root
        .join("tests")
        .join("fixtures")
        .join("t-20.02.26-1-561-110C.json");

    let raw = fs::read_to_string(&fixture_path)
        .unwrap_or_else(|e| panic!("cannot read fixture {:?}: {}", fixture_path, e));
    let value: Value = serde_json::from_str(&raw).expect("fixture JSON is invalid");
    let array = value.as_array().expect("fixture must be a JSON array");

    array
        .iter()
        .map(|obj| {
            let time_min = obj["time_min"].as_f64().expect("time_min must be a number");
            let viscosity_cp = obj["viscosity_cp"]
                .as_f64()
                .expect("viscosity_cp must be a number");
            let shear_rate = obj["shear_rate"].as_f64().unwrap_or(0.0);
            TouchPointInput {
                time_min,
                viscosity_cp,
                shear_rate,
            }
        })
        .collect()
}

#[test]
fn fixture_snapshot_is_well_formed() {
    let pts = load_fixture();
    assert!(pts.len() >= 600, "expected ≥600 data points, got {}", pts.len());
    let last_time = pts.last().map(|p| p.time_min).unwrap_or(0.0);
    assert!(last_time > 290.0, "expected run to span >290 min, got {}", last_time);
}

#[test]
fn detects_threshold_crossing_in_the_180_220_min_window() {
    let pts = load_fixture();
    let results = calculate_smart_touch_points(
        &pts,
        &SmartTouchPointOptions {
            viscosity_threshold: 50.0,
            show_target_time: false,
            target_time: 10.0,
            ..Default::default()
        },
    );
    let threshold = results
        .iter()
        .find(|r| matches!(r.tp_type, TouchPointType::Threshold))
        .expect("threshold crossing must be detected");

    // Must NOT fire in the low-shear-rate startup phase (< 30 min) or way
    // past the true gel-break window (> 220 min) — guards against the
    // exact failure mode that BUG #11 sets out to prevent.
    assert!(
        threshold.time >= 180.0 && threshold.time <= 220.0,
        "expected crossing in 180..=220 min, got {}",
        threshold.time,
    );
    assert!(
        threshold.viscosity <= 50.0 && threshold.viscosity > 0.0,
        "expected crossing viscosity in (0, 50] cP, got {}",
        threshold.viscosity,
    );
    assert!(threshold.time.is_finite() && threshold.viscosity.is_finite());
}
