//! Touch-point precompute — library-filter fast-path.
//!
//! The experiment-library filter sidebar needs to answer queries such as
//! *"find every experiment whose smoothed viscosity crossed 50 cP between
//! minute 6 and minute 8"* for a library that may hold thousands of rows.
//! Running the smart-touch-point algorithm on demand would mean decoding
//! every experiment's columnar blob on every filter change, which does not
//! scale.
//!
//! To solve this, the `Experiment` table carries five precomputed columns
//! (added in migration `v0002_touch_point_metrics`):
//!
//! | Column                         | Meaning                                             |
//! | ------------------------------ | --------------------------------------------------- |
//! | `touchHasCrossing`             | 1 = crossing found, 0 = no crossing, NULL = pending |
//! | `touchCrossingTimeMin`         | Time (minutes) of the crossing — NULL when absent   |
//! | `touchCrossingViscosityCp`     | Viscosity (cP) at the crossing instant              |
//! | `touchViscosityAtTargetCp`     | Viscosity (cP) at `LIBRARY_TARGET_TIME_MIN`         |
//! | `touchPrecomputeVersion`       | Algorithm schema version that wrote the four above  |
//!
//! These columns are populated by two paths:
//!   1. **Save-path** (`update_touch_point_row`) — called from
//!      `persist_experiment` so new/updated experiments get their values
//!      set inside the same transaction as the insert.
//!   2. **Startup backfill** (`run_touch_point_backfill`) — walks the rows
//!      where `touchPrecomputeVersion IS NULL` and fills them in after the
//!      migration has added the columns to a pre-existing database.
//!
//! Both paths use the *fixed library contract*:
//! `threshold = 50 cP`, `target_time = 10 min`.  The user's
//! Analysis-tab threshold is NOT used here — the library filter is
//! intentionally constant across users and sessions.
//!
//! If the algorithm's output could change for the same input (new bug fix,
//! reworked smoothing, etc.), bump `TOUCH_PRECOMPUTE_VERSION` so the next
//! startup re-runs the backfill on every row.

use crate::db::migrations::v0003_multi_threshold_touch_point::LIBRARY_TOUCH_THRESHOLDS_CP;
use rheolab_core::report_generator::touch_point::{
    calculate_smart_touch_points, SmartTouchPointOptions, TouchPointInput, TouchPointType,
};
use rheolab_core::types::RheoPoint;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use std::collections::HashMap;

/// Algorithm schema version stored in `Experiment.touchPrecomputeVersion`.
///
/// Bump whenever a change to the smart-touch-point algorithm could produce
/// a different output for the same input — startup backfill will then
/// re-run for every row whose stored version is `< TOUCH_PRECOMPUTE_VERSION`
/// (see [`run_touch_point_backfill`]) so all results stay consistent.
///
/// ## Version history
///
/// * **v1** — initial contract (`threshold = 50 cP`, `target_time = 10 min`).
/// * **v2** — alias-tolerant channel lookup in
///   [`to_touch_inputs_from_columns`].  Rows persisted by v1 silently
///   produced `has_crossing = false` for experiments whose raw_points use
///   snake_case keys (the real production shape, see
///   `src/lib/parsing/parse-normalize.ts` and
///   `src/lib/experiments/mappers.ts`).  The bump here forces a one-time
///   re-precompute on next startup.
/// * **v3** — forced re-precompute after Bug #3/4 fixes (per-iteration
///   connection release + SAVEPOINT atomicity).  Rows written by the
///   buggy v2 backfill may contain all-zero hasCrossing due to connection
///   starvation or partial writes; bumping forces a clean re-compute.
/// * **v4** — backward-walk fix: crossing marker now sits at the actual
///   raw crossing point instead of the delayed smoothed-curve crossing.
///   `crossingTimeMin` values shift earlier for many experiments.
pub const TOUCH_PRECOMPUTE_VERSION: i64 = 4;

/// Library-filter threshold — always in centipoise.  The UI label must
/// reflect this so the user cannot mistake it for their dynamic
/// Analysis-tab threshold.
pub const LIBRARY_THRESHOLD_CP: f64 = 50.0;

