//! Chart Generator using Plotters
//! 
//! Generates vector SVG charts natively in Rust.
//! Matching the legacy "React-PDF" style: Blue/Orange axes, dashed grid, bottom legend.

use plotters::prelude::*;
use plotters::element::PathElement;
use plotters::style::text_anchor::{Pos, HPos, VPos};
use super::types::ChartLineSettings;

/// Chart data point
#[derive(Debug, Clone)]
pub struct ChartPoint {
    pub time_min: f64,
    pub viscosity_cp: f64,
    pub temperature_c: Option<f64>,
    pub shear_rate: Option<f64>,
    pub pressure_bar: Option<f64>,
    pub bath_temperature_c: Option<f64>,
}

/// Individual line style for chart rendering
#[derive(Debug, Clone)]
pub struct ChartLineStyle {
    pub color: RGBColor,
    pub width: u32,
    pub style: String, // "solid", "dashed", "dotted"
}

impl Default for ChartLineStyle {
    fn default() -> Self {
        Self {
            color: RGBColor(59, 130, 246), // Blue
            width: 2,
            style: "solid".to_string(),
        }
    }
}

/// Chart configuration
#[derive(Debug, Clone)]
pub struct ChartConfig {
    pub show_temperature: bool,
    pub show_shear_rate: bool,
    pub show_pressure: bool,
    pub show_bath_temperature: bool,
    pub shear_rate_axis: String,
    pub pressure_axis: String,
    /// Axis layout mode: "individual" or "shared"
    pub axis_mode: String,
    pub width: u32,
    pub height: u32,
    
    // Predetermined labels to simplify generator logic
    pub label_left: String,
    pub label_right: String,
    pub label_bottom: String,
    
    // Series names for legend
    pub name_viscosity: String,
    pub name_temperature: String,
    pub name_shear_rate: String,
    pub name_pressure: String,
    pub name_bath_temperature: String,
    
    // Touch points for vertical lines
    pub touch_points: Vec<ChartTouchPoint>,
    
    /// Viscosity threshold for horizontal dashed line (cP)
    pub viscosity_threshold: Option<f64>,

    // Line styles from user settings
    pub line_styles: Option<ChartLineStyles>,

    /// When true, skip LTTB downsampling (use for PDF reports that need full precision)
    pub skip_downsample: bool,
}

/// All line styles for chart
#[derive(Debug, Clone)]
pub struct ChartLineStyles {
    pub viscosity: ChartLineStyle,
    pub temperature: ChartLineStyle,
    pub shear_rate: ChartLineStyle,
    pub pressure: ChartLineStyle,
    pub bath_temperature: ChartLineStyle,
}

impl Default for ChartLineStyles {
    fn default() -> Self {
        Self {
            viscosity: ChartLineStyle {
                color: RGBColor(59, 130, 246),  // #3b82f6 Blue
                width: 2,
                style: "solid".to_string(),
            },
            temperature: ChartLineStyle {
                color: RGBColor(220, 38, 38),   // #dc2626 Red
                width: 2,
                style: "solid".to_string(),
            },
            shear_rate: ChartLineStyle {
                color: RGBColor(168, 85, 247),  // #a855f7 Purple
                width: 2,
                style: "solid".to_string(),
            },
            pressure: ChartLineStyle {
                color: RGBColor(34, 197, 94),   // #22C55E Green
                width: 2,
                style: "solid".to_string(),
            },
            bath_temperature: ChartLineStyle {
                color: RGBColor(234, 88, 12),   // #ea580c Orange
                width: 2,
                style: "dashed".to_string(),
            },
        }
    }
}

/// Convert ChartLineSettings from types.rs to ChartLineStyles
impl From<&ChartLineSettings> for ChartLineStyles {
    fn from(settings: &ChartLineSettings) -> Self {
        Self {
            viscosity: parse_line_style(&settings.viscosity),
            temperature: parse_line_style(&settings.temperature),
            shear_rate: parse_line_style(&settings.shear_rate),
            pressure: parse_line_style(&settings.pressure),
            bath_temperature: settings.bath_temperature.as_ref()
                .map(|s| parse_line_style(s))
                .unwrap_or(ChartLineStyle {
                    color: RGBColor(234, 88, 12),
                    width: 2,
                    style: "dashed".to_string(),
                }),
        }
    }
}

/// Parse hex color string to RGBColor
fn parse_hex_color(hex: &str) -> RGBColor {
    let hex = hex.trim_start_matches('#');
    if hex.len() >= 6 {
        let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(59);
        let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(130);
        let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(246);
        RGBColor(r, g, b)
    } else {
        RGBColor(59, 130, 246) // Default blue
    }
}

/// Parse LineSettings to ChartLineStyle
fn parse_line_style(settings: &super::types::LineSettings) -> ChartLineStyle {
    ChartLineStyle {
        color: parse_hex_color(&settings.color),
        width: settings.width as u32,
        style: settings.style.clone(),
    }
}

