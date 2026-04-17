// PDF Report Generator with Native Plotters Charts
use serde_json;
use super::types::*;
use super::typst_renderer::compile_to_pdf;
use super::formatters::{
    format_date, format_number, format_number_direct, build_ramp_string, 
    get_k_unit, get_pv_unit, get_yp_unit, 
    convert_consistency_index, convert_pv, convert_yp,
    decimals  // Единые константы форматирования
};
use super::chart_generator::{ChartPoint, ChartConfig, ChartTouchPoint, ChartLineStyle, ChartLineStyles, generate_chart_svg, ChartRanges};
use plotters::style::RGBColor;
use base64::prelude::*;
use std::collections::HashMap;

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
        
        // Convert data points
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
        

        // Prepare labels
        let l_visc = if is_ru { "Вязкость (сП)" } else { "Viscosity (cP)" };
        let l_temp = if is_ru { "Температура (°C)" } else { "Temperature (°C)" };
        let l_shear = if is_ru { "Скорость сдвига (1/с)" } else { "Shear Rate (1/s)" };
        let l_press = if is_ru { "Давление (бар)" } else { "Pressure (bar)" };
        let l_time = if is_ru { "Время (мин)" } else { "Time (min)" };
        
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

        // Calculate touch points if enabled
        let touch_points = if input.settings.show_touch_points {
            calculate_touch_points_for_chart(&chart_points, &input.settings, is_ru)
        } else {
            vec![]
        };

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
                Some(input.settings.viscosity_threshold)
            } else {
                None
            },
            line_styles,
            skip_downsample: true, // PDF needs full-precision data, no LTTB
        };
        

        // Generate chart - safe wrapper to debug panics
        let svg_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            generate_chart_svg(&chart_points, &chart_config)
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
    let typst_src = generate_typst_template(&input, &files, has_chart, config_out.as_ref(), ranges_out.as_ref());
    compile_to_pdf(&typst_src, files)
}


