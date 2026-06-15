//! Determinism + assembly-shape tests for the template builders.

use super::super::super::types::{CycleInfo, DataPoint, ReportMetadata, ReportSettings, StepInfo};
use super::*;

fn minimal_report_input() -> ReportInput {
    ReportInput {
        raw_data: vec![
            DataPoint {
                time_sec: 0.0,
                viscosity_cp: 100.0,
                temperature_c: Some(25.0),
                shear_rate: Some(100.0),
                shear_stress_pa: None,
                speed_rpm: None,
                pressure_bar: None,
                bath_temperature_c: None,
            },
            DataPoint {
                time_sec: 60.0,
                viscosity_cp: 150.0,
                temperature_c: Some(50.0),
                shear_rate: Some(75.0),
                shear_stress_pa: None,
                speed_rpm: None,
                pressure_bar: None,
                bath_temperature_c: None,
            },
        ],
        metadata: ReportMetadata {
            filename: "test.pdf".to_string(),
            test_id: Some("T-1".to_string()),
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

fn input_with_rheology_cycle() -> ReportInput {
    let mut input = minimal_report_input();
    input.cycles = vec![CycleInfo {
        cycle_type: "API".to_string(),
        steps: vec![
            StepInfo {
                avg_shear_rate: 75.0,
            },
            StepInfo {
                avg_shear_rate: 50.0,
            },
            StepInfo {
                avg_shear_rate: 25.0,
            },
        ],
    }];
    input
}

/// Determinism: running `generate_typst_template` twice must produce
/// byte-identical Typst source — no wall-clock values, no HashMap
/// iteration order, nothing else that could leak non-determinism.
#[test]
fn generate_typst_template_is_deterministic() {
    let input = minimal_report_input();
    let files = std::collections::HashMap::new();
    let a = generate_typst_template(&input, &files, false, None, None);
    let b = generate_typst_template(&input, &files, false, None, None);
    assert_eq!(a.len(), b.len(), "length drift: {} vs {}", a.len(), b.len());
    assert_eq!(a, b, "non-deterministic template output");
}

/// Refactor guarantee: the splitting of `generate_typst_template` into
/// `build_typst_globals + build_single_experiment_body` must be a pure
/// concat — the final string must match character-for-character what the
/// single monolithic function used to produce.
///
/// This test pins the Phase 1.D refactor against drift: if a future
/// change to the globals block or body block diverges, we want a hard
/// failure before anyone ships a regressed PDF.
#[test]
fn generate_typst_template_equals_globals_plus_body_concat() {
    let input = minimal_report_input();
    let files = std::collections::HashMap::new();
    let has_chart = false;
    let total_pages = if has_chart { 2 } else { 1 };
    let is_ru = input.settings.language == "ru";

    let expected = generate_typst_template(&input, &files, has_chart, None, None);
    let reassembled = format!(
        "{}{}",
        build_typst_globals(&input, total_pages),
        build_single_experiment_body(&input, has_chart, None, None, is_ru),
    );
    assert_eq!(
        expected, reassembled,
        "globals + body concat diverges from generate_typst_template output"
    );
}

/// The body must never emit globals: no `#set page`, no `#let
/// section_header`, no `#let report_header` / `#let report_footer`.
/// These belong to [`build_typst_globals`] and get emitted once per
/// document by the comparison assembler.
#[test]
fn body_does_not_emit_globals() {
    let input = minimal_report_input();
    let body = build_single_experiment_body(&input, false, None, None, false);
    // Tokens that must live in globals, not body.
    assert!(!body.contains("#set page("), "body leaks '#set page('");
    assert!(
        !body.contains("#let section_header"),
        "body leaks section_header"
    );
    assert!(
        !body.contains("#let report_header"),
        "body leaks report_header"
    );
    assert!(
        !body.contains("#let report_footer"),
        "body leaks report_footer"
    );
    assert!(
        !body.contains("#let label(content)"),
        "body leaks label helper"
    );
}

#[test]
fn body_prints_rheology_data_source() {
    let mut input = minimal_report_input();
    input.settings.rheology_source = "instrument".to_string();

    let body = build_single_experiment_body(&input, false, None, None, true);

    assert!(
        body.contains("Источник данных:"),
        "report must show the rheology data source label"
    );
    assert!(
        body.contains("Прибор"),
        "instrument source must be visible in the report"
    );
}

#[test]
fn body_hides_rheology_cycle_steps_for_instrument_source() {
    let mut input = input_with_rheology_cycle();
    input.settings.rheology_source = "instrument".to_string();

    let body = build_single_experiment_body(&input, false, None, None, true);

    assert!(
        body.contains("Источник данных:"),
        "instrument report must still show the rheology data source"
    );
    assert!(
        !body.contains("Скорость сдвига"),
        "instrument rheology must not show UI-detected cycle steps"
    );
    assert!(
        !body.contains("75 - 50 - 25"),
        "instrument rheology must not show the program cycle ramp"
    );
}

#[test]
fn body_keeps_rheology_cycle_steps_for_program_source() {
    let mut input = input_with_rheology_cycle();
    input.settings.rheology_source = "program".to_string();

    let body = build_single_experiment_body(&input, false, None, None, true);

    assert!(
        body.contains("Скорость сдвига"),
        "program-calculated rheology should show the selected calculation steps"
    );
    assert!(
        body.contains("75 - 50 - 25"),
        "program-calculated rheology should show the cycle ramp"
    );
}

/// Globals must contain exactly the expected tokens so comparison
/// report can rely on them.
#[test]
fn globals_contain_required_tokens() {
    let input = minimal_report_input();
    let globals = build_typst_globals(&input, 2);
    assert!(
        globals.contains("#set page(paper: \"a4\""),
        "missing base page set"
    );
    assert!(
        globals.contains("#let section_header"),
        "missing section_header helper"
    );
    assert!(
        globals.contains("#let label(content)"),
        "missing label helper"
    );
    assert!(
        globals.contains("#let report_header"),
        "missing report_header"
    );
    assert!(
        globals.contains("#let report_footer"),
        "missing report_footer"
    );
    assert!(
        globals.contains("header: report_header"),
        "missing header binding on page"
    );
}

#[test]
fn pdf_template_renders_report_metadata_into_header_and_passport() {
    let mut input = minimal_report_input();
    input.settings.language = "en".to_string();
    input.metadata.filename = "Golden_Metadata.csv".to_string();
    input.metadata.company_name = Some("RheoLab QA".to_string());
    input.metadata.test_id = Some("GOLDEN-42".to_string());
    input.metadata.operator_name = Some("Operator A".to_string());
    input.metadata.laboratory_name = Some("Main Lab".to_string());
    input.metadata.field_name = Some("North Field".to_string());
    input.metadata.well_number = Some("W-42".to_string());
    input.metadata.instrument_type = Some("Grace M5600".to_string());

    let globals = build_typst_globals(&input, 1);
    for expected in ["RheoLab QA", "Frac Fluid Test Report", "ID: GOLDEN-42"] {
        assert!(
            globals.contains(expected),
            "PDF globals should contain metadata token {expected:?}; got:\n{globals}"
        );
    }

    let body = build_single_experiment_body(&input, false, None, None, false);
    for expected in [
        "Test Passport",
        "Golden\\_Metadata.csv",
        "Operator A",
        "Main Lab",
        "North Field",
        "W-42",
        "Grace M5600",
    ] {
        assert!(
            body.contains(expected),
            "PDF passport should contain metadata token {expected:?}; got:\n{body}"
        );
    }
}
