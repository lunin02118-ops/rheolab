//! Unit tests for touch-point calculation.

use super::algorithm::calculate_smart_touch_points;
use super::helpers::{filter_by_shear_rate, find_dominant_shear_rate, find_viscosity_peak};
use super::types::{SmartTouchPointOptions, TouchPointAnomaly, TouchPointInput, TouchPointType};

fn make_point(time_min: f64, viscosity_cp: f64, shear_rate: f64) -> TouchPointInput {
    TouchPointInput {
        time_min,
        viscosity_cp,
        shear_rate,
    }
}

#[test]
fn test_dominant_shear_rate_single_cluster() {
    let points = vec![
        make_point(0.0, 500.0, 100.0),
        make_point(1.0, 500.0, 101.0),
        make_point(2.0, 500.0, 99.0),
        make_point(3.0, 500.0, 200.0), // outlier (ramp)
    ];
    let rate = find_dominant_shear_rate(&points, 0.05).expect("dominant rate detected");
    assert!((rate - 100.0).abs() < 5.0, "expected ~100, got {}", rate);
}

#[test]
fn test_dominant_shear_rate_no_data() {
    let points = vec![make_point(0.0, 500.0, 0.0)]; // no shear-rate data
    assert!(find_dominant_shear_rate(&points, 0.05).is_none());
}

#[test]
fn test_filter_by_shear_rate() {
    let points = vec![
        make_point(0.0, 500.0, 100.0),
        make_point(1.0, 400.0, 200.0), // ramp
        make_point(2.0, 300.0, 102.0),
        make_point(3.0, 250.0, 98.0),
    ];
    let filtered = filter_by_shear_rate(&points, 100.0, 0.05);
    assert_eq!(filtered.len(), 3); // 100, 102, 98 are within ±5%
}

#[test]
fn test_viscosity_peak_detected() {
    // Rising then falling viscosity
    let mut points = Vec::new();
    for i in 0..30 {
        let t = i as f64 * 0.5; // 0..15 min, step 0.5
        let v = if t < 5.0 {
            500.0 + t * 100.0 // rising to 1000
        } else {
            1000.0 - (t - 5.0) * 50.0 // falling
        };
        points.push(make_point(t, v, 100.0));
    }
    let peak = find_viscosity_peak(&points, 1.0);
    assert!(peak.is_some(), "peak should be detected");
    let pt = peak.expect("peak detected");
    assert!(
        pt >= 3.0 && pt <= 7.0,
        "peak should be near t=5, got {}",
        pt
    );
}

#[test]
fn test_no_peak_monotonically_falling() {
    let points: Vec<TouchPointInput> = (0..20)
        .map(|i| {
            let t = i as f64 * 0.5;
            make_point(t, 1000.0 - t * 30.0, 100.0)
        })
        .collect();
    // Monotonically falling → decline detected from the very start → peak is near beginning
    let peak = find_viscosity_peak(&points, 1.0);
    assert!(
        peak.is_some(),
        "monotonically falling data has peak at start"
    );
    assert!(
        peak.expect("peak detected") < 1.0,
        "peak should be near t=0"
    );
}

#[test]
fn test_smart_touch_points_basic() {
    // Simulate: rising 0-5min (ramp-up), then falling 5-20min crossing 500cP at ~15min
    let mut points = Vec::new();
    for i in 0..40 {
        let t = i as f64 * 0.5;
        let v = if t < 5.0 {
            300.0 + t * 140.0 // 300 → 1000
        } else {
            1000.0 - (t - 5.0) * 40.0 // 1000 → 400 at t=20
        };
        points.push(make_point(t, v, 100.0));
    }

    let results = calculate_smart_touch_points(
        &points,
        &SmartTouchPointOptions {
            viscosity_threshold: 500.0,
            show_target_time: true,
            target_time: 10.0,
            ..Default::default()
        },
    );

    // Should have threshold and target
    let threshold = results
        .iter()
        .find(|r| matches!(r.tp_type, TouchPointType::Threshold));
    assert!(threshold.is_some(), "threshold should be found");
    let tp = threshold.expect("threshold found");
    assert!(
        tp.time > 5.0,
        "threshold should be after peak (t=5), got {}",
        tp.time
    );

    let target = results
        .iter()
        .find(|r| matches!(r.tp_type, TouchPointType::Target));
    assert!(target.is_some(), "target-time should be found");
    assert!((target.expect("target found").time - 10.0).abs() < 0.01);
}

