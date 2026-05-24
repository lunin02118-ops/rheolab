//! Touch-point helpers for the page-1 layout and chart annotation.
//!
//! Two pieces:
//! - [`build_touch_points_block`] emits the right-hand "Control Points"
//!   table on page 1.
//! - [`calculate_touch_points_for_chart`] runs the smart-touch-point
//!   algorithm against `ChartPoint`s and returns the renderer-ready
//!   `ChartTouchPoint` list (with localised labels and the standard
//!   green/amber palette).
//!
//! Both used to live at the bottom of `template/mod.rs`; extracting them
//! here keeps the orchestrator below the 500-LOC budget and groups all
//! touch-point chrome in one file.

use super::super::super::chart_generator::{ChartConfig, ChartPoint, ChartTouchPoint};
use super::super::super::formatters::{convert_viscosity, get_viscosity_unit, viscosity_decimals};
use super::super::super::types::ReportSettings;
use super::helpers::escape_typst;
use plotters::style::RGBColor;

/// Right-side "Control Points" table on page 1.
///
/// Returns an empty string when there is nothing to show.
pub(super) fn build_touch_points_block(
    chart_config: Option<&ChartConfig>,
    is_ru: bool,
    show_touch_points: bool,
    unit_system: &str,
) -> String {
    let Some(config) = chart_config else {
        return String::new();
    };
    if config.touch_points.is_empty() || !show_touch_points {
        return String::new();
    }

    let visc_unit = get_viscosity_unit(unit_system);
    let visc_dec = viscosity_decimals(unit_system) as usize;
    let t_touch = if is_ru {
        "Контрольные точки"
    } else {
        "Control Points"
    };
    let mut rows = String::new();
    for tp in &config.touch_points {
        let is_threshold = tp.label.contains("Порог") || tp.label.contains("Threshold");
        let visc_converted = convert_viscosity(tp.viscosity, unit_system);
        let value_col = if is_threshold {
            if is_ru {
                format!("{:.1} мин", tp.time)
            } else {
                format!("{:.1} min", tp.time)
            }
        } else if is_ru {
            format!("{:.dec$} {}", visc_converted, visc_unit, dec = visc_dec)
        } else {
            format!("{:.dec$} {}", visc_converted, visc_unit, dec = visc_dec)
        };
        rows.push_str(&format!(
            "[{}], [{}],\n",
            escape_typst(&tp.label),
            value_col
        ));
    }
    format!(
        r##"
  #section_header("{t_touch}")
  #v(5pt)
  #table(
    columns: (2fr, 1fr),
    stroke: 0.5pt + rgb("#E2E8F0"),
    fill: none,
    {rows}
  )
"##,
        t_touch = t_touch,
        rows = rows
    )
}

/// Calculate touch points for chart visualization using smart algorithm.
///
/// Filters by dominant shear rate (ignoring ramp segments) and detects the
/// end of the initial viscosity ramp-up before searching for threshold crossing.
pub(in super::super) fn calculate_touch_points_for_chart(
    points: &[ChartPoint],
    settings: &ReportSettings,
    is_ru: bool,
    unit_system: &str,
) -> Vec<ChartTouchPoint> {
    use super::super::super::touch_point::{
        calculate_smart_touch_points, SmartTouchPointOptions, TouchPointInput, TouchPointType,
    };

    // Convert ChartPoint → TouchPointInput
    let inputs: Vec<TouchPointInput> = points
        .iter()
        .map(|p| TouchPointInput {
            time_min: p.time_min,
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
            TouchPointType::Threshold => {
                let visc_unit = get_viscosity_unit(unit_system);
                let threshold_converted =
                    convert_viscosity(settings.viscosity_threshold as f64, unit_system);
                let threshold_display = threshold_converted.round() as i32;
                let label = if is_ru {
                    format!("Порог вязкости {} {}", threshold_display, visc_unit)
                } else {
                    format!("Viscosity Threshold {} {}", threshold_display, visc_unit)
                };
                ChartTouchPoint {
                    time: r.time,
                    viscosity: r.viscosity,
                    label,
                    color: RGBColor(16, 185, 129), // Green #10B981
                }
            }
            TouchPointType::Target => {
                let label = if is_ru {
                    format!("Вязкость на {:.0} мин", settings.target_time)
                } else {
                    format!("Viscosity at {:.0} min", settings.target_time)
                };
                ChartTouchPoint {
                    time: r.time,
                    viscosity: r.viscosity,
                    label,
                    color: RGBColor(245, 158, 11), // Amber #F59E0B
                }
            }
        })
        .collect()
}
