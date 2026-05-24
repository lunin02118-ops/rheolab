//! Gold-standard tests for instrument-reported rheology parameter tables.
//!
//! Raw data points and detected cycles already have fixture parity tests. This
//! file adds the same protection for the new parsed instrument rheology source.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use rheolab_core::parser::rheo_parser::parse_rheo_data;
use rheolab_core::parser::types::RheologyParameterRow;
use serde::Deserialize;

const GOLD_FILE: &str = "instrument-rheology-gold-standard.json";

#[derive(Debug, Deserialize)]
struct InstrumentGoldEntry {
    #[serde(rename = "expectedRows")]
    expected_rows: usize,
    #[serde(rename = "sourceSheet")]
    source_sheet: String,
    #[serde(rename = "sourceRows")]
    source_rows: Vec<i32>,
    #[serde(rename = "maxSourceRow")]
    max_source_row: Option<i32>,
    rows: Vec<ExpectedRheologyRow>,
}

#[derive(Debug, Deserialize, Default)]
struct ExpectedRheologyRow {
    cycle_no: i32,
    time_min: Option<f64>,
    temp_c: Option<f64>,
    pressure_bar: Option<f64>,
    n_prime: Option<f64>,
    kv_pasn: Option<f64>,
    k_prime_pasn: Option<f64>,
    k_slot_pasn: Option<f64>,
    k_pipe_pasn: Option<f64>,
    r2: Option<f64>,
    #[serde(default)]
    viscosities: BTreeMap<String, f64>,
    bingham_pv_pas: Option<f64>,
    bingham_yp_pa: Option<f64>,
    bingham_r2: Option<f64>,
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join("tests/fixtures")
}

fn load_gold_entries() -> BTreeMap<String, InstrumentGoldEntry> {
    let raw = fs::read_to_string(fixtures_dir().join(GOLD_FILE))
        .unwrap_or_else(|e| panic!("Cannot read {GOLD_FILE}: {e}"));
    let value: serde_json::Value =
        serde_json::from_str(&raw).unwrap_or_else(|e| panic!("Cannot parse {GOLD_FILE}: {e}"));
    let object = value
        .as_object()
        .unwrap_or_else(|| panic!("{GOLD_FILE} must be a JSON object"));

    object
        .iter()
        .filter(|(key, _)| !key.starts_with('_'))
        .map(|(key, value)| {
            let entry = serde_json::from_value(value.clone())
                .unwrap_or_else(|e| panic!("Cannot parse {GOLD_FILE} entry {key}: {e}"));
            (key.clone(), entry)
        })
        .collect()
}

fn assert_near(filename: &str, row_no: usize, field: &str, actual: f64, expected: f64) {
    let tolerance = (expected.abs() * 1e-6).max(1e-8);
    let diff = (actual - expected).abs();
    assert!(
        diff <= tolerance,
        "{filename} row {row_no} [{field}]: expected {expected:.12}, got {actual:.12} (diff {diff:.12}, tol {tolerance:.12})"
    );
}

fn assert_opt_near(
    filename: &str,
    row_no: usize,
    field: &str,
    actual: Option<f64>,
    expected: Option<f64>,
) {
    if let Some(expected) = expected {
        let actual =
            actual.unwrap_or_else(|| panic!("{filename} row {row_no} [{field}]: value missing"));
        assert_near(filename, row_no, field, actual, expected);
    }
}

fn assert_viscosities(
    filename: &str,
    row_no: usize,
    actual: &BTreeMap<String, f64>,
    expected: &BTreeMap<String, f64>,
) {
    assert_eq!(
        actual.keys().collect::<Vec<_>>(),
        expected.keys().collect::<Vec<_>>(),
        "{filename} row {row_no}: viscosity shear-rate keys changed"
    );

    for (rate, expected_value) in expected {
        let actual_value = actual
            .get(rate)
            .copied()
            .unwrap_or_else(|| panic!("{filename} row {row_no}: missing viscosity @{rate}"));
        assert_near(
            filename,
            row_no,
            &format!("viscosity@{rate}"),
            actual_value,
            *expected_value,
        );
    }
}