fn generate_typst_template(
    input: &ReportInput, 
    _files: &HashMap<String, Vec<u8>>,
    has_chart: bool,
    chart_config: Option<&ChartConfig>,
    chart_ranges: Option<&ChartRanges>
) -> String {
    let is_ru = input.settings.language == "ru";
    let date_str = format_date(&input.metadata.test_date, &input.settings.language);
    
    // --- Translations ---
    let t_passport = if is_ru { "Паспорт теста" } else { "Test Passport" };
    let t_recipe = if is_ru { "Рецептура жидкости" } else { "Fluid Recipe" }; 
    let t_cal = if is_ru { "Калибровка" } else { "Calibration" };
    let t_water = if is_ru { "Анализ воды" } else { "Water Analysis" };
    let t_stats = if is_ru { "Реологическая статистика" } else { "Rheological Statistics" };
    
    let l_file = if is_ru { "ID / Файл:" } else { "ID / File:" };
    let l_date = if is_ru { "Дата:" } else { "Date:" };
    let l_oper = if is_ru { "Оператор:" } else { "Operator:" };
    let l_lab = if is_ru { "Лаборатория:" } else { "Laboratory:" };
    let l_field = if is_ru { "Месторождение:" } else { "Field:" };
    let l_well = if is_ru { "Скважина:" } else { "Well:" };
    let l_inst = if is_ru { "Прибор:" } else { "Instrument:" };
    let l_source = if is_ru { "Источник воды:" } else { "Water Source:" };

    // Calibration Labels
    let _l_c_dev = if is_ru { "Прибор:" } else { "Device:" };
    let l_c_date = if is_ru { "Дата калибровки:" } else { "Cal. Date:" };
    let l_c_r2 = "R²:";
    let l_c_slope = "Slope / Intercept:";
    let l_c_hyst = "Hyst / STDEV:";
    let l_c_status = if is_ru { "Статус:" } else { "Status:" };

    // Recipe Headers
    let h_name = if is_ru { "Наименование" } else { "Name" };
    let h_lot = if is_ru { "Лот.номер" } else { "Lot No" };
    let h_type = if is_ru { "Тип\\ реагента" } else { "Type" }; 
    let h_unit = if is_ru { "ЕИ" } else { "Unit" };
    let h_conc = if is_ru { "Конц." } else { "Conc." };

    // Header Info
    let company_name = input.metadata.company_name.as_deref().unwrap_or("RheoLab"); 
    let report_title_right = if is_ru { "Отчет о тестировании жидкости ГРП" } else { "Frac Fluid Test Report" };
    let test_id = input.metadata.test_id.as_deref().unwrap_or(input.metadata.filename.as_str());

    // --- Content Generation ---

    // 1. Passport Data
    let p_file = &input.metadata.filename;
    let p_oper = input.metadata.operator_name.as_deref().unwrap_or("-");
    let p_lab = input.metadata.laboratory_name.as_deref().unwrap_or("-");
    let p_field = input.metadata.field_name.as_deref().unwrap_or("-");
    let p_well = input.metadata.well_number.as_deref().unwrap_or("-");
    let p_inst = input.metadata.instrument_type.as_deref().unwrap_or("-");

    // 2. Calibration Block
    let mut cal_block = String::new();
    if input.settings.show_calibration {
        if let Some(cal) = &input.metadata.calibration {
            let _v_c_dev = escape_typst(cal.device_type.as_deref().unwrap_or("-"));
            let v_c_date = format_date(&cal.calibration_date, &input.settings.language);
            let v_c_r2 = format_number(cal.r_squared, 6);
            let v_c_slope = format_number(cal.slope, 4);
            let v_c_inter = format_number(cal.intercept, 4);
            let v_c_hyst = format_number(cal.hysteresis, 2);
            let v_c_stdev = format_number(cal.stdev, 2);
            let v_c_status = escape_typst(cal.status.as_deref().unwrap_or("-"));
            
            let status_color = if v_c_status == "PASS" { "rgb(\"#10B981\")" } else { "rgb(\"#EF4444\")" };

            cal_block = format!(r##"
                #section_header("{t_cal}")
                #v(5pt)
                #grid(
                  columns: (80pt, 1fr),
                  row-gutter: 6pt,
                  label[{l_c_date}], val[{v_c_date}],
                  label[{l_c_r2}], val[{v_c_r2}],
                  label[{l_c_slope}], val[{v_c_slope} / {v_c_inter}],
                  label[{l_c_hyst}], val[{v_c_hyst} / {v_c_stdev}],
                  label[{l_c_status}], text(fill: {status_color}, size: 8pt, weight: "bold")[{v_c_status}] 
                )
                #v(20pt)
            "##, 
                t_cal=t_cal,
                l_c_date=l_c_date, v_c_date=v_c_date,
                l_c_r2=l_c_r2, v_c_r2=v_c_r2,
                l_c_slope=l_c_slope, v_c_slope=v_c_slope, v_c_inter=v_c_inter,
                l_c_hyst=l_c_hyst, v_c_hyst=v_c_hyst, v_c_stdev=v_c_stdev,
                l_c_status=l_c_status, v_c_status=v_c_status, status_color=status_color
            );
        }
    }

    // 3. Water Table
    let default_wp = WaterParams::default();
    let wp = input.water_params.as_ref().unwrap_or(&default_wp);
    let water_source = wp.source.as_deref().unwrap_or("-");

    let water_params_list = vec![
        ("pH", wp.ph, "ед."),
        ("Fe", wp.fe, "мг/л"),
        ("Ca", wp.ca, "мг/л"),
        ("Mg", wp.mg, "мг/л"),
        ("Cl", wp.cl, "мг/л"),
        ("SO4", wp.so4, "мг/л"),
        ("HCO3", wp.hco3, "мг/л"),
    ];

    let mut w_header = String::new();
    let mut w_units = String::new();
    let mut w_values = String::new();
    
    for (label, val, unit) in water_params_list {
        w_header.push_str(&format!("[#text(weight: \"bold\", size: 8pt, fill: rgb(\"#1E293B\"))[{}]], ", label));
        w_units.push_str(&format!("[#text(weight: \"regular\", fill: rgb(\"#64748B\"), size: 7pt)[{}]], ", unit));
        w_values.push_str(&format!("[#text(weight: \"regular\", fill: rgb(\"#0F172A\"), size: 7.5pt)[{}]], ", format_number(val, 1)));
    }
    
    // 4. Recipe
    let mut recipe_rows = String::new();
    for r in &input.recipe {
        recipe_rows.push_str(&format!(
            "[{}], [{}], [{}], [{}], [{}],\n", 
            escape_typst(&r.name), 
            escape_typst(r.batch_number.as_deref().unwrap_or("-")),
            escape_typst(r.category.as_deref().unwrap_or("-")),
            escape_typst(&r.unit),
            r.concentration
        ));
    }

    // 5. Stats Rows - with unit system conversion
    // ЕДИНЫЙ ИСТОЧНИК: используем константы из formatters::decimals
    let unit_system = &input.settings.unit_system;
    let visc_rates = &input.settings.viscosity_shear_rates;
    let mut stats_rows = String::new();
    for c in &input.cycle_results {
        // Base columns: Cycle, Time, Temp, Pressure, n', K', Ks, Kp, R²
        let k_converted = convert_consistency_index(c.k_prime, unit_system);
        let ks_str = c.k_slot.map(|v| {
            let cv = convert_consistency_index(v, unit_system);
            format_number_direct(cv, decimals::K_PRIME)
        }).unwrap_or_else(|| "—".to_string());
        let kp_str = c.k_pipe.map(|v| {
            let cv = convert_consistency_index(v, unit_system);
            format_number_direct(cv, decimals::K_PRIME)
        }).unwrap_or_else(|| "—".to_string());
        let pv_converted = c.bingham_pv.map(|v| convert_pv(v, unit_system));
        let yp_converted = c.bingham_yp.map(|v| convert_yp(v, unit_system));
        
        // Base columns: Cycle, Time, Temp, Pressure, n', K', Ks, Kp, R²
        let mut row = format!(
            "[{}], [{}], [{}], [{}], [{}], [{}], [{}], [{}], [{}], ",
            c.cycle_no, 
            format_number_direct(c.time_min, decimals::TIME),
            format_number_direct(c.temp_c, decimals::TEMPERATURE),
            format_number(c.pressure_bar, decimals::PRESSURE),
            format_number_direct(c.n_prime, decimals::N_PRIME),
            format_number_direct(k_converted, decimals::K_PRIME),
            ks_str,
            kp_str,
            format_number_direct(c.r2, decimals::R_SQUARED)
        );
        
        // Dynamic viscosity columns from viscosities HashMap
        for rate in visc_rates {
            let key = format!("{}", rate);
            let visc_val = c.viscosities.get(&key).copied()
                .or_else(|| match *rate {
                    40 => c.visc_at_40,
                    100 => c.visc_at_100,
                    170 => c.visc_at_170,
                    _ => None,
                });
            row.push_str(&format!("[{}], ", format_number(visc_val, decimals::VISCOSITY_FIXED)));
        }
        
        // PV, YP, R²B (only in expert mode)
        if input.settings.show_advanced_stats {
            row.push_str(&format!(
                "[{}], [{}], [{}],\n",
                format_number(pv_converted, decimals::PV),
                format_number(yp_converted, decimals::YP),
                format_number(c.bingham_r2, decimals::BINGHAM_R2)
            ));
        } else {
            row.push('\n');
        }
        stats_rows.push_str(&row);
    }

    let h_cycle = if is_ru { "Цикл" } else { "Cycle" };
    // Variables use standard strings, so double backslash is needed to produce single backslash in output
    let h_time = if is_ru { "Время\\ #unit_text[(мин)]" } else { "Time\\ #unit_text[(min)]" };
    let h_temp = "T\\ #unit_text[(°C)]";
    let h_press = "P\\ #unit_text[(bar)]";
    
    // Dynamic unit headers based on unit system
    let h_k_unit = get_k_unit(unit_system);
    let h_pv_unit = get_pv_unit(unit_system);
    let h_yp_unit = get_yp_unit(unit_system);
    
    // Build dynamic stats table columns and headers based on viscosity_shear_rates
    let mut col_fractions = vec![
        "0.5fr".to_string(),  // Cycle
        "0.8fr".to_string(),  // Time
        "0.8fr".to_string(),  // Temp
        "0.8fr".to_string(),  // Pressure
        "0.8fr".to_string(),  // n'
        "1fr".to_string(),    // K'
        "0.9fr".to_string(),  // Ks
        "0.9fr".to_string(),  // Kp
        "0.8fr".to_string(),  // R²
    ];
    let mut header_cells = vec![
        format!("header_cell[{}]", h_cycle),
        format!("header_cell[{}]", h_time),
        format!("header_cell[{}]", h_temp),
        format!("header_cell[{}]", h_press),
        "header_cell[n']".to_string(),
        format!("header_cell[K'\\ #unit_text[({})]]" , h_k_unit),
        format!("header_cell[Ks\\ #unit_text[({})]]" , h_k_unit),
        format!("header_cell[Kp\\ #unit_text[({})]]" , h_k_unit),
        "header_cell[R²]".to_string(),
    ];
    
    // Dynamic viscosity columns
    for rate in visc_rates {
        col_fractions.push("1fr".to_string());
        header_cells.push(format!("header_cell[η\\@{}]", rate));
    }
    
    // PV, YP, R²B (only in expert mode)
    if input.settings.show_advanced_stats {
        col_fractions.push("1.1fr".to_string());
        header_cells.push(format!("header_cell[PV\\ #unit_text[({})]]" , h_pv_unit));
        col_fractions.push("1.1fr".to_string());
        header_cells.push(format!("header_cell[YP\\ #unit_text[({})]]" , h_yp_unit));
        col_fractions.push("0.8fr".to_string());
        header_cells.push("header_cell[R²B]".to_string());
    }
    
    let stats_columns = col_fractions.join(", ");
    let stats_headers_str = header_cells.join(", ");

    // Touch points table for right column (first page)
    let touch_points_block = if let Some(config) = chart_config {
        if !config.touch_points.is_empty() && input.settings.show_touch_points {
            let t_touch = if is_ru { "Контрольные точки" } else { "Control Points" };
            let mut rows = String::new();
            for tp in &config.touch_points {
                let is_threshold = tp.label.contains("Порог") || tp.label.contains("Threshold");
                let value_col = if is_threshold {
                    if is_ru { format!("{:.1} мин", tp.time) } else { format!("{:.1} min", tp.time) }
                } else {
                    if is_ru { format!("{:.1} сП", tp.viscosity) } else { format!("{:.1} cP", tp.viscosity) }
                };
                rows.push_str(&format!(
                    "[{}], [{}],\n",
                    escape_typst(&tp.label),
                    value_col
                ));
            }
            format!(r##"
  #section_header("{t_touch}")
  #v(5pt)
  #table(
    columns: (2fr, 1fr),
    stroke: 0.5pt + rgb("#E2E8F0"),
    fill: none,
    {rows}
  )
"##, t_touch = t_touch, rows = rows)
        } else {
            String::new()
        }
    } else {
        String::new()
    };
    let f_generated = if is_ru { "Сгенерировано:" } else { "Generated:" };
    let f_page = if is_ru { "Страница" } else { "Page" };

    // Logo block
    let logo_block = if input.metadata.company_logo_base64.is_some() {
        r#"image("logo.png", width: 40pt)"#.to_string()
    } else {
        "none".to_string()
    };

    // Chart Page Logic
    let chart_page = if has_chart {
        let _overlay = String::new();
        if let Some(config) = chart_config {
            // Colors matching Plotters config
            // Viscosity: #1d4ed8 (Blue)
            // Temperature: #dc2626 (Red)
            // Shear Rate: #a855f7 (Purple)
            
            let l_visc = escape_typst(&config.name_viscosity);
            let l_temp = escape_typst(&config.name_temperature);
            let l_shear = escape_typst(&config.name_shear_rate);
            let l_press = escape_typst(&config.name_pressure);
            let l_bath_temp = escape_typst(&config.name_bath_temperature);
            
            let axis_bottom = escape_typst(&config.label_bottom);
            let axis_left = escape_typst(&config.label_left);
            let axis_right = escape_typst(&config.label_right);
            
            // Helper to create a Typst line legend item with proper dash style
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
            
            let mut legend_items = vec![
                make_legend_line(&styles.viscosity, &l_visc, "cP")
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
            
            // Helper to generate tick labels for one axis column.
            // `side`         : "left" | "right" | "bottom"
            // `axis_px_side` : pixel distance of the axis line from its SVG side edge.
            //                  Left  side: px from SVG LEFT  (= left_margin  - side_idx*40)
            //                  Right side: px from SVG RIGHT (= right_margin - side_idx*40)
            //                  Bottom: pass TICK_MARGIN_PX (unused for horiz direction)
            // `color_typst_override`: Typst colour literal, e.g. "rgb(59,130,246)".
            //               Pass "" to use the axis-side default colour.
            //
            // All positions are in ABSOLUTE pt (no Typst %-strings).
            // This avoids the block-height ambiguity: Typst resolves X% against the
            // containing #block height, which can be larger than the SVG image alone.
            //
            // scale = text_width_pt / svg_w  (same horizontal and vertical, image keeps aspect ratio)
            //
            // Y-axis label position (top+left anchor, #place):
            //   Plotters SVG: Y=0 is top (max value), Y=svg_h is bottom (min value).
            //   pos_px_from_top = TICK_MARGIN + (1 - frac) * (svg_h - 2*TICK_MARGIN)
            //   dy_pt = pos_px_from_top * scale - 5    (5pt = half ~10pt text, centres on tick)
            //
            // X-axis (bottom) label position:
            //   pos_px_from_left = TICK_MARGIN + frac * (svg_w - 2*TICK_MARGIN)
            //   dx_pt = pos_px_from_left * scale
            //   dy_pt = img_height_pt + 5               (just below image)
            let svg_w = config.width as f64;
            let svg_h = config.height as f64;
            const TICK_MARGIN_PX: f64 = 10.0; // Must match chart_generator::tick_margin
            const AXIS_SPACING_PX: f64 = 60.0; // Must match chart_generator::AXIS_SPACING_PX

            // ── Scale computation (must precede both make_ticks and make_axis_title) ──────
            // Determine axis mode
            let is_individual_mode = chart_ranges
                .map_or(false, |r| !r.individual_axes.is_empty());

            // Settings-based axis counts — used as source of truth for margin and
            // overlay positioning in BOTH modes.  Must be computed before
            // n_left_extra / n_right_extra so shared mode can use them as fallback.
            let n_settings_left: usize = 1 // viscosity always left
                + if input.settings.show_shear_rate && input.settings.shear_rate_axis.trim().to_lowercase() == "left" { 1 } else { 0 }
                + if input.settings.show_pressure  && input.settings.pressure_axis.trim().to_lowercase()  == "left" { 1 } else { 0 };
            let n_settings_right: usize =
                  if input.settings.show_temperature || input.settings.show_bath_temperature { 1 } else { 0 }
                + if input.settings.show_shear_rate && input.settings.shear_rate_axis.trim().to_lowercase() == "right" { 1 } else { 0 }
                + if input.settings.show_pressure  && input.settings.pressure_axis.trim().to_lowercase()  == "right" { 1 } else { 0 };

            // Count extra axis columns per side (for dynamic page-margin calculation).
            // Individual mode: read actual axes drawn.  Shared mode: fall back to
            // settings-based counts so margins are identical to individual mode.
            let (n_left_extra, n_right_extra) = if let Some(r) = chart_ranges {
                if is_individual_mode {
                    let nl = r.individual_axes.iter()
                        .filter(|a| a.side == "left").map(|a| a.side_idx).max().unwrap_or(0);
                    let nr = r.individual_axes.iter()
                        .filter(|a| a.side == "right").map(|a| a.side_idx).max().unwrap_or(0);
                    (nl, nr)
                } else {
                    // Shared mode: use settings-based counts so that the Typst page
                    // margins, tick overlay positions, and X-axis bounds all match
                    // the individual mode layout exactly.
                    (n_settings_left.saturating_sub(1), n_settings_right.saturating_sub(1))
                }
            } else {
                (n_settings_left.saturating_sub(1), n_settings_right.saturating_sub(1))
            };

            const PAGE_WIDTH_PT: f64 = 842.0; // A4 landscape, pts
            let axis_step_pt: usize = AXIS_SPACING_PX as usize;
            // Symmetric margins: use max(left, right) so chart is centred on page.
            let n_settings_extra = (n_settings_left.saturating_sub(1)).max(n_settings_right.saturating_sub(1));
            // Minimum 1 extra → constant page margins (88pt) regardless of
            // axis count. Matches the SVG symmetric-margin formula.
            let extra = n_left_extra.max(n_right_extra).max(n_settings_extra).max(1);
            // Override per-side extras to symmetric value — critical for
            // correct tick label / axis title positioning in the overlay.
            let n_left_extra = extra;
            let n_right_extra = extra;
            let left_page_margin_pt  = 28usize + extra * axis_step_pt;
            let right_page_margin_pt = 28usize + extra * axis_step_pt;

            let text_width_pt  = PAGE_WIDTH_PT - left_page_margin_pt as f64
                                               - right_page_margin_pt as f64;
            let scale_x        = text_width_pt / svg_w;          // pt per SVG-px
            let img_height_pt  = text_width_pt * svg_h / svg_w;  // rendered image height in pt
            // ─────────────────────────────────────────────────────────────────────────────

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

                    let val_str = if (val.fract()).abs() < 1e-6 {
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
                            // tick right end from SVG LEFT = text_width_pt - eff_pt
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
                            // Major tick mark line extending downward from image bottom
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

            // Draws minor X-axis tick marks (short lines without labels) between major ticks.
            // Call after make_ticks for the bottom side to add intermediate visual reference.
            let make_x_minor_ticks = |min: f64, max: f64, major_step: f64, minor_step: f64| -> String {
                if minor_step < 1e-10 || major_step < 1e-10 { return String::new(); }
                let chart_left_px  = TICK_MARGIN_PX + n_left_extra  as f64 * AXIS_SPACING_PX;
                let chart_right_px = svg_w - TICK_MARGIN_PX - n_right_extra as f64 * AXIS_SPACING_PX;
                let mut s = String::new();
                let start = (min / minor_step).ceil() * minor_step;
                let mut val = if start < min - 1e-9 { start + minor_step } else { start };
                while val <= max + 1e-9 {
                    // Skip positions that coincide with a major tick (they already have marks)
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

            // Inline helper: convert SVG "#RRGGBB" to Typst "rgb(r, g, b)"
            let hex_to_typst = |hex: &str| -> String {
                let h = hex.trim_start_matches('#');
                if h.len() >= 6 {
                    let r = u8::from_str_radix(&h[0..2], 16).unwrap_or(128);
                    let g = u8::from_str_radix(&h[2..4], 16).unwrap_or(128);
                    let b = u8::from_str_radix(&h[4..6], 16).unwrap_or(128);
                    format!("rgb({}, {}, {})", r, g, b)
                } else {
                    "rgb(128, 128, 128)".to_string()
                }
            };

            // Inline helper: per-axis rotated title in the page margin.
            //
            // Key insight: #rotate does NOT update the layout bounding box.
            // #place(top+left, dx:DX, dy:DY) positions the PRE-ROTATION bounding box,
            // and then the content is visually rotated around the centre of that box.
            // Therefore the VISUAL centre after rotation = pre-rotation centre = (DX+W/2, DY+H/2).
            //
            // We use: #place(top+left, dx:DX, dy:DY)[#rotate(angle)[#box(width:300pt, height:10pt)[text]]]
            // for BOTH sides (no #place(right) to avoid sign confusion).
            //
            // TITLE_SPAN = 300pt (pre-rotation width  = visual height along the axis)
            // FONT_H     =  10pt (pre-rotation height = visual width, ~9pt text)
            //
            // LEFT axis (rotate -90deg, text reads bottom→top):
            //   tick_end_pt = (axis_px_side − 6) × scale_x       (from block LEFT; negative = in margin)
            //   Numbers left edge from block left = tick_end_pt − 30pt
            //   Title visual centre x             = tick_end_pt − 30 − 4 − 5 = tick_end_pt − 39
            //   DX + TITLE_SPAN/2 = tick_end_pt − 39  →  DX = tick_end_pt − 39 − 150 = tick_end_pt − 189
            //
            // RIGHT axis (rotate +90deg, text reads top→bottom):
            //   tick_end_pt measured from SVG RIGHT edge, same formula.
            //   Numbers right edge from block RIGHT = 30 − tick_end_pt  (positive = rightward into margin)
            //   Numbers right edge from block LEFT  = text_width_pt + (30 − tick_end_pt)
            //   Title visual centre x from block left = text_width_pt + 30 − tick_end_pt + 4 + 5
            //                                         = text_width_pt + 39 − tick_end_pt
            //   DX + TITLE_SPAN/2 = text_width_pt + 39 − tick_end_pt
            //   DX = text_width_pt + 39 − tick_end_pt − 150 = text_width_pt − 111 − tick_end_pt
            //
            // Vertical centre: DY + FONT_H/2 = img_height/2  →  DY = img_height/2 − 5
            const TITLE_SPAN_PT: f64 = 300.0; // visual height along the axis (= pre-rotation width)
            const FONT_H_PT:     f64 = 10.0;  // visual title width           (= pre-rotation height)
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
                // Tick outer end distance from the relevant SVG edge, in pt
                let tick_end_pt = (axis_px_side - 6.0).max(0.0) * scale_x;
                match side {
                    "left" => {
                        // Visual centre x = tick_end_pt - 24  (negative → in left margin)
                        // 24 = 22pt tick block + 2pt gap
                        let dx_pt = tick_end_pt - 24.0 - TITLE_SPAN_PT / 2.0;
                        format!(
                            "#place(top + left, dy: {dy:.1}pt, dx: {dx:.1}pt)[#rotate(-90deg)[#box(width: {span}pt, height: {fh}pt)[#align(center)[#text(size: 9pt, weight: \"bold\", fill: {color})[{label}]]]]]#linebreak()\n",
                            dy = title_dy_pt, dx = dx_pt,
                            span = TITLE_SPAN_PT, fh = FONT_H_PT,
                            color = color, label = label
                        )
                    },
                    "right" => {
                        // Visual centre x = text_width + 24 - tick_end_pt
                        // 24 = 22pt tick block + 2pt gap
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

            // Generate ticks overlay
            let mut ticks_overlay = String::new();
            if let Some(r) = chart_ranges {
                if is_individual_mode {
                    // Individual mode: one tick column + one title per metric axis.
                    // axis_px_side = distance of the axis line from its SVG edge:
                    //   left  axis at side_idx k: TICK_MARGIN + (n_left_extra  - k) * 40 px from SVG left
                    //   right axis at side_idx k: TICK_MARGIN + (n_right_extra - k) * 40 px from SVG right
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
                            "viscosity"                    => format!("{} (cP)",  l_visc),
                            "temperature"                  => format!("{} (°C)",  l_temp),
                            "shear_rate" | "shearRate"     => format!("{} (1/s)", l_shear),
                            "bath_temperature" | "bathTemperature" => format!("{} (°C)", l_bath_temp),
                            "pressure"                     => format!("{} (bar)", l_press),
                            other                          => other.to_string(),
                        };
                        ticks_overlay.push_str(&make_axis_title(&title, &axis.side, axis_px, &color));
                    }
                    ticks_overlay.push_str(&make_ticks(r.x_min, r.x_max, r.x_step, "bottom", TICK_MARGIN_PX, ""));
                    ticks_overlay.push_str(&make_x_minor_ticks(r.x_min, r.x_max, r.x_step, r.x_minor_step));
                } else {
                    // Shared mode: one axis per side.  The innermost axis column sits at
                    // TICK_MARGIN_PX + n_extra * AXIS_SPACING_PX from the SVG edge —
                    // identical to the individual mode formula.  Using TICK_MARGIN_PX
                    // alone would place labels/titles against the *SVG edge* instead of
                    // the chart body edge when there are multiple axis columns active,
                    // making the layout differ from individual mode.
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

            // Build touch point info text
            let touch_info = if !config.touch_points.is_empty() {
                let mut parts = Vec::new();
                for tp in &config.touch_points {
                    parts.push(escape_typst(&tp.label));
                }
                parts.join(" | ")
            } else {
                String::new()
            };
            let _ = touch_info; // used in chart legend only (kept for future use)

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
        } else {
            // No config - just show the chart
            r##"
    #page(paper: "a4", flipped: true)[
        #align(center + horizon)[
            #image("chart.svg", width: 90%)
        ]
    ]
    "##.to_string()
        }
    } else {
        String::new()
    };

    let ramp_block = if let Some(ramp) = build_ramp_string(&input.cycles) {
        let ramp_label = if is_ru { "Скорость сдвига" } else { "Shear Rate" };
        format!(r##"
            #text(size: 8pt, weight: "bold", fill: rgb("#0F172A"))[{}: {} (1/s)]
            #v(5pt)
        "##, ramp_label, ramp)
    } else {
        String::new()
    };

    // 6. Raw Data Page
    let raw_data_page = if input.settings.show_raw_data && !input.raw_data.is_empty() {
        let t_raw = if is_ru { "Сырые данные измерений" } else { "Raw Measurement Data" };
        let h_rd_no = "\\#";
        let h_rd_time = if is_ru { "Время (сек)" } else { "Time (sec)" };
        let h_rd_visc = if is_ru { "Вязкость (сП)" } else { "Viscosity (cP)" };
        let h_rd_temp = if is_ru { "Температура (°C)" } else { "Temperature (°C)" };
        let h_rd_shear = if is_ru { "Скорость\\ сдвига (1/с)" } else { "Shear Rate\\ (1/s)" };
        let h_rd_stress = if is_ru { "Напряжение\\ сдвига (Па)" } else { "Shear Stress\\ (Pa)" };
        let h_rd_rpm = if is_ru { "Обороты\\ (об/мин)" } else { "Speed\\ (RPM)" };
        let h_rd_press = if is_ru { "Давление (бар)" } else { "Pressure (bar)" };

        // Cap raw data rows to prevent Typst from spending minutes compiling
        // thousands of table rows.  2000 rows ≈ 15 pages — more than enough.
        const MAX_RAW_ROWS: usize = 2000;
        let total_count = input.raw_data.len();
        let display_data = if total_count > MAX_RAW_ROWS {
            &input.raw_data[..MAX_RAW_ROWS]
        } else {
            &input.raw_data[..]
        };
        let truncated = total_count > MAX_RAW_ROWS;

        // Detect whether any row carries bath temperature
        let has_bath_col = display_data.iter().any(|dp| dp.bath_temperature_c.is_some());
        let h_rd_bath = if is_ru { "Темп. бани (°C)" } else { "Bath Temp (°C)" };

        // Build raw data rows — write directly into a pre-allocated buffer.
        // Avoids 6 temporary String allocations per row (1 outer format + 5 optional fields).
        use std::fmt::Write as FmtWrite;

        // ~90 bytes per row (+ ~10 if bath col); pre-allocating prevents repeated reallocations.
        let row_size = if has_bath_col { 100 } else { 90 };
        let mut raw_rows = String::with_capacity(display_data.len() * row_size);

        // Inline macro: write an Option<f64> as "{:.1}" or "-" with no heap allocation.
        macro_rules! write_opt {
            ($dst:expr, $val:expr) => {
                match $val {
                    Some(v) => { let _ = write!($dst, "{:.1}", v); }
                    None    => $dst.push('-'),
                }
            };
        }

        for (i, dp) in display_data.iter().enumerate() {
            let _ = write!(raw_rows, "[{}], [{:.1}], [{:.1}], [", i + 1, dp.time_sec, dp.viscosity_cp);
            write_opt!(raw_rows, dp.temperature_c);
            if has_bath_col {
                raw_rows.push_str("], [");
                write_opt!(raw_rows, dp.bath_temperature_c);
            }
            raw_rows.push_str("], [");
            write_opt!(raw_rows, dp.shear_rate);
            raw_rows.push_str("], [");
            write_opt!(raw_rows, dp.shear_stress_pa);
            raw_rows.push_str("], [");
            write_opt!(raw_rows, dp.speed_rpm);
            raw_rows.push_str("], [");
            write_opt!(raw_rows, dp.pressure_bar);
            raw_rows.push_str("],\n");
        }

        let truncation_note = if truncated {
            let note_text = if is_ru {
                format!("Показаны первые {} из {} точек. Полные данные доступны в Excel-отчёте.", MAX_RAW_ROWS, total_count)
            } else {
                format!("Showing first {} of {} points. Full data available in Excel report.", MAX_RAW_ROWS, total_count)
            };
            format!(r##"
    #v(8pt)
    #text(size: 7pt, fill: rgb("#94A3B8"), style: "italic")[{note}]"##, note = note_text)
        } else {
            String::new()
        };

        let table_columns = if has_bath_col {
            "(0.4fr, 0.7fr, 0.7fr, 0.7fr, 0.7fr, 0.7fr, 0.7fr, 0.65fr, 0.7fr)"
        } else {
            "(0.4fr, 0.8fr, 0.8fr, 0.8fr, 0.8fr, 0.8fr, 0.7fr, 0.8fr)"
        };
        let bath_header_cell = if has_bath_col {
            format!("header_cell[{}], ", h_rd_bath)
        } else {
            String::new()
        };

        format!(r##"
    #pagebreak()
    #section_header("{t_raw}")
    #v(5pt)
    #text(size: 7pt, fill: rgb("#64748B"))[{count} {count_label}]
    #v(5pt)

    #show table.cell.where(y: 0): it => header_cell(it.body)
    #set text(size: 6.5pt, weight: "regular", fill: rgb("#334155"))

    #table(
      columns: {table_columns},
      stroke: 0.5pt + rgb("#E2E8F0"),
      fill: none,
      align: center + horizon,

      table.header(
        header_cell[{h_rd_no}], header_cell[{h_rd_time}], header_cell[{h_rd_visc}],
        header_cell[{h_rd_temp}], {bath_header_cell}header_cell[{h_rd_shear}], header_cell[{h_rd_stress}],
        header_cell[{h_rd_rpm}], header_cell[{h_rd_press}]
      ),
      {raw_rows}
    )
    {truncation_note}
    "##,
            t_raw = t_raw,
            count = total_count,
            count_label = if is_ru { "точек" } else { "points" },
            table_columns = table_columns,
            h_rd_no = h_rd_no,
            h_rd_time = h_rd_time,
            h_rd_visc = h_rd_visc,
            h_rd_temp = h_rd_temp,
            bath_header_cell = bath_header_cell,
            h_rd_shear = h_rd_shear,
            h_rd_stress = h_rd_stress,
            h_rd_rpm = h_rd_rpm,
            h_rd_press = h_rd_press,
            raw_rows = raw_rows,
            truncation_note = truncation_note
        )
    } else {
        String::new()
    };

    let total_pages = if has_chart { 2 } else { 1 };

    format!(r##"
#set page(paper: "a4", margin: (x: 28pt, y: 30pt))
#set text(font: "Roboto", size: 7pt, fill: rgb("#334155"))

// --- Styles ---
#let section_header(title) = block(
  fill: rgb("#F1F5F9"), 
  width: 100%, 
  inset: 6pt, 
  radius: 2pt,
  text(weight: "bold", fill: rgb("#1E293B"), size: 9pt)[#title]
)

#let label(content) = text(fill: rgb("#64748B"), size: 8pt)[#content]
#let val(content) = text(fill: rgb("#0F172A"), size: 8pt, weight: "medium")[#content]

#let header_cell(content) = block(
  width: 100%,
  inset: (x: 4pt, y: 8pt),
  align(center + horizon)[
    #text(weight: "bold", size: 8pt, fill: rgb("#1E293B"))[#content]
  ]
)

// Smaller muted text for unit labels inside header cells
#let unit_text(u) = text(size: 6pt, weight: "regular", fill: rgb("#64748B"))[#u]

#let cell(content) = block(
  inset: 4pt,
  align(left + horizon)[
    #text(size: 7.5pt, weight: "regular", fill: rgb("#334155"))[#content]
  ]
)

// --- Global Layout & Definitions ---
#let report_header = {{
  v(15pt)
  grid(
    columns: (1fr, auto),
    align: (left, right),
    stack(dir: ltr, spacing: 10pt,
      {logo_block},
      align(horizon)[#text(size: 18pt, weight: "bold", fill: rgb("#0F172A"))[{company_name}]]
    ),
    align(right)[
      #text(size: 8pt, fill: rgb("#64748B"))[{report_title_right}]\
      #text(size: 8pt, fill: rgb("#64748B"))[ID: {test_id}]
    ]
  )
  v(8pt)
  line(length: 100%, stroke: 1pt + rgb("#CBD5E1"))
  v(7pt)
}}

#let report_footer = grid(
  columns: (1fr, 1fr, 1fr),
  align: (left, center, right),
  text(size: 7pt, fill: rgb("#94a3b8"))[{company_name}],
  text(size: 7pt, fill: rgb("#94a3b8"))[{f_generated} {date_str}],
  text(size: 7pt, fill: rgb("#94a3b8"))[{f_page} #counter(page).display() / {total_pages}]
)

#set page(
  paper: "a4",
  margin: (top: 3.5cm, bottom: 2cm, x: 1cm),
  header: report_header,
  footer: report_footer
)

// --- Page 1 Content ---
#v(-20pt)
#grid(
  columns: (1fr, 1.4fr),
  column-gutter: 24pt,
  row-gutter: 20pt,
  align: top + left,

  // -- Row 1 Left: Passport + Calibration --
  [
    #section_header("{t_passport}")
    #v(5pt)
    #grid(
      columns: (85pt, 1fr),
      row-gutter: 8pt,
      label[{l_file}], val[{p_file}],
      label[{l_date}], val[{date_str}],
      label[{l_oper}], val[{p_oper}],
      label[{l_lab}],  val[{p_lab}],
      label[{l_field}], val[{p_field}],
      label[{l_well}], val[{p_well}],
      label[{l_inst}], val[{p_inst}],
    )
    #v(20pt)
    {cal_block}
  ],

  // -- Row 1 Right: Recipe --
  [
    #section_header("{t_recipe}")
    #v(5pt)
    #table(
      columns: (2.2fr, 1.2fr, 1.6fr, 0.8fr, 0.8fr),
      stroke: 0.5pt + rgb("#E2E8F0"),
      fill: none,
      table.header(
        header_cell[{h_name}],
        header_cell[{h_lot}],
        header_cell[{h_type}],
        header_cell[{h_unit}],
        header_cell[{h_conc}]
      ),
     {recipe_rows}
    )
  ],

  // -- Row 2 Left: Water Analysis --
  [
    #section_header("{t_water}")
    #v(5pt)
    #text(size: 8pt, weight: "bold", fill: rgb("#0F172A"))[{l_source} {water_source}]
    #v(5pt)
    #table(
       columns: (1fr, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr),
       align: center + horizon,
       stroke: 0.5pt + rgb("#E2E8F0"),
       fill: (_, y) => if y == 1 {{ rgb("#F8FAFC") }} else {{ none }},
       {w_header}
       {w_units}
       {w_values}
    )
  ],

  // -- Row 2 Right: Touch Points --
  [
    {touch_points_block}
  ]
)

