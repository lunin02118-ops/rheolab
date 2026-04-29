//! v0009 - Denormalized library list projection and facet cache.
//!
//! Sprint 5 adds read-model tables for the experiment library. The migration
//! is intentionally additive and does not backfill data synchronously; runtime
//! maintenance jobs build projection rows after startup or on demand.

use super::error::MigrationError;
use super::r#trait::Migration;
use rusqlite::Connection;

pub(crate) const V9_EXPERIMENT_LIST_PROJECTION_DDL: &str = "\
CREATE TABLE IF NOT EXISTS ExperimentListProjection (
    experimentId TEXT PRIMARY KEY,

    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    testDate TEXT NOT NULL,
    name TEXT NOT NULL,
    originalFilename TEXT NOT NULL,

    userId TEXT,
    userName TEXT,
    userEmail TEXT,
    laboratoryId TEXT,
    laboratoryName TEXT,

    fieldName TEXT,
    operatorName TEXT,
    wellNumber TEXT,
    testId TEXT,

    instrumentType TEXT NOT NULL,
    geometry TEXT,
    geometrySource TEXT,
    waterSource TEXT NOT NULL,
    waterParams TEXT,
    fluidType TEXT NOT NULL,

    testGroup TEXT NOT NULL,
    testSubGroup TEXT,
    testCategory TEXT,
    testType TEXT,
    dominantPattern TEXT,

    maxViscosity INTEGER,
    avgViscosity INTEGER,
    durationSeconds REAL,
    avgTemperatureC REAL,
    maxTemperatureC REAL,

    touchHasCrossing INTEGER,
    touchCrossingTimeMin REAL,
    touchCrossingViscosityCp REAL,
    touchViscosityAtTargetCp REAL,
    touchPrecomputeVersion INTEGER,

    reagentSummaryJson TEXT NOT NULL DEFAULT '[]',
    reagentSearchText TEXT NOT NULL DEFAULT '',
    searchText TEXT NOT NULL DEFAULT '',

    projectionVersion INTEGER NOT NULL,
    projectionUpdatedAt TEXT NOT NULL,

    FOREIGN KEY (experimentId)
        REFERENCES Experiment(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_elp_testdate_id_desc
ON ExperimentListProjection(testDate DESC, experimentId DESC);

CREATE INDEX IF NOT EXISTS idx_elp_created_id_desc
ON ExperimentListProjection(createdAt DESC, experimentId DESC);

CREATE INDEX IF NOT EXISTS idx_elp_updated_id_desc
ON ExperimentListProjection(updatedAt DESC, experimentId DESC);

CREATE INDEX IF NOT EXISTS idx_elp_laboratory_testdate
ON ExperimentListProjection(laboratoryId, testDate DESC, experimentId DESC);

CREATE INDEX IF NOT EXISTS idx_elp_instrument_testdate
ON ExperimentListProjection(instrumentType, testDate DESC, experimentId DESC);

CREATE INDEX IF NOT EXISTS idx_elp_fluid_testdate
ON ExperimentListProjection(fluidType, testDate DESC, experimentId DESC);

CREATE INDEX IF NOT EXISTS idx_elp_geometry_testdate
ON ExperimentListProjection(geometry, testDate DESC, experimentId DESC);

CREATE INDEX IF NOT EXISTS idx_elp_testtype_testdate
ON ExperimentListProjection(testType, testDate DESC, experimentId DESC);

CREATE INDEX IF NOT EXISTS idx_elp_touch_crossing
ON ExperimentListProjection(touchHasCrossing, touchCrossingTimeMin, experimentId);

CREATE TABLE IF NOT EXISTS ExperimentFacetCache (
    facetName TEXT NOT NULL,
    facetValue TEXT NOT NULL,
    count INTEGER NOT NULL,
    sortKey TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    PRIMARY KEY (facetName, facetValue)
);

CREATE INDEX IF NOT EXISTS idx_experiment_facet_cache_name_sort
ON ExperimentFacetCache(facetName, sortKey);

CREATE TABLE IF NOT EXISTS ExperimentProjectionMeta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updatedAt TEXT NOT NULL
);
";

pub struct V0009ExperimentListProjection;

impl Migration for V0009ExperimentListProjection {
    fn version(&self) -> i64 {
        9
    }

    fn up(&self, conn: &Connection) -> Result<(), MigrationError> {
        conn.execute_batch(V9_EXPERIMENT_LIST_PROJECTION_DDL)?;
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
    fn creates_projection_tables_and_indexes() {
        let conn = open_full_schema();

        let tables: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master \
                 WHERE type = 'table' AND name LIKE 'Experiment%Projection%' \
                    OR type = 'table' AND name = 'ExperimentFacetCache' \
                 ORDER BY name",
            )
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();

        assert_eq!(
            tables,
            vec![
                "ExperimentFacetCache".to_string(),
                "ExperimentListProjection".to_string(),
                "ExperimentProjectionMeta".to_string(),
            ]
        );

        let indexes: Vec<String> = conn
            .prepare(
                "SELECT name FROM sqlite_master \
                 WHERE type = 'index' AND name LIKE 'idx_elp_%' \
                 ORDER BY name",
            )
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();

        assert!(indexes.contains(&"idx_elp_testdate_id_desc".to_string()));
        assert!(indexes.contains(&"idx_elp_touch_crossing".to_string()));
    }

    #[test]
    fn projection_cascades_with_experiment_delete() {
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
             VALUES ('exp-projection-1', datetime('now'), datetime('now'), 'f.csv', \
              '2026-04-29', 'Grace', 10, 25, 'Exp', 'Lab', '{}', 'Gel', \
              'Group', '{}', '[]', 'desktop-local-admin')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ExperimentListProjection \
             (experimentId, createdAt, updatedAt, testDate, name, originalFilename, \
              instrumentType, waterSource, fluidType, testGroup, projectionVersion, projectionUpdatedAt) \
             VALUES ('exp-projection-1', datetime('now'), datetime('now'), '2026-04-29', \
              'Exp', 'f.csv', 'Grace', 'Lab', 'Gel', 'Group', 1, datetime('now'))",
            [],
        )
        .unwrap();

        conn.execute("DELETE FROM Experiment WHERE id = 'exp-projection-1'", [])
            .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM ExperimentListProjection", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn up_is_idempotent() {
        let conn = open_full_schema();
        V0009ExperimentListProjection.up(&conn).unwrap();
        V0009ExperimentListProjection.up(&conn).unwrap();

        let table_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master \
                 WHERE type = 'table' AND name = 'ExperimentListProjection'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table_count, 1);
    }
}
