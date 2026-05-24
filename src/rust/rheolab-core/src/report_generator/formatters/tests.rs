//! Tests for the formatters module.

use super::super::types::{CycleInfo, StepInfo};
use super::*;

#[test]
fn test_format_number() {
    assert_eq!(format_number(Some(123.456789), 2), "123.46");
    assert_eq!(format_number(Some(0.1234), 4), "0.1234");
    assert_eq!(format_number(None, 2), "-");
}

#[test]
fn test_format_number_direct() {
    assert_eq!(format_number_direct(3.14159, 2), "3.14");
    assert_eq!(format_number_direct(0.0, 3), "0.000");
    assert_eq!(format_number_direct(f64::NAN, 2), "-");
    assert_eq!(format_number_direct(f64::INFINITY, 1), "-");
}

#[test]
fn test_convert_k_prime() {
    assert_eq!(convert_consistency_index(1.0, "SI"), 1.0);
    // API RP 13D: 1 Pa = 2.0885 lbf/100ft², same factor as YP.  The
    // pre-2026-04-22 builds used 47.88 (Pa → lbf/ft²) which produced
    // values ~23× too large for the promised "lbf/100ft²" label.
    assert!(
        (convert_consistency_index(1.0, "Imperial") - 2.0885).abs() < 0.01,
        "K' Imperial conversion must use factor 2.0885 (Pa → lbf/100ft²), \
         NOT 47.88 (Pa → lbf/ft²)",
    );
}

#[test]
fn test_convert_pv() {
    assert_eq!(convert_pv(0.05, "SI"), 0.05);
    assert!((convert_pv(0.05, "Imperial") - 50.0).abs() < 0.01);
}

#[test]
fn test_convert_yp() {
    assert_eq!(convert_yp(10.0, "SI"), 10.0);
    assert!((convert_yp(10.0, "Imperial") - 20.885).abs() < 0.01);
}

#[test]
fn test_get_k_unit() {
    assert_eq!(get_k_unit("SI"), "Pa·s^n");
    // Imperial label must carry `·s^n` — K' is stress·time^n, NOT
    // a stress like YP.  Matches TS IMPERIAL_UNITS.consistency.
    assert_eq!(get_k_unit("Imperial"), "lbf·s^n/100ft²");
}

// ─── Target-unit-aware render_* helpers (per-category overrides) ───

#[test]
fn test_render_k_with_targets() {
    // SI target — no conversion.
    let (v, u) = render_k_with(10.4618, "Pa·s^n");
    assert!((v - 10.4618).abs() < 1e-9);
    assert_eq!(u, "Pa·s^n");

    // Imperial target — Pa → lbf/100ft² factor, same as YP.
    let (v, u) = render_k_with(10.4618, "lbf·s^n/100ft²");
    assert!((v - 10.4618 * 2.0885).abs() < 1e-6);
    assert_eq!(u, "lbf·s^n/100ft²");

    // Empty / unknown → SI fallback, never panics.
    let (v, u) = render_k_with(10.4618, "");
    assert!((v - 10.4618).abs() < 1e-9);
    assert_eq!(u, "Pa·s^n");
    let (_v, u) = render_k_with(1.0, "bogus");
    assert_eq!(u, "Pa·s^n");
}

#[test]
fn test_render_pv_with_targets() {
    // SI target.
    let (v, u) = render_pv_with(0.6157, "Pa·s");
    assert!((v - 0.6157).abs() < 1e-9);
    assert_eq!(u, "Pa·s");

    // Imperial target — cP = mPa·s, 1 Pa·s = 1000 cP exactly.
    let (v, u) = render_pv_with(0.6157, "cP");
    assert!((v - 615.7).abs() < 1e-3);
    assert_eq!(u, "cP");
}

#[test]
fn test_render_yp_with_targets() {
    let (v, u) = render_yp_with(49.03, "Pa");
    assert!((v - 49.03).abs() < 1e-9);
    assert_eq!(u, "Pa");

    let (v, u) = render_yp_with(49.03, "lbf/100ft²");
    assert!((v - 102.396).abs() < 0.01);
    assert_eq!(u, "lbf/100ft²");
}

