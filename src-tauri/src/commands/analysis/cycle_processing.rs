//! Cycle post-processing pipeline: filter mixing steps, re-average from raw
//! points, collect `(shear_rate, shear_stress)` pairs, and call Grace.

use rheolab_core::types::{RheoCycle, RheoPoint, RheoStep};
use rheolab_core::{
    calculate_grace_internal, process_cycle_internal, ExpertSettings, GraceCycleResult,
    GraceInputParams,
};

/// Processes a slice of cycles through the calculation pipeline.
///
/// Mirrors `processAllCyclesWasm` in the worker:
/// 1. Process cycle steps (remove mixing steps etc.) unless `skip_step_filtering`
/// 2. Re-compute step averages from last `pointsToAverage` raw points
/// 3. Extract `(shear_rate, shear_stress)` pairs
/// 4. Call `calculate_grace_internal`
pub(super) fn process_all_cycles(
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
                    // Single-pass fold over the slice — avoids 5 separate iterator passes.
                    let (sum_sr, sum_ss, sum_vis, sum_temp, sum_press) = pts.iter().fold(
                        (0.0_f64, 0.0_f64, 0.0_f64, 0.0_f64, 0.0_f64),
                        |(sr, ss, vis, temp, press), p| {
                            (
                                sr + p.shear_rate.unwrap_or(0.0),
                                ss + p.shear_stress.unwrap_or(0.0),
                                vis + p.viscosity_cp,
                                temp + p.temperature_c,
                                press + p.pressure_bar.unwrap_or(0.0),
                            )
                        },
                    );
                    RheoStep {
                        avg_shear_rate: sum_sr / n,
                        avg_shear_stress: sum_ss / n,
                        avg_viscosity: sum_vis / n,
                        avg_temperature: sum_temp / n,
                        avg_pressure: sum_press / n,
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
            let avg_pressure =
                processed_steps.iter().map(|s| s.avg_pressure).sum::<f64>() / step_count;

            let params = GraceInputParams {
                cycle_no: cycle.cycle_index.unwrap_or(cycle.id),
                time_min: start_sec / 60.0,
                end_time_min: end_sec / 60.0,
                temp_c: avg_temp,
                pressure_bar: avg_pressure,
            };

            if let Some(grace) =
                calculate_grace_internal(&data_points, geometry_key, settings, &params)
            {
                results.push((cycle.id, grace));
            }
        }

        processed_cycles.push(processed_cycle);
    }

    (processed_cycles, results)
}
