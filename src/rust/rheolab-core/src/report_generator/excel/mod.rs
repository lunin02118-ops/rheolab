//! Excel report generator.
//!
//! Generates Excel reports matching XlsxChartService.ts, using
//! [`rust_xlsxwriter`] for native Excel output including an embedded chart.
//!
//! **ЕДИНЫЙ ИСТОЧНИК форматирования.** All numeric display formats come from
//! [`super::formatters::excel_formats`], identical to what PDF reports use.
//!
//! # Module layout
//! - [`styles`]       — cell/number formats shared across sections
//! - [`raw_data`]     — hidden raw-data columns (U..AB) that the chart references
//! - [`chart`]        — scatter-smooth chart + axes + series
//! - [`metadata`]     — passport, calibration, recipe, water analysis
//! - [`stats`]        — touch-points table + rheological statistics
//! - [`touch_points`] — Excel-specific touch-point calculation wrapper

mod styles;
mod raw_data;
mod chart;
mod metadata;
mod stats;
mod touch_points;

use rust_xlsxwriter::{Workbook, XlsxError};
use super::types::ReportInput;

use styles::Styles;
use raw_data::RawDataSummary;

/// Generate Excel report from JSON input.
pub fn generate_excel_report(input_json: &str) -> Result<Vec<u8>, String> {
    let input: ReportInput = serde_json::from_str(input_json)
        .map_err(|e| format!("JSON parse error: {}", e))?;
    generate_excel_from_input(&input)
}

/// Generate an Excel report from a pre-parsed [`ReportInput`].
pub fn generate_excel_from_input(input: &ReportInput) -> Result<Vec<u8>, String> {
    generate_excel_internal(input)
        .map_err(|e| format!("Excel generation error: {}", e))
}

fn generate_excel_internal(input: &ReportInput) -> Result<Vec<u8>, XlsxError> {
    let mut workbook = Workbook::new();
    let styles = Styles::new();

    // Robust language check
    let lang = input.settings.language.trim().to_lowercase();
    let is_ru = lang == "ru" || lang.starts_with("ru");

    // ── Sheet setup ─────────────────────────────────────────────────────
    let sheet = workbook.add_worksheet();
    sheet.set_name("Report")?;
    sheet.set_paper_size(9); // A4
    sheet.set_portrait();

    // Column widths: A=15, others=10
    for col in 0..20 {
        sheet.set_column_width(col, 10)?;
    }
    sheet.set_column_width(0, 15)?;

    // Row height for chart area (first 15 rows)
    for row in 0..15 {
        sheet.set_row_height(row, 30)?;
    }

    // ── Data → chart pipeline ──────────────────────────────────────────
    let RawDataSummary { max_time_minutes, has_bath } =
        raw_data::write_raw_data(sheet, input, &styles, is_ru)?;

    let touch_points = if input.settings.show_touch_points {
        touch_points::calculate_touch_points(&input.raw_data, &input.settings, is_ru)
    } else {
        Vec::new()
    };

    let data_len = input.raw_data.len() as u32;
    let last_row = std::cmp::max(2, data_len);

    chart::build_chart(sheet, input, is_ru, has_bath, max_time_minutes, last_row)?;

    // ── Report content (after the chart) ───────────────────────────────
    let mut current_row = 16u32;
    metadata::write_summary      (sheet, input, &styles, is_ru, &mut current_row)?;
    metadata::write_calibration  (sheet, input, &styles, is_ru, &mut current_row)?;
    metadata::write_recipe       (sheet, input, &styles, is_ru, &mut current_row)?;
    metadata::write_water_analysis(sheet, input, &styles, is_ru, &mut current_row)?;

    if input.settings.show_touch_points && !touch_points.is_empty() {
        stats::write_touch_points_table(sheet, &touch_points, &styles, is_ru, &mut current_row)?;
    }

    // --- Program (Schedule) Section ---
    // REMOVED per user request
    stats::write_statistics(sheet, input, &styles, is_ru, &mut current_row)?;

    // ── Debug sheet (hidden) ───────────────────────────────────────────
    // Created at the end because borrow checker forbids adding a new
    // worksheet while `sheet` (the Report handle) is still in scope.
    let debug_sheet = workbook.add_worksheet();
    debug_sheet.set_name("DebugInfo")?;
    debug_sheet.set_hidden(true);

    debug_sheet.write_string(0, 0, "Setting")?;
    debug_sheet.write_string(0, 1, "Value")?;

    debug_sheet.write_string(1, 0, "Shear Rate Axis")?;
    debug_sheet.write_string(1, 1, &input.settings.shear_rate_axis)?;

    debug_sheet.write_string(2, 0, "Pressure Axis")?;
    debug_sheet.write_string(2, 1, &input.settings.pressure_axis)?;

    debug_sheet.write_string(3, 0, "Show Shear Rate")?;
    debug_sheet.write_boolean(3, 1, input.settings.show_shear_rate)?;

    debug_sheet.write_string(4, 0, "Show Pressure")?;
    debug_sheet.write_boolean(4, 1, input.settings.show_pressure)?;

    workbook.save_to_buffer()
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::types::{DataPoint, ReportMetadata, ReportSettings};

    #[test]
    fn test_generate_simple_excel() {
        let input = ReportInput {
            raw_data: vec![
                DataPoint { time_sec:  0.0, viscosity_cp: 100.0, temperature_c: Some(25.0), shear_rate: Some(100.0), shear_stress_pa: None, speed_rpm: None, pressure_bar: None, bath_temperature_c: None },
                DataPoint { time_sec: 60.0, viscosity_cp: 150.0, temperature_c: Some(50.0), shear_rate: Some( 75.0), shear_stress_pa: None, speed_rpm: None, pressure_bar: None, bath_temperature_c: None },
            ],
            metadata: ReportMetadata {
                filename: "test.xlsx".to_string(),
                test_id: Some("TEST-001".to_string()),
                ..Default::default()
            },
            cycle_results: vec![],
            recipe: vec![],
            water_params: None,
            cycles: vec![],
            settings: ReportSettings::default(),
            chart_image_base64: None,
            axis_values: None,
        };

        let result = generate_excel_internal(&input);
        assert!(result.is_ok());
        let bytes = result.expect("generate_excel_internal succeeded");
        assert!(bytes.len() > 1000);
    }
}
