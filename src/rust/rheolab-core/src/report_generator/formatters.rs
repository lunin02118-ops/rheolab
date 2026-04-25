//! Formatters
//! 
//! Number and unit formatting functions matching report-formatters.ts
//! 
//! ЕДИНЫЙ ИСТОЧНИК форматирования для PDF и Excel
//! Все значения должны форматироваться одинаково в обоих форматах!

/// Константы для количества знаков после запятой
/// ЕДИНЫЙ ИСТОЧНИК для PDF и Excel
pub mod decimals {
    /// Время (минуты): 1 знак после запятой
    pub const TIME: u32 = 1;
    /// Температура (°C): 1 знак
    pub const TEMPERATURE: u32 = 1;
    /// Давление (bar): 1 знак
    pub const PRESSURE: u32 = 1;
    /// n' (индекс поведения): 3 знака
    pub const N_PRIME: u32 = 3;
    /// K' (индекс консистенции): 4 знака
    pub const K_PRIME: u32 = 4;
    /// R² (коэффициент детерминации): 4 знака
    pub const R_SQUARED: u32 = 4;
    /// Вязкость при фиксированных скоростях сдвига (η@40, η@100, η@170)
    /// mPa·s / cP: 0 знаков, Pa·s: 4 знака
    pub const VISCOSITY_FIXED: u32 = 0;
    /// Вязкость в Pa·s: 4 знака после запятой
    pub const VISCOSITY_PAS: u32 = 4;
    /// PV (пластическая вязкость): 2 знака
    pub const PV: u32 = 2;
    /// YP (предел текучести): 1 знак
    pub const YP: u32 = 1;
    /// Bingham R²: 4 знака
    pub const BINGHAM_R2: u32 = 4;
    /// Анализ воды: 1 знак
    pub const WATER_PARAMS: u32 = 1;
    /// Калибровка R²: 6 знаков
    pub const CAL_R2: u32 = 6;
    /// Калибровка slope/intercept: 4 знака
    pub const CAL_SLOPE: u32 = 4;
    /// Калибровка hysteresis/stdev: 2 знака
    pub const CAL_HYST: u32 = 2;
}

/// Excel форматы для числовых ячеек
/// Соответствуют константам из decimals
pub mod excel_formats {
    pub const TIME: &str = "0.0";
    pub const TEMPERATURE: &str = "0.0";
    pub const PRESSURE: &str = "0.0";
    pub const N_PRIME: &str = "0.000";
    pub const K_PRIME: &str = "0.0000";
    pub const R_SQUARED: &str = "0.0000";
    /// Вязкость mPa·s / cP: 0 знаков
    pub const VISCOSITY_FIXED: &str = "0";
    /// Вязкость Pa·s: 4 знака
    pub const VISCOSITY_PAS: &str = "0.0000";
    pub const PV: &str = "0.00";
    pub const YP: &str = "0.0";
    pub const BINGHAM_R2: &str = "0.0000";
    pub const WATER_PARAMS: &str = "0.0";
    pub const DEFAULT: &str = "0.00";
}

/// Format number with specified decimal places
/// Matches formatNumber from TypeScript
pub fn format_number(value: Option<f64>, decimals: u32) -> String {
    match value {
        Some(v) if v.is_finite() => {
            format!("{:.prec$}", v, prec = decimals as usize)
        }
        _ => "-".to_string()
    }
}

/// Format number from f64 directly
pub fn format_number_direct(value: f64, decimals: u32) -> String {
    if value.is_finite() {
        format!("{:.prec$}", value, prec = decimals as usize)
    } else {
        "-".to_string()
    }
}

/// Convert consistency index K' based on unit system.
///
/// SI: Pa·sⁿ (keep as is)
/// Imperial: lbf·sⁿ/100ft² — K' has stress·time^n units, so the
/// conversion is Pa → lbf/100ft² (factor 2.0885), same direction as YP.
///
/// WARNING: older builds shipped with factor 47.88 (Pa → lbf/ft², off by
/// a factor of 100 from what the report label "lbf/100ft²" promises).
/// That was a long-standing physics bug — see ADR-0012 for the
/// reasoning and API RP 13D for the canonical conversion table.
pub fn convert_consistency_index(k_prime: f64, unit_system: &str) -> f64 {
    if unit_system == "Imperial" {
        k_prime * 2.0885
    } else {
        k_prime
    }
}

