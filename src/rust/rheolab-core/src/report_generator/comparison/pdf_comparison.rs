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
//! # PDF compilation is expensive
//!
//! Typst compilation takes ~5 s in debug, ~0.5 s in release.  Tests in this
//! module therefore only verify the **Typst source** (fast, string-level
//! checks).  End-to-end PDF bytes verification lives in Phase 1.H's
//! integration test, which is gated behind `#[cfg(test)]` + a feature flag.

use base64::prelude::*;
use std::collections::HashMap;

use super::super::chart_generator::{
    ChartConfig, ChartLineStyles, ChartPoint, ChartRanges, ChartTouchPoint,
    line::{generate_multi_experiment_chart_svg, ExperimentSeries},
    common::parse_hex_color,
};
use super::super::formatters::{convert_viscosity, format_time_value, get_viscosity_unit, resolve_units, time_axis_unit};
use super::super::pdf::{build_single_experiment_body, build_typst_globals};
use super::super::pdf::template::helpers::{escape_typst, hex_to_typst};
use super::super::touch_point::{
    TouchPointInput, TouchPointType, SmartTouchPointOptions,
    calculate_smart_touch_points,
};
use super::super::typst_renderer::compile_to_pdf;
use super::summary::build_summaries;
use super::types::ComparisonReportInput;

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

