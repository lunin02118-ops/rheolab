//! Excel Report Generator
//! 
//! Generates Excel reports matching XlsxChartService.ts.
//! Uses rust_xlsxwriter for native Excel generation with charts.
//!
//! ЕДИНЫЙ ИСТОЧНИК: форматирование значений идентично pdf.rs
//! Используем константы из formatters::decimals и formatters::excel_formats

use rust_xlsxwriter::*;
use super::types::*;

use super::formatters::*;
use super::formatters::excel_formats;

/// Generate Excel report from JSON input
pub fn generate_excel_report(input_json: &str) -> Result<Vec<u8>, String> {
    let input: ReportInput = serde_json::from_str(input_json)
        .map_err(|e| format!("JSON parse error: {}", e))?;
    generate_excel_from_input(&input)
}

/// Generate an Excel report from a pre-parsed `ReportInput`.
pub fn generate_excel_from_input(input: &ReportInput) -> Result<Vec<u8>, String> {
    generate_excel_internal(input)
        .map_err(|e| format!("Excel generation error: {}", e))
}

fn generate_excel_internal(input: &ReportInput) -> Result<Vec<u8>, XlsxError> {
    let mut workbook = Workbook::new();
    let unit_system = &input.settings.unit_system;

    // Robust language check
    let lang = input.settings.language.trim().to_lowercase();
    let is_ru = lang == "ru" || lang.starts_with("ru");

    // ==================== Styles ====================
    // ЕДИНЫЙ ИСТОЧНИК: используем константы из excel_formats для соответствия PDF
    
    let header_format = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0xF1F5F9))
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter);

    let section_title_format = Format::new()
        .set_bold()
        .set_font_size(11)
        .set_font_color(Color::RGB(0x1E293B));

    let cell_format = Format::new()
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Left)
        .set_align(FormatAlign::VerticalCenter)
        .set_text_wrap();

    let unit_format = Format::new()
        .set_font_color(Color::RGB(0x64748B))
        .set_align(FormatAlign::Center)
        .set_border(FormatBorder::Thin);

    // Форматы для статистических данных - ЕДИНЫЙ ИСТОЧНИК с PDF
    let fmt_time = Format::new()
        .set_num_format(excel_formats::TIME)
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center);
    
    let fmt_temperature = Format::new()
        .set_num_format(excel_formats::TEMPERATURE)
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center);
    
    let fmt_pressure = Format::new()
        .set_num_format(excel_formats::PRESSURE)
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center);
    
    let fmt_n_prime = Format::new()
        .set_num_format(excel_formats::N_PRIME)
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center);
    
    let fmt_k_prime = Format::new()
        .set_num_format(excel_formats::K_PRIME)
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center);
    
    let fmt_r_squared = Format::new()
        .set_num_format(excel_formats::R_SQUARED)
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center);
    
    let fmt_viscosity_fixed = Format::new()
        .set_num_format(excel_formats::VISCOSITY_FIXED)
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center);
    
    let fmt_pv = Format::new()
        .set_num_format(excel_formats::PV)
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center);
    
    let fmt_yp = Format::new()
        .set_num_format(excel_formats::YP)
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center);
    
    let fmt_bingham_r2 = Format::new()
        .set_num_format(excel_formats::BINGHAM_R2)
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center);
    
    let _fmt_water = Format::new()
        .set_num_format(excel_formats::WATER_PARAMS)
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center);
    
    // Общий формат по умолчанию
    let number_format = Format::new()
        .set_num_format(excel_formats::DEFAULT)
        .set_border(FormatBorder::Thin)
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter);

    // ==================== Sheet: Report ====================
    let sheet = workbook.add_worksheet();
    sheet.set_name("Report")?;

    // Page setup
    sheet.set_paper_size(9); // A4
    sheet.set_portrait();

    // Column widths
    // User request: A=15, others=10.
    for col in 0..20 {
        sheet.set_column_width(col, 10)?;
    }
    sheet.set_column_width(0, 15)?;

    // Set row height for chart area (first 15 rows)
    for row in 0..15 {
        sheet.set_row_height(row, 30)?;
    }

    // ==================== Raw Data (Hidden columns U-AA) ====================
    let raw_data_start_col = 20; // U = column 20 (0-indexed)
    let raw_headers = if is_ru {
        ["Время (мин)", "Вязкость (сП)", "Температура (°C)", "Скорость сдвига (1/с)", "Напряжение сдвига (Па)", "Обороты (об/мин)", "Давление (бар)", "Темп. бани (°C)"]
    } else {
        ["Time (min)", "Viscosity (cP)", "Temperature (C)", "Shear Rate (1/s)", "Shear Stress (Pa)", "Speed (RPM)", "Pressure (bar)", "Bath Temp (°C)"]
    };

    // Write main headers (always 7 columns); bath temp header only if data has it
    let has_bath = input.raw_data.iter().any(|dp| dp.bath_temperature_c.is_some());
    let header_count = if has_bath { raw_headers.len() } else { raw_headers.len() - 1 };
    for i in 0..header_count {
        sheet.write_string_with_format(0, (raw_data_start_col + i) as u16, raw_headers[i], &header_format)?;
    }

    let mut max_time_minutes = 0.0f64;
    let mut max_visc = 0.0f64;

    for (idx, point) in input.raw_data.iter().enumerate() {
        let row = (idx + 1) as u32;
        let time_min = point.time_sec / 60.0;
        
        if time_min > max_time_minutes { max_time_minutes = time_min; }
        if point.viscosity_cp > max_visc { max_visc = point.viscosity_cp; }

        sheet.write_number_with_format(row, raw_data_start_col as u16, time_min, &number_format)?;
        sheet.write_number_with_format(row, (raw_data_start_col + 1) as u16, point.viscosity_cp, &number_format)?;
        
        if let Some(temp) = point.temperature_c {
            sheet.write_number_with_format(row, (raw_data_start_col + 2) as u16, temp, &number_format)?;
        }
        if let Some(sr) = point.shear_rate {
            sheet.write_number_with_format(row, (raw_data_start_col + 3) as u16, sr, &number_format)?;
        }
        if let Some(ss) = point.shear_stress_pa {
            sheet.write_number_with_format(row, (raw_data_start_col + 4) as u16, ss, &number_format)?;
        }
        if let Some(rpm) = point.speed_rpm {
            sheet.write_number_with_format(row, (raw_data_start_col + 5) as u16, rpm, &number_format)?;
        }
        if let Some(p) = point.pressure_bar {
            sheet.write_number_with_format(row, (raw_data_start_col + 6) as u16, p, &number_format)?;
        }
        // Bath temperature: column 27 (raw_data_start_col + 7), written only when present
        if has_bath {
            if let Some(bt) = point.bath_temperature_c {
                sheet.write_number_with_format(row, (raw_data_start_col + 7) as u16, bt, &number_format)?;
            }
        }
    }

    // Calculate touch points if enabled
    let touch_points = if input.settings.show_touch_points {
        calculate_touch_points(&input.raw_data, &input.settings, is_ru)
    } else {
        vec![]
    };

    // ==================== Chart ====================
    let data_len = input.raw_data.len() as u32;
    let last_row = std::cmp::max(2, data_len);
    




    // Chart title - base name only (touch points shown in the table)
    let title_text = if is_ru { "Вязкость vs Время".to_string() } else { "Viscosity vs Time".to_string() };

    let mut chart = Chart::new(ChartType::ScatterSmooth);
    chart.title()
        .set_name(&title_text)
        .set_font(ChartFont::new().set_name("Arial").set_size(12));
    
    // Set chart size - width matches rheological data (statistics) table exactly.
    // Table columns: 9 fixed (Cycle,Time,T,P,n',K',Ks,Kp,R²) + viscosity cols + 3 Bingham (PV,YP,R²B if expert)
    // = 9 + viscosity_shear_rates.len() + bingham total columns.
    //
    // Excel pixel formula: pixels = floor(col_width_chars * 7) + 5
    //   Col A (width=15) → 15*7+5 = 110 px
    //   Other cols (width=10) → 10*7+5 = 75 px
    let bingham_cols = if input.settings.show_advanced_stats { 3 } else { 0 };
    let stats_col_count = 9 + input.settings.viscosity_shear_rates.len() + bingham_cols;
    let chart_width = (110 + (stats_col_count - 1) * 75) as u32;
    chart.set_width(chart_width);
    chart.set_height(600);

    // Common gridline style
    let mut grid_line = ChartLine::new();
    grid_line.set_color(Color::Black).set_transparency(80).set_width(0.5);

    // Helper function to parse hex color to RGB
    fn parse_hex_to_rgb(hex: &str) -> u32 {
        let hex = hex.trim_start_matches('#');
        u32::from_str_radix(hex, 16).unwrap_or(0x3B82F6)
    }
    
    // Helper function to convert style string to ChartLineDashType
    fn style_to_dash_type(style: &str) -> ChartLineDashType {
        match style {
            "dashed" => ChartLineDashType::Dash,
            "dotted" => ChartLineDashType::RoundDot,
            _ => ChartLineDashType::Solid,
        }
    }

    // Get line settings from input or use defaults
    let line_settings = input.settings.line_settings.as_ref();
    
    // Series 1: Viscosity - use user settings or defaults
    let visc_name = if is_ru { "Вязкость" } else { "Viscosity" };
    let mut visc_line = ChartLine::new();
    if let Some(ls) = line_settings {
        visc_line
            .set_color(Color::RGB(parse_hex_to_rgb(&ls.viscosity.color)))
            .set_width(ls.viscosity.width as f64)
            .set_dash_type(style_to_dash_type(&ls.viscosity.style));
    } else {
        visc_line.set_color(Color::RGB(0x3B82F6)).set_width(2.0);
    }
    
    chart.add_series()
        .set_name(visc_name)
        .set_categories(("Report", 1, raw_data_start_col as u16, last_row, raw_data_start_col as u16))
        .set_values(("Report", 1, (raw_data_start_col + 1) as u16, last_row, (raw_data_start_col + 1) as u16))
        .set_format(ChartFormat::new().set_line(&visc_line))
        .set_marker(ChartMarker::new().set_none());

    // Series 2: Temperature - use user settings or defaults
    if input.settings.show_temperature {
        let temp_name = if is_ru { "Температура" } else { "Temperature" };
        let mut temp_line = ChartLine::new();
        if let Some(ls) = line_settings {
            temp_line
                .set_color(Color::RGB(parse_hex_to_rgb(&ls.temperature.color)))
                .set_width(ls.temperature.width as f64)
                .set_dash_type(style_to_dash_type(&ls.temperature.style));
        } else {
            temp_line.set_color(Color::RGB(0xEF4444)).set_width(1.5).set_dash_type(ChartLineDashType::Dash);
        }

        chart.add_series()
            .set_name(temp_name)
            .set_categories(("Report", 1, raw_data_start_col as u16, last_row, raw_data_start_col as u16))
            .set_values(("Report", 1, (raw_data_start_col + 2) as u16, last_row, (raw_data_start_col + 2) as u16))
            .set_secondary_axis(true)
            .set_format(ChartFormat::new().set_line(&temp_line))
            .set_marker(ChartMarker::new().set_none());
    }

    // Series 3: Shear Rate - use user settings or defaults
    if input.settings.show_shear_rate {
        // Always respect the user's per-series axis setting.
        // Excel has only 2 Y-axes (primary=left, secondary=right) so in both
        // individual and shared modes we map directly from shear_rate_axis.
        let is_right = input.settings.shear_rate_axis.trim().to_lowercase() != "left";
        let sr_name = if is_ru { 
            "Скорость сдвига".to_string()
        } else { 
            "Shear Rate".to_string()
        };
        let mut sr_line = ChartLine::new();
        if let Some(ls) = line_settings {
            sr_line
                .set_color(Color::RGB(parse_hex_to_rgb(&ls.shear_rate.color)))
                .set_width(ls.shear_rate.width as f64)
                .set_dash_type(style_to_dash_type(&ls.shear_rate.style));
        } else {
            sr_line.set_color(Color::RGB(0xA855F7)).set_width(0.75).set_transparency(50);
        }

        let series = chart.add_series();
        series
            .set_name(&sr_name)
            .set_categories(("Report", 1, raw_data_start_col as u16, last_row, raw_data_start_col as u16))
            .set_values(("Report", 1, (raw_data_start_col + 3) as u16, last_row, (raw_data_start_col + 3) as u16))
            .set_format(ChartFormat::new().set_line(&sr_line))
            .set_marker(ChartMarker::new().set_none());
        
        if is_right {
            series.set_secondary_axis(true);
        } else {
            series.set_secondary_axis(false);
        }
    }

    // Series 4: Pressure - use user settings or defaults
    if input.settings.show_pressure {
        // Always respect the user's per-series axis setting.
        let is_right = input.settings.pressure_axis.trim().to_lowercase() != "left";
        let pr_name = if is_ru { 
            "Давление".to_string()
        } else { 
            "Pressure".to_string()
        };
        let mut pressure_line = ChartLine::new();
        if let Some(ls) = line_settings {
            pressure_line
                .set_color(Color::RGB(parse_hex_to_rgb(&ls.pressure.color)))
                .set_width(ls.pressure.width as f64)
                .set_dash_type(style_to_dash_type(&ls.pressure.style));
        } else {
            pressure_line.set_color(Color::RGB(0x22C55E)).set_width(1.5).set_dash_type(ChartLineDashType::RoundDot);
        }

        let series = chart.add_series();
        series
            .set_name(&pr_name)
            .set_categories(("Report", 1, raw_data_start_col as u16, last_row, raw_data_start_col as u16))
            .set_values(("Report", 1, (raw_data_start_col + 6) as u16, last_row, (raw_data_start_col + 6) as u16))
            .set_format(ChartFormat::new().set_line(&pressure_line))
            .set_marker(ChartMarker::new().set_none());
        
        if is_right {
            series.set_secondary_axis(true);
        } else {
            series.set_secondary_axis(false);
        }
    }

    // Series: Bath Temperature (only when data contains bath temp values)
    if has_bath {
        let bath_name = if is_ru { "Темп. бани" } else { "Bath Temp" };
        let mut bath_line = ChartLine::new();
        if let Some(ls) = line_settings {
            // Reuse temperature line style with slight transparency to distinguish
            bath_line
                .set_color(Color::RGB(parse_hex_to_rgb(&ls.temperature.color)))
                .set_width(ls.temperature.width as f64)
                .set_dash_type(ChartLineDashType::Dash);
        } else {
            bath_line.set_color(Color::RGB(0xF97316)).set_width(1.5).set_dash_type(ChartLineDashType::Dash);
        }
        chart.add_series()
            .set_name(bath_name)
            .set_categories(("Report", 1, raw_data_start_col as u16, last_row, raw_data_start_col as u16))
            .set_values(("Report", 1, (raw_data_start_col + 7) as u16, last_row, (raw_data_start_col + 7) as u16))
            .set_secondary_axis(true)
            .set_format(ChartFormat::new().set_line(&bath_line))
            .set_marker(ChartMarker::new().set_none());
    }

    // (Touch point vertical line series removed — replaced by table in data sheet)

    // X-Axis
    let x_axis_name = if is_ru { "Время (мин)" } else { "Time (min)" };
    chart.x_axis()
        .set_name(x_axis_name)
        .set_num_format("0")
        .set_min(0.0)
        .set_max(max_time_minutes)
        .set_major_gridlines(true)
        .set_major_gridlines_line(&grid_line);

    // Y-Axis (Left) - Dynamic Name based on which metrics are placed on left
    let mut left_axis_parts = Vec::new();
    left_axis_parts.push(if is_ru { "Вязкость (сП)" } else { "Viscosity (cP)" });

    // Shear Rate on left when shear_rate_axis == "left" (both individual and shared modes)
    if input.settings.show_shear_rate && input.settings.shear_rate_axis.trim().to_lowercase() == "left" {
        left_axis_parts.push(if is_ru { "Скорость сдвига (1/с)" } else { "Shear Rate (1/s)" });
    }

    // Pressure on left when pressure_axis == "left" (both individual and shared modes)
    if input.settings.show_pressure && input.settings.pressure_axis.trim().to_lowercase() == "left" {
        left_axis_parts.push(if is_ru { "Давление (бар)" } else { "Pressure (bar)" });
    }

    let y_axis_name = left_axis_parts.join(" / ");
    chart.y_axis()
        .set_name(&y_axis_name)
        .set_num_format("0")
        .set_major_gridlines(true)
        .set_major_gridlines_line(&grid_line);

    // Y-Axis (Right) - Dynamic Name based on which metrics are placed on right
    let mut right_axis_parts = Vec::new();
    
    // Temperature is always on right
    if input.settings.show_temperature {
        right_axis_parts.push(if is_ru { "Температура (°C)" } else { "Temperature (C)" });
    }

    // Shear Rate on right when shear_rate_axis != "left" (both individual and shared modes)
    if input.settings.show_shear_rate && input.settings.shear_rate_axis.trim().to_lowercase() != "left" {
        right_axis_parts.push(if is_ru { "Скорость сдвига (1/с)" } else { "Shear Rate (1/s)" });
    }

    // Pressure on right when pressure_axis != "left" (both individual and shared modes)
    if input.settings.show_pressure && input.settings.pressure_axis.trim().to_lowercase() != "left" {
        right_axis_parts.push(if is_ru { "Давление (бар)" } else { "Pressure (bar)" });
    }

    // Bath temperature always on right when present
    if has_bath {
        right_axis_parts.push(if is_ru { "Темп. бани (°C)" } else { "Bath Temp (C)" });
    }

    if !right_axis_parts.is_empty() {
        let y2_axis_name = right_axis_parts.join(" / ");
        chart.y2_axis()
            .set_name(&y2_axis_name)
            .set_num_format("0");
    }

    // Move legend to bottom of chart
    chart.legend().set_position(ChartLegendPosition::Bottom);

    sheet.insert_chart(0, 0, &chart)?;

    // ==================== Report Content (right after chart) ====================
    let mut current_row = 16u32;

    // --- Summary Section ---
    let summary_title = if is_ru { "Сводка" } else { "Summary" };
    sheet.write_string_with_format(current_row, 0, summary_title, &section_title_format)?;
    current_row += 1;

    let param_label = if is_ru { "Параметр" } else { "Parameter" };
    let value_label = if is_ru { "Значение" } else { "Value" };
    sheet.write_string_with_format(current_row, 0, param_label, &header_format)?;
    sheet.merge_range(current_row, 1, current_row, 2, value_label, &header_format)?;
    current_row += 1;

    let meta = &input.metadata;
    let date_formatted = format_date(&meta.test_date, &input.settings.language);
    let summary_data = if is_ru {
        vec![
            ("ID Теста", meta.test_id.clone().unwrap_or_default()),
            ("Дата", date_formatted),
            ("Оператор", meta.operator_name.clone().unwrap_or_default()),
            ("Месторождение", meta.field_name.clone().unwrap_or_default()),
            ("Скважина", meta.well_number.clone().unwrap_or_default()),
            ("Инструмент", meta.instrument_type.clone().unwrap_or_default()),
            ("Геометрия", meta.geometry.clone().unwrap_or_default()),
        ]
    } else {
        vec![
            ("Test ID", meta.test_id.clone().unwrap_or_default()),
            ("Date", date_formatted),
            ("Operator", meta.operator_name.clone().unwrap_or_default()),
            ("Field", meta.field_name.clone().unwrap_or_default()),
            ("Well", meta.well_number.clone().unwrap_or_default()),
            ("Instrument", meta.instrument_type.clone().unwrap_or_default()),
            ("Geometry", meta.geometry.clone().unwrap_or_default()),
        ]
    };

    for (key, val) in summary_data {
        sheet.write_string_with_format(current_row, 0, key, &cell_format)?;
        sheet.merge_range(current_row, 1, current_row, 2, &val, &cell_format)?;
        current_row += 1;
    }
    
    // --- Calibration Section (if enabled and data available) ---
    if input.settings.show_calibration {
        if let Some(cal) = &input.metadata.calibration {
            current_row += 1;
            let cal_title = if is_ru { "Калибровка" } else { "Calibration" };
            sheet.write_string_with_format(current_row, 0, cal_title, &section_title_format)?;
            current_row += 1;

            let cal_data: Vec<(&str, String)> = if is_ru {
                vec![
                    ("Дата калибровки", cal.calibration_date.clone().or_else(|| cal.last_cal_date.clone()).unwrap_or_default()),
                    ("R²", cal.r_squared.map(|v| format!("{:.6}", v)).unwrap_or_default()),
                    ("Slope / Intercept", format!("{:.4} / {:.4}", cal.slope.unwrap_or(0.0), cal.intercept.unwrap_or(0.0))),
                    ("Hyst / STDEV", format!("{:.2} / {:.2}", cal.hysteresis.unwrap_or(0.0), cal.stdev.unwrap_or(0.0))),
                    ("Статус", cal.status.clone().unwrap_or_default()),
                ]
            } else {
                vec![
                    ("Cal. Date", cal.calibration_date.clone().or_else(|| cal.last_cal_date.clone()).unwrap_or_default()),
                    ("R²", cal.r_squared.map(|v| format!("{:.6}", v)).unwrap_or_default()),
                    ("Slope / Intercept", format!("{:.4} / {:.4}", cal.slope.unwrap_or(0.0), cal.intercept.unwrap_or(0.0))),
                    ("Hyst / STDEV", format!("{:.2} / {:.2}", cal.hysteresis.unwrap_or(0.0), cal.stdev.unwrap_or(0.0))),
                    ("Status", cal.status.clone().unwrap_or_default()),
                ]
            };

            for (key, val) in cal_data {
                sheet.write_string_with_format(current_row, 0, key, &cell_format)?;
                sheet.merge_range(current_row, 1, current_row, 2, &val, &cell_format)?;
                current_row += 1;
            }
        }
    }
    
    // --- Recipe Section (below Summary, columns A-F) ---
    current_row += 1; // blank row between summary and recipe
    let recipe_title = if is_ru { "Рецептура" } else { "Recipe" };
    sheet.write_string_with_format(current_row, 0, recipe_title, &section_title_format)?;
    current_row += 1;

    // Headers: Name (A-B merged), Batch (C), Type (D), Unit (E), Conc. (F)
    let name_header = if is_ru { "Наименование" } else { "Name" };
    sheet.merge_range(current_row, 0, current_row, 1, name_header, &header_format)?;

    let other_headers = if is_ru {
        ["Лот", "Тип", "ЕИ", "Конц."]
    } else {
        ["Batch", "Type", "Unit", "Conc."]
    };
    for (i, header) in other_headers.iter().enumerate() {
        sheet.write_string_with_format(current_row, (2 + i) as u16, *header, &header_format)?;
    }
    current_row += 1;

    for reagent in &input.recipe {
        sheet.merge_range(current_row, 0, current_row, 1, &reagent.name, &cell_format)?;
        sheet.write_string_with_format(current_row, 2, reagent.batch_number.as_deref().unwrap_or(""), &cell_format)?;
        sheet.write_string_with_format(current_row, 3, reagent.category.as_deref().unwrap_or(""), &cell_format)?;
        sheet.write_string_with_format(current_row, 4, &reagent.unit, &cell_format)?;
        sheet.write_number_with_format(current_row, 5, reagent.concentration, &number_format)?;
        current_row += 1;
    }

    current_row += 1; // blank row after recipe

    // --- Water Analysis Section ---
    if let Some(water) = &input.water_params {
        let water_title = if is_ru { "Анализ воды" } else { "Water Analysis" };
        sheet.write_string_with_format(current_row, 0, water_title, &section_title_format)?;
        current_row += 1;

        // Source
        if let Some(source) = &water.source {
            if !source.is_empty() {
                let source_label = if is_ru { "Источник воды:" } else { "Water Source:" };
                sheet.write_string_with_format(current_row, 0, source_label, &header_format)?;
                sheet.merge_range(current_row, 1, current_row, 3, source, &cell_format)?;
                current_row += 1;
            }
        }

        let water_headers = ["pH", "Fe", "Ca", "Mg", "Cl", "SO4", "HCO3"];

        for (i, header) in water_headers.iter().enumerate() {
            sheet.write_string_with_format(current_row, i as u16, *header, &header_format)?;
        }
        current_row += 1;

        // Units
        let units = if is_ru {
            ["ед.", "мг/л", "мг/л", "мг/л", "мг/л", "мг/л", "мг/л"]
        } else {
            ["units", "mg/L", "mg/L", "mg/L", "mg/L", "mg/L", "mg/L"]
        };
        for (i, unit) in units.iter().enumerate() {
            sheet.write_string_with_format(current_row, i as u16, *unit, &unit_format)?;
        }
        current_row += 1;

        let water_values = [
            water.ph.map(|v| format!("{:.1}", v)).unwrap_or("-".to_string()),
            water.fe.map(|v| format!("{:.1}", v)).unwrap_or("-".to_string()),
            water.ca.map(|v| format!("{:.1}", v)).unwrap_or("-".to_string()),
            water.mg.map(|v| format!("{:.1}", v)).unwrap_or("-".to_string()),
            water.cl.map(|v| format!("{:.1}", v)).unwrap_or("-".to_string()),
            water.so4.map(|v| format!("{:.1}", v)).unwrap_or("-".to_string()),
            water.hco3.map(|v| format!("{:.1}", v)).unwrap_or("-".to_string()),
        ];

        for (i, val) in water_values.iter().enumerate() {
            sheet.write_string_with_format(current_row, i as u16, val, &number_format)?;
        }
        current_row += 2;
    }

    // --- Touch Points Table (below water analysis, columns A-C) ---
    if input.settings.show_touch_points && !touch_points.is_empty() {
        let tp_title = if is_ru { "Контрольные точки" } else { "Control Points" };
        sheet.write_string_with_format(current_row, 0, tp_title, &section_title_format)?;
        current_row += 1;

        let tp_type = if is_ru { "Тип" } else { "Type" };
        let tp_time = if is_ru { "Время (мин)" } else { "Time (min)" };
        let tp_visc = if is_ru { "Вязкость (сП)" } else { "Viscosity (cP)" };
        sheet.write_string_with_format(current_row, 0, tp_type, &header_format)?;
        sheet.write_string_with_format(current_row, 1, tp_time, &header_format)?;
        sheet.write_string_with_format(current_row, 2, tp_visc, &header_format)?;
        current_row += 1;

        for tp in &touch_points {
            sheet.write_string_with_format(current_row, 0, &tp.label, &cell_format)?;
            sheet.write_number_with_format(current_row, 1, tp.time, &number_format)?;
            sheet.write_number_with_format(current_row, 2, tp.viscosity, &number_format)?;
            current_row += 1;
        }
        current_row += 1;
    }

    // --- Program (Schedule) Section ---
    // REMOVED per user request
    /*
    if !input.cycles.is_empty() {
        // ... code removed ...
    }
    */

    // --- Statistics Section ---
    let stats_title = if is_ru { "Реология" } else { "Rheology" };
    sheet.write_string_with_format(current_row, 0, stats_title, &section_title_format)?;
    current_row += 1;

    // Ramp info
    if let Some(ramp) = build_ramp_string(&input.cycles) {
        let ramp_label = if is_ru { "Скорость сдвига" } else { "Shear Rate" };
        let ramp_text = format!("{}: {} (1/s)", ramp_label, ramp);
        sheet.write_string(current_row, 0, &ramp_text)?;
        current_row += 1;
    }

    // Stats headers
    let k_unit = get_k_unit(unit_system);
    let pv_unit = get_pv_unit(unit_system);
    let yp_unit = get_yp_unit(unit_system);
    let visc_rates = &input.settings.viscosity_shear_rates;
    
    // Pre-format headers to avoid temporary borrow issues
    let k_header = format!("K' ({})", k_unit);
    let pv_header = format!("PV ({})", pv_unit);
    let yp_header = format!("YP ({})", yp_unit);

    let cycle_label = if is_ru { "Цикл" } else { "Cycle" };
    let time_label = if is_ru { "Время (мин)" } else { "Time (min)" };
    
    // Build dynamic headers: base cols + Ks + Kp + dynamic viscosity cols + Bingham cols
    let mut stats_headers: Vec<String> = vec![
        cycle_label.to_string(), time_label.to_string(), "T (°C)".to_string(), "P (bar)".to_string(),
        "n'".to_string(), k_header.clone(),
        format!("Ks ({})", k_unit),
        format!("Kp ({})", k_unit),
        "R²".to_string(),
    ];
    for rate in visc_rates {
        stats_headers.push(format!("η@{}", rate));
    }
    if input.settings.show_advanced_stats {
        stats_headers.push(pv_header.clone());
        stats_headers.push(yp_header.clone());
        stats_headers.push("R²B".to_string());
    }

    let _total_stats_cols = stats_headers.len();
    
    for (i, header) in stats_headers.iter().enumerate() {
        sheet.write_string_with_format(current_row, i as u16, header, &header_format)?;
    }
    current_row += 1;

    // Stats data - ЕДИНЫЙ ИСТОЧНИК форматирования с PDF
    for cycle in &input.cycle_results {
        let k_val = convert_consistency_index(cycle.k_prime, unit_system);
        let pv_val = convert_pv(cycle.bingham_pv.unwrap_or(0.0), unit_system);
        let yp_val = convert_yp(cycle.bingham_yp.unwrap_or(0.0), unit_system);

        let mut col: u16 = 0;
        // Base columns: Cycle, Time, Temp, Pressure, n', K', Ks, Kp, R²
        sheet.write_number_with_format(current_row, col, cycle.cycle_no as f64, &cell_format)?; col += 1;
        sheet.write_number_with_format(current_row, col, cycle.time_min, &fmt_time)?; col += 1;
        sheet.write_number_with_format(current_row, col, cycle.temp_c, &fmt_temperature)?; col += 1;
        sheet.write_number_with_format(current_row, col, cycle.pressure_bar.unwrap_or(0.0), &fmt_pressure)?; col += 1;
        sheet.write_number_with_format(current_row, col, cycle.n_prime, &fmt_n_prime)?; col += 1;
        sheet.write_number_with_format(current_row, col, k_val, &fmt_k_prime)?; col += 1;
        // Ks
        if let Some(ks) = cycle.k_slot {
            sheet.write_number_with_format(current_row, col, convert_consistency_index(ks, unit_system), &fmt_k_prime)?;
        } else {
            sheet.write_string(current_row, col, "—")?;
        }
        col += 1;
        // Kp
        if let Some(kp) = cycle.k_pipe {
            sheet.write_number_with_format(current_row, col, convert_consistency_index(kp, unit_system), &fmt_k_prime)?;
        } else {
            sheet.write_string(current_row, col, "—")?;
        }
        col += 1;
        sheet.write_number_with_format(current_row, col, cycle.r2, &fmt_r_squared)?; col += 1;
        
        // Dynamic viscosity columns from viscosities HashMap
        for rate in visc_rates {
            let key = format!("{}", rate);
            let visc_val = cycle.viscosities.get(&key).copied()
                .or_else(|| match *rate {
                    40 => cycle.visc_at_40,
                    100 => cycle.visc_at_100,
                    170 => cycle.visc_at_170,
                    _ => None,
                })
                .unwrap_or(0.0);
            sheet.write_number_with_format(current_row, col, visc_val, &fmt_viscosity_fixed)?; col += 1;
        }
        
        // PV, YP, R²B (only in expert mode)
        if input.settings.show_advanced_stats {
            sheet.write_number_with_format(current_row, col, pv_val, &fmt_pv)?; col += 1;
            sheet.write_number_with_format(current_row, col, yp_val, &fmt_yp)?; col += 1;
            sheet.write_number_with_format(current_row, col, cycle.bingham_r2.unwrap_or(0.0), &fmt_bingham_r2)?;
        }
        let _ = col;
        current_row += 1;
    }

    // Save to buffer
    
    // ==================== Debug Sheet (Hidden) ====================
    // Create debug sheet at the end to avoid borrow checker issues with 'sheet'
    let debug_sheet = workbook.add_worksheet();
    debug_sheet.set_name("DebugInfo")?;
    debug_sheet.set_hidden(true);
    
    debug_sheet.write_string(0, 0, "Setting")?;
    debug_sheet.write_string(0, 1, "Value")?;
    
    debug_sheet.write_string(1, 0, "Shear Rate Axis")?;
    debug_sheet.write_string(1, 1, &input.settings.shear_rate_axis)?;
    
    debug_sheet.write_string(2, 0, "Pressure Axis")?;
    debug_sheet.write_string(2, 1, &input.settings.pressure_axis)?;

    debug_sheet.write_string(3, 0, "Show Shear Rate")?;
    debug_sheet.write_boolean(3, 1, input.settings.show_shear_rate)?;

    debug_sheet.write_string(4, 0, "Show Pressure")?;
    debug_sheet.write_boolean(4, 1, input.settings.show_pressure)?;

    workbook.save_to_buffer()
}

