use rusqlite::Connection;
use std::collections::HashSet;
use super::error::MigrationError;
use super::r#trait::Migration;

/// Touch-point library-filter columns on `Experiment`.
///
/// These are precomputed at save time (and backfilled on startup for
/// pre-existing rows) so the experiment-library filter sidebar can
/// filter by threshold crossing time / viscosity without scanning every
/// experiment's columnar blob.
///
/// Column semantics:
///   * `touchHasCrossing`          — 1 when a crossing through the library
///                                   threshold (50 cP) was detected, 0 when
///                                   the curve never crossed, NULL when the
///                                   algorithm has not been run yet.
///   * `touchCrossingTimeMin`      — minute at which the smoothed viscosity
///                                   first crossed the 50 cP threshold after
///                                   the viscosity peak.  NULL when no
///                                   crossing was found.
///   * `touchCrossingViscosityCp`  — viscosity (cP) at the crossing instant
///                                   — not always equal to 50 cP because the
///                                   stored value is the smoothed value of
///                                   the snapped data point.
///   * `touchViscosityAtTargetCp`  — viscosity (cP) at the library target
///                                   time (10 min), interpolated or snapped
///                                   to the nearest real data point across
///                                   shear-rate jumps.
///   * `touchPrecomputeVersion`    — algorithm schema version that produced
///                                   the other four columns.  NULL signals
///                                   "not yet computed"; startup backfill
///                                   scans for rows where this is NULL.
///
/// All DDL uses `IF NOT EXISTS` / column-existence guards so the migration
/// is safe to rerun on a partially-applied database.
pub(crate) const V2_ADD_COLUMN_DDL: &[(&str, &str)] = &[
    (
        "touchHasCrossing",
        "ALTER TABLE Experiment ADD COLUMN touchHasCrossing INTEGER DEFAULT NULL",
    ),
    (
        "touchCrossingTimeMin",
        "ALTER TABLE Experiment ADD COLUMN touchCrossingTimeMin REAL DEFAULT NULL",
    ),
    (
        "touchCrossingViscosityCp",
        "ALTER TABLE Experiment ADD COLUMN touchCrossingViscosityCp REAL DEFAULT NULL",
    ),
    (
        "touchViscosityAtTargetCp",
        "ALTER TABLE Experiment ADD COLUMN touchViscosityAtTargetCp REAL DEFAULT NULL",
    ),
    (
        "touchPrecomputeVersion",
        "ALTER TABLE Experiment ADD COLUMN touchPrecomputeVersion INTEGER DEFAULT NULL",
    ),
];

/// Partial indexes for the library-filter fast path.
///
/// * `idx_experiment_touch_has_crossing` — supports `WHERE touchHasCrossing
///   IN (0, 1)` filters.  Partial (`IS NOT NULL`) keeps it tiny while
///   backfill is still in progress.
/// * `idx_experiment_touch_precompute_pending` — supports the backfill
///   scan `WHERE touchPrecomputeVersion IS NULL`.  Partial so it stores
///   only the handful of rows that still need precompute.
pub(crate) const V2_INDEX_DDL: &str = "\
CREATE INDEX IF NOT EXISTS idx_experiment_touch_has_crossing \
    ON Experiment(touchHasCrossing) WHERE touchHasCrossing IS NOT NULL;\n\
CREATE INDEX IF NOT EXISTS idx_experiment_touch_crossing_time \
    ON Experiment(touchCrossingTimeMin) WHERE touchCrossingTimeMin IS NOT NULL;\n\
CREATE INDEX IF NOT EXISTS idx_experiment_touch_crossing_viscosity \
    ON Experiment(touchCrossingViscosityCp) WHERE touchCrossingViscosityCp IS NOT NULL;\n\
CREATE INDEX IF NOT EXISTS idx_experiment_touch_viscosity_at_target \
    ON Experiment(touchViscosityAtTargetCp) WHERE touchViscosityAtTargetCp IS NOT NULL;\n\
CREATE INDEX IF NOT EXISTS idx_experiment_touch_precompute_pending \
    ON Experiment(touchPrecomputeVersion) WHERE touchPrecomputeVersion IS NULL;\n\
";

/// v0002: add precomputed touch-point columns + partial indexes.
pub struct V0002TouchPointMetrics;

impl Migration for V0002TouchPointMetrics {
    fn version(&self) -> i64 {
        2
    }

    fn up(&self, conn: &Connection) -> Result<(), MigrationError> {
        // Introspect existing columns so `ALTER TABLE ADD COLUMN` is
        // idempotent even on a partially-applied database (SQLite has no
        // `ADD COLUMN IF NOT EXISTS` clause).
        let mut existing: HashSet<String> = HashSet::new();
        {
            let mut stmt = conn.prepare("PRAGMA table_info(Experiment)")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            for name in rows {
                existing.insert(name?);
            }
        }

        for (col, ddl) in V2_ADD_COLUMN_DDL {
            if !existing.contains(*col) {
                conn.execute(ddl, [])?;
            }
        }

        conn.execute_batch(V2_INDEX_DDL)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::v0001_initial::V1_DDL;
    use rusqlite::Connection;

    fn open_v1() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(V1_DDL).unwrap();
        conn
    }

    #[test]
    fn adds_all_five_touch_point_columns() {
        let conn = open_v1();
        V0002TouchPointMetrics.up(&conn).unwrap();

        let mut stmt = conn.prepare("PRAGMA table_info(Experiment)").unwrap();
        let cols: HashSet<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert!(cols.contains("touchHasCrossing"));
        assert!(cols.contains("touchCrossingTimeMin"));
        assert!(cols.contains("touchCrossingViscosityCp"));
        assert!(cols.contains("touchViscosityAtTargetCp"));
        assert!(cols.contains("touchPrecomputeVersion"));
    }

    #[test]
    fn up_is_idempotent_on_partial_state() {
        let conn = open_v1();
        // Simulate a crash half-way: only the first column was added.
        conn.execute(V2_ADD_COLUMN_DDL[0].1, []).unwrap();

        // Re-running the full migration must succeed and add the rest.
        V0002TouchPointMetrics.up(&conn).unwrap();

        let mut stmt = conn.prepare("PRAGMA table_info(Experiment)").unwrap();
        let cols: HashSet<String> = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        for (col, _) in V2_ADD_COLUMN_DDL {
            assert!(cols.contains(*col), "column {} missing after retry", col);
        }
    }

    #[test]
    fn up_is_idempotent_on_full_state() {
        let conn = open_v1();
        V0002TouchPointMetrics.up(&conn).unwrap();
        // Running it a second time must not error on duplicate columns.
        V0002TouchPointMetrics.up(&conn).unwrap();
    }

    #[test]
    fn creates_partial_indexes() {
        let conn = open_v1();
        V0002TouchPointMetrics.up(&conn).unwrap();

        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'Experiment'")
            .unwrap();
        let names: HashSet<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert!(names.contains("idx_experiment_touch_has_crossing"));
        assert!(names.contains("idx_experiment_touch_crossing_time"));
        assert!(names.contains("idx_experiment_touch_crossing_viscosity"));
        assert!(names.contains("idx_experiment_touch_viscosity_at_target"));
        assert!(names.contains("idx_experiment_touch_precompute_pending"));
    }
}
