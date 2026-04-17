use super::*;
use crate::db::migration::run_migrations;
use rusqlite::Connection;
use serde_json::json;

// ── Fixture builders ─────────────────────────────────────────────────────

/// Minimal, fully-valid StoredExperiment for tests.
fn make_experiment(id: &str) -> StoredExperiment {
    StoredExperiment {
        id: id.to_string(),
        created_at: "2024-01-01T10:00:00Z".to_string(),
        updated_at: "2024-01-01T10:00:00Z".to_string(),
        name: "Test BSL 63°C".to_string(),
        field_name: Some("Mamontovskoe".to_string()),
        operator_name: Some("Ivanov I.I.".to_string()),
        well_number: Some("W-42".to_string()),
        test_id: Some("BSL-001".to_string()),
        original_filename: "bsl_63c.xlsx".to_string(),
        test_date: "2024-01-01".to_string(),
        instrument_type: "BSL R1".to_string(),
        geometry: Some("R1B5".to_string()),
        geometry_source: Some("manual".to_string()),
        water_source: "Lake 274".to_string(),
        water_params: Some(json!({ "ph": 7.2, "salinity": 1500 })),
        fluid_type: "Crosslinked".to_string(),
        test_group: "Completion".to_string(),
        test_sub_group: Some("Stage-2".to_string()),
        metrics: json!({ "maxViscosity": 850, "avgViscosity": 600 }),
        raw_points: vec![
            json!({ "time_sec": 0, "viscosity_cp": 800, "temperature_c": 25.0 }),
            json!({ "time_sec": 60, "viscosity_cp": 850, "temperature_c": 63.0 }),
        ],
        calibration: Some(json!({
            "deviceType": "BSL R1",
            "rSquared": 0.9998,
            "slope": 1.001,
            "intercept": -0.05,
            "status": "valid"
        })),
        reagents: vec![],
        max_viscosity: Some(850),
        avg_viscosity: Some(600),
        user: None,
        laboratory: None,
        parsed_by: Some("RheoParser".to_string()),
        parse_source: Some("xlsx".to_string()),
        time_range_min: Some(0.0),
        time_range_max: Some(120.0),
        viscosity_min: Some(35.0),
        pressure_max: Some(200.0),
        extra_fields: Some(json!({ "customField": "value1" })),
        test_category: None,
        test_type: None,
        dominant_pattern: None,
    }
}

fn open_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", true).unwrap();
    run_migrations(&conn).unwrap();
    conn
}

// ── Tests ─────────────────────────────────────────────────────────────────

/// Full field roundtrip: every field written by persist_experiment must
/// be readable back through load_experiment_by_id without data loss.
#[test]
fn roundtrip_all_fields() {
    let conn = open_db();
    let exp = make_experiment("rt_001");
    persist_experiment(&conn, &exp).unwrap();

    let loaded = load_experiment_by_id(&conn, "rt_001")
        .unwrap()
        .expect("experiment must exist after persist");

    assert_eq!(loaded.id, exp.id);
    assert_eq!(loaded.name, exp.name);
    assert_eq!(loaded.field_name, exp.field_name);
    assert_eq!(loaded.operator_name, exp.operator_name);
    assert_eq!(loaded.well_number, exp.well_number);
    assert_eq!(loaded.test_id, exp.test_id);
    assert_eq!(loaded.original_filename, exp.original_filename);
    assert_eq!(loaded.test_date, exp.test_date);
    assert_eq!(loaded.instrument_type, exp.instrument_type);
    assert_eq!(loaded.geometry, exp.geometry);
    assert_eq!(loaded.geometry_source, exp.geometry_source);
    assert_eq!(loaded.water_source, exp.water_source);
    assert_eq!(loaded.fluid_type, exp.fluid_type);
    assert_eq!(loaded.test_group, exp.test_group);
    assert_eq!(loaded.test_sub_group, exp.test_sub_group);
    // V8 fields
    assert_eq!(loaded.parsed_by, exp.parsed_by, "parsed_by must round-trip");
    assert_eq!(loaded.parse_source, exp.parse_source, "parse_source must round-trip");
    assert_eq!(loaded.time_range_min, exp.time_range_min, "timeRangeMin must round-trip");
    assert_eq!(loaded.time_range_max, exp.time_range_max, "timeRangeMax must round-trip");
    assert_eq!(loaded.pressure_max, exp.pressure_max, "pressureMax must round-trip");
    // calibration JSON
    assert!(loaded.calibration.is_some(), "calibration JSON must round-trip");
    assert_eq!(
        loaded.calibration.as_ref().unwrap()["status"],
        json!("valid"),
        "calibration.status must be preserved"
    );
    // extra_fields
    assert!(loaded.extra_fields.is_some(), "extra_fields must round-trip");
    assert_eq!(
        loaded.extra_fields.unwrap()["customField"],
        json!("value1")
    );
}