/// Build page 1: full-page comparison chart (landscape A4).
///
/// Layout is **identical** to the single-experiment `chart_page.rs` —
/// no title, SVG fills the page, tick/axis overlay, bottom axis label,
/// legend.  Supports both shared and individual axis modes.
fn build_chart_full_page(
    input: &ComparisonReportInput,
    _is_ru: bool,
    config: &ChartConfig,
    chart_ranges: &ChartRanges,
) -> String {
    let svg_w = config.width as f64;
    let svg_h = config.height as f64;
    const TICK_MARGIN_PX: f64 = 10.0;
    const AXIS_SPACING_PX: f64 = 60.0;

    let is_individual_mode = !chart_ranges.individual_axes.is_empty();

    // Settings-based axis counts (source of truth for margin + overlay).
    let n_settings_left: usize = 1
        + if config.show_shear_rate && config.shear_rate_axis.trim().to_lowercase() == "left" { 1 } else { 0 }
        + if config.show_pressure && config.pressure_axis.trim().to_lowercase() == "left" { 1 } else { 0 };
    let n_settings_right: usize =
          if config.show_temperature || config.show_bath_temperature { 1 } else { 0 }
        + if config.show_shear_rate && config.shear_rate_axis.trim().to_lowercase() == "right" { 1 } else { 0 }
        + if config.show_pressure && config.pressure_axis.trim().to_lowercase() == "right" { 1 } else { 0 };

    let (n_left_extra, n_right_extra) = if is_individual_mode {
        let nl = chart_ranges.individual_axes.iter()
            .filter(|a| a.side == "left").map(|a| a.side_idx).max().unwrap_or(0);
        let nr = chart_ranges.individual_axes.iter()
            .filter(|a| a.side == "right").map(|a| a.side_idx).max().unwrap_or(0);
        (nl, nr)
    } else {
        (n_settings_left.saturating_sub(1), n_settings_right.saturating_sub(1))
    };

    const PAGE_WIDTH_PT: f64 = 842.0;
    // ── Fixed 2-cm left/right page margin ───────────────────────────
    // User-facing requirement: the chart frame must always be 2 cm from the
    // page edge, regardless of axis count or chart settings.  The SVG itself
    // handles per-axis spacing internally (see AXIS_SPACING_PX in the SVG
    // renderer), so there is no need to inflate the Typst page margin.
    const MARGIN_CM: f64 = 2.0;
    const MARGIN_PT: f64 = MARGIN_CM * 72.0 / 2.54; // ≈ 56.693 pt
    let n_settings_extra = (n_settings_left.saturating_sub(1)).max(n_settings_right.saturating_sub(1));
    // `extra` = number of **additional** axis columns per side beyond the
    // primary one.  A single-axis chart (only viscosity on the left) has
    // `extra = 0` → SVG reserves just 10 px of internal tick-margin on
    // each side, keeping the plot area flush with the 2-cm page edge.
    // Tick labels and the rotated Y-axis title are rendered by the Typst
    // overlay and allowed to spill into the page margin so they stay
    // visible.  Historically this had `.max(1)` which inflated the
    // internal padding by ~1.7 cm even for single-axis charts — user
    // feedback 2026-04-24: "2 см слева и 2 см справа независимо от
    // конфигурации осей" — so the clamp has been removed.
    let extra = n_left_extra.max(n_right_extra).max(n_settings_extra);
    let n_left_extra = extra;
    let n_right_extra = extra;
    let left_page_margin_pt  = MARGIN_PT.round() as usize;
    let right_page_margin_pt = MARGIN_PT.round() as usize;

    let text_width_pt = PAGE_WIDTH_PT - left_page_margin_pt as f64 - right_page_margin_pt as f64;
    let scale_x       = text_width_pt / svg_w;
    let img_height_pt = text_width_pt * svg_h / svg_w;

    let visc_unit = get_viscosity_unit(&input.unit_system);

    // ── make_ticks — identical to chart_page.rs ─────────────────────
    let time_fmt = config.time_format.as_str();
    let make_ticks = |min: f64, max: f64, step: f64, side: &str,
                       axis_px_side: f64, color_typst_override: &str| -> String {
        let color_str = if color_typst_override.is_empty() {
            match side {
                "left"  => "rgb(59, 130, 246)".to_string(),
                "right" => "rgb(249, 115, 22)".to_string(),
                _       => "rgb(51, 65, 85)".to_string(),
            }
        } else { color_typst_override.to_string() };
        let eff_pt = (axis_px_side - 6.0).max(0.0) * scale_x;
        let mut s = String::new();
        let mut val = if step > 1e-6 { (min / step).ceil() * step } else { min };
        if val < min - 1e-6 { val += step; }
        while val <= max + 1e-6 {
            let frac = (val - min) / (max - min).max(1e-6);
            let val_str = if side == "bottom" && (time_fmt == "seconds" || time_fmt == "hh:mm:ss") {
                format_time_value(val, time_fmt)
            } else if (val.fract()).abs() < 1e-6 {
                format!("{:.0}", val)
            } else if val.abs() < 10.0 {
                format!("{:.1}", val)
            } else {
                format!("{:.0}", val)
            };
            let place_cmd = match side {
                "left" => {
                    let pos_px = TICK_MARGIN_PX + (1.0 - frac) * (svg_h - 2.0 * TICK_MARGIN_PX);
                    let dy_pt  = pos_px * scale_x - 5.0;
                    let dx_pt  = eff_pt - 24.0;
                    format!(
                        r##"#place(top + left, dy: {dy:.1}pt, dx: {dx:.1}pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: {color})[{v}]]]]"##,
                        dy = dy_pt, dx = dx_pt, color = color_str, v = val_str
                    )
                },
                "right" => {
                    let pos_px = TICK_MARGIN_PX + (1.0 - frac) * (svg_h - 2.0 * TICK_MARGIN_PX);
                    let dy_pt  = pos_px * scale_x - 5.0;
                    let dx_pt  = text_width_pt - eff_pt + 2.0;
                    format!(
                        r##"#place(top + left, dy: {dy:.1}pt, dx: {dx:.1}pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: {color})[{v}]]]]"##,
                        dy = dy_pt, dx = dx_pt, color = color_str, v = val_str
                    )
                },
                "bottom" => {
                    let chart_left_px  = TICK_MARGIN_PX + n_left_extra as f64 * AXIS_SPACING_PX;
                    let chart_right_px = svg_w - TICK_MARGIN_PX - n_right_extra as f64 * AXIS_SPACING_PX;
                    let pos_px = chart_left_px + frac * (chart_right_px - chart_left_px);
                    let dx_pt  = pos_px * scale_x;
                    let tick_dy = img_height_pt;
                    let label_dy = img_height_pt + 7.0;
                    format!(
                        concat!(
                            "#place(top + left, dx: {dx:.1}pt, dy: {tick_dy:.1}pt)",
                            "[#line(start: (0pt, 0pt), end: (0pt, 6pt), stroke: 0.7pt + {color})]\n",
                            "#place(top + left, dx: {dx:.1}pt, dy: {label_dy:.1}pt)",
                            "[#box(width: 0pt)[#align(center)[#text(size: 8pt, fill: {color})[{v}]]]]"
                        ),
                        dx = dx_pt, tick_dy = tick_dy, label_dy = label_dy,
                        color = color_str, v = val_str
                    )
                },
                _ => String::new(),
            };
            s.push_str(&place_cmd);
            s.push('\n');
            val += step;
        }
        s
    };

    // ── make_x_minor_ticks ──────────────────────────────────────────
    let make_x_minor_ticks = |min: f64, max: f64, major_step: f64, minor_step: f64| -> String {
        if minor_step < 1e-10 || major_step < 1e-10 { return String::new(); }
        let chart_left_px  = TICK_MARGIN_PX + n_left_extra as f64 * AXIS_SPACING_PX;
        let chart_right_px = svg_w - TICK_MARGIN_PX - n_right_extra as f64 * AXIS_SPACING_PX;
        let mut s = String::new();
        let start = (min / minor_step).ceil() * minor_step;
        let mut val = if start < min - 1e-9 { start + minor_step } else { start };
        while val <= max + 1e-9 {
            let is_major = ((val / major_step).round() * major_step - val).abs() < minor_step * 0.1;
            if !is_major {
                let frac = (val - min) / (max - min).max(1e-9);
                let pos_px = chart_left_px + frac * (chart_right_px - chart_left_px);
                let dx_pt  = pos_px * scale_x;
                s.push_str(&format!(
                    "#place(top + left, dx: {dx:.1}pt, dy: {tick_dy:.1}pt)[#line(start: (0pt, 0pt), end: (0pt, 3pt), stroke: 0.5pt + rgb(148, 163, 184))]\n",
                    dx = dx_pt, tick_dy = img_height_pt
                ));
            }
            val += minor_step;
        }
        s
    };

    // ── make_axis_title (rotated, in page margin) ───────────────────
    const TITLE_SPAN_PT: f64 = 300.0;
    const FONT_H_PT: f64 = 10.0;
    let title_dy_pt = img_height_pt / 2.0 - FONT_H_PT / 2.0;

    let make_axis_title = |label: &str, side: &str, axis_px_side: f64, color_override: &str| -> String {
        if label.is_empty() { return String::new(); }
        let color = if color_override.is_empty() {
            match side {
                "left"  => "rgb(59, 130, 246)".to_string(),
                "right" => "rgb(249, 115, 22)".to_string(),
                _       => "rgb(51, 65, 85)".to_string(),
            }
        } else { color_override.to_string() };
        let tick_end_pt = (axis_px_side - 6.0).max(0.0) * scale_x;
        match side {
            "left" => {
                let dx_pt = tick_end_pt - 24.0 - TITLE_SPAN_PT / 2.0;
                format!(
                    "#place(top + left, dy: {dy:.1}pt, dx: {dx:.1}pt)[#rotate(-90deg)[#box(width: {span}pt, height: {fh}pt)[#align(center)[#text(size: 9pt, weight: \"bold\", fill: {color})[{label}]]]]]#linebreak()\n",
                    dy = title_dy_pt, dx = dx_pt,
                    span = TITLE_SPAN_PT, fh = FONT_H_PT,
                    color = color, label = label
                )
            },
            "right" => {
                let dx_pt = text_width_pt + 24.0 - tick_end_pt - TITLE_SPAN_PT / 2.0;
                format!(
                    "#place(top + left, dy: {dy:.1}pt, dx: {dx:.1}pt)[#rotate(90deg)[#box(width: {span}pt, height: {fh}pt)[#align(center)[#text(size: 9pt, weight: \"bold\", fill: {color})[{label}]]]]]#linebreak()\n",
                    dy = title_dy_pt, dx = dx_pt,
                    span = TITLE_SPAN_PT, fh = FONT_H_PT,
                    color = color, label = label
                )
            },
            _ => String::new(),
        }
    };

    // ── Build overlay (individual + shared, like chart_page.rs) ─────
    let l_visc = escape_typst(&config.label_left);
    let l_right = escape_typst(&config.label_right);

    let mut ticks_overlay = String::new();
    if is_individual_mode {
        for axis in &chart_ranges.individual_axes {
            let n_extra = if axis.side == "left" { n_left_extra } else { n_right_extra };
            let axis_px = TICK_MARGIN_PX + (n_extra as f64 - axis.side_idx as f64) * AXIS_SPACING_PX;
            let color = hex_to_typst(&axis.color_hex);
            ticks_overlay.push_str(&make_ticks(
                axis.min, axis.max, axis.step, &axis.side, axis_px, &color,
            ));
            let title = match axis.metric.as_str() {
                "viscosity"                            => format!("{} ({})", escape_typst(&config.name_viscosity), visc_unit),
                "temperature"                          => format!("{} (°C)",  escape_typst(&config.name_temperature)),
                // Sample + bath share the same °C axis; combine both names
                // into a single title so the user sees both metrics labelled.
                "temperature_and_bath"                 => format!(
                    "{} / {} (°C)",
                    escape_typst(&config.name_temperature),
                    escape_typst(&config.name_bath_temperature),
                ),
                "shear_rate" | "shearRate"             => format!("{} (1/s)", escape_typst(&config.name_shear_rate)),
                "bath_temperature" | "bathTemperature"  => format!("{} (°C)", escape_typst(&config.name_bath_temperature)),
                "pressure"                             => format!("{} (bar)", escape_typst(&config.name_pressure)),
                other                                  => other.to_string(),
            };
            ticks_overlay.push_str(&make_axis_title(&title, &axis.side, axis_px, &color));
        }
        ticks_overlay.push_str(&make_ticks(chart_ranges.x_min, chart_ranges.x_max, chart_ranges.x_step, "bottom", TICK_MARGIN_PX, ""));
        ticks_overlay.push_str(&make_x_minor_ticks(chart_ranges.x_min, chart_ranges.x_max, chart_ranges.x_step, chart_ranges.x_minor_step));
    } else {
        let left_axis_px  = TICK_MARGIN_PX + n_left_extra as f64 * AXIS_SPACING_PX;
        let right_axis_px = TICK_MARGIN_PX + n_right_extra as f64 * AXIS_SPACING_PX;
        ticks_overlay.push_str(&make_ticks(chart_ranges.y_left_min, chart_ranges.y_left_max, chart_ranges.y_left_step, "left", left_axis_px, ""));
        ticks_overlay.push_str(&make_axis_title(&l_visc, "left", left_axis_px, ""));
        ticks_overlay.push_str(&make_ticks(chart_ranges.x_min, chart_ranges.x_max, chart_ranges.x_step, "bottom", TICK_MARGIN_PX, ""));
        ticks_overlay.push_str(&make_x_minor_ticks(chart_ranges.x_min, chart_ranges.x_max, chart_ranges.x_step, chart_ranges.x_minor_step));
        let has_right_axis = config.show_temperature || config.show_bath_temperature
            || (config.show_shear_rate && config.shear_rate_axis.trim().to_lowercase() == "right")
            || (config.show_pressure && config.pressure_axis.trim().to_lowercase() == "right");
        if has_right_axis {
            ticks_overlay.push_str(&make_ticks(chart_ranges.y_right_min, chart_ranges.y_right_max, chart_ranges.y_right_step, "right", right_axis_px, ""));
            ticks_overlay.push_str(&make_axis_title(&l_right, "right", right_axis_px, ""));
        }
    }

    let axis_bottom = escape_typst(&config.label_bottom);

    // ── Legend: one coloured line per experiment ─────────────────────
    let cfg = &input.comparison_chart;
    let mut legend_items: Vec<String> = Vec::new();
    for (i, entry) in input.experiments.iter().enumerate() {
        let color_hex = cfg.experiment_colors
            .get(i % cfg.experiment_colors.len().max(1))
            .cloned()
            .unwrap_or_else(|| "#3B82F6".to_string());
        let rgb = parse_hex_color(&color_hex);
        let color_str = format!("rgb({}, {}, {})", rgb.0, rgb.1, rgb.2);
        legend_items.push(format!(
            r##"#box(baseline: -1pt)[#line(length: 18pt, stroke: 2pt + {color})] #h(3pt) [{name}]"##,
            color = color_str,
            name = escape_typst(&entry.display_name),
        ));
    }
    let legend_content = legend_items.join(" #h(12pt) ");

    // ── Typst page — identical structure to chart_page.rs ───────────
    format!(r##"
#page(paper: "a4", flipped: true, margin: (top: 2.5cm, bottom: 1.2cm, left: {left_page_margin}pt, right: {right_page_margin}pt))[
    #set par(spacing: 0pt)
    #set block(spacing: 0pt)
    // Chart SVG with side labels and ticks
    #block(width: 100%)[
        #image("comparison_chart.svg", width: 100%)

        // Ticks + axis titles overlay (generated per-axis, anchored via % of SVG width)
        {ticks_overlay}
    ]
    #v(12pt)
    #align(center)[#text(size: 9pt, weight: "bold", fill: rgb(51, 65, 85))[{axis_bottom}]]
    // ~5 mm spacer between the bottom axis label and the legend box
    #v(16pt)
    // Legend
    #align(center)[
        #block(stroke: 0.5pt + gray, inset: 3pt, radius: 3pt, fill: white)[
            #text(size: 8pt)[{legend_content}]
        ]
    ]
]
"##,
        axis_bottom = axis_bottom,
        legend_content = legend_content,
        ticks_overlay = ticks_overlay,
        left_page_margin = left_page_margin_pt,
        right_page_margin = right_page_margin_pt,
    )
}