#v(25pt)

// --- Statistics ---
#section_header("{t_stats}")
#v(5pt)
{ramp_block}


#show table.cell.where(y: 0): it => header_cell(it.body)
#set text(size: 6.5pt, weight: "regular", fill: rgb("#334155"))

#table(
  columns: ({stats_columns}),
  stroke: 0.5pt + rgb("#E2E8F0"),
  fill: none,
  align: center + horizon,
  
  table.header(
    {stats_headers}
  ),
  {stats_rows}
)


{chart_page}

{raw_data_page}
"##,
    // Args
    company_name=escape_typst(company_name), report_title_right=report_title_right, test_id=escape_typst(test_id),
    logo_block=logo_block,
    total_pages = total_pages,
    
    t_passport=t_passport, t_water=t_water, t_recipe=t_recipe, t_stats=t_stats,
    l_file=l_file, p_file=escape_typst(p_file),
    l_date=l_date, date_str=date_str,
    l_oper=l_oper, p_oper=escape_typst(p_oper),
    l_lab=l_lab, p_lab=escape_typst(p_lab),
    l_field=l_field, p_field=escape_typst(p_field),
    l_well=l_well, p_well=escape_typst(p_well),
    l_inst=l_inst, p_inst=escape_typst(p_inst),
    l_source=l_source, water_source=escape_typst(water_source),
    
    cal_block=cal_block,

    w_header=w_header, w_units=w_units, w_values=w_values,
    
    h_name=h_name, h_lot=h_lot, h_type=h_type, h_unit=h_unit, h_conc=h_conc,
    recipe_rows=recipe_rows,
    touch_points_block=touch_points_block,
    
    stats_columns=stats_columns,
    stats_headers=stats_headers_str,
    stats_rows=stats_rows,
    
    f_generated=f_generated, f_page=f_page,
    chart_page=chart_page,
    raw_data_page=raw_data_page,
    ramp_block=ramp_block
    )
}

