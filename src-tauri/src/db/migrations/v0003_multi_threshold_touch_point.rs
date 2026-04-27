//! v0003 — multi-threshold touch-point precompute.
//!
//! v0002 gave us *one* precomputed touch-point per experiment (the fixed
//! library contract: 50 cP / 10 min).  Lab researchers work with many
//! fluid chemistries whose "gel-break" crossing lives at very different
//! viscosities — 5 cP for thin friction-reducers, 500 cP for crosslinked
//! slickwater, etc.  Running the dynamic threshold on every filter change
//! meant 10-20 s of CPU work for ~10 k-row libraries.
//!
//! This migration introduces an auxiliary `TouchPointPrecompute` table
//! keyed by `(experimentId, thresholdCp)`: one row per experiment per
//! well-known threshold.  The populated thresholds are
//! [`LIBRARY_TOUCH_THRESHOLDS_CP`] (currently 8 values: 5, 10, 50, 100,
//! 200, 300, 500, 700 cP).  Any of those becomes a **fast path** via a
//! JOIN with a threshold-filtered partial index — O(1) lookup per row.
//!
//! Custom thresholds (e.g. 345 cP) fall back to the existing slow path
//! in `commands::experiments::list::dynamic`.
//!
//! ### Why a separate table and not columns
//!
//! 8 thresholds × 4 metric columns = 32 new columns on `Experiment`.
//! That table already carries 40+ columns; wide-row storage penalises
//! every query, not just touch-point lookups.  A narrow side table with
//! composite PK also means **adding a 9th or 10th threshold later is a
//! backfill job, not a schema change** — no `ALTER TABLE ADD COLUMN`
//! cascade, no downtime.
//!
//! ### Back-compat
//!
//! The v0002 columns (`touchHasCrossing`, `touchCrossingTimeMin`, …) are
//! preserved — old read paths keep working during the transition.  The
//! migration copies their values into `TouchPointPrecompute` for the 50
//! cP row so first-launch after upgrade has no "blank" 50 cP fast path.
//! Backfill at startup fills the remaining 7 thresholds in batches (see
//! `db::touch_point_precompute::run_touch_point_backfill`).

use super::error::MigrationError;
use super::r#trait::Migration;
use rusqlite::Connection;

/// Precomputed thresholds (in centipoise) that get a dedicated row per
/// experiment in `TouchPointPrecompute`.  Every value here becomes a
/// sidebar preset in the library filter and serves its list query via
/// the indexed fast path.
///
/// Ordering is sidebar-display order, not numeric: callers that iterate
/// these for storage or tests should sort if they depend on a specific
/// order.  Values must be finite, positive, and (by convention) integer
/// so `CAST(... AS INTEGER)` matches the stored `thresholdCp` column.
pub const LIBRARY_TOUCH_THRESHOLDS_CP: &[f64] =
    &[5.0, 10.0, 50.0, 100.0, 200.0, 300.0, 500.0, 700.0];

/// DDL for the new `TouchPointPrecompute` side table + its partial
/// indexes.  Kept as a single `execute_batch` string so a half-applied
/// migration leaves the database in a well-defined state (the next run
/// picks it up via `IF NOT EXISTS`).
pub(crate) const V3_TABLE_DDL: &str = "\
CREATE TABLE IF NOT EXISTS TouchPointPrecompute (\n\
    experimentId        TEXT    NOT NULL,\n\
    thresholdCp         INTEGER NOT NULL,\n\
    hasCrossing         INTEGER NOT NULL,\n\
    crossingTimeMin     REAL,\n\
    crossingViscosityCp REAL,\n\
    viscosityAtTargetCp REAL,\n\
    precomputeVersion   INTEGER NOT NULL,\n\
    PRIMARY KEY (experimentId, thresholdCp),\n\
    FOREIGN KEY (experimentId) REFERENCES Experiment(id) ON DELETE CASCADE\n\
);\n\
-- Narrow fast-path index for the sidebar preset click: given a fixed\n\
-- thresholdCp, walk only matching rows when filtering by hasCrossing /\n\
-- crossingTimeMin / viscosityAtTargetCp.\n\
CREATE INDEX IF NOT EXISTS idx_tpp_threshold_crossing \n\
    ON TouchPointPrecompute(thresholdCp, hasCrossing);\n\
CREATE INDEX IF NOT EXISTS idx_tpp_threshold_crossing_time \n\
    ON TouchPointPrecompute(thresholdCp, crossingTimeMin) \n\
    WHERE crossingTimeMin IS NOT NULL;\n\
CREATE INDEX IF NOT EXISTS idx_tpp_threshold_viscosity_target \n\
    ON TouchPointPrecompute(thresholdCp, viscosityAtTargetCp) \n\
    WHERE viscosityAtTargetCp IS NOT NULL;\n\
-- Backfill scan index: `SELECT experimentId FROM Experiment e LEFT JOIN\n\
-- TouchPointPrecompute tpp ON tpp.experimentId = e.id AND tpp.thresholdCp\n\
-- = ? WHERE tpp.experimentId IS NULL` hits this path-indexed lookup.\n\
CREATE INDEX IF NOT EXISTS idx_tpp_experiment \n\
    ON TouchPointPrecompute(experimentId);\n\
";