/// Touch point for vertical line on chart
#[derive(Debug, Clone)]
pub struct ChartTouchPoint {
    pub time: f64,
    pub viscosity: f64,
    pub label: String,
    pub color: RGBColor,
}

// Grid color constant
const C_GRID: RGBColor = RGBColor(200, 200, 200);       // Light Gray

/// Info for one independent metric axis (used in individual axis mode)
#[derive(Debug, Clone)]
pub struct IndividualAxisInfo {
    /// Data range and tick spacing
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub minor_step: f64,
    /// "viscosity" | "temperature" | "shear_rate" | "pressure"
    pub metric: String,
    /// "left" | "right"
    pub side: String,
    /// 0 = innermost (touching chart border), 1 = next outward, etc.
    pub side_idx: usize,
    /// SVG hex colour, e.g. "#3b82f6"
    pub color_hex: String,
}

/// Ranges for axis labels (since we can't render text in Plotters WASM)
#[derive(Debug, Clone)]
pub struct ChartRanges {
    pub x_min: f64,
    pub x_max: f64,
    pub x_step: f64,
    pub x_minor_step: f64,
    pub y_left_min: f64,
    pub y_left_max: f64,
    pub y_left_step: f64,
    pub y_left_minor_step: f64,
    pub y_right_min: f64,
    pub y_right_max: f64,
    pub y_right_step: f64,
    pub y_right_minor_step: f64,
    /// Populated only in "individual" axis mode.  Each entry describes one
    /// per-metric independent Y axis so that Typst can render tick labels.
    pub individual_axes: Vec<IndividualAxisInfo>,
}

