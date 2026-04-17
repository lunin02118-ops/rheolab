/**
 * GOLD STANDARD PARSER PARITY TESTS (Rust)
 *
 * Validates parse_rheo_data() output against the reference values stored in
 * tests/fixtures/gold-standard.json (TS project root).
 *
 * Each fixture entry defines:
 *   - totalRows   – expected point count (±5 % tolerance)
 *   - firstRows   – first N points with exact field values (±5 % + 0.1 abs)
 *   - lastRows    – last  N points (same tolerance)
 *
 * IF THIS TEST FAILS: fix the parser (or update gold-standard.json).
 * NEVER silently widen tolerances.
 *
 * Covers unit-conversion regressions that the golden_tests.rs cycle-shape tests
 * cannot catch (pressure PSI→bar, dyne/cm²→Pa, minutes→seconds, etc.)
 */

use std::fs;
use std::path::PathBuf;

use serde::Deserialize;
use rheolab_core::parser::rheo_parser::parse_rheo_data;

// ─── Path helpers ─────────────────────────────────────────────────────────────

/// Returns the root of the TypeScript project (three levels above the crate).
/// CARGO_MANIFEST_DIR = …/RealLab Enterprise V2/src/rust/rheolab-core
fn ts_fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..") // → …/RealLab Enterprise V2
        .join("tests/fixtures")
}

fn rust_fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

// ─── Gold Standard JSON types ─────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct GoldRow {
    time_sec: f64,
    sample_temp_c: f64,
    #[serde(default)]
    bath_temperature_c: Option<f64>,
    shear_rate_1s: f64,
    shear_stress_pa: Option<f64>,
    viscosity_cp: f64,
    pressure_bar: f64,
}

#[derive(Debug, Deserialize)]
struct GoldEntry {
    #[serde(rename = "totalRows")]
    total_rows: usize,
    #[serde(default)]
    #[allow(dead_code)]
    requires_ai: bool,
    #[serde(rename = "firstRows")]
    first_rows: Vec<GoldRow>,
    #[serde(rename = "lastRows", default)]
    last_rows: Vec<GoldRow>,
}

// ─── Assertion helpers ────────────────────────────────────────────────────────

fn assert_field_near(row_idx: usize, field: &str, actual: f64, expected: f64) {
    if expected.abs() < 1e-3 && actual.abs() < 1e-3 {
        return; // both near-zero — skip
    }
    let tolerance = expected.abs() * 0.05 + 0.1;
    let diff = (actual - expected).abs();
    assert!(
        diff <= tolerance,
        "Row {row_idx} [{field}]: expected {expected:.3}, got {actual:.3} (diff {diff:.3}, tol ±{tolerance:.3})"
    );
}

fn validate_rows(label: &str, data: &[rheolab_core::types::RheoPoint], gold: &[GoldRow], offset: usize) {
    let count = gold.len().min(data.len().saturating_sub(offset));
    for i in 0..count {
        let p = &data[offset + i];
        let g = &gold[i];
        let ri = offset + i;
        assert_field_near(ri, "time_sec",     p.time_sec,       g.time_sec);
        assert_field_near(ri, "viscosity_cp", p.viscosity_cp,   g.viscosity_cp);
        assert_field_near(ri, "temperature_c",p.temperature_c,  g.sample_temp_c);
        if let Some(expected_bath) = g.bath_temperature_c {
            assert_field_near(ri, "bath_temperature_c", p.bath_temperature_c.unwrap_or(0.0), expected_bath);
        }
        assert_field_near(ri, "shear_rate_s1",p.shear_rate.unwrap_or(0.0), g.shear_rate_1s);
        if let Some(expected_ss) = g.shear_stress_pa {
            assert_field_near(ri, "shear_stress_pa", p.shear_stress.unwrap_or(0.0), expected_ss);
        }
        assert_field_near(ri, "pressure_bar", p.pressure_bar.unwrap_or(0.0), g.pressure_bar);
    }
    if count > 0 {
        println!("  [{label}] {count} rows validated OK");
    }
}

// ─── Test runner ──────────────────────────────────────────────────────────────