/// Library-filter target time — always in minutes.  Paired with
/// [`LIBRARY_THRESHOLD_CP`] as the *fixed library contract*.
pub const LIBRARY_TARGET_TIME_MIN: f64 = 10.0;

/// Outcome of a single precompute pass.  All four numeric fields are
/// `Option` because the algorithm may return only one of the two touch
/// points (or none at all) depending on the curve shape.
#[derive(Debug, Clone, PartialEq)]
pub struct PrecomputedTouchPoint {
    pub has_crossing: bool,
    pub crossing_time_min: Option<f64>,
    pub crossing_viscosity_cp: Option<f64>,
    pub viscosity_at_target_cp: Option<f64>,
}

impl PrecomputedTouchPoint {
    /// Placeholder used when the experiment has no usable points.
    /// `touchPrecomputeVersion` is still written so startup backfill does
    /// not keep retrying an empty row on every launch.
    pub const fn empty() -> Self {
        Self {
            has_crossing: false,
            crossing_time_min: None,
            crossing_viscosity_cp: None,
            viscosity_at_target_cp: None,
        }
    }
}

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
        let Some(viscosity_cp) = visc[i] else { continue };
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

/// Run the smart-touch-point algorithm with a CUSTOM viscosity threshold
/// (in centipoise) and the fixed library target time (10 min).
///
/// Used by the library-filter **slow path**: when the user specifies a
/// per-query threshold (e.g. 500 cP for a crosslinked gel break-point)
/// we re-run the algorithm against each candidate experiment instead of
/// consulting the precomputed 50 cP columns.  The ramp / spike filtering
/// stays identical — only the `viscosity_threshold` option changes.
///
/// Returns `None` only when the input slice is empty; an absent crossing
/// still produces `Some(result)` with the `crossing_*` fields as `None`.
pub fn compute_from_inputs_with_threshold(
    inputs: &[TouchPointInput],
    viscosity_threshold_cp: f64,
) -> Option<PrecomputedTouchPoint> {
    if inputs.is_empty() {
        return None;
    }

    let options = SmartTouchPointOptions {
        viscosity_threshold: viscosity_threshold_cp,
        show_target_time: true,
        target_time: LIBRARY_TARGET_TIME_MIN,
        ..SmartTouchPointOptions::default()
    };

    let results = calculate_smart_touch_points(inputs, &options);

    let threshold = results
        .iter()
        .find(|r| r.tp_type == TouchPointType::Threshold);
    let target = results.iter().find(|r| r.tp_type == TouchPointType::Target);

    // "Started below threshold" guard — the core algorithm only sees
    // the threshold crossing itself, not the larger question of whether
    // a gel phase ever existed.  A curve that never rose ABOVE the
    // threshold has no gel-break to report: any "crossing" we see would
    // be the ramp-up leg clipping through on its way up, which is
    // physically meaningless to the lab researcher.
    //
    // We mirror the same check in `list::dynamic::query_with_dynamic_
    // threshold` so fast-path (precomputed) and slow-path (on-the-fly)
    // agree row-for-row.
    let (has_crossing, crossing_time_min, crossing_viscosity_cp) = match threshold {
        Some(r) => {
            let max_viscosity = inputs
                .iter()
                .map(|p| p.viscosity_cp)
                .fold(f64::NEG_INFINITY, f64::max);
            if max_viscosity.is_finite() && max_viscosity > viscosity_threshold_cp {
                (true, Some(r.time), Some(r.viscosity))
            } else {
                (false, None, None)
            }
        }
        None => (false, None, None),
    };

    Some(PrecomputedTouchPoint {
        has_crossing,
        crossing_time_min,
        crossing_viscosity_cp,
        viscosity_at_target_cp: target.map(|r| r.viscosity),
    })
}

