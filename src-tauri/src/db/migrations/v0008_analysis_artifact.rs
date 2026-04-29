//! v0008 - AnalysisArtifact cache table.
//!
//! Sprint 3 introduces a persistent cache for pure analysis outputs. The
//! migration is additive: existing experiment/report data is untouched, and
//! cache rows cascade with their parent `Experiment`.

use super::error::MigrationError;
use super::r#trait::Migration;
use rusqlite::Connection;

pub(crate) const V8_ANALYSIS_ARTIFACT_DDL: &str = "\
CREATE TABLE IF NOT EXISTS AnalysisArtifact (
    id TEXT PRIMARY KEY,

    experimentId TEXT NOT NULL,
    experimentDataHash TEXT NOT NULL,
    geometry TEXT NOT NULL,
    analysisSettingsHash TEXT NOT NULL,
    reportViscosityRatesHash TEXT NOT NULL,
    rheolabCoreVersion TEXT NOT NULL,
    algorithmVersion INTEGER NOT NULL,

    artifactEncoding TEXT NOT NULL,
    artifactBlob BLOB NOT NULL,
    artifactBytes INTEGER NOT NULL,

    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    lastAccessedAt TEXT,
    hitCount INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (experimentId)
        REFERENCES Experiment(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_artifact_key
ON AnalysisArtifact (
    experimentId,
    experimentDataHash,
    geometry,
    analysisSettingsHash,
    reportViscosityRatesHash,
    rheolabCoreVersion,
    algorithmVersion
);

CREATE INDEX IF NOT EXISTS idx_analysis_artifact_experiment_updated
ON AnalysisArtifact (experimentId, updatedAt DESC);

CREATE INDEX IF NOT EXISTS idx_analysis_artifact_last_accessed
ON AnalysisArtifact (lastAccessedAt);
";

pub struct V0008AnalysisArtifact;

impl Migration for V0008AnalysisArtifact {
    fn version(&self) -> i64 {
        8
    }

    fn up(&self, conn: &Connection) -> Result<(), MigrationError> {
        conn.execute_batch(V8_ANALYSIS_ARTIFACT_DDL)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migration::run_migrations;
    use rusqlite::Connection;

    fn open_full_schema() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn creates_table_and_indexes() {
        let conn = open_full_schema();

        let table_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master \
                 WHERE type = 'table' AND name = 'AnalysisArtifact'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table_count, 1);

        let indexes: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master \
                 WHERE type = 'index' AND name LIKE 'idx_analysis_artifact_%' \
                 ORDER BY name",
            )
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();

        assert_eq!(
            indexes,
            vec![
                "idx_analysis_artifact_experiment_updated".to_string(),
                "idx_analysis_artifact_key".to_string(),
                "idx_analysis_artifact_last_accessed".to_string(),
            ]
        );
    }

    #[test]
    fn artifacts_cascade_with_experiment_delete() {
        let conn = open_full_schema();
        conn.execute(
            "INSERT INTO User (id, name, email, role, isActive, createdAt, updatedAt)
             VALUES ('desktop-local-admin', 'Admin', 'admin@test', 'admin', 1,
                     datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO Experiment \
             (id, createdAt, updatedAt, originalFilename, testDate, instrumentType, \
              durationSeconds, avgTemperatureC, name, waterSource, waterParams, fluidType, \
              testGroup, metrics, rawPoints, userId) \
             VALUES ('exp-cache-1', datetime('now'), datetime('now'), 'f.csv', \
              '2026-04-29', 'Grace', 10, 25, 'Exp', 'Lab', '{}', 'Gel', \
              'Group', '{}', '[]', 'desktop-local-admin')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO AnalysisArtifact \
             (id, experimentId, experimentDataHash, geometry, analysisSettingsHash, \
              reportViscosityRatesHash, rheolabCoreVersion, algorithmVersion, \
              artifactEncoding, artifactBlob, artifactBytes, createdAt, updatedAt) \
             VALUES ('aa-1', 'exp-cache-1', 'dh', 'R1B5', 'ash', 'rrh', \
              '0.0.0-test', 1, 'analysis-output.json+zstd:v1', x'00', 1, \
              datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();

        conn.execute("DELETE FROM Experiment WHERE id = 'exp-cache-1'", [])
            .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM AnalysisArtifact", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn up_is_idempotent() {
        let conn = open_full_schema();
        V0008AnalysisArtifact.up(&conn).unwrap();
        V0008AnalysisArtifact.up(&conn).unwrap();

        let table_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master \
                 WHERE type = 'table' AND name = 'AnalysisArtifact'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table_count, 1);
    }
}