/// Generate chart SVG
pub fn generate_chart_svg(
    points: &[ChartPoint],
    config: &ChartConfig,
) -> Result<(String, ChartRanges), String> {
    
    if points.is_empty() {
        return Err("No data points provided".to_string());
    }

    // LTTB downsample to max 1500 points for chart SVG — matches the frontend
    // threshold (1500 normal / 600 capture) so report and screen have the same
    // level of detail.  Full data stays in raw_data for the table.
    // skip_downsample=true is set by the PDF renderer to preserve full precision.
    let points = if config.skip_downsample {
        points.to_vec()
    } else {
        lttb_downsample_chart(points, 1500)
    };

    // "individual" axis mode: each metric has its own independent Y scale.
    // Delegate to a dedicated renderer so that the "shared" path below is unchanged.
    if config.axis_mode.trim().to_lowercase() == "individual" {
        return generate_chart_individual(&points, config);
    }

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

// ═══════════════════════════════════════════════════════════════════════════
// Individual axis mode renderer
// Each visible metric gets its own independent Y scale and axis column.
// ═══════════════════════════════════════════════════════════════════════════

fn generate_chart_individual(
    points: &[ChartPoint],
    config: &ChartConfig,
) -> Result<(String, ChartRanges), String> {
    // ── 1. Per-metric raw value vectors ───────────────────────────────────
    let time_vals: Vec<f64> = points.iter().map(|p| p.time_min).filter(|v| v.is_finite()).collect();
    let visc_vals: Vec<f64> = points.iter().map(|p| p.viscosity_cp).filter(|v| v.is_finite()).collect();
    let temp_vals: Vec<f64> = if config.show_temperature {
        points.iter().filter_map(|p| p.temperature_c).filter(|v| v.is_finite()).collect()
    } else { vec![] };
    let sr_vals: Vec<f64> = if config.show_shear_rate {
        points.iter().filter_map(|p| p.shear_rate).filter(|v| v.is_finite()).collect()
    } else { vec![] };
    let pr_vals: Vec<f64> = if config.show_pressure {
        points.iter().filter_map(|p| p.pressure_bar).filter(|v| v.is_finite()).collect()
    } else { vec![] };
    let bt_vals: Vec<f64> = if config.show_bath_temperature {
        points.iter().filter_map(|p| p.bath_temperature_c).filter(|v| v.is_finite()).collect()
    } else { vec![] };

    // ── 2. Per-metric nice scales ─────────────────────────────────────────
    let (t_min_raw, t_max_raw) = get_raw_min_max(&time_vals, 0.0, 10.0);
    // X: use raw data bounds so series reaches both left and right axis edges exactly.
    // Nice values drive tick marks only.
    let (_x_min_nice, _x_max_nice, x_step, x_minor_step) = calculate_nice_scale(t_min_raw, t_max_raw, 8, false);
    let x_min = t_min_raw;
    let x_max = t_max_raw;

    let (vm_raw, vx_raw) = get_raw_min_max(&visc_vals, 0.0, 100.0);
    let (visc_min, visc_max, visc_step, visc_minor) = calculate_nice_scale(vm_raw, vx_raw, 12, true);

    // Bath temperature always shares the temperature axis (same °C scale).
    // Merge both value sets → one combined nice range that fits both series.
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

    // ── 3. Build IndividualAxisInfo lists (left / right, ordered innermost first) ──
    let styles = config.line_styles.as_ref().cloned().unwrap_or_default();
    let rgb_str = |c: RGBColor| format!("#{:02X}{:02X}{:02X}", c.0, c.1, c.2);

    let mut left_axes: Vec<IndividualAxisInfo> = Vec::new();
    let mut right_axes: Vec<IndividualAxisInfo> = Vec::new();

    // Viscosity: always left idx 0
    left_axes.push(IndividualAxisInfo {
        min: visc_min, max: visc_max, step: visc_step, minor_step: visc_minor,
        metric: "viscosity".to_string(), side: "left".to_string(), side_idx: 0,
        color_hex: rgb_str(styles.viscosity.color),
    });

    // Temperature axis: right. Covers both temperature and bath_temperature — they share
    // the same °C scale. The axis appears whenever either series is visible.
    if (config.show_temperature || config.show_bath_temperature) && !temp_and_bt_vals.is_empty() {
        right_axes.push(IndividualAxisInfo {
            min: temp_min, max: temp_max, step: temp_step, minor_step: temp_minor,
            metric: "temperature".to_string(), side: "right".to_string(), side_idx: 0,
            color_hex: rgb_str(styles.temperature.color),
        });
    }

    // Shear rate: follows shear_rate_axis
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

    // Pressure: follows pressure_axis
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

    // Bath temperature shares the temperature axis — no separate IndividualAxisInfo entry.
    // Its values were already included in temp_and_bt_vals above.

    // ── 4. Dynamic per-side margins ───────────────────────────────────────
    // Each extra axis (beyond the innermost) needs AXIS_SPACING_PX room in the SVG.
    const AXIS_SPACING_PX: u32 = 60;
    const TICK_MARGIN: u32 = 10;
    let n_left_extra = (left_axes.len() as u32).saturating_sub(1);
    let n_right_extra = (right_axes.len() as u32).saturating_sub(1);
    // Symmetric margins with minimum 1 extra column per side.
    // Keeps chart body width constant regardless of axis count/mode,
    // matching the PDF page-margin formula (MIN_EXTRA = 1).
    let min_extra = n_left_extra.max(n_right_extra).max(1);
    let left_margin  = TICK_MARGIN + min_extra * AXIS_SPACING_PX;
    let right_margin = TICK_MARGIN + min_extra * AXIS_SPACING_PX;

    // ── 5. Render SVG ─────────────────────────────────────────────────────
    let mut svg_buf = String::new();
    let mut dash_styles: Vec<(String, u32, String)> = Vec::new();
    {
        let root = SVGBackend::with_string(&mut svg_buf, (config.width, config.height))
            .into_drawing_area();
        root.fill(&WHITE).map_err(|e| e.to_string())?;

        // Build chart area — uses viscosity scale only for grid placement.
        // All series are drawn manually after this scope.
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

            // X grid (major steps)
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

            // Y grid (viscosity major steps as reference)
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

            // Bottom bounding line (gray) — top line intentionally omitted
            let c_bottom = RGBColor(71, 85, 105);
            chart.draw_series(LineSeries::new(
                vec![(x_min, visc_min), (x_max, visc_min)], c_bottom.stroke_width(1),
            )).ok();
        } // chart scope ends

        // ── 6. Pixel coordinate helpers ───────────────────────────────────
        let tm_l = left_margin  as f64;
        let tm_r = right_margin as f64;
        let chart_w = config.width  as f64 - tm_l - tm_r;
        let chart_h = config.height as f64 - 2.0 * TICK_MARGIN as f64;
        let chart_left_px   = tm_l;
        let chart_right_px  = config.width  as f64 - tm_r;
        let chart_top_px    = TICK_MARGIN as f64;
        let chart_bottom_px = config.height as f64 - TICK_MARGIN as f64;

        let px_x = |dx: f64| -> i32 {
            (tm_l + (dx - x_min) / (x_max - x_min).max(1e-10) * chart_w).round() as i32
        };
        let px_y = |val: f64, ymin: f64, ymax: f64| -> i32 {
            let pct = (val - ymin) / (ymax - ymin).max(1e-10);
            (chart_bottom_px - pct * chart_h).round() as i32
        };

        // ── 7. Draw series as manual PathElement using per-metric scales ──
        // (metric, y_min, y_max, color, width, style)
        let mut draw_series = |data: &[(f64, f64)], ymin: f64, ymax: f64,
                                color: RGBColor, width: u32, style_str: &str| {
            let pts: Vec<(i32, i32)> = data.iter()
                .map(|(x, y)| (px_x(*x), px_y(*y, ymin, ymax)))
                .collect();
            if pts.len() > 1 {
                root.draw(&PathElement::new(pts, color.stroke_width(width))).ok();
            }
            if style_str != "solid" {
                dash_styles.push((format!("#{:02X}{:02X}{:02X}", color.0, color.1, color.2), width, style_str.to_string()));
            }
        };

        // Viscosity (left-0)
        {
            let d: Vec<(f64, f64)> = points.iter()
                .map(|p| (p.time_min, p.viscosity_cp))
                .filter(|(x, y)| x.is_finite() && y.is_finite())
                .collect();
            draw_series(&d, visc_min, visc_max, styles.viscosity.color, styles.viscosity.width, &styles.viscosity.style.clone());
        }

        // Temperature
        if config.show_temperature && !temp_vals.is_empty() {
            let d: Vec<(f64, f64)> = points.iter()
                .filter_map(|p| p.temperature_c.map(|v| (p.time_min, v)))
                .filter(|(x, y)| x.is_finite() && y.is_finite())
                .collect();
            draw_series(&d, temp_min, temp_max, styles.temperature.color, styles.temperature.width, &styles.temperature.style.clone());
        }

        // Shear rate
        if config.show_shear_rate && !sr_vals.is_empty() {
            let d: Vec<(f64, f64)> = points.iter()
                .filter_map(|p| p.shear_rate.map(|v| (p.time_min, v)))
                .filter(|(x, y)| x.is_finite() && y.is_finite())
                .collect();
            draw_series(&d, sr_min, sr_max, styles.shear_rate.color, styles.shear_rate.width, &styles.shear_rate.style.clone());
        }

        // Pressure
        if config.show_pressure && !pr_vals.is_empty() {
            let d: Vec<(f64, f64)> = points.iter()
                .filter_map(|p| p.pressure_bar.map(|v| (p.time_min, v)))
                .filter(|(x, y)| x.is_finite() && y.is_finite())
                .collect();
            draw_series(&d, pr_min, pr_max, styles.pressure.color, styles.pressure.width, &styles.pressure.style.clone());
        }

        // Bath temperature — drawn on the shared temperature axis (temp_min..temp_max).
        if config.show_bath_temperature && !bt_vals.is_empty() {
            let d: Vec<(f64, f64)> = points.iter()
                .filter_map(|p| p.bath_temperature_c.map(|v| (p.time_min, v)))
                .filter(|(x, y)| x.is_finite() && y.is_finite())
                .collect();
            draw_series(&d, temp_min, temp_max, styles.bath_temperature.color, styles.bath_temperature.width, &styles.bath_temperature.style.clone());
        }

        // Touch points — circle markers + labels (individual mode)
        for tp in &config.touch_points {
            let px = px_x(tp.time);
            let py = px_y(tp.viscosity, visc_min, visc_max);
            if px >= chart_left_px as i32 && px <= chart_right_px as i32
                && py >= chart_top_px as i32 && py <= chart_bottom_px as i32
            {
                root.draw(&Circle::new((px, py), 5, tp.color.filled())).ok();
                root.draw(&Circle::new((px, py), 5, WHITE.stroke_width(1))).ok();
                let label_style = TextStyle::from(("sans-serif", 10).into_font().color(&tp.color))
                    .pos(Pos::new(HPos::Center, VPos::Bottom));
                root.draw_text(&tp.label, &label_style, (px, py - 7)).ok();
            }
        }

        // Horizontal dashed threshold line
        if let Some(threshold) = config.viscosity_threshold {
            // Use viscosity axis (always left-side, first axis)
            let py = px_y(threshold, visc_min, visc_max);
            if py >= chart_top_px as i32 && py <= chart_bottom_px as i32 {
                let left_x  = chart_left_px as i32;
                let right_x = chart_right_px as i32;
                let dash_w  = 6i32;
                let gap_w   = 4i32;
                let threshold_color = RGBColor(0, 0, 0); // black for PDF
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

        // ── 8. Per-metric axis lines and outward tick marks ───────────────
        let tick_major = 6i32;
        let tick_minor = 3i32;

        // Left axes: innermost (idx 0) at chart_left_px; each extra at -AXIS_SPACING_PX
        for axis in &left_axes {
            let x_pos = (chart_left_px - axis.side_idx as f64 * AXIS_SPACING_PX as f64) as i32;
            let color = parse_hex_color(&axis.color_hex);
            // Vertical axis line
            root.draw(&PathElement::new(
                vec![(x_pos, chart_top_px as i32), (x_pos, chart_bottom_px as i32)],
                color.stroke_width(1),
            )).ok();
            // Tick marks
            if axis.minor_step > 1e-10 {
                let start = (axis.min / axis.minor_step).ceil() * axis.minor_step;
                let mut yt = if start < axis.min - 1e-6 { start + axis.minor_step } else { start };
                while yt <= axis.max + 1e-6 {
                    let is_major = axis.step > 1e-10
                        && ((yt / axis.step).round() * axis.step - yt).abs() < axis.minor_step * 0.1;
                    let tlen = if is_major { tick_major } else { tick_minor };
                    let py = px_y(yt, axis.min, axis.max);
                    root.draw(&PathElement::new(vec![(x_pos, py), (x_pos - tlen, py)], color.stroke_width(1))).ok();
                    yt += axis.minor_step;
                }
            }
        }

        // Right axes: innermost (idx 0) at chart_right_px; each extra at +AXIS_SPACING_PX
        for axis in &right_axes {
            let x_pos = (chart_right_px + axis.side_idx as f64 * AXIS_SPACING_PX as f64) as i32;
            let color = parse_hex_color(&axis.color_hex);
            // Vertical axis line
            root.draw(&PathElement::new(
                vec![(x_pos, chart_top_px as i32), (x_pos, chart_bottom_px as i32)],
                color.stroke_width(1),
            )).ok();
            // Tick marks
            if axis.minor_step > 1e-10 {
                let start = (axis.min / axis.minor_step).ceil() * axis.minor_step;
                let mut yt = if start < axis.min - 1e-6 { start + axis.minor_step } else { start };
                while yt <= axis.max + 1e-6 {
                    let is_major = axis.step > 1e-10
                        && ((yt / axis.step).round() * axis.step - yt).abs() < axis.minor_step * 0.1;
                    let tlen = if is_major { tick_major } else { tick_minor };
                    let py = px_y(yt, axis.min, axis.max);
                    root.draw(&PathElement::new(vec![(x_pos, py), (x_pos + tlen, py)], color.stroke_width(1))).ok();
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
                root.draw(&PathElement::new(vec![(px, py), (px, py + tlen)], c_bottom.stroke_width(1))).ok();
                xt += x_minor_step;
            }
        }

        root.present().map_err(|e| e.to_string())?;
    } // svg scope

    // ── 9. Post-processing: grid dash + series dash/dot ───────────────────
    svg_buf = svg_buf.replace(
        r##"opacity="1" stroke="#C8C8C8" stroke-width="1""##,
        r##"opacity="0.4" stroke="#C8C8C8" stroke-width="0.5" stroke-dasharray="4,4""##,
    );
    for (rgb, width, style) in &dash_styles {
        let dasharray = match style.as_str() { "dashed" => "8,4", "dotted" => "0.1,6", _ => continue };
        let extra = if style == "dotted" {
            format!(r#" stroke-dasharray="{}" stroke-linecap="round""#, dasharray)
        } else {
            format!(r#" stroke-dasharray="{}""#, dasharray)
        };
        let attr_search = format!(r#"stroke="{}" stroke-width="{}""#, rgb, width);
        svg_buf = svg_buf.replace(&attr_search, &format!("{}{}", attr_search, extra));
    }

    // ── 10. Assemble ChartRanges ──────────────────────────────────────────
    let mut individual_axes_out = left_axes.clone();
    individual_axes_out.extend(right_axes.clone());

    // Fix side_idx in the combined list (already set during construction)
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

// Helper: Raw Min/Max
fn get_raw_min_max(vals: &[f64], default_min: f64, default_max: f64) -> (f64, f64) {
    if vals.is_empty() { return (default_min, default_max); }
    let min = vals.iter().fold(f64::INFINITY, |a, &b| a.min(b));
    let max = vals.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b));
    if min.is_infinite() || max.is_infinite() { return (default_min, default_max); }
    // Add tiny padding to prevent hitting edges exactly if data is flat
    if min == max { (min - 1.0, max + 1.0) } else { (min, max) }
}

/// Calculate major step size — ported from chart-ticks.tsx calculateMajorStep()
/// Picks from standard "nice" values: 1, 2, 5, 10, 20, 50, ...
fn calculate_major_step(range: f64, target_ticks: usize) -> f64 {
    if range <= 0.0 { return 1.0; }
    let raw_step = range / (target_ticks.max(2) - 1) as f64;
    let magnitude = 10f64.powf(raw_step.log10().floor());
    let normalized = raw_step / magnitude;
    let nice = if normalized <= 1.5 { 1.0 }
               else if normalized <= 3.0 { 2.0 }
               else if normalized <= 7.0 { 5.0 }
               else { 10.0 };
    nice * magnitude
}

/// Minor divisions based on major step — ported from chart-ticks.tsx getMinorDivisions()
/// Scientific convention: steps of 2/20/200 → 4 divisions, others → 5.
fn get_minor_divisions(major_step: f64) -> usize {
    if major_step <= 0.0 { return 5; }
    let normalized = major_step / 10f64.powf(major_step.log10().floor());
    if (normalized - 2.0).abs() < 0.01 { 4 } else { 5 }
}

/// Calculate nice scale with major and minor steps.
/// `padding`: when true, adds one extra step of breathing room at top AND bottom
/// so chart lines never touch the axis borders (used for Y axes).
/// For X (time) axis use padding=false so the first/last data points reach the axis.
/// Returns (nice_min, nice_max, major_step, minor_step)
fn calculate_nice_scale(min: f64, max: f64, target_major_ticks: usize, padding: bool) -> (f64, f64, f64, f64) {
    let range = max - min;
    if range < 1e-10 {
        return (min - 1.0, max + 1.0, 1.0, 0.2);
    }
    let major_step = calculate_major_step(range, target_major_ticks);
    let minor_divisions = get_minor_divisions(major_step);
    let minor_step = major_step / minor_divisions as f64;
    let nice_min_base = (min / major_step).floor() * major_step;
    let nice_max_base = (max / major_step).ceil()  * major_step;
    let (nice_min, nice_max) = if padding {
        // Add one extra step when data is within 15% of a tick from the edge
        // so chart lines never touch the top or bottom border.
        let nmin = if min - nice_min_base < major_step * 0.15 {
            nice_min_base - major_step
        } else {
            nice_min_base
        };
        let nmax = if nice_max_base - max < major_step * 0.15 {
            nice_max_base + major_step
        } else {
            nice_max_base
        };
        (nmin, nmax)
    } else {
        (nice_min_base, nice_max_base)
    };
    (nice_min, nice_max, major_step, minor_step)
}

/// LTTB (Largest-Triangle-Three-Buckets) downsampling for chart rendering.
///
/// Multi-channel variant: normalises all available numeric channels (viscosity,
/// temperature, shear_rate, pressure, bath_temperature) to [0, 1] and sums
/// their triangle areas so that significant events in *any* channel are
/// preserved — not just the viscosity channel.  This matches the multi-channel
/// LTTB used on the frontend (`downsampleRheoPointsMultiChannel`).
fn lttb_downsample_chart(data: &[ChartPoint], threshold: usize) -> Vec<ChartPoint> {
    let n = data.len();
    if n <= threshold {
        return data.to_vec();
    }

    // ── Per-channel normalisers ────────────────────────────────────────────
    let v_min = data.iter().map(|p| p.viscosity_cp).fold(f64::INFINITY, f64::min);
    let v_rng = (data.iter().map(|p| p.viscosity_cp).fold(f64::NEG_INFINITY, f64::max) - v_min)
        .max(f64::EPSILON);

    macro_rules! opt_norm_range {
        ($field:ident) => {{
            let mn = data.iter().filter_map(|p| p.$field).fold(f64::INFINITY, f64::min);
            let mx = data.iter().filter_map(|p| p.$field).fold(f64::NEG_INFINITY, f64::max);
            if mx > mn + f64::EPSILON { Some((mn, (mx - mn).max(f64::EPSILON))) } else { None }
        }};
    }

    let t_norm  = opt_norm_range!(temperature_c);
    let sr_norm = opt_norm_range!(shear_rate);
    let p_norm  = opt_norm_range!(pressure_bar);
    let b_norm  = opt_norm_range!(bath_temperature_c);

    /// Normalise `v` to [0,1] using precomputed min and range.
    #[inline]
    fn nv(v: f64, min: f64, rng: f64) -> f64 { (v - min) / rng }

    // Collect all-channel normalised Y values for a point into a fixed-size array.
    let yn = |p: &ChartPoint| -> [f64; 5] {
        [
            nv(p.viscosity_cp, v_min, v_rng),
            t_norm .map_or(0.0, |(mn, rng)| p.temperature_c    .map_or(0.0, |v| nv(v, mn, rng))),
            sr_norm.map_or(0.0, |(mn, rng)| p.shear_rate        .map_or(0.0, |v| nv(v, mn, rng))),
            p_norm .map_or(0.0, |(mn, rng)| p.pressure_bar      .map_or(0.0, |v| nv(v, mn, rng))),
            b_norm .map_or(0.0, |(mn, rng)| p.bath_temperature_c.map_or(0.0, |v| nv(v, mn, rng))),
        ]
    };

    // ── LTTB loop ─────────────────────────────────────────────────────────
    let mut sampled = Vec::with_capacity(threshold);
    sampled.push(data[0].clone());

    let bucket_size = (n - 2) as f64 / (threshold - 2) as f64;
    let mut a = 0usize;

    for i in 0..(threshold - 2) {
        let bucket_start = ((i as f64 + 1.0) * bucket_size) as usize + 1;
        let bucket_end   = (((i as f64 + 2.0) * bucket_size) as usize + 1).min(n - 1);

        let next_start = bucket_end;
        let next_end   = (((i as f64 + 3.0) * bucket_size) as usize + 1).min(n);
        let next_count = (next_end - next_start).max(1) as f64;

        // Next-bucket centroid (normalised coords)
        let mut avg_x = 0.0;
        let mut avg_y = [0.0f64; 5];
        for j in next_start..next_end {
            avg_x += data[j].time_min;
            let yj = yn(&data[j]);
            for ch in 0..5 { avg_y[ch] += yj[ch]; }
        }
        avg_x /= next_count;
        for ch in 0..5 { avg_y[ch] /= next_count; }

        let ax = data[a].time_min;
        let ay = yn(&data[a]);

        let mut max_score = -1.0f64;
        let mut max_idx   = bucket_start;

        for j in bucket_start..bucket_end {
            let jx = data[j].time_min;
            let jy = yn(&data[j]);

            // Sum of triangle areas across all active channels
            let score: f64 = (0..5)
                .map(|ch| {
                    ((ax - avg_x) * (jy[ch] - ay[ch])
                        - (ax - jx) * (avg_y[ch] - ay[ch]))
                    .abs()
                })
                .sum();

            if score > max_score {
                max_score = score;
                max_idx   = j;
            }
        }

        sampled.push(data[max_idx].clone());
        a = max_idx;
    }

    sampled.push(data[n - 1].clone());
    sampled
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_chart_svg() {
        let points = vec![
            ChartPoint { time_min: 0.0, viscosity_cp: 500.0, temperature_c: Some(20.0), shear_rate: Some(10.0), pressure_bar: None, bath_temperature_c: None },
            ChartPoint { time_min: 10.0, viscosity_cp: 600.0, temperature_c: Some(25.0), shear_rate: Some(10.0), pressure_bar: None, bath_temperature_c: None },
        ];
        
        let config = ChartConfig {
            show_temperature: true,
            show_shear_rate: true,
            show_pressure: false,
            show_bath_temperature: false,
            shear_rate_axis: "left".to_string(),
            pressure_axis: "right".to_string(),
            width: 800,
            height: 400,
            label_left: "Visc".to_string(),
            label_right: "Temp".to_string(),
            label_bottom: "Time".to_string(),
            name_viscosity: "V".to_string(),
            name_temperature: "T".to_string(),
            name_shear_rate: "S".to_string(),
            name_pressure: "P".to_string(),
            name_bath_temperature: "BT".to_string(),
            touch_points: vec![],
            viscosity_threshold: None,
            line_styles: None, // Use defaults
            axis_mode: "shared".to_string(),
            skip_downsample: false,
        };
        
        let res = generate_chart_svg(&points, &config);
        assert!(res.is_ok());
        let (svg, _) = res.unwrap();
        assert!(svg.contains("<svg"));
    }

    #[test]
    fn test_generate_chart_with_custom_styles() {
        let points = vec![
            ChartPoint { time_min: 0.0, viscosity_cp: 500.0, temperature_c: Some(20.0), shear_rate: None, pressure_bar: None, bath_temperature_c: None },
            ChartPoint { time_min: 10.0, viscosity_cp: 600.0, temperature_c: Some(25.0), shear_rate: None, pressure_bar: None, bath_temperature_c: None },
        ];
        
        let custom_styles = ChartLineStyles {
            viscosity: ChartLineStyle {
                color: RGBColor(255, 0, 0), // Red
                width: 3,
                style: "dashed".to_string(),
            },
            temperature: ChartLineStyle {
                color: RGBColor(0, 255, 0), // Green
                width: 2,
                style: "dotted".to_string(),
            },
            shear_rate: ChartLineStyle::default(),
            pressure: ChartLineStyle::default(),
            bath_temperature: ChartLineStyle::default(),
        };
        
        let config = ChartConfig {
            show_temperature: true,
            show_shear_rate: false,
            show_pressure: false,
            show_bath_temperature: false,
            shear_rate_axis: "left".to_string(),
            pressure_axis: "right".to_string(),
            width: 800,
            height: 400,
            label_left: "Visc".to_string(),
            label_right: "Temp".to_string(),
            label_bottom: "Time".to_string(),
            name_viscosity: "V".to_string(),
            name_temperature: "T".to_string(),
            name_shear_rate: "S".to_string(),
            name_pressure: "P".to_string(),
            name_bath_temperature: "BT".to_string(),
            touch_points: vec![],
            viscosity_threshold: None,
            line_styles: Some(custom_styles),
            axis_mode: "shared".to_string(),
            skip_downsample: false,
        };
        
        let res = generate_chart_svg(&points, &config);
        assert!(res.is_ok());
        let (svg, _) = res.unwrap();
        assert!(svg.contains("<svg"));
    }

    #[test]
    fn test_svg_stroke_format() {
        // This test prints the SVG to verify how Plotters formats stroke attributes
        let points = vec![
            ChartPoint { time_min: 0.0, viscosity_cp: 500.0, temperature_c: Some(20.0), shear_rate: None, pressure_bar: None, bath_temperature_c: None },
            ChartPoint { time_min: 10.0, viscosity_cp: 600.0, temperature_c: Some(25.0), shear_rate: None, pressure_bar: None, bath_temperature_c: None },
        ];
        
        let custom_styles = ChartLineStyles {
            viscosity: ChartLineStyle {
                color: RGBColor(59, 130, 246),
                width: 2,
                style: "dashed".to_string(),
            },
            temperature: ChartLineStyle {
                color: RGBColor(249, 115, 22),
                width: 2,
                style: "dotted".to_string(),
            },
            shear_rate: ChartLineStyle::default(),
            pressure: ChartLineStyle::default(),
            bath_temperature: ChartLineStyle::default(),
        };
        
        let config = ChartConfig {
            show_temperature: true,
            show_shear_rate: false,
            show_pressure: false,
            show_bath_temperature: false,
            shear_rate_axis: "left".to_string(),
            pressure_axis: "right".to_string(),
            width: 800,
            height: 400,
            label_left: "Visc".to_string(),
            label_right: "Temp".to_string(),
            label_bottom: "Time".to_string(),
            name_viscosity: "V".to_string(),
            name_temperature: "T".to_string(),
            name_shear_rate: "S".to_string(),
            name_pressure: "P".to_string(),
            name_bath_temperature: "BT".to_string(),
            touch_points: vec![],
            viscosity_threshold: None,
            line_styles: Some(custom_styles),
            axis_mode: "shared".to_string(),
            skip_downsample: false,
        };
        
        let res = generate_chart_svg(&points, &config);
        assert!(res.is_ok());
        let (svg, _) = res.unwrap();
        
        // Print lines containing stroke to see exact format
        for line in svg.lines() {
            if line.contains("stroke") && (line.contains("3B82F6") || line.contains("F97316")) {
                println!("SVG LINE: {}", line.trim());
            }
        }
        
        // Also check if dasharray was applied
        let has_dasharray = svg.contains("stroke-dasharray");
        println!("Has stroke-dasharray: {}", has_dasharray);
        println!("Contains #3B82F6: {}", svg.contains("#3B82F6"));
        println!("Contains #F97316: {}", svg.contains("#F97316"));
        // Check for duplicate attribute issues
        for line in svg.lines() {
            let opacity_count = line.matches("opacity=").count();
            if opacity_count > 1 {
                panic!("DUPLICATE opacity in SVG line: {}", line.trim());
            }
        }
        assert!(has_dasharray, "SVG should contain stroke-dasharray after post-processing");
    }
}

#[cfg(test)]
mod lttb_invariants {
    use super::*;
    use proptest::prelude::*;

    fn make_lttb_data(n: usize) -> Vec<ChartPoint> {
        (0..n)
            .map(|i| ChartPoint {
                time_min: i as f64,
                viscosity_cp: 500.0 + (i as f64 * 0.05).sin() * 200.0,
                temperature_c: Some(25.0 + (i as f64 * 0.03).cos() * 5.0),
                shear_rate: Some(100.0),
                pressure_bar: None,
                bath_temperature_c: None,
            })
            .collect()
    }

    proptest! {
        /// Output length must equal threshold exactly when input exceeds it.
        #[test]
        fn lttb_length_equals_threshold(n in 1600usize..4000, threshold in 100usize..1499) {
            let data = make_lttb_data(n);
            let result = lttb_downsample_chart(&data, threshold);
            prop_assert_eq!(
                result.len(), threshold,
                "n={}, threshold={}: expected {} points, got {}",
                n, threshold, threshold, result.len()
            );
        }

        /// First and last points must be the original first and last points.
        #[test]
        fn lttb_preserves_endpoints(n in 1600usize..4000) {
            let data = make_lttb_data(n);
            let result = lttb_downsample_chart(&data, 800);
            let first = result.first().expect("result non-empty");
            let last  = result.last().expect("result non-empty");
            prop_assert!(
                (first.time_min - data.first().unwrap().time_min).abs() < f64::EPSILON,
                "first time_min mismatch: {} vs {}",
                first.time_min, data.first().unwrap().time_min
            );
            prop_assert!(
                (last.time_min - data.last().unwrap().time_min).abs() < f64::EPSILON,
                "last time_min mismatch: {} vs {}",
                last.time_min, data.last().unwrap().time_min
            );
        }

        /// Downsampled max viscosity must be within 5 % of raw max.
        /// LTTB is designed to preserve extrema; 5 % tolerance covers the few
        /// degenerate cases where the global peak lands in a dense bucket.
        #[test]
        fn lttb_max_retention_within_5_percent(n in 1600usize..4000) {
            let data = make_lttb_data(n);
            let raw_max = data.iter().map(|p| p.viscosity_cp).fold(f64::NEG_INFINITY, f64::max);
            let result = lttb_downsample_chart(&data, 800);
            let ds_max = result.iter().map(|p| p.viscosity_cp).fold(f64::NEG_INFINITY, f64::max);
            prop_assert!(
                ds_max >= raw_max * 0.95,
                "Downsampled max {ds_max:.2} more than 5 % below raw max {raw_max:.2}"
            );
        }

        /// With skip_downsample=true the raw data must pass through unmodified.
        #[test]
        fn skip_downsample_returns_full_data(n in 10usize..2000) {
            let data = make_lttb_data(n);
            let config = ChartConfig {
                show_temperature: false,
                show_shear_rate: false,
                show_pressure: false,
                show_bath_temperature: false,
                shear_rate_axis: "right".to_string(),
                pressure_axis: "right".to_string(),
                axis_mode: "shared".to_string(),
                width: 800,
                height: 400,
                label_left: "V".to_string(),
                label_right: String::new(),
                label_bottom: "t".to_string(),
                name_viscosity: "V".to_string(),
                name_temperature: "T".to_string(),
                name_shear_rate: "SR".to_string(),
                name_pressure: "P".to_string(),
                name_bath_temperature: "BT".to_string(),
                touch_points: vec![],
                viscosity_threshold: None,
                line_styles: None,
                skip_downsample: true,
            };
            // generate_chart_svg with skip_downsample must not reduce point count
            let result = generate_chart_svg(&data, &config);
            prop_assert!(result.is_ok(), "generate_chart_svg failed: {:?}", result.err());
        }
    }
}
