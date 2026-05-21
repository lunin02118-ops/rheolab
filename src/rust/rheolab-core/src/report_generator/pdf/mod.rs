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

fn split_data_uri_payload(value: &str) -> (Option<&str>, &str) {
    let trimmed = value.trim();
    if let Some((header, payload)) = trimmed.split_once(',') {
        if header.trim_start().to_ascii_lowercase().starts_with("data:") {
            return (Some(header), payload.trim());
        }
    }
    (None, trimmed)
}

fn sniff_logo_file_name(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1A\n") {
        return Some("logo.png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("logo.jpg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("logo.gif");
    }

    if let Ok(text) = std::str::from_utf8(bytes) {
        let trimmed = text.trim_start_matches('\u{feff}').trim_start();
        if trimmed.starts_with("<svg") || (trimmed.starts_with("<?xml") && trimmed.contains("<svg")) {
            return Some("logo.svg");
        }
    }

    None
}

fn logo_file_name_from_header(header: &str) -> Option<&'static str> {
    let lower = header.to_ascii_lowercase();
    if lower.contains("image/svg+xml") {
        Some("logo.svg")
    } else if lower.contains("image/png") {
        Some("logo.png")
    } else if lower.contains("image/jpeg") || lower.contains("image/jpg") {
        Some("logo.jpg")
    } else if lower.contains("image/gif") {
        Some("logo.gif")
    } else {
        None
    }
}

pub(crate) fn decode_company_logo_asset(value: &str) -> Option<(&'static str, Vec<u8>)> {
    let (header, payload) = split_data_uri_payload(value);
    let bytes = BASE64_STANDARD.decode(payload).ok()?;
    let file_name = header
        .and_then(logo_file_name_from_header)
        .or_else(|| sniff_logo_file_name(&bytes))?;
    Some((file_name, bytes))
}

pub(crate) fn company_logo_asset_name(value: &str) -> Option<&'static str> {
    decode_company_logo_asset(value).map(|(file_name, _)| file_name)
}

pub fn generate_pdf_report(input_json: &str) -> Result<Vec<u8>, String> {
    let input: ReportInput = serde_json::from_str(input_json).map_err(|e| e.to_string())?;
    generate_pdf_from_input(&input)
}

/// Generate a PDF report from a pre-parsed `ReportInput`.
pub fn generate_pdf_from_input(input: &ReportInput) -> Result<Vec<u8>, String> {
    let mut files = HashMap::new();

    // Decode Logo
    if let Some(logo_b64) = &input.metadata.company_logo_base64 {
        if let Some((file_name, bytes)) = decode_company_logo_asset(logo_b64) {
            files.insert(file_name.to_string(), bytes);
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
        const CHART_BODY_TARGET_PT: f64 = 395.0;
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

#[cfg(test)]
mod tests {
    use super::*;

    fn svg_logo_data_uri() -> String {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="18" fill="#0F172A"/></svg>"##;
        format!("data:image/svg+xml;base64,{}", BASE64_STANDARD.encode(svg))
    }

    fn minimal_input(company_logo_base64: Option<String>) -> ReportInput {
        ReportInput {
            raw_data: vec![],
            metadata: ReportMetadata {
                filename: "logo-test".to_string(),
                company_name: Some("RheoLab".to_string()),
                company_logo_base64,
                ..Default::default()
            },
            cycle_results: vec![],
            recipe: vec![],
            water_params: None,
            cycles: vec![],
            settings: ReportSettings::default(),
            chart_image_base64: None,
            axis_values: None,
        }
    }

    fn minimal_chart_config() -> ChartConfig {
        ChartConfig {
            show_temperature: false,
            show_shear_rate: false,
            show_pressure: false,
            show_bath_temperature: false,
            shear_rate_axis: "right".to_string(),
            pressure_axis: "right".to_string(),
            axis_mode: "shared".to_string(),
            width: 1040,
            height: 617,
            label_left: "Viscosity".to_string(),
            label_right: String::new(),
            label_bottom: "Time (min)".to_string(),
            name_viscosity: "Viscosity".to_string(),
            name_temperature: "Temperature".to_string(),
            name_shear_rate: "Shear rate".to_string(),
            name_pressure: "Pressure".to_string(),
            name_bath_temperature: "Bath temperature".to_string(),
            touch_points: vec![],
            viscosity_threshold: None,
            line_styles: None,
            skip_downsample: true,
            time_format: "minutes".to_string(),
        }
    }

    #[test]
    fn detects_svg_logo_data_uri() {
        assert_eq!(company_logo_asset_name(&svg_logo_data_uri()), Some("logo.svg"));
    }

    #[test]
    fn pdf_compiles_with_svg_company_logo() {
        let input = minimal_input(Some(svg_logo_data_uri()));
        let pdf = generate_pdf_from_input(&input).expect("PDF should compile with SVG logo");
        assert!(pdf.starts_with(b"%PDF-"));
    }

    #[test]
    fn single_report_chart_page_matches_experiment_header_margins() {
        let input = minimal_input(None);
        let files = HashMap::new();
        let chart_config = minimal_chart_config();
        let src = template::generate_typst_template(&input, &files, true, Some(&chart_config), None);

        assert!(src.contains("margin: (top: 3.5cm, bottom: 2cm, x: 1cm)"),
            "global experiment page margins must remain the baseline");
        assert!(src.contains("flipped: true, margin: (top: 3.5cm, bottom: 2cm"),
            "single-report chart page must align header height with experiment pages");
        assert!(!src.contains("top: 2.5cm"));
        assert!(!src.contains("bottom: 1.2cm"));
    }
}
