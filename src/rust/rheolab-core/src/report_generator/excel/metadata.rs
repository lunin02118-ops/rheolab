//! Header/metadata sections: Summary, Calibration, Recipe, Water Analysis.
//!
//! Each `write_*` function advances `*row` past the last line it writes so
//! subsequent sections can simply chain.

use rust_xlsxwriter::{Worksheet, XlsxError};
use super::super::formatters::format_date;
use super::super::types::ReportInput;
use super::styles::Styles;

pub(super) fn write_summary(
    sheet: &mut Worksheet,
    input: &ReportInput,
    styles: &Styles,
    is_ru: bool,
    row: &mut u32,
) -> Result<(), XlsxError> {
    let summary_title = if is_ru { "Сводка" } else { "Summary" };
    sheet.write_string_with_format(*row, 0, summary_title, &styles.section_title)?;
    *row += 1;

    let param_label = if is_ru { "Параметр" } else { "Parameter" };
    let value_label = if is_ru { "Значение" } else { "Value" };
    sheet.write_string_with_format(*row, 0, param_label, &styles.header)?;
    sheet.merge_range(*row, 1, *row, 2, value_label, &styles.header)?;
    *row += 1;

    let meta = &input.metadata;
    let date_formatted = format_date(&meta.test_date, &input.settings.language);
    let summary_data: Vec<(&str, String)> = if is_ru {
        vec![
            ("ID Теста",     meta.test_id.clone().unwrap_or_default()),
            ("Дата",         date_formatted),
            ("Оператор",     meta.operator_name.clone().unwrap_or_default()),
            ("Месторождение", meta.field_name.clone().unwrap_or_default()),
            ("Скважина",     meta.well_number.clone().unwrap_or_default()),
            ("Инструмент",   meta.instrument_type.clone().unwrap_or_default()),
            ("Геометрия",    meta.geometry.clone().unwrap_or_default()),
        ]
    } else {
        vec![
            ("Test ID",    meta.test_id.clone().unwrap_or_default()),
            ("Date",       date_formatted),
            ("Operator",   meta.operator_name.clone().unwrap_or_default()),
            ("Field",      meta.field_name.clone().unwrap_or_default()),
            ("Well",       meta.well_number.clone().unwrap_or_default()),
            ("Instrument", meta.instrument_type.clone().unwrap_or_default()),
            ("Geometry",   meta.geometry.clone().unwrap_or_default()),
        ]
    };

    for (key, val) in summary_data {
        sheet.write_string_with_format(*row, 0, key, &styles.cell)?;
        sheet.merge_range(*row, 1, *row, 2, &val, &styles.cell)?;
        *row += 1;
    }
    Ok(())
}

pub(super) fn write_calibration(
    sheet: &mut Worksheet,
    input: &ReportInput,
    styles: &Styles,
    is_ru: bool,
    row: &mut u32,
) -> Result<(), XlsxError> {
    if !input.settings.show_calibration { return Ok(()); }
    let Some(cal) = &input.metadata.calibration else { return Ok(()); };

    *row += 1;
    let cal_title = if is_ru { "Калибровка" } else { "Calibration" };
    sheet.write_string_with_format(*row, 0, cal_title, &styles.section_title)?;
    *row += 1;

    let cal_data: Vec<(&str, String)> = if is_ru {
        vec![
            ("Дата калибровки",  cal.calibration_date.clone().or_else(|| cal.last_cal_date.clone()).unwrap_or_default()),
            ("R²",               cal.r_squared.map(|v| format!("{:.6}", v)).unwrap_or_default()),
            ("Slope / Intercept", format!("{:.4} / {:.4}", cal.slope.unwrap_or(0.0), cal.intercept.unwrap_or(0.0))),
            ("Hyst / STDEV",     format!("{:.2} / {:.2}", cal.hysteresis.unwrap_or(0.0), cal.stdev.unwrap_or(0.0))),
            ("Статус",           cal.status.clone().unwrap_or_default()),
        ]
    } else {
        vec![
            ("Cal. Date",         cal.calibration_date.clone().or_else(|| cal.last_cal_date.clone()).unwrap_or_default()),
            ("R²",                cal.r_squared.map(|v| format!("{:.6}", v)).unwrap_or_default()),
            ("Slope / Intercept", format!("{:.4} / {:.4}", cal.slope.unwrap_or(0.0), cal.intercept.unwrap_or(0.0))),
            ("Hyst / STDEV",      format!("{:.2} / {:.2}", cal.hysteresis.unwrap_or(0.0), cal.stdev.unwrap_or(0.0))),
            ("Status",            cal.status.clone().unwrap_or_default()),
        ]
    };

    for (key, val) in cal_data {
        sheet.write_string_with_format(*row, 0, key, &styles.cell)?;
        sheet.merge_range(*row, 1, *row, 2, &val, &styles.cell)?;
        *row += 1;
    }
    Ok(())
}