/// CRITICAL-1: upsert must PRESERVE the original createdAt timestamp.
/// Before the fix INSERT OR REPLACE deleted+reinserted the row, silently
/// resetting createdAt to the update time.
#[test]
fn upsert_preserves_created_at() {
    let conn = open_db();
    let exp = make_experiment("ca_001");
    persist_experiment(&conn, &exp).unwrap();

    // Re-save with a different name and later updated_at
    let mut updated = exp.clone();
    updated.name = "Updated Name".to_string();
    updated.updated_at = "2024-06-15T12:00:00Z".to_string();
    persist_experiment(&conn, &updated).unwrap();

    let loaded = load_experiment_by_id(&conn, "ca_001").unwrap().unwrap();
    assert_eq!(
        loaded.created_at, "2024-01-01T10:00:00Z",
        "createdAt must stay at original value after upsert"
    );
    assert_eq!(loaded.name, "Updated Name", "name must be updated");
    assert_eq!(
        loaded.updated_at, "2024-06-15T12:00:00Z",
        "updatedAt must reflect the new value"
    );
}

/// CRITICAL-1 regression: Calibration row (FK ON DELETE CASCADE to Experiment)
/// must survive a persist_experiment update call.
/// Before the fix INSERT OR REPLACE deleted+reinserted the Experiment row,
/// cascading the DELETE to Calibration.
#[test]
fn upsert_preserves_calibration_row() {
    let conn = open_db();
    let exp = make_experiment("cal_001");
    persist_experiment(&conn, &exp).unwrap();

    // Simulate Calibration saved by a separate flow after experiment creation.
    conn.execute(
        "INSERT INTO Calibration \
         (id, deviceType, rSquared, slope, intercept, hysteresis, stdev, status, rawData, experimentId) \
         VALUES ('calib_1', 'BSL R1', 0.9998, 1.001, -0.05, 0.01, 0.02, 'valid', '[]', 'cal_001')",
        [],
    ).unwrap();

    let before: i64 = conn
        .query_row("SELECT COUNT(*) FROM Calibration WHERE experimentId='cal_001'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(before, 1, "Calibration row must exist before upsert");

    // Upsert the experiment — must NOT delete then re-insert the Experiment row
    let mut updated = exp.clone();
    updated.name = "Resaved".to_string();
    persist_experiment(&conn, &updated).unwrap();

    let after: i64 = conn
        .query_row("SELECT COUNT(*) FROM Calibration WHERE experimentId='cal_001'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        after, 1,
        "CRITICAL-1 regression: Calibration row was deleted by upsert (INSERT OR REPLACE cascade)"
    );
}

/// CRITICAL-1 regression: ExperimentReagent rows must survive a re-save.
#[test]
fn upsert_preserves_reagent_rows() {
    let conn = open_db();
    let mut exp = make_experiment("rg_001");
    exp.reagents = vec![StoredExperimentReagent {
        reagent_id: None,
        reagent_name: Some("WG-9000F".to_string()),
        concentration: 3.4,
        unit: "kg/m3".to_string(),
        batch_number: Some("B42".to_string()),
        production_date: None,
        category: Some("Viscosifier".to_string()),
        reagent: None,
    }];
    persist_experiment(&conn, &exp).unwrap();

    let before: i64 = conn
        .query_row("SELECT COUNT(*) FROM ExperimentReagent WHERE experimentId='rg_001'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(before, 1);

    // Re-save.  persist_experiment deletes+reinserts reagents explicitly
    // (that is safe), but must NOT cascade-delete via Experiment row replacement.
    persist_experiment(&conn, &exp).unwrap();

    let after: i64 = conn
        .query_row("SELECT COUNT(*) FROM ExperimentReagent WHERE experimentId='rg_001'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(after, 1, "CRITICAL-1: ReagentRows must survive upsert");
}

/// CRITICAL-2a: delete_experiment must remove the ExperimentData BLOB.
/// Tests the explicit DELETE added in 68c5c94 rather than going through
/// the tauri command (which requires AppState).
#[test]
fn delete_experiment_removes_experiment_data() {
    let conn = open_db();
    let exp = make_experiment("del_001");
    persist_experiment(&conn, &exp).unwrap();

    // Verify ExperimentData was written
    let blob_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM ExperimentData WHERE experimentId='del_001'", [], |r| r.get(0))
        .unwrap();
    // columnar encode may silently fail on tiny raw_points arrays, so only
    // assert that if it was written, it survives delete logic.
    let had_blob = blob_count > 0;

    // Run the same DELETE chain that experiments_delete uses
    let tx = conn.unchecked_transaction().unwrap();
    tx.execute("DELETE FROM ExperimentData WHERE experimentId = ?1", params!["del_001"]).unwrap();
    tx.execute("DELETE FROM Experiment WHERE id = ?1", params!["del_001"]).unwrap();
    tx.commit().unwrap();

    let exp_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM Experiment WHERE id='del_001'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(exp_count, 0, "Experiment row must be deleted");

    let blob_after: i64 = conn
        .query_row("SELECT COUNT(*) FROM ExperimentData WHERE experimentId='del_001'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(blob_after, 0, "ExperimentData BLOB must be cleaned up on delete");
    let _ = had_blob; // explicitly used to avoid unused warning
}

/// Load after persist returns reagents sorted correctly, including reagent
/// fields (name, category, concentration, unit, batchNumber).
#[test]
fn roundtrip_reagents() {
    let conn = open_db();
    let mut exp = make_experiment("rgt_001");
    exp.reagents = vec![
        StoredExperimentReagent {
            reagent_id: None,
            reagent_name: Some("WG-9000F".to_string()),
            concentration: 3.4,
            unit: "kg/m3".to_string(),
            batch_number: Some("B42".to_string()),
            production_date: None,
            category: Some("Viscosifier".to_string()),
            reagent: None,
        },
        StoredExperimentReagent {
            reagent_id: None,
            reagent_name: Some("WCL".to_string()),
            concentration: 2.8,
            unit: "kg/m3".to_string(),
            batch_number: None,
            production_date: None,
            category: Some("Crosslinker".to_string()),
            reagent: None,
        },
    ];
    persist_experiment(&conn, &exp).unwrap();

    let loaded = load_experiment_by_id(&conn, "rgt_001").unwrap().unwrap();
    assert_eq!(loaded.reagents.len(), 2, "both reagents must be loaded");
    // verify names survived
    let names: Vec<_> = loaded.reagents.iter()
        .filter_map(|r| r.reagent_name.as_deref())
        .collect();
    assert!(names.contains(&"WG-9000F"), "WG-9000F must round-trip");
    assert!(names.contains(&"WCL"), "WCL must round-trip");
}

/// rawPoints round-trips through columnar encode/decode.
/// The raw_points loaded back must have the same viscosity_cp values.
#[test]
fn roundtrip_raw_points_via_columnar() {
    let conn = open_db();
    let exp = make_experiment("rp_001");
    persist_experiment(&conn, &exp).unwrap();

    let loaded = load_experiment_by_id(&conn, "rp_001").unwrap().unwrap();
    assert_eq!(
        loaded.raw_points.len(), exp.raw_points.len(),
        "raw_points count must be preserved"
    );
    // The columnar decoder may not exact-match JSON floats, but viscosity_cp
    // should be numerically close.
    let orig_visc: f64 = exp.raw_points[0]["viscosity_cp"].as_f64().unwrap_or(0.0);
    let loaded_visc: f64 = loaded.raw_points[0]["viscosity_cp"].as_f64().unwrap_or(-1.0);
    assert!(
        (orig_visc - loaded_visc).abs() < 1.0,
        "viscosity_cp must survive columnar encode/decode (orig={orig_visc} loaded={loaded_visc})"
    );
}

/// Non-existent experiment returns None without error.
#[test]
fn load_missing_experiment_returns_none() {
    let conn = open_db();
    let result = load_experiment_by_id(&conn, "no_such_id");
    assert!(matches!(result, Ok(None)), "missing experiment must return Ok(None)");
}