/// One-shot seed of the 50 cP row from the legacy v0002 columns.  We
/// only copy rows where the v0002 precompute actually ran (`touch
/// PrecomputeVersion IS NOT NULL`) — "pending" rows will be handled by
/// the runtime backfill along with the other 7 thresholds.
///
/// `INSERT OR IGNORE` makes the statement idempotent: if the migration
/// is re-run (say, after a crash before the version bump) the second
/// pass hits the PK and silently skips.
pub(crate) const V3_BACKFILL_50CP_DDL: &str = "\
INSERT OR IGNORE INTO TouchPointPrecompute \n\
    (experimentId, thresholdCp, hasCrossing, crossingTimeMin, \n\
     crossingViscosityCp, viscosityAtTargetCp, precomputeVersion) \n\
SELECT id, 50, \n\
       -- Legacy rows where touchPrecomputeVersion is set but the\n\
       -- downstream flag somehow ended up NULL (historical edge case\n\
       -- from early v2 deployments) are treated as \"no crossing\"\n\
       -- rather than rejected by the NOT NULL constraint.  The\n\
       -- runtime backfill will overwrite this on the next launch.\n\
       COALESCE(touchHasCrossing, 0), \n\
       touchCrossingTimeMin, \n\
       touchCrossingViscosityCp, touchViscosityAtTargetCp, \n\
       touchPrecomputeVersion \n\
  FROM Experiment \n\
 WHERE touchPrecomputeVersion IS NOT NULL;\n\
";

pub struct V0003MultiThresholdTouchPoint;

impl Migration for V0003MultiThresholdTouchPoint {
    fn version(&self) -> i64 {
        3
    }

    fn up(&self, conn: &Connection) -> Result<(), MigrationError> {
        conn.execute_batch(V3_TABLE_DDL)?;
        conn.execute_batch(V3_BACKFILL_50CP_DDL)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::v0001_initial::V1_DDL;
    use crate::db::migrations::v0002_touch_point_metrics::V0002TouchPointMetrics;
    use rusqlite::{params, Connection};
    use std::collections::HashSet;

    fn open_v2() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(V1_DDL).unwrap();
        V0002TouchPointMetrics.up(&conn).unwrap();
        conn
    }

    #[test]
    fn creates_touch_point_precompute_table() {
        let conn = open_v2();
        V0003MultiThresholdTouchPoint.up(&conn).unwrap();

        // Verify the table exists with the full column set.
        let mut stmt = conn
            .prepare("PRAGMA table_info(TouchPointPrecompute)")
            .unwrap();
        let cols: HashSet<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        for expected in [
            "experimentId",
            "thresholdCp",
            "hasCrossing",
            "crossingTimeMin",
            "crossingViscosityCp",
            "viscosityAtTargetCp",
            "precomputeVersion",
        ] {
            assert!(cols.contains(expected), "column {} missing", expected);
        }
    }

    #[test]
    fn creates_partial_indexes() {
        let conn = open_v2();
        V0003MultiThresholdTouchPoint.up(&conn).unwrap();

        let mut stmt = conn
            .prepare(
                "SELECT name FROM sqlite_master \
                 WHERE type = 'index' AND tbl_name = 'TouchPointPrecompute'",
            )
            .unwrap();
        let names: HashSet<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert!(names.contains("idx_tpp_threshold_crossing"));
        assert!(names.contains("idx_tpp_threshold_crossing_time"));
        assert!(names.contains("idx_tpp_threshold_viscosity_target"));
        assert!(names.contains("idx_tpp_experiment"));
    }

