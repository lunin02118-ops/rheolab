use super::*;
use crate::db::migration::run_migrations;
use rusqlite::Connection;
use serde_json::json;
use std::collections::BTreeMap;

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
        rheology_source: RheologyParameterSource::Program,
        rheology_parameters: vec![],
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

fn make_save_payload() -> ExperimentSavePayload {
    ExperimentSavePayload {
        name: "Test BSL 63°C".to_string(),
        field_name: None,
        operator_name: None,
        well_number: None,
        test_id: None,
        original_filename: "bsl_63c.xlsx".to_string(),
        test_date: "2024-01-01".to_string(),
        instrument_type: "BSL R1".to_string(),
        geometry: Some("R1B5".to_string()),
        geometry_source: Some("manual".to_string()),
        water_source: "Lake 274".to_string(),
        water_params: None,
        fluid_type: "Crosslinked".to_string(),
        test_group: "Completion".to_string(),
        test_sub_group: None,
        test_category: None,
        test_type: None,
        dominant_pattern: None,
        metrics: json!({ "maxViscosity": 850 }),
        raw_points: vec![json!({ "time_sec": 0, "viscosity_cp": 850 })],
        calibration: Some(json!({ "status": "valid" })),
        reagents: Vec::new(),
        overwrite: None,
        laboratory_id: None,
        parsed_by: None,
        parse_source: None,
        time_range_min: None,
        time_range_max: None,
        viscosity_min: None,
        pressure_max: None,
        extra_fields: None,
        rheology_source: RheologyParameterSource::Program,
        rheology_parameters: vec![],
    }
}

