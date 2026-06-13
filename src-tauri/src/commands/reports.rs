//! Native report generation commands for desktop mode.
//!
//! These commands execute the Rust report engine directly in Tauri runtime
//! and return report bytes to the frontend.
//!
//! Raw bytes are returned via `tauri::ipc::Response` to avoid JSON serialization
//! overhead (eliminates triple-copy: Vec<u8> → JSON number array → JS Array → Uint8Array).
//!
//! **Audit-v2 REP-001 — per-feature gating:** every report IPC checks
//! both `can_write_via_engine` (Active/Grace/Demo gate) **and** the
//! relevant `LicenseFeatures` flag for the kind of report being
//! produced.  Comparison commands additionally enforce the licence's
//! `max_comparison_experiments` so a malicious or buggy frontend
//! cannot hand the native engine an unbounded experiment list and
//! exhaust memory.

use crate::analysis_cache::{
    build_analysis_cache_key, decode_analysis_artifact, encode_analysis_artifact,
    hash_experiment_data_bytes, AnalysisCacheKey, ANALYSIS_ARTIFACT_ENCODING,
};
use crate::commands::licensing::types::LicenseFeatures;
use crate::commands::licensing::{can_write_via_engine, current_features};
use crate::commands::{
    analysis::run_full_analysis_kernel,
    analysis::AnalysisOutput,
    experiments::types::{
        RheologyParameterRow, RheologyParameterSource, StoredExperiment, StoredExperimentReagent,
    },
};
use crate::db::repositories::analysis_artifacts::{
    delete_analysis_artifact, get_analysis_artifact, put_analysis_artifact,
};
use crate::db::repositories::experiments::{load_experiment_data_hashes, load_experiments_batch};
use crate::db::DbPool;
use crate::error::{AppError, Result};
use crate::runtime::jobs::{JobContext, JobKind};
use crate::state::AppState;
use crate::utils::time::now_rfc3339;
use crate::utils::validation::{validate_bounded_str, validate_hash_id};
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
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::{AppHandle, State};

/// Inner implementation used by tests — returns raw bytes.
///
/// Sprint 0 / S0-6: `tracing::instrument` makes the spawn_blocking
/// boundary measurable.  `skip_all` keeps the heavy `ReportInput`
/// out of the span fields (it is megabytes-sized after Float64Array
/// expansion).  The rheolab-core call itself is not instrumented —
/// keeping that crate tracing-free is intentional (it is the
/// foundation crate; we measure it from the boundary instead).
#[tracing::instrument(level = "info", skip_all, name = "reports::pdf::spawn_blocking")]
#[cfg_attr(not(test), allow(dead_code))]
async fn generate_pdf_bytes(input: ReportInput) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || generate_pdf_bytes_sync(input))
        .await
        .map_err(AppError::Join)?
}

fn generate_pdf_bytes_sync(input: ReportInput) -> Result<Vec<u8>> {
    rheolab_core::report_generator::generate_pdf_from_input(&input).map_err(|error| {
        tracing::error!("PDF generation failed: {}", error);
        AppError::Other("PDF generation failed".into())
    })
}

/// Inner implementation used by tests — returns raw bytes.
#[tracing::instrument(level = "info", skip_all, name = "reports::excel::spawn_blocking")]
#[cfg_attr(not(test), allow(dead_code))]
async fn generate_excel_bytes(input: ReportInput) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || generate_excel_bytes_sync(input))
        .await
        .map_err(AppError::Join)?
}

fn generate_excel_bytes_sync(input: ReportInput) -> Result<Vec<u8>> {
    rheolab_core::report_generator::generate_excel_from_input(&input).map_err(|error| {
        tracing::error!("Excel generation failed: {:?}", error);
        AppError::Other("Excel generation failed".into())
    })
}

/// Inner implementation used by tests — returns raw comparison PDF bytes.
///
/// Sprint 0 / S0-6: span field `n_experiments` lets us correlate Rust
/// time spent vs comparison size.  Sprint 1's by-ids native pipeline
/// will use exactly this metric to prove the saving over the current
/// "TS builds full input" path.
#[tracing::instrument(
    level = "info",
    skip_all,
    name = "reports::comparison::pdf::spawn_blocking",
    fields(n_experiments = input.experiments.len())
)]
#[cfg_attr(not(test), allow(dead_code))]
async fn generate_comparison_pdf_bytes(input: ComparisonReportInput) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || generate_comparison_pdf_bytes_sync(input))
        .await
        .map_err(AppError::Join)?
}

fn generate_comparison_pdf_bytes_sync(input: ComparisonReportInput) -> Result<Vec<u8>> {
    rheolab_core::report_generator::generate_comparison_pdf(&input).map_err(|error| {
        tracing::error!("Comparison PDF generation failed: {}", error);
        AppError::Other("Comparison PDF generation failed".into())
    })
}

/// Inner implementation used by tests — returns raw comparison XLSX bytes.
#[tracing::instrument(
    level = "info",
    skip_all,
    name = "reports::comparison::excel::spawn_blocking",
    fields(n_experiments = input.experiments.len())
)]
#[cfg_attr(not(test), allow(dead_code))]
async fn generate_comparison_excel_bytes(input: ComparisonReportInput) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || generate_comparison_excel_bytes_sync(input))
        .await
        .map_err(AppError::Join)?
}

fn generate_comparison_excel_bytes_sync(input: ComparisonReportInput) -> Result<Vec<u8>> {
    rheolab_core::report_generator::generate_comparison_excel(&input).map_err(|error| {
        tracing::error!("Comparison Excel generation failed: {}", error);
        AppError::Other("Comparison Excel generation failed".into())
    })
}

#[cfg(any(test, debug_assertions))]
#[tauri::command]
pub async fn reports_generate_comparison_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ComparisonReportInput,
) -> Result<tauri::ipc::Response> {
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    let features = current_features(&state).await;
    validate_comparison_direct_input(&input, &features, ReportFormat::Pdf)?;

    let scheduler = state.job_scheduler.clone();
    #[cfg(not(test))]
    let app_handle = Some(app);
    #[cfg(test)]
    let app_handle = {
        let _ = app;
        Some(())
    };
    let bytes = scheduler
        .run_blocking(app_handle, JobKind::ComparisonPdf, move |ctx| {
            #[cfg(debug_assertions)]
            {
                if std::env::var("RHEOLAB_E2E_MOCK_REPORTS").is_ok() {
                    tracing::debug!(
                        "[E2E] reports_generate_comparison_pdf: returning mock PDF bytes"
                    );
                    let bytes = vec![0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];
                    ctx.record_output_bytes(bytes.len() as u64);
                    return Ok(bytes);
                }
            }

            let bytes = generate_comparison_pdf_bytes_sync(input)?;
            ctx.record_output_bytes(bytes.len() as u64);
            Ok(bytes)
        })
        .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(any(test, debug_assertions))]
#[tauri::command]
pub async fn reports_generate_comparison_excel(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ComparisonReportInput,
) -> Result<tauri::ipc::Response> {
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    let features = current_features(&state).await;
    validate_comparison_direct_input(&input, &features, ReportFormat::Excel)?;

    let scheduler = state.job_scheduler.clone();
    #[cfg(not(test))]
    let app_handle = Some(app);
    #[cfg(test)]
    let app_handle = {
        let _ = app;
        Some(())
    };
    let bytes = scheduler
        .run_blocking(app_handle, JobKind::ComparisonExcel, move |ctx| {
            #[cfg(debug_assertions)]
            {
                if std::env::var("RHEOLAB_E2E_MOCK_REPORTS").is_ok() {
                    tracing::debug!(
                        "[E2E] reports_generate_comparison_excel: returning mock XLSX bytes"
                    );
                    let bytes = vec![0x50, 0x4b, 0x03, 0x04];
                    ctx.record_output_bytes(bytes.len() as u64);
                    return Ok(bytes);
                }
            }

            let bytes = generate_comparison_excel_bytes_sync(input)?;
            ctx.record_output_bytes(bytes.len() as u64);
            Ok(bytes)
        })
        .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn reports_generate_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ReportInput,
) -> Result<tauri::ipc::Response> {
    // F-08: License gate — report generation requires a valid license or active demo
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    // Audit-v2 REP-001: per-feature gate — even an active license can
    // legitimately have `export_pdf=false` (e.g. an "expired" tier
    // computed for grace-window licences).  Reject early.
    let features = current_features(&state).await;
    if !features.export_pdf {
        return Err(AppError::License(
            "PDF export is not included in your current licence (REP-001)".into(),
        ));
    }
    enforce_calibration_feature(&features, input.settings.show_calibration)?;
    // E2E fast-path: return a minimal valid %PDF-1.4 header so the UI
    // flow completes instantly without running Typst (which at opt-level=0
    // takes 5+ minutes).  Set RHEOLAB_E2E_MOCK_REPORTS=1 to activate.
    // Gated to debug builds only — never available in release (F-02).
    let scheduler = state.job_scheduler.clone();
    #[cfg(not(test))]
    let app_handle = Some(app);
    #[cfg(test)]
    let app_handle = {
        let _ = app;
        Some(())
    };
    let bytes = scheduler
        .run_blocking(app_handle, JobKind::SinglePdf, move |ctx| {
            #[cfg(debug_assertions)]
            {
                if std::env::var("RHEOLAB_E2E_MOCK_REPORTS").is_ok() {
                    tracing::debug!("[E2E] reports_generate_pdf: returning mock PDF bytes");
                    let bytes = vec![
                        0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, // %PDF-1.4
                    ];
                    ctx.record_output_bytes(bytes.len() as u64);
                    return Ok(bytes);
                }
            }

            let bytes = generate_pdf_bytes_sync(input)?;
            ctx.record_output_bytes(bytes.len() as u64);
            Ok(bytes)
        })
        .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn reports_generate_excel(
    app: AppHandle,
    state: State<'_, AppState>,
    input: ReportInput,
) -> Result<tauri::ipc::Response> {
    // F-08: License gate — report generation requires a valid license or active demo
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    // Audit-v2 REP-001: per-feature gate (see reports_generate_pdf).
    let features = current_features(&state).await;
    if !features.export_excel {
        return Err(AppError::License(
            "Excel export is not included in your current licence (REP-001)".into(),
        ));
    }
    enforce_calibration_feature(&features, input.settings.show_calibration)?;
    // E2E fast-path: return a minimal PK ZIP header so the UI flow completes.
    // Gated to debug builds only — never available in release (F-02).
    let scheduler = state.job_scheduler.clone();
    #[cfg(not(test))]
    let app_handle = Some(app);
    #[cfg(test)]
    let app_handle = {
        let _ = app;
        Some(())
    };
    let bytes = scheduler
        .run_blocking(app_handle, JobKind::SingleExcel, move |ctx| {
            #[cfg(debug_assertions)]
            {
                if std::env::var("RHEOLAB_E2E_MOCK_REPORTS").is_ok() {
                    tracing::debug!("[E2E] reports_generate_excel: returning mock XLSX bytes");
                    let bytes = vec![0x50, 0x4b, 0x03, 0x04];
                    ctx.record_output_bytes(bytes.len() as u64);
                    return Ok(bytes);
                }
            }

            let bytes = generate_excel_bytes_sync(input)?;
            ctx.record_output_bytes(bytes.len() as u64);
            Ok(bytes)
        })
        .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn reports_generate_pdf_by_id(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ExperimentReportByIdRequest,
) -> Result<tauri::ipc::Response> {
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    let features = current_features(&state).await;
    validate_report_by_id_request(&request, &features, ReportFormat::Pdf)?;

    let pool = state.db_pool.clone();
    let scheduler = state.job_scheduler.clone();
    #[cfg(not(test))]
    let app_handle = Some(app);
    #[cfg(test)]
    let app_handle = {
        let _ = app;
        Some(())
    };
    let bytes = scheduler
        .run_blocking(app_handle, JobKind::SinglePdf, move |ctx| {
            #[cfg(debug_assertions)]
            {
                if std::env::var("RHEOLAB_E2E_MOCK_REPORTS").is_ok() {
                    tracing::debug!("[E2E] reports_generate_pdf_by_id: returning mock PDF bytes");
                    let bytes = vec![0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];
                    ctx.record_output_bytes(bytes.len() as u64);
                    return Ok(bytes);
                }
            }

            generate_pdf_by_id_bytes_cached_with_job(&pool, &request, &ctx)
        })
        .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn reports_generate_excel_by_id(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ExperimentReportByIdRequest,
) -> Result<tauri::ipc::Response> {
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    let features = current_features(&state).await;
    validate_report_by_id_request(&request, &features, ReportFormat::Excel)?;

    let pool = state.db_pool.clone();
    let scheduler = state.job_scheduler.clone();
    #[cfg(not(test))]
    let app_handle = Some(app);
    #[cfg(test)]
    let app_handle = {
        let _ = app;
        Some(())
    };
    let bytes = scheduler
        .run_blocking(app_handle, JobKind::SingleExcel, move |ctx| {
            #[cfg(debug_assertions)]
            {
                if std::env::var("RHEOLAB_E2E_MOCK_REPORTS").is_ok() {
                    tracing::debug!(
                        "[E2E] reports_generate_excel_by_id: returning mock XLSX bytes"
                    );
                    let bytes = vec![0x50, 0x4b, 0x03, 0x04];
                    ctx.record_output_bytes(bytes.len() as u64);
                    return Ok(bytes);
                }
            }

            generate_excel_by_id_bytes_cached_with_job(&pool, &request, &ctx)
        })
        .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn reports_generate_comparison_pdf_by_ids(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ComparisonReportByIdsRequest,
) -> Result<tauri::ipc::Response> {
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    let features = current_features(&state).await;
    validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)?;

    let pool = state.db_pool.clone();
    let scheduler = state.job_scheduler.clone();
    #[cfg(not(test))]
    let app_handle = Some(app);
    #[cfg(test)]
    let app_handle = {
        let _ = app;
        Some(())
    };
    let bytes = scheduler
        .run_blocking(app_handle, JobKind::ComparisonPdf, move |ctx| {
            #[cfg(debug_assertions)]
            {
                if std::env::var("RHEOLAB_E2E_MOCK_REPORTS").is_ok() {
                    tracing::debug!(
                        "[E2E] reports_generate_comparison_pdf_by_ids: returning mock PDF bytes"
                    );
                    let bytes = vec![0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34];
                    ctx.record_output_bytes(bytes.len() as u64);
                    return Ok(bytes);
                }
            }

            generate_comparison_pdf_by_ids_bytes_cached_with_job(&pool, &request, &ctx)
        })
        .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn reports_generate_comparison_excel_by_ids(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ComparisonReportByIdsRequest,
) -> Result<tauri::ipc::Response> {
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    let features = current_features(&state).await;
    validate_comparison_by_ids_request(&request, &features, ReportFormat::Excel)?;

    let pool = state.db_pool.clone();
    let scheduler = state.job_scheduler.clone();
    #[cfg(not(test))]
    let app_handle = Some(app);
    #[cfg(test)]
    let app_handle = {
        let _ = app;
        Some(())
    };
    let bytes = scheduler
        .run_blocking(app_handle, JobKind::ComparisonExcel, move |ctx| {
            #[cfg(debug_assertions)]
            {
                if std::env::var("RHEOLAB_E2E_MOCK_REPORTS").is_ok() {
                    tracing::debug!(
                        "[E2E] reports_generate_comparison_excel_by_ids: returning mock XLSX bytes"
                    );
                    let bytes = vec![0x50, 0x4b, 0x03, 0x04];
                    ctx.record_output_bytes(bytes.len() as u64);
                    return Ok(bytes);
                }
            }

            generate_comparison_excel_by_ids_bytes_cached_with_job(&pool, &request, &ctx)
        })
        .await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tracing::instrument(
    level = "info",
    skip_all,
    name = "reports::cmp::pdf::by_ids",
    fields(n_experiments = request.experiment_ids.len())
)]
#[cfg(test)]
fn generate_comparison_pdf_by_ids_bytes(
    conn: &rusqlite::Connection,
    request: &ComparisonReportByIdsRequest,
) -> Result<Vec<u8>> {
    let experiments = load_comparison_experiments_by_ids(conn, request)?;
    generate_comparison_pdf_by_ids_bytes_from_experiments(&experiments, request)
}

#[tracing::instrument(
    level = "info",
    skip_all,
    name = "reports::cmp::pdf::by_ids_cached",
    fields(n_experiments = request.experiment_ids.len())
)]
#[cfg(test)]
fn generate_comparison_pdf_by_ids_bytes_cached(
    pool: &DbPool,
    request: &ComparisonReportByIdsRequest,
) -> Result<Vec<u8>> {
    let input = build_comparison_report_input_by_ids_cached(pool, request)?;
    rheolab_core::report_generator::generate_comparison_pdf(&input).map_err(|error| {
        tracing::error!("Comparison PDF by IDs generation failed: {}", error);
        AppError::Other(format!(
            "Comparison PDF by IDs generation failed: {}",
            error
        ))
    })
}

fn generate_comparison_pdf_by_ids_bytes_cached_with_job(
    pool: &DbPool,
    request: &ComparisonReportByIdsRequest,
    ctx: &JobContext,
) -> Result<Vec<u8>> {
    let input = build_comparison_report_input_by_ids_cached_with_job(pool, request, Some(ctx))?;
    ctx.ensure_not_cancelled()?;
    ctx.progress(
        "render_pdf",
        request.experiment_ids.len() as u64,
        Some(request.experiment_ids.len() as u64),
        Some("Rendering comparison PDF".into()),
    );
    let bytes =
        rheolab_core::report_generator::generate_comparison_pdf(&input).map_err(|error| {
            tracing::error!("Comparison PDF by IDs generation failed: {}", error);
            AppError::Other(format!(
                "Comparison PDF by IDs generation failed: {}",
                error
            ))
        })?;
    ctx.record_output_bytes(bytes.len() as u64);
    Ok(bytes)
}

#[cfg(test)]
fn generate_comparison_pdf_by_ids_bytes_from_experiments(
    experiments: &[StoredExperiment],
    request: &ComparisonReportByIdsRequest,
) -> Result<Vec<u8>> {
    let input = build_comparison_report_input_from_experiments(experiments, request)?;
    rheolab_core::report_generator::generate_comparison_pdf(&input).map_err(|error| {
        tracing::error!("Comparison PDF by IDs generation failed: {}", error);
        AppError::Other(format!(
            "Comparison PDF by IDs generation failed: {}",
            error
        ))
    })
}

#[tracing::instrument(
    level = "info",
    skip_all,
    name = "reports::cmp::xlsx::by_ids",
    fields(n_experiments = request.experiment_ids.len())
)]
#[cfg(test)]
fn generate_comparison_excel_by_ids_bytes(
    conn: &rusqlite::Connection,
    request: &ComparisonReportByIdsRequest,
) -> Result<Vec<u8>> {
    let experiments = load_comparison_experiments_by_ids(conn, request)?;
    generate_comparison_excel_by_ids_bytes_from_experiments(&experiments, request)
}

