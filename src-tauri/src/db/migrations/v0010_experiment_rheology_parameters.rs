//! v0010 - Persist calculated rheology parameters by source.
//!
//! Raw measurement points remain in `ExperimentData`. This migration adds a
//! narrow side table for per-cycle calculated parameters so reports can use
//! either values parsed from the instrument report or values calculated by
//! RheoLab from the raw points.

use super::error::MigrationError;
use super::r#trait::Migration;
use rusqlite::Connection;
use std::collections::HashSet;

pub(crate) const V10_TABLE_DDL: &str = "\
CREATE TABLE IF NOT EXISTS ExperimentRheologyParameter (
    experimentId     TEXT NOT NULL,
    source           TEXT NOT NULL CHECK (source IN ('instrument', 'program')),
    cycleNo          INTEGER NOT NULL,
    timeMin          REAL,
    endTimeMin       REAL,
    tempC            REAL,
    pressureBar      REAL,
    nPrime           REAL,
    kvPaSn           REAL,
    kPrimePaSn       REAL,
    kSlotPaSn        REAL,
    kPipePaSn        REAL,
    r2               REAL,
    viscositiesJson  TEXT NOT NULL DEFAULT '{}',
    binghamPvPaS     REAL,
    binghamYpPa      REAL,
    binghamR2        REAL,
    calcPoints       INTEGER,
    sourceSheet      TEXT,
    sourceRow        INTEGER,
    unitsJson        TEXT NOT NULL DEFAULT '{}',
    createdAt        TEXT NOT NULL,
    updatedAt        TEXT NOT NULL,
    PRIMARY KEY (experimentId, source, cycleNo),
    UNIQUE(experimentId, source, cycleNo),
    FOREIGN KEY (experimentId)
        REFERENCES Experiment(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_erp_experiment_source
ON ExperimentRheologyParameter(experimentId, source);

CREATE INDEX IF NOT EXISTS idx_erp_source_cycle
ON ExperimentRheologyParameter(source, cycleNo);
";

pub(crate) const V10_SOURCE_COLUMN_DDL: &str = "\
ALTER TABLE Experiment
ADD COLUMN rheologySource TEXT NOT NULL DEFAULT 'program'
CHECK (rheologySource IN ('instrument', 'program'))";

pub struct V0010ExperimentRheologyParameters;

impl Migration for V0010ExperimentRheologyParameters {
    fn version(&self) -> i64 {
        10
    }

    fn up(&self, conn: &Connection) -> Result<(), MigrationError> {
        let mut existing: HashSet<String> = HashSet::new();
        {
            let mut stmt = conn.prepare("PRAGMA table_info(Experiment)")?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
            for name in rows {
                existing.insert(name?);
            }
        }

        if !existing.contains("rheologySource") {
            conn.execute(V10_SOURCE_COLUMN_DDL, [])?;
        }
        conn.execute_batch(V10_TABLE_DDL)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migration::run_migrations;

    fn open_full_schema() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    #[test]
    fn creates_rheology_parameter_table_and_source_column() {
        let conn = open_full_schema();

        let has_source: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM pragma_table_info('Experiment') WHERE name = 'rheologySource'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(has_source);

        let has_table: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='ExperimentRheologyParameter'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(has_table);

        let fk_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_foreign_key_list('ExperimentRheologyParameter')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(fk_count, 1);
    }

    #[test]
    fn rheology_parameters_cascade_with_experiment_delete() {
        let conn = open_full_schema();
        conn.execute(
            "INSERT INTO User (id, name, email, role, isActive, createdAt, updatedAt)
             VALUES ('desktop-local-admin', 'Admin', 'admin@test', 'admin', 1,
                     datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO Experiment
             (id, createdAt, updatedAt, originalFilename, testDate, instrumentType,
              durationSeconds, avgTemperatureC, name, waterSource, waterParams, fluidType,
              testGroup, metrics, rawPoints, userId, rheologySource)
             VALUES ('exp-rheo-1', datetime('now'), datetime('now'), 'f.csv',
              '2026-04-29', 'Grace', 10, 25, 'Exp', 'Lab', '{}', 'Gel',
              'Group', '{}', '[]', 'desktop-local-admin', 'instrument')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ExperimentRheologyParameter
             (experimentId, source, cycleNo, nPrime, kPrimePaSn, viscositiesJson, unitsJson,
              createdAt, updatedAt)
             VALUES ('exp-rheo-1', 'instrument', 1, 0.62, 0.15, '{}', '{}',
                     datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();

        conn.execute("DELETE FROM Experiment WHERE id = 'exp-rheo-1'", [])
            .unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM ExperimentRheologyParameter",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }
}