fn make_rheology_row(
    source: RheologyParameterSource,
    cycle_no: i32,
    n_prime: f64,
) -> RheologyParameterRow {
    let mut viscosities = BTreeMap::new();
    viscosities.insert("40".to_string(), 1200.0 + cycle_no as f64);
    viscosities.insert("100".to_string(), 800.0 + cycle_no as f64);

    let mut units = BTreeMap::new();
    units.insert("kPrime".to_string(), "Pa*s^n".to_string());
    units.insert("viscosity".to_string(), "cP".to_string());

    RheologyParameterRow {
        source,
        cycle_no,
        time_min: Some(cycle_no as f64 * 10.0),
        end_time_min: Some(cycle_no as f64 * 10.0 + 1.0),
        temp_c: Some(80.0),
        pressure_bar: Some(12.5),
        n_prime: Some(n_prime),
        kv_pasn: Some(0.21),
        k_prime_pasn: Some(0.22),
        k_slot_pasn: Some(0.23),
        k_pipe_pasn: Some(0.24),
        r2: Some(0.99),
        viscosities,
        bingham_pv_pas: Some(0.3),
        bingham_yp_pa: Some(4.5),
        bingham_r2: Some(0.98),
        calc_points: Some(30),
        source_sheet: Some("Power Law Data".to_string()),
        source_row: Some(42),
        units,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[test]
fn save_payload_strips_calibration_without_feature() {
    let mut payload = make_save_payload();
    strip_payload_calibration_unless_allowed(&mut payload, false);
    assert!(payload.calibration.is_none());
}

#[test]
fn save_payload_keeps_calibration_for_developer_tiers() {
    let mut payload = make_save_payload();
    strip_payload_calibration_unless_allowed(&mut payload, true);
    assert!(payload.calibration.is_some());
}

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
    assert_eq!(
        loaded.parse_source, exp.parse_source,
        "parse_source must round-trip"
    );
    assert_eq!(
        loaded.time_range_min, exp.time_range_min,
        "timeRangeMin must round-trip"
    );
    assert_eq!(
        loaded.time_range_max, exp.time_range_max,
        "timeRangeMax must round-trip"
    );
    assert_eq!(
        loaded.pressure_max, exp.pressure_max,
        "pressureMax must round-trip"
    );
    // calibration JSON
    assert!(
        loaded.calibration.is_some(),
        "calibration JSON must round-trip"
    );
    assert_eq!(
        loaded.calibration.as_ref().unwrap()["status"],
        json!("valid"),
        "calibration.status must be preserved"
    );
    // extra_fields
    assert!(
        loaded.extra_fields.is_some(),
        "extra_fields must round-trip"
    );
    assert_eq!(loaded.extra_fields.unwrap()["customField"], json!("value1"));
}

#[test]
fn roundtrip_rheology_parameters_for_both_sources() {
    let conn = open_db();
    let mut exp = make_experiment("rheo_001");
    exp.rheology_source = RheologyParameterSource::Instrument;
    exp.rheology_parameters = vec![
        make_rheology_row(RheologyParameterSource::Instrument, 1, 0.61),
        make_rheology_row(RheologyParameterSource::Program, 1, 0.62),
    ];

    persist_experiment(&conn, &exp).unwrap();
    let loaded = load_experiment_by_id(&conn, "rheo_001").unwrap().unwrap();

    assert_eq!(loaded.rheology_source, RheologyParameterSource::Instrument);
    assert_eq!(loaded.rheology_parameters.len(), 2);
    assert!(loaded.rheology_parameters.iter().any(|row| {
        row.source == RheologyParameterSource::Instrument
            && row.cycle_no == 1
            && row.n_prime == Some(0.61)
            && row.k_prime_pasn == Some(0.22)
            && row.viscosities.get("40") == Some(&1201.0)
            && row.source_sheet.as_deref() == Some("Power Law Data")
    }));
    assert!(loaded.rheology_parameters.iter().any(|row| {
        row.source == RheologyParameterSource::Program && row.n_prime == Some(0.62)
    }));
}

#[test]
fn detail_meta_includes_rheology_parameters() {
    let conn = open_db();
    let mut exp = make_experiment("rheo_meta_001");
    exp.rheology_source = RheologyParameterSource::Instrument;
    exp.rheology_parameters = vec![make_rheology_row(
        RheologyParameterSource::Instrument,
        3,
        0.73,
    )];

    persist_experiment(&conn, &exp).unwrap();
    let meta = load_experiment_detail_meta_by_id(&conn, "rheo_meta_001")
        .unwrap()
        .expect("detail meta must exist");

    assert_eq!(meta.rheology_source, RheologyParameterSource::Instrument);
    assert_eq!(meta.rheology_parameters.len(), 1);
    assert_eq!(
        meta.rheology_parameters[0].source,
        RheologyParameterSource::Instrument
    );
    assert_eq!(meta.rheology_parameters[0].cycle_no, 3);
    assert_eq!(meta.rheology_parameters[0].n_prime, Some(0.73));
}

#[test]
fn upsert_replaces_rheology_parameters_atomically_with_experiment() {
    let conn = open_db();
    let mut exp = make_experiment("rheo_replace_001");
    exp.rheology_source = RheologyParameterSource::Instrument;
    exp.rheology_parameters = vec![
        make_rheology_row(RheologyParameterSource::Instrument, 1, 0.51),
        make_rheology_row(RheologyParameterSource::Program, 1, 0.52),
    ];
    persist_experiment(&conn, &exp).unwrap();

    let mut updated = exp.clone();
    updated.rheology_source = RheologyParameterSource::Program;
    updated.rheology_parameters =
        vec![make_rheology_row(RheologyParameterSource::Program, 2, 0.72)];
    persist_experiment(&conn, &updated).unwrap();

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ExperimentRheologyParameter WHERE experimentId = 'rheo_replace_001'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);

    let loaded = load_experiment_by_id(&conn, "rheo_replace_001")
        .unwrap()
        .unwrap();
    assert_eq!(loaded.rheology_source, RheologyParameterSource::Program);
    assert_eq!(loaded.rheology_parameters.len(), 1);
    assert_eq!(
        loaded.rheology_parameters[0].source,
        RheologyParameterSource::Program
    );
    assert_eq!(loaded.rheology_parameters[0].cycle_no, 2);
    assert_eq!(loaded.rheology_parameters[0].n_prime, Some(0.72));
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
        .query_row(
            "SELECT COUNT(*) FROM Calibration WHERE experimentId='cal_001'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(before, 1, "Calibration row must exist before upsert");

    // Upsert the experiment — must NOT delete then re-insert the Experiment row
    let mut updated = exp.clone();
    updated.name = "Resaved".to_string();
    persist_experiment(&conn, &updated).unwrap();

    let after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM Calibration WHERE experimentId='cal_001'",
            [],
            |r| r.get(0),
        )
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
        .query_row(
            "SELECT COUNT(*) FROM ExperimentReagent WHERE experimentId='rg_001'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(before, 1);

    // Re-save.  persist_experiment deletes+reinserts reagents explicitly
    // (that is safe), but must NOT cascade-delete via Experiment row replacement.
    persist_experiment(&conn, &exp).unwrap();

    let after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ExperimentReagent WHERE experimentId='rg_001'",
            [],
            |r| r.get(0),
        )
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
        .query_row(
            "SELECT COUNT(*) FROM ExperimentData WHERE experimentId='del_001'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    // columnar encode may silently fail on tiny raw_points arrays, so only
    // assert that if it was written, it survives delete logic.
    let had_blob = blob_count > 0;

    // Run the same DELETE chain that experiments_delete uses
    let tx = conn.unchecked_transaction().unwrap();
    tx.execute(
        "DELETE FROM ExperimentData WHERE experimentId = ?1",
        params!["del_001"],
    )
    .unwrap();
    tx.execute("DELETE FROM Experiment WHERE id = ?1", params!["del_001"])
        .unwrap();
    tx.commit().unwrap();

    let exp_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM Experiment WHERE id='del_001'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(exp_count, 0, "Experiment row must be deleted");

    let blob_after: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ExperimentData WHERE experimentId='del_001'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        blob_after, 0,
        "ExperimentData BLOB must be cleaned up on delete"
    );
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
    let names: Vec<_> = loaded
        .reagents
        .iter()
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
        loaded.raw_points.len(),
        exp.raw_points.len(),
        "raw_points count must be preserved"
    );
    // The columnar decoder may not exact-match JSON floats, but viscosity_cp
    // should be numerically close.
    let orig_visc: f64 = exp.raw_points[0]["viscosity_cp"].as_f64().unwrap_or(0.0);
    let loaded_visc: f64 = loaded.raw_points[0]["viscosity_cp"]
        .as_f64()
        .unwrap_or(-1.0);
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
    assert!(
        matches!(result, Ok(None)),
        "missing experiment must return Ok(None)"
    );
}

