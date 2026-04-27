//! PDF comparison report assembler (ADR-0010, Phase 1.E).
//!
//! Produces a PDF with:
//! 1. Page 1 — multi-experiment comparison chart + summary table.
//! 2. Pages 2..N+1 — one per-experiment body per page via
//!    [`super::super::pdf::build_single_experiment_body`].
//!
//! The whole document shares one Typst prelude (page rules, `#let` helpers,
//! document-wide header/footer) emitted once by
//! [`super::super::pdf::build_typst_globals`].
//!
//! # Module layout
//!
//! Split into focused submodules so each section stays under ~500 LOC:
//!
//! | File | Responsibility |
//! |------|----------------|
//! | `mod.rs`            | Entry, orchestrator, integration tests, shared fixtures |
//! | `chart_page.rs`     | Page 1 — full-page landscape comparison chart           |
//! | `summary_page.rs`   | Page 2 — portrait summary table + touch-points block    |
//! | `touch_points.rs`   | Touch-point table builder + canonical metric-key map    |
//! | `chart_renderer.rs` | Multi-experiment chart SVG renderer                     |
//!
//! # PDF compilation is expensive
//!
//! Typst compilation takes ~5 s in debug, ~0.5 s in release.  Tests in this
//! module therefore only verify the **Typst source** (fast, string-level
//! checks).  End-to-end PDF bytes verification lives in Phase 1.H's
//! integration test, which is gated behind `#[cfg(test)]` + a feature flag.

use base64::prelude::*;
use std::collections::HashMap;

use super::super::pdf::{build_single_experiment_body, build_typst_globals};
use super::super::typst_renderer::compile_to_pdf;
use super::types::ComparisonReportInput;

mod chart_page;
mod chart_renderer;
mod summary_page;
mod touch_points;

use chart_page::build_chart_full_page;
use chart_renderer::render_comparison_chart;
use summary_page::build_summary_table_page;

/// Generate a comparison PDF report — returns the complete PDF byte stream.
pub fn generate_comparison_pdf(
    input: &ComparisonReportInput,
) -> Result<Vec<u8>, String> {
    if input.experiments.is_empty() {
        return Err("comparison report requires at least one experiment".to_string());
    }

    let (typst_src, files) = build_comparison_typst_source(input)?;
    // Debug dump: when `RHEOLAB_DEBUG_TYPST_DIR` points at a folder, write
    // the composed Typst source there so a developer can inspect the
    // markup before it hits the compiler.  Filename is driven by
    // `RHEOLAB_DEBUG_TYPST_NAME` (defaults to `comparison.typ`) so a
    // debug loop generating several PDFs can keep every variant.
    if let Ok(dir) = std::env::var("RHEOLAB_DEBUG_TYPST_DIR") {
        let name = std::env::var("RHEOLAB_DEBUG_TYPST_NAME")
            .unwrap_or_else(|_| "comparison.typ".to_string());
        let path = std::path::PathBuf::from(dir).join(name);
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, &typst_src);
    }
    compile_to_pdf(&typst_src, files)
}

