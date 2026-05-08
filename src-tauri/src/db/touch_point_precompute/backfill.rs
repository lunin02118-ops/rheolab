//! Startup backfill — locate experiments whose precompute is missing or
//! stale and run the algorithm against the columnar blob.

use super::inputs::to_touch_inputs_from_columns;
use super::types::{PrecomputedTouchPoint, TOUCH_PRECOMPUTE_VERSION};
use super::writer::{write_all_thresholds, write_all_thresholds_empty, write_legacy_row};
use crate::db::migrations::v0003_multi_threshold_touch_point::LIBRARY_TOUCH_THRESHOLDS_CP;
use rusqlite::{params, Connection, OptionalExtension};

/// Maximum number of rows processed per backfill invocation.
///
/// This is the upper safety bound for explicit catch-up calls. Startup
/// uses a smaller caller-provided limit so legacy imports cannot keep CPU
/// busy for minutes on first launch.
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
    run_touch_point_backfill_with_limit(conn, BACKFILL_BATCH_LIMIT)
}

/// Run one backfill batch with a caller-provided row cap.
///
/// The default batch stays intentionally large for explicit maintenance
/// calls/tests, but startup uses a smaller cap so legacy imports cannot
/// monopolize CPU for minutes on first launch.
pub fn run_touch_point_backfill_with_limit(
    conn: &Connection,
    batch_limit: usize,
) -> rusqlite::Result<BackfillStats> {
    let batch_limit = batch_limit.clamp(1, BACKFILL_BATCH_LIMIT);
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
            params![expected_count, TOUCH_PRECOMPUTE_VERSION, batch_limit as i64],
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
                tracing::warn!("touch-point backfill: skipping experiment {} — {}", id, e);
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
    stats.has_more = pending.len() == batch_limit;
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
