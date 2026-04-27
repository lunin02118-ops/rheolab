//! Unit conversion + label helpers for the report formatter.
//!
//! Two parallel APIs live here:
//!
//! 1. **Legacy `unit_system`-keyed**: `convert_*` and `get_*_unit` functions
//!    that take a coarse `"SI"` / `"SI_Pas"` / `"Imperial"` enum string.
//!    Used by call sites that haven't migrated to per-category overrides.
//!
//! 2. **Target-unit-aware**: `render_*_with(value, target)` functions that
//!    do **both** numerical conversion and label resolution, honouring
//!    `settings.rheology_units` per-category overrides.  This is the
//!    direction every new caller should use.
//!
//! Conversion factors come from API RP 13D — the canonical drilling fluid
//! rheology spec — see ADR-0012 for the reasoning behind the K' factor
//! choice (2.0885 × Pa → lbf/100ft²) over the long-standing 47.88 bug.

use super::{decimals, excel_formats};

// ── Legacy unit_system-keyed converters and labels ─────────────────────

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

// ── Target-unit-aware formatters ──────────────────────────────────────
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