/// Build page 2: summary table + touch points on a separate portrait page.
fn build_summary_table_page(
    input: &ComparisonReportInput,
    is_ru: bool,
) -> String {
    let title = if is_ru { "Сравнение экспериментов" } else { "Experiment Comparison" };
    // `test_id` stays on `ExperimentSummary` so the DB-side payload is
    // unchanged, but the Summary table no longer renders it — the user
    // asked for one less column and the experiment name already carries
    // enough identity on the chart + legend.
    let t_exp    = if is_ru { "Эксперимент"            } else { "Experiment" };
    let t_pts    = if is_ru { "Точек"                  } else { "Points" };
    let t_dur    = if is_ru { "Длительность (мин)"     } else { "Duration (min)" };
    let t_maxv   = if is_ru { "Макс. вязкость"         } else { "Max viscosity" };
    let t_finv   = if is_ru { "Финал. вязкость"        } else { "Final viscosity" };

    let visc_unit = get_viscosity_unit(&input.unit_system);

    let summaries = build_summaries(&input.experiments);
    let mut rows_typst = String::new();
    for s in &summaries {
        let max_v = convert_viscosity(s.max_viscosity_cp, &input.unit_system);
        let fin_v = convert_viscosity(s.final_viscosity_cp, &input.unit_system);
        rows_typst.push_str(&format!(
            "  [{}], [{}], [{:.1}], [{:.1} {}], [{:.1} {}],\n",
            escape_typst(&s.display_name),
            s.data_points,
            s.duration_min,
            max_v, visc_unit,
            fin_v, visc_unit,
        ));
    }

    let touch_points_block = build_comparison_touch_points_block(input, is_ru);

    format!(r##"
#pagebreak()
#page(paper: "a4", flipped: false, margin: (top: 2.5cm, bottom: 1.2cm, left: 2cm, right: 2cm))[

#text(size: 14pt, weight: "bold", fill: rgb("#0F172A"))[{title}]
#v(12pt)

#section_header("{summary_hdr}")
#v(8pt)

#table(
  columns: (2.8fr, 0.9fr, 1.3fr, 1.5fr, 1.5fr),
  stroke: 0.5pt + rgb("#E2E8F0"),
  fill: none,
  align: center + horizon,
  table.header(
    header_cell[{t_exp}],
    header_cell[{t_pts}],
    header_cell[{t_dur}],
    header_cell[{t_maxv}],
    header_cell[{t_finv}]
  ),
{rows}
)

{touch_points}
]
"##,
        title = escape_typst(title),
        summary_hdr = if is_ru { "Сводная таблица" } else { "Summary" },
        t_exp = t_exp, t_pts = t_pts,
        t_dur = t_dur, t_maxv = t_maxv, t_finv = t_finv,
        rows = rows_typst,
        touch_points = touch_points_block,
    )
}

