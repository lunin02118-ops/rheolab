#[cfg(test)]
use crate::commands::experiments::types::StoredExperiment;
use crate::db::DbPool;
use crate::error::Result;
use crate::reports::application::comparison::build_comparison_report_input_by_ids_cached_with_job;
#[cfg(test)]
use crate::reports::application::comparison::{
    build_comparison_report_input_by_ids_cached, build_comparison_report_input_from_experiments,
    load_comparison_experiments_by_ids,
};
use crate::reports::domain::ComparisonReportByIdsRequest;
use crate::reports::render::excel::render_comparison_excel_by_ids;
use crate::reports::render::pdf::render_comparison_pdf_by_ids;
use crate::runtime::jobs::JobContext;

#[tracing::instrument(
    level = "info",
    skip_all,
    name = "reports::cmp::pdf::by_ids",
    fields(n_experiments = request.experiment_ids.len())
)]
#[cfg(test)]
pub(crate) fn generate_comparison_pdf_by_ids_bytes(
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
pub(crate) fn generate_comparison_pdf_by_ids_bytes_cached(
    pool: &DbPool,
    request: &ComparisonReportByIdsRequest,
) -> Result<Vec<u8>> {
    let input = build_comparison_report_input_by_ids_cached(pool, request)?;
    render_comparison_pdf_by_ids(&input)
}

pub(crate) fn generate_comparison_pdf_by_ids_bytes_cached_with_job(
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
    let bytes = render_comparison_pdf_by_ids(&input)?;
    ctx.record_output_bytes(bytes.len() as u64);
    Ok(bytes)
}

#[cfg(test)]
pub(crate) fn generate_comparison_pdf_by_ids_bytes_from_experiments(
    experiments: &[StoredExperiment],
    request: &ComparisonReportByIdsRequest,
) -> Result<Vec<u8>> {
    let input = build_comparison_report_input_from_experiments(experiments, request)?;
    render_comparison_pdf_by_ids(&input)
}

#[tracing::instrument(
    level = "info",
    skip_all,
    name = "reports::cmp::xlsx::by_ids",
    fields(n_experiments = request.experiment_ids.len())
)]
#[cfg(test)]
pub(crate) fn generate_comparison_excel_by_ids_bytes(
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
pub(crate) fn generate_comparison_excel_by_ids_bytes_cached(
    pool: &DbPool,
    request: &ComparisonReportByIdsRequest,
) -> Result<Vec<u8>> {
    let input = build_comparison_report_input_by_ids_cached(pool, request)?;
    render_comparison_excel_by_ids(&input)
}

pub(crate) fn generate_comparison_excel_by_ids_bytes_cached_with_job(
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
    let bytes = render_comparison_excel_by_ids(&input)?;
    ctx.record_output_bytes(bytes.len() as u64);
    Ok(bytes)
}

#[cfg(test)]
pub(crate) fn generate_comparison_excel_by_ids_bytes_from_experiments(
    experiments: &[StoredExperiment],
    request: &ComparisonReportByIdsRequest,
) -> Result<Vec<u8>> {
    let input = build_comparison_report_input_from_experiments(experiments, request)?;
    render_comparison_excel_by_ids(&input)
}
