//! v0004 — covering index for the default Library list page.
//!
//! Phase 4b live profiling (`docs/audit/2026-04-27-database-explain-profile.md`,
//! finding F5) showed that the unfiltered Library query
//!
//! ```sql
//! SELECT … FROM Experiment ORDER BY createdAt DESC, id DESC LIMIT ?
//! ```
//!
//! falls back to `SCAN Experiment + USE TEMP B-TREE FOR ORDER BY`.  None
//! of the existing indexes cover both terms of the `ORDER BY` in `DESC`
//! direction:
//!
//! * `idx_experiment_user_created (userId, createdAt)` — composite prefix,
//!   ascending; the optimiser will not pick it for an ORDER-only query
//!   without a `userId` predicate.
//! * `idx_experiment_lab_created`, `idx_experiment_test_date`, etc. —
//!   filter-shaped, not order-shaped for the default no-filter path.
//!
//! At 19 rows (the small seed fixture) the temp sort is invisible.  At
//! 10 000+ experiments it dominates every Library page open because the
//! keyset-pagination cursor only kicks in *after* the first fetch.
//!
//! This migration adds one descending composite index so SQLite can serve
//! the default list straight from the index leaves — no scan, no temp
//! sort.
//!
//! ### Cost
//!
//! +1 B-tree, ~16 bytes per `Experiment` row (createdAt + id + rowid
//! pointer).  Write-amplification: every `INSERT` / `UPDATE` that touches
//! `createdAt` adjusts one extra B-tree node.  Negligible relative to the
//! existing 17 indexes on `Experiment`.
//!
//! ### Idempotency
//!
//! `IF NOT EXISTS` keeps the DDL safe across crash-restart loops and
//! re-application.  A half-applied migration leaves the database in a
//! well-defined state; the next run is a no-op.

use super::error::MigrationError;
use super::r#trait::Migration;
use rusqlite::Connection;

/// DDL for the descending composite index that covers the default Library
/// list query (`ORDER BY createdAt DESC, id DESC`).
pub(crate) const V4_INDEX_DDL: &str = "\
CREATE INDEX IF NOT EXISTS idx_experiment_createdat_id_desc \
    ON Experiment(createdAt DESC, id DESC);\n\
";

pub struct V0004ExperimentListDefaultIndex;

impl Migration for V0004ExperimentListDefaultIndex {
    fn version(&self) -> i64 {
        4
    }

    fn up(&self, conn: &Connection) -> Result<(), MigrationError> {
        conn.execute_batch(V4_INDEX_DDL)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migration::run_migrations;
    use rusqlite::Connection;

    /// Open an in-memory database with every migration applied via the
    /// real runner — this exercises the realistic upgrade path including
    /// v0004 itself, since the runner reads the registry.
    fn open_full_schema() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn creates_descending_composite_index() {
        let conn = open_full_schema();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master \
                 WHERE type = 'index' \
                   AND tbl_name = 'Experiment' \
                   AND name = 'idx_experiment_createdat_id_desc'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "v0004 must create the descending list index");
    }

    #[test]
    fn default_list_query_uses_new_index() {
        // The whole point of F5: prove the new index is actually picked
        // for the default Library query and that the temp B-tree sort is
        // gone.  This is a regression net — if a future migration drops
        // the index or changes the column order the EXPLAIN output will
        // diverge and this test fails loudly.
        let conn = open_full_schema();

        let mut stmt = conn
            .prepare(
                "EXPLAIN QUERY PLAN \
                 SELECT id, name, createdAt FROM Experiment \
                 ORDER BY createdAt DESC, id DESC LIMIT 50",
            )
            .unwrap();

        // EXPLAIN QUERY PLAN columns: id, parent, notused, detail.
        let plans: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(3))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();
        let combined = plans.join("\n");

        assert!(
            combined.contains("idx_experiment_createdat_id_desc"),
            "default list query must use idx_experiment_createdat_id_desc, \
             got plan:\n{}",
            combined
        );
        assert!(
            !combined.contains("TEMP B-TREE"),
            "default list query must not need a temp sort, \
             got plan:\n{}",
            combined
        );
    }

    #[test]
    fn up_is_idempotent() {
        // run_migrations already applied v0004 once — verify a second
        // application of the migration is a no-op (no duplicate index,
        // no error).
        let conn = open_full_schema();
        V0004ExperimentListDefaultIndex.up(&conn).unwrap();
        V0004ExperimentListDefaultIndex.up(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master \
                 WHERE name = 'idx_experiment_createdat_id_desc'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "idempotent migration must not duplicate index");
    }
}
