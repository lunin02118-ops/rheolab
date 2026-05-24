//! Shared-axis renderer: every metric of every experiment lands on one
//! left + one right Y scale.  This is the default layout for the
//! comparison report (page 1 / sheet 1).

use plotters::element::PathElement;
use plotters::prelude::*;
use plotters::style::text_anchor::{HPos, Pos, VPos};

use super::super::super::common::*;
use super::dash_inject::inject_series_dasharray;
use super::ExperimentSeries;

/// Render the shared-axis SVG for a pre-downsampled set of experiments.
///
/// Caller (`super::generate_multi_experiment_chart_svg`) is responsible
/// for empty-input validation and LTTB downsampling — this function
/// assumes both have been done already.
pub(super) fn render(
    experiments: &[ExperimentSeries],
    config: &ChartConfig,
) -> Result<(String, ChartRanges), String> {
    // ── Aggregate per-axis value pools across all experiments ──────────────
    let mut left_vals: Vec<f64> = Vec::new();
    let mut right_vals: Vec<f64> = Vec::new();
    let mut time_vals: Vec<f64> = Vec::new();

    for exp in experiments {
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
                exp.points
                    .iter()
                    .filter_map(|p| p.temperature_c)
                    .filter(|v| v.is_finite()),
            );
        }
        if config.show_shear_rate {
            let vals: Vec<f64> = exp
                .points
                .iter()
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
            let vals: Vec<f64> = exp
                .points
                .iter()
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
                exp.points
                    .iter()
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
    let experiment_colors_hex: Vec<String> = experiments.iter().map(|e| rgb_str(e.color)).collect();
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
            + if config.show_shear_rate && config.shear_rate_axis.trim().to_lowercase() == "left" {
                1
            } else {
                0
            }
            + if config.show_pressure && config.pressure_axis.trim().to_lowercase() == "left" {
                1
            } else {
                0
            };
        let n_right_sh: usize =
            if config.show_temperature || config.show_bath_temperature {
                1
            } else {
                0
            } + if config.show_shear_rate && config.shear_rate_axis.trim().to_lowercase() == "right"
            {
                1
            } else {
                0
            } + if config.show_pressure && config.pressure_axis.trim().to_lowercase() == "right" {
                1
            } else {
                0
            };
        let min_extra_sh =
            ((n_left_sh.saturating_sub(1)) as u32).max((n_right_sh.saturating_sub(1)) as u32);
        let left_margin_sh = TICK_MARGIN_SH + min_extra_sh * AXIS_SPACING_PX_SH;
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
                let mut xg = if x_grid_start < x_min - 1e-6 {
                    x_grid_start + x_step
                } else {
                    x_grid_start
                };
                while xg <= x_max + 1e-6 {
                    chart
                        .draw_series(LineSeries::new(
                            vec![(xg, y_left_min), (xg, y_left_max)],
                            grid_style,
                        ))
                        .ok();
                    xg += x_step;
                }
            }
            if y_left_step > 1e-10 {
                let y_grid_start = (y_left_min / y_left_step).ceil() * y_left_step;
                let mut yg = if y_grid_start < y_left_min - 1e-6 {
                    y_grid_start + y_left_step
                } else {
                    y_grid_start
                };
                while yg <= y_left_max + 1e-6 {
                    chart
                        .draw_series(LineSeries::new(vec![(x_min, yg), (x_max, yg)], grid_style))
                        .ok();
                    yg += y_left_step;
                }
            }

            // Axis frame colours
            let c_left_axis = RGBColor(59, 130, 246);
            let c_right_axis = RGBColor(249, 115, 22);
            let c_bottom_axis = RGBColor(71, 85, 105);

            let has_right_axis = config.show_temperature
                || config.show_bath_temperature
                || (config.show_shear_rate
                    && config.shear_rate_axis.trim().to_lowercase() == "right")
                || (config.show_pressure && config.pressure_axis.trim().to_lowercase() == "right");

            chart
                .draw_series(LineSeries::new(
                    vec![(x_min, y_left_min), (x_max, y_left_min)],
                    c_bottom_axis.stroke_width(1),
                ))
                .ok();
            chart
                .draw_series(LineSeries::new(
                    vec![(x_min, y_left_min), (x_min, y_left_max)],
                    c_left_axis.stroke_width(1),
                ))
                .ok();
            if has_right_axis {
                chart
                    .draw_series(LineSeries::new(
                        vec![(x_max, y_left_min), (x_max, y_left_max)],
                        c_right_axis.stroke_width(1),
                    ))
                    .ok();
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
            // see `inject_series_dasharray` in `dash_inject.rs`.
            for exp in experiments {
                let exp_color = exp.color;

                // Viscosity — left axis, mandatory
                let visc_data: Vec<(f64, f64)> = exp
                    .points
                    .iter()
                    .map(|p| (p.time_min, p.viscosity_cp))
                    .collect();
                let visc_width = styles.viscosity.width;
                chart
                    .draw_series(LineSeries::new(
                        visc_data,
                        exp_color.stroke_width(visc_width),
                    ))
                    .map_err(|e| e.to_string())?;
                if styles.viscosity.style != "solid" {
                    dash_targets.push((data_series_idx, styles.viscosity.style.clone()));
                }
                data_series_idx += 1;

                // Temperature — right axis
                if config.show_temperature {
                    let t_data: Vec<(f64, f64)> = exp
                        .points
                        .iter()
                        .filter_map(|p| p.temperature_c.map(|v| (p.time_min, v)))
                        .collect();
                    if !t_data.is_empty() {
                        let w = styles.temperature.width;
                        chart
                            .draw_secondary_series(LineSeries::new(
                                t_data,
                                exp_color.stroke_width(w),
                            ))
                            .map_err(|e| e.to_string())?;
                        if styles.temperature.style != "solid" {
                            dash_targets.push((data_series_idx, styles.temperature.style.clone()));
                        }
                        data_series_idx += 1;
                    }
                }

                // Shear rate
                if config.show_shear_rate {
                    let sr_data: Vec<(f64, f64)> = exp
                        .points
                        .iter()
                        .filter_map(|p| p.shear_rate.map(|v| (p.time_min, v)))
                        .collect();
                    if !sr_data.is_empty() {
                        let w = styles.shear_rate.width;
                        let is_right = config.shear_rate_axis.trim().to_lowercase() == "right";
                        let series = LineSeries::new(sr_data, exp_color.stroke_width(w));
                        if is_right {
                            chart
                                .draw_secondary_series(series)
                                .map_err(|e| e.to_string())?;
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
                    let pr_data: Vec<(f64, f64)> = exp
                        .points
                        .iter()
                        .filter_map(|p| p.pressure_bar.map(|v| (p.time_min, v)))
                        .collect();
                    if !pr_data.is_empty() {
                        let w = styles.pressure.width;
                        let is_right = config.pressure_axis.trim().to_lowercase() == "right";
                        let series = LineSeries::new(pr_data, exp_color.stroke_width(w));
                        if is_right {
                            chart
                                .draw_secondary_series(series)
                                .map_err(|e| e.to_string())?;
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
                    let bt_data: Vec<(f64, f64)> = exp
                        .points
                        .iter()
                        .filter_map(|p| p.bath_temperature_c.map(|v| (p.time_min, v)))
                        .collect();
                    if !bt_data.is_empty() {
                        let w = styles.bath_temperature.width;
                        chart
                            .draw_secondary_series(LineSeries::new(
                                bt_data,
                                exp_color.stroke_width(w),
                            ))
                            .map_err(|e| e.to_string())?;
                        if styles.bath_temperature.style != "solid" {
                            dash_targets
                                .push((data_series_idx, styles.bath_temperature.style.clone()));
                        }
                        data_series_idx += 1;
                    }
                }
            }
        } // end chart scope

        // ── Tick marks (pixel coords) ──────────────────────────────────────
        let tm_top = TICK_MARGIN_SH as f64;
        let tm_bottom = TICK_MARGIN_SH as f64;
        let tm_left = left_margin_sh as f64;
        let tm_right = right_margin_sh as f64;
        let chart_w = config.width as f64 - tm_left - tm_right;
        let chart_h = config.height as f64 - tm_top - tm_bottom;
        let chart_bottom_px = config.height as f64 - tm_bottom;
        let chart_left_px = tm_left;
        let chart_right_px = config.width as f64 - tm_right;

        let data_to_px_x = |dx: f64| -> i32 {
            (tm_left + (dx - x_min) / (x_max - x_min).max(1e-10) * chart_w) as i32
        };
        let data_to_px_y_left = |dy: f64| -> i32 {
            (tm_top + (1.0 - (dy - y_left_min) / (y_left_max - y_left_min).max(1e-10)) * chart_h)
                as i32
        };
        let data_to_px_y_right = |dy: f64| -> i32 {
            (tm_top + (1.0 - (dy - y_right_min) / (y_right_max - y_right_min).max(1e-10)) * chart_h)
                as i32
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
            let mut xt = if xt_start < x_min - 1e-6 {
                xt_start + x_minor_step
            } else {
                xt_start
            };
            while xt <= x_max + 1e-6 {
                let is_major = x_step > 1e-10
                    && ((xt / x_step).round() * x_step - xt).abs() < x_minor_step * 0.1;
                let tlen = if is_major { tick_major } else { tick_minor };
                let px = data_to_px_x(xt);
                let py = chart_bottom_px as i32;
                root.draw(&PathElement::new(
                    vec![(px, py), (px, py + tlen)],
                    c_bottom_axis.stroke_width(1),
                ))
                .ok();
                xt += x_minor_step;
            }
        }

        if y_left_minor_step > 1e-10 {
            let yt_start = (y_left_min / y_left_minor_step).ceil() * y_left_minor_step;
            let mut yt = if yt_start < y_left_min - 1e-6 {
                yt_start + y_left_minor_step
            } else {
                yt_start
            };
            while yt <= y_left_max + 1e-6 {
                let is_major = y_left_step > 1e-10
                    && ((yt / y_left_step).round() * y_left_step - yt).abs()
                        < y_left_minor_step * 0.1;
                let tlen = if is_major { tick_major } else { tick_minor };
                let px = chart_left_px as i32;
                let py = data_to_px_y_left(yt);
                root.draw(&PathElement::new(
                    vec![(px, py), (px - tlen, py)],
                    c_left_axis.stroke_width(1),
                ))
                .ok();
                yt += y_left_minor_step;
            }
        }

        if has_right_axis && y_right_minor_step > 1e-10 && (y_right_max - y_right_min).abs() > 1e-6
        {
            let yrt_start = (y_right_min / y_right_minor_step).ceil() * y_right_minor_step;
            let mut yrt = if yrt_start < y_right_min - 1e-6 {
                yrt_start + y_right_minor_step
            } else {
                yrt_start
            };
            while yrt <= y_right_max + 1e-6 {
                let is_major = y_right_step > 1e-10
                    && ((yrt / y_right_step).round() * y_right_step - yrt).abs()
                        < y_right_minor_step * 0.1;
                let tlen = if is_major { tick_major } else { tick_minor };
                let px = chart_right_px as i32;
                let py = data_to_px_y_right(yrt);
                root.draw(&PathElement::new(
                    vec![(px, py), (px + tlen, py)],
                    c_right_axis.stroke_width(1),
                ))
                .ok();
                yrt += y_right_minor_step;
            }
        }

        // Threshold line (dashed, shared)
        if let Some(threshold) = config.viscosity_threshold {
            let py = data_to_px_y_left(threshold);
            if py >= tm_top as i32 && py <= chart_bottom_px as i32 {
                let left_x = chart_left_px as i32;
                let right_x = chart_right_px as i32;
                let dash_w = 6i32;
                let gap_w = 4i32;
                let threshold_color = RGBColor(0, 0, 0);
                let mut x = left_x;
                while x < right_x {
                    let x2 = (x + dash_w).min(right_x);
                    root.draw(&PathElement::new(
                        vec![(x, py), (x2, py)],
                        threshold_color.stroke_width(1),
                    ))
                    .ok();
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
            if px >= chart_left_px as i32
                && px <= chart_right_px as i32
                && py >= tm_top as i32
                && py <= chart_bottom_px as i32
            {
                let r = 4i32;
                let diamond = vec![
                    (px, py - r),
                    (px + r, py),
                    (px, py + r),
                    (px - r, py),
                    (px, py - r),
                ];
                root.draw(&plotters::element::Polygon::new(
                    diamond.clone(),
                    tp.color.filled(),
                ))
                .ok();
                root.draw(&PathElement::new(diamond, WHITE.stroke_width(1)))
                    .ok();
                let label_color = RGBColor(0, 0, 0);
                let label_style =
                    TextStyle::from(("sans-serif", 9).into_font().color(&label_color))
                        .pos(Pos::new(HPos::Center, VPos::Bottom));
                root.draw_text(&tp.label, &label_style, (px, py - r - 2))
                    .ok();
            }
        }

        root.present().map_err(|e| e.to_string())?;
    }

    // Post-process SVG: dashed grid lines
    svg_buf = svg_buf.replace(
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
            x_min,
            x_max,
            x_step,
            x_minor_step,
            y_left_min,
            y_left_max,
            y_left_step,
            y_left_minor_step,
            y_right_min,
            y_right_max,
            y_right_step,
            y_right_minor_step,
            individual_axes: vec![],
        },
    ))
}
