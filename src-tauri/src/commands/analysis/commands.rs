//! Tauri command entry-points for the native analysis pipeline.
//!
//! Four commands mirror the four worker message types:
//! - `analysis_analyze_full`        ← `ANALYZE_FULL`
//! - `analysis_detect_steps`        ← `DETECT_STEPS`
//! - `analysis_regroup_by_pattern`  ← `REGROUP_BY_PATTERN`

use crate::analysis_cache::{
    build_analysis_cache_key, decode_analysis_artifact, encode_analysis_artifact,
    hash_experiment_data_bytes, ANALYSIS_ARTIFACT_ENCODING,
};
use crate::db::repositories::analysis_artifacts::{
    delete_analysis_artifact, get_analysis_artifact, put_analysis_artifact,
};
use crate::db::DbPool;
use crate::error::{AppError, Result};
use crate::state::AppState;
use rheolab_core::parasitic_filter::filter_parasitic_steps;
use rheolab_core::schedule_detector::{detect_schedule, ScheduleConfig};
use rheolab_core::types::{RheoPoint, RheoStep};
use rheolab_core::ExpertSettings;
use rusqlite::OptionalExtension;
use serde_json::Value;
use std::collections::HashMap;
use tauri::State;

use super::cycle_detection::{detect_cycles_native, make_cycle};
use super::cycle_processing::process_all_cycles;
use super::dto::{
    AnalysisOutput, AnalyzeExperimentByIdInput, AnalyzeFullInput, DetectStepsInput,
    DetectStepsOutput, RegroupByPatternInput,
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
            if let Some((_, step_ids)) = cycle_overrides.iter().find(|(id, _)| *id == cycle.id) {
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
    let (processed_cycles, results) = process_all_cycles(&cycles, geometry_key, settings, false);

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

#[tauri::command]
pub async fn analysis_analyze_experiment_by_id(
    state: State<'_, AppState>,
    input: AnalyzeExperimentByIdInput,
) -> Result<AnalysisOutput> {
    input.validate()?;
    let pool = state.db_pool.clone();
    tokio::task::spawn_blocking(move || analyze_experiment_by_id_blocking(pool, input)).await?
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

pub(crate) fn analyze_experiment_by_id_blocking(
    pool: DbPool,
    input: AnalyzeExperimentByIdInput,
) -> Result<AnalysisOutput> {
    input.validate()?;

    let conn = pool.get()?;
    let loaded = load_analysis_points_payload(&conn, &input.experiment_id)?;
    let cache_key = if input.cycle_overrides.is_empty() {
        Some(build_analysis_cache_key(
            &input.experiment_id,
            &loaded.data_hash,
            &input.geometry_key,
            &input.settings,
            &input.detection_settings,
            &cache_rates_for_input(&input),
        )?)
    } else {
        None
    };

    if let Some(cache_key) = cache_key.as_ref() {
        if let Some(record) = get_analysis_artifact(&conn, cache_key)? {
            if record.artifact_encoding == ANALYSIS_ARTIFACT_ENCODING {
                match decode_analysis_artifact(&record.artifact_blob) {
                    Ok(output) => {
                        tracing::info!(
                            experiment_id = %cache_key.experiment_id,
                            artifact_bytes = record.artifact_bytes,
                            cache_status = "hit",
                            "analysis artifact cache"
                        );
                        return Ok(output);
                    }
                    Err(error) => {
                        tracing::warn!(
                            experiment_id = %cache_key.experiment_id,
                            error = %error,
                            cache_status = "decode_failed",
                            "analysis artifact cache"
                        );
                        if let Err(delete_error) = delete_analysis_artifact(&conn, cache_key) {
                            tracing::warn!(
                                experiment_id = %cache_key.experiment_id,
                                error = %delete_error,
                                "failed to delete corrupt analysis artifact"
                            );
                        }
                    }
                }
            }
        }
    }
    drop(conn);

    let rheo_points = loaded.into_rheo_points()?;
    let output = run_full_analysis_kernel(
        rheo_points,
        &input.geometry_key,
        &input.settings,
        &input.detection_settings,
        &input.cycle_overrides,
    );

    if let Some(cache_key) = cache_key {
        match encode_analysis_artifact(&output) {
            Ok(blob) => {
                let conn = pool.get()?;
                if let Err(error) =
                    put_analysis_artifact(&conn, &cache_key, ANALYSIS_ARTIFACT_ENCODING, &blob)
                {
                    tracing::warn!(
                        experiment_id = %cache_key.experiment_id,
                        error = %error,
                        "failed to persist analysis artifact"
                    );
                }
            }
            Err(error) => {
                tracing::warn!(
                    experiment_id = %cache_key.experiment_id,
                    error = %error,
                    "failed to encode analysis artifact"
                );
            }
        }
    }

    Ok(output)
}

struct AnalysisPointsPayload {
    data_hash: String,
    payload: AnalysisPayloadKind,
}

enum AnalysisPayloadKind {
    ColumnarBlob(Vec<u8>),
    RawPointsJson(String),
}

impl AnalysisPointsPayload {
    fn into_rheo_points(self) -> Result<Vec<RheoPoint>> {
        match self.payload {
            AnalysisPayloadKind::ColumnarBlob(blob) => {
                let columns = crate::db::columnar::decode_typed(&blob)?;
                typed_columns_to_rheo_points(&columns)
            }
            AnalysisPayloadKind::RawPointsJson(raw_points) => {
                let values: Vec<Value> = serde_json::from_str(&raw_points)?;
                values
                    .into_iter()
                    .map(serde_json::from_value)
                    .collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(AppError::Serde)
            }
        }
    }
}

fn load_analysis_points_payload(
    conn: &rusqlite::Connection,
    experiment_id: &str,
) -> Result<AnalysisPointsPayload> {
    let blob: Option<Vec<u8>> = conn
        .query_row(
            "SELECT dataBlob FROM ExperimentData WHERE experimentId = ?1",
            [experiment_id],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(blob) = blob {
        let data_hash = hash_experiment_data_bytes(&blob);
        return Ok(AnalysisPointsPayload {
            data_hash,
            payload: AnalysisPayloadKind::ColumnarBlob(blob),
        });
    }

    let raw_points: Option<String> = conn
        .query_row(
            "SELECT rawPoints FROM Experiment WHERE id = ?1",
            [experiment_id],
            |row| row.get(0),
        )
        .optional()?;

    let Some(raw_points) = raw_points else {
        return Err(AppError::BadRequest(format!(
            "Experiment not found for experimentId={experiment_id}"
        )));
    };
    if raw_points.trim().is_empty() || raw_points.trim() == "[]" {
        return Err(AppError::BadRequest(format!(
            "ExperimentData not found for experimentId={experiment_id}"
        )));
    }

    let data_hash = hash_experiment_data_bytes(raw_points.as_bytes());
    Ok(AnalysisPointsPayload {
        data_hash,
        payload: AnalysisPayloadKind::RawPointsJson(raw_points),
    })
}

fn typed_columns_to_rheo_points(
    columns: &HashMap<String, Vec<Option<f64>>>,
) -> Result<Vec<RheoPoint>> {
    let time = first_column(columns, &["time_sec", "timeSec", "time"])
        .ok_or_else(|| AppError::Parse("analysis data has no time_sec channel".into()))?;
    let viscosity = first_column(columns, &["viscosity_cp", "viscosityCp", "viscosity"])
        .ok_or_else(|| AppError::Parse("analysis data has no viscosity_cp channel".into()))?;
    let temperature = first_column(columns, &["temperature_c", "temperatureC", "temperature"])
        .ok_or_else(|| AppError::Parse("analysis data has no temperature_c channel".into()))?;

    let shear_rate = first_column(
        columns,
        &["shear_rate_s1", "shearRateS1", "shear_rate", "shearRate"],
    );
    let shear_stress = first_column(
        columns,
        &[
            "shear_stress_pa",
            "shearStressPa",
            "shear_stress",
            "shearStress",
        ],
    );
    let pressure_bar = first_column(columns, &["pressure_bar", "pressureBar", "pressure"]);
    let rpm = first_column(columns, &["speed_rpm", "speedRpm", "rpm"]);
    let bath_temperature = first_column(columns, &["bath_temperature_c", "bathTemperatureC"]);

    let len = time.len();
    for (name, column) in [
        ("viscosity_cp", viscosity),
        ("temperature_c", temperature),
        ("shear_rate", shear_rate.unwrap_or(time)),
        ("shear_stress", shear_stress.unwrap_or(time)),
        ("pressure_bar", pressure_bar.unwrap_or(time)),
        ("rpm", rpm.unwrap_or(time)),
    ] {
        if column.len() != len {
            return Err(AppError::Parse(format!(
                "analysis column {name} length {} does not match time length {len}",
                column.len()
            )));
        }
    }

    let mut out = Vec::with_capacity(len);
    for idx in 0..len {
        out.push(RheoPoint {
            time_sec: required_finite(time[idx], "time_sec")?,
            viscosity_cp: required_finite(viscosity[idx], "viscosity_cp")?,
            temperature_c: required_finite(temperature[idx], "temperature_c")?,
            shear_rate: finite_option_at(shear_rate, idx),
            shear_stress: finite_option_at(shear_stress, idx),
            pressure_bar: finite_option_at(pressure_bar, idx),
            rpm: finite_option_at(rpm, idx),
            bath_temperature_c: finite_option_at(bath_temperature, idx),
        });
    }
    if out.is_empty() {
        return Err(AppError::BadRequest(
            "analysis data must not be empty".into(),
        ));
    }
    Ok(out)
}

fn first_column<'a>(
    columns: &'a HashMap<String, Vec<Option<f64>>>,
    aliases: &[&str],
) -> Option<&'a Vec<Option<f64>>> {
    aliases.iter().find_map(|alias| columns.get(*alias))
}

fn required_finite(value: Option<f64>, field: &str) -> Result<f64> {
    match value {
        Some(v) if v.is_finite() => Ok(v),
        _ => Err(AppError::Parse(format!(
            "analysis data has non-finite {field} value"
        ))),
    }
}

fn finite_option_at(column: Option<&Vec<Option<f64>>>, idx: usize) -> Option<f64> {
    column
        .and_then(|values| values.get(idx).copied().flatten())
        .filter(|value| value.is_finite())
}

fn cache_rates_for_input(input: &AnalyzeExperimentByIdInput) -> Vec<i32> {
    if !input.report_viscosity_rates.is_empty() {
        return input.report_viscosity_rates.clone();
    }
    input
        .settings
        .viscosity_shear_rates
        .iter()
        .copied()
        .filter(|rate| rate.is_finite() && *rate > 0.0)
        .map(|rate| rate.round() as i32)
        .collect()
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
