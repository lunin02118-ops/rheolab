//! Touch-point summary block for the comparison PDF.
//!
//! Emits **two separate tables** in the Typst markup — one per touch-point
//! kind — so the user sees the threshold crossings and the target-time
//! readings as distinct sections (matching the in-app view):
//!
//!   1. "Точки касания (порог N …)"           ← `TouchPointType::Threshold`
//!   2. "Вязкость в заданное время (M мин)"   ← `TouchPointType::Target`
//!
//! Also exposes [`canonical_to_internal`], the metric-key normaliser that
//! maps UI-side metric ids (e.g. `"shear_rate_s1"`) onto the internal
//! short tags the renderer's `ChartConfig::shear_rate_axis` / `show_*`
//! flags use (e.g. `"shear_rate"`).

use super::super::super::formatters::{convert_viscosity, get_viscosity_unit};
use super::super::super::pdf::template::helpers::escape_typst;
use super::super::super::touch_point::{
    TouchPointInput, TouchPointType, SmartTouchPointOptions,
    calculate_smart_touch_points,
};
use super::super::types::ComparisonReportInput;

/// Build the touch-point tables for the comparison summary page.
///
/// The per-table `Тип` column is dropped because the section title now
/// conveys the point type unambiguously; every row is `Test Name | Time
/// (min) | Viscosity`.
///
/// If only one kind is present the other table is skipped.  Returns an
/// empty string when touch points are disabled or none were computed.
pub(super) fn build_comparison_touch_points_block(
    input: &ComparisonReportInput,
    is_ru: bool,
) -> String {
    let cfg = &input.comparison_chart;
    if !cfg.touch_point.enabled || cfg.touch_point.viscosity_threshold <= 0.0 {
        return String::new();
    }

    let unit_system = &input.unit_system;
    let visc_unit = get_viscosity_unit(unit_system);

    // Collect results per experiment.  Only the fields we render are kept
    // — the `tp_type` discriminant is used below to split rows between
    // the two tables, then discarded.
    struct TpRow {
        exp_name: String,
        tp_type: TouchPointType,
        time_min: f64,
        viscosity_display: f64,
    }
    let mut tp_rows: Vec<TpRow> = Vec::new();

    for entry in &input.experiments {
        let raw = &entry.report_input.raw_data;
        if raw.len() < 3 { continue; }

        let first_time_sec = raw.first().map(|p| p.time_sec).unwrap_or(0.0);
        let inputs: Vec<TouchPointInput> = raw.iter()
            .filter(|p| p.time_sec.is_finite() && p.viscosity_cp.is_finite())
            .map(|p| TouchPointInput {
                time_min: (p.time_sec - first_time_sec) / 60.0,
                viscosity_cp: p.viscosity_cp,
                shear_rate: p.shear_rate.unwrap_or(0.0),
            })
            .collect();

        let results = calculate_smart_touch_points(
            &inputs,
            &SmartTouchPointOptions {
                viscosity_threshold: cfg.touch_point.viscosity_threshold,
                show_target_time: cfg.touch_point.show_target_time,
                target_time: cfg.touch_point.target_time,
                ..Default::default()
            },
        );

        for r in &results {
            let visc_display = convert_viscosity(r.viscosity, unit_system);
            tp_rows.push(TpRow {
                exp_name: entry.display_name.clone(),
                tp_type: r.tp_type.clone(),
                time_min: r.time,
                viscosity_display: visc_display,
            });
        }
    }

    if tp_rows.is_empty() {
        return String::new();
    }

    let threshold_display = convert_viscosity(cfg.touch_point.viscosity_threshold, unit_system);

    // Localised strings shared by both tables.
    let h_name = if is_ru { "Название теста" } else { "Test Name" };
    let h_time = if is_ru { "Время (мин)" } else { "Time (min)" };
    let h_visc = if is_ru { format!("Вязкость ({})", visc_unit) }
                 else     { format!("Viscosity ({})", visc_unit) };

    // Helper: render ONE three-column table for a filtered row slice.  The
    // caller decides the section title so the same helper serves both
    // "threshold crossings" and "viscosity at set time".
    let render_table = |title: &str, rows: &[&TpRow]| -> String {
        if rows.is_empty() { return String::new(); }
        let mut body = String::new();
        for tp in rows {
            body.push_str(&format!(
                "  [{}], [{:.1}], [{:.0}],\n",
                escape_typst(&tp.exp_name),
                tp.time_min,
                tp.viscosity_display,
            ));
        }
        format!(r##"
#v(10pt)
#section_header("{title}")
#v(5pt)
#table(
  columns: (3fr, 1fr, 1.2fr),
  stroke: 0.5pt + rgb("#E2E8F0"),
  fill: none,
  align: center + horizon,
  table.header(
    header_cell[{h_name}],
    header_cell[{h_time}],
    header_cell[{h_visc}]
  ),
{body}
)
"##,
            title = escape_typst(title),
            h_name = h_name,
            h_time = h_time,
            h_visc = h_visc,
            body = body,
        )
    };

    // Split the rows while preserving the original per-experiment order.
    let threshold_rows: Vec<&TpRow> = tp_rows.iter()
        .filter(|r| matches!(r.tp_type, TouchPointType::Threshold))
        .collect();
    let target_rows: Vec<&TpRow> = tp_rows.iter()
        .filter(|r| matches!(r.tp_type, TouchPointType::Target))
        .collect();

    let threshold_title = if is_ru {
        format!("Точки касания (порог {:.0} {})", threshold_display, visc_unit)
    } else {
        format!("Threshold Crossings (threshold {:.0} {})", threshold_display, visc_unit)
    };
    let target_title = if is_ru {
        format!("Вязкость в заданное время ({:.0} мин)", cfg.touch_point.target_time)
    } else {
        format!("Viscosity at Set Time ({:.0} min)", cfg.touch_point.target_time)
    };

    let mut out = String::new();
    out.push_str(&render_table(&threshold_title, &threshold_rows));
    out.push_str(&render_table(&target_title,    &target_rows));
    out
}

