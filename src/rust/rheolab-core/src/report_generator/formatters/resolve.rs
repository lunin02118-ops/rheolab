//! Per-category unit resolution for the stats table.
//!
//! Both the PDF and Excel stats tables need the same "which target
//! string do I use for each quantity?" decision tree.  The logic lives
//! here (not duplicated in each template) so there's exactly one place
//! to audit when the label <-> conversion contract changes.

use super::units::{get_k_unit, get_pv_unit, get_viscosity_unit, get_yp_unit};

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
pub fn resolve_units(input: &super::super::types::ReportInput) -> ResolvedUnits {
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