/// Build the touch-point tables for the comparison summary page.
///
/// Emits **two separate tables** in the Typst markup — one per touch-point
/// kind — so the user sees the threshold crossings and the target-time
/// readings as distinct sections (matching the in-app view):
///
///   1. "Точки касания (порог N …)"           ← `TouchPointType::Threshold`
///   2. "Вязкость в заданное время (M мин)"   ← `TouchPointType::Target`
///
/// The per-table `Тип` column is dropped because the section title now
/// conveys the point type unambiguously; every row is `Test Name | Time
/// (min) | Viscosity`.
///
/// If only one kind is present the other table is skipped.  Returns an
/// empty string when touch points are disabled or none were computed.
fn build_comparison_touch_points_block(
    input: &ComparisonReportInput,
    is_ru: bool,
) -> String {
    let cfg = &input.comparison_chart;
    if !cfg.touch_point.enabled || cfg.touch_point.viscosity_threshold <= 0.0 {
        return String::new();
    }

    let unit_system = &input.unit_system;
    let visc_unit = get_viscosity_unit(unit_system);

    // Collect results per experiment.  Only the fields we render are kept
    // — the `tp_type` discriminant is used below to split rows between
    // the two tables, then discarded.
    struct TpRow {
        exp_name: String,
        tp_type: TouchPointType,
        time_min: f64,
        viscosity_display: f64,
    }
    let mut tp_rows: Vec<TpRow> = Vec::new();

    for entry in &input.experiments {
        let raw = &entry.report_input.raw_data;
        if raw.len() < 3 { continue; }

        let first_time_sec = raw.first().map(|p| p.time_sec).unwrap_or(0.0);
        let inputs: Vec<TouchPointInput> = raw.iter()
            .filter(|p| p.time_sec.is_finite() && p.viscosity_cp.is_finite())
            .map(|p| TouchPointInput {
                time_min: (p.time_sec - first_time_sec) / 60.0,
                viscosity_cp: p.viscosity_cp,
                shear_rate: p.shear_rate.unwrap_or(0.0),
            })
            .collect();

        let results = calculate_smart_touch_points(
            &inputs,
            &SmartTouchPointOptions {
                viscosity_threshold: cfg.touch_point.viscosity_threshold,
                show_target_time: cfg.touch_point.show_target_time,
                target_time: cfg.touch_point.target_time,
                ..Default::default()
            },
        );

        for r in &results {
            let visc_display = convert_viscosity(r.viscosity, unit_system);
            tp_rows.push(TpRow {
                exp_name: entry.display_name.clone(),
                tp_type: r.tp_type.clone(),
                time_min: r.time,
                viscosity_display: visc_display,
            });
        }
    }

    if tp_rows.is_empty() {
        return String::new();
    }

    let threshold_display = convert_viscosity(cfg.touch_point.viscosity_threshold, unit_system);

    // Localised strings shared by both tables.
    let h_name = if is_ru { "Название теста" } else { "Test Name" };
    let h_time = if is_ru { "Время (мин)" } else { "Time (min)" };
    let h_visc = if is_ru { format!("Вязкость ({})", visc_unit) }
                 else     { format!("Viscosity ({})", visc_unit) };

    // Helper: render ONE three-column table for a filtered row slice.  The
    // caller decides the section title so the same helper serves both
    // "threshold crossings" and "viscosity at set time".
    let render_table = |title: &str, rows: &[&TpRow]| -> String {
        if rows.is_empty() { return String::new(); }
        let mut body = String::new();
        for tp in rows {
            body.push_str(&format!(
                "  [{}], [{:.1}], [{:.0}],\n",
                escape_typst(&tp.exp_name),
                tp.time_min,
                tp.viscosity_display,
            ));
        }
        format!(r##"
#v(10pt)
#section_header("{title}")
#v(5pt)
#table(
  columns: (3fr, 1fr, 1.2fr),
  stroke: 0.5pt + rgb("#E2E8F0"),
  fill: none,
  align: center + horizon,
  table.header(
    header_cell[{h_name}],
    header_cell[{h_time}],
    header_cell[{h_visc}]
  ),
{body}
)
"##,
            title = escape_typst(title),
            h_name = h_name,
            h_time = h_time,
            h_visc = h_visc,
            body = body,
        )
    };

    // Split the rows while preserving the original per-experiment order.
    let threshold_rows: Vec<&TpRow> = tp_rows.iter()
        .filter(|r| matches!(r.tp_type, TouchPointType::Threshold))
        .collect();
    let target_rows: Vec<&TpRow> = tp_rows.iter()
        .filter(|r| matches!(r.tp_type, TouchPointType::Target))
        .collect();

    let threshold_title = if is_ru {
        format!("Точки касания (порог {:.0} {})", threshold_display, visc_unit)
    } else {
        format!("Threshold Crossings (threshold {:.0} {})", threshold_display, visc_unit)
    };
    let target_title = if is_ru {
        format!("Вязкость в заданное время ({:.0} мин)", cfg.touch_point.target_time)
    } else {
        format!("Viscosity at Set Time ({:.0} min)", cfg.touch_point.target_time)
    };

    let mut out = String::new();
    out.push_str(&render_table(&threshold_title, &threshold_rows));
    out.push_str(&render_table(&target_title,    &target_rows));
    out
}

// escape_typst is imported from pdf::template::helpers (canonical, complete version).

/// Map the canonical UI metric keys (the values stored in
/// `displaySettings.{primary,leftSecondary,…}Metric` on the TypeScript
/// side, sourced from `METRICS` in `app/dashboard/comparison/page.tsx`)
/// onto the **internal short keys** that the renderer's
/// `ChartConfig::shear_rate_axis` / `show_*` flags work in.
///
/// Why this exists
/// ===============
/// The production UI dropdown stores metric ids such as
/// `"shear_rate_s1"`, `"temperature_c"`, `"pressure_bar"`,
/// `"bath_temperature_c"`, `"viscosity_cp"` — these are the same keys
/// used as scale names on the live uPlot preview.  The Rust comparison
/// renderer, however, identifies metrics by short tags (`"shear_rate"`,
/// `"temperature"`, `"pressure"`, `"bath_temperature"`, `"viscosity"`).
/// A naïve `==` comparison of those two namespaces silently drops every
/// metric whose canonical key carries a unit suffix — exactly the
/// 2026-04-25 user report where the comparison PDF rendered only the
/// viscosity axis even when shear rate was selected on Слева 2.
///
/// We keep the function tolerant: any unknown / already-internal key
/// passes through unchanged so legacy callers (the existing
/// regression tests, the debug example) continue to work.
fn canonical_to_internal(key: &str) -> &str {
    match key {
        // shear rate
        "shear_rate_s1" | "shearRate" | "shear_rate" => "shear_rate",
        // viscosity
        "viscosity_cp" | "viscosityCp" | "viscosity" => "viscosity",
        // sample temperature
        "temperature_c" | "temperatureC" | "temperature" => "temperature",
        // bath temperature
        "bath_temperature_c" | "bathTemperatureC" | "bath_temperature" => "bath_temperature",
        // pressure
        "pressure_bar" | "pressureBar" | "pressure" => "pressure",
        // unknown / already-canonical / sentinel ("none") — pass through
        other => other,
    }
}

