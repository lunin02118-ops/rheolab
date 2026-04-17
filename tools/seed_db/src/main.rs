//! Генератор тестовой seed-БД для RheoLab Enterprise.
//!
//! Создаёт `rheolab-seed.db` с ~60 экспериментами (6 тип-приборов × 10 вариантов),
//! каждый с 2-3 реагентами и реалистичными кривыми вязкости.
//!
//! Запуск: `cargo run --manifest-path tools/seed_db/Cargo.toml`
//! Результат: `outputs/seed/rheolab-seed.db`

use byteorder::{LittleEndian, WriteBytesExt};
use chrono::{NaiveDate, Duration};
use rand::Rng;
use rusqlite::{params, Connection};
use std::io::Write;
use uuid::Uuid;

// ═══════════════════════════════════════════════════════════════════════
// Schema DDL — полная схема V2 (20 таблиц + FTS5 + indexes + triggers)
// ═══════════════════════════════════════════════════════════════════════

const V1_DDL: &str = r#"
CREATE TABLE IF NOT EXISTS User (
    id             TEXT PRIMARY KEY,
    name           TEXT,
    email          TEXT UNIQUE,
    emailVerified  TEXT,
    image          TEXT,
    password       TEXT,
    role           TEXT NOT NULL DEFAULT 'operator',
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
    unitPreferences  TEXT,
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

CREATE TABLE IF NOT EXISTS SystemState (
    key       TEXT PRIMARY KEY,
    value     TEXT NOT NULL,
    signature TEXT NOT NULL,
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE TABLE IF NOT EXISTS Laboratory (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    location    TEXT,
    createdAt   TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS WaterSourceCatalog (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    location    TEXT,
    composition TEXT,
    notes       TEXT,
    createdAt   TEXT NOT NULL,
    updatedAt   TEXT NOT NULL
);

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
    avgViscosity     INTEGER,
    name             TEXT NOT NULL,
    fieldName        TEXT,
    operatorName     TEXT,
    wellNumber       TEXT,
    testId           TEXT,
    waterSource      TEXT NOT NULL,
    waterParams      TEXT,
    fluidType        TEXT NOT NULL,
    testGroup        TEXT NOT NULL,
    testSubGroup     TEXT,
    metrics          TEXT NOT NULL,
    rawPoints        TEXT NOT NULL,
    calibration      TEXT,
    userId           TEXT NOT NULL,
    laboratoryId     TEXT,
    parsedBy         TEXT,
    parseSource      TEXT,
    timeRangeMin     REAL,
    timeRangeMax     REAL,
    viscosityMin     INTEGER,
    pressureMax      REAL,
    extraFields      TEXT NOT NULL DEFAULT '{}',
    waterSourceId    TEXT REFERENCES WaterSourceCatalog(id),
    FOREIGN KEY (userId) REFERENCES User(id),
    FOREIGN KEY (laboratoryId) REFERENCES Laboratory(id)
);
CREATE INDEX IF NOT EXISTS idx_experiment_user_created ON Experiment(userId, createdAt);
CREATE INDEX IF NOT EXISTS idx_experiment_lab_created ON Experiment(laboratoryId, createdAt);
CREATE INDEX IF NOT EXISTS idx_experiment_field_operator ON Experiment(fieldName, operatorName);
CREATE INDEX IF NOT EXISTS idx_experiment_water_source ON Experiment(waterSource);
CREATE INDEX IF NOT EXISTS idx_experiment_test_date ON Experiment(testDate);
CREATE INDEX IF NOT EXISTS idx_experiment_dedup ON Experiment(originalFilename, name);
CREATE INDEX IF NOT EXISTS idx_experiment_orig_filename ON Experiment(originalFilename);
CREATE INDEX IF NOT EXISTS idx_experiment_type_date  ON Experiment(instrumentType, testDate);
CREATE INDEX IF NOT EXISTS idx_experiment_water_date ON Experiment(waterSource, testDate);
CREATE INDEX IF NOT EXISTS idx_experiment_lab_date   ON Experiment(laboratoryId, testDate);

CREATE TABLE IF NOT EXISTS ExperimentData (
    experimentId  TEXT PRIMARY KEY REFERENCES Experiment(id) ON DELETE CASCADE ON UPDATE CASCADE,
    dataBlob      BLOB    NOT NULL,
    encoding      TEXT    NOT NULL DEFAULT 'columnar-v1-zstd',
    pointCount    INTEGER NOT NULL DEFAULT 0,
    createdAt     TEXT    NOT NULL,
    updatedAt     TEXT    NOT NULL
);

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
    rawData         TEXT NOT NULL,
    issues          TEXT,
    experimentId    TEXT NOT NULL UNIQUE,
    FOREIGN KEY (experimentId) REFERENCES Experiment(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ExperimentReagent (
    id             TEXT PRIMARY KEY,
    experimentId   TEXT NOT NULL,
    reagentId      TEXT,
    reagentName    TEXT,
    category       TEXT,
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

CREATE VIRTUAL TABLE IF NOT EXISTS fts_experiment USING fts5(
    name, originalFilename, fieldName, operatorName, wellNumber, waterSource,
    content='Experiment', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS fts_experiment_ai
    AFTER INSERT ON Experiment BEGIN
        INSERT INTO fts_experiment(rowid, name, originalFilename, fieldName, operatorName, wellNumber, waterSource)
        VALUES (new.rowid, new.name, new.originalFilename, new.fieldName, new.operatorName, new.wellNumber, new.waterSource);
    END;

CREATE TRIGGER IF NOT EXISTS fts_experiment_ad
    AFTER DELETE ON Experiment BEGIN
        INSERT INTO fts_experiment(fts_experiment, rowid, name, originalFilename, fieldName, operatorName, wellNumber, waterSource)
        VALUES ('delete', old.rowid, old.name, old.originalFilename, old.fieldName, old.operatorName, old.wellNumber, old.waterSource);
    END;

CREATE TRIGGER IF NOT EXISTS fts_experiment_au
    AFTER UPDATE ON Experiment BEGIN
        INSERT INTO fts_experiment(fts_experiment, rowid, name, originalFilename, fieldName, operatorName, wellNumber, waterSource)
        VALUES ('delete', old.rowid, old.name, old.originalFilename, old.fieldName, old.operatorName, old.wellNumber, old.waterSource);
        INSERT INTO fts_experiment(rowid, name, originalFilename, fieldName, operatorName, wellNumber, waterSource)
        VALUES (new.rowid, new.name, new.originalFilename, new.fieldName, new.operatorName, new.wellNumber, new.waterSource);
    END;
"#;

// ═══════════════════════════════════════════════════════════════════════
// Instrument/fixture templates
// ═══════════════════════════════════════════════════════════════════════

/// Шаблон прибора: тип, геометрия, расширение файла, диап. температур, диап. вязкости
struct InstrumentTemplate {
    instrument_type: &'static str,
    geometry: &'static str,
    geometry_source: &'static str,
    file_ext: &'static str,
    temp_target: f64,    // целевая температура °C
    temp_ramp: bool,     // рамп от комнатной до целевой
    visc_peak: f64,      // пик вязкости cP
    visc_stable: f64,    // стабильная вязкость cP
    duration_sec: f64,   // длительность теста
    fluid_type: &'static str,
    test_group: &'static str,
    test_sub_group: &'static str,
    channels: &'static [&'static str], // каналы данных
    has_pressure: bool,
    name_prefix: &'static str,
}

const TEMPLATES: &[InstrumentTemplate] = &[
    // 1. Chandler SST — короткий тест статического сдвига
    InstrumentTemplate {
        instrument_type: "Chandler 5550",
        geometry: "R1B5",
        geometry_source: "context",
        file_ext: "csv",
        temp_target: 63.0,
        temp_ramp: true,
        visc_peak: 2500.0,
        visc_stable: 1200.0,
        duration_sec: 3600.0,
        fluid_type: "Crosslinked",
        test_group: "Rheology",
        test_sub_group: "SST",
        channels: &["time_sec", "viscosity_cp", "temperature_c", "shear_rate", "shear_stress_pa"],
        has_pressure: false,
        name_prefix: "SST Мамонтовское",
    },
    // 2. Chandler SWB — длинный свиб-тест
    InstrumentTemplate {
        instrument_type: "Chandler 5550",
        geometry: "R1B5",
        geometry_source: "context",
        file_ext: "csv",
        temp_target: 96.0,
        temp_ramp: true,
        visc_peak: 3500.0,
        visc_stable: 800.0,
        duration_sec: 7200.0,
        fluid_type: "Crosslinked",
        test_group: "Rheology",
        test_sub_group: "SWB",
        channels: &["time_sec", "viscosity_cp", "temperature_c", "shear_rate", "shear_stress_pa"],
        has_pressure: false,
        name_prefix: "SWB Мамонтовское",
    },
    // 3. Grace M5600 — HPHT вискозиметр с давлением
    InstrumentTemplate {
        instrument_type: "Grace M5600",
        geometry: "R1B5",
        geometry_source: "context",
        file_ext: "xlsx",
        temp_target: 100.0,
        temp_ramp: true,
        visc_peak: 2000.0,
        visc_stable: 600.0,
        duration_sec: 5400.0,
        fluid_type: "Crosslinked",
        test_group: "Rheology",
        test_sub_group: "HPHT",
        channels: &["time_sec", "viscosity_cp", "temperature_c", "shear_rate", "shear_stress_pa", "pressure_bar"],
        has_pressure: true,
        name_prefix: "Grace HPHT",
    },
    // 4. Brookfield — ротационный вискозиметр
    InstrumentTemplate {
        instrument_type: "Brookfield",
        geometry: "SC4-27",
        geometry_source: "manual",
        file_ext: "xlsx",
        temp_target: 25.0,
        temp_ramp: false,
        visc_peak: 800.0,
        visc_stable: 450.0,
        duration_sec: 1800.0,
        fluid_type: "Linear",
        test_group: "Hydration",
        test_sub_group: "Standard 25°C",
        channels: &["time_sec", "viscosity_cp", "temperature_c", "speed_rpm"],
        has_pressure: false,
        name_prefix: "Brookfield гидратация",
    },
    // 5. BSL R1 — бобинный вискозиметр
    InstrumentTemplate {
        instrument_type: "BSL R1",
        geometry: "R1B5",
        geometry_source: "physics",
        file_ext: "xlsx",
        temp_target: 90.0,
        temp_ramp: true,
        visc_peak: 1800.0,
        visc_stable: 500.0,
        duration_sec: 5400.0,
        fluid_type: "Crosslinked",
        test_group: "Rheology",
        test_sub_group: "SWB",
        channels: &["time_sec", "viscosity_cp", "temperature_c", "shear_rate", "shear_stress_pa"],
        has_pressure: false,
        name_prefix: "BSL тест",
    },
    // 6. Ofite 1100 — HPHT консистометр
    InstrumentTemplate {
        instrument_type: "Ofite 1100",
        geometry: "B1",
        geometry_source: "default",
        file_ext: "dat",
        temp_target: 120.0,
        temp_ramp: true,
        visc_peak: 4000.0,
        visc_stable: 1500.0,
        duration_sec: 7200.0,
        fluid_type: "Crosslinked",
        test_group: "Completion",
        test_sub_group: "With Proppant",
        channels: &["time_sec", "viscosity_cp", "temperature_c", "shear_rate", "pressure_bar"],
        has_pressure: true,
        name_prefix: "Ofite 1100 HPHT",
    },
];

// ═══════════════════════════════════════════════════════════════════════
// Reagent recipes (2-3 реагента на эксперимент)
// ═══════════════════════════════════════════════════════════════════════

struct ReagentEntry {
    name: &'static str,
    category: &'static str,
    concentration: f64,
    unit: &'static str,
}

/// 10 рецептур — по одной на каждую копию эксперимента
const RECIPES: &[&[ReagentEntry]] = &[
    // Recipe 0: Гуар + боратный сшиватель + деструктор
    &[
        ReagentEntry { name: "GW-3 Guar Polymer", category: "Viscosifier", concentration: 3.6, unit: "kg/m³" },
        ReagentEntry { name: "Lightning Borate Crosslinker", category: "Crosslinker", concentration: 2.4, unit: "L/m³" },
        ReagentEntry { name: "Legend Breaker", category: "Breaker", concentration: 0.5, unit: "kg/m³" },
    ],
    // Recipe 1: Фрикшн-редьюсер + ПАВ + стабилизатор глин
    &[
        ReagentEntry { name: "FightR", category: "Friction Reducer", concentration: 1.5, unit: "L/m³" },
        ReagentEntry { name: "OptiKleen-WF", category: "Surfactant", concentration: 2.0, unit: "L/m³" },
        ReagentEntry { name: "Legend Clay Control", category: "Clay Control", concentration: 1.0, unit: "L/m³" },
    ],
    // Recipe 2: Гуар + HT-сшиватель + ингибитор
    &[
        ReagentEntry { name: "GW-3 Guar Polymer", category: "Viscosifier", concentration: 4.0, unit: "kg/m³" },
        ReagentEntry { name: "Lightning Borate Crosslinker", category: "Crosslinker", concentration: 3.2, unit: "L/m³" },
        ReagentEntry { name: "Legend Scale Inhibitor", category: "Scale Inhibitor", concentration: 0.8, unit: "L/m³" },
    ],
    // Recipe 3: FLOJET + биоцид
    &[
        ReagentEntry { name: "FLOJET FR", category: "Friction Reducer", concentration: 2.0, unit: "L/m³" },
        ReagentEntry { name: "Legend Biocide", category: "Biocide", concentration: 0.3, unit: "L/m³" },
    ],
    // Recipe 4: FLOJET XL + деструктор + ПАВ
    &[
        ReagentEntry { name: "FLOJET XL", category: "Viscosifier", concentration: 5.0, unit: "L/m³" },
        ReagentEntry { name: "Legend Breaker", category: "Breaker", concentration: 1.0, unit: "kg/m³" },
        ReagentEntry { name: "RenewIQ Frac Water Solution", category: "Surfactant", concentration: 1.5, unit: "L/m³" },
    ],
    // Recipe 5: Гуар + боратный + биоцид
    &[
        ReagentEntry { name: "GW-3 Guar Polymer", category: "Viscosifier", concentration: 3.4, unit: "kg/m³" },
        ReagentEntry { name: "Lightning Borate Crosslinker", category: "Crosslinker", concentration: 2.8, unit: "L/m³" },
        ReagentEntry { name: "Legend Biocide", category: "Biocide", concentration: 0.5, unit: "L/m³" },
    ],
    // Recipe 6: FSC100 + ФР + ПАВ
    &[
        ReagentEntry { name: "FSC100", category: "Scale Inhibitor", concentration: 0.5, unit: "kg/m³" },
        ReagentEntry { name: "FightR", category: "Friction Reducer", concentration: 1.2, unit: "L/m³" },
        ReagentEntry { name: "OptiKleen-WF", category: "Surfactant", concentration: 1.8, unit: "L/m³" },
    ],
    // Recipe 7: Гуар + сшиватель + глин. стаб.
    &[
        ReagentEntry { name: "GW-3 Guar Polymer", category: "Viscosifier", concentration: 3.8, unit: "kg/m³" },
        ReagentEntry { name: "Lightning Borate Crosslinker", category: "Crosslinker", concentration: 2.0, unit: "L/m³" },
        ReagentEntry { name: "Legend Clay Control", category: "Clay Control", concentration: 1.5, unit: "L/m³" },
    ],
    // Recipe 8: FLOJET + ингибитор коррозии
    &[
        ReagentEntry { name: "FLOJET FR", category: "Friction Reducer", concentration: 1.8, unit: "L/m³" },
        ReagentEntry { name: "SICI10074A", category: "Scale Inhibitor", concentration: 0.6, unit: "L/m³" },
        ReagentEntry { name: "FLOJET Scale Inhibitor", category: "Scale Inhibitor", concentration: 0.4, unit: "L/m³" },
    ],
    // Recipe 9: Полный набор — гуар + сшиватель + деструктор
    &[
        ReagentEntry { name: "GW-3 Guar Polymer", category: "Viscosifier", concentration: 4.2, unit: "kg/m³" },
        ReagentEntry { name: "Lightning Borate Crosslinker", category: "Crosslinker", concentration: 3.0, unit: "L/m³" },
        ReagentEntry { name: "Legend Breaker", category: "Breaker", concentration: 0.8, unit: "kg/m³" },
    ],
];

// ═══════════════════════════════════════════════════════════════════════
// Domain data
// ═══════════════════════════════════════════════════════════════════════

const FIELD_NAMES: &[&str] = &[
    "Мамонтовское", "Приобское", "Самотлорское", "Ромашкинское", "Фёдоровское",
    "Ванкорское", "Красноленинское", "Тевлинско-Русскинское", "Повховское", "Южно-Приобское",
];

const OPERATORS: &[&str] = &[
    "Иванов И.И.", "Петров П.П.", "Сидоров С.С.", "Козлов К.К.",
    "Новиков Н.Н.", "Морозов М.М.", "Волков В.В.", "Зайцев А.А.",
];

const WATER_SOURCES: &[&str] = &[
    "Озеро 274 куст", "Артезианская скв. 12", "Водозабор р. Обь",
    "Техническая скв. 405", "Озеро Самотлор", "Водовод куст 87",
    "Пластовая вода ПК-3", "Озеро Имилор", "Артезианская скв. 7",
    "Водозабор Луговой",
];

const LABS: &[(&str, &str)] = &[
    ("Лаборатория ГРП Когалым", "Когалым, Тюменская обл."),
    ("НПЦ Нефтехим", "Нижневартовск"),
    ("ЦПС Лянтор", "Лянтор, ХМАО"),
];

// ═══════════════════════════════════════════════════════════════════════
// Reagent catalog to seed
// ═══════════════════════════════════════════════════════════════════════

const SEED_REAGENTS: &[(&str, &str, &str, &str, &str)] = &[
    // (name, category, manufacturer, country, form)
    ("GW-3 Guar Polymer", "Viscosifier", "Baker Hughes", "США", "Powder"),
    ("Lightning Borate Crosslinker", "Crosslinker", "Baker Hughes", "США", "Liquid"),
    ("FightR", "Friction Reducer", "Halliburton", "США", "Liquid"),
    ("OptiKleen-WF", "Surfactant", "Halliburton", "США", "Liquid"),
    ("Legend Breaker", "Breaker", "Halliburton", "США", "Powder"),
    ("Legend Biocide", "Biocide", "Halliburton", "США", "Liquid"),
    ("Legend Clay Control", "Clay Control", "Halliburton", "США", "Liquid"),
    ("Legend Scale Inhibitor", "Scale Inhibitor", "Halliburton", "США", "Liquid"),
    ("FSC100", "Scale Inhibitor", "ChampionX", "США", "Solid"),
    ("SICI10074A", "Scale Inhibitor", "ChampionX", "США", "Liquid"),
    ("RenewIQ Frac Water Solution", "Surfactant", "ChampionX", "США", "Liquid"),
    ("FLOJET FR", "Friction Reducer", "SNF Group", "США", "Liquid"),
    ("FLOJET XL", "Viscosifier", "SNF Group", "США", "Liquid"),
    ("FLOJET Scale Inhibitor", "Scale Inhibitor", "SNF Group", "США", "Liquid"),
    ("ГПБ-1 Загуститель", "Viscosifier", "ХимПром", "Россия", "Powder"),
    ("Нефтенол К", "Surfactant", "НИИНП", "Россия", "Liquid"),
    ("Сшиватель СБ-1", "Crosslinker", "НПО Буровая техника", "Россия", "Liquid"),
    ("Деструктор ДК-2", "Breaker", "НПО Буровая техника", "Россия", "Powder"),
    ("Бактерицид СНПХ-1003", "Biocide", "СИБУР", "Россия", "Liquid"),
    ("Ингибитор коррозии ИКН-1", "Scale Inhibitor", "КазМунайГаз", "Россия", "Liquid"),
];

// ═══════════════════════════════════════════════════════════════════════
// Columnar-v1-zstd encoder (match src-tauri/src/db/columnar.rs)
// ═══════════════════════════════════════════════════════════════════════

fn encode_columnar_v2_zstd(
    channels: &[&str],
    point_data: &[Vec<f64>],  // point_data[point_idx][channel_idx]
) -> Vec<u8> {
    let point_count = point_data.len() as u32;
    let channel_count = channels.len() as u32;
    let bitmap_bytes = ((point_count as usize) + 7) / 8;

    let capacity = 16
        + channels.iter().map(|c| 2 + c.len()).sum::<usize>()
        + channels.len() * (bitmap_bytes + point_data.len() * 8);
    let mut buf: Vec<u8> = Vec::with_capacity(capacity);

    // Header
    buf.write_all(b"RHLC").unwrap();
    buf.write_u32::<LittleEndian>(2).unwrap(); // version
    buf.write_u32::<LittleEndian>(point_count).unwrap();
    buf.write_u32::<LittleEndian>(channel_count).unwrap();

    // Channel names
    for name in channels {
        let bytes = name.as_bytes();
        buf.write_u16::<LittleEndian>(bytes.len() as u16).unwrap();
        buf.write_all(bytes).unwrap();
    }

    // For each channel: null bitmap + f64 values
    for ch_idx in 0..channels.len() {
        // All values present: bitmap is all 1s
        let mut bitmap = vec![0xFFu8; bitmap_bytes];
        // Clear trailing bits in last byte
        let trailing = (point_count as usize) % 8;
        if trailing != 0 && !bitmap.is_empty() {
            let last = bitmap.len() - 1;
            bitmap[last] = 0xFF << (8 - trailing);
        }
        buf.write_all(&bitmap).unwrap();

        for pt_idx in 0..point_data.len() {
            buf.write_f64::<LittleEndian>(point_data[pt_idx][ch_idx]).unwrap();
        }
    }

    // zstd compress level 3
    zstd::encode_all(buf.as_slice(), 3).expect("zstd encode failed")
}

// ═══════════════════════════════════════════════════════════════════════
// Synthetic data generator
// ═══════════════════════════════════════════════════════════════════════

/// Генерирует реалистичную кривую вязкости для данного шаблона прибора.
fn generate_raw_points(tmpl: &InstrumentTemplate, rng: &mut impl Rng, variant: usize) -> Vec<Vec<f64>> {
    let dt = 10.0; // шаг 10 секунд
    let n_points = (tmpl.duration_sec / dt) as usize;
    let mut points = Vec::with_capacity(n_points);

    // Variant-based noise seed
    let noise_scale = 0.03 + (variant as f64) * 0.005;
    let visc_mult = 0.85 + (variant as f64) * 0.03; // 0.85..1.12

    for i in 0..n_points {
        let t = (i as f64) * dt;
        let frac = t / tmpl.duration_sec;

        // Temperature profile
        let temp = if tmpl.temp_ramp {
            let ramp_frac = (frac * 3.0).min(1.0); // ramp in first 1/3
            25.0 + (tmpl.temp_target - 25.0) * ramp_frac + rng.gen_range(-0.5..0.5)
        } else {
            tmpl.temp_target + rng.gen_range(-0.3..0.3)
        };

        // Viscosity profile: ramp up → peak → gradual decline
        let visc_raw = if frac < 0.15 {
            // Ramp up phase
            let ramp = frac / 0.15;
            tmpl.visc_stable + (tmpl.visc_peak - tmpl.visc_stable) * ramp * ramp
        } else if frac < 0.3 {
            // Peak plateau
            tmpl.visc_peak * (1.0 - 0.1 * (frac - 0.15) / 0.15)
        } else {
            // Decline to stable
            let decay = (-2.0 * (frac - 0.3)).exp();
            tmpl.visc_stable + (tmpl.visc_peak * 0.9 - tmpl.visc_stable) * decay
        };
        let visc = (visc_raw * visc_mult * (1.0 + rng.gen_range(-noise_scale..noise_scale))).max(10.0);

        // Build point with matching channels
        let mut point = Vec::with_capacity(tmpl.channels.len());
        for ch in tmpl.channels {
            let val = match *ch {
                "time_sec" => t,
                "viscosity_cp" => visc,
                "temperature_c" => temp,
                "shear_rate" => {
                    // Stepped shear rate: 100 → 75 → 40 → 100
                    let cycle = ((t / 600.0) as usize) % 4;
                    match cycle {
                        0 => 100.0,
                        1 => 75.0,
                        2 => 40.0,
                        _ => 100.0,
                    }
                },
                "shear_stress_pa" => visc * 0.1 + rng.gen_range(-2.0..2.0),
                "speed_rpm" => 300.0,
                "pressure_bar" => if tmpl.has_pressure {
                    30.0 + rng.gen_range(-1.0..1.0)
                } else {
                    0.0
                },
                _ => 0.0,
            };
            point.push(val);
        }
        points.push(point);
    }

    points
}

// ═══════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════

fn main() {
    let output_dir = std::path::Path::new("outputs/seed");
    std::fs::create_dir_all(output_dir).expect("Failed to create outputs/seed/");
    let db_path = output_dir.join("rheolab-seed.db");

    // Remove existing
    if db_path.exists() {
        std::fs::remove_file(&db_path).expect("Failed to remove old seed DB");
    }

    let conn = Connection::open(&db_path).expect("Failed to create SQLite DB");

    // Pragmas for performance
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;")
        .expect("Pragmas failed");

    // Apply schema
    conn.execute_batch(V1_DDL).expect("Schema DDL failed");
    conn.pragma_update(None, "user_version", 2).expect("user_version failed");

    println!("✓ Схема создана (20 таблиц + FTS5)");

    // ── Seed user ─────────────────────────────────────────────────────
    let user_id = "desktop-local-admin";
    conn.execute(
        "INSERT OR IGNORE INTO User (id, name, role) VALUES (?1, ?2, 'admin')",
        params![user_id, "Администратор"],
    ).unwrap();

    // ── Seed laboratories ─────────────────────────────────────────────
    let mut lab_ids: Vec<String> = Vec::new();
    for (name, location) in LABS {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO Laboratory (id, name, description, location) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, format!("Производственная лаборатория: {name}"), location],
        ).unwrap();
        lab_ids.push(id);
    }
    println!("✓ {} лабораторий", lab_ids.len());

    // ── Seed water sources ────────────────────────────────────────────
    let mut ws_ids: Vec<String> = Vec::new();
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    for ws_name in WATER_SOURCES {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO WaterSourceCatalog (id, name, location, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, ws_name, "ХМАО-Югра", &now, &now],
        ).unwrap();
        ws_ids.push(id);
    }
    println!("✓ {} источников воды", ws_ids.len());

    // ── Seed reagent catalog ──────────────────────────────────────────
    let mut reagent_ids: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for (name, category, manufacturer, country, form) in SEED_REAGENTS {
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT OR IGNORE INTO ReagentCatalog (id, name, category, manufacturer, country, form) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, name, category, manufacturer, country, form],
        ).unwrap();
        reagent_ids.insert(name.to_string(), id);
    }
    println!("✓ {} реагентов в каталоге", reagent_ids.len());

    // ── Generate experiments ──────────────────────────────────────────
    let mut rng = rand::thread_rng();
    let copies_per_template = 10;
    let base_date = NaiveDate::from_ymd_opt(2025, 6, 1).unwrap();
    let mut total_experiments = 0;

    for (tmpl_idx, tmpl) in TEMPLATES.iter().enumerate() {
        for variant in 0..copies_per_template {
            let exp_id = Uuid::new_v4().to_string();
            let seq = tmpl_idx * copies_per_template + variant + 1;

            // Date: spread over ~6 months
            let test_date = base_date + Duration::days((seq as i64) * 3);
            let test_date_str = test_date.format("%Y-%m-%d").to_string();
            let created_at = format!("{}T10:00:00Z", test_date_str);

            // Name
            let name = format!(
                "{} #{} ({})",
                tmpl.name_prefix,
                variant + 1,
                test_date.format("%d.%m.%Y")
            );

            // Metadata
            let field_idx = (seq) % FIELD_NAMES.len();
            let op_idx = (seq + 3) % OPERATORS.len();
            let ws_idx = (seq + 1) % WATER_SOURCES.len();
            let lab_idx = (seq) % lab_ids.len();
            let well_num = format!("W-{}", 100 + seq);

            let original_filename = format!(
                "{}_{}.{}",
                name.replace(' ', "_").replace('#', ""),
                seq,
                tmpl.file_ext
            );

            // Generate raw points
            let raw_points = generate_raw_points(tmpl, &mut rng, variant);
            let point_count = raw_points.len();

            // Compute metrics
            let max_visc = raw_points.iter()
                .map(|p| p[1]) // viscosity_cp is channel 1
                .fold(0.0f64, f64::max);
            let avg_visc = raw_points.iter()
                .map(|p| p[1])
                .sum::<f64>() / point_count as f64;
            let avg_temp = raw_points.iter()
                .map(|p| p[2]) // temperature_c is channel 2
                .sum::<f64>() / point_count as f64;
            let max_temp = raw_points.iter()
                .map(|p| p[2])
                .fold(0.0f64, f64::max);
            let time_max = raw_points.last().map(|p| p[0]).unwrap_or(0.0);

            let metrics_json = serde_json::json!({
                "maxViscosity": max_visc as i64,
                "avgViscosity": avg_visc as i64,
                "avgTemperatureC": (avg_temp * 10.0).round() / 10.0,
                "pointCount": point_count,
            }).to_string();

            let water_params_json = serde_json::json!({
                "ph": 6.5 + rng.gen_range(0.0..2.0),
                "salinity": 800 + rng.gen_range(0..3000),
            }).to_string();

            // Encode columnar blob
            let blob = encode_columnar_v2_zstd(tmpl.channels, &raw_points);

            // Insert experiment
            conn.execute(
                "INSERT INTO Experiment \
                 (id, createdAt, updatedAt, originalFilename, testDate, instrumentType, \
                  geometry, geometrySource, durationSeconds, avgTemperatureC, maxTemperatureC, maxViscosity, avgViscosity, \
                  name, fieldName, operatorName, wellNumber, testId, waterSource, waterParams, \
                  fluidType, testGroup, testSubGroup, metrics, rawPoints, calibration, \
                  userId, laboratoryId, parsedBy, parseSource, timeRangeMin, timeRangeMax, \
                  viscosityMin, pressureMax, extraFields, waterSourceId) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,\
                  ?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33,?34,?35,?36)",
                params![
                    exp_id,
                    created_at,
                    created_at,
                    original_filename,
                    test_date_str,
                    tmpl.instrument_type,
                    tmpl.geometry,
                    tmpl.geometry_source,
                    tmpl.duration_sec as i64,
                    (avg_temp * 10.0).round() / 10.0,
                    (max_temp * 10.0).round() / 10.0,
                    max_visc as i64,
                    avg_visc as i64,
                    name,
                    FIELD_NAMES[field_idx],
                    OPERATORS[op_idx],
                    well_num,
                    format!("TEST-{:04}", seq),
                    WATER_SOURCES[ws_idx],
                    water_params_json,
                    tmpl.fluid_type,
                    tmpl.test_group,
                    tmpl.test_sub_group,
                    metrics_json,
                    "[]",           // rawPoints sentinel — data in ExperimentData
                    serde_json::Value::Null.to_string(),
                    user_id,
                    &lab_ids[lab_idx],
                    "SeedGenerator",
                    tmpl.file_ext,
                    0.0f64,
                    time_max,
                    10i64,
                    if tmpl.has_pressure { 35.0f64 } else { 0.0f64 },
                    "{}",
                    &ws_ids[ws_idx],
                ],
            ).unwrap();

            // Insert ExperimentData blob
            conn.execute(
                "INSERT INTO ExperimentData (experimentId, dataBlob, encoding, pointCount, createdAt, updatedAt) \
                 VALUES (?1, ?2, 'columnar-v1-zstd', ?3, ?4, ?5)",
                params![exp_id, blob, point_count as i64, created_at, created_at],
            ).unwrap();

            // Insert reagents from recipe
            let recipe = RECIPES[variant % RECIPES.len()];
            for reagent in recipe.iter() {
                let er_id = Uuid::new_v4().to_string();
                let reagent_id = reagent_ids.get(reagent.name);
                let batch = format!("BATCH-{:03}-{:02}", seq, rng.gen_range(1..99));
                conn.execute(
                    "INSERT INTO ExperimentReagent \
                     (id, experimentId, reagentId, reagentName, category, concentration, unit, batchNumber) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        er_id,
                        exp_id,
                        reagent_id,
                        reagent.name,
                        reagent.category,
                        reagent.concentration,
                        reagent.unit,
                        batch,
                    ],
                ).unwrap();
            }

            total_experiments += 1;
        }

        println!(
            "  {} × {} = {} экспериментов ({})",
            tmpl.instrument_type, copies_per_template, copies_per_template, tmpl.name_prefix
        );
    }

    // ── Optimize ──────────────────────────────────────────────────────
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").ok();

    // Verify
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM Experiment", [], |r| r.get(0)).unwrap();
    let reagent_links: i64 = conn.query_row("SELECT COUNT(*) FROM ExperimentReagent", [], |r| r.get(0)).unwrap();
    let data_blobs: i64 = conn.query_row("SELECT COUNT(*) FROM ExperimentData", [], |r| r.get(0)).unwrap();
    let db_size = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);

    println!();
    println!("═══════════════════════════════════════════════════════════");
    println!("  Seed-БД готова: {}", db_path.display());
    println!("  Экспериментов:  {total_experiments} (в БД: {count})");
    println!("  Data-блобов:    {data_blobs}");
    println!("  Реагент-связей: {reagent_links}");
    println!("  Размер файла:   {:.1} MB", db_size as f64 / 1_048_576.0);
    println!("═══════════════════════════════════════════════════════════");
}