/// Build the Typst source string + the auxiliary `files` map
/// (images referenced by `#image("name")`).  Split out so tests can
/// exercise the string-level contract without invoking the Typst compiler.
pub(crate) fn build_comparison_typst_source(
    input: &ComparisonReportInput,
) -> Result<(String, HashMap<String, Vec<u8>>), String> {
    let is_ru = input.language.trim().to_lowercase().starts_with("ru");
    let mut files: HashMap<String, Vec<u8>> = HashMap::new();

    // Decode & attach logo if the first experiment has one (document-wide
    // header is driven by the first experiment's metadata, same as
    // single-exp).  The assembler picks whichever experiment supplies a logo.
    let anchor_input = &input.experiments[0].report_input;
    let logo_source = input.company_logo_base64.as_ref()
        .or(anchor_input.metadata.company_logo_base64.as_ref());
    if let Some(logo_b64) = logo_source {
        let clean = logo_b64.split_once(',').map(|(_, s)| s).unwrap_or(logo_b64);
        if let Ok(bytes) = BASE64_STANDARD.decode(clean) {
            files.insert("logo.png".to_string(), bytes);
        }
    }

    // Build the comparison chart SVG and attach as `comparison_chart.svg`.
    let (chart_svg, chart_ranges, chart_config) = render_comparison_chart(input, is_ru)?;
    files.insert("comparison_chart.svg".to_string(), chart_svg.into_bytes());

    // ── Typst source assembly ──────────────────────────────────────────
    // Total pages = 1 chart (full-page) + 1 summary table + N per-experiment
    // bodies.  Each per-exp body may itself span 2+ pages, so this is a
    // *lower bound*; Typst auto-paginates so the footer's page counter
    // always renders correctly.
    let total_pages = 2 + input.experiments.len();

    // Globals — driven by the first experiment (for company name, etc.).
    // We temporarily override the anchor's raw_data-driven total_pages by
    // passing our own computation.  `build_typst_globals` just embeds the
    // number into the footer string so this is safe.
    let mut effective_anchor = anchor_input.clone();
    // Keep anchor's metadata for the header; company_name override if
    // the comparison payload supplies one.
    if let Some(name) = &input.company_name {
        effective_anchor.metadata.company_name = Some(name.clone());
    }
    let globals = build_typst_globals(&effective_anchor, total_pages);

    // ── Page 1: Full-page comparison chart (landscape) ─────────────────
    let chart_page = build_chart_full_page(input, is_ru, &chart_config, &chart_ranges);

    // ── Page 2: Summary table + touch points (portrait) ──────────────
    let summary_page = build_summary_table_page(input, is_ru);

    // ── Pages 3..N+2: per-experiment bodies ──────────────────────────
    let mut per_exp_blocks = String::new();
    for entry in &input.experiments {
        // Apply per-experiment section toggles.
        let mut per_exp = entry.report_input.clone();
        per_exp.settings.show_calibration = entry.section_toggles.show_calibration;
        per_exp.settings.show_raw_data    = entry.section_toggles.show_raw_data;
        if !entry.section_toggles.show_rheology {
            per_exp.cycle_results.clear();
            per_exp.cycles.clear();
        }

        // Each per-experiment body is prefixed with a pagebreak so it
        // starts on a fresh page; the first body starts after page 1.
        per_exp_blocks.push_str("\n#pagebreak()\n");
        per_exp_blocks.push_str(&build_single_experiment_body(
            &per_exp,
            /* has_chart = */ false,
            None,
            None,
            is_ru,
        ));
    }

    let typst_src = format!("{}{}{}{}", globals, chart_page, summary_page, per_exp_blocks);
    Ok((typst_src, files))
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use super::super::super::types::{DataPoint, ReportInput, ReportMetadata, ReportSettings};
    use super::super::types::{
        ComparisonChartConfig, ComparisonExperimentEntry, ComparisonMetrics,
        SectionToggles, TouchPointConfig,
    };

    pub(super) fn mk_point(t: f64, v: f64) -> DataPoint {
        DataPoint {
            time_sec: t, viscosity_cp: v,
            temperature_c: None, shear_rate: None, shear_stress_pa: None,
            speed_rpm: None, pressure_bar: None, bath_temperature_c: None,
        }
    }

    /// Data point carrying viscosity AND shear_rate — used by the
    /// individual-axis regression test.
    pub(super) fn mk_point_full(t: f64, v: f64, sr: f64, temp: f64) -> DataPoint {
        DataPoint {
            time_sec: t, viscosity_cp: v,
            temperature_c: Some(temp),
            shear_rate: Some(sr),
            shear_stress_pa: None,
            speed_rpm: None, pressure_bar: None, bath_temperature_c: None,
        }
    }

    pub(super) fn mk_input(test_id: &str, n: usize) -> ReportInput {
        let points: Vec<DataPoint> = (0..n).map(|i| mk_point(i as f64 * 30.0, 100.0 + i as f64 * 20.0)).collect();
        ReportInput {
            raw_data: points,
            metadata: ReportMetadata { filename: format!("{}.dat", test_id), test_id: Some(test_id.into()), ..Default::default() },
            cycle_results: vec![], recipe: vec![], water_params: None, cycles: vec![],
            settings: ReportSettings::default(),
            chart_image_base64: None, axis_values: None,
        }
    }

    /// `mk_input` variant that emits points with viscosity + shear_rate +
    /// temperature populated.  Used by individual-axis tests.
    pub(super) fn mk_input_full_data(test_id: &str, n: usize) -> ReportInput {
        let points: Vec<DataPoint> = (0..n).map(|i| mk_point_full(
            i as f64 * 30.0,
            1500.0 + (i as f64) * 50.0,
            40.0 + (i as f64) * 2.0,
            105.0 + (i as f64 % 5.0),
        )).collect();
        ReportInput {
            raw_data: points,
            metadata: ReportMetadata { filename: format!("{}.dat", test_id), test_id: Some(test_id.into()), ..Default::default() },
            cycle_results: vec![], recipe: vec![], water_params: None, cycles: vec![],
            settings: ReportSettings::default(),
            chart_image_base64: None, axis_values: None,
        }
    }

    pub(super) fn mk_entry(id: &str, name: &str, input: ReportInput) -> ComparisonExperimentEntry {
        ComparisonExperimentEntry {
            id: id.into(),
            display_name: name.into(),
            report_input: input,
            section_toggles: SectionToggles::default(),
        }
    }

    pub(super) fn mk_input_full(entries: Vec<ComparisonExperimentEntry>) -> ComparisonReportInput {
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
    fn full_pdf_compiles_en() {
        let entries = vec![
            mk_entry("e1", "Exp A", mk_input("T-1", 10)),
            mk_entry("e2", "Exp B", mk_input("T-2", 10)),
        ];
        let input = mk_input_full(entries);
        let result = generate_comparison_pdf(&input);
        match &result {
            Err(e) => panic!("PDF compilation failed (EN): {}", e),
            Ok(bytes) => {
                assert!(bytes.len() > 100, "PDF bytes too small: {}", bytes.len());
                assert_eq!(&bytes[..5], b"%PDF-", "output is not a valid PDF");
            }
        }
    }

    #[test]
    fn full_pdf_compiles_ru() {
        let entries = vec![
            mk_entry("e1", "Тест А", mk_input("T-1", 10)),
            mk_entry("e2", "Тест Б", mk_input("T-2", 10)),
            mk_entry("e3", "Тест В", mk_input("T-3", 10)),
        ];
        let mut input = mk_input_full(entries);
        input.language = "ru".into();
        let result = generate_comparison_pdf(&input);
        match &result {
            Err(e) => panic!("PDF compilation failed (RU): {}", e),
            Ok(bytes) => {
                assert!(bytes.len() > 100, "PDF bytes too small: {}", bytes.len());
                assert_eq!(&bytes[..5], b"%PDF-", "output is not a valid PDF");
            }
        }
    }

    #[test]
    fn full_pdf_compiles_with_touch_points() {
        // Ramp data that crosses 300 threshold
        let ramp = |offset: f64| -> Vec<DataPoint> {
            (0..30).map(|j| mk_point(
                j as f64 * 60.0,
                100.0 + offset + j as f64 * 30.0,
            )).collect()
        };
        let entries = vec![
            mk_entry("e1", "Exp A", {
                let mut ri = mk_input("T-1", 0);
                ri.raw_data = ramp(0.0);
                ri
            }),
            mk_entry("e2", "Exp B", {
                let mut ri = mk_input("T-2", 0);
                ri.raw_data = ramp(50.0);
                ri
            }),
        ];
        let mut input = mk_input_full(entries);
        input.comparison_chart.touch_point.enabled = true;
        input.comparison_chart.touch_point.viscosity_threshold = 300.0;
        input.language = "ru".into();
        let result = generate_comparison_pdf(&input);
        match &result {
            Err(e) => panic!("PDF compilation failed (touch points): {}", e),
            Ok(bytes) => {
                assert!(bytes.len() > 100, "PDF bytes too small: {}", bytes.len());
                assert_eq!(&bytes[..5], b"%PDF-", "output is not a valid PDF");
            }
        }
    }

    #[test]
    fn rejects_empty_experiments() {
        let input = mk_input_full(vec![]);
        let err = generate_comparison_pdf(&input).unwrap_err();
        assert!(err.contains("at least one experiment"));
    }

    #[test]
    fn source_has_globals_once_and_pagebreak_per_experiment() {
        let entries = vec![
            mk_entry("e1", "A", mk_input("T-1", 5)),
            mk_entry("e2", "B", mk_input("T-2", 5)),
            mk_entry("e3", "C", mk_input("T-3", 5)),
        ];
        let input = mk_input_full(entries);
        let (src, files) = build_comparison_typst_source(&input).expect("build source");

        // Globals block emitted exactly once.
        assert_eq!(src.matches("#let section_header").count(), 1,
            "globals block must appear exactly once");
        assert_eq!(src.matches("#let report_header").count(), 1);

        // One pagebreak for summary table page + one per experiment = 4 total.
        assert_eq!(src.matches("#pagebreak()").count(), 4,
            "expected 4 #pagebreak() separators: 1 summary + 3 experiments");

        // Comparison chart image is attached.
        assert!(files.contains_key("comparison_chart.svg"));

        // Body markers should be present 3×.
        assert_eq!(src.matches("// --- Page 1 Content ---").count(), 3);
    }

    #[test]
    fn summary_page_is_before_first_pagebreak() {
        let entries = vec![mk_entry("e1", "A", mk_input("T-1", 3))];
        let input = mk_input_full(entries);
        let (src, _) = build_comparison_typst_source(&input).unwrap();

        // Title now lives on the summary table page (after the first pagebreak).
        let idx_summary = src.find("Experiment Comparison").expect("summary title present");
        let idx_break = src.find("#pagebreak()").expect("pagebreak present");
        assert!(idx_summary > idx_break,
            "summary title must be after the first pagebreak (on the table page)");
    }

    #[test]
    fn russian_source_uses_cyrillic_labels() {
        let mut input = mk_input_full(vec![mk_entry("e1", "A", mk_input("T-1", 3))]);
        input.language = "ru".into();
        let (src, _) = build_comparison_typst_source(&input).unwrap();
        assert!(src.contains("Сравнение экспериментов"), "RU summary title missing");
        assert!(src.contains("Точек"),  "RU column header missing");
    }

    #[test]
    fn source_is_deterministic() {
        let entries = vec![
            mk_entry("e1", "A", mk_input("T-1", 10)),
            mk_entry("e2", "B", mk_input("T-2", 10)),
        ];
        let input = mk_input_full(entries);
        let (a, _) = build_comparison_typst_source(&input).unwrap();
        let (b, _) = build_comparison_typst_source(&input).unwrap();
        assert_eq!(a, b, "source must be byte-deterministic");
    }

    #[test]
    fn colors_cycle_through_palette_when_exp_count_exceeds_palette_size() {
        // 5 experiments but only 2 colours — must not panic, modulo-cycle.
        let mut input = mk_input_full(
            (0..5).map(|i| mk_entry(&format!("e{}", i), &format!("Exp {}", i), mk_input(&format!("T-{}", i), 3))).collect(),
        );
        input.comparison_chart.experiment_colors = vec!["#FF0000".into(), "#00FF00".into()];
        let (_src, _files) = build_comparison_typst_source(&input).expect("should cycle colours");
    }

    #[test]
    fn summary_page_is_landscape() {
        let entries = vec![mk_entry("e1", "A", mk_input("T-1", 5))];
        let input = mk_input_full(entries);
        let (src, _) = build_comparison_typst_source(&input).unwrap();
        assert!(src.contains("flipped: true"),
            "summary page must be landscape (flipped: true)");
    }

    #[test]
    fn summary_page_has_axis_labels_and_ticks() {
        let entries = vec![
            mk_entry("e1", "A", mk_input("T-1", 10)),
            mk_entry("e2", "B", mk_input("T-2", 10)),
        ];
        let input = mk_input_full(entries);
        let (src, _) = build_comparison_typst_source(&input).unwrap();
        // Axis title labels from the Typst overlay
        assert!(src.contains("Viscosity"), "left axis title missing");
        assert!(src.contains("Time (min)"), "bottom axis label missing");
        // Tick labels — generated by the overlay as #place(...) blocks
        assert!(src.contains("#place(top + left"), "tick overlay directives missing");
    }

    #[test]
    fn summary_page_has_experiment_legend() {
        let entries = vec![
            mk_entry("e1", "Alpha", mk_input("T-1", 5)),
            mk_entry("e2", "Beta", mk_input("T-2", 5)),
        ];
        let input = mk_input_full(entries);
        let (src, _) = build_comparison_typst_source(&input).unwrap();
        assert!(src.contains("Alpha"), "experiment name missing from legend");
        assert!(src.contains("Beta"), "experiment name missing from legend");
        assert!(src.contains("#line(length: 18pt"), "legend line indicator missing");
    }

    #[test]
    fn touch_points_table_appears_when_enabled() {
        // Build ramp data that crosses 300 mPa·s threshold.
        let ramp = |offset: f64| -> Vec<DataPoint> {
            (0..30).map(|j| mk_point(
                j as f64 * 60.0,
                100.0 + offset + j as f64 * 30.0,
            )).collect()
        };
        let mut input = mk_input_full(vec![
            mk_entry("e1", "Exp A", {
                let mut ri = mk_input("T-1", 0);
                ri.raw_data = ramp(0.0);
                ri
            }),
            mk_entry("e2", "Exp B", {
                let mut ri = mk_input("T-2", 0);
                ri.raw_data = ramp(50.0);
                ri
            }),
        ]);
        input.comparison_chart.touch_point.enabled = true;
        input.comparison_chart.touch_point.viscosity_threshold = 300.0;
        let (src, _) = build_comparison_typst_source(&input).unwrap();
        // After the split the section is titled "Threshold Crossings"; the
        // legacy "Control Points" wording is gone by design.  `show_target_time`
        // defaults to `false`, so only the threshold table is emitted here.
        assert!(
            src.contains("Threshold Crossings"),
            "touch-points section title missing",
        );
        assert!(src.contains("Exp A"), "experiment name missing from touch-points table");
        assert!(src.contains("Exp B"), "experiment name missing from touch-points table");
    }

    /// When both a viscosity threshold AND a target-time readout are
    /// enabled, the comparison PDF must render TWO distinct tables with
    /// their own section headers.
    #[test]
    fn touch_points_render_two_tables_for_threshold_and_target_time() {
        let ramp = |offset: f64| -> Vec<DataPoint> {
            (0..30).map(|j| mk_point(
                j as f64 * 60.0,
                100.0 + offset + j as f64 * 30.0,
            )).collect()
        };
        let mut input = mk_input_full(vec![
            mk_entry("e1", "Exp A", {
                let mut ri = mk_input("T-1", 0);
                ri.raw_data = ramp(0.0);
                ri
            }),
            mk_entry("e2", "Exp B", {
                let mut ri = mk_input("T-2", 0);
                ri.raw_data = ramp(50.0);
                ri
            }),
        ]);
        input.comparison_chart.touch_point.enabled = true;
        input.comparison_chart.touch_point.viscosity_threshold = 300.0;
        input.comparison_chart.touch_point.show_target_time = true;
        input.comparison_chart.touch_point.target_time = 20.0;

        let (src, _) = build_comparison_typst_source(&input).unwrap();
        assert!(
            src.contains("Threshold Crossings"),
            "first table section header missing",
        );
        assert!(
            src.contains("Viscosity at Set Time"),
            "second table section header missing",
        );
        // The old single-table title must not re-appear in the split view.
        assert!(
            !src.contains("Control Points (threshold"),
            "legacy combined table title resurfaced after split",
        );
    }
}
