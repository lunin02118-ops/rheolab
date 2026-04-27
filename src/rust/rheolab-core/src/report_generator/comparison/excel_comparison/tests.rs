//! Tests for the comparison-XLSX writer.

use super::*;
use super::super::super::types::{DataPoint, ReportInput, ReportMetadata, ReportSettings};
use super::super::types::{
    ComparisonChartConfig, ComparisonExperimentEntry, ComparisonMetrics,
    SectionToggles, TouchPointConfig,
};
use super::super::EXCEL_SHEET_NAME_MAX_LEN;

fn mk_point(t: f64, v: f64) -> DataPoint {
    DataPoint {
        time_sec: t, viscosity_cp: v,
        temperature_c: None, shear_rate: None, shear_stress_pa: None,
        speed_rpm: None, pressure_bar: None, bath_temperature_c: None,
    }
}

fn mk_input(test_id: &str, points: Vec<DataPoint>) -> ReportInput {
    ReportInput {
        raw_data: points,
        metadata: ReportMetadata { filename: format!("{}.dat", test_id), test_id: Some(test_id.into()), ..Default::default() },
        cycle_results: vec![], recipe: vec![], water_params: None, cycles: vec![],
        settings: ReportSettings::default(),
        chart_image_base64: None, axis_values: None,
    }
}

fn mk_entry(id: &str, display_name: &str, input: ReportInput) -> ComparisonExperimentEntry {
    ComparisonExperimentEntry {
        id: id.into(),
        display_name: display_name.into(),
        report_input: input,
        section_toggles: SectionToggles::default(),
    }
}

fn mk_comparison_input(entries: Vec<ComparisonExperimentEntry>) -> ComparisonReportInput {
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
        experiments: entries,
    }
}

#[test]
fn rejects_empty_experiments() {
    let input = mk_comparison_input(vec![]);
    let err = generate_comparison_excel(&input).unwrap_err();
    assert!(err.contains("at least one experiment"));
}

#[test]
fn produces_valid_xlsx_bytes() {
    let e1 = mk_entry("e1", "Chandler", mk_input("T-1", vec![mk_point(0.0, 100.0), mk_point(300.0, 250.0)]));
    let input = mk_comparison_input(vec![e1]);
    let bytes = generate_comparison_excel(&input).expect("generation");
    assert_eq!(&bytes[0..4], b"PK\x03\x04", "should be valid ZIP/XLSX");
    assert!(bytes.len() > 1000);
}

#[test]
fn deterministic_across_runs() {
    let e1 = mk_entry("e1", "A", mk_input("T-1", vec![mk_point(0.0, 100.0)]));
    let e2 = mk_entry("e2", "B", mk_input("T-2", vec![mk_point(0.0, 200.0)]));
    let input = mk_comparison_input(vec![e1, e2]);
    let a = generate_comparison_excel(&input).unwrap();
    let b = generate_comparison_excel(&input).unwrap();
    assert_eq!(a, b, "generation must be byte-deterministic");
}

#[test]
fn three_experiments_produce_workbook_with_six_sheets() {
    // _ChartData (hidden) + Overlap Chart + 3 experiments + DebugInfo = 6 sheets
    let entries = vec![
        mk_entry("e1", "A", mk_input("T-1", vec![mk_point(0.0, 100.0), mk_point(60.0, 200.0)])),
        mk_entry("e2", "B", mk_input("T-2", vec![mk_point(0.0, 150.0), mk_point(60.0, 250.0)])),
        mk_entry("e3", "C", mk_input("T-3", vec![mk_point(0.0, 180.0), mk_point(60.0, 270.0)])),
    ];
    let input = mk_comparison_input(entries);
    let bytes = generate_comparison_excel(&input).expect("generation");
    let as_str = String::from_utf8_lossy(&bytes);
    for n in 1..=6 {
        let needle = format!("xl/worksheets/sheet{}.xml", n);
        assert!(
            as_str.contains(&needle),
            "expected workbook to contain {}",
            needle,
        );
    }
    // _ChartData + Overlap Chart + 3 exps + DebugInfo = 6. No sheet7.
    assert!(!as_str.contains("xl/worksheets/sheet7.xml"));
}

#[test]
fn duplicate_display_names_are_deduplicated() {
    let entries = vec![
        mk_entry("e1", "Report", mk_input("T-1", vec![mk_point(0.0, 100.0)])),
        mk_entry("e2", "Report", mk_input("T-2", vec![mk_point(0.0, 150.0)])),
    ];
    let input = mk_comparison_input(entries);
    let bytes = generate_comparison_excel(&input).expect("generation");
    // Having duplicate sheet names would make save_to_buffer() fail —
    // reaching this point confirms dedupe worked.
    assert!(bytes.len() > 1000);
}

#[test]
fn experiment_name_with_forbidden_chars_is_sanitised() {
    let entries = vec![
        mk_entry("e1", "Report/1[SST]:*?", mk_input("T-1", vec![mk_point(0.0, 100.0)])),
    ];
    let input = mk_comparison_input(entries);
    let bytes = generate_comparison_excel(&input).expect("generation");
    assert!(bytes.len() > 1000);
}

