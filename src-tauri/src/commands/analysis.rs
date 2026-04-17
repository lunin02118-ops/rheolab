//! Native analysis pipeline commands for desktop mode.
//!
//! Executes rheology calculations directly in Rust via `tokio::spawn_blocking`,
//! replacing the old browser-side WebAssembly pipeline.
//!
//! Four commands mirror the four worker message types:
//! - `analysis_analyze_full`        в†ђ `ANALYZE_FULL`
//! - `analysis_detect_steps`        в†ђ `DETECT_STEPS`
//! - `analysis_regroup_by_pattern`  в†ђ `REGROUP_BY_PATTERN`
//! - `analysis_calculate_models`    в†ђ `CALCULATE_MODELS`

use crate::error::{AppError, Result};
use rheolab_core::{
    calculate_grace_internal, detect_anchor_cycles_internal,
    detect_repeating_sequence_cycles_internal, detect_sst_cycles_internal,
    is_repeating_sequence_pattern, is_sst_pattern, process_cycle_internal,
    ExpertSettings, GraceCycleResult, GraceInputParams,
};
use rheolab_core::parasitic_filter::filter_parasitic_steps;
use rheolab_core::schedule_detector::{detect_schedule, ScheduleConfig};
use rheolab_core::types::{RheoCycle, RheoPoint, RheoStep};
use serde::{Deserialize, Serialize};

/// Known geometry keys supported by `rheolab_core::grace::get_geometry()`.
/// Any unrecognised key silently falls back to R1B5 in the core —
/// we validate up-front to surface the problem early.
const KNOWN_GEOMETRY_KEYS: &[&str] = &["R1B1", "R1B2", "R1B5"];

fn validate_geometry_key(key: &str) -> Result<()> {
    if !KNOWN_GEOMETRY_KEYS.contains(&key) {
        return Err(AppError::BadRequest(format!(
            "unknown geometry_key '{}'; expected one of: {}",
            key,
            KNOWN_GEOMETRY_KEYS.join(", "),
        )));
    }
    Ok(())
}

// в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// Input / Output DTOs
// в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

/// Structure-of-Arrays input for raw rheometer points.
///
/// Avoids materialising N JS objects on the TypeScript side when columnar
/// `Float64Array` data is already available from the parser.  `into_aos()`
/// converts to the `Vec<RheoPoint>` expected by downstream pipeline helpers.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RheoPointsColumnar {
    pub time_sec: Vec<f64>,
    pub viscosity_cp: Vec<f64>,
    pub temperature_c: Vec<f64>,
    /// `null` encodes a missing (optional) measurement.
    pub shear_rate: Vec<Option<f64>>,
    pub shear_stress: Vec<Option<f64>>,
    pub pressure_bar: Vec<Option<f64>>,
    pub rpm: Vec<Option<f64>>,
}

impl RheoPointsColumnar {
    /// Validate that the columnar data is well-formed.
    fn validate(&self) -> Result<()> {
        let len = self.time_sec.len();
        if len == 0 {
            return Err(AppError::BadRequest("rheo_points must not be empty".into()));
        }
        // All columns must have the same length — a mismatch indicates a frontend bug.
        if self.viscosity_cp.len() != len
            || self.temperature_c.len() != len
            || self.shear_rate.len() != len
            || self.shear_stress.len() != len
            || self.pressure_bar.len() != len
            || self.rpm.len() != len
        {
            return Err(AppError::BadRequest(
                "rheo_points column arrays must all have the same length".into(),
            ));
        }
        Ok(())
    }

    /// Convert SoA → AoS, producing the `Vec<RheoPoint>` expected by the
    /// pipeline helpers (`detect_schedule`, `process_cycle_internal`, …).
    pub fn into_aos(self) -> Vec<RheoPoint> {
        let len = self.time_sec.len();
        (0..len)
            .map(|i| RheoPoint {
                time_sec: self.time_sec[i],
                viscosity_cp: self.viscosity_cp[i],
                temperature_c: self.temperature_c[i],
                shear_rate: self.shear_rate[i],
                shear_stress: self.shear_stress[i],
                pressure_bar: self.pressure_bar[i],
                rpm: self.rpm[i],
                bath_temperature_c: None,
            })
            .collect()
    }
}


