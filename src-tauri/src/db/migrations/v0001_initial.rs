use rusqlite::Connection;
use super::error::MigrationError;
use super::r#trait::Migration;

/// The entire initial schema — 22 tables, indexes, FTS5 virtual table, and
/// triggers — created idempotently with `IF NOT EXISTS` guards.
///
/// `pub(crate)` so that integration tests in `migration.rs` can execute the
/// raw DDL directly (e.g. to simulate a pre-versioned legacy database where
/// schema_meta already existed but had no recorded version).
pub(crate) const V1_DDL: &str = r#"
-- ============================================
-- Schema version tracking (singleton, id = 1)
-- ============================================

CREATE TABLE IF NOT EXISTS schema_meta (
    id             INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version INTEGER NOT NULL,
    app_version    TEXT    NOT NULL,
    migrated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ============================================
-- Users & Auth
-- ============================================

CREATE TABLE IF NOT EXISTS User (
    id             TEXT PRIMARY KEY,
    name           TEXT,
    email          TEXT UNIQUE,
    emailVerified  TEXT, -- datetime as ISO string
    image          TEXT,
    password       TEXT,
    role           TEXT NOT NULL DEFAULT 'operator', -- 'admin', 'operator', 'viewer'
    isActive       INTEGER NOT NULL DEFAULT 1,
    laboratoryId   TEXT,
    createdAt      TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt      TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (laboratoryId) REFERENCES Laboratory(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS Settings (
    id               TEXT PRIMARY KEY,
    userId           TEXT NOT NULL UNIQUE,
    language         TEXT NOT NULL DEFAULT 'ru',
    theme            TEXT NOT NULL DEFAULT 'dark',
    unitSystem       TEXT NOT NULL DEFAULT 'si',
    unitPreferences  TEXT, -- JSON
    timeShiftEnabled INTEGER NOT NULL DEFAULT 0,
    deviceName       TEXT,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS APIKey (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    key       TEXT NOT NULL,
    provider  TEXT NOT NULL DEFAULT 'groq',
    isActive  INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
    userId    TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_apikey_userid ON APIKey(userId);

-- ============================================
-- System State (HMAC-protected)
-- ============================================

CREATE TABLE IF NOT EXISTS SystemState (
    key       TEXT PRIMARY KEY,
    value     TEXT NOT NULL,
    signature TEXT NOT NULL,
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================
-- Reagent Catalog
-- ============================================

CREATE TABLE IF NOT EXISTS ReagentCatalog (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    category        TEXT NOT NULL,
    manufacturer    TEXT,
    country         TEXT,
    description     TEXT,
    activeSubstance TEXT,
    form            TEXT,
    extraFields     TEXT NOT NULL DEFAULT '{}',
    createdAt       TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================
-- Laboratory
-- ============================================

CREATE TABLE IF NOT EXISTS Laboratory (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    location    TEXT,
    createdAt   TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================
-- Operator
-- ============================================

CREATE TABLE IF NOT EXISTS Operator (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL UNIQUE,
    position  TEXT,
    isActive  INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_operator_name ON Operator(name COLLATE NOCASE);

-- ============================================
-- Water Source Catalog
-- ============================================

CREATE TABLE IF NOT EXISTS WaterSourceCatalog (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    location    TEXT,
    composition TEXT,
    notes       TEXT,
    createdAt   TEXT NOT NULL,
    updatedAt   TEXT NOT NULL
);

-- ============================================
-- Core Experiment
-- ============================================

CREATE TABLE IF NOT EXISTS Experiment (
    id               TEXT PRIMARY KEY,
    createdAt        TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt        TEXT NOT NULL DEFAULT (datetime('now')),
    originalFilename TEXT NOT NULL,
    testDate         TEXT NOT NULL,
    instrumentType   TEXT NOT NULL,
    geometry         TEXT,
    geometrySource   TEXT,
    durationSeconds  INTEGER,
    avgTemperatureC  REAL,
    maxTemperatureC  REAL,
    maxViscosity     INTEGER,
    avgViscosity     INTEGER,   -- V4: average viscosity across all points
    name             TEXT NOT NULL,
    fieldName        TEXT,
    operatorName     TEXT,
    wellNumber       TEXT,
    testId           TEXT,
    waterSource      TEXT NOT NULL,
    waterParams      TEXT, -- JSON
    fluidType        TEXT NOT NULL,
    testGroup        TEXT NOT NULL,
    testSubGroup     TEXT,
    metrics          TEXT NOT NULL, -- JSON
    rawPoints        TEXT NOT NULL, -- JSON
    calibration      TEXT,          -- JSON blob
    userId           TEXT NOT NULL,
    laboratoryId     TEXT,
    -- V8 metadata round-trip columns:
    parsedBy         TEXT,
    parseSource      TEXT,
    timeRangeMin     REAL,
    timeRangeMax     REAL,
    viscosityMin     INTEGER,
    pressureMax      REAL,
    extraFields      TEXT NOT NULL DEFAULT '{}',
    testCategory     TEXT DEFAULT NULL,          -- V4: 2-level taxonomy (Fracturing/Drilling/General)
    testType         TEXT DEFAULT NULL,           -- V4: specific test method
    dominantPattern  TEXT DEFAULT NULL,           -- V5: dominant cycle pattern (ISO/API/SST/Custom)
    waterSourceId    TEXT REFERENCES WaterSourceCatalog(id),
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE RESTRICT,
    FOREIGN KEY (laboratoryId) REFERENCES Laboratory(id)
);
CREATE INDEX IF NOT EXISTS idx_experiment_user_created ON Experiment(userId, createdAt);
CREATE INDEX IF NOT EXISTS idx_experiment_lab_created ON Experiment(laboratoryId, createdAt);
CREATE INDEX IF NOT EXISTS idx_experiment_field_operator ON Experiment(fieldName, operatorName);
CREATE INDEX IF NOT EXISTS idx_experiment_water_source ON Experiment(waterSource);
CREATE INDEX IF NOT EXISTS idx_experiment_test_date ON Experiment(testDate);
-- Index for duplicate-detection query used on every experiment save and import
CREATE INDEX IF NOT EXISTS idx_experiment_dedup ON Experiment(originalFilename, testDate, name COLLATE NOCASE);
-- Index for text-filter query on originalFilename column
CREATE INDEX IF NOT EXISTS idx_experiment_orig_filename ON Experiment(originalFilename);

-- V7 composite indexes for common list/filter query patterns
CREATE INDEX IF NOT EXISTS idx_experiment_type_date  ON Experiment(instrumentType, testDate);
CREATE INDEX IF NOT EXISTS idx_experiment_water_date ON Experiment(waterSource, testDate);
CREATE INDEX IF NOT EXISTS idx_experiment_lab_date   ON Experiment(laboratoryId, testDate);

-- Additional single-column indexes used for filtering in the library
CREATE INDEX IF NOT EXISTS idx_experiment_name          ON Experiment(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_experiment_test_category ON Experiment(testCategory);
CREATE INDEX IF NOT EXISTS idx_experiment_dominant_pattern ON Experiment(dominantPattern);
CREATE INDEX IF NOT EXISTS idx_experiment_geometry      ON Experiment(geometry);
CREATE INDEX IF NOT EXISTS idx_experiment_fluid_type    ON Experiment(fluidType);

-- WP-3.3 performance indexes: previously unindexed query paths
-- sync_engine: SELECT id FROM Experiment WHERE updatedAt > ?1 ORDER BY updatedAt
CREATE INDEX IF NOT EXISTS idx_experiment_updated_at ON Experiment(updatedAt);
-- list/query.rs: WHERE e.testType = ? (exact match filter, not covered by FTS5)
CREATE INDEX IF NOT EXISTS idx_experiment_test_type ON Experiment(testType);

-- ============================================
-- ExperimentData — columnar-binary + zstd blob storage (V6 + V10 FK fix)
-- ON DELETE/UPDATE CASCADE ensures orphan blobs are cleaned up automatically.
-- ============================================

CREATE TABLE IF NOT EXISTS ExperimentData (
    experimentId  TEXT    PRIMARY KEY
                      REFERENCES Experiment(id)
                      ON DELETE CASCADE
                      ON UPDATE CASCADE,
    dataBlob      BLOB    NOT NULL,
    encoding      TEXT    NOT NULL DEFAULT 'columnar-v1-zstd',
    pointCount    INTEGER NOT NULL DEFAULT 0,
    createdAt     TEXT    NOT NULL,
    updatedAt     TEXT    NOT NULL
);

-- ============================================
-- Calibration (1:1 with Experiment)
-- ============================================

CREATE TABLE IF NOT EXISTS Calibration (
    id              TEXT PRIMARY KEY,
    createdAt       TEXT NOT NULL DEFAULT (datetime('now')),
    deviceType      TEXT NOT NULL,
    calibrationDate TEXT,
    rSquared        REAL NOT NULL,
    slope           REAL NOT NULL,
    intercept       REAL NOT NULL,
    hysteresis      REAL NOT NULL,
    stdev           REAL NOT NULL,
    status          TEXT NOT NULL,
    rawData         TEXT NOT NULL, -- JSON
    issues          TEXT,         -- JSON
    experimentId    TEXT NOT NULL UNIQUE,
    FOREIGN KEY (experimentId) REFERENCES Experiment(id) ON DELETE CASCADE
);

-- ============================================
-- Experiment-Reagent Link
-- ============================================

CREATE TABLE IF NOT EXISTS ExperimentReagent (
    id             TEXT PRIMARY KEY,
    experimentId   TEXT NOT NULL,
    reagentId      TEXT,
    reagentName    TEXT,    -- denormalised for historical integrity
    category       TEXT,    -- denormalised
    concentration  REAL NOT NULL,
    unit           TEXT NOT NULL,
    batchNumber    TEXT,
    productionDate TEXT,
    FOREIGN KEY (experimentId) REFERENCES Experiment(id) ON DELETE CASCADE,
    FOREIGN KEY (reagentId) REFERENCES ReagentCatalog(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_experiment_reagent_batch ON ExperimentReagent(batchNumber);
CREATE INDEX IF NOT EXISTS idx_experiment_reagent_pair ON ExperimentReagent(experimentId, reagentId);
CREATE INDEX IF NOT EXISTS idx_reagent_name_nocase ON ReagentCatalog(name COLLATE NOCASE);

-- ============================================
-- V2 Operational: Import / Payload / Artifact
-- ============================================

CREATE TABLE IF NOT EXISTS ImportBatch (
    id                  TEXT PRIMARY KEY,
    sourceLabId         TEXT,
    sourceSystem        TEXT,
    sourceAppVersion    TEXT,
    importedByUserId    TEXT,
    fileName            TEXT,
    checksum            TEXT,
    notes               TEXT,
    experimentsImported INTEGER NOT NULL DEFAULT 0,
    duplicatesDetected  INTEGER NOT NULL DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'completed',
    createdAt           TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_import_batch_created ON ImportBatch(createdAt);
CREATE INDEX IF NOT EXISTS idx_import_batch_source ON ImportBatch(sourceLabId, createdAt);

CREATE TABLE IF NOT EXISTS ExperimentPayload (
    id                 TEXT PRIMARY KEY,
    experimentId       TEXT NOT NULL,
    importBatchId      TEXT,
    payloadVersion     INTEGER NOT NULL DEFAULT 1,
    payloadFormat      TEXT NOT NULL,
    payloadCompression TEXT,
    payloadJson        TEXT NOT NULL,
    contentFingerprint TEXT NOT NULL,
    sourceLabId        TEXT,
    sourceSystem       TEXT,
    sourceAppVersion   TEXT,
    isCanonical        INTEGER NOT NULL DEFAULT 0,
    createdAt          TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (experimentId) REFERENCES Experiment(id) ON DELETE CASCADE,
    FOREIGN KEY (importBatchId) REFERENCES ImportBatch(id) ON DELETE SET NULL,
    UNIQUE(experimentId, payloadVersion)
);
CREATE INDEX IF NOT EXISTS idx_payload_exp_created ON ExperimentPayload(experimentId, createdAt);
CREATE INDEX IF NOT EXISTS idx_payload_fingerprint ON ExperimentPayload(contentFingerprint);
CREATE INDEX IF NOT EXISTS idx_payload_source ON ExperimentPayload(sourceLabId, createdAt);

CREATE TABLE IF NOT EXISTS ParserArtifact (
    id                 TEXT PRIMARY KEY,
    experimentId       TEXT NOT NULL,
    importBatchId      TEXT,
    parserVersion      TEXT NOT NULL,
    schemaVersion      TEXT NOT NULL,
    artifactJson       TEXT NOT NULL,
    contentFingerprint TEXT NOT NULL,
    promotedToHot      INTEGER NOT NULL DEFAULT 0,
    createdAt          TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (experimentId) REFERENCES Experiment(id) ON DELETE CASCADE,
    FOREIGN KEY (importBatchId) REFERENCES ImportBatch(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_parser_exp_created ON ParserArtifact(experimentId, createdAt);
CREATE INDEX IF NOT EXISTS idx_parser_fingerprint ON ParserArtifact(contentFingerprint);

CREATE TABLE IF NOT EXISTS ReportArtifact (
    id              TEXT PRIMARY KEY,
    experimentId    TEXT NOT NULL,
    importBatchId   TEXT,
    reportType      TEXT NOT NULL,
    templateVersion TEXT,
    settingsJson    TEXT,
    storagePath     TEXT,
    binarySha256    TEXT,
    sizeBytes       INTEGER,
    createdAt       TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (experimentId) REFERENCES Experiment(id) ON DELETE CASCADE,
    FOREIGN KEY (importBatchId) REFERENCES ImportBatch(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_report_exp_created ON ReportArtifact(experimentId, createdAt);
CREATE INDEX IF NOT EXISTS idx_report_sha ON ReportArtifact(binarySha256);

-- ============================================
-- V2 Operational: Search / Sync / Merge
-- ============================================

CREATE TABLE IF NOT EXISTS SearchProjectionLog (
    id                TEXT PRIMARY KEY,
    experimentId      TEXT,
    operation         TEXT NOT NULL,
    projectionVersion TEXT NOT NULL,
    detailsJson       TEXT,
    createdAt         TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (experimentId) REFERENCES Experiment(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_search_created ON SearchProjectionLog(createdAt);
CREATE INDEX IF NOT EXISTS idx_search_exp_created ON SearchProjectionLog(experimentId, createdAt);

CREATE TABLE IF NOT EXISTS SyncOutbox (
    id            TEXT PRIMARY KEY,
    entityType    TEXT NOT NULL,
    entityId      TEXT NOT NULL,
    operation     TEXT NOT NULL,
    payloadJson   TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    retryCount    INTEGER NOT NULL DEFAULT 0,
    nextAttemptAt TEXT,
    lastError     TEXT,
    createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
    processedAt   TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON SyncOutbox(status, nextAttemptAt);
CREATE INDEX IF NOT EXISTS idx_outbox_entity ON SyncOutbox(entityType, entityId, createdAt);

CREATE TABLE IF NOT EXISTS SyncInbox (
    id               TEXT PRIMARY KEY,
    remoteEventId    TEXT NOT NULL UNIQUE,
    sourceLabId      TEXT,
    sourceSystem     TEXT,
    sourceAppVersion TEXT,
    payloadJson      TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending',
    receivedAt       TEXT NOT NULL DEFAULT (datetime('now')),
    processedAt      TEXT,
    importBatchId    TEXT,
    FOREIGN KEY (importBatchId) REFERENCES ImportBatch(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_inbox_status ON SyncInbox(status, receivedAt);
CREATE INDEX IF NOT EXISTS idx_inbox_source ON SyncInbox(sourceLabId, receivedAt);

CREATE TABLE IF NOT EXISTS MergeEvent (
    id                    TEXT PRIMARY KEY,
    canonicalExperimentId TEXT,
    incomingExperimentId  TEXT,
    importBatchId         TEXT,
    fieldClass            TEXT NOT NULL,
    resolutionPolicy      TEXT NOT NULL,
    resolutionSummary     TEXT,
    createdAt             TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (canonicalExperimentId) REFERENCES Experiment(id) ON DELETE SET NULL,
    FOREIGN KEY (incomingExperimentId) REFERENCES Experiment(id) ON DELETE SET NULL,
    FOREIGN KEY (importBatchId) REFERENCES ImportBatch(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_merge_canonical ON MergeEvent(canonicalExperimentId, createdAt);
CREATE INDEX IF NOT EXISTS idx_merge_incoming ON MergeEvent(incomingExperimentId, createdAt);
CREATE INDEX IF NOT EXISTS idx_merge_import ON MergeEvent(importBatchId, createdAt);

CREATE TABLE IF NOT EXISTS ConflictRecord (
    id            TEXT PRIMARY KEY,
    mergeEventId  TEXT,
    experimentId  TEXT,
    fieldName     TEXT NOT NULL,
    localValue    TEXT,
    incomingValue TEXT,
    resolution    TEXT,
    status        TEXT NOT NULL DEFAULT 'open',
    createdAt     TEXT NOT NULL DEFAULT (datetime('now')),
    resolvedAt    TEXT,
    FOREIGN KEY (mergeEventId) REFERENCES MergeEvent(id) ON DELETE SET NULL,
    FOREIGN KEY (experimentId) REFERENCES Experiment(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_conflict_status ON ConflictRecord(status, createdAt);
CREATE INDEX IF NOT EXISTS idx_conflict_exp    ON ConflictRecord(experimentId, fieldName);
CREATE INDEX IF NOT EXISTS idx_conflict_merge  ON ConflictRecord(mergeEventId);

-- ============================================
-- FTS5 full-text search (10-column, matches V7 migration)
-- ============================================

CREATE VIRTUAL TABLE IF NOT EXISTS fts_experiment USING fts5(
    name,
    originalFilename,
    fieldName,
    operatorName,
    wellNumber,
    waterSource,
    instrumentType,
    fluidType,
    testCategory,
    testType,
    content='Experiment',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS fts_experiment_ai
    AFTER INSERT ON Experiment BEGIN
        INSERT INTO fts_experiment(rowid, name, originalFilename, fieldName, operatorName, wellNumber, waterSource, instrumentType, fluidType, testCategory, testType)
        VALUES (new.rowid, new.name, new.originalFilename, new.fieldName, new.operatorName, new.wellNumber, new.waterSource, new.instrumentType, new.fluidType, new.testCategory, new.testType);
    END;

CREATE TRIGGER IF NOT EXISTS fts_experiment_ad
    AFTER DELETE ON Experiment BEGIN
        INSERT INTO fts_experiment(fts_experiment, rowid, name, originalFilename, fieldName, operatorName, wellNumber, waterSource, instrumentType, fluidType, testCategory, testType)
        VALUES ('delete', old.rowid, old.name, old.originalFilename, old.fieldName, old.operatorName, old.wellNumber, old.waterSource, old.instrumentType, old.fluidType, old.testCategory, old.testType);
    END;

CREATE TRIGGER IF NOT EXISTS fts_experiment_au
    AFTER UPDATE ON Experiment BEGIN
        INSERT INTO fts_experiment(fts_experiment, rowid, name, originalFilename, fieldName, operatorName, wellNumber, waterSource, instrumentType, fluidType, testCategory, testType)
        VALUES ('delete', old.rowid, old.name, old.originalFilename, old.fieldName, old.operatorName, old.wellNumber, old.waterSource, old.instrumentType, old.fluidType, old.testCategory, old.testType);
        INSERT INTO fts_experiment(rowid, name, originalFilename, fieldName, operatorName, wellNumber, waterSource, instrumentType, fluidType, testCategory, testType)
        VALUES (new.rowid, new.name, new.originalFilename, new.fieldName, new.operatorName, new.wellNumber, new.waterSource, new.instrumentType, new.fluidType, new.testCategory, new.testType);
    END;
"#;

/// Initial schema migration: creates all V1 tables, indexes, and triggers.
pub struct V0001Initial;

impl Migration for V0001Initial {
    fn version(&self) -> i64 {
        1
    }

    fn up(&self, conn: &Connection) -> Result<(), MigrationError> {
        conn.execute_batch(V1_DDL)?;
        Ok(())
    }
}