#[test]
fn test_smart_touch_points_filters_shear_ramps() {
    // Main speed 100 s⁻¹, ramp at 200 s⁻¹ drops viscosity below threshold
    let points = vec![
        make_point(0.0, 800.0, 100.0),
        make_point(1.0, 900.0, 100.0),
        make_point(2.0, 1000.0, 100.0),
        make_point(3.0, 1050.0, 100.0),
        make_point(4.0, 1000.0, 100.0), // start declining
        make_point(5.0, 950.0, 100.0),
        make_point(6.0, 900.0, 100.0),
        // Ramp at 200 s⁻¹ — viscosity drops to 400 (should be IGNORED)
        make_point(7.0, 400.0, 200.0),
        make_point(7.5, 350.0, 200.0),
        // Back to 100 s⁻¹ — sustained decline through threshold
        make_point(8.0, 850.0, 100.0),
        make_point(9.0, 800.0, 100.0),
        make_point(10.0, 750.0, 100.0),
        make_point(11.0, 700.0, 100.0),
        make_point(12.0, 600.0, 100.0),
        make_point(13.0, 500.0, 100.0),
        make_point(14.0, 480.0, 100.0),
        make_point(15.0, 460.0, 100.0),
        make_point(16.0, 440.0, 100.0),
        make_point(17.0, 420.0, 100.0),
        make_point(18.0, 400.0, 100.0),
    ];

    let results = calculate_smart_touch_points(
        &points,
        &SmartTouchPointOptions {
            viscosity_threshold: 500.0,
            show_target_time: false,
            target_time: 10.0,
            ..Default::default()
        },
    );

    let threshold = results
        .iter()
        .find(|r| matches!(r.tp_type, TouchPointType::Threshold));
    assert!(threshold.is_some(), "threshold should be found");
    let tp = threshold.expect("threshold found");
    // Should NOT find the ramp drop at t=7; should find the real crossing at ~t=13
    assert!(
        tp.time >= 12.0,
        "threshold should be at ~13min (not at ramp t=7), got {}",
        tp.time
    );
}

#[test]
fn test_smart_touch_points_no_shear_data_falls_back() {
    // All shear_rate = 0 → should fall back to using all points
    let points: Vec<TouchPointInput> = (0..30)
        .map(|i| {
            let t = i as f64;
            make_point(t, 1000.0 - t * 25.0, 0.0) // no shear data
        })
        .collect();

    let results = calculate_smart_touch_points(
        &points,
        &SmartTouchPointOptions {
            viscosity_threshold: 500.0,
            show_target_time: false,
            target_time: 10.0,
            ..Default::default()
        },
    );

    let threshold = results
        .iter()
        .find(|r| matches!(r.tp_type, TouchPointType::Threshold));
    assert!(
        threshold.is_some(),
        "should find threshold even without shear-rate data"
    );
}

