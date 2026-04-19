//! Rheological statistics table builder.
//!
//! Produces the three Typst fragments needed to render the main stats table:
//! column specs, header row, and body rows.  All unit conversions go through
//! `formatters::*` so the output respects the caller’s unit system.
use super::super::super::types::ReportInput;
use super::super::super::formatters::{
    format_number, format_number_direct, convert_consistency_index, convert_pv, convert_yp,
    get_k_unit, get_pv_unit, get_yp_unit, decimals,
};

/// Fragments used by the main Typst `#table(...)` call for the stats section.
pub(super) struct StatsFragments {
    pub columns: String,        // e.g. "0.5fr, 0.8fr, ..."
    pub headers: String,        // e.g. "header_cell[Cycle], header_cell[Time]..."
    pub rows: String,           // body rows concatenated with "\n"
}

pub(super) fn build_stats_section(input: &ReportInput, is_ru: bool) -> StatsFragments {
    let unit_system = &input.settings.unit_system;
    let visc_rates = &input.settings.viscosity_shear_rates;

    // ── Body rows ─────────────────────────────────────────────────────────
    let mut rows = String::new();
    for c in &input.cycle_results {
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
        rows.push_str(&row);
    }

    // ── Headers ──────────────────────────────────────────────────────────
    let h_cycle = if is_ru { "Цикл" } else { "Cycle" };
    // Variables use standard strings, so double backslash is needed to produce single backslash in output
    let h_time = if is_ru { "Время\\ #unit_text[(мин)]" } else { "Time\\ #unit_text[(min)]" };
    let h_temp = "T\\ #unit_text[(°C)]";
    let h_press = "P\\ #unit_text[(bar)]";

    let h_k_unit = get_k_unit(unit_system);
    let h_pv_unit = get_pv_unit(unit_system);
    let h_yp_unit = get_yp_unit(unit_system);

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

    StatsFragments {
        columns: col_fractions.join(", "),
        headers: header_cells.join(", "),
        rows,
    }
}
