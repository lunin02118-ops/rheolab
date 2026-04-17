//! Генератор seed-БД из реальных тестовых фикстур для RheoLab Enterprise.
//!
//! Парсит все файлы из `tests/fixtures/` (кроме .ts/.json) с помощью
//! штатного парсера rheolab-core и сохраняет по COPIES_PER_FIXTURE копий
//! каждого в SQLite-базу, подставляя разные комбинации рецептур, источников
//! воды, номеров кустов/скважин и месторождений.
//!
//! Запуск:
//!   cargo run --manifest-path tools/fixture_seed/Cargo.toml
//!
//! Необязательные флаги:
//!   --db <путь>         Путь к базе данных (по умолчанию outputs/seed/rheolab-fixture-seed.db)
//!   --fixtures <путь>   Папка с фикстурами     (по умолчанию tests/fixtures)
//!   --copies <число>    Копий на фикстуру       (по умолчанию 200)
//!   --append            Добавить к существующей БД вместо пересоздания

use byteorder::{LittleEndian, WriteBytesExt};
use chrono::{Duration, NaiveDate};
use rand::Rng;
use rusqlite::{params, Connection};
use std::io::Write;
use uuid::Uuid;

use rheolab_core::{
    parser::rheo_parser::parse_rheo_data,
    types::RheoPoint,
};

// ─────────────────────────────────────────────────────────────────────────────
// Константы
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_COPIES: usize = 588;
const BASE_DATE: (i32, u32, u32) = (2024, 1, 15); // 15 января 2024

// ─────────────────────────────────────────────────────────────────────────────
// Доменные данные
// ─────────────────────────────────────────────────────────────────────────────

const FIELD_NAMES: &[&str] = &[
    "Мамонтовское",
    "Приобское",
    "Самотлорское",
    "Ромашкинское",
    "Фёдоровское",
    "Ванкорское",
    "Красноленинское",
    "Тевлинско-Русскинское",
    "Повховское",
    "Южно-Приобское",
    "Лянторское",
    "Салымское",
    "Нижневартовское",
    "Когалымское",
    "Рябчиковское",
];

const WATER_SOURCES: &[&str] = &[
    "Озеро 274 куст",
    "Артезианская скв. 12",
    "Водозабор р. Обь",
    "Техническая скв. 405",
    "Озеро Самотлор",
    "Водовод куст 87",
    "Пластовая вода ПК-3",
    "Озеро Имилор",
    "Артезианская скв. 7",
    "Водозабор Луговой",
];

const OPERATOR_POSITIONS: &[&str] = &[
    "Ведущий инженер ГРП",
    "Инженер-технолог",
    "Старший оператор",
    "Лаборант",
    "Технолог по жидкостям ГРП",
    "Инженер по химреагентам",
];

const OPERATORS: &[&str] = &[
    "Иванов И.И.",
    "Петров П.П.",
    "Сидоров С.С.",
    "Козлов К.К.",
    "Новиков Н.Н.",
    "Морозов М.М.",
    "Волков В.В.",
    "Зайцев А.А.",
    "Белов Б.Б.",
    "Тарасов Т.Т.",
];

/// Номера кустов (pad numbers)
fn pad_number(idx: usize) -> String {
    format!("куст-{}", (idx % 50) + 1)
}

/// Номера скважин
fn well_number(idx: usize) -> String {
    format!("W-{}", (idx % 200) + 1)
}

