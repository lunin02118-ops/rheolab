use crate::analysis_cache::{
    build_analysis_cache_key, decode_analysis_artifact, encode_analysis_artifact,
    hash_experiment_data_bytes, AnalysisCacheKey, ANALYSIS_ARTIFACT_ENCODING,
};
use crate::commands::analysis::{run_full_analysis_kernel, AnalysisOutput};
use crate::commands::experiments::types::{
    RheologyParameterRow, RheologyParameterSource, StoredExperiment, StoredExperimentReagent,
};
use crate::db::repositories::analysis_artifacts::{
    delete_analysis_artifact, get_analysis_artifact, put_analysis_artifact,
};
use crate::db::repositories::experiments::{load_experiment_data_hashes, load_experiments_batch};
use crate::db::DbPool;
use crate::error::{AppError, Result};
use crate::reports::domain::{
    ComparisonByIdsAnalysisSettings, ComparisonByIdsChartConfig, ComparisonByIdsChartLineSettings,
    ComparisonByIdsDetectionSettings, ComparisonByIdsLineSettings, ComparisonByIdsRheologyUnits,
    ComparisonByIdsSectionToggles, ComparisonReportByIdsRequest, ComparisonReportByIdsSettings,
};
use crate::runtime::jobs::JobContext;
use crate::utils::time::now_rfc3339;
use rheolab_core::report_generator::comparison::{
    ComparisonChartConfig, ComparisonExperimentEntry, ComparisonMetrics, ComparisonReportInput,
    SectionToggles, TouchPointConfig,
};
use rheolab_core::report_generator::{
    AxisValues, CalibrationData, ChartLineSettings, CycleInfo, CycleResult, DataPoint,
    LineSettings, Reagent, ReportInput, ReportMetadata, ReportSettings, RheologyUnits, StepInfo,
    WaterParams,
};
use rheolab_core::schedule_detector::ScheduleConfig;
use rheolab_core::types::{RheoCycle, RheoPoint};
use rheolab_core::{ExpertSettings, GraceCycleResult};
use serde_json::Value;
use std::collections::HashSet;

#[cfg(test)]
pub(crate) fn build_comparison_report_input_by_ids(
    conn: &rusqlite::Connection,
    request: &ComparisonReportByIdsRequest,
) -> Result<ComparisonReportInput> {
    let experiments = load_comparison_experiments_by_ids(conn, request)?;
    build_comparison_report_input_from_experiments(&experiments, request)
}

#[cfg(test)]
pub(crate) fn build_comparison_report_input_by_ids_cached(
    pool: &DbPool,
    request: &ComparisonReportByIdsRequest,
) -> Result<ComparisonReportInput> {
    build_comparison_report_input_by_ids_cached_with_job(pool, request, None)
}

pub(crate) fn build_comparison_report_input_by_ids_cached_with_job(
    pool: &DbPool,
    request: &ComparisonReportByIdsRequest,
    ctx: Option<&JobContext>,
) -> Result<ComparisonReportInput> {
    if let Some(ctx) = ctx {
        ctx.progress(
            "load_experiments",
            0,
            Some(request.experiment_ids.len() as u64),
            Some("Loading experiments and cache artifacts".into()),
        );
        ctx.ensure_not_cancelled()?;
    }

    let mut resolved = {
        let conn = pool.get().map_err(AppError::Pool)?;
        load_comparison_experiments_with_cache_hits(&conn, request)?
    };

    resolve_comparison_cache_misses_with_job(&mut resolved, &request.settings, ctx)?;

    let artifact_bytes_written = {
        let conn = pool.get().map_err(AppError::Pool)?;
        store_comparison_cache_misses_with_job(&conn, &mut resolved, ctx)?
    };

    let hits = resolved
        .iter()
        .filter(|item| item.cache_status == AnalysisCacheStatus::Hit)
        .count();
    let misses = resolved
        .iter()
        .filter(|item| {
            matches!(
                item.cache_status,
                AnalysisCacheStatus::MissPending
                    | AnalysisCacheStatus::MissStored
                    | AnalysisCacheStatus::MissStoreFailed
            )
        })
        .count();
    let artifact_bytes_read = resolved
        .iter()
        .map(|item| item.artifact_bytes_read)
        .sum::<u64>();
    if let Some(ctx) = ctx {
        ctx.record_cache_stats(
            hits as u64,
            misses as u64,
            artifact_bytes_read,
            artifact_bytes_written,
        );
    }
    tracing::info!(
        n_experiments = resolved.len(),
        cache_hits = hits,
        cache_misses = misses,
        artifact_bytes_read,
        artifact_bytes_written,
        "comparison by-ids analysis cache resolved"
    );

    build_comparison_report_input_from_cached_experiments(&resolved, request)
}

