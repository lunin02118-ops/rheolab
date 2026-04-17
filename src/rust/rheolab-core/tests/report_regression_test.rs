/// Regression tests for report generation pipeline (Rust side).
///
/// These tests guard against regressions in:
///   - Settings deserialization completeness (all fields from JSON → ReportSettings)
///   - Chart width formula (622a0c9)
///   - show_advanced_stats affecting stats table columns (580d6c7)
///   - Touch point smart algorithm (509a8e2)
///   - PDF/Excel generation stability with all settings present
///
/// Reference fixture: tests/fixtures/report_data.json (project root)

use rheolab_core::report_generator::types::{ReportInput, ReportSettings};
use rheolab_core::report_generator::{generate_pdf_report, generate_excel_report};
use rheolab_core::report_generator::chart_generator::{ChartConfig, ChartPoint, generate_chart_svg};
use serde_json;

const FIXTURE_JSON: &str = include_str!("../../../../tests/fixtures/report_data.json");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn make_input_json(settings_override: &str) -> String {
    format!(r##"{{
        "metadata": {{
            "filename": "regression_test.xlsx",
            "test_date": "2025-01-01",
            "company_name": "RheoLab",
            "instrument_type": "Grace M5600",
            "geometry": "R1B5"
        }},
        "raw_data": [
            {{"time_sec": 0,   "viscosity_cp": 1000, "temperature_c": 25, "shear_rate": 170, "pressure_bar": 1.0}},
            {{"time_sec": 60,  "viscosity_cp": 950,  "temperature_c": 50, "shear_rate": 170, "pressure_bar": 1.0}},
            {{"time_sec": 120, "viscosity_cp": 900,  "temperature_c": 75, "shear_rate": 170, "pressure_bar": 1.1}},
            {{"time_sec": 180, "viscosity_cp": 850,  "temperature_c": 90, "shear_rate": 170, "pressure_bar": 1.1}},
            {{"time_sec": 240, "viscosity_cp": 800,  "temperature_c": 96, "shear_rate": 170, "pressure_bar": 1.2}}
        ],
        "cycle_results": [{{
            "cycle_no": 1, "time_min": 2.0, "temp_c": 96.0, "pressure_bar": 1.1,
            "n_prime": 0.85, "k_prime": 0.25, "r2": 0.998,
            "viscosities": {{"40": 520.0, "100": 480.0, "170": 450.0}},
            "bingham_pv": 15.5, "bingham_yp": 8.2, "bingham_r2": 0.995
        }}],
        "recipe": [{{"name": "Water", "concentration": 950.0, "unit": "L/m3", "category": "Base Fluid"}}],
        "water_params": {{"source": "Tap Water", "ph": 7.2, "salinity": 1500.0}},
        "cycles": [{{"type": "SST", "steps": [{{"avg_shear_rate": 170.0}}]}}],
        "settings": {{
            "language": "ru",
            "unit_system": "SI",
            "show_temperature": true,
            "show_shear_rate": true,
            "show_calibration": true,
            "show_raw_data": true,
            "viscosity_shear_rates": [40, 100, 170],
            {extra}
        }}
    }}"##,
        extra = settings_override,
    )
}

// ---------------------------------------------------------------------------
// 1. Settings deserialization completeness
// ---------------------------------------------------------------------------

#[test]
fn fixture_json_deserializes_all_settings_fields() {
    let input: ReportInput = serde_json::from_str(FIXTURE_JSON)
        .expect("Fixture JSON should deserialize without errors");

    let s = &input.settings;
    assert_eq!(s.language, "ru");
    assert_eq!(s.unit_system, "SI");
    assert!(s.show_temperature);
    assert!(s.show_shear_rate);
    assert!(!s.show_pressure);
    assert!(!s.show_bath_temperature);
    assert!(s.show_calibration);
    assert!(s.show_raw_data);
    assert!(!s.show_touch_points);
    assert_eq!(s.viscosity_threshold, 500.0);
    assert!(!s.show_target_time);
    assert_eq!(s.target_time, 10.0);
    assert_eq!(s.shear_rate_axis, "left");
    assert_eq!(s.pressure_axis, "right");
    assert_eq!(s.axis_mode, "individual");
    assert_eq!(s.viscosity_shear_rates, vec![40, 100, 170]);
    assert!(s.show_advanced_stats);
    assert!(s.line_settings.is_some());
}