/// Convert PV based on unit system
/// SI: Pa·s (keep as is)
/// Imperial: cP (multiply by 1000)
pub fn convert_pv(pv: f64, unit_system: &str) -> f64 {
    if unit_system == "Imperial" {
        pv * 1000.0
    } else {
        pv
    }
}

/// Convert YP based on unit system
/// SI: Pa (keep as is)
/// Imperial: lbf/100ft² (multiply by 2.0885)
pub fn convert_yp(yp: f64, unit_system: &str) -> f64 {
    if unit_system == "Imperial" {
        yp * 2.0885
    } else {
        yp
    }
}

/// Get K' unit label.
///
/// For Imperial we use `lbf·s^n/100ft²` (NOT `lbf/100ft²` alone — that's
/// a stress unit, while K' has stress·time^n dimensions).  This matches
/// the TS `IMPERIAL_UNITS.consistency` constant in `chart-settings-defaults.ts`
/// and keeps the label dimensionally honest.
pub fn get_k_unit(unit_system: &str) -> &'static str {
    if unit_system == "Imperial" {
        "lbf·s^n/100ft²"
    } else {
        "Pa·s^n"
    }
}

/// Get PV unit label
pub fn get_pv_unit(unit_system: &str) -> &'static str {
    if unit_system == "Imperial" {
        "cP"
    } else {
        "Pa·s"
    }
}

/// Get YP unit label
pub fn get_yp_unit(unit_system: &str) -> &'static str {
    if unit_system == "Imperial" {
        "lbf/100ft²"
    } else {
        "Pa"
    }
}

/// Convert viscosity from mPa·s to target unit system
/// Input value is always in mPa·s (storage unit)
/// SI: keep as mPa·s (1:1)
/// SI_Pas: convert to Pa·s (divide by 1000)
/// Imperial: convert to cP (1:1, since 1 mPa·s = 1 cP)
pub fn convert_viscosity(viscosity_m_pas: f64, unit_system: &str) -> f64 {
    if unit_system == "SI_Pas" {
        viscosity_m_pas / 1000.0
    } else {
        // SI (mPa·s) and Imperial (cP) are 1:1 with mPa·s
        viscosity_m_pas
    }
}

/// Get viscosity unit label based on unit system
/// SI: "mPa·s", SI_Pas: "Pa·s", Imperial: "cP"
pub fn get_viscosity_unit(unit_system: &str) -> &'static str {
    match unit_system {
        "SI_Pas" => "Pa·s",
        "Imperial" => "cP",
        _ => "mPa·s", // SI (default)
    }
}

/// Get decimal places for viscosity based on unit system
/// mPa·s / cP: 0, Pa·s: 4
pub fn viscosity_decimals(unit_system: &str) -> u32 {
    if unit_system == "SI_Pas" {
        decimals::VISCOSITY_PAS
    } else {
        decimals::VISCOSITY_FIXED
    }
}

/// Get Excel format string for viscosity based on unit system
/// mPa·s / cP: "0", Pa·s: "0.0000"
pub fn viscosity_excel_format(unit_system: &str) -> &'static str {
    if unit_system == "SI_Pas" {
        excel_formats::VISCOSITY_PAS
    } else {
        excel_formats::VISCOSITY_FIXED
    }
}

/// Format date string from ISO format to locale format
pub fn format_date(date_str: &Option<String>, lang: &str) -> String {
    match date_str {
        Some(s) if !s.is_empty() => {
            // Try to parse ISO date
            let parts: Vec<&str> = s.split('T').next().unwrap_or(s).split('-').collect();
            if parts.len() == 3 {
                if lang == "ru" {
                    format!("{}.{}.{}", parts[2], parts[1], parts[0])
                } else {
                    format!("{}/{}/{}", parts[1], parts[2], parts[0])
                }
            } else {
                s.clone()
            }
        }
        _ => "-".to_string()
    }
}