/// Run the smart-touch-point algorithm under the fixed library contract
/// (`threshold = 50 cP`, `target_time = 10 min`) on the given inputs.
///
/// Thin wrapper over [`compute_from_inputs_with_threshold`] preserved for
/// the save-path / startup-backfill callers that persist results into
/// the legacy precomputed columns.
pub fn compute_from_inputs(inputs: &[TouchPointInput]) -> Option<PrecomputedTouchPoint> {
    compute_from_inputs_with_threshold(inputs, LIBRARY_THRESHOLD_CP)
}

/// UPDATE the touch-point columns for one experiment — legacy v0002
/// columns AND the new v0003 `TouchPointPrecompute` side table.
///
/// Called from the save-path.  Always writes `touchPrecomputeVersion`
/// even when the experiment has no usable points, so startup backfill
/// does not keep re-scanning these rows forever.
///
/// For the v0003 side table we compute one row per entry of
/// [`LIBRARY_TOUCH_THRESHOLDS_CP`] (5/10/50/100/200/300/500/700 cP) in
/// one pass so every sidebar preset can be served via the indexed
/// fast path.
pub fn update_touch_point_row(
    conn: &Connection,
    experiment_id: &str,
    raw_points: &[Value],
) -> rusqlite::Result<()> {
    let inputs = to_touch_inputs(raw_points);
    write_all_thresholds(conn, experiment_id, &inputs)
}

/// Persist the legacy 50 cP columns AND all [`LIBRARY_TOUCH_THRESHOLDS_CP`]
/// rows for a single experiment.
///
/// All writes are wrapped in a `SAVEPOINT` so concurrent readers never
/// see an experiment with only some thresholds written — e.g. threshold
/// 50 present but threshold 10 still missing.  `SAVEPOINT` (rather than
/// bare `BEGIN`) is safe when called inside an outer transaction (the
/// save-path wraps the whole persist in one).
///
/// Uses `INSERT OR REPLACE` per threshold so re-saving an experiment
/// overwrites stale values (e.g. after the user edits raw points
/// in-place).  The legacy v0002 columns keep receiving 50 cP data so
/// read paths that haven't migrated to the side table continue to work.
fn write_all_thresholds(
    conn: &Connection,
    experiment_id: &str,
    inputs: &[TouchPointInput],
) -> rusqlite::Result<()> {
    conn.execute_batch("SAVEPOINT tpp_write")?;

    let result = (|| -> rusqlite::Result<()> {
        // 1. Legacy columns — always 50 cP.
        let legacy = compute_from_inputs(inputs).unwrap_or_else(PrecomputedTouchPoint::empty);
        write_legacy_row(conn, experiment_id, &legacy)?;

        // 2. Side table — one row per preset threshold.  Prepared once and
        //    reused so the per-row binding cost stays negligible even when
        //    the library-scale backfill pushes through millions of rows.
        let mut stmt = conn.prepare_cached(
            "INSERT OR REPLACE INTO TouchPointPrecompute \
               (experimentId, thresholdCp, hasCrossing, crossingTimeMin, \
                crossingViscosityCp, viscosityAtTargetCp, precomputeVersion) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;
        for &threshold_cp in LIBRARY_TOUCH_THRESHOLDS_CP {
            let result = compute_from_inputs_with_threshold(inputs, threshold_cp)
                .unwrap_or_else(PrecomputedTouchPoint::empty);
            stmt.execute(params![
                experiment_id,
                threshold_cp as i64,
                result.has_crossing as i64,
                result.crossing_time_min,
                result.crossing_viscosity_cp,
                result.viscosity_at_target_cp,
                TOUCH_PRECOMPUTE_VERSION,
            ])?;
        }
        Ok(())
    })();

    match result {
        Ok(()) => {
            conn.execute_batch("RELEASE tpp_write")?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK TO tpp_write");
            let _ = conn.execute_batch("RELEASE tpp_write");
            Err(e)
        }
    }
}

/// Lower-level write of just the legacy v0002 columns on `Experiment`.
/// Kept as a standalone helper so the backfill path can reuse it when
/// decoding fails (we still want to mark the row as "computed" so it
/// doesn't get re-scanned on every launch).
fn write_legacy_row(
    conn: &Connection,
    experiment_id: &str,
    result: &PrecomputedTouchPoint,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE Experiment SET \
           touchHasCrossing = ?1, \
           touchCrossingTimeMin = ?2, \
           touchCrossingViscosityCp = ?3, \
           touchViscosityAtTargetCp = ?4, \
           touchPrecomputeVersion = ?5 \
         WHERE id = ?6",
        params![
            result.has_crossing as i64,
            result.crossing_time_min,
            result.crossing_viscosity_cp,
            result.viscosity_at_target_cp,
            TOUCH_PRECOMPUTE_VERSION,
            experiment_id,
        ],
    )?;
    Ok(())
}