fn escape_typst(text: &str) -> String {
    text.replace("\\", "\\\\")        .replace("{", "\\{")
        .replace("}", "\\}")        .replace("[", "\\[")
        .replace("]", "\\]")
        .replace("#", "\\#")
        .replace("\"", "\\\"")
        .replace("*", "\\*")
        .replace("_", "\\_")
        .replace("`", "\\`")
        .replace("$", "\\$")
        .replace("<", "\\<")
        .replace(">", "\\>")
        .replace("@", "\\@")
}

/// Calculate touch points for chart visualization using smart algorithm.
///
/// Filters by dominant shear rate (ignoring ramp segments) and detects the
/// end of the initial viscosity ramp-up before searching for threshold crossing.
fn calculate_touch_points_for_chart(
    points: &[ChartPoint], 
    settings: &ReportSettings,
    is_ru: bool
) -> Vec<ChartTouchPoint> {
    use super::touch_point::{
        TouchPointInput, TouchPointType, SmartTouchPointOptions,
        calculate_smart_touch_points,
    };

    // Convert ChartPoint → TouchPointInput
    let inputs: Vec<TouchPointInput> = points
        .iter()
        .map(|p| TouchPointInput {
            time_min: p.time_min,
            viscosity_cp: p.viscosity_cp,
            shear_rate: p.shear_rate.unwrap_or(0.0),
        })
        .collect();

    let results = calculate_smart_touch_points(
        &inputs,
        &SmartTouchPointOptions {
            viscosity_threshold: settings.viscosity_threshold,
            show_target_time: settings.show_target_time,
            target_time: settings.target_time,
            ..Default::default()
        },
    );

    results
        .into_iter()
        .map(|r| match r.tp_type {
            TouchPointType::Threshold => {
                let label = if is_ru {
                    format!("Порог вязкости {} сП", settings.viscosity_threshold as i32)
                } else {
                    format!("Viscosity Threshold {} cP", settings.viscosity_threshold as i32)
                };
                ChartTouchPoint {
                    time: r.time,
                    viscosity: r.viscosity,
                    label,
                    color: RGBColor(16, 185, 129), // Green #10B981
                }
            }
            TouchPointType::Target => {
                let label = if is_ru {
                    format!("Вязкость на {:.0} мин", settings.target_time)
                } else {
                    format!("Viscosity at {:.0} min", settings.target_time)
                };
                ChartTouchPoint {
                    time: r.time,
                    viscosity: r.viscosity,
                    label,
                    color: RGBColor(245, 158, 11), // Amber #F59E0B
                }
            }
        })
        .collect()
}