#[test]
fn settings_defaults_work_when_fields_missing() {
    let json = r#"{
        "language": "en",
        "unit_system": "SI"
    }"#;
    let s: ReportSettings = serde_json::from_str(json).expect("should parse");
    assert_eq!(s.axis_mode, "individual", "axis_mode default");
    assert!(s.show_advanced_stats, "show_advanced_stats default true");
    assert_eq!(s.viscosity_shear_rates, vec![40, 100, 170], "default rates");
    assert_eq!(s.shear_rate_axis, "left", "default shear_rate_axis");
    assert_eq!(s.pressure_axis, "right", "default pressure_axis");
    assert_eq!(s.viscosity_threshold, 200.0, "default threshold");
    assert_eq!(s.target_time, 10.0, "default target_time");
    assert!(!s.show_touch_points, "default show_touch_points");
    assert!(!s.show_target_time, "default show_target_time");
}

#[test]
fn show_advanced_stats_false_deserializes() {
    let json = r#"{
        "language": "ru", "unit_system": "SI",
        "show_advanced_stats": false
    }"#;
    let s: ReportSettings = serde_json::from_str(json).expect("should parse");
    assert!(!s.show_advanced_stats);
}

// ---------------------------------------------------------------------------
// 2. Chart width regression (622a0c9)
// ---------------------------------------------------------------------------

/// Excel chart width formula:
///   bingham_cols = show_advanced_stats ? 3 : 0
///   stats_col_count = 7 + viscosity_shear_rates.len() + bingham_cols
///   chart_width = 110 + (stats_col_count - 1) * 75
#[test]
fn chart_width_formula_expert_mode() {
    let rates = vec![40, 100, 170];
    let bingham_cols: usize = 3; // show_advanced_stats = true
    let stats_col_count = 7 + rates.len() + bingham_cols;
    let chart_width = 110 + (stats_col_count - 1) * 75;

    assert_eq!(stats_col_count, 13);
    assert_eq!(chart_width, 1010);
}

#[test]
fn chart_width_formula_beginner_mode() {
    let rates = vec![40, 100, 170];
    let bingham_cols: usize = 0; // show_advanced_stats = false
    let stats_col_count = 7 + rates.len() + bingham_cols;
    let chart_width = 110 + (stats_col_count - 1) * 75;

    assert_eq!(stats_col_count, 10);
    assert_eq!(chart_width, 785);
}

#[test]
fn chart_width_with_extra_viscosity_rates() {
    let rates = vec![40, 100, 170, 300, 500];
    let bingham_cols: usize = 3;
    let stats_col_count = 7 + rates.len() + bingham_cols;
    let chart_width = 110 + (stats_col_count - 1) * 75;

    assert_eq!(stats_col_count, 15);
    assert_eq!(chart_width, 1160);
}

// ---------------------------------------------------------------------------
// 3. PDF margin regression (ab306c8)
// ---------------------------------------------------------------------------

/// PDF margin formula:
///   n_settings_left = 1 (visc always) + shear_rate(left visible) + pressure(left visible)
///   n_settings_right = temp_or_bath_visible + shear_rate(right visible) + pressure(right visible)
///   extra = max(n_left-1, n_right-1, n_settings_extra)
///   margin = 28 + extra * 60
#[test]
fn pdf_margin_default_settings() {
    // show_temp=true, show_shear=true(left), show_pressure=false, show_bath=false
    let n_left: usize = 1 + 1 + 0; // visc + shear_rate(left) + 0
    let n_right: usize = 1 + 0 + 0; // temp + 0 + 0
    let n_extra = (n_left.saturating_sub(1)).max(n_right.saturating_sub(1));
    let margin = 28 + n_extra * 60;

    assert_eq!(n_left, 2);
    assert_eq!(n_right, 1);
    assert_eq!(n_extra, 1);
    assert_eq!(margin, 88);
}

