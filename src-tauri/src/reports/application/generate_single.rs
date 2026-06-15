use crate::db::DbPool;
use crate::error::{AppError, Result};
use crate::reports::application::comparison::build_comparison_report_input_by_ids_cached_with_job;
use crate::reports::domain::{ComparisonReportByIdsRequest, ExperimentReportByIdRequest};
use crate::reports::render::excel::render_excel_by_id;
use crate::reports::render::pdf::render_pdf_by_id;
use crate::runtime::jobs::JobContext;
use rheolab_core::report_generator::{Reagent, ReportInput, WaterParams};

pub(crate) fn generate_pdf_by_id_bytes_cached_with_job(
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
    let bytes = render_pdf_by_id(&input)?;
    ctx.record_output_bytes(bytes.len() as u64);
    Ok(bytes)
}

pub(crate) fn generate_excel_by_id_bytes_cached_with_job(
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
    let bytes = render_excel_by_id(&input)?;
    ctx.record_output_bytes(bytes.len() as u64);
    Ok(bytes)
}

pub(crate) fn build_report_input_by_id_cached_with_job(
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