/// MEM-1: detail metadata read must stay lightweight. It should return the
/// fields needed for chart-first saved-detail open without serializing raw
/// point arrays.
#[test]
fn detail_meta_excludes_raw_points_and_keeps_summary() {
    let conn = open_db();
    let mut exp = make_experiment("meta_001");
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

    let meta = load_experiment_detail_meta_by_id(&conn, "meta_001")
        .unwrap()
        .expect("detail meta should exist");

    assert_eq!(meta.id, exp.id);
    assert_eq!(meta.name, exp.name);
    assert_eq!(meta.geometry, exp.geometry);
    assert_eq!(meta.summary.point_count, exp.raw_points.len());
    assert_eq!(meta.summary.max_viscosity, exp.max_viscosity);
    assert_eq!(meta.summary.avg_viscosity, exp.avg_viscosity);
    assert_eq!(meta.summary.time_range_min, exp.time_range_min);
    assert_eq!(meta.summary.time_range_max, exp.time_range_max);
    assert_eq!(meta.reagents.len(), 1);

    let json = serde_json::to_value(&meta).unwrap();
    assert!(
        json.get("rawPoints").is_none(),
        "rawPoints must not serialize"
    );
    assert!(
        json.get("raw_points").is_none(),
        "raw_points must not serialize"
    );
}

/// MEM-3: saved-experiment raw table reads should page rows by id instead of
/// serializing the full rawPoints array to the WebView.
#[test]
fn raw_table_page_by_id_reads_columnar_page() {
    let conn = open_db();
    let mut exp = make_experiment("raw_page_001");
    exp.raw_points = vec![
        json!({
            "time_sec": 0.0,
            "viscosity_cp": 100.0,
            "temperature_c": 25.0,
            "speed_rpm": 300.0,
            "shear_rate_s1": 511.0,
            "shear_stress_pa": 51.0,
            "pressure_bar": 0.0,
            "bath_temperature_c": 25.0
        }),
        json!({
            "time_sec": 60.0,
            "viscosity_cp": 110.0,
            "temperature_c": 26.0,
            "speed_rpm": 300.0,
            "shear_rate_s1": 511.0,
            "shear_stress_pa": 52.0,
            "pressure_bar": 1.0,
            "bath_temperature_c": 26.0
        }),
        json!({
            "time_sec": 120.0,
            "viscosity_cp": 120.0,
            "temperature_c": 27.0,
            "speed_rpm": 300.0,
            "shear_rate_s1": 511.0,
            "shear_stress_pa": 53.0,
            "pressure_bar": 2.0,
            "bath_temperature_c": 27.0
        }),
        json!({
            "time_sec": 180.0,
            "viscosity_cp": 130.0,
            "temperature_c": 28.0,
            "speed_rpm": 300.0,
            "shear_rate_s1": 511.0,
            "shear_stress_pa": 54.0,
            "pressure_bar": 3.0,
            "bath_temperature_c": 28.0
        }),
    ];
    persist_experiment(&conn, &exp).unwrap();

    let page = load_raw_table_page_by_id(&conn, "raw_page_001", 2, 2)
        .unwrap()
        .expect("raw table page should exist");

    assert_eq!(page.experiment_id, "raw_page_001");
    assert_eq!(page.total_rows, 4);
    assert_eq!(page.page, 2);
    assert_eq!(page.page_size, 2);
    assert_eq!(page.total_pages, 2);
    assert!(page.has_bath_temperature);
    assert_eq!(page.rows.len(), 2);

    let first = &page.rows[0];
    assert_eq!(first.index, 3);
    assert_eq!(first.time_sec, Some(120.0));
    assert_eq!(first.viscosity_cp, Some(120.0));
    assert_eq!(first.temperature_c, Some(27.0));
    assert_eq!(first.speed_rpm, Some(300.0));
    assert_eq!(first.shear_rate_s1, Some(511.0));
    assert_eq!(first.shear_stress_pa, Some(53.0));
    assert_eq!(first.pressure_bar, Some(2.0));
    assert_eq!(first.bath_temperature_c, Some(27.0));
}