#[tracing::instrument(
    level = "info",
    skip_all,
    name = "reports::cmp::xlsx::by_ids_cached",
    fields(n_experiments = request.experiment_ids.len())
)]
#[cfg(test)]
fn generate_comparison_excel_by_ids_bytes_cached(
    pool: &DbPool,
    request: &ComparisonReportByIdsRequest,
) -> Result<Vec<u8>> {
    let input = build_comparison_report_input_by_ids_cached(pool, request)?;
    rheolab_core::report_generator::generate_comparison_excel(&input).map_err(|error| {
        tracing::error!("Comparison Excel by IDs generation failed: {}", error);
        AppError::Other(format!(
            "Comparison Excel by IDs generation failed: {}",
            error
        ))
    })
}

fn generate_comparison_excel_by_ids_bytes_cached_with_job(
    pool: &DbPool,
    request: &ComparisonReportByIdsRequest,
    ctx: &JobContext,
) -> Result<Vec<u8>> {
    let input = build_comparison_report_input_by_ids_cached_with_job(pool, request, Some(ctx))?;
    ctx.ensure_not_cancelled()?;
    ctx.progress(
        "render_xlsx",
        request.experiment_ids.len() as u64,
        Some(request.experiment_ids.len() as u64),
        Some("Rendering comparison XLSX".into()),
    );
    let bytes =
        rheolab_core::report_generator::generate_comparison_excel(&input).map_err(|error| {
            tracing::error!("Comparison Excel by IDs generation failed: {}", error);
            AppError::Other(format!(
                "Comparison Excel by IDs generation failed: {}",
                error
            ))
        })?;
    ctx.record_output_bytes(bytes.len() as u64);
    Ok(bytes)
}

#[cfg(test)]
fn generate_comparison_excel_by_ids_bytes_from_experiments(
    experiments: &[StoredExperiment],
    request: &ComparisonReportByIdsRequest,
) -> Result<Vec<u8>> {
    let input = build_comparison_report_input_from_experiments(experiments, request)?;
    rheolab_core::report_generator::generate_comparison_excel(&input).map_err(|error| {
        tracing::error!("Comparison Excel by IDs generation failed: {}", error);
        AppError::Other(format!(
            "Comparison Excel by IDs generation failed: {}",
            error
        ))
    })
}

fn generate_pdf_by_id_bytes_cached_with_job(
    pool: &DbPool,
    request: &ExperimentReportByIdRequest,
    ctx: &JobContext,
) -> Result<Vec<u8>> {
    let input = build_report_input_by_id_cached_with_job(pool, request, Some(ctx))?;
    ctx.ensure_not_cancelled()?;
    ctx.progress(
        "render_pdf",
        1,
        Some(1),
        Some("Rendering PDF report".into()),
    );
    let bytes =
        rheolab_core::report_generator::generate_pdf_from_input(&input).map_err(|error| {
            tracing::error!("PDF by ID generation failed: {}", error);
            AppError::Other(format!("PDF by ID generation failed: {}", error))
        })?;
    ctx.record_output_bytes(bytes.len() as u64);
    Ok(bytes)
}

fn generate_excel_by_id_bytes_cached_with_job(
    pool: &DbPool,
    request: &ExperimentReportByIdRequest,
    ctx: &JobContext,
) -> Result<Vec<u8>> {
    let input = build_report_input_by_id_cached_with_job(pool, request, Some(ctx))?;
    ctx.ensure_not_cancelled()?;
    ctx.progress(
        "render_xlsx",
        1,
        Some(1),
        Some("Rendering XLSX report".into()),
    );
    let bytes =
        rheolab_core::report_generator::generate_excel_from_input(&input).map_err(|error| {
            tracing::error!("Excel by ID generation failed: {:?}", error);
            AppError::Other(format!("Excel by ID generation failed: {:?}", error))
        })?;
    ctx.record_output_bytes(bytes.len() as u64);
    Ok(bytes)
}

fn build_report_input_by_id_cached_with_job(
    pool: &DbPool,
    request: &ExperimentReportByIdRequest,
    ctx: Option<&JobContext>,
) -> Result<ReportInput> {
    let comparison_request = single_report_as_comparison_request(request);
    let mut comparison_input =
        build_comparison_report_input_by_ids_cached_with_job(pool, &comparison_request, ctx)?;
    let entry = comparison_input
        .experiments
        .pop()
        .ok_or_else(|| AppError::Other("Report by ID produced no experiment entry".into()))?;
    let mut report_input = entry.report_input;
    apply_single_report_overrides(&mut report_input, request);
    Ok(report_input)
}

fn single_report_as_comparison_request(
    request: &ExperimentReportByIdRequest,
) -> ComparisonReportByIdsRequest {
    ComparisonReportByIdsRequest {
        experiment_ids: vec![request.experiment_id.clone()],
        settings: request.settings.clone(),
    }
}

fn apply_single_report_overrides(input: &mut ReportInput, request: &ExperimentReportByIdRequest) {
    if request.settings.section_toggles.show_recipe {
        if let Some(recipe) = &request.recipe_override {
            input.recipe = recipe
                .iter()
                .map(|item| Reagent {
                    name: item.name.clone(),
                    concentration: item.concentration,
                    unit: item.unit.clone(),
                    category: item.category.clone(),
                    batch_number: item.batch_number.clone(),
                })
                .collect();
        }
    }

    if request.settings.section_toggles.show_water_analysis {
        if let Some(water) = &request.water_override {
            input.water_params = Some(WaterParams {
                source: water.source.clone(),
                salinity: water.salinity,
                ph: water.ph,
                hardness: water.hardness,
                fe: water.fe,
                ca: water.ca,
                mg: water.mg,
                cl: water.cl,
                so4: water.so4,
                hco3: water.hco3,
            });
        }
    }
}

#[cfg(test)]
fn build_comparison_report_input_by_ids(
    conn: &rusqlite::Connection,
    request: &ComparisonReportByIdsRequest,
) -> Result<ComparisonReportInput> {
    let experiments = load_comparison_experiments_by_ids(conn, request)?;
    build_comparison_report_input_from_experiments(&experiments, request)
}

#[cfg(test)]
fn build_comparison_report_input_by_ids_cached(
    pool: &DbPool,
    request: &ComparisonReportByIdsRequest,
) -> Result<ComparisonReportInput> {
    build_comparison_report_input_by_ids_cached_with_job(pool, request, None)
}

