//! Raw-data columns (U..AB, hidden in the shipping report).
//!
//! The chart's `set_categories` / `set_values` reference ranges in these
//! columns, so the data block is written *before* the chart is built.
//!
//! Returns `(max_time_minutes, max_viscosity, has_bath)` so the caller can
//! configure chart axes without re-scanning the data.

use rust_xlsxwriter::{Worksheet, XlsxError};
use super::super::types::ReportInput;
use super::super::formatters::{convert_viscosity, get_viscosity_unit, viscosity_excel_format};
use super::styles::Styles;

/// First column for raw data. "U" in 1-based Excel = 20 (0-indexed).
pub(super) const RAW_DATA_START_COL: usize = 20;

pub(super) struct RawDataSummary {
    pub(super) max_time_minutes: f64,
    pub(super) has_bath:         bool,
}

pub(super) fn write_raw_data(
    sheet: &mut Worksheet,
    input: &ReportInput,
    styles: &Styles,
    is_ru: bool,
) -> Result<RawDataSummary, XlsxError> {
    let unit_system = &input.settings.unit_system;
    let visc_unit   = get_viscosity_unit(unit_system);
    let visc_fmt    = viscosity_excel_format(unit_system);
    let visc_header_ru = format!("Вязкость ({})", visc_unit);
    let visc_header_en = format!("Viscosity ({})", visc_unit);

    let raw_headers: [&str; 8] = if is_ru {
        ["Время (мин)", &visc_header_ru, "Температура (°C)", "Скорость сдвига (1/с)", "Напряжение сдвига (Па)", "Обороты (об/мин)", "Давление (бар)", "Темп. бани (°C)"]
    } else {
        ["Time (min)", &visc_header_en, "Temperature (C)", "Shear Rate (1/s)", "Shear Stress (Pa)", "Speed (RPM)", "Pressure (bar)", "Bath Temp (°C)"]
    };

    let has_bath = input.raw_data.iter().any(|dp| dp.bath_temperature_c.is_some());
    let header_count = if has_bath { raw_headers.len() } else { raw_headers.len() - 1 };
    for i in 0..header_count {
        sheet.write_string_with_format(0, (RAW_DATA_START_COL + i) as u16, raw_headers[i], &styles.header)?;
    }

    let visc_fmt_ref: &rust_xlsxwriter::Format = if visc_fmt == "0.0000" {
        &styles.fmt_viscosity_pas
    } else {
        &styles.fmt_viscosity_fixed
    };

    let mut max_time_minutes = 0.0f64;

    for (idx, point) in input.raw_data.iter().enumerate() {
        let row = (idx + 1) as u32;
        let time_min = point.time_sec / 60.0;

        if time_min > max_time_minutes { max_time_minutes = time_min; }

        let visc_converted = convert_viscosity(point.viscosity_cp, unit_system);

        sheet.write_number_with_format(row,  RAW_DATA_START_COL      as u16, time_min,       &styles.number)?;
        sheet.write_number_with_format(row, (RAW_DATA_START_COL + 1) as u16, visc_converted, visc_fmt_ref)?;

        if let Some(temp) = point.temperature_c {
            sheet.write_number_with_format(row, (RAW_DATA_START_COL + 2) as u16, temp, &styles.number)?;
        }
        if let Some(sr) = point.shear_rate {
            sheet.write_number_with_format(row, (RAW_DATA_START_COL + 3) as u16, sr, &styles.number)?;
        }
        if let Some(ss) = point.shear_stress_pa {
            sheet.write_number_with_format(row, (RAW_DATA_START_COL + 4) as u16, ss, &styles.number)?;
        }
        if let Some(rpm) = point.speed_rpm {
            sheet.write_number_with_format(row, (RAW_DATA_START_COL + 5) as u16, rpm, &styles.number)?;
        }
        if let Some(p) = point.pressure_bar {
            sheet.write_number_with_format(row, (RAW_DATA_START_COL + 6) as u16, p, &styles.number)?;
        }
        // Bath temperature: column 27 (raw_data_start_col + 7), written only when present
        if has_bath {
            if let Some(bt) = point.bath_temperature_c {
                sheet.write_number_with_format(row, (RAW_DATA_START_COL + 7) as u16, bt, &styles.number)?;
            }
        }
    }

    Ok(RawDataSummary { max_time_minutes, has_bath })
}