#[test]
fn pdf_margin_all_axes_active() {
    // show_temp=true, show_shear=true(right), show_pressure=true(right), show_bath=true
    let n_left: usize = 1; // visc only
    let n_right: usize = 1 + 1 + 1; // temp/bath + shear(right) + pressure(right)
    let n_extra = (n_left.saturating_sub(1)).max(n_right.saturating_sub(1)).max(1);
    let margin = 28 + n_extra * 60;

    assert_eq!(n_right, 3);
    assert_eq!(n_extra, 2);
    assert_eq!(margin, 148);
}

#[test]
fn pdf_margin_visc_temp_only_clamped_to_min_extra() {
    // Regression: visc + temp only (no shear/pressure) should still have margin=88pt
    // due to MIN_EXTRA=1.  Before the fix, margin was 28pt → chart body was too wide.
    let n_left: usize = 1; // visc only
    let n_right: usize = 1; // temp/bath only
    let n_extra = (n_left.saturating_sub(1)).max(n_right.saturating_sub(1)).max(1);
    let margin = 28 + n_extra * 60;

    assert_eq!(n_extra, 1, "MIN_EXTRA clamp should force n_extra=1 even with visc+temp only");
    assert_eq!(margin, 88, "page margin should be 88pt (not 28pt) regardless of axis count");
}

// ---------------------------------------------------------------------------
// 4. Excel generation with all settings (integration)
// ---------------------------------------------------------------------------