pub(crate) fn load_comparison_experiments_by_ids(
    conn: &rusqlite::Connection,
    request: &ComparisonReportByIdsRequest,
) -> Result<Vec<StoredExperiment>> {
    let experiments = load_experiments_batch(conn, &request.experiment_ids)?;
    let found_ids = experiments
        .iter()
        .map(|experiment| experiment.id.as_str())
        .collect::<HashSet<_>>();
    let missing = request
        .experiment_ids
        .iter()
        .filter(|id| !found_ids.contains(id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(AppError::BadRequest(format!(
            "Experiment IDs not found: {}",
            missing.join(", ")
        )));
    }
    Ok(experiments)
}

fn load_comparison_experiments_with_cache_hits(
    conn: &rusqlite::Connection,
    request: &ComparisonReportByIdsRequest,
) -> Result<Vec<CachedComparisonExperiment>> {
    let experiments = load_comparison_experiments_by_ids(conn, request)?;
    let data_hashes = load_experiment_data_hashes(conn, &request.experiment_ids)?;
    experiments
        .into_iter()
        .map(|experiment| {
            let data_hash = data_hashes.get(&experiment.id);
            load_cached_comparison_experiment(conn, experiment, data_hash, &request.settings)
        })
        .collect()
}

fn load_cached_comparison_experiment(
    conn: &rusqlite::Connection,
    experiment: StoredExperiment,
    experiment_data_hash: Option<&String>,
    settings: &ComparisonReportByIdsSettings,
) -> Result<CachedComparisonExperiment> {
    let rheo_points = raw_points_to_rheo_points(&experiment.raw_points)?;
    if rheo_points.is_empty() {
        return Ok(CachedComparisonExperiment {
            experiment,
            rheo_points,
            analysis: None,
            cache_key: None,
            cache_status: AnalysisCacheStatus::Bypass,
            artifact_bytes_read: 0,
            artifact_bytes_written: 0,
        });
    }

    let cache_key = build_analysis_key_for_experiment(&experiment, experiment_data_hash, settings)?;
    let mut analysis = None;
    let mut cache_status = AnalysisCacheStatus::MissPending;

    if let Some(record) = get_analysis_artifact(conn, &cache_key)? {
        if record.artifact_encoding == ANALYSIS_ARTIFACT_ENCODING {
            match decode_analysis_artifact(&record.artifact_blob) {
                Ok(output) => {
                    tracing::info!(
                        experiment_id = %cache_key.experiment_id,
                        artifact_bytes = record.artifact_bytes,
                        cache_status = "hit",
                        "analysis artifact cache"
                    );
                    analysis = Some(output);
                    cache_status = AnalysisCacheStatus::Hit;
                    return Ok(CachedComparisonExperiment {
                        experiment,
                        rheo_points,
                        analysis,
                        cache_key: Some(cache_key),
                        cache_status,
                        artifact_bytes_read: record.artifact_bytes.max(0) as u64,
                        artifact_bytes_written: 0,
                    });
                }
                Err(error) => {
                    tracing::warn!(
                        experiment_id = %cache_key.experiment_id,
                        error = %error,
                        cache_status = "decode_failed",
                        "analysis artifact cache"
                    );
                    if let Err(delete_error) = delete_analysis_artifact(conn, &cache_key) {
                        tracing::warn!(
                            experiment_id = %cache_key.experiment_id,
                            error = %delete_error,
                            "failed to delete corrupt analysis artifact"
                        );
                    }
                }
            }
        } else {
            tracing::warn!(
                experiment_id = %cache_key.experiment_id,
                artifact_encoding = %record.artifact_encoding,
                cache_status = "decode_failed",
                "analysis artifact cache encoding mismatch"
            );
            if let Err(delete_error) = delete_analysis_artifact(conn, &cache_key) {
                tracing::warn!(
                    experiment_id = %cache_key.experiment_id,
                    error = %delete_error,
                    "failed to delete mismatched analysis artifact"
                );
            }
        }
    }

    Ok(CachedComparisonExperiment {
        experiment,
        rheo_points,
        analysis,
        cache_key: Some(cache_key),
        cache_status,
        artifact_bytes_read: 0,
        artifact_bytes_written: 0,
    })
}

fn resolve_comparison_cache_misses_with_job(
    experiments: &mut [CachedComparisonExperiment],
    settings: &ComparisonReportByIdsSettings,
    ctx: Option<&JobContext>,
) -> Result<()> {
    let expert_settings = build_expert_settings(&settings.analysis_settings);
    let schedule_config = build_schedule_config(&settings.detection_settings);
    let total = experiments.len() as u64;

    for (index, item) in experiments.iter_mut().enumerate() {
        if let Some(ctx) = ctx {
            ctx.ensure_not_cancelled()?;
            ctx.progress(
                "analysis",
                index as u64,
                Some(total),
                Some("Resolving analysis cache misses".into()),
            );
        }
        if item.analysis.is_some() || item.rheo_points.is_empty() {
            continue;
        }
        let geometry = experiment_geometry_key(&item.experiment);
        let output = run_full_analysis_kernel(
            item.rheo_points.clone(),
            &geometry,
            &expert_settings,
            &schedule_config,
            &[],
        );
        item.analysis = Some(output);
        item.cache_status = AnalysisCacheStatus::MissPending;
    }
    Ok(())
}

fn store_comparison_cache_misses_with_job(
    conn: &rusqlite::Connection,
    experiments: &mut [CachedComparisonExperiment],
    ctx: Option<&JobContext>,
) -> Result<u64> {
    let mut artifact_bytes_written = 0u64;
    let total = experiments.len() as u64;
    for (index, item) in experiments.iter_mut().enumerate() {
        if let Some(ctx) = ctx {
            ctx.ensure_not_cancelled()?;
            ctx.progress(
                "cache_store",
                index as u64,
                Some(total),
                Some("Storing analysis cache misses".into()),
            );
        }
        if item.cache_status != AnalysisCacheStatus::MissPending {
            continue;
        }
        let (Some(cache_key), Some(analysis)) = (&item.cache_key, &item.analysis) else {
            continue;
        };
        let encoded = match encode_analysis_artifact(analysis) {
            Ok(encoded) => encoded,
            Err(error) => {
                tracing::warn!(
                    experiment_id = %cache_key.experiment_id,
                    error = %error,
                    cache_status = "store_failed",
                    "analysis artifact cache encode failed"
                );
                item.cache_status = AnalysisCacheStatus::MissStoreFailed;
                continue;
            }
        };
        match put_analysis_artifact(conn, cache_key, ANALYSIS_ARTIFACT_ENCODING, &encoded) {
            Ok(record) => {
                tracing::info!(
                    experiment_id = %cache_key.experiment_id,
                    artifact_bytes = record.artifact_bytes,
                    cache_status = "miss_stored",
                    "analysis artifact cache"
                );
                item.artifact_bytes_written = record.artifact_bytes.max(0) as u64;
                artifact_bytes_written += item.artifact_bytes_written;
                item.cache_status = AnalysisCacheStatus::MissStored;
            }
            Err(error) => {
                tracing::warn!(
                    experiment_id = %cache_key.experiment_id,
                    error = %error,
                    cache_status = "store_failed",
                    "analysis artifact cache"
                );
                item.cache_status = AnalysisCacheStatus::MissStoreFailed;
            }
        }
    }
    Ok(artifact_bytes_written)
}

#[cfg(test)]
pub(crate) fn build_comparison_report_input_from_experiments(
    experiments: &[StoredExperiment],
    request: &ComparisonReportByIdsRequest,
) -> Result<ComparisonReportInput> {
    let experiments = experiments
        .iter()
        .map(|experiment| build_comparison_experiment_entry(experiment, &request.settings))
        .collect::<Result<Vec<_>>>()?;

    Ok(ComparisonReportInput {
        language: request.settings.language.clone(),
        unit_system: request.settings.unit_system.clone(),
        company_name: request.settings.company_name.clone(),
        company_logo_base64: request.settings.company_logo_base64.clone(),
        generated_at: request
            .settings
            .generated_at
            .clone()
            .unwrap_or_else(now_rfc3339),
        comparison_chart: build_core_comparison_chart_config(&request.settings.comparison_chart),
        experiments,
    })
}

fn build_comparison_report_input_from_cached_experiments(
    experiments: &[CachedComparisonExperiment],
    request: &ComparisonReportByIdsRequest,
) -> Result<ComparisonReportInput> {
    let experiments = experiments
        .iter()
        .map(|experiment| build_comparison_experiment_entry_cached(experiment, &request.settings))
        .collect::<Result<Vec<_>>>()?;

    Ok(ComparisonReportInput {
        language: request.settings.language.clone(),
        unit_system: request.settings.unit_system.clone(),
        company_name: request.settings.company_name.clone(),
        company_logo_base64: request.settings.company_logo_base64.clone(),
        generated_at: request
            .settings
            .generated_at
            .clone()
            .unwrap_or_else(now_rfc3339),
        comparison_chart: build_core_comparison_chart_config(&request.settings.comparison_chart),
        experiments,
    })
}

#[cfg(test)]
fn build_comparison_experiment_entry(
    experiment: &StoredExperiment,
    settings: &ComparisonReportByIdsSettings,
) -> Result<ComparisonExperimentEntry> {
    Ok(ComparisonExperimentEntry {
        id: experiment.id.clone(),
        display_name: if experiment.name.is_empty() {
            experiment.id.clone()
        } else {
            experiment.name.clone()
        },
        report_input: build_report_input_for_experiment(experiment, settings)?,
        section_toggles: build_core_section_toggles(&settings.section_toggles),
    })
}

fn build_comparison_experiment_entry_cached(
    experiment: &CachedComparisonExperiment,
    settings: &ComparisonReportByIdsSettings,
) -> Result<ComparisonExperimentEntry> {
    Ok(ComparisonExperimentEntry {
        id: experiment.experiment.id.clone(),
        display_name: if experiment.experiment.name.is_empty() {
            experiment.experiment.id.clone()
        } else {
            experiment.experiment.name.clone()
        },
        report_input: build_report_input_for_experiment_with_analysis(
            &experiment.experiment,
            settings,
            &experiment.rheo_points,
            experiment.analysis.as_ref(),
        )?,
        section_toggles: build_core_section_toggles(&settings.section_toggles),
    })
}

#[cfg(test)]
fn build_report_input_for_experiment(
    experiment: &StoredExperiment,
    settings: &ComparisonReportByIdsSettings,
) -> Result<ReportInput> {
    let rheo_points = raw_points_to_rheo_points(&experiment.raw_points)?;
    let geometry = experiment_geometry_key(experiment);
    let expert_settings = build_expert_settings(&settings.analysis_settings);
    let schedule_config = build_schedule_config(&settings.detection_settings);
    let analysis = if rheo_points.is_empty() {
        None
    } else {
        Some(run_full_analysis_kernel(
            rheo_points.clone(),
            &geometry,
            &expert_settings,
            &schedule_config,
            &[],
        ))
    };
    build_report_input_for_experiment_with_analysis(
        experiment,
        settings,
        &rheo_points,
        analysis.as_ref(),
    )
}

fn build_report_input_for_experiment_with_analysis(
    experiment: &StoredExperiment,
    settings: &ComparisonReportByIdsSettings,
    rheo_points: &[RheoPoint],
    analysis: Option<&AnalysisOutput>,
) -> Result<ReportInput> {
    let raw_data = rheo_points_to_report_data(rheo_points);

    let selected_rheology =
        select_cycle_results_for_report(experiment, analysis, settings.rheology_source_override)?;
    let cycles = analysis
        .map(|output| {
            output
                .cycles
                .iter()
                .map(rheo_cycle_to_report_cycle)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut report_settings = build_report_settings(settings);
    report_settings.rheology_source = selected_rheology.source.as_str().to_string();

    Ok(ReportInput {
        raw_data,
        metadata: build_report_metadata(experiment, settings),
        cycle_results: selected_rheology.cycle_results,
        recipe: build_report_recipe(experiment, settings.section_toggles.show_recipe),
        water_params: build_water_params(experiment, settings.section_toggles.show_water_analysis),
        cycles,
        settings: report_settings,
        chart_image_base64: None,
        axis_values: axis_values_from_raw_data(&experiment.raw_points)?,
    })
}

pub(crate) fn build_analysis_key_for_experiment(
    experiment: &StoredExperiment,
    experiment_data_hash: Option<&String>,
    settings: &ComparisonReportByIdsSettings,
) -> Result<AnalysisCacheKey> {
    let fallback_hash;
    let experiment_data_hash = match experiment_data_hash {
        Some(hash) => hash.as_str(),
        None => {
            let raw_points_bytes = serde_json::to_vec(&experiment.raw_points)?;
            fallback_hash = hash_experiment_data_bytes(&raw_points_bytes);
            fallback_hash.as_str()
        }
    };
    build_analysis_cache_key(
        &experiment.id,
        experiment_data_hash,
        &experiment_geometry_key(experiment),
        &build_expert_settings(&settings.analysis_settings),
        &build_schedule_config(&settings.detection_settings),
        &settings.report_settings.report_viscosity_rates,
    )
}

fn experiment_geometry_key(experiment: &StoredExperiment) -> String {
    experiment
        .geometry
        .as_deref()
        .map(str::trim)
        .filter(|geometry| !geometry.is_empty())
        .unwrap_or("R1B5")
        .to_ascii_uppercase()
}

fn raw_points_to_rheo_points(points: &[Value]) -> Result<Vec<RheoPoint>> {
    points
        .iter()
        .cloned()
        .map(serde_json::from_value)
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(AppError::Serde)
}

fn rheo_points_to_report_data(points: &[RheoPoint]) -> Vec<DataPoint> {
    points
        .iter()
        .map(|point| DataPoint {
            time_sec: point.time_sec,
            viscosity_cp: point.viscosity_cp,
            temperature_c: Some(point.temperature_c),
            bath_temperature_c: point.bath_temperature_c,
            shear_rate: point.shear_rate,
            shear_stress_pa: point.shear_stress,
            speed_rpm: point.rpm,
            pressure_bar: point.pressure_bar,
        })
        .collect()
}

pub(crate) fn build_expert_settings(settings: &ComparisonByIdsAnalysisSettings) -> ExpertSettings {
    ExpertSettings {
        points_to_average: settings.points_to_average,
        viscosity_shear_rates: settings.viscosity_shear_rates.clone(),
    }
}

pub(crate) fn build_schedule_config(settings: &ComparisonByIdsDetectionSettings) -> ScheduleConfig {
    ScheduleConfig {
        shear_rate_tolerance: settings.shear_rate_tolerance,
        shear_rate_rel_tolerance: settings.shear_rate_rel_tolerance,
        min_step_duration: settings.min_step_duration,
        step_splitting: settings.step_splitting,
        split_start_duration: settings.split_start_duration,
        split_end_duration: settings.split_end_duration,
        min_duration_for_split: settings.min_duration_for_split,
    }
}

fn grace_result_to_cycle_result(result: &GraceCycleResult) -> CycleResult {
    CycleResult {
        cycle_no: result.cycle_no,
        time_min: if result.time_min != 0.0 {
            result.time_min
        } else {
            result.end_time_min
        },
        temp_c: if result.temp_c != 0.0 {
            result.temp_c
        } else {
            25.0
        },
        pressure_bar: Some(result.pressure_bar),
        n_prime: result.n_prime,
        k_prime: result.k_prime_pasn,
        k_slot: finite_option(result.k_prime_slot_pasn),
        k_pipe: finite_option(result.k_prime_pipe_pasn),
        r2: result.r2,
        visc_at_40: result.viscosities.get("40").copied(),
        visc_at_100: result.viscosities.get("100").copied(),
        visc_at_170: result.viscosities.get("170").copied(),
        viscosities: result.viscosities.clone(),
        bingham_pv: Some(result.bingham_pv_pas),
        bingham_yp: Some(result.bingham_yp_pa),
        bingham_r2: Some(result.bingham_r2),
    }
}

struct SelectedCycleResults {
    source: RheologyParameterSource,
    cycle_results: Vec<CycleResult>,
}

fn select_cycle_results_for_report(
    experiment: &StoredExperiment,
    analysis: Option<&AnalysisOutput>,
    source_override: Option<RheologyParameterSource>,
) -> Result<SelectedCycleResults> {
    let selected_source = source_override.unwrap_or(experiment.rheology_source);
    let persisted = experiment
        .rheology_parameters
        .iter()
        .filter(|row| row.source == selected_source)
        .cloned()
        .collect::<Vec<_>>();

    match selected_source {
        RheologyParameterSource::Instrument => {
            if persisted.is_empty() {
                return Err(AppError::BadRequest(format!(
                    "Для эксперимента '{}' выбран источник реологических параметров 'Прибор', но сохранённые параметры прибора не найдены.",
                    experiment.name
                )));
            }
            Ok(SelectedCycleResults {
                source: selected_source,
                cycle_results: rheology_rows_to_cycle_results(persisted),
            })
        }
        RheologyParameterSource::Program => {
            let calculated = analysis
                .map(|output| {
                    output
                        .results
                        .iter()
                        .map(|(_, result)| grace_result_to_cycle_result(result))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if !calculated.is_empty() {
                return Ok(SelectedCycleResults {
                    source: selected_source,
                    cycle_results: calculated,
                });
            }
            Ok(SelectedCycleResults {
                source: selected_source,
                cycle_results: rheology_rows_to_cycle_results(persisted),
            })
        }
    }
}

fn rheology_rows_to_cycle_results(mut rows: Vec<RheologyParameterRow>) -> Vec<CycleResult> {
    rows.sort_by_key(|row| row.cycle_no);
    rows.into_iter()
        .map(|row| {
            let visc_at_40 = row.viscosities.get("40").copied();
            let visc_at_100 = row.viscosities.get("100").copied();
            let visc_at_170 = row.viscosities.get("170").copied();
            let viscosities = row.viscosities.into_iter().collect();
            CycleResult {
                cycle_no: row.cycle_no,
                time_min: row.time_min.or(row.end_time_min).unwrap_or_default(),
                temp_c: row.temp_c.unwrap_or(25.0),
                pressure_bar: row.pressure_bar,
                n_prime: row.n_prime.unwrap_or_default(),
                k_prime: row.k_prime_pasn.or(row.kv_pasn).unwrap_or_default(),
                k_slot: row.k_slot_pasn,
                k_pipe: row.k_pipe_pasn,
                r2: row.r2.unwrap_or_default(),
                visc_at_40,
                visc_at_100,
                visc_at_170,
                viscosities,
                bingham_pv: row.bingham_pv_pas,
                bingham_yp: row.bingham_yp_pa,
                bingham_r2: row.bingham_r2,
            }
        })
        .collect()
}

fn finite_option(value: f64) -> Option<f64> {
    if value.is_finite() {
        Some(value)
    } else {
        None
    }
}

fn rheo_cycle_to_report_cycle(cycle: &RheoCycle) -> CycleInfo {
    CycleInfo {
        cycle_type: cycle.cycle_type.clone(),
        steps: cycle
            .steps
            .iter()
            .map(|step| StepInfo {
                avg_shear_rate: step.avg_shear_rate,
            })
            .collect(),
    }
}

fn build_report_metadata(
    experiment: &StoredExperiment,
    settings: &ComparisonReportByIdsSettings,
) -> ReportMetadata {
    ReportMetadata {
        filename: if experiment.name.is_empty() {
            "report".into()
        } else {
            experiment.name.clone()
        },
        test_id: experiment.test_id.clone(),
        test_date: Some(experiment.test_date.clone()),
        operator_name: experiment.operator_name.clone(),
        laboratory_name: experiment
            .laboratory
            .as_ref()
            .map(|laboratory| laboratory.name.clone()),
        field_name: experiment.field_name.clone(),
        well_number: experiment.well_number.clone(),
        instrument_type: Some(experiment.instrument_type.clone()),
        geometry: experiment.geometry.clone(),
        company_name: settings.company_name.clone(),
        company_logo_base64: settings.company_logo_base64.clone(),
        calibration: experiment
            .calibration
            .as_ref()
            .and_then(build_calibration_data),
    }
}

fn build_calibration_data(value: &Value) -> Option<CalibrationData> {
    let calibration = CalibrationData {
        device_type: json_string_any(value, &["deviceType", "device_type"]),
        calibration_date: json_string_any(value, &["lastCalDate", "last_cal_date"]),
        last_cal_date: None,
        r_squared: json_f64_any(value, &["rSquared", "r_squared"]),
        slope: json_f64_any(value, &["slope"]),
        intercept: json_f64_any(value, &["intercept"]),
        hysteresis: json_f64_any(value, &["hysteresis"]),
        stdev: json_f64_any(value, &["stdev"]),
        status: json_string_any(value, &["status"]),
    };
    if calibration.device_type.is_none()
        && calibration.calibration_date.is_none()
        && calibration.r_squared.is_none()
        && calibration.slope.is_none()
        && calibration.intercept.is_none()
        && calibration.hysteresis.is_none()
        && calibration.stdev.is_none()
        && calibration.status.is_none()
    {
        None
    } else {
        Some(calibration)
    }
}

fn build_report_recipe(experiment: &StoredExperiment, show_recipe: bool) -> Vec<Reagent> {
    if !show_recipe {
        return vec![];
    }
    experiment
        .reagents
        .iter()
        .map(stored_reagent_to_report_reagent)
        .collect()
}

fn stored_reagent_to_report_reagent(reagent: &StoredExperimentReagent) -> Reagent {
    let name = reagent
        .reagent
        .as_ref()
        .map(|descriptor| descriptor.name.clone())
        .or_else(|| reagent.reagent_name.clone())
        .unwrap_or_else(|| "Unknown Component".into());
    Reagent {
        name,
        concentration: reagent.concentration,
        unit: if reagent.unit.is_empty() {
            "кг/м³".into()
        } else {
            reagent.unit.clone()
        },
        category: reagent.category.clone(),
        batch_number: None,
    }
}

fn build_water_params(
    experiment: &StoredExperiment,
    show_water_analysis: bool,
) -> Option<WaterParams> {
    if !show_water_analysis {
        return None;
    }
    let value = experiment.water_params.as_ref()?;
    Some(WaterParams {
        source: Some(experiment.water_source.clone()),
        salinity: json_f64_any(value, &["salinity"]),
        ph: json_f64_any(value, &["ph", "pH"]),
        hardness: json_f64_any(value, &["hardness"]),
        fe: None,
        ca: None,
        mg: None,
        cl: None,
        so4: None,
        hco3: None,
    })
}

fn build_report_settings(settings: &ComparisonReportByIdsSettings) -> ReportSettings {
    ReportSettings {
        language: settings.language.clone(),
        unit_system: settings.unit_system.clone(),
        show_temperature: settings.report_settings.show_temperature,
        show_shear_rate: settings.report_settings.show_shear_rate,
        show_pressure: settings.report_settings.show_pressure,
        show_bath_temperature: settings.report_settings.show_bath_temperature,
        show_touch_points: settings.comparison_chart.touch_point.enabled,
        viscosity_threshold: settings.comparison_chart.touch_point.viscosity_threshold,
        show_target_time: settings.comparison_chart.touch_point.show_target_time,
        target_time: settings.comparison_chart.touch_point.target_time,
        show_calibration: settings.section_toggles.show_calibration,
        show_raw_data: settings.section_toggles.show_raw_data,
        shear_rate_axis: settings.report_settings.shear_rate_axis.clone(),
        pressure_axis: settings.report_settings.pressure_axis.clone(),
        axis_mode: settings.comparison_chart.axis_mode.clone(),
        viscosity_shear_rates: settings.report_settings.report_viscosity_rates.clone(),
        show_advanced_stats: true,
        line_settings: Some(build_core_chart_line_settings(
            &settings.comparison_chart.line_settings,
        )),
        rheology_units: settings
            .report_settings
            .rheology_units
            .as_ref()
            .map(build_core_rheology_units),
        rheology_source: "program".to_string(),
    }
}

fn build_core_comparison_chart_config(chart: &ComparisonByIdsChartConfig) -> ComparisonChartConfig {
    ComparisonChartConfig {
        metrics: ComparisonMetrics {
            primary: chart.metrics.primary.clone(),
            left_secondary: chart.metrics.left_secondary.clone(),
            secondary: chart.metrics.secondary.clone(),
            tertiary: chart.metrics.tertiary.clone(),
        },
        axis_mode: chart.axis_mode.clone(),
        brush_range: chart.brush_range,
        touch_point: TouchPointConfig {
            enabled: chart.touch_point.enabled,
            viscosity_threshold: chart.touch_point.viscosity_threshold,
            show_target_time: chart.touch_point.show_target_time,
            target_time: chart.touch_point.target_time,
        },
        line_settings: build_core_chart_line_settings(&chart.line_settings),
        experiment_colors: chart.experiment_colors.clone(),
        time_format: chart.time_format.clone(),
        downsample_mode: chart.downsample_mode.clone(),
        chart_width: chart.chart_width,
        chart_height: chart.chart_height,
    }
}

fn build_core_section_toggles(settings: &ComparisonByIdsSectionToggles) -> SectionToggles {
    SectionToggles {
        show_calibration: settings.show_calibration,
        show_raw_data: settings.show_raw_data,
        show_recipe: settings.show_recipe,
        show_water_analysis: settings.show_water_analysis,
        show_rheology: settings.show_rheology,
    }
}

fn build_core_chart_line_settings(
    settings: &ComparisonByIdsChartLineSettings,
) -> ChartLineSettings {
    ChartLineSettings {
        viscosity: build_core_line_settings(&settings.viscosity),
        temperature: build_core_line_settings(&settings.temperature),
        shear_rate: build_core_line_settings(&settings.shear_rate),
        pressure: build_core_line_settings(&settings.pressure),
        rpm: build_core_line_settings(&settings.rpm),
        bath_temperature: settings
            .bath_temperature
            .as_ref()
            .map(build_core_line_settings),
    }
}

fn build_core_line_settings(settings: &ComparisonByIdsLineSettings) -> LineSettings {
    LineSettings {
        color: settings.color.clone(),
        width: settings.width,
        style: settings.style.clone(),
    }
}

fn build_core_rheology_units(units: &ComparisonByIdsRheologyUnits) -> RheologyUnits {
    RheologyUnits {
        viscosity: units.viscosity.clone(),
        temperature: units.temperature.clone(),
        pressure: units.pressure.clone(),
        consistency: units.consistency.clone(),
        plastic_viscosity: units.plastic_viscosity.clone(),
        yield_point: units.yield_point.clone(),
        time_format: units.time_format.clone(),
    }
}

fn axis_values_from_raw_data(points: &[Value]) -> Result<Option<AxisValues>> {
    let data = raw_points_to_rheo_points(points)?;
    if data.is_empty() {
        return Ok(None);
    }
    let mut time_min = f64::INFINITY;
    let mut time_max = f64::NEG_INFINITY;
    let mut viscosity_min = f64::INFINITY;
    let mut viscosity_max = f64::NEG_INFINITY;
    let mut temperature_min = f64::INFINITY;
    let mut temperature_max = f64::NEG_INFINITY;
    let mut shear_rate_min = f64::INFINITY;
    let mut shear_rate_max = f64::NEG_INFINITY;
    let mut pressure_min = f64::INFINITY;
    let mut pressure_max = f64::NEG_INFINITY;

    for point in &data {
        let shear_rate = point.shear_rate.unwrap_or(0.0);
        let pressure = point.pressure_bar.unwrap_or(0.0);
        time_min = time_min.min(point.time_sec);
        time_max = time_max.max(point.time_sec);
        viscosity_min = viscosity_min.min(point.viscosity_cp);
        viscosity_max = viscosity_max.max(point.viscosity_cp);
        temperature_min = temperature_min.min(point.temperature_c);
        temperature_max = temperature_max.max(point.temperature_c);
        shear_rate_min = shear_rate_min.min(shear_rate);
        shear_rate_max = shear_rate_max.max(shear_rate);
        pressure_min = pressure_min.min(pressure);
        pressure_max = pressure_max.max(pressure);
    }

    Ok(Some(AxisValues {
        time_min: finite_or_zero(time_min) / 60.0,
        time_max: finite_or_zero(time_max) / 60.0,
        viscosity_min: finite_or_zero(viscosity_min),
        viscosity_max: finite_or_zero(viscosity_max),
        temperature_min: finite_or_zero(temperature_min),
        temperature_max: finite_or_zero(temperature_max),
        shear_rate_min: finite_or_zero(shear_rate_min),
        shear_rate_max: finite_or_zero(shear_rate_max),
        pressure_min: finite_or_zero(pressure_min),
        pressure_max: finite_or_zero(pressure_max),
    }))
}

fn finite_or_zero(value: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

fn json_string_any(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .map(str::to_owned)
}

fn json_f64_any(value: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter()
        .find_map(|key| value.get(*key).and_then(Value::as_f64))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AnalysisCacheStatus {
    Hit,
    MissPending,
    MissStored,
    MissStoreFailed,
    Bypass,
}

struct CachedComparisonExperiment {
    experiment: StoredExperiment,
    rheo_points: Vec<RheoPoint>,
    analysis: Option<AnalysisOutput>,
    cache_key: Option<AnalysisCacheKey>,
    cache_status: AnalysisCacheStatus,
    artifact_bytes_read: u64,
    artifact_bytes_written: u64,
}
