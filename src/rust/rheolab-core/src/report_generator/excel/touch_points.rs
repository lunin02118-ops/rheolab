//! Touch-point calculation wrapper specific to Excel reports.
//!
//! Translates the generic [`super::super::touch_point::calculate_smart_touch_points`]
//! output into [`TouchPoint`] rows labelled for display inside the spreadsheet.

use super::super::types::{DataPoint, ReportSettings, TouchPoint};
use super::super::formatters::{convert_viscosity, get_viscosity_unit};

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
    // Algorithm runs in storage unit (mPa·s); display conversion is applied to outputs below.
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

    // `TouchPoint.viscosity` is kept in storage unit (mPa·s);
    // `write_touch_points_table` in stats.rs converts it at render time.
    let unit_system = &settings.unit_system;
    let visc_unit = get_viscosity_unit(unit_system);
    let threshold_converted = convert_viscosity(settings.viscosity_threshold, unit_system);
    // Threshold label: use 4 decimals for Pa·s, 0 for mPa·s/cP
    let threshold_str = if unit_system == "SI_Pas" {
        format!("{:.4}", threshold_converted)
    } else {
        format!("{}", threshold_converted.round() as i32)
    };

    results
        .into_iter()
        .map(|r| match r.tp_type {
            TouchPointType::Threshold => TouchPoint {
                label: if is_ru {
                    format!("Порог {} {}", threshold_str, visc_unit)
                } else {
                    format!("Threshold {} {}", threshold_str, visc_unit)
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

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::super::types::DataPoint;

    /// Build a minimal descending ramp that crosses 500 mPa·s around t = 2 min.
    fn ramp_data() -> Vec<DataPoint> {
        (0..20)
            .map(|i| DataPoint {
                time_sec: (i as f64) * 60.0,
                viscosity_cp: 1000.0 - (i as f64) * 50.0,
                temperature_c: Some(25.0),
                shear_rate: Some(170.0),
                shear_stress_pa: None,
                speed_rpm: None,
                pressure_bar: None,
                bath_temperature_c: None,
            })
            .collect()
    }

    fn settings_with(unit_system: &str) -> ReportSettings {
        ReportSettings {
            unit_system: unit_system.to_string(),
            viscosity_threshold: 500.0,
            show_touch_points: true,
            show_target_time: false,
            ..Default::default()
        }
    }

    #[test]
    fn threshold_label_uses_mpa_s_for_si() {
        let tps = calculate_touch_points(&ramp_data(), &settings_with("SI"), false);
        assert!(tps.iter().any(|tp| tp.label == "Threshold 500 mPa·s"),
                "expected mPa·s label, got {:?}", tps.iter().map(|t| &t.label).collect::<Vec<_>>());
    }

    #[test]
    fn threshold_label_uses_pa_s_with_4_decimals_for_si_pas() {
        let tps = calculate_touch_points(&ramp_data(), &settings_with("SI_Pas"), false);
        assert!(tps.iter().any(|tp| tp.label == "Threshold 0.5000 Pa·s"),
                "expected Pa·s label with 4 decimals, got {:?}", tps.iter().map(|t| &t.label).collect::<Vec<_>>());
    }

    #[test]
    fn threshold_label_uses_cp_for_imperial() {
        let tps = calculate_touch_points(&ramp_data(), &settings_with("Imperial"), false);
        assert!(tps.iter().any(|tp| tp.label == "Threshold 500 cP"),
                "expected cP label, got {:?}", tps.iter().map(|t| &t.label).collect::<Vec<_>>());
    }

    #[test]
    fn threshold_label_ru_localized() {
        let tps = calculate_touch_points(&ramp_data(), &settings_with("SI_Pas"), true);
        assert!(tps.iter().any(|tp| tp.label == "Порог 0.5000 Pa·s"),
                "expected Russian label with Pa·s, got {:?}", tps.iter().map(|t| &t.label).collect::<Vec<_>>());
    }

    #[test]
    fn touch_point_viscosity_kept_in_storage_unit() {
        // Algorithm reports viscosity at the crossing in mPa·s; wrapper must NOT convert.
        // stats.rs::write_touch_points_table applies display conversion at render.
        let tps = calculate_touch_points(&ramp_data(), &settings_with("SI_Pas"), false);
        let threshold_tp = tps.iter().find(|tp| tp.label.contains("Threshold"))
            .expect("threshold touch point present");
        // Value should be in mPa·s range (hundreds), NOT sub-1 Pa·s range.
        assert!(threshold_tp.viscosity >= 400.0 && threshold_tp.viscosity <= 600.0,
                "expected storage-unit value around 500 mPa·s, got {}", threshold_tp.viscosity);
    }
}