#[test]
fn test_render_viscosity_with_targets() {
    // Base storage is mPa·s.
    let (v, u) = render_viscosity_with(1778.0, "mPa·s");
    assert!((v - 1778.0).abs() < 1e-9);
    assert_eq!(u, "mPa·s");

    // Pa·s path — divide by 1000.
    let (v, u) = render_viscosity_with(1778.0, "Pa·s");
    assert!((v - 1.778).abs() < 1e-9);
    assert_eq!(u, "Pa·s");

    // cP path — 1:1 with mPa·s, label changes.
    let (v, u) = render_viscosity_with(1778.0, "cP");
    assert!((v - 1778.0).abs() < 1e-9);
    assert_eq!(u, "cP");
}

#[test]
fn test_viscosity_decimals_for_targets() {
    assert_eq!(viscosity_decimals_for("mPa·s"), 0);
    assert_eq!(viscosity_decimals_for("cP"), 0);
    assert_eq!(viscosity_decimals_for("Pa·s"), 4);
    assert_eq!(viscosity_decimals_for(""), 0);
}

#[test]
fn test_viscosity_excel_format_for_targets() {
    assert_eq!(viscosity_excel_format_for("mPa·s"), "0");
    assert_eq!(viscosity_excel_format_for("cP"), "0");
    assert_eq!(viscosity_excel_format_for("Pa·s"), "0.0000");
}

// ─── Time rendering helpers ────────────────────────────────────────

#[test]
fn test_time_axis_unit_all_formats() {
    assert_eq!(time_axis_unit("seconds", "ru"), "с");
    assert_eq!(time_axis_unit("seconds", "en"), "sec");
    assert_eq!(time_axis_unit("minutes", "ru"), "мин");
    assert_eq!(time_axis_unit("minutes", "en"), "min");
    assert_eq!(time_axis_unit("hh:mm:ss", "ru"), "чч:мм:сс");
    assert_eq!(time_axis_unit("hh:mm:ss", "en"), "hh:mm:ss");
    // Unknown / empty → "minutes" default.
    assert_eq!(time_axis_unit("", "ru"), "мин");
    assert_eq!(time_axis_unit("bogus", "en"), "min");
}

#[test]
fn test_format_time_value_seconds() {
    assert_eq!(format_time_value(0.0, "seconds"), "0");
    assert_eq!(format_time_value(9.0, "seconds"), "540"); // 9 min → 540 s
    assert_eq!(format_time_value(9.5, "seconds"), "570"); // 9.5 min → 570 s
    assert_eq!(format_time_value(22.4, "seconds"), "1344"); // 22.4 min → 1344 s
    assert_eq!(format_time_value(f64::NAN, "seconds"), "-");
}

#[test]
fn test_format_time_value_minutes() {
    // Integer minutes — strip trailing `.0`.
    assert_eq!(format_time_value(9.0, "minutes"), "9");
    assert_eq!(format_time_value(35.0, "minutes"), "35");
    // Non-integer — 1 decimal.
    assert_eq!(format_time_value(22.4, "minutes"), "22.4");
    assert_eq!(format_time_value(9.9, "minutes"), "9.9");
}

#[test]
fn test_format_time_value_hhmmss() {
    assert_eq!(format_time_value(0.0, "hh:mm:ss"), "00:00:00");
    assert_eq!(format_time_value(9.0, "hh:mm:ss"), "00:09:00");
    assert_eq!(format_time_value(9.5, "hh:mm:ss"), "00:09:30");
    assert_eq!(format_time_value(22.4, "hh:mm:ss"), "00:22:24"); // 22:24
    assert_eq!(format_time_value(60.0, "hh:mm:ss"), "01:00:00");
    assert_eq!(format_time_value(72.5, "hh:mm:ss"), "01:12:30");
}

#[test]
fn test_format_time_value_default_falls_back_to_minutes() {
    // Unknown formats degrade to minutes so the report never prints
    // an empty / junk cell on a schema mismatch.
    assert_eq!(format_time_value(9.0, ""), "9");
    assert_eq!(format_time_value(9.0, "bogus"), "9");
}

// ─── resolve_units() — end-to-end preset validation ────────────────

fn input_with(
    unit_system: &str,
    rheology_units: Option<super::super::types::RheologyUnits>,
) -> super::super::types::ReportInput {
    use super::super::types::{ReportInput, ReportMetadata, ReportSettings};
    ReportInput {
        raw_data: vec![],
        metadata: ReportMetadata {
            filename: "t".into(),
            ..Default::default()
        },
        cycle_results: vec![],
        recipe: vec![],
        water_params: None,
        cycles: vec![],
        settings: ReportSettings {
            unit_system: unit_system.to_string(),
            rheology_units,
            ..Default::default()
        },
        chart_image_base64: None,
        axis_values: None,
    }
}