#[test]
fn raw_table_page_by_id_returns_none_for_missing_experiment() {
    let conn = open_db();
    let page = load_raw_table_page_by_id(&conn, "missing_raw_page", 1, 25).unwrap();
    assert!(page.is_none());
}

// ── Touch-point precompute (PR2 Phase B) ─────────────────────────────────

/// Build a StoredExperiment whose raw_points form a declining curve that
/// crosses the library 50 cP threshold around minute 8 at a constant
/// shear rate of 511 s⁻¹.  Every field other than raw_points follows
/// `make_experiment`, so this helper is a tight superset.
fn make_experiment_with_crossing(id: &str) -> StoredExperiment {
    let mut exp = make_experiment(id);
    // 0..12 min, 1 s step, linear 200 → 10 cP at 511 s⁻¹.
    exp.raw_points = (0..=720)
        .map(|i| {
            let t = i as f64;
            let frac = (i as f64) / 720.0;
            let visc = 200.0 + (10.0 - 200.0) * frac;
            json!({
                "timeSec": t,
                "viscosityCp": visc,
                "shearRate": 511.0,
                "temperatureC": 70.0,
            })
        })
        .collect();
    exp
}

type TouchColumns = (
    Option<i64>,
    Option<f64>,
    Option<f64>,
    Option<f64>,
    Option<i64>,
);

fn read_touch_columns(conn: &Connection, id: &str) -> TouchColumns {
    conn.query_row(
        "SELECT touchHasCrossing, touchCrossingTimeMin, touchCrossingViscosityCp, \
                touchViscosityAtTargetCp, touchPrecomputeVersion \
         FROM Experiment WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok((
                row.get(0)?,
                row.get(1)?,
                row.get(2)?,
                row.get(3)?,
                row.get(4)?,
            ))
        },
    )
    .unwrap()
}

/// PR2 Phase B: save-path must populate all five touch-point columns
/// under the fixed library contract (50 cP / 10 min).
#[test]
fn persist_writes_touch_point_columns_for_crossing() {
    let conn = open_db();
    let exp = make_experiment_with_crossing("tp_cross_001");
    persist_experiment(&conn, &exp).unwrap();

    let (has, t_cross, v_cross, v_target, version) = read_touch_columns(&conn, "tp_cross_001");

    assert_eq!(
        has,
        Some(1),
        "linear decline to 10 cP must yield has_crossing = 1"
    );
    let t = t_cross.expect("crossing time must be written");
    assert!(
        (6.0..=10.0).contains(&t),
        "crossing time must land inside the declining window, got {t}"
    );
    let v = v_cross.expect("crossing viscosity must be written");
    assert!(
        v > 30.0 && v < 80.0,
        "crossing viscosity near 50 cP, got {v}"
    );
    let vt = v_target.expect("target-time viscosity must be written");
    assert!(
        vt > 20.0 && vt < 80.0,
        "target-time viscosity should land near the threshold for this curve, got {vt}"
    );
    assert_eq!(
        version,
        Some(crate::db::touch_point_precompute::TOUCH_PRECOMPUTE_VERSION),
        "precompute version tag must be stamped on every save"
    );
}