/// Empty side-table rows for every preset threshold.  Used by backfill
/// when the blob is missing / corrupt — we still need the 8 rows to
/// exist so the JOIN in `list/query.rs` doesn't drop the experiment
/// from filtered results (it treats missing rows as "no data yet" and
/// shows them under `hasCrossing = NULL`).
fn write_all_thresholds_empty(conn: &Connection, experiment_id: &str) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare_cached(
        "INSERT OR REPLACE INTO TouchPointPrecompute \
           (experimentId, thresholdCp, hasCrossing, crossingTimeMin, \
            crossingViscosityCp, viscosityAtTargetCp, precomputeVersion) \
         VALUES (?1, ?2, 0, NULL, NULL, NULL, ?3)",
    )?;
    for &threshold_cp in LIBRARY_TOUCH_THRESHOLDS_CP {
        stmt.execute(params![experiment_id, threshold_cp as i64, TOUCH_PRECOMPUTE_VERSION])?;
    }
    Ok(())
}

/// Maximum number of rows processed per backfill invocation.
///
/// Chosen to keep the startup latency below ~2 seconds on a typical
/// developer machine.  The next startup will pick up where the previous
/// one left off because rows with `touchPrecomputeVersion` already set
/// are filtered out by the scan query.
const BACKFILL_BATCH_LIMIT: usize = 500;

/// Outcome of one backfill invocation.
#[derive(Debug, Clone, Default)]
pub struct BackfillStats {
    /// Number of experiments for which the precompute succeeded (including
    /// no-crossing results).
    pub processed: usize,
    /// Number of experiments skipped due to missing or undecodable data.
    pub skipped: usize,
    /// Whether more rows may still need backfill — call again on the
    /// next startup (or drive a loop within this one).
    pub has_more: bool,
}

/// Run one batch of touch-point backfill, capped at
/// [`BACKFILL_BATCH_LIMIT`] rows.
///
/// Picks experiments where the side table either has fewer than
/// [`LIBRARY_TOUCH_THRESHOLDS_CP`]`.len()` rows, or has at least one row
/// stamped with an outdated `precomputeVersion`.  That covers three
/// scenarios in one scan:
///   1. Brand-new rows whose save-path wrote nothing yet (fresh install
///      migrating a pre-v0003 database).
///   2. Rows that were seeded by the v0003 migration itself (legacy 50
///      cP only) — the remaining 7 thresholds are missing.
///   3. Rows whose algorithm output is stale because `TOUCH_PRECOMPUTE_
///      VERSION` was bumped after an algorithm fix.
///
/// Errors from individual rows (malformed JSON, corrupt blob, …) are
/// logged at `WARN` and counted as `skipped` so the scan always moves
/// forward; only a catastrophic connection failure bubbles up.
pub fn run_touch_point_backfill(conn: &Connection) -> rusqlite::Result<BackfillStats> {
    let pending: Vec<String> = {
        let expected_count = LIBRARY_TOUCH_THRESHOLDS_CP.len() as i64;
        // The GROUP BY below does the heavy lifting:
        //   * COUNT(tpp.thresholdCp) reveals incomplete backfills.
        //   * MIN(precomputeVersion) catches stale rows — if any single
        //     preset is below CURRENT, the whole row re-enters the
        //     queue so the algorithm stays consistent across presets.
        let mut stmt = conn.prepare(
            "SELECT e.id FROM Experiment e \
             LEFT JOIN TouchPointPrecompute tpp ON tpp.experimentId = e.id \
             GROUP BY e.id \
             HAVING COUNT(tpp.thresholdCp) < ?1 \
                 OR COALESCE(MIN(tpp.precomputeVersion), 0) < ?2 \
             ORDER BY e.createdAt DESC \
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(
            params![
                expected_count,
                TOUCH_PRECOMPUTE_VERSION,
                BACKFILL_BATCH_LIMIT as i64
            ],
            |row| row.get(0),
        )?;
        rows.collect::<rusqlite::Result<Vec<_>>>()?
    };

    let mut stats = BackfillStats::default();
    if pending.is_empty() {
        return Ok(stats);
    }

    for id in &pending {
        match precompute_single(conn, id) {
            Ok(()) => stats.processed += 1,
            Err(e) => {
                tracing::warn!(
                    "touch-point backfill: skipping experiment {} — {}",
                    id,
                    e
                );
                // Even on error we still mark the row as "computed" with
                // empty values (legacy columns + all preset side rows),
                // otherwise every startup retries it endlessly.
                let _ = write_legacy_row(conn, id, &PrecomputedTouchPoint::empty());
                let _ = write_all_thresholds_empty(conn, id);
                stats.skipped += 1;
            }
        }
    }

    // If we filled the whole batch, there may still be more pending rows.
    stats.has_more = pending.len() == BACKFILL_BATCH_LIMIT;
    Ok(stats)
}