#[test]
fn overlong_name_truncated_to_excel_31_char_limit() {
    let long_name = "Very long experiment name that definitely exceeds the 31-char Excel limit";
    assert!(long_name.len() > EXCEL_SHEET_NAME_MAX_LEN);
    let entries = vec![
        mk_entry("e1", long_name, mk_input("T-1", vec![mk_point(0.0, 100.0)])),
    ];
    let input = mk_comparison_input(entries);
    let bytes = generate_comparison_excel(&input).expect("generation");
    assert!(bytes.len() > 1000);
}

#[test]
fn overlap_chart_sheet_has_chart_xml() {
    // 3 experiments with 10 points each → Overlap Chart sheet must contain
    // a native Excel chart (chart1.xml inside the ZIP).
    let entries: Vec<_> = (0..3).map(|i| {
        let points: Vec<DataPoint> = (0..10)
            .map(|j| mk_point(j as f64 * 60.0, 100.0 + j as f64 * 30.0 + i as f64 * 50.0))
            .collect();
        mk_entry(&format!("e{}", i), &format!("Exp {}", i + 1), mk_input(&format!("T-{}", i + 1), points))
    }).collect();
    let input = mk_comparison_input(entries);
    let bytes = generate_comparison_excel(&input).expect("generation");
    let as_str = String::from_utf8_lossy(&bytes);
    // rust_xlsxwriter stores charts as xl/charts/chart1.xml inside the ZIP.
    assert!(as_str.contains("xl/charts/chart1.xml"),
        "Overlap Chart sheet must embed a native Excel chart");
}

#[test]
fn overlap_chart_with_threshold_generates_successfully() {
    let entries = vec![
        mk_entry("e1", "A", mk_input("T-1", vec![mk_point(0.0, 100.0), mk_point(600.0, 500.0)])),
        mk_entry("e2", "B", mk_input("T-2", vec![mk_point(0.0, 200.0), mk_point(600.0, 400.0)])),
    ];
    let mut input = mk_comparison_input(entries);
    input.comparison_chart.touch_point.enabled = true;
    input.comparison_chart.touch_point.viscosity_threshold = 300.0;
    let bytes = generate_comparison_excel(&input).expect("generation with threshold");
    // Chart XML must be present (threshold adds an extra series).
    let as_str = String::from_utf8_lossy(&bytes);
    assert!(as_str.contains("xl/charts/chart1.xml"),
        "chart must be embedded even with threshold");
    // File should be larger than without threshold (extra series + data).
    let bytes_no_thresh = {
        let mut inp2 = input.clone();
        inp2.comparison_chart.touch_point.enabled = false;
        generate_comparison_excel(&inp2).unwrap()
    };
    assert!(bytes.len() > bytes_no_thresh.len(),
        "threshold variant ({}) must be larger than no-threshold ({})",
        bytes.len(), bytes_no_thresh.len());
}

#[test]
fn touch_point_markers_generate_for_crossing_data() {
    // Build ramp data where viscosity rises through 300 cP threshold.
    let ramp = |offset: f64| -> Vec<DataPoint> {
        (0..20).map(|j| mk_point(
            j as f64 * 60.0,
            100.0 + offset + j as f64 * 30.0,
        )).collect()
    };
    let entries = vec![
        mk_entry("e1", "Exp A", mk_input("T-1", ramp(0.0))),
        mk_entry("e2", "Exp B", mk_input("T-2", ramp(50.0))),
    ];
    let mut input = mk_comparison_input(entries);
    input.comparison_chart.touch_point.enabled = true;
    input.comparison_chart.touch_point.viscosity_threshold = 300.0;
    let bytes_tp = generate_comparison_excel(&input).expect("generation with touch points");

    // With touch points disabled, file is smaller (no marker series).
    let mut input_no_tp = input.clone();
    input_no_tp.comparison_chart.touch_point.enabled = false;
    let bytes_no_tp = generate_comparison_excel(&input_no_tp).unwrap();
    assert!(bytes_tp.len() > bytes_no_tp.len(),
        "touch-point markers must add data: {} vs {}",
        bytes_tp.len(), bytes_no_tp.len());
}

// ── Secondary metric tests ──────────────────────────────────────────

fn mk_point_full(t: f64, v: f64, temp: f64, sr: f64, press: f64, bath: f64) -> DataPoint {
    DataPoint {
        time_sec: t, viscosity_cp: v,
        temperature_c: Some(temp), shear_rate: Some(sr),
        shear_stress_pa: None, speed_rpm: None,
        pressure_bar: Some(press), bath_temperature_c: Some(bath),
    }
}

fn mk_input_full(test_id: &str, points: Vec<DataPoint>) -> ReportInput {
    ReportInput {
        raw_data: points,
        metadata: ReportMetadata { filename: format!("{}.dat", test_id), test_id: Some(test_id.into()), ..Default::default() },
        cycle_results: vec![], recipe: vec![], water_params: None, cycles: vec![],
        settings: ReportSettings::default(),
        chart_image_base64: None, axis_values: None,
    }
}