    #[test]
    fn copies_legacy_50cp_data_from_experiment_columns() {
        let conn = open_v2();

        // Seed required domain rows: User + Experiment (with v0002 touch
        // columns filled in to simulate a database already running on the
        // old schema).
        conn.execute(
            "INSERT INTO User (id, name, role) VALUES ('u1', 'Test', 'admin')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO Experiment (id, originalFilename, testDate, instrumentType, \
                                      name, waterSource, fluidType, testGroup, metrics, \
                                      rawPoints, userId, \
                                      touchHasCrossing, touchCrossingTimeMin, \
                                      touchCrossingViscosityCp, touchViscosityAtTargetCp, \
                                      touchPrecomputeVersion) \
             VALUES ('e1', 'f.csv', '2025-01-01', 'Chandler', 'Test', \
                     'Water', 'Crosslinked', 'Rheology', '{}', '[]', 'u1', \
                     1, 8.5, 48.2, 31.7, 2)",
            [],
        )
        .unwrap();
        // A second row that the v0002 precompute did NOT yet process
        // (touchPrecomputeVersion is NULL) — must be skipped.
        conn.execute(
            "INSERT INTO Experiment (id, originalFilename, testDate, instrumentType, \
                                      name, waterSource, fluidType, testGroup, metrics, \
                                      rawPoints, userId) \
             VALUES ('e2', 'f2.csv', '2025-01-02', 'Chandler', 'Test2', \
                     'Water', 'Crosslinked', 'Rheology', '{}', '[]', 'u1')",
            [],
        )
        .unwrap();

        V0003MultiThresholdTouchPoint.up(&conn).unwrap();

        // Processed row: copied.
        let tpp: (i64, Option<f64>, Option<f64>, Option<f64>, i64) = conn
            .query_row(
                "SELECT hasCrossing, crossingTimeMin, crossingViscosityCp, \
                        viscosityAtTargetCp, precomputeVersion \
                 FROM TouchPointPrecompute \
                 WHERE experimentId = 'e1' AND thresholdCp = 50",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(tpp.0, 1);
        assert!((tpp.1.unwrap() - 8.5).abs() < 1e-9);
        assert!((tpp.2.unwrap() - 48.2).abs() < 1e-9);
        assert!((tpp.3.unwrap() - 31.7).abs() < 1e-9);
        assert_eq!(tpp.4, 2);

        // Unprocessed row: not copied.
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM TouchPointPrecompute WHERE experimentId = 'e2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            count, 0,
            "NULL-version rows must be skipped by the migration"
        );

        // Only the 50 cP row is seeded by this migration — the other 7
        // thresholds come online via the runtime backfill.
        let total: i64 = conn
            .query_row("SELECT COUNT(*) FROM TouchPointPrecompute", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(total, 1);
    }

    #[test]
    fn up_is_idempotent() {
        let conn = open_v2();
        conn.execute(
            "INSERT INTO User (id, name, role) VALUES ('u1', 'Test', 'admin')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO Experiment (id, originalFilename, testDate, instrumentType, \
                                      name, waterSource, fluidType, testGroup, metrics, \
                                      rawPoints, userId, touchPrecomputeVersion) \
             VALUES ('e1', 'f.csv', '2025-01-01', 'Chandler', 'Test', \
                     'Water', 'Crosslinked', 'Rheology', '{}', '[]', 'u1', 2)",
            [],
        )
        .unwrap();

        V0003MultiThresholdTouchPoint.up(&conn).unwrap();
        // Second run must not error on duplicate PK or duplicate index.
        V0003MultiThresholdTouchPoint.up(&conn).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM TouchPointPrecompute", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 1, "idempotent migration must not duplicate rows");
    }

    #[test]
    fn library_thresholds_are_sane() {
        // Contract enforced by the save/backfill paths: every threshold
        // must be finite, positive, and (for the CAST AS INTEGER stored
        // in TouchPointPrecompute.thresholdCp) an integer value.
        for &t in LIBRARY_TOUCH_THRESHOLDS_CP {
            assert!(t.is_finite(), "threshold {} is not finite", t);
            assert!(t > 0.0, "threshold {} must be positive", t);
            assert!(
                (t - t.round()).abs() < 1e-9,
                "threshold {} must be integer-valued",
                t
            );
        }
        // Must contain the library-contract default so the v0003
        // backfill SELECT (hard-coded to `thresholdCp = 50`) has a
        // matching runtime counterpart.
        assert!(
            LIBRARY_TOUCH_THRESHOLDS_CP.contains(&50.0),
            "50 cP must remain a preset for back-compat"
        );
    }

    // The `_` prefix silences "unused" warnings when only some tests are
    // compiled — `params` is referenced by later tests added piecemeal.
    #[allow(dead_code)]
    fn _silence_unused() {
        let _ = params![1i64];
    }
}