pub(super) fn write_recipe(
    sheet: &mut Worksheet,
    input: &ReportInput,
    styles: &Styles,
    is_ru: bool,
    row: &mut u32,
) -> Result<(), XlsxError> {
    *row += 1; // blank row before recipe
    let recipe_title = if is_ru { "Рецептура" } else { "Recipe" };
    sheet.write_string_with_format(*row, 0, recipe_title, &styles.section_title)?;
    *row += 1;

    // Headers: Name (A-B merged), Batch (C), Type (D), Unit (E), Conc. (F)
    let name_header = if is_ru { "Наименование" } else { "Name" };
    sheet.merge_range(*row, 0, *row, 1, name_header, &styles.header)?;

    let other_headers = if is_ru { ["Лот", "Тип", "ЕИ", "Конц."] } else { ["Batch", "Type", "Unit", "Conc."] };
    for (i, header) in other_headers.iter().enumerate() {
        sheet.write_string_with_format(*row, (2 + i) as u16, *header, &styles.header)?;
    }
    *row += 1;

    for reagent in &input.recipe {
        sheet.merge_range(*row, 0, *row, 1, &reagent.name, &styles.cell)?;
        sheet.write_string_with_format(*row, 2, reagent.batch_number.as_deref().unwrap_or(""), &styles.cell)?;
        sheet.write_string_with_format(*row, 3, reagent.category.as_deref().unwrap_or(""), &styles.cell)?;
        sheet.write_string_with_format(*row, 4, &reagent.unit, &styles.cell)?;
        sheet.write_number_with_format(*row, 5, reagent.concentration, &styles.number)?;
        *row += 1;
    }

    *row += 1; // blank row after recipe
    Ok(())
}

pub(super) fn write_water_analysis(
    sheet: &mut Worksheet,
    input: &ReportInput,
    styles: &Styles,
    is_ru: bool,
    row: &mut u32,
) -> Result<(), XlsxError> {
    let Some(water) = &input.water_params else { return Ok(()); };

    let water_title = if is_ru { "Анализ воды" } else { "Water Analysis" };
    sheet.write_string_with_format(*row, 0, water_title, &styles.section_title)?;
    *row += 1;

    // Source
    if let Some(source) = &water.source {
        if !source.is_empty() {
            let source_label = if is_ru { "Источник воды:" } else { "Water Source:" };
            sheet.write_string_with_format(*row, 0, source_label, &styles.header)?;
            sheet.merge_range(*row, 1, *row, 3, source, &styles.cell)?;
            *row += 1;
        }
    }

    let water_headers = ["pH", "Fe", "Ca", "Mg", "Cl", "SO4", "HCO3"];
    for (i, header) in water_headers.iter().enumerate() {
        sheet.write_string_with_format(*row, i as u16, *header, &styles.header)?;
    }
    *row += 1;

    let units = if is_ru {
        ["ед.", "мг/л", "мг/л", "мг/л", "мг/л", "мг/л", "мг/л"]
    } else {
        ["units", "mg/L", "mg/L", "mg/L", "mg/L", "mg/L", "mg/L"]
    };
    for (i, unit) in units.iter().enumerate() {
        sheet.write_string_with_format(*row, i as u16, *unit, &styles.unit)?;
    }
    *row += 1;

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
        sheet.write_string_with_format(*row, i as u16, val, &styles.number)?;
    }
    *row += 2;
    Ok(())
}