#[test]
fn resolve_units_legacy_si() {
    // No rheology_units — pure legacy path.  Every label comes from
    // the `unit_system` enum; `use_targets == false` tells downstream
    // code to call `convert_*(value, unit_system)` (NOT the
    // target-aware `render_*_with`) for numeric conversion.
    let units = resolve_units(&input_with("SI", None));
    assert!(!units.use_targets);
    assert_eq!(units.k, "Pa·s^n");
    assert_eq!(units.pv, "Pa·s");
    assert_eq!(units.yp, "Pa");
    assert_eq!(units.viscosity, "mPa·s");
    assert_eq!(units.time_format, "minutes");
}

#[test]
fn resolve_units_legacy_imperial_uses_new_labels() {
    // Regression guard: even on the legacy path the K' label must
    // carry `·s^n` (dimensionally correct).  Was `lbf/100ft²` alone
    // before 2026-04-22 and broke the "report matches API RP 13D" story.
    let units = resolve_units(&input_with("Imperial", None));
    assert!(!units.use_targets);
    assert_eq!(units.k, "lbf·s^n/100ft²");
    assert_eq!(units.pv, "cP");
    assert_eq!(units.yp, "lbf/100ft²");
    assert_eq!(units.viscosity, "cP");
}

#[test]
fn resolve_units_mixed_custom_preset_reproduces_user_ui() {
    // The exact preset the user has on screen in the 2026-04-22
    // screenshot: cP viscosity, but Pa·s^n / Pa·s / Pa for K' / PV /
    // YP — NOT a clean Imperial.  The report MUST reproduce these
    // labels and conversions, otherwise we're back to the
    // "report says lbf/100ft², UI says Pa·s^n" mismatch.
    let ru = super::super::types::RheologyUnits {
        viscosity: "cP".into(),
        temperature: "°C".into(),
        pressure: "bar".into(),
        consistency: "Pa·s^n".into(),
        plastic_viscosity: "Pa·s".into(),
        yield_point: "Pa".into(),
        time_format: "minutes".into(),
    };
    // unit_system is 'Imperial' (because viscosity is cP) but the
    // per-category overrides must win for K'/PV/YP.
    let units = resolve_units(&input_with("Imperial", Some(ru)));
    assert!(
        units.use_targets,
        "per-category override must take precedence"
    );
    assert_eq!(
        units.k, "Pa·s^n",
        "K' label must follow rheology_units.consistency, NOT unit_system='Imperial'"
    );
    assert_eq!(
        units.pv, "Pa·s",
        "PV label must follow rheology_units.plastic_viscosity, NOT get_pv_unit('Imperial')"
    );
    assert_eq!(
        units.yp, "Pa",
        "YP label must follow rheology_units.yield_point, NOT get_yp_unit('Imperial')"
    );
    assert_eq!(units.viscosity, "cP");
    assert_eq!(units.time_format, "minutes");
}

#[test]
fn resolve_units_mixed_seconds_time_format() {
    // Chart axis in seconds + K' in SI + PV in cP — an unusual
    // combo but must round-trip cleanly.  This locks in the time
    // format plumbing independent of the quantity labels.
    let ru = super::super::types::RheologyUnits {
        viscosity: "mPa·s".into(),
        temperature: "°C".into(),
        pressure: "bar".into(),
        consistency: "Pa·s^n".into(),
        plastic_viscosity: "cP".into(), // unusual but legal
        yield_point: "Pa".into(),
        time_format: "seconds".into(),
    };
    let units = resolve_units(&input_with("SI", Some(ru)));
    assert_eq!(units.pv, "cP");
    assert_eq!(units.time_format, "seconds");
}

#[test]
fn resolve_units_empty_fields_fall_back_per_category() {
    // Partial override — empty strings for the categories the caller
    // doesn't care about must fall back to the unit_system-derived
    // label individually (NOT disable the whole override).
    let ru = super::super::types::RheologyUnits {
        viscosity: "cP".into(), // set
        temperature: "".into(),
        pressure: "".into(),
        consistency: "".into(),       // empty → fall back to get_k_unit
        plastic_viscosity: "".into(), // empty → fall back to get_pv_unit
        yield_point: "".into(),       // empty → fall back to get_yp_unit
        time_format: "".into(),       // empty → "minutes" default
    };
    let units = resolve_units(&input_with("Imperial", Some(ru)));
    assert!(
        units.use_targets,
        "presence of the struct (not fullness) flips use_targets"
    );
    // Empty `consistency` → Imperial default (with fixed label).
    assert_eq!(units.k, "lbf·s^n/100ft²");
    assert_eq!(units.pv, "cP");
    assert_eq!(units.yp, "lbf/100ft²");
    // Explicit viscosity was set and must survive.
    assert_eq!(units.viscosity, "cP");
    assert_eq!(units.time_format, "minutes");
}