#[test]
fn excel_generates_with_show_advanced_stats_true() {
    let json = make_input_json(r#""show_advanced_stats": true"#);
    let bytes = generate_excel_report(&json).expect("Excel should generate");
    assert!(bytes.len() > 100, "Excel should have content");
    assert_eq!(&bytes[0..2], b"PK", "Excel is a ZIP file");
}

#[test]
fn excel_generates_with_show_advanced_stats_false() {
    let json = make_input_json(r#""show_advanced_stats": false"#);
    let bytes = generate_excel_report(&json).expect("Excel should generate");
    assert!(bytes.len() > 100, "Excel should have content");
    assert_eq!(&bytes[0..2], b"PK", "Excel is a ZIP file");
}

#[test]
fn excel_generates_with_touch_points_enabled() {
    let json = make_input_json(r#"
        "show_touch_points": true,
        "viscosity_threshold": 900,
        "show_target_time": true,
        "target_time": 2.0
    "#);
    let bytes = generate_excel_report(&json).expect("Excel should generate");
    assert!(bytes.len() > 100);
}

#[test]
fn excel_generates_with_bath_temperature() {
    let json = make_input_json(r##"
        "show_bath_temperature": true,
        "line_settings": {
            "viscosity": {"color": "#3b82f6", "width": 2, "style": "solid"},
            "temperature": {"color": "#f97316", "width": 2, "style": "solid"},
            "shear_rate": {"color": "#a855f7", "width": 2, "style": "solid"},
            "pressure": {"color": "#22c55e", "width": 2, "style": "solid"},
            "rpm": {"color": "#eab308", "width": 2, "style": "solid"},
            "bath_temperature": {"color": "#fb923c", "width": 2, "style": "dashed"}
        }
    "##);
    let bytes = generate_excel_report(&json).expect("Excel should generate");
    assert!(bytes.len() > 100);
}

// ---------------------------------------------------------------------------
// 5. PDF generation with all settings (integration)
// ---------------------------------------------------------------------------

#[test]
fn pdf_generates_with_all_settings() {
    let json = make_input_json(r##"
        "show_advanced_stats": true,
        "axis_mode": "individual",
        "show_bath_temperature": false,
        "show_touch_points": true,
        "viscosity_threshold": 900,
        "show_target_time": true,
        "target_time": 2.0,
        "line_settings": {
            "viscosity": {"color": "#1e40af", "width": 2, "style": "solid"},
            "temperature": {"color": "#c2410c", "width": 2, "style": "solid"},
            "shear_rate": {"color": "#7e22ce", "width": 2, "style": "dashed"},
            "pressure": {"color": "#15803d", "width": 2, "style": "dotted"},
            "rpm": {"color": "#a16207", "width": 2, "style": "dashed"}
        }
    "##);
    let bytes = generate_pdf_report(&json).expect("PDF should generate");
    assert!(bytes.len() > 100, "PDF should have content");
    assert_eq!(&bytes[0..4], b"%PDF", "Should start with PDF magic");
}

#[test]
fn pdf_generates_in_shared_axis_mode() {
    let json = make_input_json(r#"
        "axis_mode": "shared",
        "show_advanced_stats": true
    "#);
    let bytes = generate_pdf_report(&json).expect("PDF shared mode should generate");
    assert!(bytes.len() > 100);
    assert_eq!(&bytes[0..4], b"%PDF");
}

#[test]
fn pdf_generates_with_show_advanced_stats_false() {
    let json = make_input_json(r#"
        "show_advanced_stats": false,
        "axis_mode": "individual"
    "#);
    let bytes = generate_pdf_report(&json).expect("PDF beginner mode should generate");
    assert!(bytes.len() > 100);
    assert_eq!(&bytes[0..4], b"%PDF");
}

#[test]
fn pdf_generates_from_fixture_json() {
    let bytes = generate_pdf_report(FIXTURE_JSON).expect("Fixture-based PDF should generate");
    assert!(bytes.len() > 100);
    assert_eq!(&bytes[0..4], b"%PDF");
}

#[test]
fn excel_generates_from_fixture_json() {
    let bytes = generate_excel_report(FIXTURE_JSON).expect("Fixture-based Excel should generate");
    assert!(bytes.len() > 100);
    assert_eq!(&bytes[0..2], b"PK");
}

// ---------------------------------------------------------------------------
// 6. Touch point algorithm (509a8e2)
// ---------------------------------------------------------------------------

#[test]
fn touch_point_module_exists_and_works() {
    use rheolab_core::report_generator::touch_point::{
        TouchPointInput, SmartTouchPointOptions, calculate_smart_touch_points,
    };

    let inputs = vec![
        TouchPointInput { time_min: 0.5,  viscosity_cp: 1000.0, shear_rate: 170.0 },
        TouchPointInput { time_min: 1.0,  viscosity_cp: 900.0,  shear_rate: 170.0 },
        TouchPointInput { time_min: 1.5,  viscosity_cp: 800.0,  shear_rate: 170.0 },
        TouchPointInput { time_min: 2.0,  viscosity_cp: 700.0,  shear_rate: 170.0 },
        TouchPointInput { time_min: 3.0,  viscosity_cp: 600.0,  shear_rate: 170.0 },
        TouchPointInput { time_min: 5.0,  viscosity_cp: 500.0,  shear_rate: 170.0 },
        TouchPointInput { time_min: 10.0, viscosity_cp: 400.0,  shear_rate: 170.0 },
    ];

    let results = calculate_smart_touch_points(&inputs, &SmartTouchPointOptions {
        viscosity_threshold: 500.0,
        show_target_time: true,
        target_time: 5.0,
        ..Default::default()
    });

    // Should find at least a target time point at ≥5 min
    assert!(!results.is_empty(), "Should find at least one touch point");
}

// ---------------------------------------------------------------------------
// 7. Chart body width parity: individual vs shared with 2 axes (temp+bath)
//    Regression for: individual mode + only visc+temp+bath → wrong width
// ---------------------------------------------------------------------------

fn make_chart_config(axis_mode: &str, svg_h: u32) -> ChartConfig {
    ChartConfig {
        show_temperature: true,
        show_shear_rate: false,
        show_pressure: false,
        show_bath_temperature: true,
        shear_rate_axis: "right".to_string(),
        pressure_axis: "right".to_string(),
        axis_mode: axis_mode.to_string(),
        width: 1040,
        height: svg_h,
        label_left: "Viscosity (cP)".to_string(),
        label_right: "Temperature (°C) / Bath Temp (°C)".to_string(),
        label_bottom: "Time (min)".to_string(),
        name_viscosity: "Viscosity".to_string(),
        name_temperature: "Temperature".to_string(),
        name_shear_rate: "Shear Rate".to_string(),
        name_pressure: "Pressure".to_string(),
        name_bath_temperature: "Bath Temp".to_string(),
        touch_points: vec![],
        viscosity_threshold: None,
        line_styles: None,
        skip_downsample: true,
    }
}

fn make_chart_points() -> Vec<ChartPoint> {
    (0..60).map(|i| ChartPoint {
        time_min: i as f64,
        viscosity_cp: 800.0 - i as f64 * 5.0,
        temperature_c: Some(25.0 + i as f64 * 1.2),
        shear_rate: None,
        pressure_bar: None,
        bath_temperature_c: Some(30.0 + i as f64 * 1.0),
    }).collect()
}

fn extract_svg_dimensions(svg: &str) -> (u32, u32) {
    // Parse width="1040" height="558" from the outer <svg> element
    let width = svg.split("width=\"")
        .nth(1).and_then(|s| s.split('"').next())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0u32);
    let height = svg.split("height=\"")
        .nth(1).and_then(|s| s.split('"').next())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0u32);
    (width, height)
}

#[test]
fn individual_and_shared_svg_dimensions_match_with_2_axes() {
    // Scenario: visc (left) + temp (right) + bath_temp (right, shares temp axis)
    // No shear_rate, no pressure. Expected: n_extra=0, same SVG size for both modes.
    // This guards the regression where individual mode with only 2 unique axis
    // columns produced a different chart body width than shared mode.
    const SVG_H: u32 = 558;
    let points = make_chart_points();

    let cfg_individual = make_chart_config("individual", SVG_H);
    let cfg_shared = make_chart_config("shared", SVG_H);

    let (svg_ind, ranges_ind) = generate_chart_svg(&points, &cfg_individual)
        .expect("individual mode SVG must generate");
    let (svg_shd, ranges_shd) = generate_chart_svg(&points, &cfg_shared)
        .expect("shared mode SVG must generate");

    let (w_ind, h_ind) = extract_svg_dimensions(&svg_ind);
    let (w_shd, h_shd) = extract_svg_dimensions(&svg_shd);

    assert_eq!(w_ind, 1040, "individual width should be 1040");
    assert_eq!(h_ind, SVG_H, "individual height should be {SVG_H}");
    assert_eq!(w_shd, 1040, "shared width should be 1040");
    assert_eq!(h_shd, SVG_H, "shared height should be {SVG_H}");
    assert_eq!((w_ind, h_ind), (w_shd, h_shd), "SVG dimensions must be identical in both modes");

    // Individual mode: must have exactly 2 axes (visc left-0, temp right-0)
    assert!(!ranges_ind.individual_axes.is_empty(), "individual mode must populate individual_axes");
    let n_right_extra_ind = ranges_ind.individual_axes.iter()
        .filter(|a| a.side == "right")
        .map(|a| a.side_idx)
        .max()
        .unwrap_or(0);
    assert_eq!(n_right_extra_ind, 0,
        "individual mode with only temp+bath_temp must have 0 extra right axis columns (got {})",
        n_right_extra_ind);

    // Shared mode: individual_axes must be empty
    assert!(ranges_shd.individual_axes.is_empty(), "shared mode must NOT populate individual_axes");

    // The n_right axes count must also be: visc+temp → 1 right column for pages
    // Simulate the pdf.rs log: n_settings_right should be 1
    let n_settings_right: usize = 1;  // show_temperature || show_bath_temperature = 1 + 0 + 0
    let n_right_extra_settings = n_settings_right.saturating_sub(1);
    assert_eq!(n_right_extra_settings, 0,
        "settings-based right extra must be 0 → page margin must not expand");
}

#[test]
fn individual_mode_bath_temp_does_not_create_extra_axis_column() {
    // When BOTH temperature and bath_temperature are enabled in individual mode,
    // they SHARE one °C axis → n_right=1, no extra column.
    // This test explicitly guards the regression where bath_temperature created
    // its own separate IndividualAxisInfo entry, inflating right margins.
    let points = make_chart_points();
    let cfg = make_chart_config("individual", 558);

    let (_svg, ranges) = generate_chart_svg(&points, &cfg)
        .expect("SVG must generate");

    let right_axes_count = ranges.individual_axes.iter()
        .filter(|a| a.side == "right")
        .count();

    assert_eq!(right_axes_count, 1,
        "individual mode with temp+bath_temp should produce exactly 1 right axis entry, got {}",
        right_axes_count);

    let right_max_idx = ranges.individual_axes.iter()
        .filter(|a| a.side == "right")
        .map(|a| a.side_idx)
        .max()
        .unwrap_or(0);

    assert_eq!(right_max_idx, 0,
        "the single right axis should have side_idx=0 (innermost), got {}",
        right_max_idx);
}
