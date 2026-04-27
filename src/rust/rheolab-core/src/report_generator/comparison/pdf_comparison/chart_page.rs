//! Page 1 of the comparison PDF: full-page landscape comparison chart.
//!
//! Layout is identical to the single-experiment `chart_page.rs` — no title,
//! SVG fills the page, tick/axis overlay, bottom axis label, legend.
//! Supports both shared and individual axis modes.

use super::super::super::chart_generator::{
    ChartConfig, ChartRanges, common::parse_hex_color,
};
use super::super::super::formatters::{format_time_value, get_viscosity_unit};
use super::super::super::pdf::template::helpers::{escape_typst, hex_to_typst};
use super::super::types::ComparisonReportInput;

/// Build page 1: full-page comparison chart (landscape A4).
///
/// Layout is **identical** to the single-experiment `chart_page.rs` —
/// no title, SVG fills the page, tick/axis overlay, bottom axis label,
/// legend.  Supports both shared and individual axis modes.
pub(super) fn build_chart_full_page(
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