#[test]
fn resolve_units_hhmmss_time_with_si_quantities() {
    // Locks in the "Время (чч:мм:сс)" header path all the way from
    // settings.rheology_units.time_format.
    let ru = super::super::types::RheologyUnits {
        viscosity: "mPa·s".into(),
        temperature: "°C".into(),
        pressure: "bar".into(),
        consistency: "Pa·s^n".into(),
        plastic_viscosity: "Pa·s".into(),
        yield_point: "Pa".into(),
        time_format: "hh:mm:ss".into(),
    };
    let units = resolve_units(&input_with("SI", Some(ru)));
    assert_eq!(units.time_format, "hh:mm:ss");
    // And the time-axis-unit helper must agree on the canonical label.
    assert_eq!(time_axis_unit(&units.time_format, "ru"), "чч:мм:сс");
    assert_eq!(time_axis_unit(&units.time_format, "en"), "hh:mm:ss");
}

#[test]
fn test_get_pv_unit() {
    assert_eq!(get_pv_unit("SI"), "Pa·s");
    assert_eq!(get_pv_unit("Imperial"), "cP");
}

#[test]
fn test_get_yp_unit() {
    assert_eq!(get_yp_unit("SI"), "Pa");
    assert_eq!(get_yp_unit("Imperial"), "lbf/100ft²");
}

#[test]
fn test_convert_viscosity() {
    // SI (mPa·s) — no conversion
    assert_eq!(convert_viscosity(150.0, "SI"), 150.0);
    // SI_Pas — divide by 1000
    assert!((convert_viscosity(150.0, "SI_Pas") - 0.15).abs() < 1e-10);
    // Imperial (cP) — 1:1 with mPa·s
    assert_eq!(convert_viscosity(150.0, "Imperial"), 150.0);
}

#[test]
fn test_get_viscosity_unit() {
    assert_eq!(get_viscosity_unit("SI"), "mPa·s");
    assert_eq!(get_viscosity_unit("SI_Pas"), "Pa·s");
    assert_eq!(get_viscosity_unit("Imperial"), "cP");
}

#[test]
fn test_viscosity_decimals() {
    assert_eq!(viscosity_decimals("SI"), 0);
    assert_eq!(viscosity_decimals("SI_Pas"), 4);
    assert_eq!(viscosity_decimals("Imperial"), 0);
}

#[test]
fn test_viscosity_excel_format() {
    assert_eq!(viscosity_excel_format("SI"), "0");
    assert_eq!(viscosity_excel_format("SI_Pas"), "0.0000");
    assert_eq!(viscosity_excel_format("Imperial"), "0");
}

#[test]
fn test_format_date() {
    assert_eq!(
        format_date(&Some("2026-01-03".to_string()), "ru"),
        "03.01.2026"
    );
    assert_eq!(
        format_date(&Some("2026-01-03".to_string()), "en"),
        "01/03/2026"
    );
    assert_eq!(format_date(&None, "ru"), "-");
    assert_eq!(format_date(&Some("".to_string()), "en"), "-");
    assert_eq!(
        format_date(&Some("2026-01-03T12:30:00Z".to_string()), "ru"),
        "03.01.2026"
    );
}

#[test]
fn test_build_ramp_string() {
    let cycles = vec![CycleInfo {
        cycle_type: "ramp".to_string(),
        steps: vec![
            StepInfo {
                avg_shear_rate: 5.6,
            },
            StepInfo {
                avg_shear_rate: 100.0,
            },
            StepInfo {
                avg_shear_rate: 170.4,
            },
        ],
    }];
    assert_eq!(
        build_ramp_string(&cycles),
        Some("6 - 100 - 170".to_string())
    );
}

#[test]
fn test_build_ramp_string_empty() {
    let cycles: Vec<CycleInfo> = vec![];
    assert_eq!(build_ramp_string(&cycles), None);

    let empty_cycle = vec![CycleInfo {
        cycle_type: "ramp".to_string(),
        steps: vec![],
    }];
    assert_eq!(build_ramp_string(&empty_cycle), None);
}
