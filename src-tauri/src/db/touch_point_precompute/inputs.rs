//! Input adapters — convert raw JSON points or columnar channels into the
//! algorithm's [`TouchPointInput`] type.

use rheolab_core::report_generator::touch_point::TouchPointInput;
use rheolab_core::types::RheoPoint;
use serde_json::Value;
use std::collections::HashMap;

/// Convert a slice of raw-point JSON objects (the shape stored on
/// `StoredExperiment.raw_points`) into the algorithm's input type.
///
/// `rheolab_core::types::RheoPoint` owns all the serde aliases so this
/// function tolerates both camelCase and snake_case field names that
/// various legacy importers produce.  Malformed entries are silently
/// skipped rather than failing the whole experiment's precompute.
pub fn to_touch_inputs(raw_points: &[Value]) -> Vec<TouchPointInput> {
    raw_points
        .iter()
        .filter_map(|v| serde_json::from_value::<RheoPoint>(v.clone()).ok())
        .map(|p| TouchPointInput {
            time_min: p.time_sec / 60.0,
            viscosity_cp: p.viscosity_cp,
            shear_rate: p.shear_rate.unwrap_or(0.0),
        })
        .collect()
}

/// Convert typed columnar channels (as produced by
/// [`crate::db::columnar::decode_typed`]) into the algorithm's input type.
///
/// Used by the backfill path, which reads the `ExperimentData` blob
/// directly — no JSON intermediary — so a few thousand rows backfill in
/// a handful of seconds rather than minutes.
///
/// The lookup is alias-tolerant: the columnar encoder stores channel
/// names verbatim from the source `raw_points` JSON, and two naming
/// conventions coexist in production data:
///   * **snake_case** (`time_sec` / `viscosity_cp` / `shear_rate_s1`) —
///     what the frontend persists today (see `parse-normalize.ts` and
///     `experiments/mappers.ts`).
///   * **camelCase** (`timeSec` / `viscosityCp` / `shearRate`) — legacy
///     shape from the WASM parser and the TypeScript ColumnarData type.
///
/// A missing time or viscosity channel (under any recognised alias)
/// yields an empty input vector; per-sample `None` values drop that
/// point rather than poisoning the downstream statistics.
pub fn to_touch_inputs_from_columns(
    channels: &HashMap<String, Vec<Option<f64>>>,
) -> Vec<TouchPointInput> {
    use crate::commands::experiments::helpers::{
        SHEAR_RATE_CHANNEL_ALIASES, TIME_CHANNEL_ALIASES, VISCOSITY_CHANNEL_ALIASES,
    };

    fn pick<'a>(
        channels: &'a HashMap<String, Vec<Option<f64>>>,
        aliases: &[&str],
    ) -> Option<&'a Vec<Option<f64>>> {
        aliases.iter().find_map(|name| channels.get(*name))
    }

    let Some(times) = pick(channels, TIME_CHANNEL_ALIASES) else {
        return Vec::new();
    };
    let Some(visc) = pick(channels, VISCOSITY_CHANNEL_ALIASES) else {
        return Vec::new();
    };
    let shear = pick(channels, SHEAR_RATE_CHANNEL_ALIASES);
    let len = times.len().min(visc.len());
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        let Some(time_sec) = times[i] else { continue };
        let Some(viscosity_cp) = visc[i] else {
            continue;
        };
        let shear_rate = shear
            .and_then(|s| s.get(i).copied().flatten())
            .unwrap_or(0.0);
        out.push(TouchPointInput {
            time_min: time_sec / 60.0,
            viscosity_cp,
            shear_rate,
        });
    }
    out
}