fn run_gold_standard_for(filename: &str, entry: &GoldEntry) {
    // Prefer TS fixtures folder; fall back to Rust fixtures folder for Rust-only files
    let ts_path = ts_fixtures_dir().join(filename);
    let rs_path = rust_fixtures_dir().join(filename);
    let path = if ts_path.exists() { ts_path } else { rs_path };

    if !path.exists() {
        println!("  [SKIP] Fixture file not found: {filename}");
        return;
    }

    let data = fs::read(&path).unwrap_or_else(|e| panic!("Failed to read {filename}: {e}"));
    let result = parse_rheo_data(&data, filename)
        .unwrap_or_else(|e| panic!("parse_rheo_data failed for {filename}: {e}"));

    println!("\n[GOLD] {filename}: parsed {} points (expected ~{})", result.data.len(), entry.total_rows);

    // ── Row count ──────────────────────────────────────────────────────────────
    let tolerance = (entry.total_rows as f64 * 0.05).max(5.0) as usize;
    let diff = result.data.len().abs_diff(entry.total_rows);
    assert!(
        diff <= tolerance,
        "{filename}: row count expected ~{}, got {} (diff {diff}, tol ±{tolerance})",
        entry.total_rows, result.data.len()
    );

    // ── First rows ─────────────────────────────────────────────────────────────
    if !entry.first_rows.is_empty() {
        validate_rows("firstRows", &result.data, &entry.first_rows, 0);
    }

    // ── Last rows ──────────────────────────────────────────────────────────────
    if !entry.last_rows.is_empty() {
        let offset = result.data.len().saturating_sub(entry.last_rows.len());
        validate_rows("lastRows", &result.data, &entry.last_rows, offset);
    }
}

// ─── Individual tests (one per fixture) ───────────────────────────────────────

fn load_gold_entry(filename: &str) -> Option<GoldEntry> {
    let gold_path = ts_fixtures_dir().join("gold-standard.json");
    let raw = fs::read_to_string(&gold_path)
        .unwrap_or_else(|e| panic!("Cannot read gold-standard.json: {e}"));
    let value: serde_json::Value = serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("Cannot parse gold-standard.json: {e}"));

    let entry_val = value.get(filename)?;

    // Skip AI-required files
    if entry_val.get("requiresAI").and_then(|v| v.as_bool()).unwrap_or(false) {
        println!("[SKIP] {filename} requires AI parsing");
        return None;
    }

    let entry: GoldEntry = serde_json::from_value(entry_val.clone())
        .unwrap_or_else(|e| panic!("Cannot deserialise entry for {filename}: {e}"));
    Some(entry)
}

#[test]
fn test_gold_grace() {
    let filename = "Отчёт Grace.xlsx";
    if let Some(entry) = load_gold_entry(filename) {
        run_gold_standard_for(filename, &entry);
    }
}

#[test]
fn test_gold_brookfield4() {
    let filename = "Brookfeild 4.xlsx";
    if let Some(entry) = load_gold_entry(filename) {
        run_gold_standard_for(filename, &entry);
    }
}

#[test]
fn test_gold_chandler() {
    let filename = "Отчёт Chandler.xls";
    if let Some(entry) = load_gold_entry(filename) {
        run_gold_standard_for(filename, &entry);
    }
}

#[test]
fn test_gold_bsl() {
    let filename = "Отчёт BSL.xlsx";
    if let Some(entry) = load_gold_entry(filename) {
        run_gold_standard_for(filename, &entry);
    }
}

#[test]
fn test_gold_sst_mamontovskoe_csv() {
    let filename = "8957 SST Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@63C 30.10.25.csv";
    if let Some(entry) = load_gold_entry(filename) {
        run_gold_standard_for(filename, &entry);
    }
}

#[test]
fn test_gold_bsl_562_60c() {
    let filename = "562@60C.xlsx";
    if let Some(entry) = load_gold_entry(filename) {
        run_gold_standard_for(filename, &entry);
    }
}

#[test]
fn test_gold_bsl_mixed_time_corruption() {
    let filename = "t-12.03.26-3BSL.xlsx";
    if let Some(entry) = load_gold_entry(filename) {
        run_gold_standard_for(filename, &entry);
    }
}
