//! Multi-experiment line-chart renderer (comparison report page 1 / sheet 1).
//!
//! Produces a single SVG that stacks N experiments' series on a shared pair
//! of Y axes (left + right).  Each experiment gets its own colour from the
//! `EXPERIMENT_COLORS` palette passed in from the client; the metric (line
//! width, dash style) overrides come from `ChartConfig::line_styles` and are
//! applied uniformly to every experiment's series of the same metric.
//!
//! Dispatches on `ChartConfig::axis_mode`:
//!   - `"individual"` → each visible metric gets its own Y scale/axis column
//!     (see [`render_individual_multi`] below).
//!   - everything else → shared-axis mode (one left + one right scale).
//!
//! See `docs/adr/ADR-0010-comparison-report-generation.md` §4.3.
use plotters::prelude::*;
use plotters::element::PathElement;
use plotters::style::text_anchor::{Pos, HPos, VPos};
use super::super::common::*;

// ── SVG dash-style injector ────────────────────────────────────────────────
//
// Plotters writes each `LineSeries` as a self-closing `<polyline
// ... stroke="#RRGGBB" stroke-width="N" opacity="1"/>`, and each
// `PathElement` as a self-closing `<path ... stroke="#RRGGBB"
// stroke-width="N" .../>`.  Both forms appear in the order the caller
// invoked the draw calls.  The legacy post-processor appended
// `stroke-dasharray="8,4"` via plain `String::replace` of
// `stroke="#RGB" stroke-width="N"` — which **fails in the comparison
// chart** because every metric of a single experiment deliberately
// shares one palette colour (the comparison UI distinguishes metrics
// by dash style, not hue).  Setting `bath_temperature.style = "dashed"`
// therefore leaked dash attributes onto the viscosity and temperature
// strokes of the same experiment (user bug report 2026-04-24).
//
// This helper fixes the leak by:
//   1. Walking `<polyline>` **and** `<path>` opening tags in their SVG
//      order (shared-axis mode uses LineSeries → polylines; individual-
//      axis mode uses PathElement → paths — both must be handled).
//   2. Counting only those whose `stroke="#..."` matches an experiment
//      palette colour, skipping grid (`#C8C8C8`), axis frames
//      (`#3B82F6` / `#F97316` / `#475569`), and threshold overlays
//      (`#000000`) that plotters emits in its own fixed hues.
//   3. Injecting the dash attribute onto the specific counted index the
//      caller requested via `dash_targets`.
//
// `dash_targets: &[(data_series_idx, style)]` — `data_series_idx`
// references the **data-stroke order** the caller produced
// (`viscosity[exp_0]`, `temperature[exp_0]`, `bath_temp[exp_0]`,
// `viscosity[exp_1]`, ...), **not** the raw SVG element index.  This
// keeps the caller's bookkeeping local and free of SVG parsing.
fn inject_series_dasharray(
    svg: String,
    experiment_colors_hex: &[String],
    dash_targets: &[(usize, String)],
) -> String {
    if dash_targets.is_empty() {
        return svg;
    }

    // Build a `data_series_idx → style` map for O(1) lookup.
    let target_map: std::collections::HashMap<usize, &str> = dash_targets
        .iter()
        .map(|(idx, style)| (*idx, style.as_str()))
        .collect();

    // Pre-compute the exact `stroke="#RGB"` needles once so the hot
    // inner loop doesn't re-`format!()` per polyline.
    let needles: Vec<String> = experiment_colors_hex
        .iter()
        .map(|hex| format!(r#"stroke="{}""#, hex))
        .collect();

    let mut result = String::with_capacity(svg.len() + dash_targets.len() * 48);
    let bytes = svg.as_bytes();
    let mut cursor: usize = 0;
    let mut data_counter: usize = 0;

    while cursor < bytes.len() {
        // Find the next `<polyline` or `<path` opening tag — whichever
        // comes first.  Everything before it is copied verbatim.
        let next_poly = svg[cursor..].find("<polyline").map(|i| (cursor + i, "<polyline".len()));
        let next_path = svg[cursor..].find("<path").map(|i| (cursor + i, "<path".len()));
        let (tag_start, tag_name_len) = match (next_poly, next_path) {
            (Some(p), Some(q)) => if p.0 <= q.0 { p } else { q },
            (Some(p), None)    => p,
            (None,    Some(q)) => q,
            (None,    None)    => {
                result.push_str(&svg[cursor..]);
                break;
            }
        };

        // Copy the prefix up to (but not including) the tag opener.
        result.push_str(&svg[cursor..tag_start]);

        // Locate this tag's closing `>` so we can inspect its attributes.
        // Both polyline and path emitted by plotters are self-closing,
        // i.e. end in `/>`; we fall back to `>` defensively.
        let attr_start = tag_start + tag_name_len;
        let close_rel = svg[attr_start..].find('>').unwrap_or(svg.len() - attr_start - 1);
        let close_pos = attr_start + close_rel; // index of '>' in svg

        // `attrs` covers everything between the tag name and the closing
        // `>` — this is what we scan for `stroke="..."`.
        let attrs = &svg[attr_start..close_pos];

        let is_data_series = needles.iter().any(|n| attrs.contains(n));
        let mut dash_inject: Option<String> = None;
        if is_data_series {
            if let Some(&style) = target_map.get(&data_counter) {
                let dasharray = match style {
                    "dashed" => Some("8,4"),
                    "dotted" => Some("0.1,6"),
                    _        => None,
                };
                if let Some(d) = dasharray {
                    dash_inject = Some(if style == "dotted" {
                        format!(r#" stroke-dasharray="{}" stroke-linecap="round""#, d)
                    } else {
                        format!(r#" stroke-dasharray="{}""#, d)
                    });
                }
            }
            data_counter += 1;
        }

        // Copy the tag name + attrs, inject dasharray (if flagged) just
        // before the self-closing `/>` (or `>` fallback).
        result.push_str(&svg[tag_start..close_pos]);
        if let Some(extra) = dash_inject {
            // `svg[close_pos - 1]` is `/` for self-closing tags — put
            // the new attribute before it so the result stays a valid
            // self-closing element (`... stroke-dasharray="8,4"/>`).
            let is_self_closing = svg[..close_pos].ends_with('/');
            if is_self_closing {
                // Pop the trailing `/` we already pushed, inject, then
                // restore `/` + `>` from the input at close_pos.
                result.pop();
                result.push_str(&extra);
                result.push('/');
            } else {
                result.push_str(&extra);
            }
        }
        // Push the closing `>` itself.
        result.push('>');
        cursor = close_pos + 1;
    }

    result
}

/// One experiment's measurement points plus its assigned colour.
///
/// `display_name` is carried through for the comparison summary table and
/// future legend work, but is not drawn into the SVG itself (legend is
/// rendered by the Typst overlay in `pdf/template/chart_page.rs`).
#[derive(Debug, Clone)]
pub struct ExperimentSeries {
    pub points: Vec<ChartPoint>,
    pub color: RGBColor,
    pub display_name: String,
}

/// Render a shared-axis SVG chart for N experiments.
///
/// # Errors
///
/// - `"No experiments provided"` when `experiments` is empty.
/// - `"No data points provided"` when every experiment is empty.
/// - Propagates any Plotters/`SVGBackend` failure as `String`.
pub fn generate_multi_experiment_chart_svg(
    experiments: &[ExperimentSeries],
    config: &ChartConfig,
) -> Result<(String, ChartRanges), String> {
    if experiments.is_empty() {
        return Err("No experiments provided".to_string());
    }

    // LTTB-downsample each experiment independently.  The threshold is
    // divided across experiments so that a 10-experiment chart still fits
    // in a reasonable number of polyline points.  Floor at 200 pts/exp.
    let per_exp_threshold = (1500_usize / experiments.len().max(1)).max(200);
    let experiments: Vec<ExperimentSeries> = experiments
        .iter()
        .map(|e| {
            let points = if config.skip_downsample {
                e.points.clone()
            } else {
                lttb_downsample_chart(&e.points, per_exp_threshold)
            };
            ExperimentSeries {
                points,
                color: e.color,
                display_name: e.display_name.clone(),
            }
        })
        .collect();

    if experiments.iter().all(|e| e.points.is_empty()) {
        return Err("No data points provided".to_string());
    }

    // Dispatch on axis mode.  Individual mode gives every visible metric
    // its own Y scale and dedicated axis column; shared mode (default)
    // lumps everything onto one left + one right scale.
    if config.axis_mode.trim().to_lowercase() == "individual" {
        return render_individual_multi(&experiments, config);
    }

    // ── Aggregate per-axis value pools across all experiments ──────────────
    let mut left_vals: Vec<f64> = Vec::new();
    let mut right_vals: Vec<f64> = Vec::new();
    let mut time_vals: Vec<f64> = Vec::new();

    for exp in &experiments {
        for p in &exp.points {
            if p.time_min.is_finite() {
                time_vals.push(p.time_min);
            }
            if p.viscosity_cp.is_finite() {
                left_vals.push(p.viscosity_cp);
            }
        }

        if config.show_temperature {
            right_vals.extend(
                exp.points.iter()
                    .filter_map(|p| p.temperature_c)
                    .filter(|v| v.is_finite()),
            );
        }
        if config.show_shear_rate {
            let vals: Vec<f64> = exp.points.iter()
                .filter_map(|p| p.shear_rate)
                .filter(|v| v.is_finite())
                .collect();
            if config.shear_rate_axis.trim().to_lowercase() == "left" {
                left_vals.extend(vals);
            } else {
                right_vals.extend(vals);
            }
        }
        if config.show_pressure {
            let vals: Vec<f64> = exp.points.iter()
                .filter_map(|p| p.pressure_bar)
                .filter(|v| v.is_finite())
                .collect();
            if config.pressure_axis.trim().to_lowercase() == "left" {
                left_vals.extend(vals);
            } else {
                right_vals.extend(vals);
            }
        }
        if config.show_bath_temperature {
            right_vals.extend(
                exp.points.iter()
                    .filter_map(|p| p.bath_temperature_c)
                    .filter(|v| v.is_finite()),
            );
        }
    }

    // ── Nice scales (identical policy to shared.rs) ────────────────────────
    let (t_min_raw, t_max_raw) = get_raw_min_max(&time_vals, 0.0, 10.0);
    let (l_min_raw, l_max_raw) = get_raw_min_max(&left_vals, 0.0, 100.0);
    let (r_min_raw, r_max_raw) = get_raw_min_max(&right_vals, 0.0, 100.0);

    let (_x_min_nice, _x_max_nice, x_step, x_minor_step) =
        calculate_nice_scale(t_min_raw, t_max_raw, 8, false);
    let (y_left_min_raw, y_left_max, y_left_step, y_left_minor_step) =
        calculate_nice_scale(l_min_raw.max(0.0), l_max_raw, 12, true);
    // Viscosity scale must never go negative
    let y_left_min = y_left_min_raw.max(0.0);
    let (y_right_min, y_right_max, y_right_step, y_right_minor_step) =
        calculate_nice_scale(r_min_raw, r_max_raw, 12, true);

    let x_min = t_min_raw;
    let x_max = t_max_raw;

    // ── Draw ───────────────────────────────────────────────────────────────
    let mut svg_buf = String::new();
    // `dash_targets` records `(data_series_order_idx, style)` pairs so the
    // SVG post-processor can inject `stroke-dasharray` onto the exact
    // polyline index that needs it.  The order mirrors the draw-series
    // loop below: `viscosity[exp_0]`, `temperature[exp_0]`,
    // `shear_rate[exp_0]`, `pressure[exp_0]`, `bath_temp[exp_0]`,
    // `viscosity[exp_1]`, ...  Conditional metrics (guarded by
    // `config.show_*` plus the `!data.is_empty()` check) only increment
    // the counter when they actually emit a polyline — this keeps the
    // mapping aligned with what plotters writes to the SVG.
    let mut dash_targets: Vec<(usize, String)> = Vec::new();
    let mut data_series_idx: usize = 0;
    let rgb_str = |c: RGBColor| -> String { format!("#{:02X}{:02X}{:02X}", c.0, c.1, c.2) };
    let experiment_colors_hex: Vec<String> =
        experiments.iter().map(|e| rgb_str(e.color)).collect();
    {
        let root = SVGBackend::with_string(&mut svg_buf, (config.width, config.height))
            .into_drawing_area();
        root.fill(&WHITE).map_err(|e| e.to_string())?;

        const AXIS_SPACING_PX_SH: u32 = 60;
        const TICK_MARGIN_SH: u32 = 10;
        // Axis counts come from the settings, not the data — we want a
        // single-axis chart to reserve **zero** extra internal padding
        // (only the 10-px tick margin), so the plot area sits flush with
        // the 2-cm Typst page margin.  Tick labels + rotated axis title
        // are placed by the Typst overlay and are allowed to overflow
        // into the page margin (see `pdf_comparison::build_chart_full_page`).
        let n_left_sh: usize = 1
            + if config.show_shear_rate && config.shear_rate_axis.trim().to_lowercase() == "left" { 1 } else { 0 }
            + if config.show_pressure && config.pressure_axis.trim().to_lowercase() == "left" { 1 } else { 0 };
        let n_right_sh: usize =
              if config.show_temperature || config.show_bath_temperature { 1 } else { 0 }
            + if config.show_shear_rate && config.shear_rate_axis.trim().to_lowercase() == "right" { 1 } else { 0 }
            + if config.show_pressure && config.pressure_axis.trim().to_lowercase() == "right" { 1 } else { 0 };
        let min_extra_sh = ((n_left_sh.saturating_sub(1)) as u32)
            .max((n_right_sh.saturating_sub(1)) as u32);
        let left_margin_sh  = TICK_MARGIN_SH + min_extra_sh * AXIS_SPACING_PX_SH;
        let right_margin_sh = TICK_MARGIN_SH + min_extra_sh * AXIS_SPACING_PX_SH;

        {
            let mut chart = ChartBuilder::on(&root)
                .margin_top(TICK_MARGIN_SH)
                .margin_bottom(TICK_MARGIN_SH)
                .margin_left(left_margin_sh)
                .margin_right(right_margin_sh)
                .x_label_area_size(0)
                .y_label_area_size(0)
                .right_y_label_area_size(0)
                .build_cartesian_2d(x_min..x_max, y_left_min..y_left_max)
                .map_err(|e| e.to_string())?
                .set_secondary_coord(x_min..x_max, y_right_min..y_right_max);

            // ── Grid ──────────────────────────────────────────────────────
            let grid_style = C_GRID.stroke_width(1);
            if x_step > 1e-10 {
                let x_grid_start = (x_min / x_step).ceil() * x_step;
                let mut xg = if x_grid_start < x_min - 1e-6 { x_grid_start + x_step } else { x_grid_start };
                while xg <= x_max + 1e-6 {
                    chart.draw_series(LineSeries::new(
                        vec![(xg, y_left_min), (xg, y_left_max)],
                        grid_style,
                    )).ok();
                    xg += x_step;
                }
            }
            if y_left_step > 1e-10 {
                let y_grid_start = (y_left_min / y_left_step).ceil() * y_left_step;
                let mut yg = if y_grid_start < y_left_min - 1e-6 { y_grid_start + y_left_step } else { y_grid_start };
                while yg <= y_left_max + 1e-6 {
                    chart.draw_series(LineSeries::new(
                        vec![(x_min, yg), (x_max, yg)],
                        grid_style,
                    )).ok();
                    yg += y_left_step;
                }
            }

            // Axis frame colours
            let c_left_axis = RGBColor(59, 130, 246);
            let c_right_axis = RGBColor(249, 115, 22);
            let c_bottom_axis = RGBColor(71, 85, 105);

            let has_right_axis = config.show_temperature
                || config.show_bath_temperature
                || (config.show_shear_rate && config.shear_rate_axis.trim().to_lowercase() == "right")
                || (config.show_pressure && config.pressure_axis.trim().to_lowercase() == "right");

            chart.draw_series(LineSeries::new(
                vec![(x_min, y_left_min), (x_max, y_left_min)],
                c_bottom_axis.stroke_width(1),
            )).ok();
            chart.draw_series(LineSeries::new(
                vec![(x_min, y_left_min), (x_min, y_left_max)],
                c_left_axis.stroke_width(1),
            )).ok();
            if has_right_axis {
                chart.draw_series(LineSeries::new(
                    vec![(x_max, y_left_min), (x_max, y_left_max)],
                    c_right_axis.stroke_width(1),
                )).ok();
            }

            let styles = config.line_styles.as_ref().cloned().unwrap_or_default();

            // ── Series: one set per experiment ────────────────────────────
            //
            // Colour comes from the experiment palette; line width + dash
            // style come from the per-metric line_settings (so all
            // experiments' viscosity lines share width/dash, only the
            // colour varies).  This matches the comparison UI behaviour.
            //
            // `data_series_idx` is incremented **once per polyline** that
            // plotters emits (i.e. once per successful `draw_series` call
            // where the data vector is non-empty).  The post-processor
            // uses this index to locate the right polyline in the SVG —
            // see `inject_series_dasharray` at the top of the file.
            for exp in &experiments {
                let exp_color = exp.color;

                // Viscosity — left axis, mandatory
                let visc_data: Vec<(f64, f64)> = exp.points.iter()
                    .map(|p| (p.time_min, p.viscosity_cp))
                    .collect();
                let visc_width = styles.viscosity.width;
                chart.draw_series(LineSeries::new(
                    visc_data,
                    exp_color.stroke_width(visc_width),
                )).map_err(|e| e.to_string())?;
                if styles.viscosity.style != "solid" {
                    dash_targets.push((data_series_idx, styles.viscosity.style.clone()));
                }
                data_series_idx += 1;

                // Temperature — right axis
                if config.show_temperature {
                    let t_data: Vec<(f64, f64)> = exp.points.iter()
                        .filter_map(|p| p.temperature_c.map(|v| (p.time_min, v)))
                        .collect();
                    if !t_data.is_empty() {
                        let w = styles.temperature.width;
                        chart.draw_secondary_series(LineSeries::new(
                            t_data,
                            exp_color.stroke_width(w),
                        )).map_err(|e| e.to_string())?;
                        if styles.temperature.style != "solid" {
                            dash_targets.push((data_series_idx, styles.temperature.style.clone()));
                        }
                        data_series_idx += 1;
                    }
                }

                // Shear rate
                if config.show_shear_rate {
                    let sr_data: Vec<(f64, f64)> = exp.points.iter()
                        .filter_map(|p| p.shear_rate.map(|v| (p.time_min, v)))
                        .collect();
                    if !sr_data.is_empty() {
                        let w = styles.shear_rate.width;
                        let is_right = config.shear_rate_axis.trim().to_lowercase() == "right";
                        let series = LineSeries::new(sr_data, exp_color.stroke_width(w));
                        if is_right {
                            chart.draw_secondary_series(series).map_err(|e| e.to_string())?;
                        } else {
                            chart.draw_series(series).map_err(|e| e.to_string())?;
                        }
                        if styles.shear_rate.style != "solid" {
                            dash_targets.push((data_series_idx, styles.shear_rate.style.clone()));
                        }
                        data_series_idx += 1;
                    }
                }

                // Pressure
                if config.show_pressure {
                    let pr_data: Vec<(f64, f64)> = exp.points.iter()
                        .filter_map(|p| p.pressure_bar.map(|v| (p.time_min, v)))
                        .collect();
                    if !pr_data.is_empty() {
                        let w = styles.pressure.width;
                        let is_right = config.pressure_axis.trim().to_lowercase() == "right";
                        let series = LineSeries::new(pr_data, exp_color.stroke_width(w));
                        if is_right {
                            chart.draw_secondary_series(series).map_err(|e| e.to_string())?;
                        } else {
                            chart.draw_series(series).map_err(|e| e.to_string())?;
                        }
                        if styles.pressure.style != "solid" {
                            dash_targets.push((data_series_idx, styles.pressure.style.clone()));
                        }
                        data_series_idx += 1;
                    }
                }

                // Bath temperature — right axis
                if config.show_bath_temperature {
                    let bt_data: Vec<(f64, f64)> = exp.points.iter()
                        .filter_map(|p| p.bath_temperature_c.map(|v| (p.time_min, v)))
                        .collect();
                    if !bt_data.is_empty() {
                        let w = styles.bath_temperature.width;
                        chart.draw_secondary_series(LineSeries::new(
                            bt_data,
                            exp_color.stroke_width(w),
                        )).map_err(|e| e.to_string())?;
                        if styles.bath_temperature.style != "solid" {
                            dash_targets.push((data_series_idx, styles.bath_temperature.style.clone()));
                        }
                        data_series_idx += 1;
                    }
                }
            }
        } // end chart scope

        // ── Tick marks (pixel coords) ──────────────────────────────────────
        let tm_top    = TICK_MARGIN_SH as f64;
        let tm_bottom = TICK_MARGIN_SH as f64;
        let tm_left   = left_margin_sh as f64;
        let tm_right  = right_margin_sh as f64;
        let chart_w = config.width as f64 - tm_left - tm_right;
        let chart_h = config.height as f64 - tm_top - tm_bottom;
        let chart_bottom_px = config.height as f64 - tm_bottom;
        let chart_left_px = tm_left;
        let chart_right_px = config.width as f64 - tm_right;

        let data_to_px_x = |dx: f64| -> i32 {
            (tm_left + (dx - x_min) / (x_max - x_min).max(1e-10) * chart_w) as i32
        };
        let data_to_px_y_left = |dy: f64| -> i32 {
            (tm_top + (1.0 - (dy - y_left_min) / (y_left_max - y_left_min).max(1e-10)) * chart_h) as i32
        };
        let data_to_px_y_right = |dy: f64| -> i32 {
            (tm_top + (1.0 - (dy - y_right_min) / (y_right_max - y_right_min).max(1e-10)) * chart_h) as i32
        };

        let tick_major = 6i32;
        let tick_minor = 3i32;

        let c_left_axis = RGBColor(59, 130, 246);
        let c_right_axis = RGBColor(249, 115, 22);
        let c_bottom_axis = RGBColor(71, 85, 105);

        let has_right_axis = config.show_temperature
            || config.show_bath_temperature
            || (config.show_shear_rate && config.shear_rate_axis.trim().to_lowercase() == "right")
            || (config.show_pressure && config.pressure_axis.trim().to_lowercase() == "right");

        if x_minor_step > 1e-10 {
            let xt_start = (x_min / x_minor_step).ceil() * x_minor_step;
            let mut xt = if xt_start < x_min - 1e-6 { xt_start + x_minor_step } else { xt_start };
            while xt <= x_max + 1e-6 {
                let is_major = x_step > 1e-10 && ((xt / x_step).round() * x_step - xt).abs() < x_minor_step * 0.1;
                let tlen = if is_major { tick_major } else { tick_minor };
                let px = data_to_px_x(xt);
                let py = chart_bottom_px as i32;
                root.draw(&PathElement::new(
                    vec![(px, py), (px, py + tlen)],
                    c_bottom_axis.stroke_width(1),
                )).ok();
                xt += x_minor_step;
            }
        }

        if y_left_minor_step > 1e-10 {
            let yt_start = (y_left_min / y_left_minor_step).ceil() * y_left_minor_step;
            let mut yt = if yt_start < y_left_min - 1e-6 { yt_start + y_left_minor_step } else { yt_start };
            while yt <= y_left_max + 1e-6 {
                let is_major = y_left_step > 1e-10
                    && ((yt / y_left_step).round() * y_left_step - yt).abs() < y_left_minor_step * 0.1;
                let tlen = if is_major { tick_major } else { tick_minor };
                let px = chart_left_px as i32;
                let py = data_to_px_y_left(yt);
                root.draw(&PathElement::new(
                    vec![(px, py), (px - tlen, py)],
                    c_left_axis.stroke_width(1),
                )).ok();
                yt += y_left_minor_step;
            }
        }

        if has_right_axis && y_right_minor_step > 1e-10 && (y_right_max - y_right_min).abs() > 1e-6 {
            let yrt_start = (y_right_min / y_right_minor_step).ceil() * y_right_minor_step;
            let mut yrt = if yrt_start < y_right_min - 1e-6 { yrt_start + y_right_minor_step } else { yrt_start };
            while yrt <= y_right_max + 1e-6 {
                let is_major = y_right_step > 1e-10
                    && ((yrt / y_right_step).round() * y_right_step - yrt).abs() < y_right_minor_step * 0.1;
                let tlen = if is_major { tick_major } else { tick_minor };
                let px = chart_right_px as i32;
                let py = data_to_px_y_right(yrt);
                root.draw(&PathElement::new(
                    vec![(px, py), (px + tlen, py)],
                    c_right_axis.stroke_width(1),
                )).ok();
                yrt += y_right_minor_step;
            }
        }

        // Threshold line (dashed, shared)
        if let Some(threshold) = config.viscosity_threshold {
            let py = data_to_px_y_left(threshold);
            if py >= tm_top as i32 && py <= chart_bottom_px as i32 {
                let left_x  = chart_left_px as i32;
                let right_x = chart_right_px as i32;
                let dash_w  = 6i32;
                let gap_w   = 4i32;
                let threshold_color = RGBColor(0, 0, 0);
                let mut x = left_x;
                while x < right_x {
                    let x2 = (x + dash_w).min(right_x);
                    root.draw(&PathElement::new(
                        vec![(x, py), (x2, py)],
                        threshold_color.stroke_width(1),
                    )).ok();
                    x += dash_w + gap_w;
                }
                let label = format!("{} cP", threshold as i32);
                let style = TextStyle::from(("sans-serif", 11).into_font().color(&threshold_color))
                    .pos(Pos::new(HPos::Right, VPos::Center));
                root.draw_text(&label, &style, (left_x - 4, py)).ok();
            }
        }

        // Touch points — small filled diamond (4 px) + white outline + label.
        for tp in &config.touch_points {
            let px = data_to_px_x(tp.time);
            let py = data_to_px_y_left(tp.viscosity);
            if px >= chart_left_px as i32 && px <= chart_right_px as i32
                && py >= tm_top as i32 && py <= chart_bottom_px as i32
            {
                let r = 4i32;
                let diamond = vec![
                    (px, py - r), (px + r, py), (px, py + r), (px - r, py), (px, py - r),
                ];
                root.draw(&plotters::element::Polygon::new(diamond.clone(), tp.color.filled())).ok();
                root.draw(&PathElement::new(diamond, WHITE.stroke_width(1))).ok();
                let label_color = RGBColor(0, 0, 0);
                let label_style = TextStyle::from(("sans-serif", 9).into_font().color(&label_color))
                    .pos(Pos::new(HPos::Center, VPos::Bottom));
                root.draw_text(&tp.label, &label_style, (px, py - r - 2)).ok();
            }
        }

        root.present().map_err(|e| e.to_string())?;
    }

    // Post-process SVG: dashed grid lines
    svg_buf = svg_buf
        .replace(
            r##"opacity="1" stroke="#C8C8C8" stroke-width="1""##,
            r##"opacity="0.4" stroke="#C8C8C8" stroke-width="0.5" stroke-dasharray="4,4""##,
        );

    // Post-process SVG: apply stroke-dasharray to the specific data
    // polylines we flagged during draw, **without** leaking onto sibling
    // series that happen to share the same experiment colour (the
    // comparison chart deliberately reuses one colour across metrics).
    svg_buf = inject_series_dasharray(svg_buf, &experiment_colors_hex, &dash_targets);

    Ok((
        svg_buf,
        ChartRanges {
            x_min, x_max, x_step, x_minor_step,
            y_left_min, y_left_max, y_left_step, y_left_minor_step,
            y_right_min, y_right_max, y_right_step, y_right_minor_step,
            individual_axes: vec![],
        },
    ))
}

// ── Individual-axis renderer (multi-experiment) ─────────────────────────────
//
// Mirrors the single-experiment `individual::render` but draws every metric's
// series once per experiment using that experiment's palette colour.  Each
// visible metric gets its own Y scale and dedicated axis column (viscosity
// always on left idx 0; shear rate / pressure follow their *_axis setting;
// temperature + bath_temperature share the right-side °C axis).
fn render_individual_multi(
    experiments: &[ExperimentSeries],
    config: &ChartConfig,
) -> Result<(String, ChartRanges), String> {
    // ── 1. Aggregate per-metric value pools across ALL experiments ────────
    let mut time_vals: Vec<f64> = Vec::new();
    let mut visc_vals: Vec<f64> = Vec::new();
    let mut temp_vals: Vec<f64> = Vec::new();
    let mut sr_vals:   Vec<f64> = Vec::new();
    let mut pr_vals:   Vec<f64> = Vec::new();
    let mut bt_vals:   Vec<f64> = Vec::new();

    for exp in experiments {
        for p in &exp.points {
            if p.time_min.is_finite()     { time_vals.push(p.time_min); }
            if p.viscosity_cp.is_finite() { visc_vals.push(p.viscosity_cp); }
        }
        if config.show_temperature {
            temp_vals.extend(exp.points.iter()
                .filter_map(|p| p.temperature_c).filter(|v| v.is_finite()));
        }
        if config.show_shear_rate {
            sr_vals.extend(exp.points.iter()
                .filter_map(|p| p.shear_rate).filter(|v| v.is_finite()));
        }
        if config.show_pressure {
            pr_vals.extend(exp.points.iter()
                .filter_map(|p| p.pressure_bar).filter(|v| v.is_finite()));
        }
        if config.show_bath_temperature {
            bt_vals.extend(exp.points.iter()
                .filter_map(|p| p.bath_temperature_c).filter(|v| v.is_finite()));
        }
    }

    // ── 2. Per-metric nice scales ──────────────────────────────────────────
    let (t_min_raw, t_max_raw) = get_raw_min_max(&time_vals, 0.0, 10.0);
    let (_, _, x_step, x_minor_step) = calculate_nice_scale(t_min_raw, t_max_raw, 8, false);
    let x_min = t_min_raw;
    let x_max = t_max_raw;

    let (vm_raw, vx_raw) = get_raw_min_max(&visc_vals, 0.0, 100.0);
    let (visc_min, visc_max, visc_step, visc_minor) = calculate_nice_scale(vm_raw, vx_raw, 12, true);

    // Bath + sample temperature share the temperature axis (same °C scale).
    let temp_and_bt_vals: Vec<f64> = temp_vals.iter().chain(bt_vals.iter()).copied().collect();
    let (temp_min, temp_max, temp_step, temp_minor) = if !temp_and_bt_vals.is_empty() {
        let (a, b) = get_raw_min_max(&temp_and_bt_vals, 0.0, 100.0);
        calculate_nice_scale(a, b, 12, true)
    } else { (0.0, 100.0, 20.0, 4.0) };

    let (sr_min, sr_max, sr_step, sr_minor) = if !sr_vals.is_empty() {
        let (a, b) = get_raw_min_max(&sr_vals, 0.0, 100.0);
        calculate_nice_scale(a, b, 12, true)
    } else { (0.0, 100.0, 20.0, 4.0) };

    let (pr_min, pr_max, pr_step, pr_minor) = if !pr_vals.is_empty() {
        let (a, b) = get_raw_min_max(&pr_vals, 0.0, 100.0);
        calculate_nice_scale(a, b, 12, true)
    } else { (0.0, 100.0, 20.0, 4.0) };

    // ── 3. Build IndividualAxisInfo lists ──────────────────────────────────
    // For comparison reports the axis tick-colour uses the *metric*
    // reference colour from `line_styles` (viscosity = blue, etc.) so the
    // user can tell axes apart — per-experiment colour is used only for the
    // data series themselves.
    let styles = config.line_styles.as_ref().cloned().unwrap_or_default();
    let rgb_str = |c: RGBColor| format!("#{:02X}{:02X}{:02X}", c.0, c.1, c.2);

    let mut left_axes:  Vec<IndividualAxisInfo> = Vec::new();
    let mut right_axes: Vec<IndividualAxisInfo> = Vec::new();

    // Viscosity: always left idx 0
    left_axes.push(IndividualAxisInfo {
        min: visc_min, max: visc_max, step: visc_step, minor_step: visc_minor,
        metric: "viscosity".to_string(), side: "left".to_string(), side_idx: 0,
        color_hex: rgb_str(styles.viscosity.color),
    });

    // Temperature (covers sample + bath — one shared °C scale).  The
    // metric tag chosen here drives which title the Typst overlay prints
    // above the axis column:
    //   "temperature"              → "Температура (°C)"            (sample only)
    //   "bath_temperature"         → "Темп. бани (°C)"              (bath only)
    //   "temperature_and_bath"     → "Темп. образца / Темп. бани (°C)" (both)
    if (config.show_temperature || config.show_bath_temperature) && !temp_and_bt_vals.is_empty() {
        let metric_tag = match (config.show_temperature, config.show_bath_temperature) {
            (true, true)  => "temperature_and_bath",
            (false, true) => "bath_temperature",
            _             => "temperature",
        };
        right_axes.push(IndividualAxisInfo {
            min: temp_min, max: temp_max, step: temp_step, minor_step: temp_minor,
            metric: metric_tag.to_string(), side: "right".to_string(), side_idx: 0,
            color_hex: rgb_str(styles.temperature.color),
        });
    }

    // Shear rate
    if config.show_shear_rate && !sr_vals.is_empty() {
        if config.shear_rate_axis.trim().to_lowercase() == "left" {
            let idx = left_axes.len();
            left_axes.push(IndividualAxisInfo {
                min: sr_min, max: sr_max, step: sr_step, minor_step: sr_minor,
                metric: "shear_rate".to_string(), side: "left".to_string(), side_idx: idx,
                color_hex: rgb_str(styles.shear_rate.color),
            });
        } else {
            let idx = right_axes.len();
            right_axes.push(IndividualAxisInfo {
                min: sr_min, max: sr_max, step: sr_step, minor_step: sr_minor,
                metric: "shear_rate".to_string(), side: "right".to_string(), side_idx: idx,
                color_hex: rgb_str(styles.shear_rate.color),
            });
        }
    }

    // Pressure
    if config.show_pressure && !pr_vals.is_empty() {
        if config.pressure_axis.trim().to_lowercase() == "left" {
            let idx = left_axes.len();
            left_axes.push(IndividualAxisInfo {
                min: pr_min, max: pr_max, step: pr_step, minor_step: pr_minor,
                metric: "pressure".to_string(), side: "left".to_string(), side_idx: idx,
                color_hex: rgb_str(styles.pressure.color),
            });
        } else {
            let idx = right_axes.len();
            right_axes.push(IndividualAxisInfo {
                min: pr_min, max: pr_max, step: pr_step, minor_step: pr_minor,
                metric: "pressure".to_string(), side: "right".to_string(), side_idx: idx,
                color_hex: rgb_str(styles.pressure.color),
            });
        }
    }

    // ── 4. Dynamic per-side margins ────────────────────────────────────────
    const AXIS_SPACING_PX: u32 = 60;
    const TICK_MARGIN:     u32 = 10;
    let n_left_extra  = (left_axes.len()  as u32).saturating_sub(1);
    let n_right_extra = (right_axes.len() as u32).saturating_sub(1);
    // Symmetric margin.  Previously clamped to `.max(1)` which forced
    // 70 px of blank internal padding on each side even for a plain
    // viscosity-only chart; the Typst overlay positions tick labels and
    // axis titles absolutely (allowed to overflow into the page margin),
    // so `extra = 0` is now valid and keeps the plot area flush with the
    // 2-cm Typst page edge — matching the user's layout requirement.
    let min_extra = n_left_extra.max(n_right_extra);
    let left_margin  = TICK_MARGIN + min_extra * AXIS_SPACING_PX;
    let right_margin = TICK_MARGIN + min_extra * AXIS_SPACING_PX;

    // ── 5. Render SVG ──────────────────────────────────────────────────────
    let mut svg_buf = String::new();
    // Individual-axis mode draws data series as pixel-space `PathElement`s
    // (see the `draw_series` closure below), which plotters serialises as
    // `<path>` tags.  We still record `(data_series_idx, style)` pairs so
    // `inject_series_dasharray` can target the right element regardless
    // of whether plotters emitted a polyline or a path — preventing the
    // 2026-04-24 dash-leak bug (see the helper docs at file top).
    let mut dash_targets: Vec<(usize, String)> = Vec::new();
    let mut data_series_idx: usize = 0;
    let experiment_colors_hex: Vec<String> = experiments
        .iter()
        .map(|e| format!("#{:02X}{:02X}{:02X}", e.color.0, e.color.1, e.color.2))
        .collect();
    {
        let root = SVGBackend::with_string(&mut svg_buf, (config.width, config.height))
            .into_drawing_area();
        root.fill(&WHITE).map_err(|e| e.to_string())?;

        // Grid — anchored to viscosity scale purely for visual reference.
        {
            let mut chart = ChartBuilder::on(&root)
                .margin_top(TICK_MARGIN)
                .margin_bottom(TICK_MARGIN)
                .margin_left(left_margin)
                .margin_right(right_margin)
                .x_label_area_size(0)
                .y_label_area_size(0)
                .right_y_label_area_size(0)
                .build_cartesian_2d(x_min..x_max, visc_min..visc_max)
                .map_err(|e| e.to_string())?;

            let grid_style = C_GRID.stroke_width(1);

            if x_step > 1e-10 {
                let start = (x_min / x_step).ceil() * x_step;
                let mut xg = if start < x_min - 1e-6 { start + x_step } else { start };
                while xg <= x_max + 1e-6 {
                    chart.draw_series(LineSeries::new(
                        vec![(xg, visc_min), (xg, visc_max)], grid_style,
                    )).ok();
                    xg += x_step;
                }
            }

            if visc_step > 1e-10 {
                let start = (visc_min / visc_step).ceil() * visc_step;
                let mut yg = if start < visc_min - 1e-6 { start + visc_step } else { start };
                while yg <= visc_max + 1e-6 {
                    chart.draw_series(LineSeries::new(
                        vec![(x_min, yg), (x_max, yg)], grid_style,
                    )).ok();
                    yg += visc_step;
                }
            }

            // Bottom reference line
            let c_bottom = RGBColor(71, 85, 105);
            chart.draw_series(LineSeries::new(
                vec![(x_min, visc_min), (x_max, visc_min)], c_bottom.stroke_width(1),
            )).ok();
        } // chart scope

        // ── 6. Pixel-coord helpers ────────────────────────────────────────
        let tm_l = left_margin  as f64;
        let tm_r = right_margin as f64;
        let chart_w          = config.width  as f64 - tm_l - tm_r;
        let chart_h          = config.height as f64 - 2.0 * TICK_MARGIN as f64;
        let chart_left_px    = tm_l;
        let chart_right_px   = config.width  as f64 - tm_r;
        let chart_top_px     = TICK_MARGIN as f64;
        let chart_bottom_px  = config.height as f64 - TICK_MARGIN as f64;

        let px_x = |dx: f64| -> i32 {
            (tm_l + (dx - x_min) / (x_max - x_min).max(1e-10) * chart_w).round() as i32
        };
        let px_y = |val: f64, ymin: f64, ymax: f64| -> i32 {
            let pct = (val - ymin) / (ymax - ymin).max(1e-10);
            (chart_bottom_px - pct * chart_h).round() as i32
        };

        // Multi-experiment draw helper.  Unlike single-exp we colour by
        // experiment (not by metric); width + dash style still follow the
        // metric's `line_styles` entry so every series of the same metric
        // shares its line style, just in different colours.
        //
        // `data_series_idx` advances exactly once per emitted `<path>`
        // (i.e. only when `pts.len() > 1`) so the dash-injector's counter
        // stays aligned with what plotters writes to the SVG stream.
        let mut draw_series = |data: &[(f64, f64)], ymin: f64, ymax: f64,
                                color: RGBColor, width: u32, style_str: &str| {
            let pts: Vec<(i32, i32)> = data.iter()
                .map(|(x, y)| (px_x(*x), px_y(*y, ymin, ymax)))
                .collect();
            if pts.len() > 1 {
                root.draw(&PathElement::new(pts, color.stroke_width(width))).ok();
                if style_str != "solid" {
                    dash_targets.push((data_series_idx, style_str.to_string()));
                }
                data_series_idx += 1;
            }
        };

        // ── 7. Per-experiment series ──────────────────────────────────────
        for exp in experiments {
            let exp_color = exp.color;

            // Viscosity (left-0, mandatory)
            let d_visc: Vec<(f64, f64)> = exp.points.iter()
                .map(|p| (p.time_min, p.viscosity_cp))
                .filter(|(x, y)| x.is_finite() && y.is_finite())
                .collect();
            draw_series(&d_visc, visc_min, visc_max, exp_color,
                        styles.viscosity.width, &styles.viscosity.style);

            if config.show_temperature && !temp_vals.is_empty() {
                let d: Vec<(f64, f64)> = exp.points.iter()
                    .filter_map(|p| p.temperature_c.map(|v| (p.time_min, v)))
                    .filter(|(x, y)| x.is_finite() && y.is_finite())
                    .collect();
                draw_series(&d, temp_min, temp_max, exp_color,
                            styles.temperature.width, &styles.temperature.style);
            }

            if config.show_shear_rate && !sr_vals.is_empty() {
                let d: Vec<(f64, f64)> = exp.points.iter()
                    .filter_map(|p| p.shear_rate.map(|v| (p.time_min, v)))
                    .filter(|(x, y)| x.is_finite() && y.is_finite())
                    .collect();
                draw_series(&d, sr_min, sr_max, exp_color,
                            styles.shear_rate.width, &styles.shear_rate.style);
            }

            if config.show_pressure && !pr_vals.is_empty() {
                let d: Vec<(f64, f64)> = exp.points.iter()
                    .filter_map(|p| p.pressure_bar.map(|v| (p.time_min, v)))
                    .filter(|(x, y)| x.is_finite() && y.is_finite())
                    .collect();
                draw_series(&d, pr_min, pr_max, exp_color,
                            styles.pressure.width, &styles.pressure.style);
            }

            if config.show_bath_temperature && !bt_vals.is_empty() {
                let d: Vec<(f64, f64)> = exp.points.iter()
                    .filter_map(|p| p.bath_temperature_c.map(|v| (p.time_min, v)))
                    .filter(|(x, y)| x.is_finite() && y.is_finite())
                    .collect();
                draw_series(&d, temp_min, temp_max, exp_color,
                            styles.bath_temperature.width, &styles.bath_temperature.style);
            }
        }

        // ── 8. Touch-point markers (viscosity axis) ───────────────────────
        //
        // Marker uses the **experiment colour** (visual continuity with the
        // series line), but the **label** is always rendered in black so the
        // numeric readout stays legible against any palette hue — matches
        // the user's requirement "цифры точек касания чёрным цветом".  The
        // shared-axis branch (line ~617) already does this; individual mode
        // used to mirror `tp.color` into the label which produced unreadable
        // cyan-on-white and lavender-on-white labels.
        for tp in &config.touch_points {
            let px = px_x(tp.time);
            let py = px_y(tp.viscosity, visc_min, visc_max);
            if px >= chart_left_px as i32 && px <= chart_right_px as i32
                && py >= chart_top_px as i32 && py <= chart_bottom_px as i32
            {
                root.draw(&Circle::new((px, py), 5, tp.color.filled())).ok();
                root.draw(&Circle::new((px, py), 5, WHITE.stroke_width(1))).ok();
                let label_color = RGBColor(0, 0, 0);
                let label_style = TextStyle::from(("sans-serif", 10).into_font().color(&label_color))
                    .pos(Pos::new(HPos::Center, VPos::Bottom));
                root.draw_text(&tp.label, &label_style, (px, py - 7)).ok();
            }
        }

        // ── 9. Threshold line (viscosity axis) ────────────────────────────
        if let Some(threshold) = config.viscosity_threshold {
            let py = px_y(threshold, visc_min, visc_max);
            if py >= chart_top_px as i32 && py <= chart_bottom_px as i32 {
                let left_x  = chart_left_px as i32;
                let right_x = chart_right_px as i32;
                let dash_w  = 6i32;
                let gap_w   = 4i32;
                let threshold_color = RGBColor(0, 0, 0);
                let mut x = left_x;
                while x < right_x {
                    let x2 = (x + dash_w).min(right_x);
                    root.draw(&PathElement::new(vec![(x, py), (x2, py)], threshold_color.stroke_width(1))).ok();
                    x += dash_w + gap_w;
                }
                let label = format!("{} cP", threshold as i32);
                let style = TextStyle::from(("sans-serif", 11).into_font().color(&threshold_color))
                    .pos(Pos::new(HPos::Right, VPos::Center));
                root.draw_text(&label, &style, (left_x - 4, py)).ok();
            }
        }

        // ── 10. Per-metric axis lines + tick marks ────────────────────────
        let tick_major = 6i32;
        let tick_minor = 3i32;

        for axis in &left_axes {
            let x_pos = (chart_left_px - axis.side_idx as f64 * AXIS_SPACING_PX as f64) as i32;
            let color = parse_hex_color(&axis.color_hex);
            root.draw(&PathElement::new(
                vec![(x_pos, chart_top_px as i32), (x_pos, chart_bottom_px as i32)],
                color.stroke_width(1),
            )).ok();
            if axis.minor_step > 1e-10 {
                let start = (axis.min / axis.minor_step).ceil() * axis.minor_step;
                let mut yt = if start < axis.min - 1e-6 { start + axis.minor_step } else { start };
                while yt <= axis.max + 1e-6 {
                    let is_major = axis.step > 1e-10
                        && ((yt / axis.step).round() * axis.step - yt).abs() < axis.minor_step * 0.1;
                    let tlen = if is_major { tick_major } else { tick_minor };
                    let py = px_y(yt, axis.min, axis.max);
                    root.draw(&PathElement::new(
                        vec![(x_pos, py), (x_pos - tlen, py)], color.stroke_width(1),
                    )).ok();
                    yt += axis.minor_step;
                }
            }
        }

        for axis in &right_axes {
            let x_pos = (chart_right_px + axis.side_idx as f64 * AXIS_SPACING_PX as f64) as i32;
            let color = parse_hex_color(&axis.color_hex);
            root.draw(&PathElement::new(
                vec![(x_pos, chart_top_px as i32), (x_pos, chart_bottom_px as i32)],
                color.stroke_width(1),
            )).ok();
            if axis.minor_step > 1e-10 {
                let start = (axis.min / axis.minor_step).ceil() * axis.minor_step;
                let mut yt = if start < axis.min - 1e-6 { start + axis.minor_step } else { start };
                while yt <= axis.max + 1e-6 {
                    let is_major = axis.step > 1e-10
                        && ((yt / axis.step).round() * axis.step - yt).abs() < axis.minor_step * 0.1;
                    let tlen = if is_major { tick_major } else { tick_minor };
                    let py = px_y(yt, axis.min, axis.max);
                    root.draw(&PathElement::new(
                        vec![(x_pos, py), (x_pos + tlen, py)], color.stroke_width(1),
                    )).ok();
                    yt += axis.minor_step;
                }
            }
        }

        // Bottom axis ticks
        let c_bottom = RGBColor(71, 85, 105);
        if x_minor_step > 1e-10 {
            let start = (x_min / x_minor_step).ceil() * x_minor_step;
            let mut xt = if start < x_min - 1e-6 { start + x_minor_step } else { start };
            while xt <= x_max + 1e-6 {
                let is_major = x_step > 1e-10
                    && ((xt / x_step).round() * x_step - xt).abs() < x_minor_step * 0.1;
                let tlen = if is_major { tick_major } else { tick_minor };
                let px = px_x(xt);
                let py = chart_bottom_px as i32;
                root.draw(&PathElement::new(
                    vec![(px, py), (px, py + tlen)], c_bottom.stroke_width(1),
                )).ok();
                xt += x_minor_step;
            }
        }

        root.present().map_err(|e| e.to_string())?;
    } // svg scope

    // ── 11. Post-processing: grid dash + series dash/dot ──────────────────
    svg_buf = svg_buf.replace(
        r##"opacity="1" stroke="#C8C8C8" stroke-width="1""##,
        r##"opacity="0.4" stroke="#C8C8C8" stroke-width="0.5" stroke-dasharray="4,4""##,
    );
    // Apply dash style only to the specific data-series paths we flagged.
    // See `inject_series_dasharray` docs for the rationale — individual
    // mode also suffers the same colour-leak bug when a single experiment
    // has multiple metrics, so the fix must be applied here too.
    svg_buf = inject_series_dasharray(svg_buf, &experiment_colors_hex, &dash_targets);

    // ── 12. Assemble ChartRanges ───────────────────────────────────────────
    let mut individual_axes_out = left_axes.clone();
    individual_axes_out.extend(right_axes.clone());

    Ok((svg_buf, ChartRanges {
        x_min, x_max, x_step, x_minor_step,
        y_left_min: visc_min, y_left_max: visc_max,
        y_left_step: visc_step, y_left_minor_step: visc_minor,
        y_right_min: right_axes.first().map_or(0.0, |a| a.min),
        y_right_max: right_axes.first().map_or(100.0, |a| a.max),
        y_right_step: right_axes.first().map_or(20.0, |a| a.step),
        y_right_minor_step: right_axes.first().map_or(4.0, |a| a.minor_step),
        individual_axes: individual_axes_out,
    }))
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_points(n: usize, visc_base: f64, temp_base: f64) -> Vec<ChartPoint> {
        (0..n).map(|i| {
            let t = i as f64;
            ChartPoint {
                time_min: t,
                viscosity_cp: visc_base + t * 5.0,
                temperature_c: Some(temp_base + t * 0.5),
                shear_rate: Some(100.0),
                pressure_bar: None,
                bath_temperature_c: None,
            }
        }).collect()
    }

    fn mk_config() -> ChartConfig {
        ChartConfig {
            show_temperature: true,
            show_shear_rate: false,
            show_pressure: false,
            show_bath_temperature: false,
            shear_rate_axis: "left".to_string(),
            pressure_axis: "right".to_string(),
            axis_mode: "shared".to_string(),
            width: 1400,
            height: 700,
            label_left: "Viscosity".into(),
            label_right: "Temperature".into(),
            label_bottom: "Time".into(),
            name_viscosity: "V".into(),
            name_temperature: "T".into(),
            name_shear_rate: "S".into(),
            name_pressure: "P".into(),
            name_bath_temperature: "BT".into(),
            touch_points: vec![],
            viscosity_threshold: None,
            line_styles: None,
            skip_downsample: true,
            time_format: String::new(),
        }
    }

    #[test]
    fn renders_two_experiment_svg_with_expected_colours() {
        let experiments = vec![
            ExperimentSeries {
                points: mk_points(10, 500.0, 20.0),
                color: RGBColor(0xFF, 0x00, 0x00),
                display_name: "Exp A".into(),
            },
            ExperimentSeries {
                points: mk_points(10, 700.0, 25.0),
                color: RGBColor(0x00, 0x80, 0x00),
                display_name: "Exp B".into(),
            },
        ];
        let (svg, ranges) = generate_multi_experiment_chart_svg(&experiments, &mk_config())
            .expect("render should succeed");

        assert!(svg.starts_with("<svg"), "expected SVG prefix");
        assert!(svg.contains("#FF0000"), "expected first experiment colour (red)");
        assert!(svg.contains("#008000"), "expected second experiment colour (green)");
        // X range should cover the data (0..9) minutes
        assert!((ranges.x_min - 0.0).abs() < 1e-6);
        assert!((ranges.x_max - 9.0).abs() < 1e-6);
        // Left scale must envelope both experiments' viscosity [500..745]
        assert!(ranges.y_left_min <= 500.0);
        assert!(ranges.y_left_max >= 745.0);
    }

    #[test]
    fn errors_on_empty_experiments() {
        let config = mk_config();
        let err = generate_multi_experiment_chart_svg(&[], &config).unwrap_err();
        assert!(err.contains("No experiments"));
    }

    #[test]
    fn errors_when_all_experiments_empty() {
        let experiments = vec![ExperimentSeries {
            points: vec![],
            color: RGBColor(0, 0, 0),
            display_name: "empty".into(),
        }];
        let err = generate_multi_experiment_chart_svg(&experiments, &mk_config())
            .unwrap_err();
        assert!(err.contains("No data points"));
    }

    #[test]
    fn single_experiment_renders_like_shared_single() {
        // When N=1 the output should be a valid SVG and the axis-mode behaviour
        // should match the shared-axis single-exp path closely enough for smoke.
        let experiments = vec![ExperimentSeries {
            points: mk_points(50, 500.0, 20.0),
            color: RGBColor(0x3B, 0x82, 0xF6),
            display_name: "solo".into(),
        }];
        let (svg, _) = generate_multi_experiment_chart_svg(&experiments, &mk_config()).unwrap();
        assert!(svg.contains("<svg"));
        assert!(svg.contains("#3B82F6"), "single-exp colour should be present");
    }

    #[test]
    fn downsamples_when_skip_flag_false() {
        let mut cfg = mk_config();
        cfg.skip_downsample = false;
        // 10_000 points per experiment → downsample applied → SVG stays reasonably small.
        let experiments = vec![
            ExperimentSeries {
                points: mk_points(10_000, 500.0, 20.0),
                color: RGBColor(0xFF, 0x00, 0x00),
                display_name: "a".into(),
            },
            ExperimentSeries {
                points: mk_points(10_000, 700.0, 25.0),
                color: RGBColor(0x00, 0x80, 0x00),
                display_name: "b".into(),
            },
        ];
        let (svg, _) = generate_multi_experiment_chart_svg(&experiments, &cfg).unwrap();
        // 2 series × 750 pts each ≈ ~30 KB after Plotters; way less than the
        // 20k-pt-per-experiment worst case of ~2 MB.  Sanity check only.
        assert!(svg.len() < 500_000, "SVG should be downsampled; got {} bytes", svg.len());
    }

    /// **Regression — 2026-04-24 viscosity-reported-dashed bug**
    ///
    /// In the **shared-axis** comparison chart, every metric of a single
    /// experiment uses the **same** experiment palette colour (the
    /// comparison UI distinguishes metrics by dash style, not hue).  The
    /// legacy post-processing collapsed `(stroke, stroke-width)` into a
    /// string-replace key, so setting `bath_temperature.style = "dashed"`
    /// accidentally re-wrote **every** polyline of that experiment's
    /// colour — including viscosity and temperature — to have
    /// `stroke-dasharray="8,4"`.
    ///
    /// The user-visible symptom (screenshot attached to the bug report):
    /// viscosity curves appeared dashed in the PDF despite being set to
    /// `"solid"` in the settings panel.
    ///
    /// Invariant this test locks in: for a single-experiment comparison
    /// chart with `viscosity.style = "solid"` and
    /// `bath_temperature.style = "dashed"`, exactly **one** polyline
    /// attached to that experiment's stroke colour carries
    /// `stroke-dasharray`.  Zero would mean the dash overlay is lost;
    /// two (or more) is the regressed behaviour.
    #[test]
    fn dashed_bath_temp_does_not_leak_to_same_coloured_viscosity() {
        use crate::report_generator::types::{LineSettings, ChartLineSettings};

        // Single experiment with a deliberately unique colour so our
        // matcher can find its polylines without clashing with axis
        // colours (#3B82F6 / #F97316 / #475569) or the grid (#C8C8C8).
        let experiments = vec![ExperimentSeries {
            points: (0..15).map(|i| {
                let t = i as f64;
                ChartPoint {
                    time_min: t,
                    viscosity_cp: 500.0 + t * 10.0,
                    temperature_c: Some(40.0 + t * 0.5),
                    shear_rate: None,
                    pressure_bar: None,
                    bath_temperature_c: Some(60.0 + t * 0.2),
                }
            }).collect(),
            color: RGBColor(0x12, 0x34, 0x56), // outside axis / grid palette
            display_name: "regression".into(),
        }];

        // Settings: viscosity solid, temperature solid, bath temp dashed.
        let ls = ChartLineSettings {
            viscosity: LineSettings { color: "#123456".into(), width: 2, style: "solid".into() },
            temperature: LineSettings { color: "#123456".into(), width: 2, style: "solid".into() },
            shear_rate: LineSettings::default(),
            pressure: LineSettings::default(),
            rpm: LineSettings::default(),
            bath_temperature: Some(LineSettings {
                color: "#123456".into(),
                width: 2,
                style: "dashed".into(),
            }),
        };

        let mut cfg = mk_config();
        cfg.show_temperature = true;
        cfg.show_bath_temperature = true;
        cfg.line_styles = Some((&ls).into());

        let (svg, _) = generate_multi_experiment_chart_svg(&experiments, &cfg)
            .expect("render should succeed");

        // Sanity check: experiment colour is actually present.
        assert!(
            svg.contains("#123456"),
            "expected experiment stroke colour #123456 in SVG output",
        );

        // Count polylines attached to the experiment colour that carry
        // `stroke-dasharray`.  With the bug, viscosity + temperature +
        // bath_temp all match → 3.  Correct behaviour: only bath_temp → 1.
        let mut dashed_exp_polylines = 0usize;
        for chunk in svg.split("<polyline").skip(1) {
            // chunk spans up to the next "<polyline" marker; the opening
            // tag we care about is bounded by the first "/>" or ">".
            let tag_end = chunk.find("/>").unwrap_or_else(|| chunk.find(">").unwrap_or(chunk.len()));
            let tag = &chunk[..tag_end];
            let has_exp_colour = tag.contains(r##"stroke="#123456""##);
            let has_dash       = tag.contains("stroke-dasharray");
            if has_exp_colour && has_dash {
                dashed_exp_polylines += 1;
            }
        }

        assert_eq!(
            dashed_exp_polylines, 1,
            "expected exactly 1 dashed polyline (bath_temperature), got {}. \
             Bug symptom: viscosity and/or temperature polylines also received \
             stroke-dasharray because they share the experiment's stroke colour.",
            dashed_exp_polylines,
        );
    }

    #[test]
    fn threshold_line_rendered_when_set() {
        // Compare SVG size with and without a threshold line: the threshold
        // path adds multiple short dashed segments + glyph paths for the
        // label, so its SVG should be meaningfully larger.  Text in Plotters
        // is rendered as `<path>` glyphs (not `<text>`), so we can't assert
        // on the literal label string.
        let mut cfg_no = mk_config();
        cfg_no.viscosity_threshold = None;
        let experiments = vec![ExperimentSeries {
            points: mk_points(10, 500.0, 20.0),
            color: RGBColor(0xAB, 0xCD, 0xEF),
            display_name: "x".into(),
        }];
        let (svg_no, _) = generate_multi_experiment_chart_svg(&experiments, &cfg_no).unwrap();

        let mut cfg_yes = mk_config();
        // Data range for mk_points(10, 500, _) is viscosity ∈ [500, 545].
        // Keep the threshold inside that range so it is actually drawn.
        cfg_yes.viscosity_threshold = Some(520.0);
        let (svg_yes, _) = generate_multi_experiment_chart_svg(&experiments, &cfg_yes).unwrap();

        assert!(
            svg_yes.len() > svg_no.len(),
            "threshold SVG should be larger than without; got {} vs {}",
            svg_yes.len(),
            svg_no.len(),
        );
    }
}
