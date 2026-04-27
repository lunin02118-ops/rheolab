//! Database writers — persist the legacy v0002 columns on `Experiment`
//! AND the new v0003 `TouchPointPrecompute` side table for every preset
//! threshold.

use super::compute::{compute_from_inputs, compute_from_inputs_with_threshold};
use super::inputs::to_touch_inputs;
use super::types::{PrecomputedTouchPoint, TOUCH_PRECOMPUTE_VERSION};
use crate::db::migrations::v0003_multi_threshold_touch_point::LIBRARY_TOUCH_THRESHOLDS_CP;
use rheolab_core::report_generator::touch_point::TouchPointInput;
use rusqlite::{params, Connection};
use serde_json::Value;

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
pub(super) fn write_all_thresholds(
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
pub(super) fn write_legacy_row(
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
pub(super) fn write_all_thresholds_empty(
    conn: &Connection,
    experiment_id: &str,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare_cached(
        "INSERT OR REPLACE INTO TouchPointPrecompute \
           (experimentId, thresholdCp, hasCrossing, crossingTimeMin, \
            crossingViscosityCp, viscosityAtTargetCp, precomputeVersion) \
         VALUES (?1, ?2, 0, NULL, NULL, NULL, ?3)",
    )?;
    for &threshold_cp in LIBRARY_TOUCH_THRESHOLDS_CP {
        stmt.execute(params![
            experiment_id,
            threshold_cp as i64,
            TOUCH_PRECOMPUTE_VERSION
        ])?;
    }
    Ok(())
}