// ─── Target-unit-aware formatters ──────────────────────────────────────
//
// These helpers take an explicit target-unit string (e.g. `"Pa·s^n"`,
// `"lbf·s^n/100ft²"`, `"cP"`) and do BOTH the numerical conversion AND
// pick the right label.  They honour `settings.rheology_units` — the
// per-category override that the UI stats table already uses — so the
// report walks away with exactly what the user sees on screen.
//
// The naming convention is `render_<quantity>_with(base_value, target)`
// → `(converted_value, canonical_label)`.  Unknown / empty targets
// fall back to the SI default for that quantity so legacy callers that
// haven’t migrated still produce sensible output.

/// Convert K' (stored in Pa·s^n) to the caller’s target unit.
///
/// Supported targets:
///   - `"Pa·s^n"` → no conversion, label `"Pa·s^n"`.
///   - `"lbf·s^n/100ft²"` → multiply by 2.0885 (Pa → lbf/100ft²).
///     Same factor as YP, dimensionally consistent with `get_k_unit`.
///   - anything else (empty string, unknown) → SI default.
pub fn render_k_with(k_pa_sn: f64, target: &str) -> (f64, &'static str) {
    match target {
        "lbf·s^n/100ft²" => (k_pa_sn * 2.0885, "lbf·s^n/100ft²"),
        "Pa·s^n" | "" => (k_pa_sn, "Pa·s^n"),
        _ => (k_pa_sn, "Pa·s^n"),
    }
}

/// Convert PV (stored in Pa·s) to the caller’s target unit.
///
/// Supported targets:
///   - `"Pa·s"` → no conversion.
///   - `"cP"` → multiply by 1000 (1 Pa·s = 1000 cP exactly).
///   - anything else → Pa·s.
pub fn render_pv_with(pv_pas: f64, target: &str) -> (f64, &'static str) {
    match target {
        "cP" => (pv_pas * 1000.0, "cP"),
        "Pa·s" | "" => (pv_pas, "Pa·s"),
        _ => (pv_pas, "Pa·s"),
    }
}

/// Convert YP (stored in Pa) to the caller’s target unit.
///
/// Supported targets:
///   - `"Pa"` → no conversion.
///   - `"lbf/100ft²"` → multiply by 2.0885 (API RP 13D).
///   - anything else → Pa.
pub fn render_yp_with(yp_pa: f64, target: &str) -> (f64, &'static str) {
    match target {
        "lbf/100ft²" => (yp_pa * 2.0885, "lbf/100ft²"),
        "Pa" | "" => (yp_pa, "Pa"),
        _ => (yp_pa, "Pa"),
    }
}

/// Convert viscosity (stored in mPa·s) to the caller’s target unit.
///
/// Supported targets:
///   - `"mPa·s"` → no conversion.
///   - `"Pa·s"` → divide by 1000.
///   - `"cP"` → 1:1 with mPa·s (centipoise is numerically identical).
///   - anything else → mPa·s.
pub fn render_viscosity_with(v_mpa_s: f64, target: &str) -> (f64, &'static str) {
    match target {
        "Pa·s" => (v_mpa_s / 1000.0, "Pa·s"),
        "cP" => (v_mpa_s, "cP"),
        "mPa·s" | "" => (v_mpa_s, "mPa·s"),
        _ => (v_mpa_s, "mPa·s"),
    }
}

/// Decimal places for viscosity rendering per target unit.
///
/// `Pa·s` needs 4 decimals because typical values are O(0.1–10) with
/// fine structure; `mPa·s` / `cP` use 0 decimals (values are O(100–1000)
/// and the grain there is 1 cP anyway).
pub fn viscosity_decimals_for(target: &str) -> u32 {
    match target {
        "Pa·s" => decimals::VISCOSITY_PAS,
        _ => decimals::VISCOSITY_FIXED,
    }
}

/// Excel number format for viscosity per target unit.
pub fn viscosity_excel_format_for(target: &str) -> &'static str {
    match target {
        "Pa·s" => excel_formats::VISCOSITY_PAS,
        _ => excel_formats::VISCOSITY_FIXED,
    }
}