/// Inner per-row backfill — decodes the columnar blob, runs the algorithm
/// for every preset threshold, and writes both legacy columns and side
/// table rows.  Any failure short-circuits with an error so the outer
/// loop can count the row as skipped and keep making progress.
fn precompute_single(conn: &Connection, experiment_id: &str) -> rusqlite::Result<()> {
    let blob: Option<Vec<u8>> = conn
        .query_row(
            "SELECT dataBlob FROM ExperimentData WHERE experimentId = ?1",
            params![experiment_id],
            |row| row.get(0),
        )
        .optional()?;

    let inputs = match blob {
        Some(bytes) if !bytes.is_empty() => {
            // decode_typed returns a map so a single channel never drags
            // the whole blob into a serde_json::Value tree.
            match crate::db::columnar::decode_typed(&bytes) {
                Ok(channels) => to_touch_inputs_from_columns(&channels),
                Err(e) => {
                    return Err(rusqlite::Error::ToSqlConversionFailure(
                        format!("columnar decode failed: {}", e).into(),
                    ));
                }
            }
        }
        _ => Vec::new(),
    };

    write_all_thresholds(conn, experiment_id, &inputs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn synthetic_crossing_points() -> Vec<Value> {
        // Linear decline 200 → 10 cP over 0..12 min at a constant shear
        // rate of 511 s⁻¹.  Crossing through 50 cP occurs near t = 9.5 min.
        let n = 121;
        let start = 200.0;
        let end = 10.0;
        (0..n)
            .map(|i| {
                let t = i as f64 * 6.0; // seconds, 0-720
                let visc = start + (end - start) * (i as f64 / (n - 1) as f64);
                json!({
                    "timeSec": t,
                    "viscosityCp": visc,
                    "shearRate": 511.0,
                    "temperatureC": 70.0,
                })
            })
            .collect()
    }

    fn synthetic_no_crossing_points() -> Vec<Value> {
        // Flat 150 cP curve that runs past the 10-min library target so
        // the algorithm can still emit a target-time viscosity even when
        // the 50 cP threshold is never hit.  0..12 min, 10 s step.
        (0..=72)
            .map(|i| {
                json!({
                    "timeSec": (i as f64) * 10.0,
                    "viscosityCp": 150.0,
                    "shearRate": 511.0,
                    "temperatureC": 70.0,
                })
            })
            .collect()
    }

    #[test]
    fn compute_from_inputs_returns_none_for_empty_input() {
        assert!(compute_from_inputs(&[]).is_none());
    }

    #[test]
    fn synthetic_crossing_is_detected() {
        let raw = synthetic_crossing_points();
        let inputs = to_touch_inputs(&raw);
        let out = compute_from_inputs(&inputs).expect("non-empty input yields Some");

        assert!(out.has_crossing, "linear decline should cross 50 cP");
        let time = out.crossing_time_min.expect("crossing time present");
        assert!(
            (7.0..=12.0).contains(&time),
            "crossing time must land inside the declining window, got {time}"
        );
        let vcp = out
            .crossing_viscosity_cp
            .expect("crossing viscosity present");
        assert!(
            vcp < 100.0,
            "crossing viscosity should be near the 50 cP target, got {vcp}"
        );
    }

    #[test]
    fn flat_curve_produces_no_crossing_but_still_writes_target() {
        let raw = synthetic_no_crossing_points();
        let inputs = to_touch_inputs(&raw);
        let out = compute_from_inputs(&inputs).expect("flat input is still non-empty");

        assert!(!out.has_crossing);
        assert!(out.crossing_time_min.is_none());
        assert!(out.crossing_viscosity_cp.is_none());
        // Target-time viscosity should be populated — the 10-min mark
        // lives inside the sample range and the value is ~150 cP.
        let target = out
            .viscosity_at_target_cp
            .expect("target-time viscosity present");
        assert!(
            (100.0..=200.0).contains(&target),
            "target viscosity should reflect the flat curve, got {target}"
        );
    }

    #[test]
    fn to_touch_inputs_tolerates_malformed_entries() {
        let raw = vec![
            json!({ "timeSec": 0.0, "viscosityCp": 100.0, "shearRate": 511.0 }),
            json!({ "not a point": true }),
            json!({ "timeSec": 60.0, "viscosityCp": 80.0, "shearRate": 511.0 }),
        ];
        let inputs = to_touch_inputs(&raw);
        // Malformed entries deserialise to RheoPoint::default() (time_sec=0,
        // viscosity=0) because every field is `#[serde(default)]`, so we do
        // get three points back — but the two real ones must still carry
        // their original values.
        assert_eq!(inputs.len(), 3);
        assert_eq!(inputs[0].time_min, 0.0);
        assert_eq!(inputs[0].viscosity_cp, 100.0);
        assert_eq!(inputs[2].time_min, 1.0);
        assert_eq!(inputs[2].viscosity_cp, 80.0);
    }

    #[test]
    fn to_touch_inputs_from_columns_handles_missing_shear_rate() {
        let mut channels: HashMap<String, Vec<Option<f64>>> = HashMap::new();
        channels.insert(
            "timeSec".to_string(),
            vec![Some(0.0), Some(60.0), Some(120.0)],
        );
        channels.insert(
            "viscosityCp".to_string(),
            vec![Some(100.0), Some(80.0), Some(40.0)],
        );
        let inputs = to_touch_inputs_from_columns(&channels);

        assert_eq!(inputs.len(), 3);
        for p in &inputs {
            assert_eq!(p.shear_rate, 0.0, "missing shearRate must fall back to 0.0");
        }
    }

    #[test]
    fn to_touch_inputs_from_columns_returns_empty_without_required_channels() {
        let mut channels: HashMap<String, Vec<Option<f64>>> = HashMap::new();
        channels.insert("temperatureC".to_string(), vec![Some(70.0)]);
        let inputs = to_touch_inputs_from_columns(&channels);
        assert!(
            inputs.is_empty(),
            "missing timeSec / viscosityCp must yield an empty input vector"
        );
    }

    #[test]
    fn empty_precompute_result_has_has_crossing_false() {
        let e = PrecomputedTouchPoint::empty();
        assert!(!e.has_crossing);
        assert!(e.crossing_time_min.is_none());
        assert!(e.crossing_viscosity_cp.is_none());
        assert!(e.viscosity_at_target_cp.is_none());
    }

    #[test]
    fn to_touch_inputs_from_columns_accepts_snake_case_channels() {
        // Real persisted experiments carry snake_case channel names
        // (time_sec / viscosity_cp / shear_rate_s1) — the columnar encoder
        // preserves the JSON keys verbatim. The lookup must recognise them
        // or the slow-path filter collapses every row to has_crossing=false.
        let mut channels: HashMap<String, Vec<Option<f64>>> = HashMap::new();
        channels.insert(
            "time_sec".to_string(),
            vec![Some(0.0), Some(60.0), Some(120.0)],
        );
        channels.insert(
            "viscosity_cp".to_string(),
            vec![Some(200.0), Some(150.0), Some(40.0)],
        );
        channels.insert(
            "shear_rate_s1".to_string(),
            vec![Some(511.0), Some(511.0), Some(511.0)],
        );
        let inputs = to_touch_inputs_from_columns(&channels);
        assert_eq!(inputs.len(), 3, "snake_case channels must be recognised");
        assert_eq!(inputs[0].viscosity_cp, 200.0);
        assert_eq!(inputs[1].time_min, 1.0);
        assert_eq!(inputs[2].shear_rate, 511.0);
    }

    #[test]
    fn backfill_reprocesses_rows_with_outdated_precompute_version() {
        // A row written by a previous algorithm version (with a bogus
        // has_crossing=false verdict) must be picked up by the backfill
        // so the v2 alias-tolerant lookup can correct the result.
        use crate::db::migration::run_migrations;

        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();

        // Seed the parent User row — Experiment.userId is NOT NULL with
        // FK → User(id), so a bare-minimum row gives the INSERT a target.
        conn.execute(
            "INSERT INTO User (id, name, email, role, isActive, createdAt, updatedAt) \
             VALUES ('test-user', 'Test User', 'test@example.com', 'admin', 1, \
                     '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')",
            [],
        )
        .unwrap();

        // Seed a minimal Experiment row — NOT NULL fields only.
        conn.execute(
            "INSERT INTO Experiment \
               (id, createdAt, updatedAt, originalFilename, testDate, instrumentType, \
                waterSource, fluidType, testGroup, name, rawPoints, metrics, userId, \
                touchPrecomputeVersion, touchHasCrossing) \
             VALUES (?1, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', \
                     'tp_stale.csv', '2024-01-01', 'BSL R1', \
                     'Well', 'Linear', 'Rheology', 'stale-v1', '[]', '{}', 'test-user', \
                     ?2, 0)",
            params!["exp_stale_v1", TOUCH_PRECOMPUTE_VERSION - 1],
        )
        .unwrap();

        // Seed a blob whose channel names are snake_case (production shape).
        let raw_points: Vec<Value> = (0..=120)
            .map(|i| {
                let t = i as f64 * 6.0;
                let frac = (i as f64) / 120.0;
                let v = 200.0 + (10.0 - 200.0) * frac;
                json!({
                    "time_sec": t,
                    "viscosity_cp": v,
                    "shear_rate_s1": 511.0,
                    "temperature_c": 70.0,
                })
            })
            .collect();
        let blob = crate::db::columnar::encode(&raw_points).unwrap();
        conn.execute(
            "INSERT INTO ExperimentData \
               (experimentId, dataBlob, encoding, pointCount, createdAt, updatedAt) \
             VALUES (?1, ?2, 'columnar-v1-zstd', ?3, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')",
            params!["exp_stale_v1", blob, raw_points.len() as i64],
        )
        .unwrap();

        // Running backfill must target the stale row and recompute.
        let stats = run_touch_point_backfill(&conn).unwrap();
        assert_eq!(stats.processed, 1, "stale v1 row must be reprocessed");

        // After backfill, v2 + has_crossing=true for a 200→10 cP curve.
        let (version, has_crossing): (i64, i64) = conn
            .query_row(
                "SELECT touchPrecomputeVersion, touchHasCrossing FROM Experiment WHERE id = ?1",
                params!["exp_stale_v1"],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(version, TOUCH_PRECOMPUTE_VERSION);
        assert_eq!(
            has_crossing, 1,
            "after re-precompute, curve that decisively crosses 50 cP must be flagged"
        );
    }
}
