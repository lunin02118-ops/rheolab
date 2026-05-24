//! Rheological statistics table builder.
//!
//! Produces the three Typst fragments needed to render the main stats
//! table: column specs, header row, and body rows.  All unit selection
//! flows through one of two paths:
//!
//!   * **Preferred** — `settings.rheology_units` carries explicit
//!     per-category target strings mirrored from `chartSettings.rheologyUnits`
//!     in the UI store.  Each quantity (viscosity / K' / PV / YP) uses
//!     its OWN target, so mixed presets like "cP viscosity + Pa·s^n K'"
//!     render exactly as the UI stats table shows them.  The `Время` column
//!     also honours `time_format` — the table reads "Время (с)", "Время (мин)",
//!     or "Время (чч:мм:сс)" to match the chart axis the user just saw.
//!
//!   * **Legacy fallback** — when `rheology_units` is absent (older
//!     callers, existing tests), we fall back to the coarse
//!     `unit_system` enum via `get_*_unit` / `convert_*`.  Same output
//!     as before.
//!
//! See ADR-0012 and `formatters.rs::render_*_with` for the conversion
//! table and the rationale behind the target-aware helpers.

use super::super::super::formatters::{
    convert_consistency_index, convert_pv, convert_viscosity, convert_yp, decimals, format_number,
    format_number_direct, format_time_value, render_k_with, render_pv_with, render_viscosity_with,
    render_yp_with, resolve_units, time_axis_unit, viscosity_decimals, viscosity_decimals_for,
};
use super::super::super::types::ReportInput;

/// Fragments used by the main Typst `#table(...)` call for the stats section.
pub(super) struct StatsFragments {
    pub columns: String, // e.g. "0.5fr, 0.8fr, ..."
    pub headers: String, // e.g. "header_cell[Cycle], header_cell[Time]..."
    pub rows: String,    // body rows concatenated with "\n"
}

