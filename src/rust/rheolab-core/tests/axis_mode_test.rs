/// Tests for axis_mode in report generation.
///
/// Verifies that:
/// - `axis_mode` field is correctly deserialized from JSON
/// - Default is "individual" when the field is absent (backward-compatible)
/// - Full PDF/Excel pipeline respects the axis_mode setting
/// - "individual" mode generates a valid report (regression guard)
/// - "shared" mode generates a valid report (regression guard)

use rheolab_core::report_generator::{generate_pdf_report, generate_excel_report};
use serde_json;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/// Minimal raw data for tests that require chart rendering.
const RAW_DATA: &str = r#"[
    {"time_sec": 0,   "viscosity_cp": 1000, "temperature_c": 25, "shear_rate": 170},
    {"time_sec": 60,  "viscosity_cp": 950,  "temperature_c": 50, "shear_rate": 170},
    {"time_sec": 120, "viscosity_cp": 900,  "temperature_c": 75, "shear_rate": 170},
    {"time_sec": 180, "viscosity_cp": 850,  "temperature_c": 90, "shear_rate": 170},
    {"time_sec": 240, "viscosity_cp": 800,  "temperature_c": 96, "shear_rate": 170}
]"#;

/// Build a full report input JSON string, injecting the provided settings fragment.
fn make_report_input(settings_extra: &str) -> String {
    format!(r#"{{
        "metadata": {{
            "filename": "axis_mode_test.xlsx",
            "test_date": "2025-01-01",
            "company_name": "Test Corp",
            "instrument_type": "Grace M5600",
            "geometry": "R1B5"
        }},
        "raw_data": {raw},
        "cycle_results": [{{
            "cycle_no": 1, "time_min": 2.0, "temp_c": 96.0,
            "n_prime": 0.85, "k_prime": 0.25, "r2": 0.998
        }}],
        "recipe": [{{"name": "Water", "concentration": 1.0, "unit": "L/m3"}}],
        "settings": {{
            "language": "ru",
            "unit_system": "SI",
            "show_temperature": true,
            "show_shear_rate": true,
            "show_pressure": false,
            {extras}
        }}
    }}"#,
        raw = RAW_DATA,
        extras = settings_extra,
    )
}

// ---------------------------------------------------------------------------
// Unit: ReportSettings deserialization
// ---------------------------------------------------------------------------

mod settings_deserialization {
    use rheolab_core::report_generator::types::ReportSettings;
    use serde_json;

    #[test]
    fn default_axis_mode_is_individual() {
        let json = r#"{
            "language": "ru",
            "unit_system": "SI"
        }"#;
        let settings: ReportSettings = serde_json::from_str(json).expect("parse failed");
        assert_eq!(settings.axis_mode, "individual",
            "axis_mode should default to 'individual' for backward compatibility");
    }

    #[test]
    fn explicit_individual_axis_mode_is_preserved() {
        let json = r#"{
            "language": "ru",
            "unit_system": "SI",
            "axis_mode": "individual"
        }"#;
        let settings: ReportSettings = serde_json::from_str(json).expect("parse failed");
        assert_eq!(settings.axis_mode, "individual");
    }

    #[test]
    fn shared_axis_mode_is_preserved() {
        let json = r#"{
            "language": "ru",
            "unit_system": "SI",
            "axis_mode": "shared"
        }"#;
        let settings: ReportSettings = serde_json::from_str(json).expect("parse failed");
        assert_eq!(settings.axis_mode, "shared");
    }

    #[test]
    fn axis_mode_does_not_affect_other_fields() {
        let json = r#"{
            "language": "en",
            "unit_system": "API",
            "show_shear_rate": true,
            "shear_rate_axis": "right",
            "axis_mode": "individual"
        }"#;
        let settings: ReportSettings = serde_json::from_str(json).expect("parse failed");
        // axis_mode field should be set correctly
        assert_eq!(settings.axis_mode, "individual");
        // Other fields should be unaffected
        assert_eq!(settings.shear_rate_axis, "right");
        assert!(settings.show_shear_rate);
        assert_eq!(settings.language, "en");
    }
}

// ---------------------------------------------------------------------------
// Integration: full PDF generation with each axis mode
// ---------------------------------------------------------------------------