// ─── Time rendering helpers ─────────────────────────────────────────────
//
// The UI chart X-axis and the stats table's `Время` column both respect
// `chartSettings.rheologyUnits.timeFormat` — one of `"seconds"`,
// `"minutes"`, or `"hh:mm:ss"`.  The report must match, otherwise the
// user sees a time in seconds on the chart and in minutes in the
// printed table — exactly the inconsistency flagged on 2026-04-22.
//
// All inputs are stored in **minutes** (the canonical base unit for
// `CycleResult.time_min`).  Output is a ready-to-print string.

/// Localised axis / header unit suffix for the time column.
///
/// Matches `timeAxisUnit()` in `src/hooks/chart-options/time-format.ts`.
pub fn time_axis_unit(time_format: &str, lang: &str) -> &'static str {
    match time_format {
        "seconds" => if lang == "en" { "sec" } else { "с" },
        "hh:mm:ss" => if lang == "en" { "hh:mm:ss" } else { "чч:мм:сс" },
        _ => if lang == "en" { "min" } else { "мин" },
    }
}

/// Format a time value (in minutes) for a stats table cell according to
/// the user's configured time format.  Mirrors the TS `formatTimeTick`
/// behaviour so the report and the on-screen axis read identically.
///
/// - `"seconds"`: `540` (integer seconds)
/// - `"hh:mm:ss"`: `00:09:00`
/// - anything else (`"minutes"`): `9.0` (1 decimal) or `9` (integer)
pub fn format_time_value(time_min: f64, time_format: &str) -> String {
    if !time_min.is_finite() {
        return "-".to_string();
    }
    match time_format {
        "seconds" => {
            let secs = (time_min * 60.0).round() as i64;
            secs.to_string()
        }
        "hh:mm:ss" => {
            let total = (time_min * 60.0).round() as i64;
            let h = total / 3600;
            let m = (total % 3600) / 60;
            let s = total % 60;
            format!("{:02}:{:02}:{:02}", h, m, s)
        }
        _ => {
            // "minutes" (and default): 1 decimal, strip trailing `.0`
            let rounded = (time_min * 10.0).round() / 10.0;
            if rounded.fract().abs() < f64::EPSILON {
                format!("{}", rounded as i64)
            } else {
                format!("{:.1}", rounded)
            }
        }
    }
}

// ─── Unit resolution (shared between PDF and Excel stats builders) ────
//
// Both the PDF and Excel stats tables need the same "which target
// string do I use for each quantity?" decision tree.  The logic lives
// here (not duplicated in each template) so there's exactly one place
// to audit when the label <-> conversion contract changes.

/// Resolved per-category unit targets used by the stats table.
///
/// * `use_targets == true` — call `render_<q>_with(value, &self.<q>)` for
///   conversion; the string in the field is the canonical label.
/// * `use_targets == false` — fall back to legacy `convert_<q>(value, unit_system)`
///   from the coarse `unit_system` enum; fields hold synthesised labels
///   so the header side still reads correctly without branching.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedUnits {
    pub use_targets: bool,
    pub k: String,
    pub pv: String,
    pub yp: String,
    pub viscosity: String,
    pub time_format: String,
}

/// Resolves the target-unit strings to use for each stats column.
///
/// Prefers `settings.rheology_units` when populated; otherwise
/// synthesises equivalent labels from the coarse `unit_system` enum so
/// legacy callers keep working.
///
/// Empty individual fields in `rheology_units` fall back to the
/// `unit_system`-derived label for that specific category — the schema
/// is deliberately lenient so partial overrides (e.g. "only set
/// viscosity") still produce sensible output.
pub fn resolve_units(input: &super::types::ReportInput) -> ResolvedUnits {
    let unit_system = input.settings.unit_system.as_str();

    if let Some(ru) = &input.settings.rheology_units {
        let k = if ru.consistency.is_empty() {
            get_k_unit(unit_system).to_string()
        } else {
            ru.consistency.clone()
        };
        let pv = if ru.plastic_viscosity.is_empty() {
            get_pv_unit(unit_system).to_string()
        } else {
            ru.plastic_viscosity.clone()
        };
        let yp = if ru.yield_point.is_empty() {
            get_yp_unit(unit_system).to_string()
        } else {
            ru.yield_point.clone()
        };
        let visc = if ru.viscosity.is_empty() {
            get_viscosity_unit(unit_system).to_string()
        } else {
            ru.viscosity.clone()
        };
        let time_fmt = if ru.time_format.is_empty() {
            "minutes".to_string()
        } else {
            ru.time_format.clone()
        };
        ResolvedUnits {
            use_targets: true,
            k,
            pv,
            yp,
            viscosity: visc,
            time_format: time_fmt,
        }
    } else {
        ResolvedUnits {
            use_targets: false,
            k: get_k_unit(unit_system).to_string(),
            pv: get_pv_unit(unit_system).to_string(),
            yp: get_yp_unit(unit_system).to_string(),
            viscosity: get_viscosity_unit(unit_system).to_string(),
            time_format: "minutes".to_string(),
        }
    }
}