/// Calculate touch points for chart using smart algorithm.
///
/// Filters by dominant shear rate (ignoring ramp segments) and detects the
/// end of the initial viscosity ramp-up before searching for threshold crossing.
fn calculate_touch_points(raw_data: &[DataPoint], settings: &ReportSettings, is_ru: bool) -> Vec<TouchPoint> {
    use super::touch_point::{
        TouchPointInput, TouchPointType, SmartTouchPointOptions,
        calculate_smart_touch_points,
    };

    // Convert DataPoint → TouchPointInput (time_sec → time_min)
    let inputs: Vec<TouchPointInput> = raw_data
        .iter()
        .map(|p| TouchPointInput {
            time_min: p.time_sec / 60.0,
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
            TouchPointType::Threshold => TouchPoint {
                label: if is_ru {
                    format!("Порог {} сП", settings.viscosity_threshold as i32)
                } else {
                    format!("Threshold {} cP", settings.viscosity_threshold as i32)
                },
                time: r.time,
                viscosity: r.viscosity,
                color: "FF10B981".to_string(),
            },
            TouchPointType::Target => TouchPoint {
                label: if is_ru {
                    format!("На {} мин", settings.target_time as i32)
                } else {
                    format!("At {} min", settings.target_time as i32)
                },
                time: r.time,
                viscosity: r.viscosity,
                color: "FFF59E0B".to_string(),
            },
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_simple_excel() {
        let input = ReportInput {
            raw_data: vec![
                DataPoint { time_sec: 0.0, viscosity_cp: 100.0, temperature_c: Some(25.0), shear_rate: Some(100.0), shear_stress_pa: None, speed_rpm: None, pressure_bar: None, bath_temperature_c: None },
                DataPoint { time_sec: 60.0, viscosity_cp: 150.0, temperature_c: Some(50.0), shear_rate: Some(75.0), shear_stress_pa: None, speed_rpm: None, pressure_bar: None, bath_temperature_c: None },
            ],
            metadata: ReportMetadata {
                filename: "test.xlsx".to_string(),
                test_id: Some("TEST-001".to_string()),
                ..Default::default()
            },
            cycle_results: vec![],
            recipe: vec![],
            water_params: None,
            cycles: vec![],
            settings: ReportSettings::default(),
            chart_image_base64: None,
            axis_values: None,
        };

        let result = generate_excel_internal(&input);
        assert!(result.is_ok());
        let bytes = result.unwrap();
        assert!(bytes.len() > 1000);
    }
}
