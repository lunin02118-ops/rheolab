//! v0005 — F6/F7 query plan fixes.
//!
//! Phase 4b live profiling
//! (`docs/audit/2026-04-27-database-explain-profile.md`) flagged two
//! residual `TEMP B-TREE FOR ORDER BY` plans that were initially
//! deferred:
//!
//! * **F6 (Q14)** — `ReagentCatalog`'s catalog page does
//!   `ORDER BY LOWER(category), LOWER(name)`.  At <500 rows the temp
//!   sort is invisible but the wrapping `LOWER()` calls also defeat
//!   any plain index on the catalog.
//! * **F7 (Q4)** — the Library list filtered by `testType` does an
//!   index seek on `testType` followed by a temp sort to satisfy
//!   `ORDER BY createdAt DESC, id DESC`.  Latent at 19 rows, dominant
//!   at 100k.
//!
//! Both findings are addressed by adding one B-tree index each:
//!
//! ```sql
//! CREATE INDEX idx_reagent_category_name_nocase
//!     ON ReagentCatalog(category COLLATE NOCASE, name COLLATE NOCASE);
//!
//! CREATE INDEX idx_experiment_testtype_createdat_id_desc
//!     ON Experiment(testType, createdAt DESC, id DESC);
//! ```
//!
//! The reagents repository SQL is updated in the same commit to drop
//! the `LOWER()` wrappers in favour of the matching `COLLATE NOCASE`
//! ordering — without that change SQLite cannot use the new
//! `idx_reagent_category_name_nocase` index because the expression
//! `LOWER(col)` does not match the indexed expression `col COLLATE
//! NOCASE`.
//!
//! ### Cost
//!
//! Two B-trees:
//!   * `ReagentCatalog` is small (<500 rows on a fully populated
//!     install): negligible.
//!   * `Experiment(testType, createdAt, id)` adds ~24 bytes per row.
//!     Write-amplification: every `INSERT` / `UPDATE` of `testType` or
//!     `createdAt` adjusts one extra B-tree node.  Trivial relative
//!     to the existing 18 indexes on `Experiment` (12 base + 5 partial
//!     v0002 + v0004).
//!
//! ### Idempotency
//!
//! `IF NOT EXISTS` keeps the DDL safe across re-application; a
//! half-applied migration leaves a well-defined state and the next
//! run is a no-op.

use super::error::MigrationError;
use super::r#trait::Migration;
use rusqlite::Connection;

/// DDL for the F6 + F7 indexes.  The reagent index uses `COLLATE
/// NOCASE` on both ordering columns so the catalog page's
/// `ORDER BY category COLLATE NOCASE, name COLLATE NOCASE` query
/// can serve straight from the index leaves.
pub(crate) const V5_INDEX_DDL: &str = "\
CREATE INDEX IF NOT EXISTS idx_reagent_category_name_nocase \
    ON ReagentCatalog(category COLLATE NOCASE, name COLLATE NOCASE);\n\
CREATE INDEX IF NOT EXISTS idx_experiment_testtype_createdat_id_desc \
    ON Experiment(testType, createdAt DESC, id DESC);\n\
";

pub struct V0005ReagentAndTestTypeIndexes;

impl Migration for V0005ReagentAndTestTypeIndexes {
    fn version(&self) -> i64 {
        5
    }

    fn up(&self, conn: &Connection) -> Result<(), MigrationError> {
        conn.execute_batch(V5_INDEX_DDL)?;
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
    /// including v0005 itself.
    fn open_full_schema() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    fn explain(conn: &Connection, sql: &str) -> String {
        let mut stmt = conn
            .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
            .unwrap();
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
                       'idx_reagent_category_name_nocase', \
                       'idx_experiment_testtype_createdat_id_desc')",
            )
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(
            names.contains(&"idx_reagent_category_name_nocase".to_string()),
            "F6 index missing; got {names:?}"
        );
        assert!(
            names.contains(&"idx_experiment_testtype_createdat_id_desc".to_string()),
            "F7 index missing; got {names:?}"
        );
    }

    #[test]
    fn reagent_catalog_list_uses_new_index() {
        // F6: the catalog list query must serve straight from the
        // NOCASE-collation index — no `TEMP B-TREE` for ORDER BY.
        let conn = open_full_schema();

        let plan = explain(
            &conn,
            "SELECT id, name, category FROM ReagentCatalog \
             ORDER BY category COLLATE NOCASE, name COLLATE NOCASE",
        );

        assert!(
            plan.contains("idx_reagent_category_name_nocase"),
            "reagent catalog list must use idx_reagent_category_name_nocase, \
             got plan:\n{plan}"
        );
        assert!(
            !plan.contains("TEMP B-TREE"),
            "reagent catalog list must not need a temp sort, got plan:\n{plan}"
        );
    }

    #[test]
    fn testtype_filtered_list_uses_new_index() {
        // F7: filtering Library by testType must serve the
        // `ORDER BY createdAt DESC, id DESC` straight from the
        // composite index — no temp sort.
        let conn = open_full_schema();

        let plan = explain(
            &conn,
            "SELECT id FROM Experiment \
             WHERE testType = 'static' \
             ORDER BY createdAt DESC, id DESC LIMIT 50",
        );

        assert!(
            plan.contains("idx_experiment_testtype_createdat_id_desc"),
            "testType-filtered list must use \
             idx_experiment_testtype_createdat_id_desc, got plan:\n{plan}"
        );
        assert!(
            !plan.contains("TEMP B-TREE"),
            "testType-filtered list must not need a temp sort, got plan:\n{plan}"
        );
    }

    #[test]
    fn up_is_idempotent() {
        // run_migrations already applied v0005 once — verify a second
        // application of the migration is a no-op (no duplicate
        // index, no error).
        let conn = open_full_schema();
        V0005ReagentAndTestTypeIndexes.up(&conn).unwrap();
        V0005ReagentAndTestTypeIndexes.up(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master \
                 WHERE name IN ( \
                     'idx_reagent_category_name_nocase', \
                     'idx_experiment_testtype_createdat_id_desc')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2, "idempotent migration must not duplicate indexes");
    }
}