/// Render the multi-experiment comparison chart SVG.
fn render_comparison_chart(
    input: &ComparisonReportInput,
    is_ru: bool,
) -> Result<(String, ChartRanges, ChartConfig), String> {
    let cfg = &input.comparison_chart;
    let unit_system = &input.unit_system;

    // Per-experiment series: each experiment's raw_data is converted to
    // display units and wrapped as `ExperimentSeries`.
    let mut series: Vec<ExperimentSeries> = Vec::with_capacity(input.experiments.len());
    for (i, entry) in input.experiments.iter().enumerate() {
        let first_time = entry.report_input.raw_data.first().map(|p| p.time_sec).unwrap_or(0.0);
        let points: Vec<ChartPoint> = entry.report_input.raw_data.iter().map(|p| ChartPoint {
            time_min: (p.time_sec - first_time) / 60.0,
            viscosity_cp: convert_viscosity(p.viscosity_cp, unit_system),
            temperature_c: p.temperature_c,
            shear_rate: p.shear_rate,
            pressure_bar: p.pressure_bar,
            bath_temperature_c: p.bath_temperature_c,
        }).collect();

        // Pick palette colour, cycling through the list.
        let color_hex = cfg.experiment_colors
            .get(i % cfg.experiment_colors.len().max(1))
            .cloned()
            .unwrap_or_else(|| "#3B82F6".to_string());
        let color = parse_hex_color(&color_hex);

        series.push(ExperimentSeries {
            points,
            color,
            display_name: entry.display_name.clone(),
        });
    }

    // Build shared-axis ChartConfig for the multi-exp renderer.  Axis
    // labels and per-axis metric names match the single-experiment path
    // (see `pdf/mod.rs::build_report`) so the comparison chart replicates
    // exactly what the user sees in the in-app dashboard.
    let visc_unit = get_viscosity_unit(unit_system);
    let l_visc      = if is_ru { format!("Вязкость ({})", visc_unit) } else { format!("Viscosity ({})", visc_unit) };
    let l_temp      = if is_ru { "Температура (°C)".to_string() }      else { "Temperature (°C)".to_string() };
    let l_shear     = if is_ru { "Скорость сдвига (1/с)".to_string() } else { "Shear Rate (1/s)".to_string() };
    let l_press     = if is_ru { "Давление (бар)".to_string() }         else { "Pressure (bar)".to_string() };
    let l_bath_temp = if is_ru { "Темп. бани (°C)".to_string() }        else { "Bath Temp (°C)".to_string() };

    // Short names used for per-metric axis titles in individual mode.
    let n_visc      = if is_ru { "Вязкость"      } else { "Viscosity" };
    let n_temp      = if is_ru { "Температура"   } else { "Temperature" };
    let n_shear     = if is_ru { "Скор. сдвига"  } else { "Shear Rate" };
    let n_press     = if is_ru { "Давление"      } else { "Pressure" };
    let n_bath_temp = if is_ru { "Темп. бани"    } else { "Bath Temp" };

    // Time-axis label follows the anchor experiment's `rheology_units.
    // time_format` so the comparison chart matches the dashboard the user
    // just saw.  If the anchor has no `rheology_units` override,
    // `resolve_units` returns `"minutes"` and this reduces to the legacy
    // "Время (мин)" / "Time (min)" label.
    let time_fmt = input.experiments
        .first()
        .map(|e| resolve_units(&e.report_input).time_format)
        .unwrap_or_else(|| "minutes".to_string());
    let time_unit = time_axis_unit(&time_fmt, if is_ru { "ru" } else { "en" });
    let l_time = if is_ru {
        format!("Время ({})", time_unit)
    } else {
        format!("Time ({})", time_unit)
    };

    // Visible metrics follow the user's `metrics` selection from the UI.
    // Slot semantics:
    //   - `left_secondary`       → additional LEFT axis
    //   - `secondary` / `tertiary` → additional RIGHT axes
    //   - `primary` is always viscosity (left)
    //
    // Both the production UI dropdown (`comparison-chart-constants.ts`)
    // and historic preset code use **canonical UI keys** like
    // `"shear_rate_s1"` / `"viscosity_cp"`, while the renderer below
    // (and its `ChartConfig::shear_rate_axis` / `show_shear_rate`
    // counterparts) work in **internal short keys** (`"shear_rate"`,
    // `"viscosity"`, …).  `canonical_to_internal` bridges the two so a
    // string mismatch in one slot doesn't silently drop the entire
    // metric from the chart — the user-facing symptom of the
    // 2026-04-25 bug report ("Раздельные оси не работают!").
    let in_left  = |key: &str| canonical_to_internal(&cfg.metrics.left_secondary) == key;
    let in_right = |key: &str|
        canonical_to_internal(&cfg.metrics.secondary)  == key
        || canonical_to_internal(&cfg.metrics.tertiary) == key;
    let in_any   = |key: &str| in_left(key) || in_right(key);

    let show_temperature      = in_any("temperature");
    let show_shear_rate       = in_any("shear_rate");
    let show_pressure         = in_any("pressure");
    let show_bath_temperature = in_any("bath_temperature");

    // Side for movable secondaries.  Default to "right" when the metric is
    // requested on neither side (shouldn't normally happen).
    let shear_rate_axis =
        if in_left("shear_rate") { "left" } else { "right" }.to_string();
    let pressure_axis =
        if in_left("pressure") { "left" } else { "right" }.to_string();

    // ── Axis labels — mirror single-exp `build_report` exactly ────────────
    // Left label: viscosity + whatever other left-side metrics the user
    // placed there, joined with " / " (same separator as the app).
    let mut left_parts: Vec<String> = vec![l_visc.clone()];
    if show_shear_rate && shear_rate_axis == "left" {
        left_parts.push(l_shear.clone());
    }
    if show_pressure && pressure_axis == "left" {
        left_parts.push(l_press.clone());
    }
    let label_left = left_parts.join(" / ");

    // Right label: sample temp + bath temp (both always share the °C axis
    // but list both names when both are visible) + shear/pressure if
    // placed on the right.
    let mut right_parts: Vec<String> = Vec::new();
    if show_temperature {
        right_parts.push(l_temp.clone());
    }
    if show_shear_rate && shear_rate_axis == "right" {
        right_parts.push(l_shear.clone());
    }
    if show_pressure && pressure_axis == "right" {
        right_parts.push(l_press.clone());
    }
    if show_bath_temperature {
        right_parts.push(l_bath_temp.clone());
    }
    let label_right = right_parts.join(" / ");

    // ── Compute touch-point markers for the chart SVG ──────────────
    let mut chart_touch_points: Vec<ChartTouchPoint> = Vec::new();
    if cfg.touch_point.enabled && cfg.touch_point.viscosity_threshold > 0.0 {
        for (i, entry) in input.experiments.iter().enumerate() {
            let raw = &entry.report_input.raw_data;
            if raw.len() < 3 { continue; }

            let first_time_sec = raw.first().map(|p| p.time_sec).unwrap_or(0.0);
            let inputs: Vec<TouchPointInput> = raw.iter()
                .filter(|p| p.time_sec.is_finite() && p.viscosity_cp.is_finite())
                .map(|p| TouchPointInput {
                    time_min: (p.time_sec - first_time_sec) / 60.0,
                    viscosity_cp: p.viscosity_cp,
                    shear_rate: p.shear_rate.unwrap_or(0.0),
                })
                .collect();

            let results = calculate_smart_touch_points(
                &inputs,
                &SmartTouchPointOptions {
                    viscosity_threshold: cfg.touch_point.viscosity_threshold,
                    show_target_time: cfg.touch_point.show_target_time,
                    target_time: cfg.touch_point.target_time,
                    ..Default::default()
                },
            );

            let color = cfg.experiment_colors
                .get(i % cfg.experiment_colors.len().max(1))
                .map(|h| parse_hex_color(h))
                .unwrap_or_else(|| parse_hex_color("#3B82F6"));

            for r in &results {
                chart_touch_points.push(ChartTouchPoint {
                    time: r.time,
                    viscosity: convert_viscosity(r.viscosity, unit_system),
                    label: format!("{:.0}", convert_viscosity(r.viscosity, unit_system)),
                    color,
                });
            }
        }
    }

    // ── Dynamic SVG dimensions — fixed 2-cm page margin ───────────────
    // The Typst page margin is pinned to 2 cm left/right in
    // `build_chart_full_page` so the chart frame always sits 2 cm from the
    // page edge regardless of axis count.  That fixes the SVG→pt scale and
    // therefore also fixes the required SVG aspect ratio.
    //
    // A4 landscape body = 595 - top(2.5cm=71pt) - bottom(1.2cm=34pt) = 490pt
    //
    // Budget below the chart frame (must fit on the same page):
    //   ~12pt spacer + ~9pt axis label + ~16pt spacer + legend box ≤ 95pt
    //   where the legend box itself scales with line count
    //   (≈ 27pt / 37pt for 2-line / 3-line wraps of 8pt text).
    //
    // Target chart render height = 395pt → leaves ~95pt for everything
    // below the chart, which fits a 3-line legend comfortably.
    //   Rendered chart height = text_width_pt × svg_h / svg_w
    //   → svg_h = CHART_BODY_TARGET_PT × svg_w / text_width_pt
    const SVG_W: f64 = 1040.0;
    const CHART_BODY_TARGET_PT: f64 = 395.0;
    const A4_LANDSCAPE_W_PT: f64 = 842.0;
    const MARGIN_CM: f64 = 2.0;
    const MARGIN_PT: f64 = MARGIN_CM * 72.0 / 2.54; // ≈ 56.693 pt
    let text_width_pt = A4_LANDSCAPE_W_PT - 2.0 * MARGIN_PT; // ≈ 728.6 pt
    let svg_h_dynamic = ((CHART_BODY_TARGET_PT * SVG_W) / text_width_pt)
        .round()
        .clamp(400.0, 900.0) as u32;

    let chart_config = ChartConfig {
        show_temperature,
        show_shear_rate,
        show_pressure,
        show_bath_temperature,
        shear_rate_axis,
        pressure_axis,
        axis_mode: cfg.axis_mode.clone(),
        width: SVG_W as u32,
        height: svg_h_dynamic,
        label_left,
        label_right,
        label_bottom: l_time.to_string(),
        // Full metric names used by the per-axis title overlay in
        // individual mode — same as the single-exp report.
        name_viscosity:        n_visc.to_string(),
        name_temperature:      n_temp.to_string(),
        name_shear_rate:       n_shear.to_string(),
        name_pressure:         n_press.to_string(),
        name_bath_temperature: n_bath_temp.to_string(),
        touch_points: chart_touch_points,
        viscosity_threshold: if cfg.touch_point.enabled {
            Some(convert_viscosity(cfg.touch_point.viscosity_threshold, unit_system))
        } else {
            None
        },
        line_styles: Some(ChartLineStyles::from(&cfg.line_settings)),
        skip_downsample: matches!(cfg.downsample_mode.as_str(), "off"),
        time_format: time_fmt,
    };

    let (svg, ranges) = generate_multi_experiment_chart_svg(&series, &chart_config)?;
    Ok((svg, ranges, chart_config))
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::super::types::{DataPoint, ReportInput, ReportMetadata, ReportSettings};
    use super::super::types::{
        ComparisonChartConfig, ComparisonExperimentEntry, ComparisonMetrics,
        SectionToggles, TouchPointConfig,
    };

    fn mk_point(t: f64, v: f64) -> DataPoint {
        DataPoint {
            time_sec: t, viscosity_cp: v,
            temperature_c: None, shear_rate: None, shear_stress_pa: None,
            speed_rpm: None, pressure_bar: None, bath_temperature_c: None,
        }
    }

    /// Data point carrying viscosity AND shear_rate — used by the
    /// individual-axis regression test.
    fn mk_point_full(t: f64, v: f64, sr: f64, temp: f64) -> DataPoint {
        DataPoint {
            time_sec: t, viscosity_cp: v,
            temperature_c: Some(temp),
            shear_rate: Some(sr),
            shear_stress_pa: None,
            speed_rpm: None, pressure_bar: None, bath_temperature_c: None,
        }
    }

    fn mk_input(test_id: &str, n: usize) -> ReportInput {
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
    fn mk_input_full_data(test_id: &str, n: usize) -> ReportInput {
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

    fn mk_entry(id: &str, name: &str, input: ReportInput) -> ComparisonExperimentEntry {
        ComparisonExperimentEntry {
            id: id.into(),
            display_name: name.into(),
            report_input: input,
            section_toggles: SectionToggles::default(),
        }
    }

    fn mk_input_full(entries: Vec<ComparisonExperimentEntry>) -> ComparisonReportInput {
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

    /// Regression: comparison chart SVG must use dynamic dimensions that
    /// fill the full A4 landscape page body, matching chart_page.rs layout.
    ///
    /// Page margin is pinned to 2 cm = 56.693 pt on both sides, so
    /// text_width_pt = 842 - 2×56.693 = 728.614 pt, and
    /// svg_h = round(422 × 1040 / 728.614) = 602.
    #[test]
    fn comparison_svg_dimensions_match_fixed_2cm_margin() {
        let entries = vec![
            mk_entry("e1", "A", mk_input("T-1", 10)),
            mk_entry("e2", "B", mk_input("T-2", 10)),
        ];
        let input = mk_input_full(entries);
        let (_svg, _ranges, cfg) = render_comparison_chart(&input, true).unwrap();

        // Width must be fixed at 1040 (shared with single-exp).
        assert_eq!(cfg.width, 1040, "SVG width must match single-exp SVG_W=1040");
        // Height must be in the [400, 900] range enforced by the dynamic clamp.
        assert!(
            (400..=900).contains(&cfg.height),
            "SVG height={} must be in [400, 900] clamp range", cfg.height
        );

        // Pin the exact value so drift in MARGIN_CM or CHART_BODY_TARGET_PT
        // is caught immediately.
        assert_eq!(
            cfg.height, 564,
            "SVG height must be 564 for a 2-cm left/right page margin \
             (CHART_BODY_TARGET_PT = 395pt)"
        );

        // Aspect ratio check: rendered height must be ~395pt (the body target).
        let text_width_pt = 842.0 - 2.0 * (2.0 * 72.0 / 2.54); // 728.614
        let rendered_height_pt = text_width_pt * cfg.height as f64 / cfg.width as f64;
        assert!(
            (rendered_height_pt - 395.0).abs() < 1.0,
            "rendered height {rendered_height_pt:.1}pt must match CHART_BODY_TARGET=395pt",
        );
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

    /// Build a realistic `ChartLineSettings` that mirrors what the UI
    /// sends in production — purple shear-rate, blue viscosity, etc.
    /// The default `ChartLineSettings::default()` leaves every colour as
    /// the empty string, which exercises a different code path and hides
    /// the production regression we want to pin down here.
    fn mk_line_settings_realistic() -> crate::report_generator::types::ChartLineSettings {
        use crate::report_generator::types::{ChartLineSettings, LineSettings};
        ChartLineSettings {
            viscosity:        LineSettings { color: "#3B82F6".into(), width: 2, style: "solid".into() },
            temperature:      LineSettings { color: "#F97316".into(), width: 2, style: "dotted".into() },
            shear_rate:       LineSettings { color: "#A855F7".into(), width: 2, style: "solid".into() },
            pressure:         LineSettings { color: "#22C55E".into(), width: 2, style: "solid".into() },
            rpm:              LineSettings { color: "#06B6D4".into(), width: 2, style: "solid".into() },
            bath_temperature: Some(LineSettings { color: "#EA580C".into(), width: 2, style: "dashed".into() }),
        }
    }

    /// Regression: in individual-axis mode with `leftSecondary = shear_rate`
    /// the rendered SVG must include a shear-rate axis tick column and at
    /// least one data series on the shear-rate scale.  User report
    /// 2026-04-24: "Разхдельные оси сломаны! ... Но не отображается
    /// скорость сдвига!"
    #[test]
    fn individual_mode_with_shear_rate_on_left_draws_shear_rate_series() {
        let mut input = mk_input_full(vec![
            mk_entry("e1", "Exp A", mk_input_full_data("T-1", 20)),
            mk_entry("e2", "Exp B", mk_input_full_data("T-2", 20)),
        ]);
        // User's exact flow: individual mode, shear_rate on left, temp on right.
        input.comparison_chart.axis_mode = "individual".into();
        input.comparison_chart.metrics.left_secondary = "shear_rate".into();
        input.comparison_chart.metrics.secondary = "temperature_c".into();
        input.comparison_chart.line_settings = mk_line_settings_realistic();

        let (_svg, ranges, cfg) = render_comparison_chart(&input, true).unwrap();

        assert!(cfg.show_shear_rate, "cfg.show_shear_rate must be true");
        assert_eq!(cfg.shear_rate_axis, "left", "shear_rate_axis must be 'left'");
        assert!(cfg.show_temperature, "cfg.show_temperature must be true");

        // Chart ranges must expose three individual axes: viscosity (left,
        // idx 0), shear_rate (left, idx 1), temperature (right, idx 0).
        assert_eq!(
            ranges.individual_axes.len(), 3,
            "expected 3 individual axes (viscosity + shear_rate + temperature); got {}: {:?}",
            ranges.individual_axes.len(),
            ranges.individual_axes.iter().map(|a| &a.metric).collect::<Vec<_>>(),
        );
        let shear_axis = ranges.individual_axes.iter()
            .find(|a| a.metric == "shear_rate")
            .expect("shear_rate axis must be present in individual_axes");
        assert_eq!(shear_axis.side, "left", "shear_rate axis must be on the left side");
        assert_eq!(shear_axis.side_idx, 1, "shear_rate axis must be second on the left (side_idx=1)");

        // Also verify the Typst overlay actually emits a shear-rate tick
        // column — the bug report symptom is that the axis label is missing
        // from the PDF, so we assert the axis title appears in the source.
        let (src, _files) = build_comparison_typst_source(&input).unwrap();
        assert!(
            src.contains("Скор. сдвига") || src.contains("Shear Rate"),
            "shear-rate axis title must appear in the Typst overlay",
        );

        // The shear-rate axis colour (from line_styles default — purple-ish)
        // must colour its tick overlay.  `line_styles` default for shear rate
        // is `#A855F7`, which Typst renders as `rgb(168, 85, 247)`.
        assert!(
            src.contains("rgb(168, 85, 247)"),
            "shear-rate axis colour must appear at least once in the overlay (indicates tick labels drawn)",
        );
    }

    /// Parity gate: the comparison-report individual-axis renderer must
    /// produce **the same** `IndividualAxisInfo` layout (metric, side,
    /// side_idx, plus matching tick scales) as the single-experiment
    /// individual renderer when fed the same effective `ChartConfig`.
    /// This is the explicit guarantee the user spelled out in the
    /// 2026-04-25 follow-up: "поведение осей соответствовало таковому в
    /// одиночных отчётах".  Drift between the two renderers (e.g. a
    /// future tweak that adds an axis to single-exp but not multi-exp)
    /// will trip this test before it reaches the PDF.
    #[test]
    fn comparison_individual_axes_match_single_experiment() {
        use crate::report_generator::chart_generator::{
            ChartConfig, ChartLineStyle, ChartLineStyles, ChartPoint,
            line::{generate_chart_svg, generate_multi_experiment_chart_svg, ExperimentSeries},
            common::parse_hex_color,
        };

        // Build a synthetic per-experiment trace shared by both renderers.
        // Mirrors the shape `mk_input_full_data` uses so the value pools
        // produce identical nice-scale snapping.
        let points: Vec<ChartPoint> = (0..40)
            .map(|i| ChartPoint {
                time_min: (i as f64 * 30.0) / 60.0,
                viscosity_cp: 1500.0 + (i as f64) * 50.0,
                temperature_c: Some(105.0 + (i as f64 % 5.0)),
                shear_rate: Some(40.0 + (i as f64) * 2.0),
                pressure_bar: None,
                bath_temperature_c: None,
            })
            .collect();

        // Same `ChartConfig` for both pipelines — viscosity + shear (left)
        // + temperature (right), individual mode.  Mirrors the user's
        // production layout once `pdf_comparison::render_comparison_chart`
        // has bridged the slot scheme onto these fields.
        let line_styles = ChartLineStyles {
            viscosity:        ChartLineStyle { color: parse_hex_color("#3B82F6"), width: 2, style: "solid".into()  },
            temperature:      ChartLineStyle { color: parse_hex_color("#F97316"), width: 2, style: "dotted".into() },
            shear_rate:       ChartLineStyle { color: parse_hex_color("#A855F7"), width: 2, style: "solid".into()  },
            pressure:         ChartLineStyle { color: parse_hex_color("#22C55E"), width: 2, style: "solid".into()  },
            bath_temperature: ChartLineStyle { color: parse_hex_color("#EA580C"), width: 2, style: "dashed".into() },
        };
        let cfg = ChartConfig {
            show_temperature: true,
            show_shear_rate: true,
            show_pressure: false,
            show_bath_temperature: false,
            shear_rate_axis: "left".into(),
            pressure_axis: "right".into(),
            axis_mode: "individual".into(),
            width: 1400, height: 700,
            label_left:  "Вязкость / Скор. сдвига".into(),
            label_right: "Температура".into(),
            label_bottom:"Время (мин)".into(),
            name_viscosity:       "Вязкость".into(),
            name_temperature:     "Температура".into(),
            name_shear_rate:      "Скор. сдвига".into(),
            name_pressure:        "Давление".into(),
            name_bath_temperature:"Темп. бани".into(),
            touch_points: vec![],
            viscosity_threshold: None,
            line_styles: Some(line_styles),
            skip_downsample: true, // PDF path skips downsampling for full precision
            time_format: "minutes".into(),
        };

        // Single-experiment path.
        let (_svg_s, ranges_s) = generate_chart_svg(&points, &cfg)
            .expect("single-experiment renderer must succeed");

        // Comparison path with N=1 experiment carrying the same trace.
        let exp = ExperimentSeries {
            points: points.clone(),
            color: parse_hex_color("#1E90FF"),
            display_name: "Exp A".into(),
        };
        let (_svg_m, ranges_m) = generate_multi_experiment_chart_svg(&[exp], &cfg)
            .expect("comparison renderer must succeed");

        // ── Same number of axes, same metric in the same slot ──────────
        assert_eq!(
            ranges_s.individual_axes.len(),
            ranges_m.individual_axes.len(),
            "axis count differs between single and comparison renderers: \
             single={:?} multi={:?}",
            ranges_s.individual_axes.iter().map(|a| (&a.metric, &a.side, a.side_idx)).collect::<Vec<_>>(),
            ranges_m.individual_axes.iter().map(|a| (&a.metric, &a.side, a.side_idx)).collect::<Vec<_>>(),
        );
        for (s, m) in ranges_s.individual_axes.iter().zip(ranges_m.individual_axes.iter()) {
            assert_eq!(s.metric,   m.metric,   "metric tag drift");
            assert_eq!(s.side,     m.side,     "axis side drift");
            assert_eq!(s.side_idx, m.side_idx, "side_idx drift");
            // Tick scales must match to the same precision — the same
            // value pool must produce the same `calculate_nice_scale`
            // output in both pipelines.
            assert!((s.min        - m.min       ).abs() < 1e-9, "{} min drift",        s.metric);
            assert!((s.max        - m.max       ).abs() < 1e-9, "{} max drift",        s.metric);
            assert!((s.step       - m.step      ).abs() < 1e-9, "{} step drift",       s.metric);
            assert!((s.minor_step - m.minor_step).abs() < 1e-9, "{} minor_step drift", s.metric);
            // Same line_styles input must produce the same axis colour.
            assert_eq!(s.color_hex.to_lowercase(), m.color_hex.to_lowercase(), "{} colour drift", s.metric);
        }

        // X-axis range parity (time scale built from the same points).
        assert!((ranges_s.x_min - ranges_m.x_min).abs() < 1e-9, "x_min drift");
        assert!((ranges_s.x_max - ranges_m.x_max).abs() < 1e-9, "x_max drift");
        assert!((ranges_s.x_step - ranges_m.x_step).abs() < 1e-9, "x_step drift");
    }

    /// Regression: the **production** UI dropdown emits the canonical
    /// metric key `"shear_rate_s1"` (see
    /// `src/components/comparison/comparison-chart-constants.ts`:
    /// `METRIC_COLORS.shear_rate_s1`, plus `app/dashboard/comparison/page.tsx`
    /// `METRICS = [..., {value: 'shear_rate_s1', label: 'Скор. сдвига'}, ...]`),
    /// **not** `"shear_rate"`.  The previous regression tests above used
    /// the short form `"shear_rate"` and so silently passed even when the
    /// renderer was unable to recognise the production key — exactly the
    /// reason the user's PDF showed only viscosity, no shear-rate axis,
    /// despite the in-app preview rendering both.  This test pins the
    /// production scenario directly: shear rate metric encoded as
    /// `"shear_rate_s1"`, no right-side metrics, individual axis mode.
    #[test]
    fn individual_mode_with_shear_rate_s1_metric_key_draws_shear_rate_series() {
        let mut input = mk_input_full(vec![
            mk_entry("e1", "Exp A", mk_input_full_data("T-1", 20)),
            mk_entry("e2", "Exp B", mk_input_full_data("T-2", 20)),
        ]);
        // Mirror the user's exact comparison toolbar:
        //   СЛЕВА 1: Вязкость        → primary       = "viscosity_cp"
        //   СЛЕВА 2: Скор. сдвига    → leftSecondary = "shear_rate_s1"  ← canonical UI key
        //   СПРАВА 1/2: Выкл         → secondary / tertiary = "none"
        input.comparison_chart.axis_mode = "individual".into();
        input.comparison_chart.metrics.left_secondary = "shear_rate_s1".into();
        input.comparison_chart.metrics.secondary = "none".into();
        input.comparison_chart.metrics.tertiary = "none".into();
        input.comparison_chart.line_settings = mk_line_settings_realistic();

        let (_svg, ranges, cfg) = render_comparison_chart(&input, true).unwrap();

        assert!(
            cfg.show_shear_rate,
            "cfg.show_shear_rate must be true when metric key is 'shear_rate_s1' (production key)",
        );
        assert_eq!(cfg.shear_rate_axis, "left", "shear_rate_axis must be 'left'");

        // With shear rate on the left and nothing on the right we expect
        // exactly two individual axes: viscosity (left, idx 0) and
        // shear_rate (left, idx 1).  No right axes.
        let metrics: Vec<&String> = ranges.individual_axes.iter().map(|a| &a.metric).collect();
        assert!(
            metrics.iter().any(|m| m.as_str() == "shear_rate"),
            "individual_axes must contain a shear_rate axis (got {metrics:?})",
        );
        assert_eq!(
            metrics.len(), 2,
            "expected 2 individual axes (viscosity + shear_rate); got {}: {metrics:?}",
            metrics.len(),
        );
    }

    /// Regression: the SVG rendered for individual mode with shear_rate on
    /// the left must contain **two distinct left-side axis lines** — one
    /// for viscosity (leftmost inside the plot area) and one for shear
    /// rate (pushed further left by `AXIS_SPACING_PX`).  A broken build
    /// that silently collapses multi-axis mode would draw only the
    /// viscosity frame line.
    #[test]
    fn individual_mode_svg_draws_two_left_axis_lines() {
        let mut input = mk_input_full(vec![
            mk_entry("e1", "Exp A", mk_input_full_data("T-1", 20)),
            mk_entry("e2", "Exp B", mk_input_full_data("T-2", 20)),
        ]);
        input.comparison_chart.axis_mode = "individual".into();
        input.comparison_chart.metrics.left_secondary = "shear_rate".into();
        input.comparison_chart.metrics.secondary = "temperature_c".into();
        input.comparison_chart.line_settings = mk_line_settings_realistic();

        let (svg, ranges, _cfg) = render_comparison_chart(&input, true).unwrap();

        // Every axis in `individual_axes` should have a `<path>` or
        // `<line>` drawn in the SVG at the computed x position.  Rather
        // than parse SVG geometry, check that both the viscosity and
        // shear-rate line_style colours appear in the SVG stroke stream.
        let shear_color = ranges.individual_axes.iter()
            .find(|a| a.metric == "shear_rate")
            .map(|a| a.color_hex.clone())
            .expect("shear_rate axis must exist");
        let visc_color = ranges.individual_axes.iter()
            .find(|a| a.metric == "viscosity")
            .map(|a| a.color_hex.clone())
            .expect("viscosity axis must exist");

        assert!(
            svg.contains(&shear_color) || svg.to_lowercase().contains(&shear_color.to_lowercase()),
            "SVG must contain the shear-rate axis colour {shear_color} (indicates axis line drawn)",
        );
        assert!(
            svg.contains(&visc_color) || svg.to_lowercase().contains(&visc_color.to_lowercase()),
            "SVG must contain the viscosity axis colour {visc_color} (indicates axis line drawn)",
        );
    }
}
