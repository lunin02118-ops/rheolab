//! v0006 — F2 import-batch FK indexes for artifact tables.
//!
//! The Phase 4 database deep-dive
//! (`docs/audit/2026-04-27-database-deep-dive.md`, finding F2)
//! flagged that three artifact tables declare an `importBatchId`
//! foreign key against `ImportBatch(id)` but ship no index covering
//! that column:
//!
//! * `ExperimentPayload.importBatchId`
//! * `ParserArtifact.importBatchId`
//! * `ReportArtifact.importBatchId`
//!
//! Without an index, any cleanup-by-batch query (e.g. "delete every
//! payload that came in with this rolled-back import") falls back to
//! a full table scan.  The audit deferred this with the note "add
//! three partial indexes in a v0004 migration if cleanup-by-batch
//! becomes a pain-point" — closing the loop here, before the artifact
//! tables grow past the static-analysis sweet spot, has the same
//! cost-benefit profile as v0005's deferred F6/F7 fixes.
//!
//! Each index is **partial** (`WHERE importBatchId IS NOT NULL`)
//! because the column is nullable: only rows produced by an import
//! batch carry a non-NULL `importBatchId`, manually-created artifacts
//! do not.  A partial index keeps the B-tree minimal — empty when
//! the user has never imported, growing one entry per imported
//! artifact.
//!
//! ### Cost
//!
//! Three partial B-trees, each ~16 bytes per non-NULL row.
//! Write-amplification: every `INSERT` / `UPDATE` of `importBatchId`
//! adjusts one extra B-tree node — but only for rows that satisfy
//! the partial predicate, so manually-created artifacts pay nothing.
//! Negligible relative to the existing artifact-table indexes.
//!
//! ### Idempotency
//!
//! `IF NOT EXISTS` keeps the DDL safe across crash-restart loops and
//! re-application.  A half-applied migration leaves the database in
//! a well-defined state; the next run is a no-op.

use super::error::MigrationError;
use super::r#trait::Migration;
use rusqlite::Connection;

/// DDL for the F2 import-batch FK indexes.  All three are partial
/// indexes that only include rows where `importBatchId IS NOT NULL`,
/// matching the predicate that any `WHERE importBatchId = ?` cleanup
/// query naturally implies.
pub(crate) const V6_INDEX_DDL: &str = "\
CREATE INDEX IF NOT EXISTS idx_payload_import \
    ON ExperimentPayload(importBatchId) \
    WHERE importBatchId IS NOT NULL;\n\
CREATE INDEX IF NOT EXISTS idx_parser_import \
    ON ParserArtifact(importBatchId) \
    WHERE importBatchId IS NOT NULL;\n\
CREATE INDEX IF NOT EXISTS idx_report_import \
    ON ReportArtifact(importBatchId) \
    WHERE importBatchId IS NOT NULL;\n\
";

pub struct V0006ArtifactImportBatchIndexes;

impl Migration for V0006ArtifactImportBatchIndexes {
    fn version(&self) -> i64 {
        6
    }

    fn up(&self, conn: &Connection) -> Result<(), MigrationError> {
        conn.execute_batch(V6_INDEX_DDL)?;
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
    /// including v0006 itself.
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
    fn creates_all_three_indexes() {
        let conn = open_full_schema();

        let names: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master \
                 WHERE type = 'index' \
                   AND name IN ( \
                       'idx_payload_import', \
                       'idx_parser_import', \
                       'idx_report_import')",
            )
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(
            names.contains(&"idx_payload_import".to_string()),
            "ExperimentPayload import index missing; got {names:?}"
        );
        assert!(
            names.contains(&"idx_parser_import".to_string()),
            "ParserArtifact import index missing; got {names:?}"
        );
        assert!(
            names.contains(&"idx_report_import".to_string()),
            "ReportArtifact import index missing; got {names:?}"
        );
    }

    #[test]
    fn payload_cleanup_by_batch_uses_index() {
        // F2 cleanup-by-batch query for ExperimentPayload — must use
        // the new partial index, not a full table scan.
        let conn = open_full_schema();

        let plan = explain(
            &conn,
            "SELECT id FROM ExperimentPayload WHERE importBatchId = 'batch-1'",
        );

        assert!(
            plan.contains("idx_payload_import"),
            "ExperimentPayload cleanup must use idx_payload_import, \
             got plan:\n{plan}"
        );
    }

    #[test]
    fn parser_cleanup_by_batch_uses_index() {
        let conn = open_full_schema();

        let plan = explain(
            &conn,
            "SELECT id FROM ParserArtifact WHERE importBatchId = 'batch-1'",
        );

        assert!(
            plan.contains("idx_parser_import"),
            "ParserArtifact cleanup must use idx_parser_import, \
             got plan:\n{plan}"
        );
    }

    #[test]
    fn report_cleanup_by_batch_uses_index() {
        let conn = open_full_schema();

        let plan = explain(
            &conn,
            "SELECT id FROM ReportArtifact WHERE importBatchId = 'batch-1'",
        );

        assert!(
            plan.contains("idx_report_import"),
            "ReportArtifact cleanup must use idx_report_import, \
             got plan:\n{plan}"
        );
    }

    #[test]
    fn indexes_are_partial() {
        // The whole point of F2: only non-NULL rows participate.
        // SQLite stores the partial-WHERE clause in sqlite_master.sql,
        // so we can grep for it as a structural assertion.
        let conn = open_full_schema();

        let ddls: Vec<String> = conn
            .prepare(
                "SELECT sql FROM sqlite_master \
                 WHERE type = 'index' \
                   AND name IN ( \
                       'idx_payload_import', \
                       'idx_parser_import', \
                       'idx_report_import') \
                 ORDER BY name",
            )
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert_eq!(ddls.len(), 3, "expected three v0006 indexes");
        for ddl in &ddls {
            assert!(
                ddl.contains("WHERE importBatchId IS NOT NULL"),
                "v0006 index must be partial on importBatchId IS NOT NULL, \
                 got DDL:\n{ddl}"
            );
        }
    }

    #[test]
    fn up_is_idempotent() {
        // run_migrations already applied v0006 once — verify a second
        // application of the migration is a no-op (no duplicate
        // index, no error).
        let conn = open_full_schema();
        V0006ArtifactImportBatchIndexes.up(&conn).unwrap();
        V0006ArtifactImportBatchIndexes.up(&conn).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master \
                 WHERE name IN ( \
                     'idx_payload_import', \
                     'idx_parser_import', \
                     'idx_report_import')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 3, "idempotent migration must not duplicate indexes");
    }
}
