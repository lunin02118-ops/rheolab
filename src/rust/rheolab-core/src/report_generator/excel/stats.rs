//! Touch-points table and rheological statistics table.
//!
//! Unit handling: when `settings.rheology_units` is present, every
//! column's label AND conversion is driven by the caller's target
//! strings — mirroring `chartSettings.rheologyUnits` in the UI.  Without
//! it we fall back to the legacy `unit_system` enum path so existing
//! tests and older callers keep producing the same numbers.  See
//! `pdf/template/stats.rs` for the matching PDF logic and ADR-0012 for
//! the full rationale.

use super::super::formatters::{
    build_ramp_string, convert_consistency_index, convert_pv, convert_viscosity, convert_yp,
    format_time_value, get_viscosity_unit, render_k_with, render_pv_with, render_viscosity_with,
    render_yp_with, resolve_units, time_axis_unit, viscosity_decimals, viscosity_excel_format,
    viscosity_excel_format_for,
};
use super::super::types::{ReportInput, TouchPoint};
use super::styles::Styles;
use rust_xlsxwriter::{Worksheet, XlsxError};

fn should_render_rheology_ramp(input: &ReportInput) -> bool {
    input.settings.rheology_source.as_str() != "instrument"
}

pub(super) fn write_touch_points_table(
    sheet: &mut Worksheet,
    touch_points: &[TouchPoint],
    styles: &Styles,
    is_ru: bool,
    unit_system: &str,
    row: &mut u32,
) -> Result<(), XlsxError> {
    if touch_points.is_empty() {
        return Ok(());
    }

    let tp_title = if is_ru {
        "Контрольные точки"
    } else {
        "Control Points"
    };
    sheet.write_string_with_format(*row, 0, tp_title, &styles.section_title)?;
    *row += 1;

    let tp_type = if is_ru { "Тип" } else { "Type" };
    let tp_time = if is_ru {
        "Время (мин)"
    } else {
        "Time (min)"
    };
    let visc_unit = get_viscosity_unit(unit_system);
    let tp_visc = if is_ru {
        format!("Вязкость ({})", visc_unit)
    } else {
        format!("Viscosity ({})", visc_unit)
    };
    sheet.write_string_with_format(*row, 0, tp_type, &styles.header)?;
    sheet.write_string_with_format(*row, 1, tp_time, &styles.header)?;
    sheet.write_string_with_format(*row, 2, &tp_visc, &styles.header)?;
    *row += 1;

    let visc_dec = viscosity_decimals(unit_system);
    for tp in touch_points {
        sheet.write_string_with_format(*row, 0, &tp.label, &styles.cell)?;
        sheet.write_number_with_format(*row, 1, tp.time, &styles.fmt_time)?;
        let visc_val = convert_viscosity(tp.viscosity, unit_system);
        let fmt: &rust_xlsxwriter::Format = if visc_dec == 4 {
            &styles.fmt_viscosity_pas
        } else {
            &styles.fmt_viscosity_fixed
        };
        sheet.write_number_with_format(*row, 2, visc_val, fmt)?;
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
    let units = resolve_units(input);

    let stats_title = if is_ru {
        "Реология"
    } else {
        "Rheology"
    };
    sheet.write_string_with_format(*row, 0, stats_title, &styles.section_title)?;
    *row += 1;

    let source_label = if is_ru {
        "Источник данных"
    } else {
        "Data source"
    };
    let source_value = match input.settings.rheology_source.as_str() {
        "instrument" => {
            if is_ru {
                "Прибор"
            } else {
                "Instrument"
            }
        }
        _ => {
            if is_ru {
                "Программа"
            } else {
                "Program"
            }
        }
    };
    sheet.write_string(*row, 0, &format!("{}: {}", source_label, source_value))?;
    *row += 1;

    // Ramp info belongs only to program-calculated rheology. Instrument
    // reports do not expose the exact steps used by the device for its
    // internal rheology table, so showing UI-detected cycles here would be
    // misleading.
    if should_render_rheology_ramp(input) {
        if let Some(ramp) = build_ramp_string(&input.cycles) {
            let ramp_label = if is_ru {
                "Скорость сдвига"
            } else {
                "Shear Rate"
            };
            let ramp_text = format!("{}: {} (1/s)", ramp_label, ramp);
            sheet.write_string(*row, 0, &ramp_text)?;
            *row += 1;
        }
    }

    // ── Headers ────────────────────────────────────────────────────────
    // Per-category units are already resolved in `units`.  These feed
    // both the header labels and the per-row conversions below, so a
    // header of `K' (Pa·s^n)` ALWAYS means the cells are Pa·s^n.
    let k_unit = units.k.as_str();
    let pv_unit = units.pv.as_str();
    let yp_unit = units.yp.as_str();
    let visc_unit = units.viscosity.as_str();
    let visc_fmt = if units.use_targets {
        viscosity_excel_format_for(&units.viscosity)
    } else {
        viscosity_excel_format(unit_system)
    };
    let visc_rates = &input.settings.viscosity_shear_rates;
    let lang = if is_ru { "ru" } else { "en" };
    let time_unit_label = time_axis_unit(&units.time_format, lang);

    // Two-line headers: `label\n(unit)`.  Requires `styles.header` to have
    // `text_wrap` enabled (see `styles.rs`) — otherwise Excel strips the LF.
    //
    // We use an explicit `\n` rather than relying on Excel's auto-wrap so
    // the break always falls between the metric name and its unit
    // parenthetical, regardless of column width or locale.
    let cycle_label = if is_ru { "Цикл" } else { "Cycle" };
    let time_label = if is_ru {
        format!("Время\n({})", time_unit_label)
    } else {
        format!("Time\n({})", time_unit_label)
    };

    // Build dynamic headers: base cols + Ks + Kp + dynamic viscosity cols + Bingham cols.
    // Metric/unit pairs are joined with `\n` so the unit wraps onto a
    // second visual line in Excel (see note above).
    let mut stats_headers: Vec<String> = vec![
        cycle_label.to_string(),
        time_label,
        "T\n(°C)".to_string(),
        "P\n(bar)".to_string(),
        "n'".to_string(),
        format!("K'\n({})", k_unit),
        format!("Ks\n({})", k_unit),
        format!("Kp\n({})", k_unit),
        "R²".to_string(),
    ];
    for rate in visc_rates {
        stats_headers.push(format!("η@{}\n({})", rate, visc_unit));
    }
    if input.settings.show_advanced_stats {
        stats_headers.push(format!("PV\n({})", pv_unit));
        stats_headers.push(format!("YP\n({})", yp_unit));
        stats_headers.push("R²B".to_string());
    }

    for (i, header) in stats_headers.iter().enumerate() {
        sheet.write_string_with_format(*row, i as u16, header, &styles.header)?;
    }
    // Give the header row enough vertical space to show both lines
    // clearly.  30 points ≈ 2 lines of default 11pt font + padding.
    sheet.set_row_height(*row, 30.0)?;
    *row += 1;

    // ── Data rows ─────────────────────────────────────────────────────
    for cycle in &input.cycle_results {
        // Per-quantity conversion — target-aware when rheology_units
        // was provided, legacy enum-based otherwise.
        let k_val = if units.use_targets {
            render_k_with(cycle.k_prime, &units.k).0
        } else {
            convert_consistency_index(cycle.k_prime, unit_system)
        };
        let pv_val = if units.use_targets {
            render_pv_with(cycle.bingham_pv.unwrap_or(0.0), &units.pv).0
        } else {
            convert_pv(cycle.bingham_pv.unwrap_or(0.0), unit_system)
        };
        let yp_val = if units.use_targets {
            render_yp_with(cycle.bingham_yp.unwrap_or(0.0), &units.yp).0
        } else {
            convert_yp(cycle.bingham_yp.unwrap_or(0.0), unit_system)
        };

        let mut col: u16 = 0;
        // Base columns: Cycle, Time, Temp, Pressure, n', K'
        sheet.write_number_with_format(*row, col, cycle.cycle_no as f64, &styles.cell)?;
        col += 1;

        // Time column — render mode depends on `time_format`:
        //   * "seconds"  → integer seconds, number with "0" format
        //   * "hh:mm:ss" → Excel stores as text (00:09:00) — Excel's
        //                   native time-serial would round-trip awkwardly
        //                   and we want exact visual parity with the UI.
        //   * "minutes"  → legacy path: number with "0.0" format.
        match units.time_format.as_str() {
            "seconds" => {
                let secs = (cycle.time_min * 60.0).round();
                sheet.write_number_with_format(*row, col, secs, &styles.cell)?;
            }
            "hh:mm:ss" => {
                let formatted = format_time_value(cycle.time_min, &units.time_format);
                sheet.write_string_with_format(*row, col, &formatted, &styles.cell)?;
            }
            _ => {
                sheet.write_number_with_format(*row, col, cycle.time_min, &styles.fmt_time)?;
            }
        }
        col += 1;

        sheet.write_number_with_format(*row, col, cycle.temp_c, &styles.fmt_temperature)?;
        col += 1;
        sheet.write_number_with_format(
            *row,
            col,
            cycle.pressure_bar.unwrap_or(0.0),
            &styles.fmt_pressure,
        )?;
        col += 1;
        sheet.write_number_with_format(*row, col, cycle.n_prime, &styles.fmt_n_prime)?;
        col += 1;
        sheet.write_number_with_format(*row, col, k_val, &styles.fmt_k_prime)?;
        col += 1;

        // Ks
        if let Some(ks) = cycle.k_slot {
            let ks_val = if units.use_targets {
                render_k_with(ks, &units.k).0
            } else {
                convert_consistency_index(ks, unit_system)
            };
            sheet.write_number_with_format(*row, col, ks_val, &styles.fmt_k_prime)?;
        } else {
            sheet.write_string(*row, col, "—")?;
        }
        col += 1;

        // Kp
        if let Some(kp) = cycle.k_pipe {
            let kp_val = if units.use_targets {
                render_k_with(kp, &units.k).0
            } else {
                convert_consistency_index(kp, unit_system)
            };
            sheet.write_number_with_format(*row, col, kp_val, &styles.fmt_k_prime)?;
        } else {
            sheet.write_string(*row, col, "—")?;
        }
        col += 1;

        sheet.write_number_with_format(*row, col, cycle.r2, &styles.fmt_r_squared)?;
        col += 1;

        // Dynamic viscosity columns from viscosities HashMap
        for rate in visc_rates {
            let key = format!("{}", rate);
            let visc_raw = cycle
                .viscosities
                .get(&key)
                .copied()
                .or_else(|| match *rate {
                    40 => cycle.visc_at_40,
                    100 => cycle.visc_at_100,
                    170 => cycle.visc_at_170,
                    _ => None,
                })
                .unwrap_or(0.0);
            let visc_val = if units.use_targets {
                render_viscosity_with(visc_raw, &units.viscosity).0
            } else {
                convert_viscosity(visc_raw, unit_system)
            };
            let fmt: &rust_xlsxwriter::Format = if visc_fmt == "0.0000" {
                &styles.fmt_viscosity_pas
            } else {
                &styles.fmt_viscosity_fixed
            };
            sheet.write_number_with_format(*row, col, visc_val, fmt)?;
            col += 1;
        }

        // PV, YP, R²B (only in expert mode)
        if input.settings.show_advanced_stats {
            sheet.write_number_with_format(*row, col, pv_val, &styles.fmt_pv)?;
            col += 1;
            sheet.write_number_with_format(*row, col, yp_val, &styles.fmt_yp)?;
            col += 1;
            sheet.write_number_with_format(
                *row,
                col,
                cycle.bingham_r2.unwrap_or(0.0),
                &styles.fmt_bingham_r2,
            )?;
        }
        let _ = col;
        *row += 1;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report_generator::types::{ReportInput, ReportMetadata, ReportSettings};

    fn input_with_source(source: &str) -> ReportInput {
        ReportInput {
            raw_data: vec![],
            metadata: ReportMetadata {
                filename: "test.xlsx".to_string(),
                ..Default::default()
            },
            cycle_results: vec![],
            recipe: vec![],
            water_params: None,
            cycles: vec![],
            settings: ReportSettings {
                rheology_source: source.to_string(),
                ..ReportSettings::default()
            },
            chart_image_base64: None,
            axis_values: None,
        }
    }

    #[test]
    fn instrument_source_suppresses_rheology_ramp() {
        assert!(!should_render_rheology_ramp(&input_with_source(
            "instrument"
        )));
    }

    #[test]
    fn program_source_keeps_rheology_ramp() {
        assert!(should_render_rheology_ramp(&input_with_source("program")));
    }
}