fn assert_row_matches(
    filename: &str,
    row_no: usize,
    actual: &RheologyParameterRow,
    expected: &ExpectedRheologyRow,
) {
    assert_eq!(
        actual.cycle_no, expected.cycle_no,
        "{filename} row {row_no}: cycle number changed"
    );

    assert_opt_near(
        filename,
        row_no,
        "time_min",
        actual.time_min,
        expected.time_min,
    );
    assert_opt_near(filename, row_no, "temp_c", actual.temp_c, expected.temp_c);
    assert_opt_near(
        filename,
        row_no,
        "pressure_bar",
        actual.pressure_bar,
        expected.pressure_bar,
    );
    assert_opt_near(
        filename,
        row_no,
        "n_prime",
        actual.n_prime,
        expected.n_prime,
    );
    assert_opt_near(
        filename,
        row_no,
        "kv_pasn",
        actual.kv_pasn,
        expected.kv_pasn,
    );
    assert_opt_near(
        filename,
        row_no,
        "k_prime_pasn",
        actual.k_prime_pasn,
        expected.k_prime_pasn,
    );
    assert_opt_near(
        filename,
        row_no,
        "k_slot_pasn",
        actual.k_slot_pasn,
        expected.k_slot_pasn,
    );
    assert_opt_near(
        filename,
        row_no,
        "k_pipe_pasn",
        actual.k_pipe_pasn,
        expected.k_pipe_pasn,
    );
    assert_opt_near(filename, row_no, "r2", actual.r2, expected.r2);
    assert_opt_near(
        filename,
        row_no,
        "bingham_pv_pas",
        actual.bingham_pv_pas,
        expected.bingham_pv_pas,
    );
    assert_opt_near(
        filename,
        row_no,
        "bingham_yp_pa",
        actual.bingham_yp_pa,
        expected.bingham_yp_pa,
    );
    assert_opt_near(
        filename,
        row_no,
        "bingham_r2",
        actual.bingham_r2,
        expected.bingham_r2,
    );
    assert_viscosities(filename, row_no, &actual.viscosities, &expected.viscosities);
}

#[test]
fn instrument_rheology_matches_real_fixture_gold_standard() {
    let entries = load_gold_entries();
    assert!(
        !entries.is_empty(),
        "{GOLD_FILE} must contain at least one real fixture entry"
    );

    for (filename, entry) in entries {
        let path = fixtures_dir().join(&filename);
        let data = fs::read(&path).unwrap_or_else(|e| {
            panic!("Failed to read instrument rheology fixture {filename}: {e}")
        });
        let result = parse_rheo_data(&data, &filename)
            .unwrap_or_else(|e| panic!("parse_rheo_data failed for {filename}: {e}"));
        let actual = result.instrument_rheology;

        assert_eq!(
            actual.len(),
            entry.expected_rows,
            "{filename}: instrument rheology row count changed; cycles={:?}",
            actual.iter().map(|row| row.cycle_no).collect::<Vec<_>>()
        );
        assert_eq!(
            actual.len(),
            entry.rows.len(),
            "{filename}: gold rows and expectedRows disagree"
        );
        assert_eq!(
            actual.len(),
            entry.source_rows.len(),
            "{filename}: sourceRows must mirror expectedRows"
        );

        for (idx, ((actual_row, expected_row), expected_source_row)) in actual
            .iter()
            .zip(entry.rows.iter())
            .zip(entry.source_rows.iter())
            .enumerate()
        {
            let row_no = idx + 1;
            assert_eq!(
                actual_row.source_sheet.as_deref(),
                Some(entry.source_sheet.as_str()),
                "{filename} row {row_no}: source sheet changed"
            );
            assert_eq!(
                actual_row.source_row,
                Some(*expected_source_row),
                "{filename} row {row_no}: source row changed"
            );
            assert_row_matches(&filename, row_no, actual_row, expected_row);
        }

        if let Some(max_source_row) = entry.max_source_row {
            assert!(
                actual.iter().all(|row| row
                    .source_row
                    .is_some_and(|source_row| source_row <= max_source_row)),
                "{filename}: parser crossed the instrument table boundary into raw data rows: {:?}",
                actual
                    .iter()
                    .map(|row| (row.cycle_no, row.source_sheet.clone(), row.source_row))
                    .collect::<Vec<_>>()
            );
        }
    }
}