/// BUG #4 regression (mirror of the TS test):
/// `target_time` that straddles a shear-rate jump must snap to the nearest
/// raw data point and set `anomaly = ShearRateJump` instead of
/// interpolating across the vertical curve discontinuity.
#[test]
fn test_target_time_snaps_on_shear_rate_jump() {
    let mut points: Vec<TouchPointInput> = Vec::new();
    let mut t = 0.0;
    while t <= 9.5 {
        points.push(make_point(t, 400.0, 100.0));
        t += 0.25;
    }
    points.push(make_point(10.0, 900.0, 300.0)); // pulse at a different rate
    t = 10.5;
    while t <= 20.0 {
        points.push(make_point(t, 420.0, 100.0));
        t += 0.25;
    }

    let results = calculate_smart_touch_points(
        &points,
        &SmartTouchPointOptions {
            viscosity_threshold: 100.0,
            show_target_time: true,
            target_time: 9.9,
            ..Default::default()
        },
    );

    let target = results
        .iter()
        .find(|r| matches!(r.tp_type, TouchPointType::Target))
        .expect("target-time marker must be present");
    assert_eq!(target.anomaly, Some(TouchPointAnomaly::ShearRateJump));
    // The marker is snapped to one of the two neighbouring raw points
    // (400 or 900 cP), never interpolated to the meaningless ~650 cP.
    assert!(
        (target.viscosity - 400.0).abs() < 1e-6 || (target.viscosity - 900.0).abs() < 1e-6,
        "expected 400 or 900 cP, got {}",
        target.viscosity
    );
}

/// BUG #10 regression (mirror of the TS test): NaN / ±Infinity inputs
/// must be filtered out at the entry point and must not poison any
/// downstream statistic.  Valid neighbours around the dropped points
/// continue to contribute to threshold / target-time detection.
#[test]
fn test_sanitises_non_finite_inputs() {
    let mut points: Vec<TouchPointInput> = Vec::new();
    for t in 0..=20 {
        let t_f = t as f64;
        if t == 5 {
            points.push(make_point(t_f, f64::NAN, 100.0));
        } else if t == 12 {
            points.push(make_point(t_f, f64::INFINITY, 100.0));
        } else if t == 15 {
            // Valid viscosity but non-finite rate — kept with rate=0.
            points.push(make_point(t_f, 0.0, f64::NAN));
        } else {
            points.push(make_point(t_f, 1000.0 - t_f * 40.0, 100.0));
        }
    }

    let results = calculate_smart_touch_points(
        &points,
        &SmartTouchPointOptions {
            viscosity_threshold: 300.0,
            show_target_time: true,
            target_time: 10.0,
            ..Default::default()
        },
    );
    for r in &results {
        assert!(r.time.is_finite(), "time must be finite, got {}", r.time);
        assert!(
            r.viscosity.is_finite(),
            "viscosity must be finite, got {}",
            r.viscosity
        );
    }
    let target = results
        .iter()
        .find(|r| matches!(r.tp_type, TouchPointType::Target))
        .expect("target-time marker must be present");
    assert!(
        target.viscosity > 500.0 && target.viscosity < 700.0,
        "expected ≈600 cP at t=10 on the decay curve, got {}",
        target.viscosity
    );
}

#[test]
fn test_all_non_finite_returns_empty() {
    let points = vec![
        make_point(f64::NAN, 500.0, 100.0),
        make_point(1.0, f64::NAN, 100.0),
        make_point(2.0, 500.0, f64::NAN),
    ];
    let results = calculate_smart_touch_points(
        &points,
        &SmartTouchPointOptions {
            viscosity_threshold: 1000.0,
            show_target_time: false,
            target_time: 0.0,
            ..Default::default()
        },
    );
    assert!(
        results.is_empty(),
        "expected empty result, got {:?}",
        results.len()
    );
}

#[test]
fn test_target_time_plain_interpolation_on_single_plateau() {
    let points: Vec<TouchPointInput> = (0..=20)
        .map(|i| make_point(i as f64, 1000.0 - (i as f64) * 40.0, 100.0))
        .collect();

    let results = calculate_smart_touch_points(
        &points,
        &SmartTouchPointOptions {
            viscosity_threshold: 100.0,
            show_target_time: true,
            target_time: 5.5,
            ..Default::default()
        },
    );

    let target = results
        .iter()
        .find(|r| matches!(r.tp_type, TouchPointType::Target))
        .expect("target-time marker must be present");
    assert!(
        target.anomaly.is_none(),
        "no anomaly expected on a single plateau"
    );
    // Linear interpolation between (5,800) and (6,760) ⇒ 780 cP.
    assert!(
        (target.viscosity - 780.0).abs() < 1e-6,
        "expected 780 cP (linear interp), got {}",
        target.viscosity
    );
}