pub(super) fn build_stats_section(input: &ReportInput, is_ru: bool) -> StatsFragments {
    let unit_system = &input.settings.unit_system;
    let visc_rates = &input.settings.viscosity_shear_rates;
    let units = resolve_units(input);

    // ── Body rows ─────────────────────────────────────────────────────
    let mut rows = String::new();
    for c in &input.cycle_results {
        let (k_val, _k_label) = if units.use_targets {
            render_k_with(c.k_prime, &units.k)
        } else {
            (convert_consistency_index(c.k_prime, unit_system), "")
        };
        let ks_str = c
            .k_slot
            .map(|v| {
                let cv = if units.use_targets {
                    render_k_with(v, &units.k).0
                } else {
                    convert_consistency_index(v, unit_system)
                };
                format_number_direct(cv, decimals::K_PRIME)
            })
            .unwrap_or_else(|| "—".to_string());
        let kp_str = c
            .k_pipe
            .map(|v| {
                let cv = if units.use_targets {
                    render_k_with(v, &units.k).0
                } else {
                    convert_consistency_index(v, unit_system)
                };
                format_number_direct(cv, decimals::K_PRIME)
            })
            .unwrap_or_else(|| "—".to_string());
        let pv_converted = c.bingham_pv.map(|v| {
            if units.use_targets {
                render_pv_with(v, &units.pv).0
            } else {
                convert_pv(v, unit_system)
            }
        });
        let yp_converted = c.bingham_yp.map(|v| {
            if units.use_targets {
                render_yp_with(v, &units.yp).0
            } else {
                convert_yp(v, unit_system)
            }
        });

        // Base columns: Cycle, Time, Temp, Pressure, n', K', Ks, Kp, R²
        // Time cell — render according to the resolved time_format.  When
        // `rheology_units` was absent, `time_format` defaults to
        // `"minutes"` which reproduces the pre-2026-04-22 output exactly.
        let time_cell = format_time_value(c.time_min, &units.time_format);
        let mut row = format!(
            "[{}], [{}], [{}], [{}], [{}], [{}], [{}], [{}], [{}], ",
            c.cycle_no,
            time_cell,
            format_number_direct(c.temp_c, decimals::TEMPERATURE),
            format_number(c.pressure_bar, decimals::PRESSURE),
            format_number_direct(c.n_prime, decimals::N_PRIME),
            format_number_direct(k_val, decimals::K_PRIME),
            ks_str,
            kp_str,
            format_number_direct(c.r2, decimals::R_SQUARED)
        );

        // Dynamic viscosity columns from viscosities HashMap
        let visc_dec = if units.use_targets {
            viscosity_decimals_for(&units.viscosity)
        } else {
            viscosity_decimals(unit_system)
        };
        for rate in visc_rates {
            let key = format!("{}", rate);
            let visc_raw = c.viscosities.get(&key).copied().or_else(|| match *rate {
                40 => c.visc_at_40,
                100 => c.visc_at_100,
                170 => c.visc_at_170,
                _ => None,
            });
            let visc_converted = visc_raw.map(|v| {
                if units.use_targets {
                    render_viscosity_with(v, &units.viscosity).0
                } else {
                    convert_viscosity(v, unit_system)
                }
            });
            row.push_str(&format!("[{}], ", format_number(visc_converted, visc_dec)));
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
        rows.push_str(&row);
    }

    // ── Headers ──────────────────────────────────────────────────────────
    let h_cycle = if is_ru { "Цикл" } else { "Cycle" };
    // Variables use standard strings, so double backslash is needed to produce single backslash in output
    let time_unit_label = time_axis_unit(&units.time_format, if is_ru { "ru" } else { "en" });
    let h_time = if is_ru {
        format!("Время\\ #unit_text[({})]", time_unit_label)
    } else {
        format!("Time\\ #unit_text[({})]", time_unit_label)
    };
    let h_temp = "T\\ #unit_text[(°C)]";
    let h_press = "P\\ #unit_text[(bar)]";

    let h_k_unit = units.k.clone();
    let h_pv_unit = units.pv.clone();
    let h_yp_unit = units.yp.clone();
    let h_visc_unit = units.viscosity.clone();

    let mut col_fractions = vec![
        "0.5fr".to_string(), // Cycle
        "0.8fr".to_string(), // Time
        "0.8fr".to_string(), // Temp
        "0.8fr".to_string(), // Pressure
        "0.8fr".to_string(), // n'
        "1fr".to_string(),   // K'
        "0.9fr".to_string(), // Ks
        "0.9fr".to_string(), // Kp
        "0.8fr".to_string(), // R²
    ];
    let mut header_cells = vec![
        format!("header_cell[{}]", h_cycle),
        format!("header_cell[{}]", h_time),
        format!("header_cell[{}]", h_temp),
        format!("header_cell[{}]", h_press),
        "header_cell[n']".to_string(),
        format!("header_cell[K'\\ #unit_text[({})]]", h_k_unit),
        format!("header_cell[Ks\\ #unit_text[({})]]", h_k_unit),
        format!("header_cell[Kp\\ #unit_text[({})]]", h_k_unit),
        "header_cell[R²]".to_string(),
    ];

    // Dynamic viscosity columns
    for rate in visc_rates {
        col_fractions.push("1fr".to_string());
        header_cells.push(format!(
            "header_cell[η\\@{} #unit_text[({})]]",
            rate, h_visc_unit
        ));
    }

    // PV, YP, R²B (only in expert mode)
    if input.settings.show_advanced_stats {
        col_fractions.push("1.1fr".to_string());
        header_cells.push(format!("header_cell[PV\\ #unit_text[({})]]", h_pv_unit));
        col_fractions.push("1.1fr".to_string());
        header_cells.push(format!("header_cell[YP\\ #unit_text[({})]]", h_yp_unit));
        col_fractions.push("0.8fr".to_string());
        header_cells.push("header_cell[R²B]".to_string());
    }

    StatsFragments {
        columns: col_fractions.join(", "),
        headers: header_cells.join(", "),
        rows,
    }
}
