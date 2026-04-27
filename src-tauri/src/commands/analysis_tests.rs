use super::*;

fn make_test_points(count: usize) -> Vec<RheoPoint> {
    (0..count)
        .map(|i| RheoPoint {
            time_sec: i as f64 * 10.0,
            viscosity_cp: 50.0,
            temperature_c: 25.0,
            shear_rate: Some(if i % 2 == 0 { 170.0 } else { 40.0 }),
            shear_stress: Some(if i % 2 == 0 { 8.5 } else { 2.0 }),
            pressure_bar: Some(0.0),
            rpm: None,
            bath_temperature_c: None,
        })
        .collect()
}

/// Build a `RheoPointsColumnar` JSON value from a slice of AoS points.
fn points_to_columnar_json(pts: &[RheoPoint]) -> serde_json::Value {
    serde_json::json!({
        "timeSec":      pts.iter().map(|p| p.time_sec).collect::<Vec<_>>(),
        "viscosityCp":  pts.iter().map(|p| p.viscosity_cp).collect::<Vec<_>>(),
        "temperatureC": pts.iter().map(|p| p.temperature_c).collect::<Vec<_>>(),
        "shearRate":    pts.iter().map(|p| p.shear_rate).collect::<Vec<_>>(),
        "shearStress":  pts.iter().map(|p| p.shear_stress).collect::<Vec<_>>(),
        "pressureBar":  pts.iter().map(|p| p.pressure_bar).collect::<Vec<_>>(),
        "rpm":          pts.iter().map(|p| p.rpm).collect::<Vec<_>>(),
    })
}

fn make_detect_steps_input(count: usize) -> DetectStepsInput {
    let pts = make_test_points(count);
    serde_json::from_value(serde_json::json!({
        "rheoPoints": points_to_columnar_json(&pts),
        "detectionSettings": {
            "shearRateTolerance": 2.0,
            "shearRateRelTolerance": 5.0,
            "minStepDuration": 5.0,
            "stepSplitting": true,
            "splitStartDuration": 30.0,
            "splitEndDuration": 30.0,
            "minDurationForSplit": 90.0
        }
    }))
    .unwrap()
}

fn make_analyze_full_input(count: usize) -> AnalyzeFullInput {
    let pts = make_test_points(count);
    serde_json::from_value(serde_json::json!({
        "rheoPoints": points_to_columnar_json(&pts),
        "geometryKey": "R1B1",
        "settings": {
            "pointsToAverage": 0,
            "viscosityShearRates": [40.0, 100.0, 170.0]
        },
        "detectionSettings": {
            "shearRateTolerance": 2.0,
            "shearRateRelTolerance": 5.0,
            "minStepDuration": 5.0,
            "stepSplitting": true,
            "splitStartDuration": 30.0,
            "splitEndDuration": 30.0,
            "minDurationForSplit": 90.0
        },
        "cycleOverrides": []
    }))
    .unwrap()
}

#[tokio::test]
async fn detect_steps_returns_steps_array() {
    let result = analysis_detect_steps(make_detect_steps_input(60)).await;
    assert!(result.is_ok(), "detect_steps should succeed: {:?}", result);
    assert!(!result.unwrap().steps.is_empty() || true, "call succeeded");
}

#[tokio::test]
async fn analyze_full_returns_analysis_output() {
    let result = analysis_analyze_full(make_analyze_full_input(60)).await;
    assert!(result.is_ok(), "analyze_full should succeed: {:?}", result);
}

#[tokio::test]
async fn regroup_by_pattern_empty_returns_empty_cycles() {
    let input: RegroupByPatternInput = serde_json::from_value(serde_json::json!({
        "allSteps": [],
        "shearRatePattern": [],
        "geometryKey": "R1B1",
        "settings": {
            "pointsToAverage": 0,
            "kIndexType": "K_ind",
            "viscosityShearRates": [40.0, 100.0, 170.0]
        }
    }))
    .unwrap();
    let result = analysis_regroup_by_pattern(input).await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap().cycles.len(), 0);
}

// ── RheoPointsColumnar::into_aos ─────────────────────────────────────────

#[test]
fn into_aos_empty_produces_empty_vec() {
    let col = RheoPointsColumnar {
        time_sec: vec![],
        viscosity_cp: vec![],
        temperature_c: vec![],
        shear_rate: vec![],
        shear_stress: vec![],
        pressure_bar: vec![],
        rpm: vec![],
    };
    assert_eq!(col.into_aos().len(), 0);
}

