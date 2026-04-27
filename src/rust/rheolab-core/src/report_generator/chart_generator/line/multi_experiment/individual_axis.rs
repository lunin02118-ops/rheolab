//! Individual-axis renderer (multi-experiment).
//!
//! Mirrors the single-experiment `individual::render` but draws every metric's
//! series once per experiment using that experiment's palette colour.  Each
//! visible metric gets its own Y scale and dedicated axis column (viscosity
//! always on left idx 0; shear rate / pressure follow their *_axis setting;
//! temperature + bath_temperature share the right-side °C axis).

use plotters::prelude::*;
use plotters::element::PathElement;
use plotters::style::text_anchor::{Pos, HPos, VPos};

use super::super::super::common::*;
use super::ExperimentSeries;
use super::dash_inject::inject_series_dasharray;

/// Render the individual-axis SVG for a pre-downsampled set of experiments.
pub(super) fn render(
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
    // 2026-04-24 dash-leak bug (see `dash_inject.rs` docs).
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
        // shared-axis branch already does this; individual mode used to
        // mirror `tp.color` into the label which produced unreadable
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
    // See `dash_inject.rs` docs for the rationale — individual mode also
    // suffers the same colour-leak bug when a single experiment has
    // multiple metrics, so the fix must be applied here too.
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
