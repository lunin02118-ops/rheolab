use crate::error::{AppError, Result};
use rheolab_core::report_generator::comparison::ComparisonReportInput;
use rheolab_core::report_generator::ReportInput;

/// Inner implementation used by tests — returns raw bytes.
#[tracing::instrument(level = "info", skip_all, name = "reports::excel::spawn_blocking")]
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn generate_excel_bytes(input: ReportInput) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || generate_excel_bytes_sync(input))
        .await
        .map_err(AppError::Join)?
}

pub(crate) fn generate_excel_bytes_sync(input: ReportInput) -> Result<Vec<u8>> {
    render_excel_from_input(&input)
}

pub(crate) fn render_excel_from_input(input: &ReportInput) -> Result<Vec<u8>> {
    rheolab_core::report_generator::generate_excel_from_input(input).map_err(|error| {
        tracing::error!("Excel generation failed: {:?}", error);
        AppError::Other("Excel generation failed".into())
    })
}

pub(crate) fn render_excel_by_id(input: &ReportInput) -> Result<Vec<u8>> {
    rheolab_core::report_generator::generate_excel_from_input(input).map_err(|error| {
        tracing::error!("Excel by ID generation failed: {:?}", error);
        AppError::Other(format!("Excel by ID generation failed: {:?}", error))
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
pub(crate) async fn generate_comparison_excel_bytes(
    input: ComparisonReportInput,
) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || generate_comparison_excel_bytes_sync(input))
        .await
        .map_err(AppError::Join)?
}

pub(crate) fn generate_comparison_excel_bytes_sync(
    input: ComparisonReportInput,
) -> Result<Vec<u8>> {
    render_comparison_excel_from_input(&input)
}

pub(crate) fn render_comparison_excel_from_input(input: &ComparisonReportInput) -> Result<Vec<u8>> {
    rheolab_core::report_generator::generate_comparison_excel(input).map_err(|error| {
        tracing::error!("Comparison Excel generation failed: {}", error);
        AppError::Other("Comparison Excel generation failed".into())
    })
}

pub(crate) fn render_comparison_excel_by_ids(input: &ComparisonReportInput) -> Result<Vec<u8>> {
    rheolab_core::report_generator::generate_comparison_excel(input).map_err(|error| {
        tracing::error!("Comparison Excel by IDs generation failed: {}", error);
        AppError::Other(format!(
            "Comparison Excel by IDs generation failed: {}",
            error
        ))
    })
}
