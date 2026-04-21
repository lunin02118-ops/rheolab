//! Raw-data table page renderer.
//!
//! Emits the full Typst block for the optional “Raw Measurement Data” page.
//! Returns an empty string when the user disabled raw data or there is
//! nothing to show — callers can always embed the result unconditionally.
use super::super::super::types::ReportInput;
use super::super::super::formatters::{
    convert_viscosity, get_viscosity_unit, viscosity_decimals,
};

/// Maximum number of rows Typst is asked to render.  Anything above this is
/// truncated and a user-visible notice is appended — avoids pathological
/// compile times for multi-hour datasets.
const MAX_RAW_ROWS: usize = 2000;

pub(super) fn build_raw_data_page(input: &ReportInput, is_ru: bool) -> String {
    if !input.settings.show_raw_data || input.raw_data.is_empty() {
        return String::new();
    }

    let unit_system = &input.settings.unit_system;
    let visc_unit = get_viscosity_unit(unit_system);
    let visc_dec = viscosity_decimals(unit_system) as usize;

    let t_raw = if is_ru { "Сырые данные измерений" } else { "Raw Measurement Data" };
    let h_rd_no = "\\#";
    let h_rd_time = if is_ru { "Время (сек)" } else { "Time (sec)" };
    let h_rd_visc = if is_ru {
        format!("Вязкость ({})", visc_unit)
    } else {
        format!("Viscosity ({})", visc_unit)
    };
    let h_rd_temp = if is_ru { "Температура (°C)" } else { "Temperature (°C)" };
    let h_rd_shear = if is_ru { "Скорость\\ сдвига (1/с)" } else { "Shear Rate\\ (1/s)" };
    let h_rd_stress = if is_ru { "Напряжение\\ сдвига (Па)" } else { "Shear Stress\\ (Pa)" };
    let h_rd_rpm = if is_ru { "Обороты\\ (об/мин)" } else { "Speed\\ (RPM)" };
    let h_rd_press = if is_ru { "Давление (бар)" } else { "Pressure (bar)" };

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
        let visc_converted = convert_viscosity(dp.viscosity_cp, unit_system);
        let _ = write!(raw_rows, "[{}], [{:.1}], [{:.dec$}], [", i + 1, dp.time_sec, visc_converted, dec = visc_dec);
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
}