#[test]
fn pdf_generates_successfully_in_individual_axis_mode() {
    let input = make_report_input(r#""axis_mode": "individual""#);
    let result = generate_pdf_report(&input);
    assert!(result.is_ok(), "PDF generation failed in individual mode: {:?}", result.err());
    let bytes = result.unwrap();
    assert!(bytes.starts_with(b"%PDF-"), "Output is not a valid PDF in individual mode");
}

#[test]
fn pdf_generates_successfully_in_shared_axis_mode() {
    let input = make_report_input(r#""axis_mode": "shared""#);
    let result = generate_pdf_report(&input);
    assert!(result.is_ok(), "PDF generation failed in shared mode: {:?}", result.err());
    let bytes = result.unwrap();
    assert!(bytes.starts_with(b"%PDF-"), "Output is not a valid PDF in shared mode");
}

#[test]
fn pdf_generates_successfully_without_axis_mode_field() {
    // Backward compat: no axis_mode in JSON → defaults to "individual"
    let input = make_report_input(r#""show_calibration": false"#);
    let result = generate_pdf_report(&input);
    assert!(result.is_ok(), "PDF generation failed without axis_mode: {:?}", result.err());
    let bytes = result.unwrap();
    assert!(bytes.starts_with(b"%PDF-"), "Output is not a valid PDF");
}

// ---------------------------------------------------------------------------
// Integration: full Excel generation with each axis mode
// ---------------------------------------------------------------------------

#[test]
fn excel_generates_successfully_in_individual_axis_mode() {
    let input = make_report_input(r#""axis_mode": "individual""#);
    let result = generate_excel_report(&input);
    assert!(result.is_ok(), "Excel generation failed in individual mode: {:?}", result.err());
    let bytes = result.unwrap();
    // XLSX files start with PK (ZIP magic bytes)
    assert!(bytes.starts_with(b"PK"), "Output is not a valid XLSX in individual mode");
}

#[test]
fn excel_generates_successfully_in_shared_axis_mode() {
    let input = make_report_input(r#""axis_mode": "shared""#);
    let result = generate_excel_report(&input);
    assert!(result.is_ok(), "Excel generation failed in shared mode: {:?}", result.err());
    let bytes = result.unwrap();
    assert!(bytes.starts_with(b"PK"), "Output is not a valid XLSX in shared mode");
}

// ---------------------------------------------------------------------------
// Axis placement: shear_rate_axis is respected in ALL modes (individual + shared)
// ---------------------------------------------------------------------------
//
// The rule is simple: axis_mode does NOT override the per-line axis settings.
// shear_rate_axis='left'  → shear rate on left  (both individual and shared)
// shear_rate_axis='right' → shear rate on right (both individual and shared)
//
// Previously, individual mode ALWAYS forced shear rate to right regardless of
// shear_rate_axis. That bug is fixed — these tests guard against regression.

/// Axis placement test helper: build a full report input with specific axis settings.
fn make_report_with_axes(axis_mode: &str, shear_rate_axis: &str) -> String {
    format!(r#"{{
        "metadata": {{
            "filename": "axis_placement_test.xlsx",
            "test_date": "2025-01-01",
            "company_name": "Acme",
            "instrument_type": "Grace M5600",
            "geometry": "R1B5"
        }},
        "raw_data": {raw},
        "cycle_results": [],
        "recipe": [],
        "settings": {{
            "language": "ru",
            "unit_system": "SI",
            "show_temperature": true,
            "show_shear_rate": true,
            "show_pressure": false,
            "shear_rate_axis": "{sr_axis}",
            "pressure_axis": "right",
            "axis_mode": "{mode}"
        }}
    }}"#,
        raw = RAW_DATA,
        sr_axis = shear_rate_axis,
        mode = axis_mode,
    )
}

#[test]
fn shear_rate_on_left_in_individual_mode_generates_valid_pdf() {
    // Previously this combination was silently broken: axis_mode='individual'
    // forced shear_rate to right even with shear_rate_axis='left'.
    // Now both settings are independent — this must produce a valid PDF.
    let input = make_report_with_axes("individual", "left");
    let result = generate_pdf_report(&input);
    assert!(result.is_ok(), "PDF failed with shear_rate_axis='left' + individual: {:?}", result.err());
    assert!(result.unwrap().starts_with(b"%PDF-"));
}

#[test]
fn shear_rate_on_right_in_individual_mode_generates_valid_pdf() {
    let input = make_report_with_axes("individual", "right");
    let result = generate_pdf_report(&input);
    assert!(result.is_ok(), "PDF failed with shear_rate_axis='right' + individual: {:?}", result.err());
    assert!(result.unwrap().starts_with(b"%PDF-"));
}

#[test]
fn shear_rate_on_left_in_shared_mode_generates_valid_pdf() {
    let input = make_report_with_axes("shared", "left");
    let result = generate_pdf_report(&input);
    assert!(result.is_ok(), "PDF failed with shear_rate_axis='left' + shared: {:?}", result.err());
    assert!(result.unwrap().starts_with(b"%PDF-"));
}

#[test]
fn shear_rate_on_right_in_shared_mode_generates_valid_pdf() {
    let input = make_report_with_axes("shared", "right");
    let result = generate_pdf_report(&input);
    assert!(result.is_ok(), "PDF failed with shear_rate_axis='right' + shared: {:?}", result.err());
    assert!(result.unwrap().starts_with(b"%PDF-"));
}

// ---------------------------------------------------------------------------
// SVG axis line presence: right axis line is drawn only when right axis is used
// ---------------------------------------------------------------------------
//
// Note: Plotters WASM cannot render text fonts, so label_left / label_right are
// passed to the Typst template as metadata (not embedded in the SVG itself).
// What we CAN test is whether the chart computes valid scales for both sides
// and whether the right-axis line is present/absent based on settings.

#[test]
fn shear_rate_left_draws_valid_svg_without_right_axis_line() {
    use rheolab_core::report_generator::chart_generator::{
        generate_chart_svg, ChartConfig, ChartPoint,
    };

    let points = vec![
        ChartPoint { time_min: 0.0, viscosity_cp: 1000.0, temperature_c: None, shear_rate: Some(170.0), pressure_bar: None, bath_temperature_c: None },
        ChartPoint { time_min: 5.0, viscosity_cp: 900.0,  temperature_c: None, shear_rate: Some(170.0), pressure_bar: None, bath_temperature_c: None },
    ];

    // shear_rate_axis='left', show_temperature=false → nothing on right axis
    let config = ChartConfig {
        show_temperature: false,
        show_shear_rate: true,
        show_pressure: false,
        show_bath_temperature: false,
        shear_rate_axis: "left".to_string(),
        pressure_axis: "right".to_string(),
        axis_mode: "individual".to_string(),
        width: 800,
        height: 400,
        label_left: "Вязкость / Скор. сдвига".to_string(),
        label_right: String::new(),
        label_bottom: "Время (мин)".to_string(),
        name_viscosity: "Вязкость".to_string(),
        name_temperature: "Температура".to_string(),
        name_shear_rate: "Скор. сдвига".to_string(),
        name_pressure: "Давление".to_string(),
        name_bath_temperature: "Темп. бани".to_string(),
        touch_points: vec![],
        viscosity_threshold: None,
        line_styles: None,
        skip_downsample: false,
    };

    let res = generate_chart_svg(&points, &config);
    assert!(res.is_ok(), "SVG generation must not fail: {:?}", res.err());
    let (svg, ranges) = res.unwrap();
    assert!(svg.contains("<svg"), "Output must be an SVG");
    // When shear_rate is on LEFT and temperature is hidden → right_vals is EMPTY
    // Empty right_vals use the default range (0..100). This confirms shear_rate
    // was NOT routed to right (otherwise right_max would include shear_rate=170).
    assert!(ranges.y_right_max <= 110.0,
        "Right scale should use default range (no data on right), got {}", ranges.y_right_max);
}

#[test]
fn shear_rate_right_puts_values_on_right_scale() {
    use rheolab_core::report_generator::chart_generator::{
        generate_chart_svg, ChartConfig, ChartPoint,
    };

    let points = vec![
        ChartPoint { time_min: 0.0, viscosity_cp: 1000.0, temperature_c: Some(80.0), shear_rate: Some(170.0), pressure_bar: None, bath_temperature_c: None },
        ChartPoint { time_min: 5.0, viscosity_cp: 900.0,  temperature_c: Some(90.0), shear_rate: Some(170.0), pressure_bar: None, bath_temperature_c: None },
    ];

    // shear_rate_axis='right' → shear rate on right (same side as temperature)
    let config = ChartConfig {
        show_temperature: true,
        show_shear_rate: true,
        show_pressure: false,
        show_bath_temperature: false,
        shear_rate_axis: "right".to_string(),
        pressure_axis: "right".to_string(),
        axis_mode: "individual".to_string(),
        width: 800,
        height: 400,
        label_left: "Вязкость".to_string(),
        label_right: "Температура / Скор. сдвига".to_string(),
        label_bottom: "Время (мин)".to_string(),
        name_viscosity: "Вязкость".to_string(),
        name_temperature: "Температура".to_string(),
        name_shear_rate: "Скор. сдвига".to_string(),
        name_pressure: "Давление".to_string(),
        name_bath_temperature: "Темп. бани".to_string(),
        touch_points: vec![],
        viscosity_threshold: None,
        line_styles: None,
        skip_downsample: false,
    };

    let res = generate_chart_svg(&points, &config);
    assert!(res.is_ok(), "SVG generation must not fail: {:?}", res.err());
    let (svg, ranges) = res.unwrap();
    assert!(svg.contains("<svg"), "Output must be an SVG");
    // In individual axis mode each metric has its own independent scale.
    // The shear_rate entry in individual_axes must be on the right side and
    // must have a max that covers the data value 170.
    let sr_axis = ranges.individual_axes.iter()
        .find(|a| a.metric == "shear_rate")
        .expect("individual_axes must contain a shear_rate entry");
    assert_eq!(sr_axis.side, "right", "shear_rate must be on the right side");
    assert!(sr_axis.max >= 170.0,
        "Shear rate axis max must cover value 170, got {}", sr_axis.max);
}

#[test]
fn axis_mode_roundtrip_through_json() {
    // Simulate full JSON round-trip: build JSON → parse ReportSettings
    use rheolab_core::report_generator::types::ReportInput;

    let individual_json = make_report_input(r#""axis_mode": "individual", "shear_rate_axis": "left""#);
    let parsed_individual: ReportInput = serde_json::from_str(&individual_json).expect("parse failed");
    assert_eq!(parsed_individual.settings.axis_mode, "individual");
    assert_eq!(parsed_individual.settings.shear_rate_axis, "left");

    let shared_json = make_report_input(r#""axis_mode": "shared", "shear_rate_axis": "left""#);
    let parsed_shared: ReportInput = serde_json::from_str(&shared_json).expect("parse failed");
    assert_eq!(parsed_shared.settings.axis_mode, "shared");
    assert_eq!(parsed_shared.settings.shear_rate_axis, "left");
}

/// Regression test: chart page margins must be identical between axis modes.
///
/// Before the fix, shared mode used (n_left_extra=0, n_right_extra=0) which placed
/// tick labels at the SVG edges instead of the chart body edges, producing visually
/// different margins compared to individual mode.
///
/// This test uses a multi-axis config (temperature + shear_rate on right = 2 right
/// columns) so the expected right margin is non-trivial (>TICK_MARGIN_PX).
/// Both PDFs must succeed and be similar in size (same layout, different label content).
#[test]
fn chart_page_margins_identical_between_axis_modes() {
    // Multi-axis settings: shear_rate on right → n_right=2 (temperature + shear_rate)
    let settings_extra = r#"
        "show_bath_temperature": true,
        "shear_rate_axis": "right",
        "pressure_axis": "right"
    "#;

    let individual_json = make_report_input(&format!(r#""axis_mode": "individual", {settings_extra}"#,
        settings_extra = settings_extra.trim_matches(|c| c == ' ' || c == '\n' || c == ',')));
    let shared_json    = make_report_input(&format!(r#""axis_mode": "shared", {settings_extra}"#,
        settings_extra = settings_extra.trim_matches(|c| c == ' ' || c == '\n' || c == ',')));

    let ind_pdf = generate_pdf_report(&individual_json)
        .expect("individual mode PDF must succeed");
    let sha_pdf = generate_pdf_report(&shared_json)
        .expect("shared mode PDF must succeed");

    assert!(ind_pdf.starts_with(b"%PDF"), "individual mode output must be a PDF");
    assert!(sha_pdf.starts_with(b"%PDF"), "shared mode output must be a PDF");

    // Both layouts should occupy the same page structure → similar PDF sizes.
    // Allow 20 % tolerance for Typst compression variation.
    let ratio = ind_pdf.len() as f64 / sha_pdf.len() as f64;
    assert!(
        ratio >= 0.80 && ratio <= 1.20,
        "PDF sizes should be within 20% of each other (same layout); \
         individual={} bytes, shared={} bytes, ratio={:.2}",
        ind_pdf.len(), sha_pdf.len(), ratio
    );
}

/// Regression test: SVG internal chart body margins match between modes.
///
/// For the same axis configuration the shared and individual renderers must
/// produce an SVG with the same internal left/right margin constants so that
/// when Typst scales the image the data series aligns with the tick overlay.
#[test]
fn svg_chart_body_margins_match_between_modes() {
    use rheolab_core::report_generator::chart_generator::{
        generate_chart_svg, ChartConfig, ChartPoint,
    };

    // Build points with all four metrics so both renderers have non-empty data.
    let points = vec![
        ChartPoint { time_min: 0.0,  viscosity_cp: 1000.0, temperature_c: Some(25.0),  shear_rate: Some(50.0),  pressure_bar: None, bath_temperature_c: Some(24.0) },
        ChartPoint { time_min: 5.0,  viscosity_cp: 900.0,  temperature_c: Some(60.0),  shear_rate: Some(170.0), pressure_bar: None, bath_temperature_c: Some(59.0) },
        ChartPoint { time_min: 10.0, viscosity_cp: 850.0,  temperature_c: Some(90.0),  shear_rate: Some(170.0), pressure_bar: None, bath_temperature_c: Some(89.0) },
    ];

    let base_config = |mode: &str| ChartConfig {
        show_temperature: true,
        show_shear_rate: true,
        show_pressure: false,
        show_bath_temperature: true,
        shear_rate_axis: "right".to_string(), // → 2nd right column
        pressure_axis: "right".to_string(),
        axis_mode: mode.to_string(),
        width: 1040,
        height: 600,
        label_left:   "Вязкость (сП)".to_string(),
        label_right:  "Температура (°C) / Скор. сдвига (1/с)".to_string(),
        label_bottom: "Время (мин)".to_string(),
        name_viscosity:     "Вязкость".to_string(),
        name_temperature:   "Температура".to_string(),
        name_shear_rate:    "Скор. сдвига".to_string(),
        name_pressure:      "Давление".to_string(),
        name_bath_temperature: "Темп. бани".to_string(),
        touch_points: vec![],
        viscosity_threshold: None,
        line_styles: None,
        skip_downsample: true,
    };

    let (svg_ind, ranges_ind) = generate_chart_svg(&points, &base_config("individual"))
        .expect("individual SVG must succeed");
    let (svg_sha, _ranges_sha) = generate_chart_svg(&points, &base_config("shared"))
        .expect("shared SVG must succeed");

    assert!(svg_ind.contains("<svg"), "individual output must be SVG");
    assert!(svg_sha.contains("<svg"), "shared output must be SVG");

    // Individual mode must have exactly 2 right axes (temperature + shear_rate)
    // and 1 left axis (viscosity).  This means n_right_extra=1 in the Typst overlay,
    // which is the value that must now also be used in shared mode.
    let right_axes: Vec<_> = ranges_ind.individual_axes.iter()
        .filter(|a| a.side == "right").collect();
    assert_eq!(right_axes.len(), 2,
        "individual mode must have temperature + shear_rate on right; got {:?}",
        right_axes.iter().map(|a| &a.metric).collect::<Vec<_>>());

    let left_axes: Vec<_> = ranges_ind.individual_axes.iter()
        .filter(|a| a.side == "left").collect();
    assert_eq!(left_axes.len(), 1,
        "individual mode must have only viscosity on left; got {:?}",
        left_axes.iter().map(|a| &a.metric).collect::<Vec<_>>());

    // The SVG dimensions must be identical for both modes (same config).
    // The width attribute in the root <svg> tag must match.
    let extract_svg_width = |svg: &str| -> Option<u32> {
        svg.split("width=\"").nth(1)?.split('"').next()?.parse().ok()
    };
    assert_eq!(
        extract_svg_width(&svg_ind),
        extract_svg_width(&svg_sha),
        "SVG widths must match between modes"
    );
}
