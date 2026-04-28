//! Tauri command entry-points for the native analysis pipeline.
//!
//! Four commands mirror the four worker message types:
//! - `analysis_analyze_full`        ← `ANALYZE_FULL`
//! - `analysis_detect_steps`        ← `DETECT_STEPS`
//! - `analysis_regroup_by_pattern`  ← `REGROUP_BY_PATTERN`

use crate::error::Result;
use rheolab_core::parasitic_filter::filter_parasitic_steps;
use rheolab_core::schedule_detector::{detect_schedule, ScheduleConfig};
use rheolab_core::types::{RheoPoint, RheoStep};
use rheolab_core::ExpertSettings;

use super::cycle_detection::{detect_cycles_native, make_cycle};
use super::cycle_processing::process_all_cycles;
use super::dto::{
    AnalysisOutput, AnalyzeFullInput, DetectStepsInput, DetectStepsOutput, RegroupByPatternInput,
};

/// Pure-CPU analysis pipeline: schedule detection → parasitic filter →
/// cycle detection → cycle override application → Grace calculation.
///
/// This is the core kernel used by [`analysis_analyze_full`] and by
/// the `bench_analysis_pipeline` cargo example (Sprint 1 / S1-4).
/// It takes plain Rust types (not the IPC DTO) so callers outside the
/// Tauri IPC boundary can drive the same pipeline without going
/// through serde deserialisation or `RheoPointsColumnar` SoA → AoS
/// conversion.
///
/// Intentionally synchronous — callers that need to spawn-blocking
/// (`analysis_analyze_full`) wrap this themselves; callers that
/// already run on a worker thread (microbenches, batch tools) can
/// just call directly.
///
/// # Arguments
///
/// * `rheo_points` — Owned `Vec<RheoPoint>` consumed by the pipeline.
///   Take by value to mirror the IPC path (which produces a fresh Vec
///   from `RheoPointsColumnar::into_aos()`); avoids surprising
///   double-allocation if a borrowed slice were taken instead.
/// * `geometry_key` — Geometry preset key (`R1B1`, `R1B2`, `R1B5`).
/// * `settings` — Expert settings (points-to-average + viscosity rates).
/// * `detection_settings` — Schedule-detection config.
/// * `cycle_overrides` — Optional `[(cycle_id, [step_ids])]` overrides
///   for manual user re-grouping.  Pass `&[]` for none.
///
/// # Returns
///
/// `AnalysisOutput` containing processed cycles, per-cycle Grace
/// results, and the cleaned step list (post-parasitic-filter).
///
/// # Inlining
///
/// Marked `#[inline]` so cargo emits the body in the `rmeta` and
/// downstream callers (the `bench_analysis_pipeline` cargo example
/// in particular) can inline the function across the crate boundary.
/// Without this, a release build of the bench shows ~10 % regression
/// vs an inlined-body baseline because each pipeline invocation pays
/// a cross-crate function call.  The IPC path (`analysis_analyze_full`)
/// is unaffected: it's same-crate as the kernel.
#[inline]
pub fn run_full_analysis_kernel(
    rheo_points: Vec<RheoPoint>,
    geometry_key: &str,
    settings: &ExpertSettings,
    detection_settings: &ScheduleConfig,
    cycle_overrides: &[(i32, Vec<i32>)],
) -> AnalysisOutput {
    // 1. Detect schedule
    let steps = detect_schedule(&rheo_points, detection_settings);

    // 2. Filter parasitic steps
    let clean_steps = filter_parasitic_steps(&steps).filtered_steps;

    // 3. Detect cycles
    let mut cycles = detect_cycles_native(&clean_steps);

    // 4. Apply cycle overrides
    if !cycle_overrides.is_empty() {
        for cycle in &mut cycles {
            if let Some((_, step_ids)) =
                cycle_overrides.iter().find(|(id, _)| *id == cycle.id)
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
        process_all_cycles(&cycles, geometry_key, settings, false);

    AnalysisOutput {
        cycles: processed_cycles,
        results,
        all_steps: clean_steps,
    }
}

/// Full analysis pipeline IPC entry-point.  Validates input, then
/// delegates to [`run_full_analysis_kernel`] inside
/// `tokio::task::spawn_blocking` so the analysis hot loops run on a
/// worker thread and don't block the Tauri runtime.
#[tauri::command]
pub async fn analysis_analyze_full(input: AnalyzeFullInput) -> Result<AnalysisOutput> {
    input.validate()?;
    tokio::task::spawn_blocking(move || {
        Ok(run_full_analysis_kernel(
            input.rheo_points.into_aos(),
            &input.geometry_key,
            &input.settings,
            &input.detection_settings,
            &input.cycle_overrides,
        ))
    })
    .await?
}

/// Step detection only: detect schedule + filter parasitic steps.
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

        let mut new_cycles = Vec::new();
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
