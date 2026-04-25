//! Chart page renderer: SVG embed + per-axis Typst tick/label overlay.
//!
//! This is the layout-critical part of the PDF — it computes the same
//! symmetric page margins the SVG uses (so chart body widths match in both
//! modes) and then renders the per-axis tick labels and rotated axis titles
//! as a Typst overlay that sits on top of the SVG image.
//!
//! See the long comment block around `make_axis_title` for the derivation
//! of the `dx` / `dy` formulas used for rotated titles.
use super::super::super::types::ReportInput;
use super::super::super::chart_generator::{ChartConfig, ChartLineStyle, ChartRanges};
use super::super::super::formatters::{format_time_value, get_viscosity_unit};
use super::helpers::{escape_typst, hex_to_typst};

/// Render the entire “chart page” block, or `String::new()` when `has_chart`
/// is false.  The returned string already contains its own `#page(...)`
/// directive so it must be embedded at the correct nesting level in the
/// outer template.
pub(super) fn build_chart_page(
    input: &ReportInput,
    has_chart: bool,
    chart_config: Option<&ChartConfig>,
    chart_ranges: Option<&ChartRanges>,
    is_ru: bool,
) -> String {
    if !has_chart {
        return String::new();
    }

    let Some(config) = chart_config else {
        // Chart present but no config — fall back to the simple centred SVG.
        return r##"
#page(paper: "a4", flipped: true)[
    #align(center + horizon)[
        #image("chart.svg", width: 90%)
    ]
]
"##.to_string();
    };

    let _ = is_ru; // kept for future localised fallbacks

    // Metric labels (already user-provided, just sanitise for Typst markup)
    let l_visc = escape_typst(&config.name_viscosity);
    let l_temp = escape_typst(&config.name_temperature);
    let l_shear = escape_typst(&config.name_shear_rate);
    let l_press = escape_typst(&config.name_pressure);
    let l_bath_temp = escape_typst(&config.name_bath_temperature);

    let axis_bottom = escape_typst(&config.label_bottom);
    let axis_left = escape_typst(&config.label_left);
    let axis_right = escape_typst(&config.label_right);

    // ── Legend helper ────────────────────────────────────────────────────
    let make_legend_line = |style: &ChartLineStyle, label: &str, unit: &str| -> String {
        let ChartLineStyle { color, width, style: dash_style } = style;
        let color_str = format!("rgb({}, {}, {})", color.0, color.1, color.2);
        let thickness = format!("{}pt", width);
        let stroke = match dash_style.as_str() {
            "dashed" => format!(r##"(paint: {}, thickness: {}, dash: "dashed")"##, color_str, thickness),
            "dotted" => format!(r##"(paint: {}, thickness: {}, dash: "dotted")"##, color_str, thickness),
            _ => format!("{} + {}", thickness, color_str), // solid
        };
        format!(r##"#box(baseline: -1pt)[#line(length: 18pt, stroke: {})] #h(3pt) [{} ({})]"##, stroke, label, unit)
    };

    let styles = config.line_styles.clone().unwrap_or_default();

    let visc_unit = get_viscosity_unit(&input.settings.unit_system);

    let mut legend_items = vec![
        make_legend_line(&styles.viscosity, &l_visc, visc_unit),
    ];
    if config.show_temperature {
        legend_items.push(make_legend_line(&styles.temperature, &l_temp, "°C"));
    }
    if config.show_shear_rate {
        legend_items.push(make_legend_line(&styles.shear_rate, &l_shear, "1/s"));
    }
    if config.show_pressure {
        legend_items.push(make_legend_line(&styles.pressure, &l_press, "bar"));
    }
    if config.show_bath_temperature {
        legend_items.push(make_legend_line(&styles.bath_temperature, &l_bath_temp, "°C"));
    }
    let legend_content = legend_items.join(" #h(15pt) ");

    // ── Scale computation (must precede make_ticks and make_axis_title) ──
    let svg_w = config.width as f64;
    let svg_h = config.height as f64;
    const TICK_MARGIN_PX: f64 = 10.0;   // must match chart_generator::tick_margin
    const AXIS_SPACING_PX: f64 = 60.0;  // must match chart_generator::AXIS_SPACING_PX

    let is_individual_mode = chart_ranges
        .is_some_and(|r| !r.individual_axes.is_empty());

    // Settings-based axis counts — used as source of truth for margin and
    // overlay positioning in BOTH modes.
    let n_settings_left: usize = 1 // viscosity always left
        + if input.settings.show_shear_rate && input.settings.shear_rate_axis.trim().to_lowercase() == "left" { 1 } else { 0 }
        + if input.settings.show_pressure  && input.settings.pressure_axis.trim().to_lowercase()  == "left" { 1 } else { 0 };
    let n_settings_right: usize =
          if input.settings.show_temperature || input.settings.show_bath_temperature { 1 } else { 0 }
        + if input.settings.show_shear_rate && input.settings.shear_rate_axis.trim().to_lowercase() == "right" { 1 } else { 0 }
        + if input.settings.show_pressure  && input.settings.pressure_axis.trim().to_lowercase()  == "right" { 1 } else { 0 };

    // Count extra axis columns per side (for dynamic page-margin calculation).
    // Individual mode reads actual axes drawn; shared mode falls back to the
    // settings-based counts so margins stay identical to individual mode.
    let (n_left_extra, n_right_extra) = if let Some(r) = chart_ranges {
        if is_individual_mode {
            let nl = r.individual_axes.iter()
                .filter(|a| a.side == "left").map(|a| a.side_idx).max().unwrap_or(0);
            let nr = r.individual_axes.iter()
                .filter(|a| a.side == "right").map(|a| a.side_idx).max().unwrap_or(0);
            (nl, nr)
        } else {
            (n_settings_left.saturating_sub(1), n_settings_right.saturating_sub(1))
        }
    } else {
        (n_settings_left.saturating_sub(1), n_settings_right.saturating_sub(1))
    };

    const PAGE_WIDTH_PT: f64 = 842.0; // A4 landscape, pts
    let axis_step_pt: usize = AXIS_SPACING_PX as usize;
    // Symmetric margins: use max(left, right) so chart is centred on page.
    let n_settings_extra = (n_settings_left.saturating_sub(1)).max(n_settings_right.saturating_sub(1));
    let extra = n_left_extra.max(n_right_extra).max(n_settings_extra).max(1);
    // Override per-side extras to symmetric value — critical for
    // correct tick label / axis title positioning in the overlay.
    let n_left_extra = extra;
    let n_right_extra = extra;
    let left_page_margin_pt  = 28usize + extra * axis_step_pt;
    let right_page_margin_pt = 28usize + extra * axis_step_pt;

    let text_width_pt = PAGE_WIDTH_PT - left_page_margin_pt as f64 - right_page_margin_pt as f64;
    let scale_x       = text_width_pt / svg_w;          // pt per SVG-px
    let img_height_pt = text_width_pt * svg_h / svg_w;  // rendered image height in pt

    // ── make_ticks ───────────────────────────────────────────────────────
    // Generate tick labels for one axis.  See doc comments in the original
    // monolithic template for the derivation of the dx/dy formulas.
    //
    // The bottom (time) axis honours `config.time_format`:
    //   * `"minutes"` (default / empty) — the legacy numeric formatter below.
    //   * `"seconds"` / `"hh:mm:ss"`   — delegated to `format_time_value`,
    //                                    which is unit-tested to match the
    //                                    dashboard's display byte-for-byte.
    let time_fmt = config.time_format.as_str();
    let make_ticks = |min: f64, max: f64, step: f64, side: &str,
                       axis_px_side: f64, color_typst_override: &str| -> String {
        let color_str = if color_typst_override.is_empty() {
            match side {
                "left"  => "rgb(59, 130, 246)".to_string(),
                "right" => "rgb(249, 115, 22)".to_string(),
                _       => "rgb(51, 65, 85)".to_string(),
            }
        } else {
            color_typst_override.to_string()
        };

        // Tick outer end in pt from its SVG edge (major tick = 6 px)
        let eff_pt = (axis_px_side - 6.0).max(0.0) * scale_x;

        let mut s = String::new();
        let mut val = if step > 1e-6 { (min / step).ceil() * step } else { min };
        if val < min - 1e-6 { val += step; }

        while val <= max + 1e-6 {
            let frac = (val - min) / (max - min).max(1e-6);

            // Bottom (time) axis ticks: override numeric formatting when the
            // resolved time_format is "seconds" or "hh:mm:ss".  Y-axis ticks
            // and the fallback "minutes" path keep the legacy formatter.
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
                    // Plotters Y: val=min at bottom, val=max at top → inverted pixel coords
                    let pos_px = TICK_MARGIN_PX + (1.0 - frac) * (svg_h - 2.0 * TICK_MARGIN_PX);
                    let dy_pt  = pos_px * scale_x - 5.0; // 5pt = half text height, centres on tick
                    let dx_pt  = eff_pt - 24.0;           // right edge of 22pt block 2pt left of tick end
                    format!(
                        r##"#place(top + left, dy: {dy:.1}pt, dx: {dx:.1}pt)[#block(width: 22pt)[#align(right)[#text(size: 8pt, fill: {color})[{v}]]]]"##,
                        dy = dy_pt, dx = dx_pt, color = color_str, v = val_str
                    )
                },
                "right" => {
                    let pos_px = TICK_MARGIN_PX + (1.0 - frac) * (svg_h - 2.0 * TICK_MARGIN_PX);
                    let dy_pt  = pos_px * scale_x - 5.0;
                    // Right axis: block LEFT edge is 2pt to the RIGHT of the tick right end.
                    let dx_pt  = text_width_pt - eff_pt + 2.0;
                    format!(
                        r##"#place(top + left, dy: {dy:.1}pt, dx: {dx:.1}pt)[#block(width: 22pt)[#align(left)[#text(size: 8pt, fill: {color})[{v}]]]]"##,
                        dy = dy_pt, dx = dx_pt, color = color_str, v = val_str
                    )
                },
                "bottom" => {
                    // X ticks must span chart_left_px..chart_right_px (not SVG edges)
                    let chart_left_px  = TICK_MARGIN_PX + n_left_extra  as f64 * AXIS_SPACING_PX;
                    let chart_right_px = svg_w - TICK_MARGIN_PX - n_right_extra as f64 * AXIS_SPACING_PX;
                    let pos_px = chart_left_px + frac * (chart_right_px - chart_left_px);
                    let dx_pt  = pos_px * scale_x;
                    let tick_dy = img_height_pt;
                    let label_dy = img_height_pt + 7.0; // below the 6pt tick line + 1pt gap
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

    // ── make_x_minor_ticks ───────────────────────────────────────────────
    // Short tick marks (no labels) between majors on the bottom axis.
    let make_x_minor_ticks = |min: f64, max: f64, major_step: f64, minor_step: f64| -> String {
        if minor_step < 1e-10 || major_step < 1e-10 { return String::new(); }
        let chart_left_px  = TICK_MARGIN_PX + n_left_extra  as f64 * AXIS_SPACING_PX;
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

    // ── make_axis_title ──────────────────────────────────────────────────
    // Rotated axis title sitting in the page margin next to its axis.
    //
    // TITLE_SPAN = 300pt (pre-rotation width  = visual height along the axis)
    // FONT_H     =  10pt (pre-rotation height = visual width, ~9pt text)
    //
    // #rotate does NOT update the layout bounding box — #place anchors use the
    // pre-rotation box, so the visual centre equals the pre-rotation centre.
    //
    // LEFT axis (rotate -90deg):  DX = tick_end_pt − 24 − TITLE_SPAN/2
    // RIGHT axis (rotate +90deg): DX = text_width + 24 − tick_end_pt − TITLE_SPAN/2
    // Vertical centring:          DY = img_height/2 − FONT_H/2
    const TITLE_SPAN_PT: f64 = 300.0;
    const FONT_H_PT:     f64 = 10.0;
    let title_dy_pt = img_height_pt / 2.0 - FONT_H_PT / 2.0;

    let make_axis_title = |label: &str, side: &str, axis_px_side: f64, color_override: &str| -> String {
        if label.is_empty() { return String::new(); }
        let color = if color_override.is_empty() {
            match side {
                "left"  => "rgb(59, 130, 246)".to_string(),
                "right" => "rgb(249, 115, 22)".to_string(),
                _       => "rgb(51, 65, 85)".to_string(),
            }
        } else {
            color_override.to_string()
        };
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

    // ── Build overlay ────────────────────────────────────────────────────
    let mut ticks_overlay = String::new();
    if let Some(r) = chart_ranges {
        if is_individual_mode {
            // Individual mode: one tick column + one title per metric axis.
            for axis in &r.individual_axes {
                let n_extra = if axis.side == "left" { n_left_extra } else { n_right_extra };
                let axis_px = TICK_MARGIN_PX + (n_extra as f64 - axis.side_idx as f64) * AXIS_SPACING_PX;
                let color = hex_to_typst(&axis.color_hex);
                ticks_overlay.push_str(&make_ticks(
                    axis.min, axis.max, axis.step, &axis.side,
                    axis_px, &color,
                ));
                // Per-axis title (rotated, centred alongside the axis)
                let title = match axis.metric.as_str() {
                    "viscosity"                        => format!("{} ({})", l_visc, visc_unit),
                    "temperature"                      => format!("{} (°C)",  l_temp),
                    // Sample + bath share the same °C axis; combine names
                    // so the user sees both metrics labelled.
                    "temperature_and_bath"             => format!("{} / {} (°C)", l_temp, l_bath_temp),
                    "shear_rate" | "shearRate"         => format!("{} (1/s)", l_shear),
                    "bath_temperature" | "bathTemperature" => format!("{} (°C)", l_bath_temp),
                    "pressure"                         => format!("{} (bar)", l_press),
                    other                              => other.to_string(),
                };
                ticks_overlay.push_str(&make_axis_title(&title, &axis.side, axis_px, &color));
            }
            ticks_overlay.push_str(&make_ticks(r.x_min, r.x_max, r.x_step, "bottom", TICK_MARGIN_PX, ""));
            ticks_overlay.push_str(&make_x_minor_ticks(r.x_min, r.x_max, r.x_step, r.x_minor_step));
        } else {
            // Shared mode: one axis per side.
            let left_axis_px  = TICK_MARGIN_PX + n_left_extra  as f64 * AXIS_SPACING_PX;
            let right_axis_px = TICK_MARGIN_PX + n_right_extra as f64 * AXIS_SPACING_PX;
            ticks_overlay.push_str(&make_ticks(r.y_left_min, r.y_left_max, r.y_left_step, "left", left_axis_px, ""));
            ticks_overlay.push_str(&make_axis_title(&axis_left, "left", left_axis_px, ""));
            ticks_overlay.push_str(&make_ticks(r.x_min, r.x_max, r.x_step, "bottom", TICK_MARGIN_PX, ""));
            ticks_overlay.push_str(&make_x_minor_ticks(r.x_min, r.x_max, r.x_step, r.x_minor_step));
            if config.show_temperature || config.show_shear_rate || config.show_pressure || config.show_bath_temperature {
                ticks_overlay.push_str(&make_ticks(r.y_right_min, r.y_right_max, r.y_right_step, "right", right_axis_px, ""));
                ticks_overlay.push_str(&make_axis_title(&axis_right, "right", right_axis_px, ""));
            }
        }
    }

    format!(r##"
#page(paper: "a4", flipped: true, margin: (top: 2.5cm, bottom: 1.2cm, left: {left_page_margin}pt, right: {right_page_margin}pt))[
    #set par(spacing: 0pt)
    #set block(spacing: 0pt)
    // Chart SVG with side labels and ticks
    #block(width: 100%)[
        #image("chart.svg", width: 100%)

        // Ticks + axis titles overlay (generated per-axis, anchored via % of SVG width)
        {ticks_overlay}
    ]
    #v(12pt)
    #align(center)[#text(size: 9pt, weight: "bold", fill: rgb(51, 65, 85))[{axis_bottom}]]
    #v(2pt)
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
