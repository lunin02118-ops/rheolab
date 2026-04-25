//! Raw-data columns (U..AB, hidden in the shipping report).
//!
//! The chart's `set_categories` / `set_values` reference ranges in these
//! columns, so the data block is written *before* the chart is built.
//!
//! Returns `RawDataSummary { max_time_display, has_bath, time_format }`
//! so the caller can configure chart axes without re-scanning the data.
//! `max_time_display` is in the *same unit* the time column was written in
//! (minutes / seconds / Excel time-serial days) so the chart can set its
//! X-axis max directly without re-converting.

use rust_xlsxwriter::{Format, FormatAlign, FormatBorder, Worksheet, XlsxError};
use super::super::types::ReportInput;
use super::super::formatters::{
    convert_viscosity, get_viscosity_unit, resolve_units, time_axis_unit, viscosity_excel_format,
};
use super::styles::Styles;

/// First column for raw data. "U" in 1-based Excel = 20 (0-indexed).
pub(super) const RAW_DATA_START_COL: usize = 20;

pub(super) struct RawDataSummary {
    /// Maximum time value written to the sheet, in whatever unit
    /// `time_format` dictates (minutes / seconds / day-serial).  The
    /// chart uses this directly as `x_axis.set_max`.
    pub(super) max_time_display: f64,
    pub(super) has_bath:         bool,
    /// Echoed-back `time_format` so the chart builder picks the correct
    /// axis title and `num_format` without re-running `resolve_units`.
    pub(super) time_format:      String,
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
    // Two-line headers across the raw-data block — unit parenthetical on
    // its own line.  `styles.header` has `text_wrap` enabled so the `\n`
    // is honoured by Excel; otherwise the LF character would be stripped
    // and the headers would render as one long line.
    let visc_header_ru = format!("Вязкость\n({})", visc_unit);
    let visc_header_en = format!("Viscosity\n({})", visc_unit);

    // Resolve the dashboard-selected time_format.  Empty / absent
    // `rheology_units` degrade to `"minutes"`, which keeps the legacy
    // column layout (number with "0.00" format and header "Время\n(мин)")
    // byte-for-byte identical.
    let resolved = resolve_units(input);
    let time_fmt = resolved.time_format.clone();
    let lang = if is_ru { "ru" } else { "en" };
    let time_unit = time_axis_unit(&time_fmt, lang);
    let time_header = if is_ru {
        format!("Время\n({})", time_unit)
    } else {
        format!("Time\n({})", time_unit)
    };

    let raw_headers: [&str; 8] = if is_ru {
        [time_header.as_str(), &visc_header_ru, "Температура\n(°C)", "Скорость сдвига\n(1/с)", "Напряжение сдвига\n(Па)", "Обороты\n(об/мин)", "Давление\n(бар)", "Темп. бани\n(°C)"]
    } else {
        [time_header.as_str(), &visc_header_en, "Temperature\n(C)", "Shear Rate\n(1/s)", "Shear Stress\n(Pa)", "Speed\n(RPM)", "Pressure\n(bar)", "Bath Temp\n(°C)"]
    };

    let has_bath = input.raw_data.iter().any(|dp| dp.bath_temperature_c.is_some());
    let header_count = if has_bath { raw_headers.len() } else { raw_headers.len() - 1 };
    for i in 0..header_count {
        sheet.write_string_with_format(0, (RAW_DATA_START_COL + i) as u16, raw_headers[i], &styles.header)?;
    }
    // Match the stats-table header-row height so two-line headers render
    // fully in Excel without the user needing to manually resize row 1.
    sheet.set_row_height(0, 30.0)?;

    let visc_fmt_ref: &rust_xlsxwriter::Format = if visc_fmt == "0.0000" {
        &styles.fmt_viscosity_pas
    } else {
        &styles.fmt_viscosity_fixed
    };

    // Custom cell formats for the time column when the user selected a
    // non-legacy time_format.  Built inline here (rather than extending
    // `Styles`) because they are only used by this module.
    //
    //   * "seconds":  integer seconds with `"0"` format
    //   * "hh:mm:ss": Excel day-serial with `"[h]:mm:ss"` format — brackets
    //                 so durations > 24h render as "25:00:00" instead of
    //                 wrapping to "01:00:00" on day 2.
    //   * else:       &styles.number (legacy "0.00" format, minutes)
    let mk_time_fmt = |fmt: &str| -> Format {
        Format::new()
            .set_num_format(fmt)
            .set_border(FormatBorder::Thin)
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter)
    };
    let fmt_time_seconds  = mk_time_fmt("0");
    let fmt_time_hhmmss   = mk_time_fmt("[h]:mm:ss");

    let mut max_time_display = 0.0f64;

    for (idx, point) in input.raw_data.iter().enumerate() {
        let row = (idx + 1) as u32;
        // Compute the stored value and picked format per row.  The minutes
        // path keeps using `styles.number` so the deterministic byte-for-
        // byte golden test in `excel::mod::tests` still passes.
        let (time_value, time_fmt_ref): (f64, &Format) = match time_fmt.as_str() {
            "seconds"   => (point.time_sec.round(),                &fmt_time_seconds),
            "hh:mm:ss"  => (point.time_sec / 86_400.0,             &fmt_time_hhmmss),
            _           => (point.time_sec / 60.0,                 &styles.number), // minutes / legacy
        };

        if time_value > max_time_display { max_time_display = time_value; }

        let visc_converted = convert_viscosity(point.viscosity_cp, unit_system);

        sheet.write_number_with_format(row,  RAW_DATA_START_COL      as u16, time_value,     time_fmt_ref)?;
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

    Ok(RawDataSummary { max_time_display, has_bath, time_format: time_fmt })
}