fn build_comparison_report_input_by_ids_cached_with_job(
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

fn load_comparison_experiments_by_ids(
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
fn build_comparison_report_input_from_experiments(
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

fn build_analysis_key_for_experiment(
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

fn build_expert_settings(settings: &ComparisonByIdsAnalysisSettings) -> ExpertSettings {
    ExpertSettings {
        points_to_average: settings.points_to_average,
        viscosity_shear_rates: settings.viscosity_shear_rates.clone(),
    }
}

fn build_schedule_config(settings: &ComparisonByIdsDetectionSettings) -> ScheduleConfig {
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

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentReportByIdRequest {
    pub experiment_id: String,
    pub settings: ComparisonReportByIdsSettings,
    #[serde(default)]
    pub recipe_override: Option<Vec<ExperimentReportRecipeOverride>>,
    #[serde(default)]
    pub water_override: Option<ExperimentReportWaterOverride>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentReportRecipeOverride {
    pub name: String,
    pub concentration: f64,
    pub unit: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub batch_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentReportWaterOverride {
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub salinity: Option<f64>,
    #[serde(default)]
    pub ph: Option<f64>,
    #[serde(default)]
    pub hardness: Option<f64>,
    #[serde(default)]
    pub fe: Option<f64>,
    #[serde(default)]
    pub ca: Option<f64>,
    #[serde(default)]
    pub mg: Option<f64>,
    #[serde(default)]
    pub cl: Option<f64>,
    #[serde(default)]
    pub so4: Option<f64>,
    #[serde(default)]
    pub hco3: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonReportByIdsRequest {
    pub experiment_ids: Vec<String>,
    pub settings: ComparisonReportByIdsSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonReportByIdsSettings {
    pub language: String,
    pub unit_system: String,
    #[serde(default)]
    pub company_name: Option<String>,
    #[serde(default)]
    pub company_logo_base64: Option<String>,
    #[serde(default)]
    pub generated_at: Option<String>,
    #[serde(default)]
    pub rheology_source_override: Option<RheologyParameterSource>,
    pub comparison_chart: ComparisonByIdsChartConfig,
    pub section_toggles: ComparisonByIdsSectionToggles,
    pub report_settings: ComparisonByIdsReportSettings,
    #[serde(default = "default_comparison_analysis_settings")]
    pub analysis_settings: ComparisonByIdsAnalysisSettings,
    #[serde(default)]
    pub detection_settings: ComparisonByIdsDetectionSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsReportSettings {
    pub show_temperature: bool,
    pub show_shear_rate: bool,
    pub show_pressure: bool,
    pub show_bath_temperature: bool,
    pub shear_rate_axis: String,
    pub pressure_axis: String,
    pub show_advanced_stats: bool,
    pub report_viscosity_rates: Vec<i32>,
    #[serde(default)]
    pub rheology_units: Option<ComparisonByIdsRheologyUnits>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsChartConfig {
    pub metrics: ComparisonByIdsMetrics,
    pub axis_mode: String,
    #[serde(default)]
    pub brush_range: Option<[f64; 2]>,
    pub touch_point: ComparisonByIdsTouchPointConfig,
    pub line_settings: ComparisonByIdsChartLineSettings,
    pub experiment_colors: Vec<String>,
    #[serde(default = "default_comparison_time_format")]
    pub time_format: String,
    #[serde(default = "default_comparison_downsample_mode")]
    pub downsample_mode: String,
    #[serde(default = "default_comparison_chart_width")]
    pub chart_width: u32,
    #[serde(default = "default_comparison_chart_height")]
    pub chart_height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsMetrics {
    pub primary: String,
    pub left_secondary: String,
    pub secondary: String,
    pub tertiary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsTouchPointConfig {
    pub enabled: bool,
    pub viscosity_threshold: f64,
    pub show_target_time: bool,
    pub target_time: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsLineSettings {
    #[serde(default = "default_line_color")]
    pub color: String,
    #[serde(default = "default_line_width")]
    pub width: u8,
    #[serde(default = "default_line_style")]
    pub style: String,
}

impl Default for ComparisonByIdsLineSettings {
    fn default() -> Self {
        Self {
            color: default_line_color(),
            width: default_line_width(),
            style: default_line_style(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsChartLineSettings {
    #[serde(default)]
    pub viscosity: ComparisonByIdsLineSettings,
    #[serde(default)]
    pub temperature: ComparisonByIdsLineSettings,
    #[serde(default)]
    pub shear_rate: ComparisonByIdsLineSettings,
    #[serde(default)]
    pub pressure: ComparisonByIdsLineSettings,
    #[serde(default)]
    pub rpm: ComparisonByIdsLineSettings,
    #[serde(default)]
    pub bath_temperature: Option<ComparisonByIdsLineSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsSectionToggles {
    pub show_calibration: bool,
    pub show_raw_data: bool,
    pub show_recipe: bool,
    pub show_water_analysis: bool,
    #[serde(default = "default_show_rheology")]
    pub show_rheology: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsRheologyUnits {
    #[serde(default)]
    pub viscosity: String,
    #[serde(default)]
    pub temperature: String,
    #[serde(default)]
    pub pressure: String,
    #[serde(default)]
    pub consistency: String,
    #[serde(default)]
    pub plastic_viscosity: String,
    #[serde(default)]
    pub yield_point: String,
    #[serde(default)]
    pub time_format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsAnalysisSettings {
    #[serde(default)]
    pub points_to_average: i32,
    #[serde(default = "default_analysis_viscosity_shear_rates")]
    pub viscosity_shear_rates: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsDetectionSettings {
    #[serde(default = "default_shear_rate_tolerance")]
    pub shear_rate_tolerance: f64,
    #[serde(default = "default_shear_rate_rel_tolerance")]
    pub shear_rate_rel_tolerance: f64,
    #[serde(default = "default_min_step_duration")]
    pub min_step_duration: f64,
    #[serde(default = "default_step_splitting")]
    pub step_splitting: bool,
    #[serde(default = "default_split_start_duration")]
    pub split_start_duration: f64,
    #[serde(default = "default_split_end_duration")]
    pub split_end_duration: f64,
    #[serde(default = "default_min_duration_for_split")]
    pub min_duration_for_split: f64,
}

impl Default for ComparisonByIdsDetectionSettings {
    fn default() -> Self {
        Self {
            shear_rate_tolerance: default_shear_rate_tolerance(),
            shear_rate_rel_tolerance: default_shear_rate_rel_tolerance(),
            min_step_duration: default_min_step_duration(),
            step_splitting: default_step_splitting(),
            split_start_duration: default_split_start_duration(),
            split_end_duration: default_split_end_duration(),
            min_duration_for_split: default_min_duration_for_split(),
        }
    }
}

#[allow(dead_code)]
pub enum ReportOutput {
    Bytes(Vec<u8>),
    TempFile { path: PathBuf, byte_count: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReportFormat {
    Pdf,
    Excel,
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

const MAX_COMPANY_NAME_BYTES: usize = 255;
const MAX_COMPANY_LOGO_BASE64_BYTES: usize = 5_000_000;
const MAX_GENERATED_AT_BYTES: usize = 64;
const MAX_REPORT_RECIPE_ROWS: usize = 256;
const MAX_REPORT_RECIPE_TEXT_BYTES: usize = 255;
const MAX_REPORT_WATER_SOURCE_BYTES: usize = 255;
const MAX_METRIC_KEY_BYTES: usize = 64;
const MAX_COLOR_BYTES: usize = 64;
const MAX_LINE_WIDTH: u8 = 16;
const MAX_VISCOSITY_RATES: usize = 32;
const MIN_CHART_DIMENSION: u32 = 100;
const MAX_CHART_DIMENSION: u32 = 8_000;
const MAX_TIME_MINUTES: f64 = 1_000_000.0;
const MAX_SHEAR_RATE: f64 = 100_000.0;

fn default_comparison_time_format() -> String {
    "minutes".into()
}

fn default_comparison_downsample_mode() -> String {
    "smart".into()
}

fn default_comparison_chart_width() -> u32 {
    1400
}

fn default_comparison_chart_height() -> u32 {
    700
}

fn default_line_color() -> String {
    "#3b82f6".into()
}

fn default_line_width() -> u8 {
    2
}

fn default_line_style() -> String {
    "solid".into()
}

fn default_show_rheology() -> bool {
    true
}

fn default_analysis_viscosity_shear_rates() -> Vec<f64> {
    vec![40.0, 100.0, 170.0]
}

fn default_shear_rate_tolerance() -> f64 {
    2.0
}

fn default_shear_rate_rel_tolerance() -> f64 {
    5.0
}

fn default_min_step_duration() -> f64 {
    5.0
}

fn default_step_splitting() -> bool {
    true
}

fn default_split_start_duration() -> f64 {
    30.0
}

fn default_split_end_duration() -> f64 {
    30.0
}

fn default_min_duration_for_split() -> f64 {
    90.0
}

fn default_comparison_analysis_settings() -> ComparisonByIdsAnalysisSettings {
    ComparisonByIdsAnalysisSettings {
        points_to_average: 0,
        viscosity_shear_rates: default_analysis_viscosity_shear_rates(),
    }
}

fn validate_comparison_by_ids_request(
    request: &ComparisonReportByIdsRequest,
    features: &LicenseFeatures,
    format: ReportFormat,
) -> Result<()> {
    if request.experiment_ids.is_empty() {
        return Err(AppError::BadRequest(
            "experimentIds must contain at least one experiment".into(),
        ));
    }

    let mut seen = HashSet::with_capacity(request.experiment_ids.len());
    for id in &request.experiment_ids {
        validate_hash_id(id, "experimentIds[]")?;
        if !seen.insert(id) {
            return Err(AppError::BadRequest(format!(
                "duplicate experiment ID in experimentIds: {id}"
            )));
        }
    }

    match format {
        ReportFormat::Pdf => {
            enforce_comparison_pdf_features(features, request.experiment_ids.len())?
        }
        ReportFormat::Excel => {
            enforce_comparison_excel_features(features, request.experiment_ids.len())?
        }
    }
    enforce_calibration_feature(features, request.settings.section_toggles.show_calibration)?;

    request.settings.validate()
}

fn validate_comparison_direct_input(
    input: &ComparisonReportInput,
    features: &LicenseFeatures,
    format: ReportFormat,
) -> Result<()> {
    if input.experiments.is_empty() {
        return Err(AppError::BadRequest(
            "comparison input must contain at least one experiment".into(),
        ));
    }

    let mut seen = HashSet::with_capacity(input.experiments.len());
    for entry in &input.experiments {
        validate_bounded_str(&entry.id, MAX_METRIC_KEY_BYTES, "experiments[].id")?;
        if entry.id.trim().is_empty() {
            return Err(AppError::BadRequest(
                "experiments[].id must not be empty".into(),
            ));
        }
        if !seen.insert(&entry.id) {
            return Err(AppError::BadRequest(format!(
                "duplicate experiment ID in comparison input: {}",
                entry.id
            )));
        }
        validate_bounded_str(
            &entry.display_name,
            MAX_REPORT_RECIPE_TEXT_BYTES,
            "experiments[].displayName",
        )?;
    }

    match format {
        ReportFormat::Pdf => enforce_comparison_pdf_features(features, input.experiments.len())?,
        ReportFormat::Excel => {
            enforce_comparison_excel_features(features, input.experiments.len())?
        }
    }
    enforce_calibration_feature(
        features,
        input.experiments.iter().any(|entry| {
            entry.section_toggles.show_calibration || entry.report_input.settings.show_calibration
        }),
    )?;

    validate_language(&input.language)?;
    validate_unit_system(&input.unit_system)?;
    if let Some(company_name) = &input.company_name {
        validate_bounded_str(company_name, MAX_COMPANY_NAME_BYTES, "companyName")?;
    }
    if let Some(company_logo_base64) = &input.company_logo_base64 {
        validate_bounded_str(
            company_logo_base64,
            MAX_COMPANY_LOGO_BASE64_BYTES,
            "companyLogoBase64",
        )?;
    }
    validate_bounded_str(&input.generated_at, MAX_GENERATED_AT_BYTES, "generatedAt")?;
    validate_core_comparison_chart(&input.comparison_chart)
}

fn validate_report_by_id_request(
    request: &ExperimentReportByIdRequest,
    features: &LicenseFeatures,
    format: ReportFormat,
) -> Result<()> {
    validate_hash_id(&request.experiment_id, "experimentId")?;
    match format {
        ReportFormat::Pdf => enforce_single_pdf_features(features)?,
        ReportFormat::Excel => enforce_single_excel_features(features)?,
    }
    enforce_calibration_feature(features, request.settings.section_toggles.show_calibration)?;
    request.settings.validate()?;
    validate_recipe_override(request.recipe_override.as_deref())?;
    validate_water_override(request.water_override.as_ref())
}

fn validate_recipe_override(recipe: Option<&[ExperimentReportRecipeOverride]>) -> Result<()> {
    let Some(recipe) = recipe else {
        return Ok(());
    };
    if recipe.len() > MAX_REPORT_RECIPE_ROWS {
        return Err(AppError::BadRequest(format!(
            "recipeOverride exceeds {MAX_REPORT_RECIPE_ROWS} rows"
        )));
    }
    for (idx, item) in recipe.iter().enumerate() {
        let prefix = format!("recipeOverride[{idx}]");
        validate_bounded_str(
            &item.name,
            MAX_REPORT_RECIPE_TEXT_BYTES,
            &format!("{prefix}.name"),
        )?;
        if item.name.trim().is_empty() {
            return Err(AppError::BadRequest(format!(
                "{prefix}.name must not be empty"
            )));
        }
        if !item.concentration.is_finite() || item.concentration < 0.0 {
            return Err(AppError::BadRequest(format!(
                "{prefix}.concentration must be finite and non-negative"
            )));
        }
        validate_bounded_str(
            &item.unit,
            MAX_REPORT_RECIPE_TEXT_BYTES,
            &format!("{prefix}.unit"),
        )?;
        if item.unit.trim().is_empty() {
            return Err(AppError::BadRequest(format!(
                "{prefix}.unit must not be empty"
            )));
        }
        if let Some(category) = &item.category {
            validate_bounded_str(
                category,
                MAX_REPORT_RECIPE_TEXT_BYTES,
                &format!("{prefix}.category"),
            )?;
        }
        if let Some(batch_number) = &item.batch_number {
            validate_bounded_str(
                batch_number,
                MAX_REPORT_RECIPE_TEXT_BYTES,
                &format!("{prefix}.batchNumber"),
            )?;
        }
    }
    Ok(())
}

fn validate_water_override(water: Option<&ExperimentReportWaterOverride>) -> Result<()> {
    let Some(water) = water else {
        return Ok(());
    };
    if let Some(source) = &water.source {
        validate_bounded_str(
            source,
            MAX_REPORT_WATER_SOURCE_BYTES,
            "waterOverride.source",
        )?;
    }
    validate_optional_finite(water.salinity, "waterOverride.salinity")?;
    validate_optional_finite(water.ph, "waterOverride.ph")?;
    validate_optional_finite(water.hardness, "waterOverride.hardness")?;
    validate_optional_finite(water.fe, "waterOverride.fe")?;
    validate_optional_finite(water.ca, "waterOverride.ca")?;
    validate_optional_finite(water.mg, "waterOverride.mg")?;
    validate_optional_finite(water.cl, "waterOverride.cl")?;
    validate_optional_finite(water.so4, "waterOverride.so4")?;
    validate_optional_finite(water.hco3, "waterOverride.hco3")
}

fn validate_optional_finite(value: Option<f64>, field: &str) -> Result<()> {
    if matches!(value, Some(value) if !value.is_finite()) {
        return Err(AppError::BadRequest(format!("{field} must be finite")));
    }
    Ok(())
}

#[cfg(test)]
fn validate_comparison_experiment_ids_exist(
    conn: &rusqlite::Connection,
    experiment_ids: &[String],
) -> Result<()> {
    if experiment_ids.is_empty() {
        return Ok(());
    }
    let placeholders = std::iter::repeat_n("?", experiment_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("SELECT id FROM Experiment WHERE id IN ({placeholders})");
    let mut stmt = conn.prepare(&sql)?;
    let existing: HashSet<String> = stmt
        .query_map(rusqlite::params_from_iter(experiment_ids.iter()), |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<HashSet<_>>>()?;

    let missing = experiment_ids
        .iter()
        .filter(|id| !existing.contains(*id))
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(AppError::BadRequest(format!(
            "Experiment IDs not found: {}",
            missing.join(", ")
        )));
    }
    Ok(())
}

impl ComparisonReportByIdsSettings {
    fn validate(&self) -> Result<()> {
        validate_language(&self.language)?;
        validate_unit_system(&self.unit_system)?;
        if let Some(company_name) = &self.company_name {
            validate_bounded_str(company_name, MAX_COMPANY_NAME_BYTES, "settings.companyName")?;
        }
        if let Some(company_logo_base64) = &self.company_logo_base64 {
            validate_bounded_str(
                company_logo_base64,
                MAX_COMPANY_LOGO_BASE64_BYTES,
                "settings.companyLogoBase64",
            )?;
        }
        if let Some(generated_at) = &self.generated_at {
            validate_bounded_str(generated_at, MAX_GENERATED_AT_BYTES, "settings.generatedAt")?;
        }
        validate_comparison_chart(&self.comparison_chart)?;
        validate_report_settings(&self.report_settings)?;
        validate_analysis_settings(&self.analysis_settings)?;
        validate_detection_settings(&self.detection_settings)
    }
}

fn validate_language(value: &str) -> Result<()> {
    match value {
        "ru" | "en" => Ok(()),
        _ => Err(AppError::BadRequest(format!(
            "settings.language must be 'ru' or 'en' (got '{value}')"
        ))),
    }
}

fn validate_unit_system(value: &str) -> Result<()> {
    match value {
        "SI" | "SI_Pas" | "Imperial" => Ok(()),
        _ => Err(AppError::BadRequest(format!(
            "settings.unitSystem must be 'SI', 'SI_Pas' or 'Imperial' (got '{value}')"
        ))),
    }
}

fn validate_comparison_chart(chart: &ComparisonByIdsChartConfig) -> Result<()> {
    validate_metrics(&chart.metrics)?;
    match chart.axis_mode.as_str() {
        "individual" | "shared" => {}
        other => {
            return Err(AppError::BadRequest(format!(
                "settings.comparisonChart.axisMode must be 'individual' or 'shared' (got '{other}')"
            )));
        }
    }
    if let Some([start, end]) = chart.brush_range {
        validate_non_negative_finite(start, "settings.comparisonChart.brushRange[0]")?;
        validate_non_negative_finite(end, "settings.comparisonChart.brushRange[1]")?;
        if end <= start {
            return Err(AppError::BadRequest(
                "settings.comparisonChart.brushRange must be [start, end] with end > start".into(),
            ));
        }
        if end > MAX_TIME_MINUTES {
            return Err(AppError::BadRequest(format!(
                "settings.comparisonChart.brushRange[1] exceeds {MAX_TIME_MINUTES} minutes"
            )));
        }
    }
    validate_non_negative_finite(
        chart.touch_point.viscosity_threshold,
        "settings.comparisonChart.touchPoint.viscosityThreshold",
    )?;
    validate_non_negative_finite(
        chart.touch_point.target_time,
        "settings.comparisonChart.touchPoint.targetTime",
    )?;
    validate_chart_line_settings(&chart.line_settings)?;
    if chart.experiment_colors.is_empty() {
        return Err(AppError::BadRequest(
            "settings.comparisonChart.experimentColors must not be empty".into(),
        ));
    }
    if chart.experiment_colors.len() > MAX_VISCOSITY_RATES {
        return Err(AppError::BadRequest(format!(
            "settings.comparisonChart.experimentColors exceeds {MAX_VISCOSITY_RATES} entries"
        )));
    }
    for (idx, color) in chart.experiment_colors.iter().enumerate() {
        validate_bounded_str(
            color,
            MAX_COLOR_BYTES,
            &format!("settings.comparisonChart.experimentColors[{idx}]"),
        )?;
    }
    validate_choice(
        &chart.time_format,
        &["seconds", "minutes", "hh:mm:ss"],
        "settings.comparisonChart.timeFormat",
    )?;
    validate_choice(
        &chart.downsample_mode,
        &["off", "smart", "fast"],
        "settings.comparisonChart.downsampleMode",
    )?;
    validate_chart_dimension(chart.chart_width, "settings.comparisonChart.chartWidth")?;
    validate_chart_dimension(chart.chart_height, "settings.comparisonChart.chartHeight")
}

fn validate_core_comparison_chart(chart: &ComparisonChartConfig) -> Result<()> {
    validate_metric_key(
        &chart.metrics.primary,
        "comparisonChart.metrics.primary",
        false,
    )?;
    validate_metric_key(
        &chart.metrics.left_secondary,
        "comparisonChart.metrics.leftSecondary",
        true,
    )?;
    validate_metric_key(
        &chart.metrics.secondary,
        "comparisonChart.metrics.secondary",
        true,
    )?;
    validate_metric_key(
        &chart.metrics.tertiary,
        "comparisonChart.metrics.tertiary",
        true,
    )?;
    match chart.axis_mode.as_str() {
        "individual" | "shared" => {}
        other => {
            return Err(AppError::BadRequest(format!(
                "comparisonChart.axisMode must be 'individual' or 'shared' (got '{other}')"
            )));
        }
    }
    if let Some([start, end]) = chart.brush_range {
        validate_non_negative_finite(start, "comparisonChart.brushRange[0]")?;
        validate_non_negative_finite(end, "comparisonChart.brushRange[1]")?;
        if end <= start {
            return Err(AppError::BadRequest(
                "comparisonChart.brushRange must be [start, end] with end > start".into(),
            ));
        }
        if end > MAX_TIME_MINUTES {
            return Err(AppError::BadRequest(format!(
                "comparisonChart.brushRange[1] exceeds {MAX_TIME_MINUTES} minutes"
            )));
        }
    }
    validate_non_negative_finite(
        chart.touch_point.viscosity_threshold,
        "comparisonChart.touchPoint.viscosityThreshold",
    )?;
    validate_non_negative_finite(
        chart.touch_point.target_time,
        "comparisonChart.touchPoint.targetTime",
    )?;
    if chart.experiment_colors.is_empty() {
        return Err(AppError::BadRequest(
            "comparisonChart.experimentColors must not be empty".into(),
        ));
    }
    if chart.experiment_colors.len() > MAX_VISCOSITY_RATES {
        return Err(AppError::BadRequest(format!(
            "comparisonChart.experimentColors exceeds {MAX_VISCOSITY_RATES} entries"
        )));
    }
    for (idx, color) in chart.experiment_colors.iter().enumerate() {
        validate_bounded_str(
            color,
            MAX_COLOR_BYTES,
            &format!("comparisonChart.experimentColors[{idx}]"),
        )?;
    }
    validate_choice(
        &chart.time_format,
        &["seconds", "minutes", "hh:mm:ss"],
        "comparisonChart.timeFormat",
    )?;
    validate_choice(
        &chart.downsample_mode,
        &["off", "smart", "fast"],
        "comparisonChart.downsampleMode",
    )?;
    validate_chart_dimension(chart.chart_width, "comparisonChart.chartWidth")?;
    validate_chart_dimension(chart.chart_height, "comparisonChart.chartHeight")
}

fn validate_metrics(metrics: &ComparisonByIdsMetrics) -> Result<()> {
    validate_metric_key(
        &metrics.primary,
        "settings.comparisonChart.metrics.primary",
        false,
    )?;
    validate_metric_key(
        &metrics.left_secondary,
        "settings.comparisonChart.metrics.leftSecondary",
        true,
    )?;
    validate_metric_key(
        &metrics.secondary,
        "settings.comparisonChart.metrics.secondary",
        true,
    )?;
    validate_metric_key(
        &metrics.tertiary,
        "settings.comparisonChart.metrics.tertiary",
        true,
    )
}

fn validate_metric_key(value: &str, field: &str, allow_none: bool) -> Result<()> {
    if allow_none && value == "none" {
        return Ok(());
    }
    validate_bounded_str(value, MAX_METRIC_KEY_BYTES, field)?;
    if value.is_empty() {
        return Err(AppError::BadRequest(format!("{field} must not be empty")));
    }
    Ok(())
}

fn validate_chart_line_settings(settings: &ComparisonByIdsChartLineSettings) -> Result<()> {
    validate_line_settings(
        &settings.viscosity,
        "settings.comparisonChart.lineSettings.viscosity",
    )?;
    validate_line_settings(
        &settings.temperature,
        "settings.comparisonChart.lineSettings.temperature",
    )?;
    validate_line_settings(
        &settings.shear_rate,
        "settings.comparisonChart.lineSettings.shearRate",
    )?;
    validate_line_settings(
        &settings.pressure,
        "settings.comparisonChart.lineSettings.pressure",
    )?;
    validate_line_settings(&settings.rpm, "settings.comparisonChart.lineSettings.rpm")?;
    if let Some(bath_temperature) = &settings.bath_temperature {
        validate_line_settings(
            bath_temperature,
            "settings.comparisonChart.lineSettings.bathTemperature",
        )?;
    }
    Ok(())
}

fn validate_line_settings(settings: &ComparisonByIdsLineSettings, field: &str) -> Result<()> {
    validate_bounded_str(&settings.color, MAX_COLOR_BYTES, &format!("{field}.color"))?;
    if settings.width == 0 || settings.width > MAX_LINE_WIDTH {
        return Err(AppError::BadRequest(format!(
            "{field}.width must be between 1 and {MAX_LINE_WIDTH}"
        )));
    }
    validate_choice(
        &settings.style,
        &["solid", "dashed", "dotted"],
        &format!("{field}.style"),
    )
}

fn validate_report_settings(settings: &ComparisonByIdsReportSettings) -> Result<()> {
    validate_axis(
        &settings.shear_rate_axis,
        "settings.reportSettings.shearRateAxis",
    )?;
    validate_axis(
        &settings.pressure_axis,
        "settings.reportSettings.pressureAxis",
    )?;
    validate_i32_shear_rates(
        &settings.report_viscosity_rates,
        "settings.reportSettings.reportViscosityRates",
    )?;
    if let Some(rheology_units) = &settings.rheology_units {
        validate_rheology_units(rheology_units)?;
    }
    Ok(())
}

fn validate_axis(value: &str, field: &str) -> Result<()> {
    validate_choice(value, &["left", "right"], field)
}

fn validate_i32_shear_rates(values: &[i32], field: &str) -> Result<()> {
    if values.is_empty() {
        return Err(AppError::BadRequest(format!("{field} must not be empty")));
    }
    if values.len() > MAX_VISCOSITY_RATES {
        return Err(AppError::BadRequest(format!(
            "{field} exceeds {MAX_VISCOSITY_RATES} entries"
        )));
    }
    let mut seen = HashSet::with_capacity(values.len());
    for (idx, value) in values.iter().copied().enumerate() {
        if value <= 0 || value as f64 > MAX_SHEAR_RATE {
            return Err(AppError::BadRequest(format!(
                "{field}[{idx}] must be > 0 and <= {MAX_SHEAR_RATE}"
            )));
        }
        if !seen.insert(value) {
            return Err(AppError::BadRequest(format!(
                "{field} must not contain duplicate shear rates"
            )));
        }
    }
    Ok(())
}

fn validate_f64_shear_rates(values: &[f64], field: &str) -> Result<()> {
    if values.is_empty() {
        return Err(AppError::BadRequest(format!("{field} must not be empty")));
    }
    if values.len() > MAX_VISCOSITY_RATES {
        return Err(AppError::BadRequest(format!(
            "{field} exceeds {MAX_VISCOSITY_RATES} entries"
        )));
    }
    for (idx, value) in values.iter().copied().enumerate() {
        if !value.is_finite() || value <= 0.0 || value > MAX_SHEAR_RATE {
            return Err(AppError::BadRequest(format!(
                "{field}[{idx}] must be finite, > 0 and <= {MAX_SHEAR_RATE}"
            )));
        }
    }
    Ok(())
}

fn validate_rheology_units(units: &ComparisonByIdsRheologyUnits) -> Result<()> {
    validate_choice(
        &units.viscosity,
        &["mPa·s", "Pa·s", "cP"],
        "settings.reportSettings.rheologyUnits.viscosity",
    )?;
    validate_choice(
        &units.temperature,
        &["°C", "°F"],
        "settings.reportSettings.rheologyUnits.temperature",
    )?;
    validate_choice(
        &units.pressure,
        &["bar", "psi"],
        "settings.reportSettings.rheologyUnits.pressure",
    )?;
    validate_choice(
        &units.consistency,
        &["Pa·s^n", "lbf·s^n/100ft²"],
        "settings.reportSettings.rheologyUnits.consistency",
    )?;
    validate_choice(
        &units.plastic_viscosity,
        &["Pa·s", "cP"],
        "settings.reportSettings.rheologyUnits.plasticViscosity",
    )?;
    validate_choice(
        &units.yield_point,
        &["Pa", "lbf/100ft²"],
        "settings.reportSettings.rheologyUnits.yieldPoint",
    )?;
    validate_choice(
        &units.time_format,
        &["seconds", "minutes", "hh:mm:ss"],
        "settings.reportSettings.rheologyUnits.timeFormat",
    )
}

fn validate_analysis_settings(settings: &ComparisonByIdsAnalysisSettings) -> Result<()> {
    if !(0..=10_000).contains(&settings.points_to_average) {
        return Err(AppError::BadRequest(
            "settings.analysisSettings.pointsToAverage must be between 0 and 10000".into(),
        ));
    }
    validate_f64_shear_rates(
        &settings.viscosity_shear_rates,
        "settings.analysisSettings.viscosityShearRates",
    )
}

fn validate_detection_settings(settings: &ComparisonByIdsDetectionSettings) -> Result<()> {
    validate_non_negative_finite(
        settings.shear_rate_tolerance,
        "settings.detectionSettings.shearRateTolerance",
    )?;
    validate_non_negative_finite(
        settings.shear_rate_rel_tolerance,
        "settings.detectionSettings.shearRateRelTolerance",
    )?;
    validate_non_negative_finite(
        settings.min_step_duration,
        "settings.detectionSettings.minStepDuration",
    )?;
    validate_non_negative_finite(
        settings.split_start_duration,
        "settings.detectionSettings.splitStartDuration",
    )?;
    validate_non_negative_finite(
        settings.split_end_duration,
        "settings.detectionSettings.splitEndDuration",
    )?;
    validate_non_negative_finite(
        settings.min_duration_for_split,
        "settings.detectionSettings.minDurationForSplit",
    )
}

fn validate_choice(value: &str, allowed: &[&str], field: &str) -> Result<()> {
    if allowed.contains(&value) {
        return Ok(());
    }
    Err(AppError::BadRequest(format!(
        "{field} has unsupported value '{value}'"
    )))
}

fn validate_chart_dimension(value: u32, field: &str) -> Result<()> {
    if !(MIN_CHART_DIMENSION..=MAX_CHART_DIMENSION).contains(&value) {
        return Err(AppError::BadRequest(format!(
            "{field} must be between {MIN_CHART_DIMENSION} and {MAX_CHART_DIMENSION}"
        )));
    }
    Ok(())
}

fn validate_non_negative_finite(value: f64, field: &str) -> Result<()> {
    if !value.is_finite() || value < 0.0 {
        return Err(AppError::BadRequest(format!(
            "{field} must be finite and non-negative"
        )));
    }
    Ok(())
}

// ── Audit-v2 REP-001 helpers ───────────────────────────────────────────

fn enforce_single_pdf_features(
    features: &crate::commands::licensing::types::LicenseFeatures,
) -> Result<()> {
    if !features.export_pdf {
        return Err(AppError::License(
            "PDF export is not included in your current licence (REP-001)".into(),
        ));
    }
    Ok(())
}

fn enforce_single_excel_features(
    features: &crate::commands::licensing::types::LicenseFeatures,
) -> Result<()> {
    if !features.export_excel {
        return Err(AppError::License(
            "Excel export is not included in your current licence (REP-001)".into(),
        ));
    }
    Ok(())
}

fn enforce_calibration_feature(
    features: &crate::commands::licensing::types::LicenseFeatures,
    requested: bool,
) -> Result<()> {
    if requested && !features.calibration_analysis {
        return Err(AppError::License(
            "Calibration sections are available only for Developer/Superuser licences (REP-001)"
                .into(),
        ));
    }
    Ok(())
}

/// REP-001 gate for by-IDs comparison PDF exports.
///
/// Pure helper so the licence-feature contract can be unit-tested
/// without going through the full IPC + `LicenseEngine` stack.
fn enforce_comparison_pdf_features(
    features: &crate::commands::licensing::types::LicenseFeatures,
    experiment_count: usize,
) -> Result<()> {
    if !features.comparison {
        return Err(AppError::License(
            "Comparison reports are not included in your current licence (REP-001)".into(),
        ));
    }
    if !features.export_pdf {
        return Err(AppError::License(
            "PDF export is not included in your current licence (REP-001)".into(),
        ));
    }
    enforce_max_comparison_experiments(features.max_comparison_experiments, experiment_count)
}

/// REP-001 gate for by-IDs comparison XLSX exports.  Mirror of the PDF
/// helper but checks `export_excel` instead.
fn enforce_comparison_excel_features(
    features: &crate::commands::licensing::types::LicenseFeatures,
    experiment_count: usize,
) -> Result<()> {
    if !features.comparison {
        return Err(AppError::License(
            "Comparison reports are not included in your current licence (REP-001)".into(),
        ));
    }
    if !features.export_excel {
        return Err(AppError::License(
            "Excel export is not included in your current licence (REP-001)".into(),
        ));
    }
    enforce_max_comparison_experiments(features.max_comparison_experiments, experiment_count)
}

/// Shared count cap.  Negative `max_comparison_experiments` (`-1` in
/// the schema) means "unlimited"; any non-negative value is treated as
/// an inclusive upper bound.
fn enforce_max_comparison_experiments(max: i64, count: usize) -> Result<()> {
    if max < 0 {
        return Ok(()); // unlimited
    }
    if count > max as usize {
        return Err(AppError::License(format!(
            "Comparison size {} exceeds the {} experiments allowed by your licence (REP-001)",
            count, max
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::generate_comparison_excel_bytes;
    use super::generate_comparison_pdf_bytes;
    use super::generate_excel_bytes;
    use super::generate_pdf_bytes;
    use rheolab_core::report_generator::comparison::{
        ComparisonChartConfig, ComparisonExperimentEntry, ComparisonMetrics, ComparisonReportInput,
        SectionToggles, TouchPointConfig,
    };
    use rheolab_core::report_generator::ReportInput;

    const REPORT_FIXTURE_JSON: &str = include_str!("../../../tests/fixtures/report_data.json");

    fn fixture_input() -> ReportInput {
        serde_json::from_str(REPORT_FIXTURE_JSON).expect("fixture should parse")
    }

    fn fixture_comparison_input() -> ComparisonReportInput {
        // Three identical per-exp inputs, distinguishable by display name.
        let make_entry = |id: &str, name: &str| ComparisonExperimentEntry {
            id: id.into(),
            display_name: name.into(),
            report_input: fixture_input(),
            section_toggles: SectionToggles {
                show_calibration: false,
                show_raw_data: false,
                show_recipe: true,
                show_water_analysis: false,
                show_rheology: true,
            },
        };
        ComparisonReportInput {
            language: "en".into(),
            unit_system: "SI".into(),
            company_name: None,
            company_logo_base64: None,
            generated_at: "2026-04-22T00:00:00Z".into(),
            comparison_chart: ComparisonChartConfig {
                metrics: ComparisonMetrics {
                    primary: "viscosity_cp".into(),
                    left_secondary: "none".into(),
                    secondary: "none".into(),
                    tertiary: "none".into(),
                },
                axis_mode: "shared".into(),
                brush_range: None,
                touch_point: TouchPointConfig::default(),
                line_settings: Default::default(),
                experiment_colors: vec!["#1E90FF".into(), "#FF0000".into(), "#008000".into()],
                time_format: "minutes".into(),
                downsample_mode: "smart".into(),
                chart_width: 1400,
                chart_height: 700,
            },
            experiments: vec![
                make_entry("e1", "Chandler A"),
                make_entry("e2", "Chandler B"),
                make_entry("e3", "Grace"),
            ],
        }
    }

    #[tokio::test]
    async fn reports_generate_pdf_returns_pdf_bytes() {
        let bytes = generate_pdf_bytes(fixture_input())
            .await
            .expect("native PDF generation should succeed for fixture input");

        assert!(!bytes.is_empty(), "PDF bytes should not be empty");
        assert!(
            bytes.starts_with(b"%PDF"),
            "PDF output must start with %PDF header"
        );
    }

    #[tokio::test]
    async fn reports_generate_excel_returns_xlsx_bytes() {
        let bytes = generate_excel_bytes(fixture_input())
            .await
            .expect("native Excel generation should succeed for fixture input");

        assert!(!bytes.is_empty(), "Excel bytes should not be empty");
        assert!(
            bytes.starts_with(b"PK"),
            "XLSX output must start with ZIP signature"
        );
    }

    #[tokio::test]
    async fn reports_generate_pdf_rejects_invalid_input() {
        let bad_input = ReportInput {
            metadata: Default::default(),
            cycle_results: vec![],
            recipe: vec![],
            settings: Default::default(),
            ..serde_json::from_str(
                r#"{"metadata":{"filename":""},"cycle_results":[],"recipe":[],"settings":{}}"#,
            )
            .unwrap()
        };
        // A minimal ReportInput should still produce some output (empty report)
        // or fail gracefully — either way, no panic.
        let _ = generate_pdf_bytes(bad_input).await;
    }

    // ── Phase 1.H self-verification: comparison report end-to-end ─────────
    //
    // These tests exercise the full assembler path with 3 synthetic
    // experiments and confirm the byte-level invariants from ADR-0010 §5:
    //   - Excel: PK ZIP header + ≥5 worksheets (Summary + 3 exps + DebugInfo).
    //   - PDF: %PDF header + non-trivial length (typst compile succeeded).

    #[tokio::test]
    async fn reports_generate_comparison_excel_produces_valid_xlsx() {
        let bytes = generate_comparison_excel_bytes(fixture_comparison_input())
            .await
            .expect("comparison Excel should succeed");
        assert!(!bytes.is_empty());
        assert!(
            bytes.starts_with(b"PK"),
            "XLSX must start with ZIP signature"
        );

        // Count `xl/worksheets/sheetN.xml` entries inside the ZIP stream.
        let as_str = String::from_utf8_lossy(&bytes);
        for n in 1..=5 {
            let needle = format!("xl/worksheets/sheet{}.xml", n);
            assert!(
                as_str.contains(&needle),
                "expected workbook to contain {}",
                needle
            );
        }
    }

    #[tokio::test]
    async fn reports_generate_comparison_pdf_produces_valid_pdf() {
        let bytes = generate_comparison_pdf_bytes(fixture_comparison_input())
            .await
            .expect("comparison PDF should succeed");
        assert!(!bytes.is_empty());
        assert!(
            bytes.starts_with(b"%PDF"),
            "PDF must start with %PDF header"
        );
        // Sanity-check size: a 3-experiment report with chart + summary table
        // is well above 20 KB on disk.  If we ever regress to a blank doc,
        // this catches it.
        assert!(bytes.len() > 20_000, "PDF too small: {} bytes", bytes.len());
    }

    // ── Audit-v2 REP-001 regression guards (pure feature-gate helpers) ──

    use super::{
        build_analysis_key_for_experiment, build_comparison_report_input_by_ids,
        build_comparison_report_input_by_ids_cached, build_report_input_by_id_cached_with_job,
        enforce_calibration_feature, enforce_comparison_excel_features,
        enforce_comparison_pdf_features, enforce_max_comparison_experiments,
        enforce_single_excel_features, enforce_single_pdf_features,
        generate_comparison_excel_by_ids_bytes, generate_comparison_excel_by_ids_bytes_cached,
        generate_comparison_pdf_by_ids_bytes, generate_comparison_pdf_by_ids_bytes_cached,
        validate_comparison_by_ids_request, validate_comparison_direct_input,
        validate_comparison_experiment_ids_exist, validate_report_by_id_request,
        ComparisonByIdsChartConfig, ComparisonByIdsChartLineSettings, ComparisonByIdsLineSettings,
        ComparisonByIdsMetrics, ComparisonByIdsReportSettings, ComparisonByIdsSectionToggles,
        ComparisonByIdsTouchPointConfig, ComparisonReportByIdsRequest,
        ComparisonReportByIdsSettings, ExperimentReportByIdRequest, ExperimentReportRecipeOverride,
        ExperimentReportWaterOverride, ReportFormat,
    };
    use crate::analysis_cache::{
        build_analysis_cache_key, decode_analysis_artifact, hash_experiment_data_bytes,
        ANALYSIS_ARTIFACT_ENCODING, ANALYSIS_CACHE_ALGORITHM_VERSION,
    };
    use crate::commands::experiments::types::{
        RheologyParameterRow, RheologyParameterSource, StoredExperiment, StoredExperimentReagent,
    };
    use crate::commands::licensing::types::LicenseFeatures;
    use crate::db::create_pool;
    use crate::db::migration::run_migrations;
    use crate::db::repositories::analysis_artifacts::{
        get_analysis_artifact, put_analysis_artifact,
    };
    use crate::db::repositories::experiments::{load_experiment_data_hashes, persist_experiment};
    use crate::utils::time::now_rfc3339;
    use calamine::Reader;
    use rheolab_core::RHEOLAB_CORE_VERSION;
    use serde_json::json;
    use std::collections::BTreeMap;
    use std::fs;
    use std::io::{Cursor, Read, Seek};
    use std::path::PathBuf;
    use std::time::Instant;
    use tempfile::TempDir;

    /// Helper: build a `LicenseFeatures` with everything explicitly off.
    /// Tests then flip the specific flags they care about.
    fn empty_features() -> LicenseFeatures {
        LicenseFeatures {
            max_experiments: 0,
            max_comparison_experiments: 0,
            export_pdf: false,
            export_excel: false,
            ai_parsing: false,
            comparison: false,
            watermark: false,
            calibration_analysis: false,
            calibration_parsing: false,
            chandler5550_support: false,
            bsl_r1_support: false,
        }
    }

    fn comparison_features(max_comparison_experiments: i64) -> LicenseFeatures {
        let mut features = empty_features();
        features.comparison = true;
        features.export_pdf = true;
        features.export_excel = true;
        features.max_comparison_experiments = max_comparison_experiments;
        features
    }

    fn valid_line_settings(color: &str) -> ComparisonByIdsLineSettings {
        ComparisonByIdsLineSettings {
            color: color.into(),
            width: 2,
            style: "solid".into(),
        }
    }

    fn valid_chart_line_settings() -> ComparisonByIdsChartLineSettings {
        ComparisonByIdsChartLineSettings {
            viscosity: valid_line_settings("#3b82f6"),
            temperature: valid_line_settings("#f97316"),
            shear_rate: valid_line_settings("#a855f7"),
            pressure: valid_line_settings("#22c55e"),
            rpm: valid_line_settings("#eab308"),
            bath_temperature: Some(ComparisonByIdsLineSettings {
                color: "#fb923c".into(),
                width: 2,
                style: "dashed".into(),
            }),
        }
    }

    fn valid_by_ids_request() -> ComparisonReportByIdsRequest {
        ComparisonReportByIdsRequest {
            experiment_ids: vec![
                "exp_aaaaaaaaaaaaaaaaaaaa".into(),
                "exp_bbbbbbbbbbbbbbbbbbbb".into(),
            ],
            settings: ComparisonReportByIdsSettings {
                language: "en".into(),
                unit_system: "SI".into(),
                company_name: Some("RheoLab".into()),
                company_logo_base64: None,
                generated_at: Some("2026-04-29T00:00:00Z".into()),
                rheology_source_override: None,
                comparison_chart: ComparisonByIdsChartConfig {
                    metrics: ComparisonByIdsMetrics {
                        primary: "viscosity_cp".into(),
                        left_secondary: "none".into(),
                        secondary: "temperature_c".into(),
                        tertiary: "none".into(),
                    },
                    axis_mode: "individual".into(),
                    brush_range: Some([0.0, 30.0]),
                    touch_point: ComparisonByIdsTouchPointConfig {
                        enabled: true,
                        viscosity_threshold: 200.0,
                        show_target_time: true,
                        target_time: 10.0,
                    },
                    line_settings: valid_chart_line_settings(),
                    experiment_colors: vec!["#1E90FF".into(), "#FF0000".into()],
                    time_format: "minutes".into(),
                    downsample_mode: "smart".into(),
                    chart_width: 1400,
                    chart_height: 700,
                },
                section_toggles: ComparisonByIdsSectionToggles {
                    show_calibration: false,
                    show_raw_data: false,
                    show_recipe: true,
                    show_water_analysis: true,
                    show_rheology: true,
                },
                report_settings: ComparisonByIdsReportSettings {
                    show_temperature: true,
                    show_shear_rate: true,
                    show_pressure: true,
                    show_bath_temperature: false,
                    shear_rate_axis: "right".into(),
                    pressure_axis: "right".into(),
                    show_advanced_stats: true,
                    report_viscosity_rates: vec![40, 100, 170],
                    rheology_units: None,
                },
                analysis_settings: super::default_comparison_analysis_settings(),
                detection_settings: Default::default(),
            },
        }
    }

    fn valid_by_id_request(experiment_id: &str) -> ExperimentReportByIdRequest {
        ExperimentReportByIdRequest {
            experiment_id: experiment_id.into(),
            settings: valid_by_ids_request().settings,
            recipe_override: None,
            water_override: None,
        }
    }

    fn by_ids_raw_points(viscosity_offset: f64) -> Vec<serde_json::Value> {
        let rates: [f64; 5] = [170.0, 100.0, 40.0, 100.0, 170.0];
        let mut points = Vec::new();
        for (step_idx, rate) in rates.iter().copied().enumerate() {
            for sample_idx in 0..4 {
                let time_sec = ((step_idx * 4 + sample_idx) as f64) * 10.0;
                let stress = (1.0 + viscosity_offset / 1000.0) * 5.0 * rate.powf(0.72);
                let viscosity = (stress / rate) * 1000.0 + sample_idx as f64;
                points.push(json!({
                    "time_sec": time_sec,
                    "viscosity_cp": viscosity,
                    "temperature_c": 25.0 + step_idx as f64,
                    "shear_rate": rate,
                    "shear_stress": stress,
                    "pressure_bar": 10.0 + viscosity_offset / 10.0,
                    "rpm": rate / 2.0,
                    "bath_temperature_c": 24.0 + step_idx as f64,
                }));
            }
        }
        points
    }

    fn stored_experiment_for_by_ids(id: &str, name: &str) -> StoredExperiment {
        let viscosity_offset = if name == "Beta" { 75.0 } else { 0.0 };
        StoredExperiment {
            id: id.into(),
            created_at: "2026-04-29T00:00:00Z".into(),
            updated_at: "2026-04-29T00:00:00Z".into(),
            name: name.into(),
            field_name: Some("Field".into()),
            operator_name: Some("Operator".into()),
            well_number: Some("W-1".into()),
            test_id: Some(id.into()),
            original_filename: format!("{name}.dat"),
            test_date: "2026-04-29".into(),
            instrument_type: "Grace M5600".into(),
            geometry: Some("R1B5".into()),
            geometry_source: Some("manual".into()),
            water_source: "Lab water".into(),
            water_params: Some(json!({ "ph": 7.1, "salinity": 1500.0 })),
            fluid_type: "Gel".into(),
            test_group: "Group".into(),
            test_sub_group: None,
            test_category: None,
            test_type: None,
            dominant_pattern: None,
            metrics: json!({}),
            raw_points: by_ids_raw_points(viscosity_offset),
            calibration: Some(json!({
                "deviceType": "Grace M5600",
                "lastCalDate": "2026-04-01",
                "rSquared": 0.998,
                "slope": 1.01,
                "intercept": 0.02,
                "status": "valid"
            })),
            reagents: vec![StoredExperimentReagent {
                reagent_id: None,
                reagent_name: Some("Guar Gum".into()),
                concentration: 3.5,
                unit: "kg/m3".into(),
                batch_number: Some("B-42".into()),
                production_date: Some("2026-04-01".into()),
                category: Some("Polymer".into()),
                reagent: None,
            }],
            max_viscosity: Some(1200),
            avg_viscosity: Some(900),
            user: None,
            laboratory: None,
            parsed_by: None,
            parse_source: None,
            time_range_min: Some(0.0),
            time_range_max: Some(190.0 / 60.0),
            viscosity_min: Some(600.0),
            pressure_max: Some(20.0),
            extra_fields: None,
            rheology_source: RheologyParameterSource::Program,
            rheology_parameters: vec![],
        }
    }

    fn report_rheology_row(
        source: RheologyParameterSource,
        cycle_no: i32,
        n_prime: f64,
        k_prime: f64,
        bingham_pv: f64,
    ) -> RheologyParameterRow {
        let mut viscosities = BTreeMap::new();
        viscosities.insert("40".to_string(), 1400.0 + cycle_no as f64);
        viscosities.insert("100".to_string(), 900.0 + cycle_no as f64);
        viscosities.insert("170".to_string(), 650.0 + cycle_no as f64);

        let mut units = BTreeMap::new();
        units.insert("consistency".to_string(), "Pa*s^n".to_string());
        units.insert("viscosity".to_string(), "cP".to_string());
        units.insert("binghamPv".to_string(), "Pa*s".to_string());
        units.insert("binghamYp".to_string(), "Pa".to_string());

        RheologyParameterRow {
            source,
            cycle_no,
            time_min: Some(cycle_no as f64 * 10.0),
            end_time_min: Some(cycle_no as f64 * 10.5),
            temp_c: Some(77.0),
            pressure_bar: Some(12.5),
            n_prime: Some(n_prime),
            kv_pasn: None,
            k_prime_pasn: Some(k_prime),
            k_slot_pasn: Some(k_prime * 1.1),
            k_pipe_pasn: Some(k_prime * 1.2),
            r2: Some(0.997),
            viscosities,
            bingham_pv_pas: Some(bingham_pv),
            bingham_yp_pa: Some(4.2),
            bingham_r2: Some(0.981),
            calc_points: Some(5),
            source_sheet: Some("Power Law Data".into()),
            source_row: Some(42),
            units,
        }
    }

    fn by_ids_fixture_db() -> (rusqlite::Connection, StoredExperiment, StoredExperiment) {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.pragma_update(None, "foreign_keys", true)
            .expect("foreign keys");
        run_migrations(&conn).expect("migrations");

        let exp_a = stored_experiment_for_by_ids("exp_aaaaaaaaaaaaaaaaaaaa", "Alpha");
        let exp_b = stored_experiment_for_by_ids("exp_bbbbbbbbbbbbbbbbbbbb", "Beta");
        persist_experiment(&conn, &exp_a).expect("persist alpha");
        persist_experiment(&conn, &exp_b).expect("persist beta");

        (conn, exp_a, exp_b)
    }

    fn by_ids_fixture_pool() -> (crate::db::DbPool, TempDir) {
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("rheolab-cache-test.db");
        let pool = create_pool(&db_path).expect("pool");
        {
            let conn = pool.get().expect("conn");
            run_migrations(&conn).expect("migrations");
            let exp_a = stored_experiment_for_by_ids("exp_aaaaaaaaaaaaaaaaaaaa", "Alpha");
            let exp_b = stored_experiment_for_by_ids("exp_bbbbbbbbbbbbbbbbbbbb", "Beta");
            persist_experiment(&conn, &exp_a).expect("persist alpha");
            persist_experiment(&conn, &exp_b).expect("persist beta");
        }
        (pool, dir)
    }

    fn fixture_seed_db_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("outputs")
            .join("seed")
            .join("rheolab-fixture-seed-small.db")
    }

    fn by_ids_fixture_seed_pool() -> Option<(crate::db::DbPool, TempDir)> {
        let seed = fixture_seed_db_path();
        if !seed.exists() {
            return None;
        }
        let dir = tempfile::tempdir().expect("temp dir");
        let db_path = dir.path().join("rheolab-cache-bench.db");
        fs::copy(&seed, &db_path).expect("copy fixture DB");
        let pool = create_pool(&db_path).expect("pool");
        {
            let conn = pool.get().expect("conn");
            run_migrations(&conn).expect("migrations");
            conn.execute("DELETE FROM AnalysisArtifact", [])
                .expect("clear analysis artifacts");
        }
        Some((pool, dir))
    }

    fn first_fixture_experiment_ids(pool: &crate::db::DbPool, n: usize) -> Vec<String> {
        let conn = pool.get().expect("conn");
        let mut stmt = conn
            .prepare("SELECT id FROM Experiment ORDER BY createdAt, id LIMIT ?1")
            .expect("prepare experiment id query");
        stmt.query_map([n as i64], |row| row.get::<_, String>(0))
            .expect("query experiment ids")
            .collect::<rusqlite::Result<Vec<_>>>()
            .expect("collect experiment ids")
    }

    fn clear_analysis_artifact_rows(pool: &crate::db::DbPool) {
        let conn = pool.get().expect("conn");
        conn.execute("DELETE FROM AnalysisArtifact", [])
            .expect("clear analysis artifacts");
    }

    fn analysis_artifact_summary(pool: &crate::db::DbPool) -> (i64, i64, i64) {
        let conn = pool.get().expect("conn");
        conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(artifactBytes), 0), COALESCE(SUM(hitCount), 0)
             FROM AnalysisArtifact",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("analysis artifact summary")
    }

    #[derive(Debug, Clone, Copy)]
    enum CacheBenchReportFormat {
        Pdf,
        Xlsx,
    }

    #[derive(Debug)]
    struct CacheBenchStats {
        samples_ms: Vec<f64>,
        bytes: Vec<usize>,
        artifact_rows: i64,
        artifact_bytes: i64,
        hit_count: i64,
    }

    impl CacheBenchStats {
        fn mean_ms(&self) -> f64 {
            self.samples_ms.iter().sum::<f64>() / self.samples_ms.len() as f64
        }

        fn p50_ms(&self) -> f64 {
            percentile(self.samples_ms.clone(), 0.50)
        }

        fn p95_ms(&self) -> f64 {
            percentile(self.samples_ms.clone(), 0.95)
        }

        fn mean_bytes(&self) -> f64 {
            self.bytes.iter().sum::<usize>() as f64 / self.bytes.len() as f64
        }
    }

    fn percentile(mut values: Vec<f64>, p: f64) -> f64 {
        values.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let idx = ((values.len() - 1) as f64 * p).round() as usize;
        values[idx]
    }

    fn generate_cached_report_bytes(
        pool: &crate::db::DbPool,
        request: &ComparisonReportByIdsRequest,
        format: CacheBenchReportFormat,
    ) -> crate::error::Result<Vec<u8>> {
        match format {
            CacheBenchReportFormat::Pdf => {
                generate_comparison_pdf_by_ids_bytes_cached(pool, request)
            }
            CacheBenchReportFormat::Xlsx => {
                generate_comparison_excel_by_ids_bytes_cached(pool, request)
            }
        }
    }

    fn measure_cache_report(
        pool: &crate::db::DbPool,
        request: &ComparisonReportByIdsRequest,
        format: CacheBenchReportFormat,
        iterations: usize,
        warm: bool,
    ) -> CacheBenchStats {
        clear_analysis_artifact_rows(pool);
        if warm {
            generate_cached_report_bytes(pool, request, format).expect("seed warm cache");
        }

        let mut samples_ms = Vec::with_capacity(iterations);
        let mut bytes = Vec::with_capacity(iterations);
        for _ in 0..iterations {
            if !warm {
                clear_analysis_artifact_rows(pool);
            }
            let started = Instant::now();
            let output = generate_cached_report_bytes(pool, request, format).expect("report bytes");
            samples_ms.push(started.elapsed().as_secs_f64() * 1000.0);
            bytes.push(output.len());
        }
        let (artifact_rows, artifact_bytes, hit_count) = analysis_artifact_summary(pool);
        CacheBenchStats {
            samples_ms,
            bytes,
            artifact_rows,
            artifact_bytes,
            hit_count,
        }
    }

    fn open_xlsx(bytes: Vec<u8>) -> calamine::Xlsx<Cursor<Vec<u8>>> {
        calamine::open_workbook_from_rs::<calamine::Xlsx<_>, _>(Cursor::new(bytes))
            .expect("open xlsx")
    }

    fn worksheet_text<R: Read + Seek>(workbook: &mut calamine::Xlsx<R>, sheet: &str) -> String {
        let range = workbook
            .worksheet_range(sheet)
            .unwrap_or_else(|| panic!("worksheet {sheet} should exist"))
            .expect("worksheet range");
        range
            .rows()
            .flat_map(|row| row.iter().map(ToString::to_string))
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn build_by_ids_report_input_loads_db_experiments_in_request_order() {
        let (conn, exp_a, exp_b) = by_ids_fixture_db();
        let mut request = valid_by_ids_request();
        request.experiment_ids = vec![exp_b.id.clone(), exp_a.id.clone()];

        let input =
            build_comparison_report_input_by_ids(&conn, &request).expect("build report input");

        assert_eq!(input.experiments.len(), 2);
        assert_eq!(input.experiments[0].id, exp_b.id);
        assert_eq!(input.experiments[1].id, exp_a.id);
        assert_eq!(input.experiments[0].display_name, "Beta");
        let report = &input.experiments[0].report_input;
        assert_eq!(report.raw_data.len(), 20);
        assert!(!report.cycle_results.is_empty());
        assert!(!report.cycles.is_empty());
        assert!(report.axis_values.is_some());
        assert_eq!(report.metadata.company_name.as_deref(), Some("RheoLab"));
        assert_eq!(report.recipe.len(), 1);
        assert_eq!(report.recipe[0].name, "Guar Gum");
        assert_eq!(
            report.water_params.as_ref().and_then(|water| water.ph),
            Some(7.1)
        );
        assert_eq!(
            report
                .metadata
                .calibration
                .as_ref()
                .and_then(|calibration| calibration.status.as_deref()),
            Some("valid")
        );
        let cycle = &report.cycle_results[0];
        assert!(cycle.n_prime > 0.0);
        assert!(cycle.k_prime > 0.0);
        assert!(cycle.r2 > 0.95);
        for rate in ["40", "100", "170"] {
            assert!(cycle.viscosities.contains_key(rate));
        }
        assert_eq!(input.comparison_chart.metrics.primary, "viscosity_cp");
    }

    #[test]
    fn build_by_ids_report_input_applies_optional_section_toggles() {
        let (conn, _, _) = by_ids_fixture_db();
        let mut request = valid_by_ids_request();
        request.settings.section_toggles.show_calibration = false;
        request.settings.section_toggles.show_raw_data = true;
        request.settings.section_toggles.show_recipe = false;
        request.settings.section_toggles.show_water_analysis = false;
        request.settings.section_toggles.show_rheology = false;

        let input =
            build_comparison_report_input_by_ids(&conn, &request).expect("build report input");
        let entry = &input.experiments[0];
        let report = &entry.report_input;

        assert!(!entry.section_toggles.show_calibration);
        assert!(entry.section_toggles.show_raw_data);
        assert!(!entry.section_toggles.show_recipe);
        assert!(!entry.section_toggles.show_water_analysis);
        assert!(!entry.section_toggles.show_rheology);
        assert!(report.settings.show_raw_data);
        assert!(!report.settings.show_calibration);
        assert!(report.recipe.is_empty());
        assert!(report.water_params.is_none());
        assert!(!report.cycle_results.is_empty());
    }

    #[test]
    fn build_by_id_report_input_loads_single_saved_experiment_without_frontend_payload() {
        let (pool, _dir) = by_ids_fixture_pool();
        let request = valid_by_id_request("exp_aaaaaaaaaaaaaaaaaaaa");

        let report = build_report_input_by_id_cached_with_job(&pool, &request, None)
            .expect("build by-id single report input");

        assert_eq!(report.metadata.filename, "Alpha");
        assert_eq!(report.raw_data.len(), 20);
        assert!(!report.cycle_results.is_empty());
        assert!(!report.cycles.is_empty());
        assert!(report.axis_values.is_some());
        assert_eq!(report.recipe.len(), 1);
        assert_eq!(
            report.water_params.as_ref().and_then(|water| water.ph),
            Some(7.1)
        );
    }

    #[test]
    fn by_id_report_input_uses_persisted_instrument_rheology_when_selected() {
        let (pool, _dir) = by_ids_fixture_pool();
        {
            let conn = pool.get().expect("conn");
            let mut exp = stored_experiment_for_by_ids("exp_aaaaaaaaaaaaaaaaaaaa", "Alpha");
            exp.rheology_source = RheologyParameterSource::Instrument;
            exp.rheology_parameters = vec![
                report_rheology_row(RheologyParameterSource::Instrument, 1, 0.41, 0.333, 0.12),
                report_rheology_row(RheologyParameterSource::Program, 1, 0.91, 9.333, 1.12),
            ];
            persist_experiment(&conn, &exp).expect("persist instrument rheology");
        }

        let request = valid_by_id_request("exp_aaaaaaaaaaaaaaaaaaaa");
        let report = build_report_input_by_id_cached_with_job(&pool, &request, None)
            .expect("build by-id report input");

        assert_eq!(report.settings.rheology_source, "instrument");
        assert_eq!(report.cycle_results.len(), 1);
        let cycle = &report.cycle_results[0];
        assert_eq!(cycle.n_prime, 0.41);
        assert_eq!(cycle.k_prime, 0.333);
        assert_eq!(cycle.bingham_pv, Some(0.12));
        assert_eq!(cycle.visc_at_40, Some(1401.0));
    }

    #[test]
    fn by_id_report_input_allows_rheology_source_override() {
        let (pool, _dir) = by_ids_fixture_pool();
        {
            let conn = pool.get().expect("conn");
            let mut exp = stored_experiment_for_by_ids("exp_aaaaaaaaaaaaaaaaaaaa", "Alpha");
            exp.rheology_source = RheologyParameterSource::Instrument;
            exp.rheology_parameters = vec![
                report_rheology_row(RheologyParameterSource::Instrument, 1, 0.41, 0.333, 0.12),
                report_rheology_row(RheologyParameterSource::Program, 1, 0.91, 9.333, 1.12),
            ];
            persist_experiment(&conn, &exp).expect("persist override rheology");
        }

        let mut request = valid_by_id_request("exp_aaaaaaaaaaaaaaaaaaaa");
        request.settings.rheology_source_override = Some(RheologyParameterSource::Program);
        let report = build_report_input_by_id_cached_with_job(&pool, &request, None)
            .expect("build by-id report input with program override");

        assert_eq!(report.settings.rheology_source, "program");
        assert_eq!(report.cycle_results.len(), 1);
        let cycle = &report.cycle_results[0];
        assert!(
            (cycle.n_prime - 0.72).abs() < 1e-9,
            "program rheology must be calculated from raw points, got n'={}",
            cycle.n_prime
        );
        assert!(
            (cycle.k_prime - 9.333).abs() > 1e-6,
            "program rheology must not reuse persisted program rows"
        );
        assert_ne!(cycle.bingham_pv, Some(1.12));
    }

    #[test]
    fn comparison_report_input_uses_each_experiments_saved_rheology_source() {
        let (conn, mut exp_a, mut exp_b) = by_ids_fixture_db();
        exp_a.rheology_source = RheologyParameterSource::Instrument;
        exp_a.rheology_parameters = vec![
            report_rheology_row(RheologyParameterSource::Instrument, 1, 0.41, 0.333, 0.12),
            report_rheology_row(RheologyParameterSource::Program, 1, 0.91, 9.333, 1.12),
        ];
        exp_b.rheology_source = RheologyParameterSource::Program;
        exp_b.rheology_parameters = vec![
            report_rheology_row(RheologyParameterSource::Instrument, 1, 0.52, 0.444, 0.22),
            report_rheology_row(RheologyParameterSource::Program, 1, 0.82, 8.444, 1.22),
        ];
        persist_experiment(&conn, &exp_a).expect("persist alpha sources");
        persist_experiment(&conn, &exp_b).expect("persist beta sources");

        let request = valid_by_ids_request();
        let input =
            build_comparison_report_input_by_ids(&conn, &request).expect("build comparison input");

        let alpha_cycle = &input.experiments[0].report_input.cycle_results[0];
        let beta_cycle = &input.experiments[1].report_input.cycle_results[0];
        assert_eq!(
            input.experiments[0].report_input.settings.rheology_source,
            "instrument"
        );
        assert_eq!(
            input.experiments[1].report_input.settings.rheology_source,
            "program"
        );
        assert_eq!(alpha_cycle.n_prime, 0.41);
        assert_eq!(alpha_cycle.k_prime, 0.333);
        assert!(
            (beta_cycle.n_prime - 0.72).abs() < 1e-9,
            "saved program source must be calculated from raw points, got n'={}",
            beta_cycle.n_prime
        );
        assert!(
            (beta_cycle.k_prime - 8.444).abs() > 1e-6,
            "saved program source must not reuse persisted program rows"
        );
    }

    #[test]
    fn comparison_report_input_allows_global_rheology_source_override() {
        let (conn, mut exp_a, mut exp_b) = by_ids_fixture_db();
        exp_a.rheology_source = RheologyParameterSource::Instrument;
        exp_a.rheology_parameters = vec![
            report_rheology_row(RheologyParameterSource::Instrument, 1, 0.41, 0.333, 0.12),
            report_rheology_row(RheologyParameterSource::Program, 1, 0.91, 9.333, 1.12),
        ];
        exp_b.rheology_source = RheologyParameterSource::Instrument;
        exp_b.rheology_parameters = vec![
            report_rheology_row(RheologyParameterSource::Instrument, 1, 0.52, 0.444, 0.22),
            report_rheology_row(RheologyParameterSource::Program, 1, 0.82, 8.444, 1.22),
        ];
        persist_experiment(&conn, &exp_a).expect("persist alpha sources");
        persist_experiment(&conn, &exp_b).expect("persist beta sources");

        let mut request = valid_by_ids_request();
        request.settings.rheology_source_override = Some(RheologyParameterSource::Program);
        let input =
            build_comparison_report_input_by_ids(&conn, &request).expect("build comparison input");

        let alpha_cycle = &input.experiments[0].report_input.cycle_results[0];
        let beta_cycle = &input.experiments[1].report_input.cycle_results[0];
        assert_eq!(
            input.experiments[0].report_input.settings.rheology_source,
            "program"
        );
        assert_eq!(
            input.experiments[1].report_input.settings.rheology_source,
            "program"
        );
        assert!(
            (alpha_cycle.n_prime - 0.72).abs() < 1e-9,
            "program override must calculate alpha from raw points, got n'={}",
            alpha_cycle.n_prime
        );
        assert!(
            (beta_cycle.n_prime - 0.72).abs() < 1e-9,
            "program override must calculate beta from raw points, got n'={}",
            beta_cycle.n_prime
        );
        assert!(
            (alpha_cycle.k_prime - 9.333).abs() > 1e-6,
            "program override must not reuse alpha persisted program rows"
        );
        assert!(
            (beta_cycle.k_prime - 8.444).abs() > 1e-6,
            "program override must not reuse beta persisted program rows"
        );
    }

    #[test]
    fn comparison_report_input_errors_when_instrument_source_has_no_rows() {
        let (conn, mut exp_a, _) = by_ids_fixture_db();
        exp_a.rheology_source = RheologyParameterSource::Instrument;
        exp_a.rheology_parameters = vec![];
        persist_experiment(&conn, &exp_a).expect("persist missing instrument rows");

        let mut request = valid_by_ids_request();
        request.experiment_ids = vec![exp_a.id.clone()];
        let err = build_comparison_report_input_by_ids(&conn, &request)
            .unwrap_err()
            .to_string();

        assert!(err.contains("параметры прибора не найдены"));
    }

    #[test]
    fn build_by_id_report_input_applies_recipe_and_water_overrides() {
        let (pool, _dir) = by_ids_fixture_pool();
        let mut request = valid_by_id_request("exp_aaaaaaaaaaaaaaaaaaaa");
        request.recipe_override = Some(vec![ExperimentReportRecipeOverride {
            name: "Edited Polymer".into(),
            concentration: 4.2,
            unit: "kg/m3".into(),
            category: Some("Polymer".into()),
            batch_number: Some("B-99".into()),
        }]);
        request.water_override = Some(ExperimentReportWaterOverride {
            source: Some("Edited water".into()),
            salinity: Some(1234.0),
            ph: Some(8.2),
            hardness: Some(44.0),
            fe: Some(0.12),
            ca: Some(12.3),
            mg: Some(4.5),
            cl: Some(89.0),
            so4: Some(7.8),
            hco3: Some(145.0),
        });

        let report = build_report_input_by_id_cached_with_job(&pool, &request, None)
            .expect("build by-id single report input with overrides");

        assert_eq!(report.recipe.len(), 1);
        assert_eq!(report.recipe[0].name, "Edited Polymer");
        assert_eq!(report.recipe[0].batch_number.as_deref(), Some("B-99"));
        let water = report.water_params.expect("water override");
        assert_eq!(water.source.as_deref(), Some("Edited water"));
        assert_eq!(water.salinity, Some(1234.0));
        assert_eq!(water.ph, Some(8.2));
        assert_eq!(water.hardness, Some(44.0));
        assert_eq!(water.fe, Some(0.12));
        assert_eq!(water.ca, Some(12.3));
        assert_eq!(water.mg, Some(4.5));
        assert_eq!(water.cl, Some(89.0));
        assert_eq!(water.so4, Some(7.8));
        assert_eq!(water.hco3, Some(145.0));
    }

    #[test]
    fn cached_by_ids_report_input_stores_then_hits_analysis_artifacts() {
        let (pool, _dir) = by_ids_fixture_pool();
        let request = valid_by_ids_request();

        let cold = build_comparison_report_input_by_ids_cached(&pool, &request)
            .expect("cold cached input");
        {
            let conn = pool.get().expect("conn");
            let row_count: i64 = conn
                .query_row("SELECT COUNT(*) FROM AnalysisArtifact", [], |row| {
                    row.get(0)
                })
                .unwrap();
            let hit_count: i64 = conn
                .query_row(
                    "SELECT COALESCE(SUM(hitCount), 0) FROM AnalysisArtifact",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                row_count, 2,
                "cold run should store one artifact per experiment"
            );
            assert_eq!(hit_count, 0, "cold stores should not count as hits");
            let blob_hashes = load_experiment_data_hashes(&conn, &request.experiment_ids)
                .expect("load blob hashes");
            let stored_hashes = conn
                .prepare(
                    "SELECT experimentId, experimentDataHash
                     FROM AnalysisArtifact
                     ORDER BY experimentId",
                )
                .unwrap()
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap();
            for (experiment_id, stored_hash) in stored_hashes {
                assert_eq!(
                    Some(&stored_hash),
                    blob_hashes.get(&experiment_id),
                    "cache key should use ExperimentData.dataBlob hash"
                );
            }
        }

        let warm = build_comparison_report_input_by_ids_cached(&pool, &request)
            .expect("warm cached input");
        {
            let conn = pool.get().expect("conn");
            let row_count: i64 = conn
                .query_row("SELECT COUNT(*) FROM AnalysisArtifact", [], |row| {
                    row.get(0)
                })
                .unwrap();
            let hit_count: i64 = conn
                .query_row(
                    "SELECT COALESCE(SUM(hitCount), 0) FROM AnalysisArtifact",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(row_count, 2, "warm run must reuse existing artifacts");
            assert_eq!(
                hit_count, 2,
                "warm run should hit both experiment artifacts"
            );
        }

        assert_eq!(cold.experiments.len(), warm.experiments.len());
        for (cold_entry, warm_entry) in cold.experiments.iter().zip(warm.experiments.iter()) {
            assert_eq!(cold_entry.id, warm_entry.id);
            assert_eq!(
                cold_entry.report_input.cycle_results.len(),
                warm_entry.report_input.cycle_results.len()
            );
            assert_eq!(
                cold_entry.report_input.cycles.len(),
                warm_entry.report_input.cycles.len()
            );
        }
    }

    #[test]
    fn cached_by_ids_report_input_preserves_request_order_on_cold_and_warm() {
        let (pool, _dir) = by_ids_fixture_pool();
        let mut request = valid_by_ids_request();
        request.experiment_ids.reverse();

        let cold = build_comparison_report_input_by_ids_cached(&pool, &request)
            .expect("cold cached input");
        let warm = build_comparison_report_input_by_ids_cached(&pool, &request)
            .expect("warm cached input");

        assert_eq!(cold.experiments.len(), 2);
        assert_eq!(cold.experiments[0].display_name, "Beta");
        assert_eq!(cold.experiments[1].display_name, "Alpha");
        assert_eq!(
            cold.experiments
                .iter()
                .map(|entry| &entry.id)
                .collect::<Vec<_>>(),
            warm.experiments
                .iter()
                .map(|entry| &entry.id)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn cached_by_ids_report_input_repairs_corrupt_analysis_artifact() {
        let (pool, _dir) = by_ids_fixture_pool();
        let request = valid_by_ids_request();
        let exp_a = stored_experiment_for_by_ids("exp_aaaaaaaaaaaaaaaaaaaa", "Alpha");
        let data_hash = {
            let conn = pool.get().expect("conn");
            load_experiment_data_hashes(&conn, std::slice::from_ref(&exp_a.id))
                .expect("load data hash")
                .get(&exp_a.id)
                .cloned()
        };
        let key = build_analysis_key_for_experiment(&exp_a, data_hash.as_ref(), &request.settings)
            .expect("cache key");

        {
            let conn = pool.get().expect("conn");
            put_analysis_artifact(&conn, &key, ANALYSIS_ARTIFACT_ENCODING, b"not-zstd")
                .expect("seed corrupt artifact");
        }

        let input = build_comparison_report_input_by_ids_cached(&pool, &request)
            .expect("cached input should recompute after corrupt artifact");
        assert_eq!(input.experiments.len(), 2);

        let conn = pool.get().expect("conn");
        let row_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM AnalysisArtifact", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            row_count, 2,
            "corrupt artifact should be replaced and the other experiment stored"
        );

        let repaired = get_analysis_artifact(&conn, &key)
            .expect("read repaired artifact")
            .expect("repaired artifact exists");
        let decoded =
            decode_analysis_artifact(&repaired.artifact_blob).expect("repaired artifact decodes");
        assert!(!decoded.cycles.is_empty());
    }

    #[test]
    fn experiment_save_invalidates_analysis_artifacts_for_that_experiment() {
        let (pool, _dir) = by_ids_fixture_pool();
        let request = valid_by_ids_request();

        build_comparison_report_input_by_ids_cached(&pool, &request).expect("cold cached input");
        {
            let conn = pool.get().expect("conn");
            let row_count: i64 = conn
                .query_row("SELECT COUNT(*) FROM AnalysisArtifact", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(row_count, 2);
        }

        let mut updated = stored_experiment_for_by_ids("exp_aaaaaaaaaaaaaaaaaaaa", "Alpha");
        if let Some(point) = updated.raw_points.first_mut() {
            point["viscosity_cp"] = json!(point["viscosity_cp"].as_f64().unwrap_or(0.0) + 1.0);
        }
        {
            let conn = pool.get().expect("conn");
            persist_experiment(&conn, &updated).expect("persist updated experiment");
            let remaining_for_updated: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM AnalysisArtifact WHERE experimentId = ?1",
                    [updated.id.as_str()],
                    |row| row.get(0),
                )
                .unwrap();
            let total_remaining: i64 = conn
                .query_row("SELECT COUNT(*) FROM AnalysisArtifact", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(remaining_for_updated, 0);
            assert_eq!(total_remaining, 1, "other experiment cache rows stay valid");
        }
    }

    #[test]
    #[ignore = "manual Sprint 3 cold/warm fixture benchmark"]
    fn bench_analysis_artifact_cache_cold_warm_fixture_db() {
        let Some((pool, _dir)) = by_ids_fixture_seed_pool() else {
            eprintln!(
                "SKIP: fixture DB not found at {}",
                fixture_seed_db_path().display()
            );
            return;
        };

        let n_experiments = 5usize;
        let ids = first_fixture_experiment_ids(&pool, n_experiments);
        assert_eq!(
            ids.len(),
            n_experiments,
            "fixture DB should contain at least {n_experiments} experiments"
        );

        let mut request = valid_by_ids_request();
        request.experiment_ids = ids;
        request.settings.comparison_chart.experiment_colors = vec![
            "#1E90FF".into(),
            "#FF0000".into(),
            "#10B981".into(),
            "#F59E0B".into(),
            "#8B5CF6".into(),
        ];

        let iterations = 3usize;
        let pdf_cold = measure_cache_report(
            &pool,
            &request,
            CacheBenchReportFormat::Pdf,
            iterations,
            false,
        );
        let pdf_warm = measure_cache_report(
            &pool,
            &request,
            CacheBenchReportFormat::Pdf,
            iterations,
            true,
        );
        let xlsx_cold = measure_cache_report(
            &pool,
            &request,
            CacheBenchReportFormat::Xlsx,
            iterations,
            false,
        );
        let xlsx_warm = measure_cache_report(
            &pool,
            &request,
            CacheBenchReportFormat::Xlsx,
            iterations,
            true,
        );

        let pct_delta = |warm: f64, cold: f64| ((warm - cold) / cold) * 100.0;
        let report = json!({
            "schema": "rheolab.microbench.analysis_artifact_cache.v1",
            "generatedAt": now_rfc3339(),
            "nExperiments": n_experiments,
            "iterations": iterations,
            "sourceDb": fixture_seed_db_path().display().to_string(),
            "formats": {
                "pdf": {
                    "cold": {
                        "samplesMs": &pdf_cold.samples_ms,
                        "p50Ms": pdf_cold.p50_ms(),
                        "p95Ms": pdf_cold.p95_ms(),
                        "meanMs": pdf_cold.mean_ms(),
                        "meanBytes": pdf_cold.mean_bytes(),
                        "artifactRows": pdf_cold.artifact_rows,
                        "artifactBytes": pdf_cold.artifact_bytes,
                        "hitCount": pdf_cold.hit_count
                    },
                    "warm": {
                        "samplesMs": &pdf_warm.samples_ms,
                        "p50Ms": pdf_warm.p50_ms(),
                        "p95Ms": pdf_warm.p95_ms(),
                        "meanMs": pdf_warm.mean_ms(),
                        "meanBytes": pdf_warm.mean_bytes(),
                        "artifactRows": pdf_warm.artifact_rows,
                        "artifactBytes": pdf_warm.artifact_bytes,
                        "hitCount": pdf_warm.hit_count
                    },
                    "deltaMeanPct": pct_delta(pdf_warm.mean_ms(), pdf_cold.mean_ms())
                },
                "xlsx": {
                    "cold": {
                        "samplesMs": &xlsx_cold.samples_ms,
                        "p50Ms": xlsx_cold.p50_ms(),
                        "p95Ms": xlsx_cold.p95_ms(),
                        "meanMs": xlsx_cold.mean_ms(),
                        "meanBytes": xlsx_cold.mean_bytes(),
                        "artifactRows": xlsx_cold.artifact_rows,
                        "artifactBytes": xlsx_cold.artifact_bytes,
                        "hitCount": xlsx_cold.hit_count
                    },
                    "warm": {
                        "samplesMs": &xlsx_warm.samples_ms,
                        "p50Ms": xlsx_warm.p50_ms(),
                        "p95Ms": xlsx_warm.p95_ms(),
                        "meanMs": xlsx_warm.mean_ms(),
                        "meanBytes": xlsx_warm.mean_bytes(),
                        "artifactRows": xlsx_warm.artifact_rows,
                        "artifactBytes": xlsx_warm.artifact_bytes,
                        "hitCount": xlsx_warm.hit_count
                    },
                    "deltaMeanPct": pct_delta(xlsx_warm.mean_ms(), xlsx_cold.mean_ms())
                }
            }
        });

        let out_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("outputs")
            .join("perf")
            .join("microbench");
        fs::create_dir_all(&out_dir).expect("create perf output dir");
        let out_path = out_dir.join(format!(
            "analysis-artifact-cache-{}.json",
            now_rfc3339().replace([':', '-'], "")
        ));
        fs::write(
            &out_path,
            serde_json::to_string_pretty(&report).expect("serialize report"),
        )
        .expect("write report");

        println!("\n# AnalysisArtifact cache cold/warm fixture bench\n");
        println!("sidecar: {}", out_path.display());
        println!("| format | cold mean ms | warm mean ms | delta mean | cold p95 | warm p95 | hits | artifact bytes |");
        println!("|---|---:|---:|---:|---:|---:|---:|---:|");
        println!(
            "| PDF | {:.1} | {:.1} | {:+.1}% | {:.1} | {:.1} | {} | {} |",
            pdf_cold.mean_ms(),
            pdf_warm.mean_ms(),
            pct_delta(pdf_warm.mean_ms(), pdf_cold.mean_ms()),
            pdf_cold.p95_ms(),
            pdf_warm.p95_ms(),
            pdf_warm.hit_count,
            pdf_warm.artifact_bytes
        );
        println!(
            "| XLSX | {:.1} | {:.1} | {:+.1}% | {:.1} | {:.1} | {} | {} |",
            xlsx_cold.mean_ms(),
            xlsx_warm.mean_ms(),
            pct_delta(xlsx_warm.mean_ms(), xlsx_cold.mean_ms()),
            xlsx_cold.p95_ms(),
            xlsx_warm.p95_ms(),
            xlsx_warm.hit_count,
            xlsx_warm.artifact_bytes
        );
    }

    #[test]
    fn build_by_ids_report_input_rejects_missing_ids_from_db() {
        let (conn, _, _) = by_ids_fixture_db();
        let mut request = valid_by_ids_request();
        request.experiment_ids = vec![
            "exp_aaaaaaaaaaaaaaaaaaaa".into(),
            "exp_cccccccccccccccccccc".into(),
        ];

        let err = build_comparison_report_input_by_ids(&conn, &request)
            .unwrap_err()
            .to_string();

        assert!(err.contains("Experiment IDs not found: exp_cccccccccccccccccccc"));
    }

    #[test]
    fn comparison_excel_by_ids_generates_xlsx_from_db_experiments() {
        let (conn, _, _) = by_ids_fixture_db();
        let request = valid_by_ids_request();
        let input =
            build_comparison_report_input_by_ids(&conn, &request).expect("build report input");
        let bytes = generate_comparison_excel_by_ids_bytes(&conn, &request)
            .expect("Excel by-ids generation should succeed");
        let direct_bytes = rheolab_core::report_generator::generate_comparison_excel(&input)
            .expect("direct Excel generation should succeed");

        assert!(!bytes.is_empty());
        assert!(!direct_bytes.is_empty());
        assert!(
            bytes.starts_with(b"PK"),
            "XLSX must start with ZIP signature"
        );
        assert!(
            direct_bytes.starts_with(b"PK"),
            "Direct XLSX must start with ZIP signature"
        );

        let mut workbook = open_xlsx(bytes.clone());
        let direct_workbook = open_xlsx(direct_bytes);
        let sheet_names = workbook.sheet_names().to_vec();
        assert_eq!(sheet_names, direct_workbook.sheet_names().to_vec());
        for expected in ["Overlap Chart", "Alpha", "Beta", "_ChartData", "DebugInfo"] {
            assert!(
                sheet_names.iter().any(|name| name == expected),
                "expected workbook sheet {expected}; got {sheet_names:?}"
            );
        }
        let alpha_text = worksheet_text(&mut workbook, "Alpha");
        for expected in [
            "Summary",
            "Recipe",
            "Water Analysis",
            "Rheology",
            "Guar Gum",
        ] {
            assert!(
                alpha_text.contains(expected),
                "expected Alpha worksheet to contain {expected}"
            );
        }
        let debug_text = worksheet_text(&mut workbook, "DebugInfo");
        assert!(debug_text.contains("Experiments"));
        assert!(debug_text.contains("2"));

        let as_str = String::from_utf8_lossy(&bytes);
        for n in 1..=5 {
            let needle = format!("xl/worksheets/sheet{}.xml", n);
            assert!(
                as_str.contains(&needle),
                "expected workbook to contain {}",
                needle
            );
        }
    }

    #[test]
    fn comparison_pdf_by_ids_generates_pdf_from_db_experiments() {
        let (conn, _, _) = by_ids_fixture_db();
        let request = valid_by_ids_request();
        let input =
            build_comparison_report_input_by_ids(&conn, &request).expect("build report input");
        let bytes = generate_comparison_pdf_by_ids_bytes(&conn, &request)
            .expect("PDF by-ids generation should succeed");
        let direct_bytes = rheolab_core::report_generator::generate_comparison_pdf(&input)
            .expect("direct PDF generation should succeed");

        assert!(!bytes.is_empty());
        assert_eq!(bytes, direct_bytes);
        assert!(
            bytes.starts_with(b"%PDF"),
            "PDF must start with %PDF header"
        );
        assert!(bytes.len() > 20_000, "PDF too small: {} bytes", bytes.len());
    }

    #[test]
    fn validate_by_ids_accepts_valid_pdf_request() {
        let request = valid_by_ids_request();
        let features = comparison_features(3);
        assert!(validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf).is_ok());
    }

    #[test]
    fn validate_by_ids_rejects_calibration_without_feature() {
        let mut request = valid_by_ids_request();
        request.settings.section_toggles.show_calibration = true;
        let features = comparison_features(3);

        let err = validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();

        assert!(err.contains("Calibration"));
        assert!(err.contains("Developer"));
    }

    #[test]
    fn validate_by_ids_accepts_calibration_for_developer_features() {
        let mut request = valid_by_ids_request();
        request.settings.section_toggles.show_calibration = true;
        let mut features = comparison_features(3);
        features.calibration_analysis = true;

        assert!(validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf).is_ok());
    }

    #[test]
    fn validate_by_ids_accepts_valid_excel_request() {
        let request = valid_by_ids_request();
        let features = comparison_features(3);
        assert!(
            validate_comparison_by_ids_request(&request, &features, ReportFormat::Excel).is_ok()
        );
    }

    #[test]
    fn validate_by_ids_rejects_empty_experiment_list() {
        let mut request = valid_by_ids_request();
        request.experiment_ids.clear();
        let features = comparison_features(3);
        let err = validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();
        assert!(err.contains("at least one"));
    }

    #[test]
    fn validate_by_ids_rejects_duplicate_experiment_ids() {
        let mut request = valid_by_ids_request();
        request.experiment_ids = vec![
            "exp_aaaaaaaaaaaaaaaaaaaa".into(),
            "exp_aaaaaaaaaaaaaaaaaaaa".into(),
        ];
        let features = comparison_features(3);
        let err = validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();
        assert!(err.contains("duplicate experiment ID"));
    }

    #[test]
    fn validate_by_ids_rejects_invalid_experiment_id_shape() {
        let mut request = valid_by_ids_request();
        request.experiment_ids = vec!["abc' OR 1=1--".into()];
        let features = comparison_features(3);
        let err = validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();
        assert!(err.contains("alphanumeric"));
    }

    #[test]
    fn validate_by_ids_rejects_over_cap_before_settings_work() {
        let request = valid_by_ids_request();
        let features = comparison_features(1);
        let err = validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();
        assert!(err.contains("exceeds"));
        assert!(err.contains("1 experiments"));
    }

    #[test]
    fn validate_by_ids_rejects_invalid_chart_dimension() {
        let mut request = valid_by_ids_request();
        request.settings.comparison_chart.chart_width = 99;
        let features = comparison_features(3);
        let err = validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();
        assert!(err.contains("chartWidth"));
    }

    #[test]
    fn validate_by_ids_rejects_duplicate_report_viscosity_rates() {
        let mut request = valid_by_ids_request();
        request.settings.report_settings.report_viscosity_rates = vec![40, 100, 100];
        let features = comparison_features(3);
        let err = validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();
        assert!(err.contains("duplicate shear rates"));
    }

    #[test]
    fn validate_by_ids_rejects_invalid_analysis_rate() {
        let mut request = valid_by_ids_request();
        request.settings.analysis_settings.viscosity_shear_rates = vec![40.0, f64::NAN];
        let features = comparison_features(3);
        let err = validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();
        assert!(err.contains("finite"));
    }

    #[test]
    fn validate_by_id_accepts_single_export_without_comparison_feature() {
        let request = valid_by_id_request("exp_aaaaaaaaaaaaaaaaaaaa");
        let mut features = empty_features();
        features.export_pdf = true;

        assert!(validate_report_by_id_request(&request, &features, ReportFormat::Pdf).is_ok());
    }

    #[test]
    fn validate_by_id_rejects_calibration_without_feature() {
        let mut request = valid_by_id_request("exp_aaaaaaaaaaaaaaaaaaaa");
        request.settings.section_toggles.show_calibration = true;
        let mut features = empty_features();
        features.export_pdf = true;

        let err = validate_report_by_id_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();

        assert!(err.contains("Calibration"));
        assert!(err.contains("Developer"));
    }

    #[test]
    fn validate_direct_comparison_rejects_calibration_without_feature() {
        let mut input = fixture_comparison_input();
        input.experiments[0].section_toggles.show_calibration = true;
        let features = comparison_features(3);

        let err = validate_comparison_direct_input(&input, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();

        assert!(err.contains("Calibration"));
        assert!(err.contains("Developer"));
    }

    #[test]
    fn validate_by_id_rejects_invalid_experiment_id_shape() {
        let mut request = valid_by_id_request("exp_aaaaaaaaaaaaaaaaaaaa");
        request.experiment_id = "abc' OR 1=1--".into();
        let mut features = empty_features();
        features.export_pdf = true;

        let err = validate_report_by_id_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();

        assert!(err.contains("alphanumeric"));
    }

    #[test]
    fn analysis_cache_key_material_is_deterministic_and_versioned() {
        let request = valid_by_ids_request();
        let settings = request.settings;
        let data_hash = hash_experiment_data_bytes(b"fixture-data");
        let changed_hash = hash_experiment_data_bytes(b"changed-data");
        let key_a = build_analysis_cache_key(
            "exp_aaaaaaaaaaaaaaaaaaaa",
            &data_hash,
            "R1B5",
            &super::build_expert_settings(&settings.analysis_settings),
            &super::build_schedule_config(&settings.detection_settings),
            &settings.report_settings.report_viscosity_rates,
        )
        .expect("cache key material should build");
        let key_b = build_analysis_cache_key(
            "exp_aaaaaaaaaaaaaaaaaaaa",
            &data_hash,
            "R1B5",
            &super::build_expert_settings(&settings.analysis_settings),
            &super::build_schedule_config(&settings.detection_settings),
            &settings.report_settings.report_viscosity_rates,
        )
        .expect("cache key material should build deterministically");
        let key_c = build_analysis_cache_key(
            "exp_aaaaaaaaaaaaaaaaaaaa",
            &changed_hash,
            "R1B5",
            &super::build_expert_settings(&settings.analysis_settings),
            &super::build_schedule_config(&settings.detection_settings),
            &settings.report_settings.report_viscosity_rates,
        )
        .expect("cache key material should change with data bytes");

        assert_eq!(key_a, key_b);
        assert_ne!(key_a.experiment_data_hash, key_c.experiment_data_hash);
        assert_eq!(key_a.experiment_data_hash.len(), 64);
        assert_eq!(key_a.rheolab_core_version, RHEOLAB_CORE_VERSION);
        assert_eq!(key_a.algorithm_version, ANALYSIS_CACHE_ALGORITHM_VERSION);
    }

    #[test]
    fn validate_experiment_ids_exist_reports_missing_ids_in_input_order() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute("CREATE TABLE Experiment (id TEXT PRIMARY KEY)", [])
            .expect("table");
        conn.execute(
            "INSERT INTO Experiment (id) VALUES (?1)",
            ["exp_aaaaaaaaaaaaaaaaaaaa"],
        )
        .expect("insert");
        let err = validate_comparison_experiment_ids_exist(
            &conn,
            &[
                "exp_bbbbbbbbbbbbbbbbbbbb".into(),
                "exp_aaaaaaaaaaaaaaaaaaaa".into(),
                "exp_cccccccccccccccccccc".into(),
            ],
        )
        .unwrap_err()
        .to_string();

        assert!(err.contains(
            "Experiment IDs not found: exp_bbbbbbbbbbbbbbbbbbbb, exp_cccccccccccccccccccc"
        ));
    }

    #[test]
    fn enforce_comparison_pdf_rejects_when_comparison_disabled() {
        let mut f = empty_features();
        f.export_pdf = true;
        f.max_comparison_experiments = 100;
        // comparison left = false
        let err = enforce_comparison_pdf_features(&f, 1)
            .unwrap_err()
            .to_string();
        assert!(err.contains("Comparison"));
        assert!(err.contains("REP-001"));
    }

    #[test]
    fn enforce_comparison_pdf_rejects_when_export_pdf_disabled() {
        let mut f = empty_features();
        f.comparison = true;
        f.max_comparison_experiments = 100;
        // export_pdf left = false
        let err = enforce_comparison_pdf_features(&f, 1)
            .unwrap_err()
            .to_string();
        assert!(err.contains("PDF"));
        assert!(err.contains("REP-001"));
    }

    #[test]
    fn enforce_comparison_pdf_rejects_when_count_exceeds_cap() {
        let mut f = empty_features();
        f.comparison = true;
        f.export_pdf = true;
        f.max_comparison_experiments = 3; // demo-tier cap
        let err = enforce_comparison_pdf_features(&f, 7)
            .unwrap_err()
            .to_string();
        assert!(err.contains("size 7"));
        assert!(err.contains("3 experiments"));
        assert!(err.contains("REP-001"));
    }

    #[test]
    fn enforce_comparison_pdf_accepts_when_count_at_cap() {
        let mut f = empty_features();
        f.comparison = true;
        f.export_pdf = true;
        f.max_comparison_experiments = 3;
        // Inclusive upper bound: count == max is allowed.
        assert!(enforce_comparison_pdf_features(&f, 3).is_ok());
    }

    #[test]
    fn enforce_comparison_pdf_accepts_when_unlimited_cap() {
        let mut f = empty_features();
        f.comparison = true;
        f.export_pdf = true;
        f.max_comparison_experiments = -1; // unlimited
                                           // Even a huge count must pass when the cap is "unlimited".
        assert!(enforce_comparison_pdf_features(&f, 10_000).is_ok());
    }

    #[test]
    fn enforce_comparison_excel_rejects_when_export_excel_disabled() {
        let mut f = empty_features();
        f.comparison = true;
        f.max_comparison_experiments = 100;
        // export_excel left = false
        let err = enforce_comparison_excel_features(&f, 1)
            .unwrap_err()
            .to_string();
        assert!(err.contains("Excel"));
        assert!(err.contains("REP-001"));
    }

    #[test]
    fn enforce_comparison_excel_accepts_with_full_features() {
        let mut f = empty_features();
        f.comparison = true;
        f.export_excel = true;
        f.max_comparison_experiments = 8;
        assert!(enforce_comparison_excel_features(&f, 5).is_ok());
    }

    #[test]
    fn enforce_single_pdf_does_not_require_comparison_feature() {
        let mut f = empty_features();
        f.export_pdf = true;
        assert!(enforce_single_pdf_features(&f).is_ok());
    }

    #[test]
    fn enforce_single_excel_rejects_when_export_excel_disabled() {
        let f = empty_features();
        let err = enforce_single_excel_features(&f).unwrap_err().to_string();
        assert!(err.contains("Excel"));
        assert!(err.contains("REP-001"));
    }

    #[test]
    fn enforce_calibration_feature_rejects_corporate_tier() {
        let f = comparison_features(3);
        let err = enforce_calibration_feature(&f, true)
            .unwrap_err()
            .to_string();
        assert!(err.contains("Calibration"));
        assert!(err.contains("Developer"));
    }

    #[test]
    fn enforce_calibration_feature_accepts_when_not_requested() {
        let f = comparison_features(3);
        assert!(enforce_calibration_feature(&f, false).is_ok());
    }

    #[test]
    fn enforce_max_comparison_experiments_treats_negative_as_unlimited() {
        // Per the LicenseFeatures contract: -1 means unlimited.
        assert!(enforce_max_comparison_experiments(-1, 0).is_ok());
        assert!(enforce_max_comparison_experiments(-1, 1_000_000).is_ok());
        // Other negatives also accepted (defensive — never a count error).
        assert!(enforce_max_comparison_experiments(-99, 1_000_000).is_ok());
    }

    /// REP-001 attack scenario after the legacy payload IPC removal:
    /// comparison export caps are enforced from the bounded by-IDs request
    /// before DB load, analysis, cache work, or report rendering can start.
    #[test]
    fn validate_by_ids_rejects_oversized_request_before_cache_work() {
        let mut request = valid_by_ids_request();
        request.experiment_ids = (0..100_000).map(|i| format!("exp_{i:020x}")).collect();
        let mut features = comparison_features(3);
        features.export_pdf = true;

        let err = validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();
        assert!(err.contains("100000"));
        assert!(err.contains("3 experiments"));
    }
}