#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeFullInput {
    rheo_points: RheoPointsColumnar,
    geometry_key: String,
    settings: ExpertSettings,
    detection_settings: ScheduleConfig,
    /// Serialised as `[[cycleId, [stepId, …]], …]` (JSON has no integer Map keys).
    #[serde(default)]
    cycle_overrides: Vec<(i32, Vec<i32>)>,
}

impl AnalyzeFullInput {
    fn validate(&self) -> Result<()> {
        self.rheo_points.validate()?;
        validate_geometry_key(&self.geometry_key)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectStepsInput {
    rheo_points: RheoPointsColumnar,
    detection_settings: ScheduleConfig,
}

impl DetectStepsInput {
    fn validate(&self) -> Result<()> {
        self.rheo_points.validate()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegroupByPatternInput {
    all_steps: Vec<RheoStep>,
    shear_rate_pattern: Vec<f64>,
    geometry_key: String,
    settings: ExpertSettings,
}

impl RegroupByPatternInput {
    fn validate(&self) -> Result<()> {
        // Empty pattern is a valid fast-path (returns empty cycles immediately).
        if self.shear_rate_pattern.is_empty() {
            return Ok(());
        }
        validate_geometry_key(&self.geometry_key)
    }
}

/// Shared output shape for commands that return cycles + results + steps.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisOutput {
    cycles: Vec<RheoCycle>,
    /// `[[cycleId, GraceCycleResult], вЂ¦]`
    results: Vec<(i32, GraceCycleResult)>,
    all_steps: Vec<RheoStep>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectStepsOutput {
    steps: Vec<RheoStep>,
}

// в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// Core pipeline helpers
// в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

/// Orchestrates cycle detection вЂ” mirrors `detectCyclesWasmOrchestrator` in the worker.
///
/// Priority:
/// 1. SST pattern в†’ `detect_sst_cycles_internal`
/// 2. Repeating sequence в†’ `detect_repeating_sequence_cycles_internal`
/// 3. Anchor-based в†’ `detect_anchor_cycles_internal`
/// 4. Fallback: single cycle containing all steps
fn detect_cycles_native(steps: &[RheoStep]) -> Vec<RheoCycle> {
    if steps.is_empty() {
        return Vec::new();
    }

    // 1. SST
    if is_sst_pattern(steps) {
        return detect_sst_cycles_internal(steps);
    }

    // 2. Repeating sequence
    if is_repeating_sequence_pattern(steps) {
        if let Some(cycles) = detect_repeating_sequence_cycles_internal(steps) {
            if cycles.len() >= 2 {
                return cycles;
            }
        }
    }

    // 3. Anchor-based
    let anchor_cycles = detect_anchor_cycles_internal(steps);
    if !anchor_cycles.is_empty() {
        return anchor_cycles;
    }

    // 4. Fallback: single cycle with all steps
    let duration: f64 = steps.iter().map(|s| s.duration).sum();
    vec![RheoCycle {
        id: 1,
        cycle_index: Some(1),
        cycle_type: "Custom".to_string(),
        steps: steps.to_vec(),
        description: "Cycle 1".to_string(),
        duration,
    }]
}

/// Processes a slice of cycles through the calculation pipeline.
///
/// Mirrors `processAllCyclesWasm` in the worker:
/// 1. Process cycle steps (remove mixing steps etc.) unless `skip_step_filtering`
/// 2. Re-compute step averages from last `pointsToAverage` raw points
/// 3. Extract `(shear_rate, shear_stress)` pairs
/// 4. Call `calculate_grace_internal`
fn process_all_cycles(
    cycles: &[RheoCycle],
    geometry_key: &str,
    settings: &ExpertSettings,
    skip_step_filtering: bool,
) -> (Vec<RheoCycle>, Vec<(i32, GraceCycleResult)>) {
    let mut results: Vec<(i32, GraceCycleResult)> = Vec::new();
    let mut processed_cycles: Vec<RheoCycle> = Vec::new();

    for cycle in cycles {
        // Step 1: filter mixing/ramp steps
        let filtered_steps: Vec<RheoStep> = if skip_step_filtering {
            cycle.steps.clone()
        } else {
            process_cycle_internal(cycle)
        };

        // Step 2: re-average from last N raw points
        let pts_avg = settings.points_to_average as usize;
        let processed_steps: Vec<RheoStep> = filtered_steps
            .iter()
            .map(|step| {
                if pts_avg > 0 && step.points.len() >= pts_avg {
                    let pts = &step.points[step.points.len() - pts_avg..];
                    let n = pts.len() as f64;
                    // Single-pass fold over the slice вЂ” avoids 5 separate iterator passes.
                    let (sum_sr, sum_ss, sum_vis, sum_temp, sum_press) = pts.iter().fold(
                        (0.0_f64, 0.0_f64, 0.0_f64, 0.0_f64, 0.0_f64),
                        |(sr, ss, vis, temp, press), p| (
                            sr   + p.shear_rate.unwrap_or(0.0),
                            ss   + p.shear_stress.unwrap_or(0.0),
                            vis  + p.viscosity_cp,
                            temp + p.temperature_c,
                            press + p.pressure_bar.unwrap_or(0.0),
                        ),
                    );
                    RheoStep {
                        avg_shear_rate:   sum_sr   / n,
                        avg_shear_stress: sum_ss   / n,
                        avg_viscosity:    sum_vis  / n,
                        avg_temperature:  sum_temp / n,
                        avg_pressure:     sum_press / n,
                        ..step.clone()
                    }
                } else {
                    step.clone()
                }
            })
            .collect();

        let duration: f64 = processed_steps.iter().map(|s| s.duration).sum();
        let processed_cycle = RheoCycle {
            steps: processed_steps.clone(),
            duration,
            ..cycle.clone()
        };

        // Step 3: collect (shear_rate, shear_stress) data points
        let mut data_points: Vec<(f64, f64)> = Vec::new();
        for step in &processed_steps {
            let slice: &[RheoPoint] = if pts_avg > 0 && !step.points.is_empty() {
                let start = step.points.len().saturating_sub(pts_avg);
                &step.points[start..]
            } else {
                &step.points
            };

            let mut added = 0usize;
            for p in slice {
                let rate = p.shear_rate.unwrap_or(0.0);
                let stress = p.shear_stress.unwrap_or(0.0);
                if rate > 1e-9 && stress > 1e-9 {
                    data_points.push((rate, stress));
                    added += 1;
                }
            }
            // fallback: step averages
            if added == 0 && step.avg_shear_rate > 1e-9 && step.avg_shear_stress > 1e-9 {
                data_points.push((step.avg_shear_rate, step.avg_shear_stress));
            }
        }

        // Step 4: Grace calculation
        if data_points.len() >= 2 {
            let step_count = processed_steps.len().max(1) as f64;
            let start_sec = processed_steps.first().map(|s| s.start_time).unwrap_or(0.0);
            let end_sec = processed_steps
                .last()
                .map(|s| s.end_time)
                .unwrap_or(start_sec);
            let avg_temp = processed_steps
                .iter()
                .map(|s| s.avg_temperature)
                .sum::<f64>()
                / step_count;
            let avg_pressure = processed_steps
                .iter()
                .map(|s| s.avg_pressure)
                .sum::<f64>()
                / step_count;

            let params = GraceInputParams {
                cycle_no: cycle.cycle_index.unwrap_or(cycle.id),
                time_min: start_sec / 60.0,
                end_time_min: end_sec / 60.0,
                temp_c: avg_temp,
                pressure_bar: avg_pressure,
            };

            if let Some(grace) = calculate_grace_internal(&data_points, geometry_key, settings, &params) {
                results.push((cycle.id, grace));
            }
        }

        processed_cycles.push(processed_cycle);
    }

    (processed_cycles, results)
}

/// Builds a `RheoCycle` from a step slice and an integer id.
fn make_cycle(steps: Vec<RheoStep>, id: i32) -> RheoCycle {
    let duration: f64 = steps.iter().map(|s| s.duration).sum();
    RheoCycle {
        id,
        cycle_index: Some(id),
        cycle_type: "Custom".to_string(),
        steps,
        description: format!("Cycle {}", id),
        duration,
    }
}

// в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// Tauri commands
// в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

/// Full analysis pipeline: detect steps в†’ filter в†’ detect cycles в†’ calculate Grace.
///
/// Tauri deserialises `input` directly from the IPC payload (no manual JSON roundtrip).
#[tauri::command]
pub async fn analysis_analyze_full(input: AnalyzeFullInput) -> Result<AnalysisOutput> {
    input.validate()?;
    tokio::task::spawn_blocking(move || {
        // 1. Detect schedule
        let steps = detect_schedule(&input.rheo_points.into_aos(), &input.detection_settings);

        // 2. Filter parasitic steps
        let clean_steps = filter_parasitic_steps(&steps).filtered_steps;

        // 3. Detect cycles
        let mut cycles = detect_cycles_native(&clean_steps);

        // 4. Apply cycle overrides
        if !input.cycle_overrides.is_empty() {
            for cycle in &mut cycles {
                if let Some((_, step_ids)) =
                    input.cycle_overrides.iter().find(|(id, _)| *id == cycle.id)
                {
                    let override_steps: Vec<RheoStep> = clean_steps
                        .iter()
                        .filter(|s| step_ids.contains(&s.id))
                        .cloned()
                        .collect();
                    if !override_steps.is_empty() {
                        let dur: f64 = override_steps.iter().map(|s| s.duration).sum();
                        cycle.steps = override_steps;
                        cycle.duration = dur;
                    }
                }
            }
        }

        // 5. Process cycles + calculate Grace
        let (processed_cycles, results) =
            process_all_cycles(&cycles, &input.geometry_key, &input.settings, false);

        Ok(AnalysisOutput {
            cycles: processed_cycles,
            results,
            all_steps: clean_steps,
        })
    })
    .await?
}

/// Step detection only: detect schedule + filter parasitic steps.
///
/// Replaces the `DETECT_STEPS` worker message.
#[tauri::command]
pub async fn analysis_detect_steps(input: DetectStepsInput) -> Result<DetectStepsOutput> {
    input.validate()?;
    tokio::task::spawn_blocking(move || {
        let steps = detect_schedule(&input.rheo_points.into_aos(), &input.detection_settings);
        let clean_steps = filter_parasitic_steps(&steps).filtered_steps;
        Ok(DetectStepsOutput { steps: clean_steps })
    })
    .await?
}

/// Regroup steps by a shear-rate pattern, then calculate Grace.
///
/// Replaces the `REGROUP_BY_PATTERN` worker message.
#[tauri::command]
pub async fn analysis_regroup_by_pattern(input: RegroupByPatternInput) -> Result<AnalysisOutput> {
    input.validate()?;
    tokio::task::spawn_blocking(move || {
        let pattern = &input.shear_rate_pattern;
        let pattern_len = pattern.len();

        if pattern_len == 0 {
            return Ok(AnalysisOutput {
                cycles: Vec::new(),
                results: Vec::new(),
                all_steps: input.all_steps,
            });
        }

        // Sort steps by start time (mirrors JS sort)
        let mut sorted = input.all_steps.clone();
        sorted.sort_by(|a, b| {
            a.start_time
                .partial_cmp(&b.start_time)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // Rate-match with relative tolerance (mirrors JS `rateMatches`)
        let rate_matches = |rate: f64, target: f64| -> bool {
            let tol = if target < 10.0 { 0.2 } else { 0.1 };
            (rate.round() - target).abs() / target.max(1.0) < tol
        };

        let mut new_cycles: Vec<RheoCycle> = Vec::new();
        let mut cycle_id = 1i32;
        let mut i = 0usize;

        while i + pattern_len <= sorted.len() {
            let matches = sorted[i..i + pattern_len]
                .iter()
                .zip(pattern.iter())
                .all(|(step, &target)| rate_matches(step.avg_shear_rate, target));

            if matches {
                let cycle_steps: Vec<RheoStep> =
                    sorted[i..i + pattern_len].iter().cloned().collect();
                new_cycles.push(make_cycle(cycle_steps, cycle_id));
                cycle_id += 1;
                i += pattern_len;
            } else {
                i += 1;
            }
        }

        let (processed_cycles, results) =
            process_all_cycles(&new_cycles, &input.geometry_key, &input.settings, true);

        Ok(AnalysisOutput {
            cycles: processed_cycles,
            results,
            all_steps: input.all_steps,
        })
    })
    .await?
}

// в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// Tests
// в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ


#[cfg(test)]
#[path = "analysis_tests.rs"]
mod tests;
