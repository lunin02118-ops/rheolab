//! Shared test fixtures for the list-query test suite.

use super::*;
use crate::commands::parsing::{parse_file_native, ParseRequest};
use crate::state::AppState;
use serde_json::json;
use uuid::Uuid;

/// Create an isolated AppState backed by a temporary file database.
/// Each call returns a state with a unique DB so tests don't interfere.
pub(super) fn make_test_state() -> AppState {
    let dir = std::env::temp_dir().join(format!(
        "rheolab_list_test_{}",
        Uuid::new_v4().to_string().replace('-', "")
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("test.db");
    let pool = crate::db::create_pool(&db_path).unwrap();
    let migration_result = {
        let conn = pool.get().unwrap();
        crate::db::migration::run_migrations(&conn).unwrap()
    };
    AppState {
        database_path: db_path,
        backups_dir: dir.join("backups"),
        app_data_dir: dir,
        db_pool: pool,
        license_engine: None,
        migration_result,
    }
}

pub(super) fn minimal_experiment(id: &str, field: Option<&str>, water: &str) -> StoredExperiment {
    StoredExperiment {
        id: id.to_string(),
        created_at: "2024-01-01T10:00:00Z".to_string(),
        updated_at: "2024-01-01T10:00:00Z".to_string(),
        name: format!("Test {}", id),
        field_name: field.map(|s| s.to_string()),
        operator_name: None,
        well_number: None,
        test_id: None,
        original_filename: format!("{}.xlsx", id),
        test_date: "2024-01-01".to_string(),
        instrument_type: "BSL R1".to_string(),
        geometry: None,
        geometry_source: None,
        water_source: water.to_string(),
        water_params: None,
        fluid_type: "Linear".to_string(),
        test_group: "Test".to_string(),
        test_sub_group: None,
        metrics: json!({}),
        raw_points: vec![],
        calibration: None,
        reagents: vec![],
        max_viscosity: None,
        avg_viscosity: None,
        user: None,
        laboratory: None,
        parsed_by: None,
        parse_source: None,
        time_range_min: None,
        time_range_max: None,
        viscosity_min: None,
        pressure_max: None,
        extra_fields: None,
        test_category: None,
        test_type: None,
        dominant_pattern: None,
    }
}

pub(super) fn default_query() -> ExperimentsListQuery {
    serde_json::from_value(json!({})).unwrap()
}

pub(super) fn query_with(key: &str, val: &str) -> ExperimentsListQuery {
    serde_json::from_value(json!({ key: val })).unwrap()
}

pub(super) fn experiment_from_parse(
    id: &str,
    parsed_filename: &str,
    resp: &crate::commands::parsing::ParseFileResponse,
) -> StoredExperiment {
    let mut exp = minimal_experiment(id, None, "Well");
    exp.name = format!("Fixture {id}");
    exp.original_filename = parsed_filename.to_string();
    if let Some(ref instrument) = resp.metadata.instrument_type {
        exp.instrument_type = instrument.clone();
    }
    if let Some(ref date) = resp.metadata.test_date {
        exp.test_date = date.clone();
    }
    exp.raw_points = resp
        .data
        .iter()
        .map(|pt| {
            json!({
                "timeSec": pt.time_sec,
                "viscosityCp": pt.viscosity_cp,
                "shearRate": pt.shear_rate_s1,
                "temperatureC": pt.temperature_c,
                "pressureBar": pt.pressure_bar,
                "bathTemperatureC": pt.bath_temperature_c,
                "speedRpm": pt.speed_rpm,
                "shearStressPa": pt.shear_stress_pa,
            })
        })
        .collect();
    exp
}

pub(super) fn parse_fixture_bytes(filename: &str) -> crate::commands::parsing::ParseFileResponse {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("tests")
        .join("fixtures")
        .join(filename);
    let bytes = std::fs::read(&path).expect("fixture file must be readable");
    parse_file_native(ParseRequest {
        filename: filename.to_string(),
        file_path: None,
        bytes: Some(bytes),
        force_ai: None,
        ai_model: None,
    })
    .expect("fixture must parse")
}

/// Seed an experiment with a declining curve that crosses the library
/// threshold (50 cP) somewhere inside the first 10 min.  Used to produce
/// a row with `touchHasCrossing = 1` plus plausible crossing / target
/// values via the save-path precompute.
pub(super) fn experiment_with_crossing(id: &str, start_cp: f64, end_cp: f64) -> StoredExperiment {
    let mut exp = minimal_experiment(id, None, "Well");
    // 0..12 min at 1 s resolution, linear decline.
    exp.raw_points = (0..=720)
        .map(|i| {
            let t = i as f64;
            let frac = (i as f64) / 720.0;
            let visc = start_cp + (end_cp - start_cp) * frac;
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

/// Seed a flat curve above the threshold — no crossing, but the algorithm
/// still emits a target-time viscosity.
pub(super) fn experiment_flat_no_crossing(id: &str, flat_cp: f64) -> StoredExperiment {
    let mut exp = minimal_experiment(id, None, "Well");
    exp.raw_points = (0..=72)
        .map(|i| {
            json!({
                "timeSec": (i as f64) * 10.0,
                "viscosityCp": flat_cp,
                "shearRate": 511.0,
                "temperatureC": 70.0,
            })
        })
        .collect();
    exp
}