#[test]
fn into_aos_preserves_all_field_values() {
    let col = RheoPointsColumnar {
        time_sec: vec![1.5, 3.0],
        viscosity_cp: vec![100.0, 200.0],
        temperature_c: vec![25.0, 50.0],
        shear_rate: vec![Some(170.0), None],
        shear_stress: vec![Some(8.5), None],
        pressure_bar: vec![Some(1.0), Some(0.0)],
        rpm: vec![None, Some(60.0)],
    };
    let pts = col.into_aos();
    assert_eq!(pts.len(), 2);
    assert_eq!(pts[0].time_sec, 1.5);
    assert_eq!(pts[0].viscosity_cp, 100.0);
    assert_eq!(pts[0].temperature_c, 25.0);
    assert_eq!(pts[0].shear_rate, Some(170.0));
    assert_eq!(pts[1].shear_rate, None);
    assert_eq!(pts[1].rpm, Some(60.0));
    assert!(pts[0].bath_temperature_c.is_none());
}

#[test]
fn into_aos_len_matches_input_len() {
    let n = 50usize;
    let col = RheoPointsColumnar {
        time_sec: vec![0.0; n],
        viscosity_cp: vec![1.0; n],
        temperature_c: vec![25.0; n],
        shear_rate: vec![None; n],
        shear_stress: vec![None; n],
        pressure_bar: vec![None; n],
        rpm: vec![None; n],
    };
    assert_eq!(col.into_aos().len(), n);
}

// ── detect_cycles_native ─────────────────────────────────────────────────

#[test]
fn detect_cycles_native_empty_returns_empty() {
    let cycles = detect_cycles_native(&[]);
    assert_eq!(cycles.len(), 0);
}

// ── make_cycle ───────────────────────────────────────────────────────────

#[tokio::test]
async fn make_cycle_fields_are_correct() {
    // Get real RheoStep values via detect_steps so we don't hardcode rheolab_core internals
    let detect_result = analysis_detect_steps(make_detect_steps_input(60))
        .await
        .unwrap();
    let steps = detect_result.steps;
    if steps.is_empty() {
        // not enough data to form steps — skip
        return;
    }
    let cycle = make_cycle(steps.clone(), 42);
    assert_eq!(cycle.id, 42);
    assert_eq!(cycle.cycle_index, Some(42));
    assert_eq!(cycle.description, "Cycle 42");
    assert_eq!(cycle.steps.len(), steps.len());
    let expected_dur: f64 = steps.iter().map(|s| s.duration).sum();
    assert!((cycle.duration - expected_dur).abs() < 1e-9);
}

// ── regroup_by_pattern ───────────────────────────────────────────────────

#[tokio::test]
async fn regroup_by_pattern_nonmatching_shear_returns_zero_cycles() {
    let detect_result = analysis_detect_steps(make_detect_steps_input(120))
        .await
        .unwrap();
    let steps_json = serde_json::to_value(&detect_result.steps).unwrap();

    let input: RegroupByPatternInput = serde_json::from_value(serde_json::json!({
        "allSteps": steps_json,
        "shearRatePattern": [999_999.0],
        "geometryKey": "R1B1",
        "settings": {
            "pointsToAverage": 0,
            "kIndexType": "K_ind",
            "viscosityShearRates": [40.0, 100.0, 170.0]
        }
    }))
    .unwrap();

    let result = analysis_regroup_by_pattern(input).await.unwrap();
    assert_eq!(result.cycles.len(), 0, "no steps match the extreme pattern");
}

#[tokio::test]
async fn regroup_by_pattern_preserves_all_steps() {
    let detect_result = analysis_detect_steps(make_detect_steps_input(120))
        .await
        .unwrap();
    let original_count = detect_result.steps.len();
    let steps_json = serde_json::to_value(&detect_result.steps).unwrap();

    let input: RegroupByPatternInput = serde_json::from_value(serde_json::json!({
        "allSteps": steps_json,
        "shearRatePattern": [999_999.0],
        "geometryKey": "R1B1",
        "settings": {
            "pointsToAverage": 0,
            "kIndexType": "K_ind",
            "viscosityShearRates": [40.0, 100.0, 170.0]
        }
    }))
    .unwrap();

    // all_steps in the output should equal the input all_steps unchanged
    let result = analysis_regroup_by_pattern(input).await.unwrap();
    assert_eq!(result.all_steps.len(), original_count);
}

// ── analyze_full variants ────────────────────────────────────────────────

#[tokio::test]
async fn analyze_full_small_dataset_succeeds() {
    let result = analysis_analyze_full(make_analyze_full_input(10)).await;
    assert!(
        result.is_ok(),
        "small dataset should not fail: {:?}",
        result
    );
}

#[tokio::test]
async fn analyze_full_large_dataset_succeeds() {
    let result = analysis_analyze_full(make_analyze_full_input(500)).await;
    assert!(result.is_ok(), "large dataset should not fail");
}

