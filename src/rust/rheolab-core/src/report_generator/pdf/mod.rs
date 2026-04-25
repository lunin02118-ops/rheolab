// PDF Report Generator with Native Plotters Charts
use serde_json;
use super::types::*;
use super::typst_renderer::compile_to_pdf;
use super::chart_generator::{ChartPoint, ChartConfig, ChartLineStyles, generate_chart_svg};
use super::formatters::{convert_viscosity, get_viscosity_unit, resolve_units, time_axis_unit};
use base64::prelude::*;
use std::collections::HashMap;

pub(crate) mod template;

// Re-exports consumed by the comparison assembler (Phase 1.E+).
// `#[allow(unused_imports)]` keeps the warning suppressed between phases
// 1.D (lands the helpers) and 1.E (starts consuming them).
#[allow(unused_imports)]
pub(crate) use template::{build_typst_globals, build_single_experiment_body};
pub fn generate_pdf_report(input_json: &str) -> Result<Vec<u8>, String> {
    let input: ReportInput = serde_json::from_str(input_json).map_err(|e| e.to_string())?;
    generate_pdf_from_input(&input)
}

/// Generate a PDF report from a pre-parsed `ReportInput`.
pub fn generate_pdf_from_input(input: &ReportInput) -> Result<Vec<u8>, String> {
    let mut files = HashMap::new();

    // Decode Logo
    if let Some(logo_b64) = &input.metadata.company_logo_base64 {
        let b64_clean = if let Some(idx) = logo_b64.find(',') {
            &logo_b64[idx + 1..]
        } else {
            logo_b64
        };
        
        if let Ok(bytes) = BASE64_STANDARD.decode(b64_clean) {
             files.insert("logo.png".to_string(), bytes);
        }
    }

    // Generate chart using Plotters (native, no browser fallback)
    let (has_chart, config_out, ranges_out) = if !input.raw_data.is_empty() {
        let is_ru = input.settings.language == "ru";
        let unit_system = &input.settings.unit_system;
        let visc_unit   = get_viscosity_unit(unit_system);
        // Resolve per-category target units — `time_format` drives the X-axis
        // unit suffix and tick-label rendering so the chart matches the
        // dashboard's selected time display.  When `rheology_units` is
        // absent, `resolve_units` returns `time_format: "minutes"`, which
        // reproduces the legacy (pre-2026-04-22) output byte-for-byte.
        let resolved = resolve_units(input);
        let time_fmt = resolved.time_format.clone();
        let time_unit = time_axis_unit(&time_fmt, if is_ru { "ru" } else { "en" });

        // Convert data points — keep storage-unit (mPa·s) viscosity here so the
        // touch-point algorithm (which compares against `viscosity_threshold`
        // given in mPa·s) stays numerically consistent.
        let first_time = input.raw_data.first().map(|f| f.time_sec).unwrap_or(0.0);
        let chart_points: Vec<ChartPoint> = input.raw_data.iter().map(|p| {
            ChartPoint {
                time_min: (p.time_sec - first_time) / 60.0,
                viscosity_cp: p.viscosity_cp,
                temperature_c: p.temperature_c,
                shear_rate: p.shear_rate,
                pressure_bar: p.pressure_bar,
                bath_temperature_c: p.bath_temperature_c,
            }
        }).collect();
        

        // Prepare labels — viscosity unit follows the global display setting.
        let l_visc = if is_ru { format!("Вязкость ({})", visc_unit) } else { format!("Viscosity ({})", visc_unit) };
        let l_temp = if is_ru { "Температура (°C)" } else { "Temperature (°C)" };
        let l_shear = if is_ru { "Скорость сдвига (1/с)" } else { "Shear Rate (1/s)" };
        let l_press = if is_ru { "Давление (бар)" } else { "Pressure (bar)" };
        let l_time = if is_ru {
            format!("Время ({})", time_unit)
        } else {
            format!("Time ({})", time_unit)
        };
        
        let n_visc = if is_ru { "Вязкость" } else { "Viscosity" };
        let n_temp = if is_ru { "Температура" } else { "Temperature" };
        let n_shear = if is_ru { "Скор. сдвига" } else { "Shear Rate" };
        let n_press = if is_ru { "Давление" } else { "Pressure" };
        let l_bath_temp = if is_ru { "Темп. бани (°C)" } else { "Bath Temp (°C)" };
        let n_bath_temp = if is_ru { "Темп. бани" } else { "Bath Temp" };

        // Build LEFT axis label — follows user's per-line axis settings directly.
        // axis_mode ('individual' vs 'shared') does not override placement here;
        // it only affects whether individual plotters scales are used.
        let mut left_parts = vec![l_visc.to_string()];
        if input.settings.show_shear_rate && input.settings.shear_rate_axis == "left" {
            left_parts.push(l_shear.to_string());
        }
        if input.settings.show_pressure && input.settings.pressure_axis == "left" {
            left_parts.push(l_press.to_string());
        }
        let label_left = left_parts.join(" / ");

        // Build RIGHT axis label
        let mut right_parts = Vec::new();
        if input.settings.show_temperature {
            right_parts.push(l_temp.to_string());
        }
        if input.settings.show_shear_rate && input.settings.shear_rate_axis == "right" {
            right_parts.push(l_shear.to_string());
        }
        if input.settings.show_pressure && input.settings.pressure_axis == "right" {
            right_parts.push(l_press.to_string());
        }
        if input.settings.show_bath_temperature {
            right_parts.push(l_bath_temp.to_string());
        }
        let label_right = right_parts.join(" / ");

        // Calculate touch points if enabled (algorithm runs in storage unit mPa·s).
        let touch_points_raw = if input.settings.show_touch_points {
            template::calculate_touch_points_for_chart(&chart_points, &input.settings, is_ru, unit_system)
        } else {
            vec![]
        };
        // Convert touch-point viscosity to display unit so they align with the
        // (also converted) chart data series on the y-axis.
        let touch_points: Vec<_> = touch_points_raw.into_iter().map(|tp| super::chart_generator::ChartTouchPoint {
            time: tp.time,
            viscosity: convert_viscosity(tp.viscosity, unit_system),
            label: tp.label,
            color: tp.color,
        }).collect();

        // Convert line settings if provided
        let line_styles = input.settings.line_settings.as_ref().map(|ls| ChartLineStyles::from(ls));

        // ── Dynamic SVG height ───────────────────────────────────────────────────
        // Goal: rendered chart image fills the available body height exactly, so
        // there is no blank gap between the legend and the footer regardless of
        // how many extra axis columns are present.
        //
        // A4 landscape body height = 595 - top(3.5cm=99pt) - bottom(2cm=57pt) = 439pt
        // Non-chart content (spacers + axis-label + legend) ≈ 44pt
        // → target chart render height = 395pt
        //
        // Rendered chart height = text_width_pt × svg_h / svg_w
        // → svg_h = 395 × svg_w / text_width_pt
        //
        // text_width_pt = 842 - 2 × (50 + n_extra × AXIS_SPACING)
        //   where n_extra = max(n_left_axes-1, n_right_axes-1)  for individual mode
        //                 = 0                                    for shared mode
        const SVG_W: f64 = 1040.0;
        const CHART_BODY_TARGET_PT: f64 = 422.0; // chart render height target (legend inset=3pt, size=8pt saves ~4pt vs before)
        // A4 landscape body = 595 - top(2.5cm=71pt) - bottom(1.2cm=34pt) = 490pt
        // Non-chart (axis label + legend + v(4pt)+v(2pt)) ≈ 35pt; #set block/par spacing:0pt
        // → 422 target leaves 33pt buffer
        const AXIS_SPACING_PT: f64 = 60.0; // Must match chart_generator::AXIS_SPACING_PX
        const PAGE_BASE_MARGIN_PT: f64 = 28.0; // ~1 cm from page edge
        const A4_LANDSCAPE_W_PT: f64 = 842.0;
        let _is_individual = input.settings.axis_mode.trim().to_lowercase() == "individual";
        // Symmetric margin: use max(left, right) so chart is always centred.
        // SVG internal margins are already asymmetric — they handle axis placement.
        // Same formula for BOTH individual and shared modes so chart body width
        // is identical regardless of axis mode.
        let n_left_top: usize = 1  // viscosity always left
            + if input.settings.show_shear_rate && input.settings.shear_rate_axis.trim().to_lowercase() == "left" { 1 } else { 0 }
            + if input.settings.show_pressure  && input.settings.pressure_axis.trim().to_lowercase()  == "left" { 1 } else { 0 };
        let n_right_top: usize =
            // temperature + bath_temperature share one axis column
              if input.settings.show_temperature || input.settings.show_bath_temperature { 1 } else { 0 }
            + if input.settings.show_shear_rate && input.settings.shear_rate_axis.trim().to_lowercase() == "right" { 1 } else { 0 }
            + if input.settings.show_pressure  && input.settings.pressure_axis.trim().to_lowercase()  == "right" { 1 } else { 0 };
        // Minimum 1 extra column per side guarantees stable chart body width
        // regardless of how many axes the user enables or which mode is selected.
        // This keeps the header, footer, and chart frame constant.
        const MIN_EXTRA: usize = 1;
        let n_extra_max: usize = (n_left_top.saturating_sub(1)).max(n_right_top.saturating_sub(1)).max(MIN_EXTRA);
        let text_width_pt = A4_LANDSCAPE_W_PT
            - 2.0 * (PAGE_BASE_MARGIN_PT + n_extra_max as f64 * AXIS_SPACING_PT);
        let svg_h_dynamic = ((CHART_BODY_TARGET_PT * SVG_W) / text_width_pt)
            .round()
            .clamp(400.0, 900.0) as u32;
        // ────────────────────────────────────────────────────────────────────────

        let chart_config = ChartConfig {
            show_temperature: input.settings.show_temperature,
            show_shear_rate: input.settings.show_shear_rate,
            show_pressure: input.settings.show_pressure,
            show_bath_temperature: input.settings.show_bath_temperature,
            shear_rate_axis: input.settings.shear_rate_axis.clone(),
            pressure_axis: input.settings.pressure_axis.clone(),
            axis_mode: input.settings.axis_mode.clone(),
            width: 1040,
            height: svg_h_dynamic, // computed so rendered chart fills available body height
            
            label_left,
            label_right,
            label_bottom: l_time.to_string(),
            
            name_viscosity: n_visc.to_string(),
            name_temperature: n_temp.to_string(),
            name_shear_rate: n_shear.to_string(),
            name_pressure: n_press.to_string(),
            name_bath_temperature: n_bath_temp.to_string(),
            
            touch_points,
            viscosity_threshold: if input.settings.show_touch_points {
                // Threshold is stored in mPa·s; convert to display unit so it aligns
                // with the converted viscosity series drawn on the chart.
                Some(convert_viscosity(input.settings.viscosity_threshold, unit_system))
            } else {
                None
            },
            line_styles,
            skip_downsample: true, // PDF needs full-precision data, no LTTB
            time_format: time_fmt,
        };

        // Build a display-unit view of the data for rendering. LTTB is disabled
        // for PDF, so length/order match `chart_points` exactly.
        let display_chart_points: Vec<ChartPoint> = chart_points.iter().map(|p| ChartPoint {
            time_min: p.time_min,
            viscosity_cp: convert_viscosity(p.viscosity_cp, unit_system),
            temperature_c: p.temperature_c,
            shear_rate: p.shear_rate,
            pressure_bar: p.pressure_bar,
            bath_temperature_c: p.bath_temperature_c,
        }).collect();

        // Generate chart - safe wrapper to debug panics
        let svg_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            generate_chart_svg(&display_chart_points, &chart_config)
        }));
        
        let (svg_string, ranges) = match svg_result {
            Ok(res) => res?, // Normal result or error
            Err(e) => {
                // Determine panic message
                let msg = if let Some(s) = e.downcast_ref::<&str>() {
                    format!("Panic: {}", s)
                } else if let Some(s) = e.downcast_ref::<String>() {
                    format!("Panic: {}", s)
                } else {
                    "Unknown panic in chart generator".to_string()
                };
                eprintln!("[rheolab-core] {}", msg);
                return Err(format!("Panic in chart gen: {}", msg));
            }
        };
        
        files.insert("chart.svg".to_string(), svg_string.into_bytes());
        (true, Some(chart_config), Some(ranges))
    } else {
        (false, None, None)
    };

    // Compile Typst
    let typst_src = template::generate_typst_template(&input, &files, has_chart, config_out.as_ref(), ranges_out.as_ref());
    compile_to_pdf(&typst_src, files)
}
