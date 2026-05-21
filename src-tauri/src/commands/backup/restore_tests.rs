//! Integration tests for `merge_attached_databases` and `get_common_columns`.
//! Loaded via `#[path = "restore_tests.rs"] mod merge_tests;` in restore.rs.

use super::*;
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;

/// Minimal DDL for the "main" database (full current schema).
const MAIN_SCHEMA: &str = r#"
    CREATE TABLE Laboratory (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
        description TEXT, location TEXT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE WaterSourceCatalog (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
        location TEXT, composition TEXT, notes TEXT,
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE ReagentCatalog (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
        manufacturer TEXT, country TEXT, description TEXT,
        activeSubstance TEXT, form TEXT,
        extraFields TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE User (
        id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE,
        emailVerified TEXT, image TEXT, password TEXT,
        role TEXT NOT NULL DEFAULT 'operator',
        isActive INTEGER NOT NULL DEFAULT 1,
        laboratoryId TEXT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (laboratoryId) REFERENCES Laboratory(id) ON DELETE SET NULL
    );
    CREATE TABLE Settings (
        id TEXT PRIMARY KEY, userId TEXT NOT NULL UNIQUE,
        language TEXT NOT NULL DEFAULT 'ru', theme TEXT NOT NULL DEFAULT 'dark',
        unitSystem TEXT NOT NULL DEFAULT 'si', unitPreferences TEXT,
        timeShiftEnabled INTEGER NOT NULL DEFAULT 0, deviceName TEXT,
        FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
    );
    CREATE TABLE Experiment (
        id TEXT PRIMARY KEY,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
        originalFilename TEXT NOT NULL, testDate TEXT NOT NULL,
        instrumentType TEXT NOT NULL, geometry TEXT, geometrySource TEXT,
        durationSeconds INTEGER, avgTemperatureC REAL, maxTemperatureC REAL,
        maxViscosity INTEGER, avgViscosity INTEGER,
        name TEXT NOT NULL, fieldName TEXT, operatorName TEXT,
        wellNumber TEXT, testId TEXT,
        waterSource TEXT NOT NULL, waterParams TEXT,
        fluidType TEXT NOT NULL, testGroup TEXT NOT NULL, testSubGroup TEXT,
        metrics TEXT NOT NULL, rawPoints TEXT NOT NULL, calibration TEXT,
        userId TEXT NOT NULL, laboratoryId TEXT,
        parsedBy TEXT, parseSource TEXT,
        timeRangeMin REAL, timeRangeMax REAL,
        viscosityMin INTEGER, pressureMax REAL,
        extraFields TEXT NOT NULL DEFAULT '{}',
        waterSourceId TEXT REFERENCES WaterSourceCatalog(id),
        FOREIGN KEY (userId) REFERENCES User(id),
        FOREIGN KEY (laboratoryId) REFERENCES Laboratory(id)
    );
    CREATE TABLE ExperimentData (
        experimentId TEXT PRIMARY KEY REFERENCES Experiment(id) ON DELETE CASCADE,
        dataBlob BLOB NOT NULL, encoding TEXT NOT NULL DEFAULT 'columnar-v1-zstd',
        pointCount INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    );
    CREATE TABLE ExperimentReagent (
        id TEXT PRIMARY KEY, experimentId TEXT NOT NULL,
        reagentId TEXT, reagentName TEXT, category TEXT,
        concentration REAL NOT NULL, unit TEXT NOT NULL,
        batchNumber TEXT, productionDate TEXT,
        FOREIGN KEY (experimentId) REFERENCES Experiment(id) ON DELETE CASCADE,
        FOREIGN KEY (reagentId) REFERENCES ReagentCatalog(id) ON DELETE SET NULL
    );
    CREATE TABLE Calibration (
        id TEXT PRIMARY KEY,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        deviceType TEXT NOT NULL, calibrationDate TEXT,
        rSquared REAL NOT NULL, slope REAL NOT NULL, intercept REAL NOT NULL,
        hysteresis REAL NOT NULL, stdev REAL NOT NULL,
        status TEXT NOT NULL, rawData TEXT NOT NULL, issues TEXT,
        experimentId TEXT NOT NULL UNIQUE,
        FOREIGN KEY (experimentId) REFERENCES Experiment(id) ON DELETE CASCADE
    );
    CREATE TABLE ImportBatch (
        id TEXT PRIMARY KEY, sourceLabId TEXT, sourceSystem TEXT,
        sourceAppVersion TEXT, importedByUserId TEXT, fileName TEXT,
        checksum TEXT, notes TEXT,
        experimentsImported INTEGER NOT NULL DEFAULT 0,
        duplicatesDetected INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'completed',
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ExperimentPayload (
        id TEXT PRIMARY KEY, experimentId TEXT NOT NULL,
        importBatchId TEXT, payloadVersion INTEGER NOT NULL DEFAULT 1,
        payloadFormat TEXT NOT NULL, payloadCompression TEXT,
        payloadJson TEXT NOT NULL, contentFingerprint TEXT NOT NULL,
        sourceLabId TEXT, sourceSystem TEXT, sourceAppVersion TEXT,
        isCanonical INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (experimentId) REFERENCES Experiment(id) ON DELETE CASCADE,
        FOREIGN KEY (importBatchId) REFERENCES ImportBatch(id) ON DELETE SET NULL,
        UNIQUE(experimentId, payloadVersion)
    );
    CREATE TABLE ParserArtifact (
        id TEXT PRIMARY KEY, experimentId TEXT NOT NULL,
        importBatchId TEXT, parserVersion TEXT NOT NULL,
        schemaVersion TEXT NOT NULL, artifactJson TEXT NOT NULL,
        contentFingerprint TEXT NOT NULL,
        promotedToHot INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (experimentId) REFERENCES Experiment(id) ON DELETE CASCADE,
        FOREIGN KEY (importBatchId) REFERENCES ImportBatch(id) ON DELETE SET NULL
    );
    CREATE TABLE ReportArtifact (
        id TEXT PRIMARY KEY, experimentId TEXT NOT NULL,
        importBatchId TEXT, reportType TEXT NOT NULL,
        templateVersion TEXT, settingsJson TEXT, storagePath TEXT,
        binarySha256 TEXT, sizeBytes INTEGER,
        createdAt TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (experimentId) REFERENCES Experiment(id) ON DELETE CASCADE,
        FOREIGN KEY (importBatchId) REFERENCES ImportBatch(id) ON DELETE SET NULL
    );
"#;

/// Helper: create a file-backed DB with the given DDL
fn create_db(path: &std::path::Path, ddl: &str) -> Connection {
    let conn = Connection::open(path).expect("open DB");
    conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
    conn.execute_batch(ddl).unwrap();
    conn
}

/// Helper: insert a User + Experiment into a DB
fn insert_experiment(conn: &Connection, exp_id: &str, user_id: &str, name: &str) {
    conn.execute(
        "INSERT OR IGNORE INTO User (id, name, email, role) VALUES (?1, 'Test', ?2, 'operator')",
        rusqlite::params![user_id, format!("{}@test.com", user_id)],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO Experiment (id, originalFilename, testDate, instrumentType, name, waterSource, fluidType, testGroup, metrics, rawPoints, userId)
         VALUES (?1, 'file.txt', '2026-01-01', 'Grace', ?2, 'tap', 'fluid', 'group', '{}', '[]', ?3)",
        rusqlite::params![exp_id, name, user_id],
    ).unwrap();
}

/// Helper: count experiments in a DB
fn count_experiments(conn: &Connection) -> u64 {
    conn.query_row("SELECT COUNT(*) FROM Experiment", [], |row| row.get(0))
        .unwrap()
}

/// Setup: create main and source DBs in a temp dir, attach src, and return (conn, dir)
fn setup_merge(main_ddl: &str, src_ddl: &str) -> (Connection, PathBuf) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!(
        "rheolab_merge_test_{}_{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed),
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let main_path = dir.join("main.db");
    let src_path = dir.join("source.db");

    // Create source DB and close it
    {
        let src_conn = create_db(&src_path, src_ddl);
        drop(src_conn);
    }

    // Create main DB, attach source
    let conn = create_db(&main_path, main_ddl);
    let src_str = src_path.to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("ATTACH DATABASE '{}' AS src", src_str))
        .unwrap();

    (conn, dir)
}

/// Re-open the src attachment after modifying source.db externally
fn reattach(conn: &Connection, dir: &std::path::Path) {
    let _ = conn.execute_batch("DETACH DATABASE src");
    let src_str = dir.join("source.db").to_string_lossy().replace('\'', "''");
    conn.execute_batch(&format!("ATTACH DATABASE '{}' AS src", src_str))
        .unwrap();
}

fn cleanup(dir: &std::path::Path) {
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn temp_dir_guard_removes_temp_directory_on_drop() {
    let dir = std::env::temp_dir().join(format!(
        "rheolab_temp_guard_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("import.db"), b"temporary import copy").unwrap();

    {
        let _guard = TempDirGuard::new(dir.clone());
        assert!(dir.exists());
    }

    assert!(!dir.exists());
}

#[test]
fn restore_integrity_accepts_valid_rheolab_db() {
    let dir = std::env::temp_dir().join(format!(
        "rheolab_restore_integrity_valid_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("backup.db");
    {
        let conn = create_db(&path, MAIN_SCHEMA);
        drop(conn);
    }

    assert!(validate_restore_backup_integrity(&path).is_ok());
    cleanup(&dir);
}

#[test]
fn restore_integrity_rejects_non_database_file() {
    let dir = std::env::temp_dir().join(format!(
        "rheolab_restore_integrity_bad_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join("backup.db");
    fs::write(&path, b"not sqlite").unwrap();

    assert!(validate_restore_backup_integrity(&path).is_err());
    cleanup(&dir);
}

// ─── get_common_columns ──────────────────────────────────────────────────────

#[test]
fn common_columns_identical_tables() {
    let (conn, dir) = setup_merge(
        "CREATE TABLE Foo (a TEXT, b INTEGER, c REAL);",
        "CREATE TABLE Foo (a TEXT, b INTEGER, c REAL);",
    );
    let cols = get_common_columns(&conn, "Foo");
    assert_eq!(cols, vec!["a", "b", "c"]);
    cleanup(&dir);
}

#[test]
fn common_columns_main_has_extra() {
    let (conn, dir) = setup_merge(
        "CREATE TABLE Foo (a TEXT, b INTEGER, c REAL, d TEXT);",
        "CREATE TABLE Foo (a TEXT, b INTEGER, c REAL);",
    );
    let cols = get_common_columns(&conn, "Foo");
    assert_eq!(cols, vec!["a", "b", "c"]);
    cleanup(&dir);
}

#[test]
fn common_columns_source_has_extra() {
    let (conn, dir) = setup_merge(
        "CREATE TABLE Bar (a TEXT, b INTEGER);",
        "CREATE TABLE Bar (a TEXT, b INTEGER, x TEXT);",
    );
    let cols = get_common_columns(&conn, "Bar");
    assert_eq!(cols, vec!["a", "b"]);
    cleanup(&dir);
}

#[test]
fn common_columns_no_overlap() {
    let (conn, dir) = setup_merge("CREATE TABLE Baz (x TEXT);", "CREATE TABLE Baz (y TEXT);");
    let cols = get_common_columns(&conn, "Baz");
    assert!(cols.is_empty());
    cleanup(&dir);
}

#[test]
fn common_columns_missing_in_src() {
    let (conn, dir) = setup_merge(
        "CREATE TABLE Main (a TEXT);",
        "CREATE TABLE Other (b TEXT);",
    );
    let cols = get_common_columns(&conn, "Main");
    assert!(cols.is_empty());
    cleanup(&dir);
}

// ─── merge_attached_databases ────────────────────────────────────────────────

#[test]
fn merge_basic_experiments() {
    let (conn, dir) = setup_merge(MAIN_SCHEMA, MAIN_SCHEMA);

    {
        let src = Connection::open(dir.join("source.db")).unwrap();
        src.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
        insert_experiment(&src, "exp-1", "user-a", "Experiment 1");
        insert_experiment(&src, "exp-2", "user-a", "Experiment 2");
    }

    reattach(&conn, &dir);
    let (imported, _) = merge_attached_databases(&conn, false).unwrap();
    assert_eq!(imported, 2);
    assert_eq!(count_experiments(&conn), 2);
    cleanup(&dir);
}

#[test]
fn merge_skips_duplicates() {
    let (conn, dir) = setup_merge(MAIN_SCHEMA, MAIN_SCHEMA);
    insert_experiment(&conn, "exp-1", "user-a", "Existing");

    {
        let src = Connection::open(dir.join("source.db")).unwrap();
        src.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
        insert_experiment(&src, "exp-1", "user-a", "Existing");
        insert_experiment(&src, "exp-2", "user-a", "New One");
    }

    reattach(&conn, &dir);
    let (imported, _) = merge_attached_databases(&conn, false).unwrap();
    assert_eq!(imported, 1, "Only new experiment imported");
    assert_eq!(count_experiments(&conn), 2);
    cleanup(&dir);
}

#[test]
fn merge_handles_schema_mismatch() {
    let old_schema = r#"
        CREATE TABLE User (
            id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE,
            role TEXT NOT NULL DEFAULT 'operator',
            createdAt TEXT NOT NULL DEFAULT (datetime('now')),
            updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE Experiment (
            id TEXT PRIMARY KEY,
            createdAt TEXT NOT NULL DEFAULT (datetime('now')),
            updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
            originalFilename TEXT NOT NULL, testDate TEXT NOT NULL,
            instrumentType TEXT NOT NULL, geometry TEXT,
            durationSeconds INTEGER, avgTemperatureC REAL, maxTemperatureC REAL,
            maxViscosity INTEGER,
            name TEXT NOT NULL, fieldName TEXT, operatorName TEXT,
            wellNumber TEXT, testId TEXT,
            waterSource TEXT NOT NULL, waterParams TEXT,
            fluidType TEXT NOT NULL, testGroup TEXT NOT NULL,
            metrics TEXT NOT NULL, rawPoints TEXT NOT NULL,
            userId TEXT NOT NULL,
            FOREIGN KEY (userId) REFERENCES User(id)
        );
    "#;

    let (conn, dir) = setup_merge(MAIN_SCHEMA, old_schema);

    {
        let src = Connection::open(dir.join("source.db")).unwrap();
        src.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
        src.execute(
            "INSERT INTO User (id, name, email, role) VALUES ('u1', 'Old', 'old@test.com', 'operator')",
            [],
        ).unwrap();
        src.execute(
            "INSERT INTO Experiment (id, originalFilename, testDate, instrumentType, name, waterSource, fluidType, testGroup, metrics, rawPoints, userId)
             VALUES ('old-exp', 'old.txt', '2025-01-01', 'Grace', 'Old Experiment', 'tap', 'fluid', 'group', '{}', '[]', 'u1')",
            [],
        ).unwrap();
    }

    reattach(&conn, &dir);
    let (imported, _) = merge_attached_databases(&conn, false).unwrap();
    assert_eq!(
        imported, 1,
        "Old-schema experiment imported via column intersection"
    );
    cleanup(&dir);
}

#[test]
fn merge_missing_source_table_is_skipped() {
    let minimal_schema = r#"
        CREATE TABLE User (
            id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE,
            role TEXT NOT NULL DEFAULT 'operator',
            createdAt TEXT NOT NULL DEFAULT (datetime('now')),
            updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE Experiment (
            id TEXT PRIMARY KEY,
            originalFilename TEXT NOT NULL, testDate TEXT NOT NULL,
            instrumentType TEXT NOT NULL, name TEXT NOT NULL,
            waterSource TEXT NOT NULL, fluidType TEXT NOT NULL,
            testGroup TEXT NOT NULL, metrics TEXT NOT NULL,
            rawPoints TEXT NOT NULL, userId TEXT NOT NULL,
            createdAt TEXT NOT NULL DEFAULT (datetime('now')),
            updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
        );
    "#;

    let (conn, dir) = setup_merge(MAIN_SCHEMA, minimal_schema);

    {
        let src = Connection::open(dir.join("source.db")).unwrap();
        src.execute(
            "INSERT INTO User (id, name, email, role) VALUES ('u1', 'Min', 'min@test.com', 'operator')",
            [],
        ).unwrap();
        src.execute(
            "INSERT INTO Experiment (id, originalFilename, testDate, instrumentType, name, waterSource, fluidType, testGroup, metrics, rawPoints, userId)
             VALUES ('min-exp', 'min.txt', '2025-06-01', 'Grace', 'Min Exp', 'tap', 'fluid', 'group', '{}', '[]', 'u1')",
            [],
        ).unwrap();
    }

    reattach(&conn, &dir);
    let (imported, _) = merge_attached_databases(&conn, false).unwrap();
    assert_eq!(
        imported, 1,
        "Experiment imported even when catalogs missing from source"
    );
    cleanup(&dir);
}

#[test]
fn merge_aborts_on_fk_collision_and_main_is_unchanged() {
    // DB-002 (audit-preflight) regression guard.
    //
    // Set up a known FK collision: main has a User with email
    // `shared@test.com`; source has a different User row with the same
    // email AND an Experiment that references that source-side user
    // by id.  When `INSERT OR IGNORE` runs against User the source's
    // row is dropped (UNIQUE email collision), but the Experiment row
    // gets imported referencing a userId that no longer exists in
    // main → orphan FK violation.
    //
    // Pre-DB-002 behaviour: merge committed and returned success with
    // a `warnings` field carrying the FK violation that nothing in the
    // UI ever read.  New behaviour: merge ABORTS (Err), the
    // transaction is rolled back, and main is identical to its
    // pre-merge state.
    let (conn, dir) = setup_merge(MAIN_SCHEMA, MAIN_SCHEMA);

    conn.execute(
        "INSERT INTO User (id, name, email, role) VALUES ('user-A-main', 'Main User', 'shared@test.com', 'operator')",
        [],
    ).unwrap();
    let pre_merge_user_count = count_users(&conn);
    let pre_merge_experiment_count = count_experiments(&conn);

    {
        let src = Connection::open(dir.join("source.db")).unwrap();
        src.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
        src.execute(
            "INSERT INTO User (id, name, email, role) VALUES ('user-A-src', 'Source User', 'shared@test.com', 'operator')",
            [],
        ).unwrap();
        src.execute(
            "INSERT INTO Experiment (id, originalFilename, testDate, instrumentType, name, waterSource, fluidType, testGroup, metrics, rawPoints, userId)
             VALUES ('fk-exp', 'fk.txt', '2026-01-01', 'Grace', 'FK Test', 'tap', 'fluid', 'group', '{}', '[]', 'user-A-src')",
            [],
        ).unwrap();
    }

    reattach(&conn, &dir);
    let result = merge_attached_databases(&conn, false);
    assert!(
        result.is_err(),
        "Merge must REFUSE to commit when FK violations remain — got Ok({:?})",
        result.ok(),
    );
    // RAII rollback: main DB state is preserved exactly as it was.
    assert_eq!(
        count_users(&conn),
        pre_merge_user_count,
        "User count must be unchanged after aborted merge",
    );
    assert_eq!(
        count_experiments(&conn),
        pre_merge_experiment_count,
        "Experiment count must be unchanged after aborted merge",
    );
    cleanup(&dir);
}

fn count_users(conn: &Connection) -> u64 {
    conn.query_row("SELECT COUNT(*) FROM User", [], |row| row.get(0))
        .unwrap_or(0)
}

#[test]
fn merge_with_experiment_data() {
    let (conn, dir) = setup_merge(MAIN_SCHEMA, MAIN_SCHEMA);

    {
        let src = Connection::open(dir.join("source.db")).unwrap();
        src.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
        insert_experiment(&src, "exp-d", "user-d", "With Data");
        src.execute(
            "INSERT INTO ExperimentData (experimentId, dataBlob, encoding, pointCount, createdAt, updatedAt)
             VALUES ('exp-d', X'DEADBEEF', 'columnar-v1-zstd', 100, datetime('now'), datetime('now'))",
            [],
        ).unwrap();
    }

    reattach(&conn, &dir);
    let (imported, _) = merge_attached_databases(&conn, false).unwrap();
    assert_eq!(imported, 1);

    let data_count: u64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ExperimentData WHERE experimentId = 'exp-d'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(data_count, 1, "ExperimentData blob imported");

    let point_count: u64 = conn
        .query_row(
            "SELECT pointCount FROM ExperimentData WHERE experimentId = 'exp-d'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(point_count, 100);
    cleanup(&dir);
}

#[test]
fn merge_with_reagents_and_calibration() {
    let (conn, dir) = setup_merge(MAIN_SCHEMA, MAIN_SCHEMA);

    {
        let src = Connection::open(dir.join("source.db")).unwrap();
        src.execute_batch("PRAGMA foreign_keys = OFF").unwrap();

        src.execute(
            "INSERT INTO ReagentCatalog (id, name, category) VALUES ('r1', 'CMC HV', 'polymer')",
            [],
        )
        .unwrap();
        insert_experiment(&src, "exp-rc", "user-rc", "With Reagent+Cal");
        src.execute(
            "INSERT INTO ExperimentReagent (id, experimentId, reagentId, reagentName, category, concentration, unit)
             VALUES ('er1', 'exp-rc', 'r1', 'CMC HV', 'polymer', 0.5, 'g/L')",
            [],
        ).unwrap();
        src.execute(
            "INSERT INTO Calibration (id, deviceType, rSquared, slope, intercept, hysteresis, stdev, status, rawData, experimentId)
             VALUES ('cal1', 'Grace', 0.99, 1.01, 0.005, 0.02, 0.001, 'PASS', '[]', 'exp-rc')",
            [],
        ).unwrap();
    }

    reattach(&conn, &dir);
    let (imported, _) = merge_attached_databases(&conn, false).unwrap();
    assert_eq!(imported, 1);

    let reagent: u64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ExperimentReagent WHERE experimentId = 'exp-rc'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(reagent, 1, "ExperimentReagent imported");

    let cal: u64 = conn
        .query_row(
            "SELECT COUNT(*) FROM Calibration WHERE experimentId = 'exp-rc'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(cal, 1, "Calibration imported");

    let catalog: u64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ReagentCatalog WHERE name = 'CMC HV'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(catalog, 1, "ReagentCatalog imported");
    cleanup(&dir);
}

#[test]
fn merge_remaps_reagent_links_when_catalog_name_collides() {
    // A fresh newer install may already contain seeded reagent catalog rows.
    // Older beta backups can contain the same reagent names with different ids.
    // Generic INSERT OR IGNORE skips the old catalog row on UNIQUE(name), so
    // ExperimentReagent must remap its source reagentId to the existing main id.
    let (conn, dir) = setup_merge(MAIN_SCHEMA, MAIN_SCHEMA);

    conn.execute(
        "INSERT INTO ReagentCatalog (id, name, category) VALUES ('seed_cmc_hv', 'CMC HV', 'polymer')",
        [],
    )
    .unwrap();

    {
        let src = Connection::open(dir.join("source.db")).unwrap();
        src.execute_batch("PRAGMA foreign_keys = OFF").unwrap();

        src.execute(
            "INSERT INTO ReagentCatalog (id, name, category) VALUES ('legacy-cmc-hv', 'CMC HV', 'polymer')",
            [],
        )
        .unwrap();
        insert_experiment(
            &src,
            "exp-legacy-rc",
            "user-legacy-rc",
            "Legacy Reagent Link",
        );
        src.execute(
            "INSERT INTO ExperimentReagent (id, experimentId, reagentId, reagentName, category, concentration, unit)
             VALUES ('er-legacy', 'exp-legacy-rc', 'legacy-cmc-hv', 'CMC HV', 'polymer', 0.5, 'g/L')",
            [],
        )
        .unwrap();
    }

    reattach(&conn, &dir);
    let (imported, _) = merge_attached_databases(&conn, false).unwrap();
    assert_eq!(imported, 1);

    let reagent_id: Option<String> = conn
        .query_row(
            "SELECT reagentId FROM ExperimentReagent WHERE id = 'er-legacy'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        reagent_id.as_deref(),
        Some("seed_cmc_hv"),
        "ExperimentReagent must point at the already-present catalog row"
    );

    let violations = check_foreign_key_violations(&conn);
    assert!(
        violations.is_empty(),
        "reagent remap should leave no FK violations, got {:?}",
        violations
    );

    cleanup(&dir);
}

#[test]
fn merge_idempotent() {
    let (conn, dir) = setup_merge(MAIN_SCHEMA, MAIN_SCHEMA);

    {
        let src = Connection::open(dir.join("source.db")).unwrap();
        src.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
        insert_experiment(&src, "exp-idem", "user-i", "Idempotent");
    }

    reattach(&conn, &dir);
    let (first, _) = merge_attached_databases(&conn, false).unwrap();
    assert_eq!(first, 1);

    reattach(&conn, &dir);
    let (second, _) = merge_attached_databases(&conn, false).unwrap();
    assert_eq!(second, 0, "Second merge imports nothing");
    assert_eq!(count_experiments(&conn), 1);
    cleanup(&dir);
}

#[test]
fn merge_laboratory_and_water_source() {
    let (conn, dir) = setup_merge(MAIN_SCHEMA, MAIN_SCHEMA);

    {
        let src = Connection::open(dir.join("source.db")).unwrap();
        src.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
        src.execute(
            "INSERT INTO Laboratory (id, name, description, createdAt, updatedAt)
             VALUES ('lab-1', 'Тест Лаб', 'Описание', datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();
        src.execute(
            "INSERT INTO WaterSourceCatalog (id, name, location, createdAt, updatedAt)
             VALUES ('ws-1', 'Речная вода', 'Москва', datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();
        src.execute(
            "INSERT INTO User (id, name, email, role, laboratoryId)
             VALUES ('user-lab', 'Lab User', 'lab@test.com', 'operator', 'lab-1')",
            [],
        )
        .unwrap();
        src.execute(
            "INSERT INTO Experiment (id, originalFilename, testDate, instrumentType, name, waterSource, fluidType, testGroup, metrics, rawPoints, userId, laboratoryId, waterSourceId)
             VALUES ('exp-lab', 'lab.txt', '2026-01-01', 'Grace', 'Lab Exp', 'Речная вода', 'fluid', 'group', '{}', '[]', 'user-lab', 'lab-1', 'ws-1')",
            [],
        ).unwrap();
    }

    reattach(&conn, &dir);
    let (imported, _) = merge_attached_databases(&conn, false).unwrap();
    assert_eq!(imported, 1);

    let lab: String = conn
        .query_row(
            "SELECT name FROM Laboratory WHERE id = 'lab-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(lab, "Тест Лаб");

    let ws: String = conn
        .query_row(
            "SELECT name FROM WaterSourceCatalog WHERE id = 'ws-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(ws, "Речная вода");
    cleanup(&dir);
}

#[test]
fn merge_empty_source() {
    let (conn, dir) = setup_merge(MAIN_SCHEMA, MAIN_SCHEMA);
    let (imported, _) = merge_attached_databases(&conn, false).unwrap();
    assert_eq!(imported, 0);
    cleanup(&dir);
}

#[test]
fn merge_tables_ordering() {
    let pos = |name: &str| MERGE_TABLES.iter().position(|&t| t == name).unwrap();
    assert!(pos("Laboratory") < pos("User"));
    assert!(pos("Laboratory") < pos("Experiment"));
    assert!(pos("User") < pos("Experiment"));
    assert!(pos("Experiment") < pos("ExperimentData"));
    assert!(pos("Experiment") < pos("ExperimentRheologyParameter"));
    assert!(pos("Experiment") < pos("ExperimentReagent"));
    assert!(pos("Experiment") < pos("Calibration"));
    assert!(pos("ReagentCatalog") < pos("ExperimentReagent"));
    assert!(pos("ImportBatch") < pos("ExperimentPayload"));
    assert!(pos("ImportBatch") < pos("ParserArtifact"));
    assert!(pos("ImportBatch") < pos("ReportArtifact"));
}

#[test]
fn merge_large_batch() {
    let (conn, dir) = setup_merge(MAIN_SCHEMA, MAIN_SCHEMA);

    {
        let src = Connection::open(dir.join("source.db")).unwrap();
        src.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
        for i in 0..50 {
            insert_experiment(
                &src,
                &format!("exp-{}", i),
                "user-bulk",
                &format!("Bulk {}", i),
            );
        }
    }

    reattach(&conn, &dir);
    let (imported, _) = merge_attached_databases(&conn, false).unwrap();
    assert_eq!(imported, 50);
    assert_eq!(count_experiments(&conn), 50);
    cleanup(&dir);
}

#[test]
fn merge_preserves_existing_data() {
    let (conn, dir) = setup_merge(MAIN_SCHEMA, MAIN_SCHEMA);

    insert_experiment(&conn, "main-1", "user-m", "Main 1");
    insert_experiment(&conn, "main-2", "user-m", "Main 2");
    insert_experiment(&conn, "main-3", "user-m", "Main 3");

    {
        let src = Connection::open(dir.join("source.db")).unwrap();
        src.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
        insert_experiment(&src, "main-1", "user-m", "Main 1");
        insert_experiment(&src, "src-1", "user-s", "Source 1");
    }

    reattach(&conn, &dir);
    let (imported, _) = merge_attached_databases(&conn, false).unwrap();
    assert_eq!(imported, 1, "Only 1 new experiment");
    assert_eq!(count_experiments(&conn), 4, "3 existing + 1 new");

    let name: String = conn
        .query_row(
            "SELECT name FROM Experiment WHERE id = 'main-2'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(name, "Main 2", "Existing data preserved");
    cleanup(&dir);
}

// ─── Audit-v2 DB-007/008: pre_startup_restore re-verification ──────────────

/// Helper: build a fresh tmp dir for pre_startup_restore tests.
fn pre_startup_tmp_dir(label: &str) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let dir = std::env::temp_dir().join(format!(
        "rheolab_pre_startup_{}_{}_{}",
        label,
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed),
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// Happy path: a valid SQLite file with the Experiment table is swapped
/// in, and the pending file is removed.
#[test]
fn pre_startup_restore_swaps_valid_pending_db() {
    let dir = pre_startup_tmp_dir("happy");
    let pending = dir.join("pending_restore.db");
    let main = dir.join("main.db");

    // Build a valid pending DB with the Experiment table.
    {
        let conn = create_db(&pending, MAIN_SCHEMA);
        drop(conn);
    }

    let result = pre_startup_restore(&dir, &main).unwrap();
    assert!(result, "valid pending DB must trigger swap");
    assert!(main.exists(), "main DB must exist after swap");
    assert!(!pending.exists(), "pending file must be removed after swap");

    cleanup(&dir);
}

/// No pending file → no swap, no error.
#[test]
fn pre_startup_restore_returns_false_when_no_pending_file() {
    let dir = pre_startup_tmp_dir("nopending");
    let main = dir.join("main.db");

    let result = pre_startup_restore(&dir, &main).unwrap();
    assert!(!result, "missing pending file must return Ok(false)");

    cleanup(&dir);
}

/// Non-SQLite junk in pending_restore.db → reject + quarantine, main DB
/// is left intact, next boot is clean.
#[test]
fn pre_startup_restore_rejects_non_sqlite_junk_and_quarantines() {
    let dir = pre_startup_tmp_dir("junk");
    let pending = dir.join("pending_restore.db");
    let main = dir.join("main.db");

    // Plant a "valid" main DB so we can prove it isn't touched.
    {
        let conn = create_db(&main, MAIN_SCHEMA);
        insert_experiment(&conn, "main-original", "u-main", "Original Main");
        drop(conn);
    }
    let pre_count = {
        let c = Connection::open(&main).unwrap();
        count_experiments(&c)
    };

    // Plant junk as the pending file.
    fs::write(&pending, b"this is not a SQLite database").unwrap();

    let result = pre_startup_restore(&dir, &main);
    assert!(
        result.is_err(),
        "non-SQLite junk must be refused — got Ok({:?})",
        result.ok()
    );
    assert!(
        !pending.exists(),
        "bad pending file must be moved out of place"
    );
    let post_count = {
        let c = Connection::open(&main).unwrap();
        count_experiments(&c)
    };
    assert_eq!(
        post_count, pre_count,
        "main DB must be untouched after refused swap"
    );
    let quarantined: Vec<_> = fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("pending_restore.db.rejected.")
        })
        .collect();
    assert_eq!(
        quarantined.len(),
        1,
        "exactly one quarantine file should exist after refused swap"
    );

    cleanup(&dir);
}

/// SQLite that opens cleanly but lacks the `Experiment` table → reject
/// + quarantine.
#[test]
fn pre_startup_restore_rejects_sqlite_without_experiment_table() {
    let dir = pre_startup_tmp_dir("foreign");
    let pending = dir.join("pending_restore.db");
    let main = dir.join("main.db");

    {
        let conn = Connection::open(&pending).unwrap();
        conn.execute("CREATE TABLE NotRheolab (id INTEGER PRIMARY KEY)", [])
            .unwrap();
        drop(conn);
    }

    let result = pre_startup_restore(&dir, &main);
    assert!(
        result.is_err(),
        "SQLite without Experiment table must be refused"
    );
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("Experiment table") || msg.contains("not a RheoLab"),
        "error must mention the missing Experiment table; got: {msg}"
    );

    cleanup(&dir);
}

/// SQLite carrying a future `schema_version` → reject (we cannot
/// downgrade; would otherwise leave the app permanently unbootable).
#[test]
fn pre_startup_restore_rejects_future_schema_version() {
    let dir = pre_startup_tmp_dir("future");
    let pending = dir.join("pending_restore.db");
    let main = dir.join("main.db");

    {
        let conn = create_db(&pending, MAIN_SCHEMA);
        conn.execute_batch(
            "CREATE TABLE schema_meta (\
                id INTEGER PRIMARY KEY CHECK (id = 1),\
                schema_version INTEGER NOT NULL,\
                app_version TEXT NOT NULL\
            );",
        )
        .unwrap();
        // Plant a version far in the future relative to CURRENT_SCHEMA_VERSION.
        let future = crate::db::migration::CURRENT_SCHEMA_VERSION + 99;
        conn.execute(
            "INSERT INTO schema_meta (id, schema_version, app_version) VALUES (1, ?1, '99.0.0')",
            rusqlite::params![future],
        )
        .unwrap();
        drop(conn);
    }

    let result = pre_startup_restore(&dir, &main);
    assert!(
        result.is_err(),
        "future schema_version must be refused — got Ok({:?})",
        result.ok()
    );
    let msg = result.unwrap_err().to_string();
    assert!(
        msg.contains("schema_version") && msg.contains("newer"),
        "error must explain the version mismatch; got: {msg}"
    );

    cleanup(&dir);
}

/// SQLite without a `schema_meta` table is treated as a legacy
/// pre-versioned DB (version 0) and accepted, since `run_migrations`
/// will walk the registry forward from there on next boot.
#[test]
fn pre_startup_restore_accepts_legacy_db_without_schema_meta() {
    let dir = pre_startup_tmp_dir("legacy");
    let pending = dir.join("pending_restore.db");
    let main = dir.join("main.db");

    // MAIN_SCHEMA in the test fixture intentionally omits schema_meta —
    // simulating a backup taken from a pre-versioned install.
    {
        let conn = create_db(&pending, MAIN_SCHEMA);
        drop(conn);
    }

    let result = pre_startup_restore(&dir, &main).unwrap();
    assert!(
        result,
        "legacy DB without schema_meta must be accepted (treated as version 0)"
    );

    cleanup(&dir);
}

/// Truncated SQLite header (less than 16 bytes) → reject without panic.
#[test]
fn pre_startup_restore_rejects_truncated_file() {
    let dir = pre_startup_tmp_dir("truncated");
    let pending = dir.join("pending_restore.db");
    let main = dir.join("main.db");

    fs::write(&pending, b"SQLi").unwrap(); // 4 bytes — read_exact will fail

    let result = pre_startup_restore(&dir, &main);
    assert!(
        result.is_err(),
        "truncated file must be refused — got Ok({:?})",
        result.ok()
    );

    cleanup(&dir);
}

#[test]
fn merge_import_batch_and_payloads() {
    let (conn, dir) = setup_merge(MAIN_SCHEMA, MAIN_SCHEMA);

    {
        let src = Connection::open(dir.join("source.db")).unwrap();
        src.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
        insert_experiment(&src, "exp-ib", "user-ib", "With ImportBatch");
        src.execute(
            "INSERT INTO ImportBatch (id, experimentsImported, status)
             VALUES ('ib-1', 1, 'completed')",
            [],
        )
        .unwrap();
        src.execute(
            "INSERT INTO ExperimentPayload (id, experimentId, importBatchId, payloadFormat, payloadJson, contentFingerprint)
             VALUES ('ep-1', 'exp-ib', 'ib-1', 'json', '{}', 'abc123')",
            [],
        ).unwrap();
    }

    reattach(&conn, &dir);
    let (imported, _) = merge_attached_databases(&conn, false).unwrap();
    assert_eq!(imported, 1);

    let batch: u64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ImportBatch WHERE id = 'ib-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(batch, 1, "ImportBatch imported");

    let payload: u64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ExperimentPayload WHERE experimentId = 'exp-ib'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(payload, 1, "ExperimentPayload imported");
    cleanup(&dir);
}