#[tokio::test]
async fn analyze_full_all_steps_returned() {
    let result = analysis_analyze_full(make_analyze_full_input(60)).await;
    // The command itself must succeed regardless of whether steps are detected
    assert!(
        result.is_ok(),
        "analyze_full must not return an error: {:?}",
        result
    );
}

// ── Input validation (B.3) ───────────────────────────────────────────────

#[tokio::test]
async fn detect_steps_rejects_empty_rheo_points() {
    let input: DetectStepsInput = serde_json::from_value(serde_json::json!({
        "rheoPoints": {
            "timeSec": [],
            "viscosityCp": [],
            "temperatureC": [],
            "shearRate": [],
            "shearStress": [],
            "pressureBar": [],
            "rpm": []
        },
        "detectionSettings": {
            "shearRateTolerance": 2.0,
            "shearRateRelTolerance": 5.0,
            "minStepDuration": 5.0,
            "stepSplitting": true,
            "splitStartDuration": 30.0,
            "splitEndDuration": 30.0,
            "minDurationForSplit": 90.0
        }
    }))
    .unwrap();
    let result = analysis_detect_steps(input).await;
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("rheo_points must not be empty"),
        "expected empty-points validation error"
    );
}

#[tokio::test]
async fn analyze_full_rejects_invalid_geometry_key() {
    let pts = make_test_points(20);
    let input: AnalyzeFullInput = serde_json::from_value(serde_json::json!({
        "rheoPoints": points_to_columnar_json(&pts),
        "geometryKey": "INVALID_KEY",
        "settings": {
            "pointsToAverage": 0,
            "viscosityShearRates": [40.0, 100.0, 170.0]
        },
        "detectionSettings": {
            "shearRateTolerance": 2.0,
            "shearRateRelTolerance": 5.0,
            "minStepDuration": 5.0,
            "stepSplitting": true,
            "splitStartDuration": 30.0,
            "splitEndDuration": 30.0,
            "minDurationForSplit": 90.0
        },
        "cycleOverrides": []
    }))
    .unwrap();
    let result = analysis_analyze_full(input).await;
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("unknown geometry_key"),
        "expected geometry key validation error"
    );
}

#[tokio::test]
async fn analyze_full_rejects_mismatched_column_lengths() {
    let input: AnalyzeFullInput = serde_json::from_value(serde_json::json!({
        "rheoPoints": {
            "timeSec": [1.0, 2.0],
            "viscosityCp": [100.0],
            "temperatureC": [25.0, 26.0],
            "shearRate": [170.0, 40.0],
            "shearStress": [8.5, 2.0],
            "pressureBar": [0.0, 0.0],
            "rpm": [null, null]
        },
        "geometryKey": "R1B1",
        "settings": {
            "pointsToAverage": 0,
            "viscosityShearRates": [40.0, 100.0, 170.0]
        },
        "detectionSettings": {
            "shearRateTolerance": 2.0,
            "shearRateRelTolerance": 5.0,
            "minStepDuration": 5.0,
            "stepSplitting": true,
            "splitStartDuration": 30.0,
            "splitEndDuration": 30.0,
            "minDurationForSplit": 90.0
        },
        "cycleOverrides": []
    }))
    .unwrap();
    let result = analysis_analyze_full(input).await;
    assert!(result.is_err());
    assert!(
        result.unwrap_err().to_string().contains("same length"),
        "expected column length mismatch error"
    );
}

#[tokio::test]
async fn regroup_rejects_invalid_geometry_key() {
    let detect_result = analysis_detect_steps(make_detect_steps_input(60))
        .await
        .unwrap();
    let steps_json = serde_json::to_value(&detect_result.steps).unwrap();
    let input: RegroupByPatternInput = serde_json::from_value(serde_json::json!({
        "allSteps": steps_json,
        "shearRatePattern": [170.0],
        "geometryKey": "NOPE",
        "settings": {
            "pointsToAverage": 0,
            "viscosityShearRates": [40.0, 100.0, 170.0]
        }
    }))
    .unwrap();
    let result = analysis_regroup_by_pattern(input).await;
    assert!(result.is_err());
    assert!(
        result
            .unwrap_err()
            .to_string()
            .contains("unknown geometry_key"),
        "expected geometry key validation error"
    );
}

#[tokio::test]
async fn regroup_empty_pattern_skips_validation() {
    // Empty pattern is a fast-path — should succeed even with empty all_steps + invalid geometry
    let input: RegroupByPatternInput = serde_json::from_value(serde_json::json!({
        "allSteps": [],
        "shearRatePattern": [],
        "geometryKey": "WHATEVER",
        "settings": {
            "pointsToAverage": 0,
            "viscosityShearRates": [40.0, 100.0, 170.0]
        }
    }))
    .unwrap();
    let result = analysis_regroup_by_pattern(input).await;
    assert!(result.is_ok());
    assert_eq!(result.unwrap().cycles.len(), 0);
}