fn mk_full_entries() -> Vec<ComparisonExperimentEntry> {
    let ramp = |offset: f64| -> Vec<DataPoint> {
        (0..10).map(|j| mk_point_full(
            j as f64 * 60.0,
            100.0 + offset + j as f64 * 30.0,
            25.0 + j as f64 * 0.5,   // temperature
            10.0 + offset * 0.1,      // shear_rate
            1.0 + j as f64 * 0.1,     // pressure
            20.0 + j as f64 * 0.3,    // bath_temperature
        )).collect()
    };
    vec![
        mk_entry("e1", "Exp A", mk_input_full("T-1", ramp(0.0))),
        mk_entry("e2", "Exp B", mk_input_full("T-2", ramp(50.0))),
    ]
}

#[test]
fn secondary_shear_rate_on_right_produces_larger_file() {
    let entries = mk_full_entries();
    let mut input = mk_comparison_input(entries.clone());
    let bytes_visc_only = generate_comparison_excel(&input).expect("visc-only");

    // Enable shear_rate on the right axis (canonical UI key).
    input.comparison_chart.metrics.secondary = "shear_rate_s1".into();
    let bytes_with_sr = generate_comparison_excel(&input).expect("with shear_rate");

    assert!(bytes_with_sr.len() > bytes_visc_only.len(),
        "shear_rate secondary ({}) must produce larger file than visc-only ({})",
        bytes_with_sr.len(), bytes_visc_only.len());
}

#[test]
fn secondary_temperature_on_left_produces_larger_file() {
    let entries = mk_full_entries();
    let mut input = mk_comparison_input(entries.clone());
    let bytes_visc_only = generate_comparison_excel(&input).expect("visc-only");

    // Put temperature on the LEFT secondary.
    input.comparison_chart.metrics.left_secondary = "temperature_c".into();
    let bytes_with_temp = generate_comparison_excel(&input).expect("with temperature");

    assert!(bytes_with_temp.len() > bytes_visc_only.len(),
        "temperature secondary ({}) must produce larger file than visc-only ({})",
        bytes_with_temp.len(), bytes_visc_only.len());
}

#[test]
fn multiple_secondary_metrics_all_present() {
    let entries = mk_full_entries();
    let mut input = mk_comparison_input(entries.clone());

    // Place shear_rate and temperature as secondaries, pressure as tertiary.
    input.comparison_chart.metrics.left_secondary = "temperature_c".into();
    input.comparison_chart.metrics.secondary = "shear_rate_s1".into();
    input.comparison_chart.metrics.tertiary = "pressure_bar".into();

    let bytes = generate_comparison_excel(&input).expect("multi-metric");
    assert!(bytes.len() > 5000, "multi-metric file must be substantial: {}", bytes.len());

    // Visc-only baseline must be smaller.
    let mut input_base = input.clone();
    input_base.comparison_chart.metrics.left_secondary = "none".into();
    input_base.comparison_chart.metrics.secondary = "none".into();
    input_base.comparison_chart.metrics.tertiary = "none".into();
    let bytes_base = generate_comparison_excel(&input_base).expect("visc-only");

    assert!(bytes.len() > bytes_base.len(),
        "multi-metric ({}) must be larger than visc-only ({})",
        bytes.len(), bytes_base.len());
}

#[test]
fn canonical_keys_are_normalised_for_excel() {
    // Verify that canonical UI keys like "shear_rate_s1" and internal
    // keys like "shear_rate" produce identical workbook bytes.
    let entries = mk_full_entries();

    let mut input_canonical = mk_comparison_input(entries.clone());
    input_canonical.comparison_chart.metrics.secondary = "shear_rate_s1".into();

    let mut input_internal = mk_comparison_input(entries);
    input_internal.comparison_chart.metrics.secondary = "shear_rate".into();

    let bytes_canonical = generate_comparison_excel(&input_canonical).expect("canonical");
    let bytes_internal = generate_comparison_excel(&input_internal).expect("internal");

    assert_eq!(bytes_canonical, bytes_internal,
        "canonical and internal keys must produce identical output");
}

#[test]
fn individual_axis_mode_with_secondary_generates_successfully() {
    // "individual" axis_mode should still work — Excel always uses
    // combined axes, but the code must not crash.
    let entries = mk_full_entries();
    let mut input = mk_comparison_input(entries);
    input.comparison_chart.axis_mode = "individual".into();
    input.comparison_chart.metrics.secondary = "shear_rate_s1".into();
    input.comparison_chart.metrics.left_secondary = "temperature_c".into();
    let bytes = generate_comparison_excel(&input).expect("individual + secondary");
    assert!(bytes.len() > 1000);
}

#[test]
fn bath_temperature_secondary_produces_larger_file() {
    let entries = mk_full_entries();
    let mut input = mk_comparison_input(entries.clone());
    let bytes_base = generate_comparison_excel(&input).expect("base");

    input.comparison_chart.metrics.secondary = "bath_temperature_c".into();
    let bytes_bath = generate_comparison_excel(&input).expect("with bath temp");

    assert!(bytes_bath.len() > bytes_base.len(),
        "bath_temperature secondary ({}) must produce larger file than base ({})",
        bytes_bath.len(), bytes_base.len());
}