/// Build ramp string from cycle steps
pub fn build_ramp_string(cycles: &[super::types::CycleInfo]) -> Option<String> {
    // Find first cycle with steps
    let target_cycle = cycles.iter().find(|c| !c.steps.is_empty())?;
    
    if target_cycle.steps.is_empty() {
        return None;
    }

    let rates: Vec<String> = target_cycle.steps
        .iter()
        .map(|s| format!("{}", s.avg_shear_rate.round() as i32))
        .collect();
    
    Some(rates.join(" - "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::types::{CycleInfo, StepInfo};

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
        assert_eq!(format_time_value(9.0, "seconds"), "540");      // 9 min → 540 s
        assert_eq!(format_time_value(9.5, "seconds"), "570");      // 9.5 min → 570 s
        assert_eq!(format_time_value(22.4, "seconds"), "1344");    // 22.4 min → 1344 s
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
        assert_eq!(format_time_value(22.4, "hh:mm:ss"), "00:22:24");   // 22:24
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

    fn input_with(unit_system: &str, rheology_units: Option<super::super::types::RheologyUnits>)
        -> super::super::types::ReportInput
    {
        use super::super::types::{ReportInput, ReportMetadata, ReportSettings};
        ReportInput {
            raw_data: vec![],
            metadata: ReportMetadata { filename: "t".into(), ..Default::default() },
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
        assert!(units.use_targets, "per-category override must take precedence");
        assert_eq!(units.k, "Pa·s^n",
            "K' label must follow rheology_units.consistency, NOT unit_system='Imperial'");
        assert_eq!(units.pv, "Pa·s",
            "PV label must follow rheology_units.plastic_viscosity, NOT get_pv_unit('Imperial')");
        assert_eq!(units.yp, "Pa",
            "YP label must follow rheology_units.yield_point, NOT get_yp_unit('Imperial')");
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
            plastic_viscosity: "cP".into(),   // unusual but legal
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
            viscosity: "cP".into(),            // set
            temperature: "".into(),
            pressure: "".into(),
            consistency: "".into(),             // empty → fall back to get_k_unit
            plastic_viscosity: "".into(),       // empty → fall back to get_pv_unit
            yield_point: "".into(),             // empty → fall back to get_yp_unit
            time_format: "".into(),             // empty → "minutes" default
        };
        let units = resolve_units(&input_with("Imperial", Some(ru)));
        assert!(units.use_targets, "presence of the struct (not fullness) flips use_targets");
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
        assert_eq!(format_date(&Some("2026-01-03".to_string()), "ru"), "03.01.2026");
        assert_eq!(format_date(&Some("2026-01-03".to_string()), "en"), "01/03/2026");
        assert_eq!(format_date(&None, "ru"), "-");
        assert_eq!(format_date(&Some("".to_string()), "en"), "-");
        assert_eq!(format_date(&Some("2026-01-03T12:30:00Z".to_string()), "ru"), "03.01.2026");
    }

    #[test]
    fn test_build_ramp_string() {
        let cycles = vec![CycleInfo {
            cycle_type: "ramp".to_string(),
            steps: vec![
                StepInfo { avg_shear_rate: 5.6 },
                StepInfo { avg_shear_rate: 100.0 },
                StepInfo { avg_shear_rate: 170.4 },
            ],
        }];
        assert_eq!(build_ramp_string(&cycles), Some("6 - 100 - 170".to_string()));
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
}
