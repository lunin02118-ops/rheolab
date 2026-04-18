//! Touch-points table and rheological statistics table.

use rust_xlsxwriter::{Worksheet, XlsxError};
use super::super::formatters::{
    build_ramp_string, convert_consistency_index, convert_pv, convert_yp,
    get_k_unit, get_pv_unit, get_yp_unit,
};
use super::super::types::{ReportInput, TouchPoint};
use super::styles::Styles;

pub(super) fn write_touch_points_table(
    sheet: &mut Worksheet,
    touch_points: &[TouchPoint],
    styles: &Styles,
    is_ru: bool,
    row: &mut u32,
) -> Result<(), XlsxError> {
    if touch_points.is_empty() { return Ok(()); }

    let tp_title = if is_ru { "Контрольные точки" } else { "Control Points" };
    sheet.write_string_with_format(*row, 0, tp_title, &styles.section_title)?;
    *row += 1;

    let tp_type = if is_ru { "Тип" } else { "Type" };
    let tp_time = if is_ru { "Время (мин)" } else { "Time (min)" };
    let tp_visc = if is_ru { "Вязкость (сП)" } else { "Viscosity (cP)" };
    sheet.write_string_with_format(*row, 0, tp_type, &styles.header)?;
    sheet.write_string_with_format(*row, 1, tp_time, &styles.header)?;
    sheet.write_string_with_format(*row, 2, tp_visc, &styles.header)?;
    *row += 1;

    for tp in touch_points {
        sheet.write_string_with_format(*row, 0, &tp.label, &styles.cell)?;
        sheet.write_number_with_format(*row, 1, tp.time, &styles.number)?;
        sheet.write_number_with_format(*row, 2, tp.viscosity, &styles.number)?;
        *row += 1;
    }
    *row += 1;
    Ok(())
}

pub(super) fn write_statistics(
    sheet: &mut Worksheet,
    input: &ReportInput,
    styles: &Styles,
    is_ru: bool,
    row: &mut u32,
) -> Result<(), XlsxError> {
    let unit_system = &input.settings.unit_system;

    let stats_title = if is_ru { "Реология" } else { "Rheology" };
    sheet.write_string_with_format(*row, 0, stats_title, &styles.section_title)?;
    *row += 1;

    // Ramp info
    if let Some(ramp) = build_ramp_string(&input.cycles) {
        let ramp_label = if is_ru { "Скорость сдвига" } else { "Shear Rate" };
        let ramp_text = format!("{}: {} (1/s)", ramp_label, ramp);
        sheet.write_string(*row, 0, &ramp_text)?;
        *row += 1;
    }

    // ── Headers ────────────────────────────────────────────────────────
    let k_unit  = get_k_unit(unit_system);
    let pv_unit = get_pv_unit(unit_system);
    let yp_unit = get_yp_unit(unit_system);
    let visc_rates = &input.settings.viscosity_shear_rates;

    let cycle_label = if is_ru { "Цикл" } else { "Cycle" };
    let time_label  = if is_ru { "Время (мин)" } else { "Time (min)" };

    // Build dynamic headers: base cols + Ks + Kp + dynamic viscosity cols + Bingham cols
    let mut stats_headers: Vec<String> = vec![
        cycle_label.to_string(),
        time_label.to_string(),
        "T (°C)".to_string(),
        "P (bar)".to_string(),
        "n'".to_string(),
        format!("K' ({})", k_unit),
        format!("Ks ({})", k_unit),
        format!("Kp ({})", k_unit),
        "R²".to_string(),
    ];
    for rate in visc_rates {
        stats_headers.push(format!("η@{}", rate));
    }
    if input.settings.show_advanced_stats {
        stats_headers.push(format!("PV ({})", pv_unit));
        stats_headers.push(format!("YP ({})", yp_unit));
        stats_headers.push("R²B".to_string());
    }

    for (i, header) in stats_headers.iter().enumerate() {
        sheet.write_string_with_format(*row, i as u16, header, &styles.header)?;
    }
    *row += 1;

    // ── Data rows (unit conversion identical to PDF) ───────────────────
    for cycle in &input.cycle_results {
        let k_val  = convert_consistency_index(cycle.k_prime, unit_system);
        let pv_val = convert_pv(cycle.bingham_pv.unwrap_or(0.0), unit_system);
        let yp_val = convert_yp(cycle.bingham_yp.unwrap_or(0.0), unit_system);

        let mut col: u16 = 0;
        // Base columns: Cycle, Time, Temp, Pressure, n', K'
        sheet.write_number_with_format(*row, col, cycle.cycle_no as f64,           &styles.cell)?;           col += 1;
        sheet.write_number_with_format(*row, col, cycle.time_min,                  &styles.fmt_time)?;       col += 1;
        sheet.write_number_with_format(*row, col, cycle.temp_c,                    &styles.fmt_temperature)?; col += 1;
        sheet.write_number_with_format(*row, col, cycle.pressure_bar.unwrap_or(0.0), &styles.fmt_pressure)?; col += 1;
        sheet.write_number_with_format(*row, col, cycle.n_prime,                   &styles.fmt_n_prime)?;    col += 1;
        sheet.write_number_with_format(*row, col, k_val,                           &styles.fmt_k_prime)?;    col += 1;

        // Ks
        if let Some(ks) = cycle.k_slot {
            sheet.write_number_with_format(*row, col, convert_consistency_index(ks, unit_system), &styles.fmt_k_prime)?;
        } else {
            sheet.write_string(*row, col, "—")?;
        }
        col += 1;

        // Kp
        if let Some(kp) = cycle.k_pipe {
            sheet.write_number_with_format(*row, col, convert_consistency_index(kp, unit_system), &styles.fmt_k_prime)?;
        } else {
            sheet.write_string(*row, col, "—")?;
        }
        col += 1;

        sheet.write_number_with_format(*row, col, cycle.r2, &styles.fmt_r_squared)?; col += 1;

        // Dynamic viscosity columns from viscosities HashMap
        for rate in visc_rates {
            let key = format!("{}", rate);
            let visc_val = cycle.viscosities.get(&key).copied()
                .or_else(|| match *rate {
                    40  => cycle.visc_at_40,
                    100 => cycle.visc_at_100,
                    170 => cycle.visc_at_170,
                    _   => None,
                })
                .unwrap_or(0.0);
            sheet.write_number_with_format(*row, col, visc_val, &styles.fmt_viscosity_fixed)?;
            col += 1;
        }

        // PV, YP, R²B (only in expert mode)
        if input.settings.show_advanced_stats {
            sheet.write_number_with_format(*row, col, pv_val, &styles.fmt_pv)?; col += 1;
            sheet.write_number_with_format(*row, col, yp_val, &styles.fmt_yp)?; col += 1;
            sheet.write_number_with_format(*row, col, cycle.bingham_r2.unwrap_or(0.0), &styles.fmt_bingham_r2)?;
        }
        let _ = col;
        *row += 1;
    }
    Ok(())
}