/// Идентификатор теста
fn test_id(idx: usize) -> String {
    format!("TEST-{:05}", idx + 1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Рецептуры реагентов (10 вариантов, циклически назначаются копиям)
// ─────────────────────────────────────────────────────────────────────────────

struct ReagentEntry {
    name: &'static str,
    category: &'static str,
    concentration: f64,
    unit: &'static str,
}

const RECIPES: &[&[ReagentEntry]] = &[
    // 0: Гуар + боратный сшиватель + деструктор
    &[
        ReagentEntry { name: "GW-3 Guar Polymer",            category: "Viscosifier",    concentration: 3.6, unit: "kg/m³" },
        ReagentEntry { name: "Lightning Borate Crosslinker", category: "Crosslinker",    concentration: 2.4, unit: "L/m³"  },
        ReagentEntry { name: "Legend Breaker",               category: "Breaker",        concentration: 0.5, unit: "kg/m³" },
    ],
    // 1: Фрикшн-редьюсер + ПАВ + глин. контроль
    &[
        ReagentEntry { name: "FightR",               category: "Friction Reducer", concentration: 1.5, unit: "L/m³" },
        ReagentEntry { name: "OptiKleen-WF",         category: "Surfactant",       concentration: 2.0, unit: "L/m³" },
        ReagentEntry { name: "Legend Clay Control",  category: "Clay Control",     concentration: 1.0, unit: "L/m³" },
    ],
    // 2: Гуар + HT-сшиватель + ингибитор
    &[
        ReagentEntry { name: "GW-3 Guar Polymer",            category: "Viscosifier",    concentration: 4.0, unit: "kg/m³" },
        ReagentEntry { name: "Lightning Borate Crosslinker", category: "Crosslinker",    concentration: 3.2, unit: "L/m³"  },
        ReagentEntry { name: "Legend Scale Inhibitor",       category: "Scale Inhibitor",concentration: 0.8, unit: "L/m³"  },
    ],
    // 3: FLOJET + биоцид
    &[
        ReagentEntry { name: "FLOJET FR",      category: "Friction Reducer", concentration: 2.0, unit: "L/m³" },
        ReagentEntry { name: "Legend Biocide", category: "Biocide",          concentration: 0.3, unit: "L/m³" },
    ],
    // 4: FLOJET XL + деструктор + ПАВ
    &[
        ReagentEntry { name: "FLOJET XL",                    category: "Viscosifier",    concentration: 5.0, unit: "L/m³"  },
        ReagentEntry { name: "Legend Breaker",               category: "Breaker",        concentration: 1.0, unit: "kg/m³" },
        ReagentEntry { name: "RenewIQ Frac Water Solution",  category: "Surfactant",     concentration: 1.5, unit: "L/m³"  },
    ],
    // 5: Гуар + боратный + биоцид
    &[
        ReagentEntry { name: "GW-3 Guar Polymer",            category: "Viscosifier", concentration: 3.4, unit: "kg/m³" },
        ReagentEntry { name: "Lightning Borate Crosslinker", category: "Crosslinker", concentration: 2.8, unit: "L/m³"  },
        ReagentEntry { name: "Legend Biocide",               category: "Biocide",     concentration: 0.5, unit: "L/m³"  },
    ],
    // 6: FSC100 + ФР + ПАВ
    &[
        ReagentEntry { name: "FSC100",       category: "Scale Inhibitor",   concentration: 0.5, unit: "kg/m³" },
        ReagentEntry { name: "FightR",       category: "Friction Reducer",  concentration: 1.2, unit: "L/m³"  },
        ReagentEntry { name: "OptiKleen-WF", category: "Surfactant",        concentration: 1.8, unit: "L/m³"  },
    ],
    // 7: Гуар + сшиватель + глин. стаб.
    &[
        ReagentEntry { name: "GW-3 Guar Polymer",            category: "Viscosifier", concentration: 3.8, unit: "kg/m³" },
        ReagentEntry { name: "Lightning Borate Crosslinker", category: "Crosslinker", concentration: 2.0, unit: "L/m³"  },
        ReagentEntry { name: "Legend Clay Control",          category: "Clay Control",concentration: 1.5, unit: "L/m³"  },
    ],
    // 8: Отечественные реагенты — Загуститель + Сшиватель СБ-1 + Деструктор
    &[
        ReagentEntry { name: "ГПБ-1 Загуститель", category: "Viscosifier", concentration: 4.5, unit: "kg/m³" },
        ReagentEntry { name: "Сшиватель СБ-1",    category: "Crosslinker", concentration: 2.5, unit: "L/m³"  },
        ReagentEntry { name: "Деструктор ДК-2",   category: "Breaker",     concentration: 0.6, unit: "kg/m³" },
    ],
    // 9: Полный набор — Гуар + сшиватель + деструктор + биоцид
    &[
        ReagentEntry { name: "GW-3 Guar Polymer",            category: "Viscosifier", concentration: 4.2, unit: "kg/m³" },
        ReagentEntry { name: "Lightning Borate Crosslinker", category: "Crosslinker", concentration: 3.0, unit: "L/m³"  },
        ReagentEntry { name: "Legend Breaker",               category: "Breaker",     concentration: 0.8, unit: "kg/m³" },
        ReagentEntry { name: "Бактерицид СНПХ-1003",        category: "Biocide",     concentration: 0.4, unit: "L/m³"  },
    ],
];

// Все уникальные реагенты из всех рецептур
const ALL_REAGENTS: &[(&str, &str, &str, &str)] = &[
    // (name, category, manufacturer, country)
    ("GW-3 Guar Polymer",            "Viscosifier",    "Baker Hughes",         "США"),
    ("Lightning Borate Crosslinker", "Crosslinker",    "Baker Hughes",         "США"),
    ("FightR",                       "Friction Reducer","Halliburton",         "США"),
    ("OptiKleen-WF",                 "Surfactant",     "Halliburton",          "США"),
    ("Legend Breaker",               "Breaker",        "Halliburton",          "США"),
    ("Legend Biocide",               "Biocide",        "Halliburton",          "США"),
    ("Legend Clay Control",          "Clay Control",   "Halliburton",          "США"),
    ("Legend Scale Inhibitor",       "Scale Inhibitor","Halliburton",          "США"),
    ("FSC100",                       "Scale Inhibitor","ChampionX",            "США"),
    ("RenewIQ Frac Water Solution",  "Surfactant",     "ChampionX",            "США"),
    ("FLOJET FR",                    "Friction Reducer","SNF Group",           "США"),
    ("FLOJET XL",                    "Viscosifier",    "SNF Group",            "США"),
    ("ГПБ-1 Загуститель",           "Viscosifier",    "ХимПром",              "Россия"),
    ("Сшиватель СБ-1",              "Crosslinker",    "НПО Буровая техника",  "Россия"),
    ("Деструктор ДК-2",             "Breaker",        "НПО Буровая техника",  "Россия"),
    ("Бактерицид СНПХ-1003",        "Biocide",        "СИБУР",                "Россия"),
];

const LABS: &[(&str, &str)] = &[
    ("Лаборатория ГРП Когалым",  "Когалым, Тюменская обл."),
    ("НПЦ Нефтехим",             "Нижневартовск"),
    ("ЦПС Лянтор",               "Лянтор, ХМАО"),
];

// ─────────────────────────────────────────────────────────────────────────────
// Схема БД (полная, V2) — идентична seed_db/src/main.rs
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA_DDL: &str = r#"
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
CREATE TABLE IF NOT EXISTS Operator (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL UNIQUE,
    position  TEXT,
    isActive  INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL DEFAULT (datetime('now')),
    updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_operator_name ON Operator(name COLLATE NOCASE);
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
    testCategory     TEXT DEFAULT NULL,
    testType         TEXT DEFAULT NULL,
    dominantPattern  TEXT DEFAULT NULL,
    waterSourceId    TEXT REFERENCES WaterSourceCatalog(id),
    FOREIGN KEY (userId) REFERENCES User(id),
    FOREIGN KEY (laboratoryId) REFERENCES Laboratory(id)
);
CREATE INDEX IF NOT EXISTS idx_experiment_user_created ON Experiment(userId, createdAt);
CREATE INDEX IF NOT EXISTS idx_experiment_lab_created  ON Experiment(laboratoryId, createdAt);
CREATE INDEX IF NOT EXISTS idx_experiment_field_operator ON Experiment(fieldName, operatorName);
CREATE INDEX IF NOT EXISTS idx_experiment_water_source ON Experiment(waterSource);
CREATE INDEX IF NOT EXISTS idx_experiment_test_date    ON Experiment(testDate);
CREATE INDEX IF NOT EXISTS idx_experiment_dedup        ON Experiment(originalFilename, testDate, name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_experiment_orig_filename ON Experiment(originalFilename);
CREATE INDEX IF NOT EXISTS idx_experiment_type_date    ON Experiment(instrumentType, testDate);
CREATE INDEX IF NOT EXISTS idx_experiment_water_date   ON Experiment(waterSource, testDate);
CREATE INDEX IF NOT EXISTS idx_experiment_lab_date     ON Experiment(laboratoryId, testDate);
CREATE INDEX IF NOT EXISTS idx_experiment_name          ON Experiment(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_experiment_test_category ON Experiment(testCategory);
CREATE INDEX IF NOT EXISTS idx_experiment_dominant_pattern ON Experiment(dominantPattern);
CREATE INDEX IF NOT EXISTS idx_experiment_geometry      ON Experiment(geometry);
CREATE INDEX IF NOT EXISTS idx_experiment_fluid_type    ON Experiment(fluidType);
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
    FOREIGN KEY (reagentId)    REFERENCES ReagentCatalog(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_experiment_reagent_batch ON ExperimentReagent(batchNumber);
CREATE INDEX IF NOT EXISTS idx_experiment_reagent_pair  ON ExperimentReagent(experimentId, reagentId);
CREATE INDEX IF NOT EXISTS idx_reagent_name_nocase      ON ReagentCatalog(name COLLATE NOCASE);
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
CREATE INDEX IF NOT EXISTS idx_import_batch_source  ON ImportBatch(sourceLabId, createdAt);
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
CREATE INDEX IF NOT EXISTS idx_payload_fingerprint  ON ExperimentPayload(contentFingerprint);
CREATE INDEX IF NOT EXISTS idx_payload_source       ON ExperimentPayload(sourceLabId, createdAt);
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
CREATE INDEX IF NOT EXISTS idx_parser_exp_created  ON ParserArtifact(experimentId, createdAt);
CREATE INDEX IF NOT EXISTS idx_parser_fingerprint  ON ParserArtifact(contentFingerprint);
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
CREATE INDEX IF NOT EXISTS idx_report_sha         ON ReportArtifact(binarySha256);
CREATE TABLE IF NOT EXISTS SearchProjectionLog (
    id                TEXT PRIMARY KEY,
    experimentId      TEXT,
    operation         TEXT NOT NULL,
    projectionVersion TEXT NOT NULL,
    detailsJson       TEXT,
    createdAt         TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (experimentId) REFERENCES Experiment(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_search_created     ON SearchProjectionLog(createdAt);
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
    FOREIGN KEY (incomingExperimentId)  REFERENCES Experiment(id) ON DELETE SET NULL,
    FOREIGN KEY (importBatchId)         REFERENCES ImportBatch(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_merge_canonical ON MergeEvent(canonicalExperimentId, createdAt);
CREATE INDEX IF NOT EXISTS idx_merge_incoming  ON MergeEvent(incomingExperimentId, createdAt);
CREATE INDEX IF NOT EXISTS idx_merge_import    ON MergeEvent(importBatchId, createdAt);
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
    FOREIGN KEY (mergeEventId)  REFERENCES MergeEvent(id) ON DELETE SET NULL,
    FOREIGN KEY (experimentId)  REFERENCES Experiment(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_conflict_status ON ConflictRecord(status, createdAt);
CREATE INDEX IF NOT EXISTS idx_conflict_exp    ON ConflictRecord(experimentId, fieldName);
CREATE INDEX IF NOT EXISTS idx_conflict_merge  ON ConflictRecord(mergeEventId);
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

// ─────────────────────────────────────────────────────────────────────────────
// Columnar-v1-zstd кодировщик (совпадает с src-tauri/src/db/columnar.rs)
// ─────────────────────────────────────────────────────────────────────────────

/// Кодирует срез RheoPoint в формат RHLC v2 + zstd.
///
/// Опциональные каналы (shear_rate, shear_stress, pressure_bar, rpm)
/// включаются в блоб только если хотя бы одна точка имеет Some-значение.
/// Для точек с None в таком канале записывается f64::NAN.
fn encode_columnar(points: &[RheoPoint]) -> Vec<u8> {
    if points.is_empty() {
        return Vec::new();
    }

    // Определяем, какие опциональные каналы заполнены
    let has_shear_rate   = points.iter().any(|p| p.shear_rate.is_some());
    let has_shear_stress = points.iter().any(|p| p.shear_stress.is_some());
    let has_pressure     = points.iter().any(|p| p.pressure_bar.is_some());
    let has_rpm          = points.iter().any(|p| p.rpm.is_some());
    let has_bath         = points.iter().any(|p| p.bath_temperature_c.is_some());

    // Список каналов (имена совпадают с именами в БД)
    let mut channel_names: Vec<&str> = vec!["time_sec", "viscosity_cp", "temperature_c"];
    if has_shear_rate   { channel_names.push("shear_rate"); }
    if has_shear_stress { channel_names.push("shear_stress_pa"); }
    if has_pressure     { channel_names.push("pressure_bar"); }
    if has_rpm          { channel_names.push("speed_rpm"); }
    if has_bath         { channel_names.push("bath_temperature_c"); }

    let point_count  = points.len() as u32;
    let channel_count = channel_names.len() as u32;
    let bitmap_bytes = ((point_count as usize) + 7) / 8;

    let mut buf: Vec<u8> = Vec::with_capacity(
        16
        + channel_names.iter().map(|c| 2 + c.len()).sum::<usize>()
        + channel_names.len() * (bitmap_bytes + points.len() * 8),
    );

    // Заголовок
    buf.write_all(b"RHLC").unwrap();
    buf.write_u32::<LittleEndian>(2).unwrap();            // version
    buf.write_u32::<LittleEndian>(point_count).unwrap();
    buf.write_u32::<LittleEndian>(channel_count).unwrap();

    // Имена каналов
    for name in &channel_names {
        let bytes = name.as_bytes();
        buf.write_u16::<LittleEndian>(bytes.len() as u16).unwrap();
        buf.write_all(bytes).unwrap();
    }

    // Для каждого канала: null-bitmap (все 1) + f64-значения
    for ch_name in &channel_names {
        // Bitmap "всё присутствует"
        let mut bitmap = vec![0xFFu8; bitmap_bytes];
        let trailing = (point_count as usize) % 8;
        if trailing != 0 {
            let last = bitmap.len() - 1;
            bitmap[last] = (0xFFu16 << (8 - trailing)) as u8;
        }
        buf.write_all(&bitmap).unwrap();

        // Значения
        for pt in points {
            let val: f64 = match *ch_name {
                "time_sec"          => pt.time_sec,
                "viscosity_cp"      => pt.viscosity_cp,
                "temperature_c"     => pt.temperature_c,
                "shear_rate"        => pt.shear_rate.unwrap_or(f64::NAN),
                "shear_stress_pa"   => pt.shear_stress.unwrap_or(f64::NAN),
                "pressure_bar"      => pt.pressure_bar.unwrap_or(f64::NAN),
                "speed_rpm"         => pt.rpm.unwrap_or(f64::NAN),
                "bath_temperature_c"=> pt.bath_temperature_c.unwrap_or(f64::NAN),
                _                   => 0.0,
            };
            buf.write_f64::<LittleEndian>(val).unwrap();
        }
    }

    zstd::encode_all(buf.as_slice(), 3).expect("zstd encode failed")
}

// ─────────────────────────────────────────────────────────────────────────────
// Вычисляемые метрики
// ─────────────────────────────────────────────────────────────────────────────

struct PointMetrics {
    max_viscosity: i64,
    avg_viscosity: i64,
    avg_temperature: f64,
    max_temperature: f64,
    point_count: usize,
    time_max: f64,
    pressure_max: Option<f64>,
}

fn compute_metrics(points: &[RheoPoint]) -> PointMetrics {
    if points.is_empty() {
        return PointMetrics {
            max_viscosity: 0, avg_viscosity: 0, avg_temperature: 20.0, max_temperature: 20.0,
            point_count: 0, time_max: 0.0, pressure_max: None,
        };
    }
    let n = points.len() as f64;
    let max_v = points.iter().map(|p| p.viscosity_cp).fold(f64::NEG_INFINITY, f64::max);
    let avg_v = points.iter().map(|p| p.viscosity_cp).sum::<f64>() / n;
    let avg_t = points.iter().map(|p| p.temperature_c).sum::<f64>() / n;
    let max_t = points.iter().map(|p| p.temperature_c).fold(f64::NEG_INFINITY, f64::max);
    let t_max = points.iter().map(|p| p.time_sec).fold(f64::NEG_INFINITY, f64::max);
    let p_max = if points.iter().any(|p| p.pressure_bar.is_some()) {
        Some(points.iter().filter_map(|p| p.pressure_bar).fold(f64::NEG_INFINITY, f64::max))
    } else {
        None
    };
    PointMetrics {
        max_viscosity: max_v.round() as i64,
        avg_viscosity: avg_v.round() as i64,
        avg_temperature: (avg_t * 10.0).round() / 10.0,
        max_temperature: (max_t * 10.0).round() / 10.0,
        point_count: points.len(),
        time_max: t_max,
        pressure_max: p_max,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Определение набора каналов (для поля metrics)
// ─────────────────────────────────────────────────────────────────────────────

fn channels_list(points: &[RheoPoint]) -> Vec<&'static str> {
    let mut v = vec!["time_sec", "viscosity_cp", "temperature_c"];
    if points.iter().any(|p| p.shear_rate.is_some())        { v.push("shear_rate"); }
    if points.iter().any(|p| p.shear_stress.is_some())      { v.push("shear_stress_pa"); }
    if points.iter().any(|p| p.pressure_bar.is_some())      { v.push("pressure_bar"); }
    if points.iter().any(|p| p.rpm.is_some())               { v.push("speed_rpm"); }
    if points.iter().any(|p| p.bath_temperature_c.is_some()){ v.push("bath_temperature_c"); }
    v
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

fn main() {
    // ── Аргументы командной строки ─────────────────────────────────────────
    let args: Vec<String> = std::env::args().collect();
    let mut db_path_arg: Option<String>       = None;
    let mut fixtures_dir_arg: Option<String>  = None;
    let mut copies_arg: usize                 = DEFAULT_COPIES;
    let mut append_mode = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--db"       => { i += 1; db_path_arg       = args.get(i).cloned(); }
            "--fixtures" => { i += 1; fixtures_dir_arg  = args.get(i).cloned(); }
            "--copies"   => { i += 1; copies_arg        = args.get(i).and_then(|s| s.parse().ok()).unwrap_or(DEFAULT_COPIES); }
            "--append"   => { append_mode = true; }
            _ => {}
        }
        i += 1;
    }

    let db_path = db_path_arg.unwrap_or_else(|| "outputs/seed/rheolab-fixture-seed.db".to_string());
    let fixtures_dir = fixtures_dir_arg.unwrap_or_else(|| "tests/fixtures".to_string());

    // ── Создаём выходную директорию ────────────────────────────────────────
    let db_path_obj = std::path::Path::new(&db_path);
    if let Some(parent) = db_path_obj.parent() {
        std::fs::create_dir_all(parent).expect("Не удалось создать папку для БД");
    }

    // Удаляем старую БД если не --append
    if !append_mode && db_path_obj.exists() {
        std::fs::remove_file(db_path_obj).expect("Не удалось удалить старую БД");
    }

    // ── Открываем SQLite ───────────────────────────────────────────────────
    let conn = Connection::open(&db_path).expect("Failed to open SQLite");
    conn.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;"
    ).expect("PRAGMA failed");

    // ── Схема ──────────────────────────────────────────────────────────────
    conn.execute_batch(SCHEMA_DDL).expect("Не удалось применить схему БД");
    println!("✓ Схема применена");

    // ── Пользователь ──────────────────────────────────────────────────────
    let user_id = "desktop-local-admin";
    conn.execute(
        "INSERT OR IGNORE INTO User (id, name, role) VALUES (?1, ?2, 'admin')",
        params![user_id, "Администратор"],
    ).unwrap();

    // ── Лаборатории ────────────────────────────────────────────────────────
    let mut lab_ids: Vec<String> = Vec::new();
    for (name, location) in LABS {
        // Пытаемся взять существующий id
        let existing: Option<String> = conn
            .query_row("SELECT id FROM Laboratory WHERE name = ?1", params![name], |r| r.get(0))
            .ok();
        let id = if let Some(eid) = existing {
            eid
        } else {
            let new_id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO Laboratory (id, name, description, location) VALUES (?1, ?2, ?3, ?4)",
                params![new_id, name, format!("Лаборатория: {name}"), location],
            ).unwrap();
            new_id
        };
        lab_ids.push(id);
    }
    println!("✓ {} лабораторий", lab_ids.len());

    // ── Операторы ─────────────────────────────────────────────────────────────
    let mut operator_ids: Vec<String> = Vec::new();
    for (i, op_name) in OPERATORS.iter().enumerate() {
        let position = OPERATOR_POSITIONS[i % OPERATOR_POSITIONS.len()];
        let existing: Option<String> = conn
            .query_row("SELECT id FROM Operator WHERE name = ?1", params![op_name], |r| r.get(0))
            .ok();
        let id = if let Some(eid) = existing {
            eid
        } else {
            let new_id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO Operator (id, name, position) VALUES (?1, ?2, ?3)",
                params![new_id, op_name, position],
            ).unwrap();
            new_id
        };
        operator_ids.push(id);
    }
    println!("✓ {} операторов", operator_ids.len());

    let mut rng = rand::thread_rng();

    // ── Источники воды ─────────────────────────────────────────────────────
    let now_str = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let mut ws_ids: Vec<String> = Vec::new();
    for ws_name in WATER_SOURCES {
        let existing: Option<String> = conn
            .query_row("SELECT id FROM WaterSourceCatalog WHERE name = ?1", params![ws_name], |r| r.get(0))
            .ok();
        let id = if let Some(eid) = existing {
            eid
        } else {
            let new_id = Uuid::new_v4().to_string();
            let ws_comp = serde_json::json!({
                "tds":      rng.gen_range(500_i64..15000),
                "hardness": rng.gen_range(100_i64..3000),
                "ph":       ((6.5 + rng.gen_range(0.0_f64..2.0)) * 10.0).round() / 10.0,
                "cl":       rng.gen_range(50_i64..5000),
                "so4":      rng.gen_range(20_i64..2000),
            }).to_string();
            let ws_notes = format!("Анализ воды {ws_name}, актуальность данных: {}", chrono::Utc::now().format("%Y"));
            conn.execute(
                "INSERT INTO WaterSourceCatalog (id, name, location, composition, notes, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![new_id, ws_name, "ХМАО-Югра", ws_comp, ws_notes, &now_str, &now_str],
            ).unwrap();
            new_id
        };
        ws_ids.push(id);
    }
    println!("✓ {} источников воды", ws_ids.len());

    // ── Каталог реагентов ──────────────────────────────────────────────────
    let mut reagent_ids: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for (name, category, manufacturer, country) in ALL_REAGENTS {
        let existing: Option<String> = conn
            .query_row("SELECT id FROM ReagentCatalog WHERE name = ?1", params![name], |r| r.get(0))
            .ok();
        let id = if let Some(eid) = existing {
            eid
        } else {
            let new_id = Uuid::new_v4().to_string();
            let (active_sub, form, description) = reagent_meta(name, category);
            conn.execute(
                "INSERT OR IGNORE INTO ReagentCatalog (id, name, category, manufacturer, country, activeSubstance, form, description) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                params![new_id, name, category, manufacturer, country, active_sub, form, description],
            ).unwrap();
            new_id
        };
        reagent_ids.insert(name.to_string(), id);
    }
    println!("✓ {} реагентов в каталоге", reagent_ids.len());

    // ── Обнаружение фикстур ────────────────────────────────────────────────
    let fixtures_path = std::path::Path::new(&fixtures_dir);
    let fixture_files: Vec<std::path::PathBuf> = std::fs::read_dir(fixtures_path)
        .expect("Не удалось открыть папку с фикстурами")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            if !p.is_file() { return false; }
            let ext = p.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            // Парсируемые расширения; пропускаем .ts/.json/.md
            matches!(ext.as_str(), "csv" | "xlsx" | "xls" | "dat" | "da")
        })
        .collect();

    if fixture_files.is_empty() {
        eprintln!("⚠ Не найдено ни одного файла фикстуры в '{fixtures_dir}'");
        return;
    }

    println!("✓ Найдено {} файлов фикстур", fixture_files.len());
    for f in &fixture_files {
        println!("    {}", f.file_name().unwrap().to_string_lossy());
    }
    println!();

    // ── Парсинг фикстур ────────────────────────────────────────────────────
    struct ParsedFixture {
        filename: String,
        points: Vec<RheoPoint>,
        instrument_type: String,
        geometry: Option<String>,
        geometry_source: Option<String>,
        #[allow(dead_code)]  // computed per-copy in insert loop instead
        fluid_type: String,
        test_group: String,
        test_sub_group: String,
    }

    let mut parsed_fixtures: Vec<ParsedFixture> = Vec::new();
    for path in &fixture_files {
        let filename = path.file_name().unwrap().to_string_lossy().to_string();
        print!("  Парсинг '{filename}'... ");
        let _ = std::io::stdout().flush();

        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(e) => { println!("❌ Ошибка чтения: {e}"); continue; }
        };

        match parse_rheo_data(&bytes, &filename) {
            Ok(result) => {
                if result.data.is_empty() {
                    println!("⚠ Пустой результат (0 точек), пропускаем");
                    continue;
                }
                let n = result.data.len();

                let instrument_type = result.metadata.instrument_type.clone()
                    .unwrap_or_else(|| "Unknown".to_string());
                let geometry = result.metadata.geometry.clone();
                let geometry_source = result.metadata.geometry_source.clone();

                // Определяем fluid_type/test_group/test_sub_group по имени прибора
                let (fluid_type, test_group, test_sub_group) = classify_by_instrument(&instrument_type, &filename);

                println!("✓ {n} точек, прибор: {instrument_type}");
                parsed_fixtures.push(ParsedFixture {
                    filename,
                    points: result.data,
                    instrument_type,
                    geometry,
                    geometry_source,
                    fluid_type,
                    test_group,
                    test_sub_group,
                });
            }
            Err(e) => {
                println!("❌ Ошибка парсинга: {e}");
            }
        }
    }

    if parsed_fixtures.is_empty() {
        eprintln!("❌ Ни одна фикстура не была успешно разобрана. Выход.");
        return;
    }

    println!();
    println!("✓ Успешно разобрано {} из {} фикстур", parsed_fixtures.len(), fixture_files.len());
    println!("  Генерация {} копий × {} фикстур = {} экспериментов…",
        copies_arg, parsed_fixtures.len(), copies_arg * parsed_fixtures.len());
    println!();

    // ── Генерация экспериментов ────────────────────────────────────────────
    let base_date = NaiveDate::from_ymd_opt(BASE_DATE.0, BASE_DATE.1, BASE_DATE.2).unwrap();
    let mut total_inserted: u64 = 0;
    let mut global_seq: usize = 0;

    for fixture in &parsed_fixtures {
        let blob      = encode_columnar(&fixture.points);
        let metrics   = compute_metrics(&fixture.points);
        let channels  = channels_list(&fixture.points);

        print!("  Сохранение '{}': ", fixture.filename);
        let _ = std::io::stdout().flush();

        for copy_idx in 0..copies_arg {
            global_seq += 1;
            let exp_id = Uuid::new_v4().to_string();

            // Метаданные варьируются по индексу копии
            let field_name   = FIELD_NAMES  [copy_idx % FIELD_NAMES.len()];
            let water_source = WATER_SOURCES[copy_idx % WATER_SOURCES.len()];
            let ws_id        = &ws_ids       [copy_idx % ws_ids.len()];
            let operator     = OPERATORS    [copy_idx % OPERATORS.len()];
            let lab_id       = &lab_ids      [copy_idx % lab_ids.len()];

            // Дата — равномерно в диапазоне ~3 лет
            let test_date = base_date + Duration::days((global_seq as i64) * 5 % (3 * 365));
            let test_date_str  = test_date.format("%Y-%m-%d").to_string();
            let created_at_str = format!("{}T{:02}:{:02}:00Z",
                test_date_str,
                (global_seq % 9) + 8,    // 08:00..16:00
                (global_seq * 7) % 60,
            );

            // Название: "<базовое имя файла без расширения> #<копия> (<дата>)"
            let base_name: String = std::path::Path::new(&fixture.filename)
                .file_stem()
                .unwrap()
                .to_string_lossy()
                .to_string();
            let name = format!(
                "{} #{} ({})",
                base_name,
                copy_idx + 1,
                test_date.format("%d.%m.%Y")
            );

            let water_params_json = serde_json::json!({
                "ph":   ((6.5 + rng.gen_range(0.0_f64..2.0)) * 10.0).round() / 10.0,
                "fe":   rng.gen_range(0_i64..15),
                "ca":   rng.gen_range(10_i64..500),
                "mg":   rng.gen_range(5_i64..200),
                "cl":   rng.gen_range(10_i64..5000),
                "so4":  rng.gen_range(5_i64..2000),
                "hco3": rng.gen_range(50_i64..800),
            }).to_string();

            // testCategory / testType — derived from parsed test_group + instrument type
            const FRAC_TYPES: &[&str] = &[
                "ShearViscosity", "ShearDegradation", "ThermalStability",
                "CrosslinkTest", "BreakTest", "FrictionReduction",
            ];
            let is_drilling = fixture.instrument_type.to_lowercase().contains("ofite");
            let (test_category, test_type): (&str, &str) = match fixture.test_group.as_str() {
                "Hydration" => ("Fracturing", "Hydration"),
                _ if is_drilling => ("Drilling", "MudRheology"),
                _ => ("Fracturing", FRAC_TYPES[copy_idx % FRAC_TYPES.len()]),
            };

            // fluidType — vary across valid enum values per copy for non-drilling experiments
            const FRAC_FLUID_TYPES: &[&str] = &[
                "Crosslinked", "Crosslinked", "Linear", "Slickwater",
                "VES", "Crosslinked", "Linear", "Slickwater",
            ];
            let insert_fluid_type: &str = if is_drilling {
                "WBM"
            } else if fixture.test_group == "Hydration" {
                "Linear"
            } else {
                FRAC_FLUID_TYPES[copy_idx % FRAC_FLUID_TYPES.len()]
            };

            // dominantPattern — cycled through standards
            const PATTERNS: &[&str] = &["ISO", "API", "SST", "Custom"];
            let dominant_pattern = PATTERNS[copy_idx % PATTERNS.len()];

            let metrics_json = serde_json::json!({
                "maxViscosity":   metrics.max_viscosity,
                "avgViscosity":   metrics.avg_viscosity,
                "avgTemperatureC":metrics.avg_temperature,
                "maxTemperatureC":metrics.max_temperature,
                "pointCount":     metrics.point_count,
                "channels":       channels,
            }).to_string();

            conn.execute(
                "INSERT INTO Experiment \
                 (id, createdAt, updatedAt, originalFilename, testDate, instrumentType, \
                  geometry, geometrySource, durationSeconds, avgTemperatureC, maxTemperatureC, maxViscosity, avgViscosity, \
                  name, fieldName, operatorName, wellNumber, testId, waterSource, waterParams, \
                  fluidType, testGroup, testSubGroup, metrics, rawPoints, \
                  userId, laboratoryId, parsedBy, parseSource, \
                  timeRangeMin, timeRangeMax, viscosityMin, pressureMax, \
                  extraFields, waterSourceId, testCategory, testType, dominantPattern) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,\
                  ?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33,?34,?35,?36,?37,?38)",
                params![
                    exp_id,
                    created_at_str,
                    created_at_str,
                    fixture.filename,
                    test_date_str,
                    fixture.instrument_type,
                    fixture.geometry,
                    fixture.geometry_source,
                    metrics.time_max as i64,
                    metrics.avg_temperature,
                    metrics.max_temperature,
                    metrics.max_viscosity,
                    metrics.avg_viscosity,
                    name,
                    field_name,
                    operator,
                    well_number(global_seq),
                    test_id(global_seq),
                    water_source,
                    water_params_json,
                    insert_fluid_type,
                    fixture.test_group,
                    fixture.test_sub_group,
                    metrics_json,
                    "[]",          // rawPoints — данные хранятся в ExperimentData
                    user_id,
                    lab_id,
                    "fixture-seed",
                    &fixture.filename,
                    0.0f64,
                    metrics.time_max,
                    1i64,
                    metrics.pressure_max.unwrap_or(0.0),
                    serde_json::json!({ "padNumber": pad_number(global_seq) }).to_string(),
                    ws_id,
                    test_category,
                    test_type,
                    dominant_pattern,
                ],
            ).expect("INSERT Experiment failed");

            // ExperimentData
            conn.execute(
                "INSERT INTO ExperimentData (experimentId, dataBlob, encoding, pointCount, createdAt, updatedAt) \
                 VALUES (?1, ?2, 'columnar-v1-zstd', ?3, ?4, ?5)",
                params![exp_id, &blob, metrics.point_count as i64, created_at_str, created_at_str],
            ).expect("INSERT ExperimentData failed");

            // ExperimentReagent — рецептура из RECIPES
            let recipe = RECIPES[copy_idx % RECIPES.len()];
            for reagent in recipe.iter() {
                let er_id = Uuid::new_v4().to_string();
                let reagent_id = reagent_ids.get(reagent.name).cloned();
                let batch = format!("BATCH-{:04}-{:02}", global_seq, rng.gen_range(1_u32..99));
                // productionDate: random date in 2023–2025
                let prod_year  = 2023_i64 + rng.gen_range(0_i64..3);
                let prod_month = rng.gen_range(1_i64..13);
                let prod_day   = rng.gen_range(1_i64..29);
                let production_date = format!("{:04}-{:02}-{:02}", prod_year, prod_month, prod_day);
                conn.execute(
                    "INSERT INTO ExperimentReagent \
                     (id, experimentId, reagentId, reagentName, category, concentration, unit, batchNumber, productionDate) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        er_id, exp_id, reagent_id,
                        reagent.name, reagent.category,
                        reagent.concentration, reagent.unit, batch, production_date,
                    ],
                ).expect("INSERT ExperimentReagent failed");
            }

            total_inserted += 1;

            // Прогресс каждые 50 копий
            if (copy_idx + 1) % 50 == 0 || copy_idx + 1 == copies_arg {
                print!("{}/{}… ", copy_idx + 1, copies_arg);
                let _ = std::io::stdout().flush();
            }
        }
        println!("✓");
    }

    // ── WAL checkpoint ─────────────────────────────────────────────────────
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").ok();

    // ── Итоги ──────────────────────────────────────────────────────────────
    let count_exp: i64 = conn.query_row("SELECT COUNT(*) FROM Experiment",     [], |r| r.get(0)).unwrap_or(0);
    let count_data: i64 = conn.query_row("SELECT COUNT(*) FROM ExperimentData", [], |r| r.get(0)).unwrap_or(0);
    let count_reag: i64 = conn.query_row("SELECT COUNT(*) FROM ExperimentReagent", [], |r| r.get(0)).unwrap_or(0);
    let db_size = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);

    println!();
    println!("═══════════════════════════════════════════════════════════════");
    println!("  Готово: {}", db_path);
    println!("  Фикстур разобрано: {}", parsed_fixtures.len());
    println!("  Экспериментов вставлено: {total_inserted} (в БД: {count_exp})");
    println!("  Блобов данных:     {count_data}");
    println!("  Реагент-связей:    {count_reag}");
    println!("  Размер базы данных:{:.1} MB", db_size as f64 / 1_048_576.0);
    println!("═══════════════════════════════════════════════════════════════");
    println!();
    println!("Для использования скопируйте файл в папку данных приложения:");
    println!("  %APPDATA%\\com.rheolab.enterprise\\rheolab.db  (Windows)");
    println!("  ~/.local/share/com.rheolab.enterprise/rheolab.db  (Linux)");
}

// ─────────────────────────────────────────────────────────────────────────────
// Метаданные реагентов (активное вещество, форма, описание)
// ─────────────────────────────────────────────────────────────────────────────

fn reagent_meta(name: &str, category: &str) -> (&'static str, &'static str, &'static str) {
    match name {
        "GW-3 Guar Polymer"            => ("Hydroxypropyl guar (HPG)", "Powder", "High-performance guar polymer for fracturing fluids, 30 CPS base viscosity"),
        "Lightning Borate Crosslinker" => ("Sodium tetraborate / organic borate complex", "Liquid", "Delayed borate crosslinker for guar-based fluids, pH-activated"),
        "FightR"                       => ("Polyacrylamide emulsion", "Emulsion", "Friction reducer for slickwater fracturing, anionic, 40% active"),
        "OptiKleen-WF"                 => ("Ethoxylated alcohol surfactant blend", "Liquid", "Non-emulsifying surfactant and cleanup additive for water-based systems"),
        "Legend Breaker"               => ("Ammonium persulfate / enzyme blend", "Powder", "Oxidative gel breaker system, temperature-activated"),
        "Legend Biocide"               => ("Glutaraldehyde / DBNPA blend", "Liquid", "Broad-spectrum biocide for fracturing water, 50% active"),
        "Legend Clay Control"          => ("Tetramethylammonium chloride (TMAC)", "Liquid", "Clay stabilizer for swelling and migrating fines in sensitive formations"),
        "Legend Scale Inhibitor"       => ("Phosphonate / ATMP blend", "Liquid", "Inorganic scale inhibitor for carbonate and sulfate scales"),
        "FSC100"                       => ("Phosphinocarboxylic acid polymer", "Liquid", "Iron control and scale inhibition, effective up to 150°C"),
        "RenewIQ Frac Water Solution"  => ("Alkyl polyglucoside surfactant", "Liquid", "Multi-functional surfactant for produced water reuse"),
        "FLOJET FR"                    => ("Anionic polyacrylamide (APAM)", "Powder", "Dry friction reducer, high TDS tolerance, 75% active"),
        "FLOJET XL"                    => ("Associative polymer thickener", "Liquid", "Viscosifier for slickwater and hybrid systems"),
        "ГПБ-1 Загуститель"           => ("Гидроксипропилгуар (ГПГ)", "Порошок", "Отечественный загуститель для жидкостей ГРП, базовая вязкость 25 мПа·с"),
        "Сшиватель СБ-1"              => ("Органоборатный комплекс", "Жидкость", "Сшиватель для гуарных систем, рН 8.5–11"),
        "Деструктор ДК-2"             => ("Персульфат аммония", "Порошок", "Окислительный деструктор гелей ГРП, температурная активация"),
        "Бактерицид СНПХ-1003"        => ("Четвертичные аммониевые соединения (ЧАС)", "Жидкость", "Бактерицид для подавления сульфатвосстанавливающих бактерий"),
        _ => match category {
            "Viscosifier"     => ("Polymer blend", "Liquid", "Viscosifying additive"),
            "Crosslinker"     => ("Metal complex", "Liquid", "Crosslinking agent"),
            "Breaker"         => ("Oxidizing agent", "Powder", "Gel breaker"),
            "Friction Reducer"=> ("Polyacrylamide", "Emulsion", "Friction reducer"),
            "Surfactant"      => ("Surfactant blend", "Liquid", "Surface active agent"),
            "Biocide"         => ("Aldehyde compound", "Liquid", "Antimicrobial agent"),
            "Clay Control"    => ("Quaternary amine", "Liquid", "Clay stabilizer"),
            "Scale Inhibitor" => ("Phosphonate", "Liquid", "Scale inhibitor"),
            _                 => ("", "Liquid", ""),
        },
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Классификация теста по имени прибора / имени файла
// ─────────────────────────────────────────────────────────────────────────────

fn classify_by_instrument(instrument: &str, filename: &str) -> (String, String, String) {
    let instr_lc = instrument.to_lowercase();
    let file_lc  = filename.to_lowercase();

    // fluid_type
    let fluid_type = if file_lc.contains("swb") || file_lc.contains("сшитый") {
        "Crosslinked"
    } else if file_lc.contains("linear") || instr_lc.contains("brookfield") {
        "Linear"
    } else if instr_lc.contains("ofite") {
        "WBM"
    } else {
        "Crosslinked"
    };

    // test_group — only valid values: 'Hydration' | 'Rheology'
    let test_group = if instr_lc.contains("brookfield") {
        "Hydration"
    } else {
        "Rheology"
    };

    // test_sub_group
    let test_sub_group = if file_lc.contains("sst") {
        "SST"
    } else if file_lc.contains("swb") {
        "SWB"
    } else if instr_lc.contains("grace") || instr_lc.contains("m5600") {
        "HPHT"
    } else if instr_lc.contains("brookfield") {
        "Standard 25°C"
    } else if instr_lc.contains("ofite") {
        "With Proppant"
    } else {
        "Standard"
    };

    (fluid_type.to_string(), test_group.to_string(), test_sub_group.to_string())
}