/// Map the canonical UI metric keys (the values stored in
/// `displaySettings.{primary,leftSecondary,…}Metric` on the TypeScript
/// side, sourced from `METRICS` in `app/dashboard/comparison/page.tsx`)
/// onto the **internal short keys** that the renderer's
/// `ChartConfig::shear_rate_axis` / `show_*` flags work in.
///
/// Why this exists
/// ===============
/// The production UI dropdown stores metric ids such as
/// `"shear_rate_s1"`, `"temperature_c"`, `"pressure_bar"`,
/// `"bath_temperature_c"`, `"viscosity_cp"` — these are the same keys
/// used as scale names on the live uPlot preview.  The Rust comparison
/// renderer, however, identifies metrics by short tags (`"shear_rate"`,
/// `"temperature"`, `"pressure"`, `"bath_temperature"`, `"viscosity"`).
/// A naïve `==` comparison of those two namespaces silently drops every
/// metric whose canonical key carries a unit suffix — exactly the
/// 2026-04-25 user report where the comparison PDF rendered only the
/// viscosity axis even when shear rate was selected on Слева 2.
///
/// We keep the function tolerant: any unknown / already-internal key
/// passes through unchanged so legacy callers (the existing
/// regression tests, the debug example) continue to work.
pub(super) fn canonical_to_internal(key: &str) -> &str {
    match key {
        // shear rate
        "shear_rate_s1" | "shearRate" | "shear_rate" => "shear_rate",
        // viscosity
        "viscosity_cp" | "viscosityCp" | "viscosity" => "viscosity",
        // sample temperature
        "temperature_c" | "temperatureC" | "temperature" => "temperature",
        // bath temperature
        "bath_temperature_c" | "bathTemperatureC" | "bath_temperature" => "bath_temperature",
        // pressure
        "pressure_bar" | "pressureBar" | "pressure" => "pressure",
        // unknown / already-canonical / sentinel ("none") — pass through
        other => other,
    }
}
