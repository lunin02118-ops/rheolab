//! Touch-point calculation wrapper specific to Excel reports.
//!
//! Translates the generic [`super::super::touch_point::calculate_smart_touch_points`]
//! output into [`TouchPoint`] rows labelled for display inside the spreadsheet.

use super::super::types::{DataPoint, ReportSettings, TouchPoint};

pub(super) fn calculate_touch_points(
    raw_data: &[DataPoint],
    settings: &ReportSettings,
    is_ru: bool,
) -> Vec<TouchPoint> {
    use super::super::touch_point::{
        TouchPointInput, TouchPointType, SmartTouchPointOptions,
        calculate_smart_touch_points,
    };

    // Convert DataPoint → TouchPointInput (time_sec → time_min)
    let inputs: Vec<TouchPointInput> = raw_data
        .iter()
        .map(|p| TouchPointInput {
            time_min: p.time_sec / 60.0,
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
            TouchPointType::Threshold => TouchPoint {
                label: if is_ru {
                    format!("Порог {} сП", settings.viscosity_threshold as i32)
                } else {
                    format!("Threshold {} cP", settings.viscosity_threshold as i32)
                },
                time: r.time,
                viscosity: r.viscosity,
                color: "FF10B981".to_string(),
            },
            TouchPointType::Target => TouchPoint {
                label: if is_ru {
                    format!("На {} мин", settings.target_time as i32)
                } else {
                    format!("At {} min", settings.target_time as i32)
                },
                time: r.time,
                viscosity: r.viscosity,
                color: "FFF59E0B".to_string(),
            },
        })
        .collect()
}
