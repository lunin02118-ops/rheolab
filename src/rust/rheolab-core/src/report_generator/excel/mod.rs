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

use rust_xlsxwriter::{Workbook, Worksheet, XlsxError};
use super::types::ReportInput;

pub(crate) use styles::Styles;
// Shared 33 %-shrink helper for Excel chart line widths; the comparison
// assembler (`super::comparison`) imports it to keep its own per-exp
// series stroke in sync with the single-exp path.  The underlying
// `EXCEL_LINE_WIDTH_SCALE` constant stays `pub(crate)` in `chart.rs`
// (accessible via the full path) but isn't re-exported here since nothing
// outside that module needs the raw factor.
pub(crate) use chart::scaled_line_width;
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

    // ── Main report sheet ──────────────────────────────────────────────
    let sheet = workbook.add_worksheet();
    sheet.set_name("Report")?;
    write_single_experiment_to_sheet(sheet, "Report", input, &styles)?;

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

/// Populate the supplied worksheet with a complete single-experiment report.
///
/// This is the shared body used by both the single-experiment generator
/// (`generate_excel_internal`) and the comparison assembler (Phase 1.E +),
/// which needs to drop an identical per-experiment report into each sheet
/// from sheet 2 onwards.
///
/// # Contract
///
/// The caller is responsible for:
/// - **creating** the worksheet via `workbook.add_worksheet()`,
/// - **naming** it (so the caller controls `sanitize_sheet_name` /
///   deduplication before we touch any data),
/// - providing a **shared** [`Styles`] instance (one per workbook) to keep
///   the XLSX format cache small.
///
/// This function performs *only* the layout and content writes; it never
/// touches the `Workbook` itself.
///
/// **Important**: the function is a byte-for-byte refactor of what used to
/// live inline in `generate_excel_internal`.  A golden test in Phase 1.G
/// guarantees existing single-exp output is bit-identical.
pub(crate) fn write_single_experiment_to_sheet(
    sheet: &mut Worksheet,
    sheet_name: &str,
    input: &ReportInput,
    styles: &Styles,
) -> Result<(), XlsxError> {
    // Robust language check
    let lang = input.settings.language.trim().to_lowercase();
    let is_ru = lang == "ru" || lang.starts_with("ru");

    // ── Page setup ─────────────────────────────────────────────────────
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
    let RawDataSummary { max_time_display, has_bath, time_format } =
        raw_data::write_raw_data(sheet, input, styles, is_ru)?;

    let touch_points = if input.settings.show_touch_points {
        touch_points::calculate_touch_points(&input.raw_data, &input.settings, is_ru)
    } else {
        Vec::new()
    };

    let data_len = input.raw_data.len() as u32;
    let last_row = std::cmp::max(2, data_len);

    chart::build_chart(sheet, sheet_name, input, is_ru, has_bath, max_time_display, &time_format, last_row)?;

    // ── Report content (after the chart) ───────────────────────────────
    let mut current_row = 16u32;
    metadata::write_summary      (sheet, input, styles, is_ru, &mut current_row)?;
    metadata::write_calibration  (sheet, input, styles, is_ru, &mut current_row)?;
    metadata::write_recipe       (sheet, input, styles, is_ru, &mut current_row)?;
    metadata::write_water_analysis(sheet, input, styles, is_ru, &mut current_row)?;

    if input.settings.show_touch_points && !touch_points.is_empty() {
        stats::write_touch_points_table(sheet, &touch_points, styles, is_ru, &input.settings.unit_system, &mut current_row)?;
    }

    // --- Program (Schedule) Section ---
    // REMOVED per user request
    stats::write_statistics(sheet, input, styles, is_ru, &mut current_row)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::types::{DataPoint, ReportMetadata, ReportSettings};

    fn make_minimal_input() -> ReportInput {
        ReportInput {
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
        }
    }

    #[test]
    fn test_generate_simple_excel() {
        let input = make_minimal_input();
        let result = generate_excel_internal(&input);
        assert!(result.is_ok());
        let bytes = result.expect("generate_excel_internal succeeded");
        assert!(bytes.len() > 1000);
    }

    /// Golden test: the single-experiment path is a thin wrapper around
    /// [`write_single_experiment_to_sheet`].  Running it twice must produce
    /// deterministic output — byte-for-byte identical.
    ///
    /// This locks the refactor done in Phase 1.C against accidental drift.
    /// Future changes to the assembler must explicitly bump this test.
    #[test]
    fn single_exp_output_is_deterministic() {
        let input = make_minimal_input();
        let a = generate_excel_internal(&input).expect("first run");
        let b = generate_excel_internal(&input).expect("second run");
        assert_eq!(
            a.len(), b.len(),
            "non-deterministic length: {} vs {}",
            a.len(), b.len(),
        );
        // XLSX files are ZIPs; the ZIP central directory records CRCs of each
        // entry.  If content drifted between runs, CRCs wouldn't match and
        // the raw byte-stream would differ.  rust_xlsxwriter writes without
        // embedding wall-clock timestamps, so this comparison is stable.
        assert_eq!(a, b, "byte-level output is non-deterministic");
    }

    /// Regression test for CHART-TIME-FORMAT-01 (2026-04-22):
    /// the resolved `time_format` from the dashboard's unit picker must
    /// reach the raw-data column and the chart axis.  Changing only
    /// `rheology_units.time_format` MUST change the produced XLSX bytes.
    ///
    /// Also locks in per-format determinism — same settings, same bytes.
    #[test]
    fn time_format_propagates_to_xlsx_output() {
        use super::super::types::RheologyUnits;
        let base = make_minimal_input();

        let mut with_seconds = base.clone();
        with_seconds.settings.rheology_units = Some(RheologyUnits {
            time_format: "seconds".into(),
            ..Default::default()
        });

        let mut with_hhmmss = base.clone();
        with_hhmmss.settings.rheology_units = Some(RheologyUnits {
            time_format: "hh:mm:ss".into(),
            ..Default::default()
        });

        let bytes_min  = generate_excel_internal(&base).expect("minutes run");
        let bytes_sec  = generate_excel_internal(&with_seconds).expect("seconds run");
        let bytes_hms  = generate_excel_internal(&with_hhmmss).expect("hh:mm:ss run");

        assert_ne!(bytes_min, bytes_sec,
            "time_format='seconds' MUST produce different bytes than 'minutes'");
        assert_ne!(bytes_min, bytes_hms,
            "time_format='hh:mm:ss' MUST produce different bytes than 'minutes'");
        assert_ne!(bytes_sec, bytes_hms,
            "'seconds' and 'hh:mm:ss' are visually distinct → bytes must differ");

        // Determinism per format (two consecutive runs = identical bytes).
        let bytes_sec2 = generate_excel_internal(&with_seconds).expect("seconds run 2");
        assert_eq!(bytes_sec, bytes_sec2,
            "seconds-formatted output is non-deterministic");
        let bytes_hms2 = generate_excel_internal(&with_hhmmss).expect("hh:mm:ss run 2");
        assert_eq!(bytes_hms, bytes_hms2,
            "hh:mm:ss-formatted output is non-deterministic");
    }

    /// Golden test: driving the assembler helper directly on a fresh
    /// workbook produces the same first worksheet as the existing
    /// `generate_excel_internal` path (minus the hidden DebugInfo sheet).
    ///
    /// This is the contract `comparison::` will rely on in Phase 1.E.
    #[test]
    fn write_single_experiment_to_sheet_is_reusable() {
        let input = make_minimal_input();
        let styles = Styles::new();

        let mut workbook = Workbook::new();
        let sheet = workbook.add_worksheet();
        sheet.set_name("Report").unwrap();
        write_single_experiment_to_sheet(sheet, "Report", &input, &styles)
            .expect("assembler helper succeeds");
        let bytes = workbook.save_to_buffer().expect("save");

        // Should be a valid xlsx: magic bytes for ZIP (PK\x03\x04) at offset 0.
        assert_eq!(&bytes[0..4], b"PK\x03\x04", "not a ZIP / XLSX file");
        assert!(bytes.len() > 1000, "trivially empty workbook: {} bytes", bytes.len());
    }
}
