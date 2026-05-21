//! v0007 — Foreign-key column indexes for parent-side delete enforcement.
//!
//! The audit-preflight DB-003 finding flagged two FK columns that ship
//! without an index covering them alone:
//!
//! * `Experiment.waterSourceId` — FK to `WaterSourceCatalog(id)`.
//!   The existing `idx_experiment_water_source` covers a *different*
//!   column (`waterSource` text, denormalised label), not this FK.
//!
//! * `ExperimentReagent.reagentId` — FK to `ReagentCatalog(id)`
//!   `ON DELETE SET NULL`.  The existing `idx_experiment_reagent_pair`
//!   is a composite `(experimentId, reagentId)` whose leading column is
//!   `experimentId`, so SQLite cannot use it for `WHERE reagentId = ?`
//!   queries (the index is irrelevant unless the leading column is also
//!   bound).
//!
//! Without these indexes, every parent-side delete (e.g. the user
//! removing a custom reagent through `commands::reagents::commands`,
//! line 251: `DELETE FROM ReagentCatalog WHERE id = ?`) forces SQLite
//! to do a full table scan of the child table to enforce the FK
//! action.  For a library with thousands of `ExperimentReagent` rows
//! this turns a sub-millisecond delete into hundreds of milliseconds,
//! reproducible by the user as a noticeable UI freeze.
//!
//! `User.laboratoryId` was *also* in the DB-003 list but is intentionally
//! skipped: RheoLab Enterprise is single-user, so the `User` table holds
//! one row; an index would never beat a full scan of one entry.
//!
//! ### Cost
//!
//! Two partial B-trees (`WHERE … IS NOT NULL`).  For a library with
//! 1k experiments and 5k reagent links the combined storage is
//! ~80–120 KB.  Write-amplification is one extra B-tree node per row
//! that satisfies the partial predicate; manually-entered or imported
//! rows without the FK populated pay nothing.
//!
//! ### Idempotency
//!
//! `CREATE INDEX IF NOT EXISTS` makes the DDL safe across crash-restart
//! loops and re-application — the same idempotency contract every prior
//! migration in this registry obeys.

use super::error::MigrationError;
use super::r#trait::Migration;
use rusqlite::Connection;

/// DDL for the DB-003 FK-column indexes.  Both are partial
/// (`WHERE … IS NOT NULL`) because the underlying columns are nullable
/// (`waterSourceId` is optional metadata; `reagentId` becomes NULL when
/// its parent reagent is deleted via `ON DELETE SET NULL`).
pub(crate) const V7_INDEX_DDL: &str = "\
CREATE INDEX IF NOT EXISTS idx_experiment_water_source_id \
    ON Experiment(waterSourceId) \
    WHERE waterSourceId IS NOT NULL;\n\
CREATE INDEX IF NOT EXISTS idx_experiment_reagent_reagent_id \
    ON ExperimentReagent(reagentId) \
    WHERE reagentId IS NOT NULL;\n\
";

pub struct V0007FkIndexes;

impl Migration for V0007FkIndexes {
    fn version(&self) -> i64 {
        7
    }

    fn up(&self, conn: &Connection) -> Result<(), MigrationError> {
        conn.execute_batch(V7_INDEX_DDL)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migration::run_migrations;
    use rusqlite::Connection;

    /// Open an in-memory database with every migration applied via
    /// the real runner — exercises the realistic upgrade path
    /// including v0007 itself.
    fn open_full_schema() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    fn explain(conn: &Connection, sql: &str) -> String {
        let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
        stmt.query_map([], |row| row.get::<_, String>(3))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn creates_both_indexes() {
        let conn = open_full_schema();

        let names: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master \
                 WHERE type = 'index' \
                   AND name IN ( \
                       'idx_experiment_water_source_id', \
                       'idx_experiment_reagent_reagent_id')",
            )
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(
            names.contains(&"idx_experiment_water_source_id".to_string()),
            "Experiment.waterSourceId FK index missing; got {names:?}"
        );
        assert!(
            names.contains(&"idx_experiment_reagent_reagent_id".to_string()),
            "ExperimentReagent.reagentId FK index missing; got {names:?}"
        );
    }

    #[test]
    fn water_source_id_lookup_uses_index() {
        // Parent-side `DELETE FROM WaterSourceCatalog WHERE id = ?`
        // forces SQLite to enforce the FK by walking child rows
        // referencing that id; the explicit lookup mirrors what FK
        // enforcement does internally.
        let conn = open_full_schema();

        let plan = explain(
            &conn,
            "SELECT id FROM Experiment WHERE waterSourceId = 'ws-1'",
        );

        assert!(
            plan.contains("idx_experiment_water_source_id"),
            "Experiment.waterSourceId lookup must use \
             idx_experiment_water_source_id, got plan:\n{plan}"
        );
    }

    #[test]
    fn experiment_reagent_reagent_id_lookup_uses_index() {
        // Parent-side `DELETE FROM ReagentCatalog WHERE id = ?` (which
        // happens whenever the user deletes a custom reagent —
        // `commands::reagents::commands::reagents_delete`) forces
        // SQLite to find every `ExperimentReagent` row referencing
        // that reagentId in order to apply the `ON DELETE SET NULL`
        // action.  The new index makes this lookup index-driven.
        let conn = open_full_schema();

        let plan = explain(
            &conn,
            "SELECT id FROM ExperimentReagent WHERE reagentId = 'r-1'",
        );

        assert!(
            plan.contains("idx_experiment_reagent_reagent_id"),
            "ExperimentReagent.reagentId lookup must use \
             idx_experiment_reagent_reagent_id, got plan:\n{plan}"
        );
    }

    #[test]
    fn indexes_are_partial() {
        // The whole point of DB-003: only non-NULL rows participate.
        // SQLite stores the partial-WHERE clause in sqlite_master.sql,
        // so we can grep for it as a structural assertion.
        let conn = open_full_schema();

        let ddls: Vec<(String, String)> = conn
            .prepare(
                "SELECT name, sql FROM sqlite_master \
                 WHERE type = 'index' \
                   AND name IN ( \
                       'idx_experiment_water_source_id', \
                       'idx_experiment_reagent_reagent_id') \
                 ORDER BY name",
            )
            .unwrap()
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert_eq!(ddls.len(), 2, "expected two v0007 indexes");
        for (name, ddl) in &ddls {
            let column = if name.contains("water_source") {
                "waterSourceId"
            } else {
                "reagentId"
            };
            assert!(
                ddl.contains(&format!("WHERE {column} IS NOT NULL")),
                "v0007 index {name} must be partial on {column} IS NOT NULL, \
                 got DDL:\n{ddl}"
            );
        }
    }

    #[test]
    fn up_is_idempotent() {
        // run_migrations already applied v0007 once — verify a second
        // application of the migration is a no-op (no duplicate
        // index, no error).
        let conn = open_full_schema();
        V0007FkIndexes.up(&conn).unwrap();
        V0007FkIndexes.up(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master \
                 WHERE name IN ( \
                     'idx_experiment_water_source_id', \
                     'idx_experiment_reagent_reagent_id')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2, "idempotent migration must not duplicate indexes");
    }
}
