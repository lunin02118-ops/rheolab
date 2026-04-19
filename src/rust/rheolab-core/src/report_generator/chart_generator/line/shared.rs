//! Shared-axis chart renderer.
//!
//! In this mode, all metrics share one of two Y scales (left or right).
//! Used when `ChartConfig::axis_mode` is not `"individual"` (default).
use plotters::prelude::*;
use plotters::element::PathElement;
use plotters::style::text_anchor::{Pos, HPos, VPos};
use super::super::common::*;

pub(super) fn render(
    points: &[ChartPoint],
    config: &ChartConfig,
) -> Result<(String, ChartRanges), String> {
    // --- 1. Separate Data by Axis ---
    // Viscosity is always LEFT
    let mut left_vals: Vec<f64> = points.iter().map(|p| p.viscosity_cp).filter(|v| v.is_finite()).collect();
    let mut right_vals: Vec<f64> = Vec::new();

    // Axis placement always follows the per-line axis settings (shear_rate_axis,
    // pressure_axis). axis_mode ('individual' vs 'shared') does not override
    // placement — it only affects label logic upstream.

    // Temperature: always RIGHT
    if config.show_temperature {
        right_vals.extend(points.iter().filter_map(|p| p.temperature_c).filter(|v| v.is_finite()));
    }

    // Shear Rate: follows shear_rate_axis setting
    if config.show_shear_rate {
        let vals: Vec<f64> = points.iter().filter_map(|p| p.shear_rate).filter(|v| v.is_finite()).collect();
        if config.shear_rate_axis.trim().to_lowercase() == "left" {
            left_vals.extend(vals);
        } else {
            right_vals.extend(vals);
        }
    }

    // Pressure: follows pressure_axis setting
    if config.show_pressure {
        let vals: Vec<f64> = points.iter().filter_map(|p| p.pressure_bar).filter(|v| v.is_finite()).collect();
        if config.pressure_axis.trim().to_lowercase() == "left" {
            left_vals.extend(vals);
        } else {
            right_vals.extend(vals);
        }
    }

    // Bath Temperature: always RIGHT (shares temperature axis)
    if config.show_bath_temperature {
        right_vals.extend(points.iter().filter_map(|p| p.bath_temperature_c).filter(|v| v.is_finite()));
    }

    // --- 2. Calculate Nice Ranges ---
    let time_vals: Vec<f64> = points.iter().map(|p| p.time_min).filter(|v| v.is_finite()).collect();

    // Default ranges if empty
    let (t_min_raw, t_max_raw) = get_raw_min_max(&time_vals, 0.0, 10.0);
    let (l_min_raw, l_max_raw) = get_raw_min_max(&left_vals, 0.0, 100.0);
    let (r_min_raw, r_max_raw) = get_raw_min_max(&right_vals, 0.0, 100.0);

    // Calculate Nice Scales — matching uPlot auto-range behaviour
    // X axis: no padding (series must reach both axis edges)
    // Y axes: with padding (breathing room top+bottom so lines never touch borders)
    let (_x_min_nice, _x_max_nice, x_step, x_minor_step) = calculate_nice_scale(t_min_raw, t_max_raw, 8, false);
    let (y_left_min_nice, y_left_max_nice, y_left_step, y_left_minor_step) = calculate_nice_scale(l_min_raw, l_max_raw, 12, true);
    let (y_right_min_nice, y_right_max_nice, y_right_step, y_right_minor_step) = calculate_nice_scale(r_min_raw, r_max_raw, 12, true);

    // Use raw data bounds for X domain so series reaches both axis edges exactly.
    // Nice values are still used for tick mark positions (independent of domain).
    let x_min = t_min_raw;
    let x_max = t_max_raw;
    let y_left_min = y_left_min_nice;
    let y_left_max = y_left_max_nice;
    let y_right_min = y_right_min_nice;
    let y_right_max = y_right_max_nice;

    // --- 3. Draw Chart ---
    let mut svg_buf = String::new();
    // Collect series that need SVG dash/dot post-processing
    let mut dash_styles: Vec<(String, u32, String)> = Vec::new(); // (rgb_string, width, style)
    {
        let root = SVGBackend::with_string(&mut svg_buf, (config.width, config.height))
            .into_drawing_area();
        root.fill(&WHITE).map_err(|e| e.to_string())?;

        // Dynamic per-side margins matching individual mode formula so that
        // shared and individual SVGs have identical chart body widths.
        const AXIS_SPACING_PX_SH: u32 = 60;
        const TICK_MARGIN_SH: u32 = 10;
        let n_left_sh: usize = 1 // viscosity always left
            + if config.show_shear_rate && config.shear_rate_axis.trim().to_lowercase() == "left" { 1 } else { 0 }
            + if config.show_pressure && config.pressure_axis.trim().to_lowercase() == "left" { 1 } else { 0 };
        let n_right_sh: usize =
              if config.show_temperature || config.show_bath_temperature { 1 } else { 0 }
            + if config.show_shear_rate && config.shear_rate_axis.trim().to_lowercase() == "right" { 1 } else { 0 }
            + if config.show_pressure && config.pressure_axis.trim().to_lowercase() == "right" { 1 } else { 0 };
        // Symmetric margins with minimum 1 extra column per side.
        // Ensures identical chart body width as individual mode.
        let min_extra_sh = ((n_left_sh.saturating_sub(1)) as u32)
            .max((n_right_sh.saturating_sub(1)) as u32)
            .max(1);
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

        // Draw Manual Grid — at major tick intervals (matching preview CartesianGrid)
        let grid_style = C_GRID.stroke_width(1);

        // X Grid — major step intervals
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

        // Y Grid (Left) — major step intervals
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

        // Axis colors matching preview: Left=Blue, Right=Orange, Bottom/Top=Gray
        let c_left_axis = RGBColor(59, 130, 246);    // #3b82f6 Blue
        let c_right_axis = RGBColor(249, 115, 22);   // #f97316 Orange
        let c_bottom_axis = RGBColor(71, 85, 105);   // #475569 Gray

        // Check if right axis is actually used
        let has_right_axis = config.show_temperature
            || config.show_bath_temperature
            || (config.show_shear_rate && config.shear_rate_axis.trim().to_lowercase() == "right")
            || (config.show_pressure && config.pressure_axis.trim().to_lowercase() == "right");

        // Draw Axes Frame with matching colors
        // Bottom axis line
        chart.draw_series(LineSeries::new(
            vec![(x_min, y_left_min), (x_max, y_left_min)],
            c_bottom_axis.stroke_width(1),
        )).ok();

        // Left axis line
        chart.draw_series(LineSeries::new(
            vec![(x_min, y_left_min), (x_min, y_left_max)],
            c_left_axis.stroke_width(1),
        )).ok();

        // Right axis line
        if has_right_axis {
            chart.draw_series(LineSeries::new(
                vec![(x_max, y_left_min), (x_max, y_left_max)],
                c_right_axis.stroke_width(1),
            )).ok();
        }

        // Get line styles (use provided settings or defaults)
        let styles = config.line_styles.as_ref().cloned().unwrap_or_default();

        // Series 1: Viscosity (Left) — no smoothing, matching preview LTTB behavior
        let visc_data: Vec<(f64, f64)> = points.iter().map(|p| (p.time_min, p.viscosity_cp)).collect();

        let visc_color = styles.viscosity.color;
        let visc_width = styles.viscosity.width;

        // Helper: format RGBColor to SVG hex string (Plotters outputs hex, e.g. #3B82F6)
        let rgb_str = |c: RGBColor| -> String { format!("#{:02X}{:02X}{:02X}", c.0, c.1, c.2) };

        // Draw all series as SOLID lines; non-solid styles are applied via SVG post-processing
        // This ensures consistent dash/dot patterns regardless of line direction.

        // Series 1: Viscosity (Left)
        chart.draw_series(LineSeries::new(
            visc_data,
            visc_color.stroke_width(visc_width),
        )).map_err(|e| e.to_string())?;
        if styles.viscosity.style != "solid" {
            dash_styles.push((rgb_str(visc_color), visc_width, styles.viscosity.style.clone()));
        }

        // Series 2: Temperature (Right)
        if config.show_temperature {
            let temp_data: Vec<(f64, f64)> = points
                .iter()
                .filter_map(|p| p.temperature_c.map(|v| (p.time_min, v)))
                .collect();

            let temp_color = styles.temperature.color;
            let temp_width = styles.temperature.width;

            chart.draw_secondary_series(LineSeries::new(
                temp_data,
                temp_color.stroke_width(temp_width)
            )).map_err(|e| e.to_string())?;
            if styles.temperature.style != "solid" {
                dash_styles.push((rgb_str(temp_color), temp_width, styles.temperature.style.clone()));
            }
        }

        // Series 3: Shear Rate
        if config.show_shear_rate {
            let sr_data: Vec<(f64, f64)> = points
                .iter()
                .filter_map(|p| p.shear_rate.map(|v| (p.time_min, v)))
                .collect();

            let sr_color = styles.shear_rate.color;
            let sr_width = styles.shear_rate.width;
            let is_right = config.shear_rate_axis.trim().to_lowercase() == "right";

            let series = LineSeries::new(sr_data, sr_color.stroke_width(sr_width));
            if is_right {
                chart.draw_secondary_series(series).map_err(|e| e.to_string())?;
            } else {
                chart.draw_series(series).map_err(|e| e.to_string())?;
            }
            if styles.shear_rate.style != "solid" {
                dash_styles.push((rgb_str(sr_color), sr_width, styles.shear_rate.style.clone()));
            }
        }

        // Series 4: Pressure
        if config.show_pressure {
            let pr_data: Vec<(f64, f64)> = points
                .iter()
                .filter_map(|p| p.pressure_bar.map(|v| (p.time_min, v)))
                .collect();

            let pr_color = styles.pressure.color;
            let pr_width = styles.pressure.width;
            let is_right = config.pressure_axis.trim().to_lowercase() == "right";

            let series = LineSeries::new(pr_data, pr_color.stroke_width(pr_width));
            if is_right {
                chart.draw_secondary_series(series).map_err(|e| e.to_string())?;
            } else {
                chart.draw_series(series).map_err(|e| e.to_string())?;
            }
            if styles.pressure.style != "solid" {
                dash_styles.push((rgb_str(pr_color), pr_width, styles.pressure.style.clone()));
            }
        }

        // Series 4b: Bath Temperature (Right — shares secondary axis with temp)
        if config.show_bath_temperature {
            let bt_data: Vec<(f64, f64)> = points
                .iter()
                .filter_map(|p| p.bath_temperature_c.map(|v| (p.time_min, v)))
                .collect();

            let bt_color = styles.bath_temperature.color;
            let bt_width = styles.bath_temperature.width;

            chart.draw_secondary_series(LineSeries::new(
                bt_data,
                bt_color.stroke_width(bt_width),
            )).map_err(|e| e.to_string())?;
            if styles.bath_temperature.style != "solid" {
                dash_styles.push((rgb_str(bt_color), bt_width, styles.bath_temperature.style.clone()));
            }
        }

        // Horizontal dashed threshold line (shared mode)
        // Drawn after chart scope using pixel coordinates (see below)

        } // end chart scope — chart dropped, root available

        // ═══════════════════════════════════════════════════════════════════
        // Draw outward-pointing tick marks on root using pixel coordinates
        // ═══════════════════════════════════════════════════════════════════
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
            (tm_left + (dx - x_min) / (x_max - x_min) * chart_w) as i32
        };
        let data_to_px_y_left = |dy: f64| -> i32 {
            (tm_top + (1.0 - (dy - y_left_min) / (y_left_max - y_left_min)) * chart_h) as i32
        };
        let data_to_px_y_right = |dy: f64| -> i32 {
            (tm_top + (1.0 - (dy - y_right_min) / (y_right_max - y_right_min)) * chart_h) as i32
        };

        let tick_major = 6i32;
        let tick_minor = 3i32;

        // Axis colors
        let c_left_axis = RGBColor(59, 130, 246);
        let c_right_axis = RGBColor(249, 115, 22);
        let c_bottom_axis = RGBColor(71, 85, 105);

        let has_right_axis = config.show_temperature
            || config.show_bath_temperature
            || (config.show_shear_rate && config.shear_rate_axis.trim().to_lowercase() == "right")
            || (config.show_pressure && config.pressure_axis.trim().to_lowercase() == "right");

        // Bottom axis ticks (outward = downward)
        if x_minor_step > 1e-10 {
            let xt_start = (x_min / x_minor_step).ceil() * x_minor_step;
            let mut xt = if xt_start < x_min - 1e-6 { xt_start + x_minor_step } else { xt_start };
            while xt <= x_max + 1e-6 {
                let is_major = x_step > 1e-10 && ((xt / x_step).round() * x_step - xt).abs() < x_minor_step * 0.1;
                let tlen = if is_major { tick_major } else { tick_minor };
                let px = data_to_px_x(xt);
                let py = chart_bottom_px as i32;
                root.draw(&PathElement::new(vec![(px, py), (px, py + tlen)], c_bottom_axis.stroke_width(1))).ok();
                xt += x_minor_step;
            }
        }

        // Left Y axis ticks (outward = leftward)
        if y_left_minor_step > 1e-10 {
            let yt_start = (y_left_min / y_left_minor_step).ceil() * y_left_minor_step;
            let mut yt = if yt_start < y_left_min - 1e-6 { yt_start + y_left_minor_step } else { yt_start };
            while yt <= y_left_max + 1e-6 {
                let is_major = y_left_step > 1e-10 && ((yt / y_left_step).round() * y_left_step - yt).abs() < y_left_minor_step * 0.1;
                let tlen = if is_major { tick_major } else { tick_minor };
                let px = chart_left_px as i32;
                let py = data_to_px_y_left(yt);
                root.draw(&PathElement::new(vec![(px, py), (px - tlen, py)], c_left_axis.stroke_width(1))).ok();
                yt += y_left_minor_step;
            }
        }

        // Right Y axis ticks (outward = rightward)
        if has_right_axis && y_right_minor_step > 1e-10 && (y_right_max - y_right_min).abs() > 1e-6 {
            let yrt_start = (y_right_min / y_right_minor_step).ceil() * y_right_minor_step;
            let mut yrt = if yrt_start < y_right_min - 1e-6 { yrt_start + y_right_minor_step } else { yrt_start };
            while yrt <= y_right_max + 1e-6 {
                let is_major = y_right_step > 1e-10 && ((yrt / y_right_step).round() * y_right_step - yrt).abs() < y_right_minor_step * 0.1;
                let tlen = if is_major { tick_major } else { tick_minor };
                let px = chart_right_px as i32;
                let py = data_to_px_y_right(yrt);
                root.draw(&PathElement::new(vec![(px, py), (px + tlen, py)], c_right_axis.stroke_width(1))).ok();
                yrt += y_right_minor_step;
            }
        }

        // Horizontal dashed threshold line (shared mode)
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
                    root.draw(&PathElement::new(vec![(x, py), (x2, py)], threshold_color.stroke_width(1))).ok();
                    x += dash_w + gap_w;
                }

                // Draw threshold label on the left side
                let label = format!("{} cP", threshold as i32);
                let style = TextStyle::from(("sans-serif", 11).into_font().color(&threshold_color))
                    .pos(Pos::new(HPos::Right, VPos::Center));
                root.draw_text(&label, &style, (left_x - 4, py)).ok();
            }
        }

        // Touch points — circle markers + labels (shared mode)
        for tp in &config.touch_points {
            let px = data_to_px_x(tp.time);
            let py = data_to_px_y_left(tp.viscosity);
            // Only draw if within chart area
            if px >= chart_left_px as i32 && px <= chart_right_px as i32
                && py >= tm_top as i32 && py <= chart_bottom_px as i32
            {
                root.draw(&Circle::new((px, py), 5, tp.color.filled())).ok();
                root.draw(&Circle::new((px, py), 5, WHITE.stroke_width(1))).ok();
                let label_style = TextStyle::from(("sans-serif", 10).into_font().color(&tp.color))
                    .pos(Pos::new(HPos::Center, VPos::Bottom));
                root.draw_text(&tp.label, &label_style, (px, py - 7)).ok();
            }
        }

        root.present().map_err(|e| e.to_string())?;
    }

    // Post-process SVG: make grid lines dashed with opacity (matching preview CartesianGrid)
    // Plotters already adds opacity="1", so we replace it to avoid duplicate attributes
    svg_buf = svg_buf
        .replace(
            r##"opacity="1" stroke="#C8C8C8" stroke-width="1""##,
            r##"opacity="0.4" stroke="#C8C8C8" stroke-width="0.5" stroke-dasharray="4,4""##
        );

    // Post-process SVG: apply stroke-dasharray for dashed/dotted series
    // Uses SVG native dash patterns for direction-independent rendering
    for (rgb, width, style) in &dash_styles {
        let dasharray = match style.as_str() {
            "dashed" => "8,4",
            "dotted" => "0.1,6",
            _ => continue,
        };
        let extra = if style == "dotted" {
            format!(r#" stroke-dasharray="{}" stroke-linecap="round""#, dasharray)
        } else {
            format!(r#" stroke-dasharray="{}""#, dasharray)
        };

        // Attribute format: stroke="#RRGGBB" stroke-width="N"
        let attr_search = format!(r#"stroke="{}" stroke-width="{}""#, rgb, width);
        let attr_replace = format!("{}{}", attr_search, extra);
        svg_buf = svg_buf.replace(&attr_search, &attr_replace);
    }

    Ok((svg_buf, ChartRanges {
        x_min, x_max, x_step, x_minor_step,
        y_left_min, y_left_max, y_left_step, y_left_minor_step,
        y_right_min, y_right_max, y_right_step, y_right_minor_step,
        individual_axes: vec![],
    }))
}
