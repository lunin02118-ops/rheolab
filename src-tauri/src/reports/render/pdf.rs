use crate::error::{AppError, Result};
use crate::reports::render::typst;
use rheolab_core::report_generator::comparison::ComparisonReportInput;
use rheolab_core::report_generator::ReportInput;

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
pub(crate) async fn generate_pdf_bytes(input: ReportInput) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || generate_pdf_bytes_sync(input))
        .await
        .map_err(AppError::Join)?
}

pub(crate) fn generate_pdf_bytes_sync(input: ReportInput) -> Result<Vec<u8>> {
    render_pdf_from_input(&input)
}

pub(crate) fn render_pdf_from_input(input: &ReportInput) -> Result<Vec<u8>> {
    rheolab_core::report_generator::generate_pdf_from_input(input).map_err(|error| {
        typst::map_pdf_error("PDF generation failed", "PDF generation failed", error)
    })
}

pub(crate) fn render_pdf_by_id(input: &ReportInput) -> Result<Vec<u8>> {
    rheolab_core::report_generator::generate_pdf_from_input(input).map_err(|error| {
        typst::map_pdf_error_with_detail(
            "PDF by ID generation failed",
            "PDF by ID generation failed",
            error,
        )
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
pub(crate) async fn generate_comparison_pdf_bytes(input: ComparisonReportInput) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || generate_comparison_pdf_bytes_sync(input))
        .await
        .map_err(AppError::Join)?
}

pub(crate) fn generate_comparison_pdf_bytes_sync(input: ComparisonReportInput) -> Result<Vec<u8>> {
    render_comparison_pdf_from_input(&input)
}

pub(crate) fn render_comparison_pdf_from_input(input: &ComparisonReportInput) -> Result<Vec<u8>> {
    rheolab_core::report_generator::generate_comparison_pdf(input).map_err(|error| {
        typst::map_pdf_error(
            "Comparison PDF generation failed",
            "Comparison PDF generation failed",
            error,
        )
    })
}

pub(crate) fn render_comparison_pdf_by_ids(input: &ComparisonReportInput) -> Result<Vec<u8>> {
    rheolab_core::report_generator::generate_comparison_pdf(input).map_err(|error| {
        typst::map_pdf_error_with_detail(
            "Comparison PDF by IDs generation failed",
            "Comparison PDF by IDs generation failed",
            error,
        )
    })
}