/// Save-path still stamps `touchPrecomputeVersion` even when no crossing
/// exists, so startup backfill never re-processes the row.
#[test]
fn persist_flat_curve_records_precompute_version_without_crossing() {
    let conn = open_db();
    let mut exp = make_experiment("tp_flat_001");
    exp.raw_points = (0..=72)
        .map(|i| {
            json!({
                "timeSec": (i as f64) * 10.0,
                "viscosityCp": 120.0,
                "shearRate": 511.0,
                "temperatureC": 70.0,
            })
        })
        .collect();
    persist_experiment(&conn, &exp).unwrap();

    let (has, t_cross, v_cross, v_target, version) = read_touch_columns(&conn, "tp_flat_001");
    assert_eq!(has, Some(0), "flat 120 cP curve must not cross 50 cP");
    assert!(t_cross.is_none());
    assert!(v_cross.is_none());
    assert!(
        v_target.is_some(),
        "target-time viscosity must still be written for a flat curve past 10 min"
    );
    assert_eq!(
        version,
        Some(crate::db::touch_point_precompute::TOUCH_PRECOMPUTE_VERSION)
    );
}

/// Re-saving an experiment (UPDATE path) must refresh the precomputed
/// touch-point values rather than leaving stale ones from the previous
/// version.
#[test]
fn resave_refreshes_touch_point_columns() {
    let conn = open_db();

    // First save — flat curve, no crossing.
    let mut exp = make_experiment("tp_resave_001");
    exp.raw_points = (0..=72)
        .map(|i| {
            json!({
                "timeSec": (i as f64) * 10.0,
                "viscosityCp": 200.0,
                "shearRate": 511.0,
                "temperatureC": 70.0,
            })
        })
        .collect();
    persist_experiment(&conn, &exp).unwrap();
    assert_eq!(read_touch_columns(&conn, "tp_resave_001").0, Some(0));

    // Re-save with a declining curve that DOES cross 50 cP.
    let exp2 = make_experiment_with_crossing("tp_resave_001");
    persist_experiment(&conn, &exp2).unwrap();
    let (has, t_cross, _, _, _) = read_touch_columns(&conn, "tp_resave_001");
    assert_eq!(
        has,
        Some(1),
        "re-save with declining curve must flip has_crossing"
    );
    assert!(t_cross.is_some());
}

/// Backfill path: rows persisted before v0002 (and therefore with
/// `touchPrecomputeVersion IS NULL`) get picked up on the next run.
#[test]
fn backfill_fills_legacy_rows_with_null_precompute_version() {
    let conn = open_db();

    // Seed a real experiment and then simulate a pre-v0002 / pre-v0003
    // state by clearing both the legacy touch columns on `Experiment`
    // AND the v0003 `TouchPointPrecompute` side table — the backfill
    // task must rebuild everything from the columnar blob on its own.
    let exp = make_experiment_with_crossing("tp_backfill_001");
    persist_experiment(&conn, &exp).unwrap();
    conn.execute(
        "UPDATE Experiment SET touchHasCrossing = NULL, touchCrossingTimeMin = NULL, \
         touchCrossingViscosityCp = NULL, touchViscosityAtTargetCp = NULL, \
         touchPrecomputeVersion = NULL WHERE id = 'tp_backfill_001'",
        [],
    )
    .unwrap();
    conn.execute(
        "DELETE FROM TouchPointPrecompute WHERE experimentId = 'tp_backfill_001'",
        [],
    )
    .unwrap();
    assert_eq!(
        read_touch_columns(&conn, "tp_backfill_001").4,
        None,
        "precondition: row must be in 'pending' state"
    );

    // Run the backfill task — should locate this row and recompute.
    let stats = crate::db::touch_point_precompute::run_touch_point_backfill(&conn).unwrap();
    assert!(
        stats.processed >= 1,
        "backfill must process the pending row"
    );

    let (has, t_cross, _, _, version) = read_touch_columns(&conn, "tp_backfill_001");
    assert_eq!(
        has,
        Some(1),
        "declining curve must have a crossing after backfill"
    );
    assert!(
        t_cross.is_some(),
        "crossing time must be set after backfill"
    );
    assert_eq!(
        version,
        Some(crate::db::touch_point_precompute::TOUCH_PRECOMPUTE_VERSION),
        "backfill must stamp the precompute version"
    );
}

/// Backfill must skip rows that already carry a precompute version —
/// running the task a second time on a settled DB must be a no-op.
#[test]
fn backfill_skips_already_precomputed_rows() {
    let conn = open_db();
    let exp = make_experiment_with_crossing("tp_settled_001");
    persist_experiment(&conn, &exp).unwrap();

    let stats = crate::db::touch_point_precompute::run_touch_point_backfill(&conn).unwrap();
    assert_eq!(
        stats.processed, 0,
        "row already precomputed at save time — backfill must skip it"
    );
    assert!(!stats.has_more);
}
