//! Unit tests for `experiments::helpers`.
//!
//! Extracted from `helpers.rs` to keep the production file below the
//! 500-LOC hygiene limit.

use super::*;
use serde_json::json;

// ── parse_number_from_str ────────────────────────────────────────────────

#[test]
fn parse_number_valid_float() {
    assert_eq!(parse_number_from_str("2.75"), Some(2.75));
}

#[test]
fn parse_number_valid_integer() {
    assert_eq!(parse_number_from_str("42"), Some(42.0));
}

#[test]
fn parse_number_empty_returns_none() {
    assert_eq!(parse_number_from_str(""), None);
}

#[test]
fn parse_number_whitespace_returns_none() {
    assert_eq!(parse_number_from_str("   "), None);
}

#[test]
fn parse_number_non_numeric_returns_none() {
    assert_eq!(parse_number_from_str("abc"), None);
}

#[test]
fn parse_number_trims_whitespace() {
    assert_eq!(parse_number_from_str("  25.5  "), Some(25.5));
}

// ── number_from_json ─────────────────────────────────────────────────────

#[test]
fn number_from_json_float() {
    assert_eq!(number_from_json(&json!(2.75)), Some(2.75));
}

#[test]
fn number_from_json_integer() {
    assert_eq!(number_from_json(&json!(7_i64)), Some(7.0));
}

#[test]
fn number_from_json_string_number() {
    assert_eq!(number_from_json(&json!("42.5")), Some(42.5));
}

#[test]
fn number_from_json_null_returns_none() {
    assert_eq!(number_from_json(&json!(null)), None);
}

#[test]
fn number_from_json_non_numeric_string_returns_none() {
    assert_eq!(number_from_json(&json!("notanumber")), None);
}

// ── extract_max_viscosity ────────────────────────────────────────────────

#[test]
fn extract_max_viscosity_from_metrics() {
    let metrics = json!({ "maxViscosity": 850 });
    assert_eq!(extract_max_viscosity(&metrics), Some(850));
}

#[test]
fn extract_max_viscosity_fallback_to_initial() {
    let metrics = json!({ "initialViscosity_5_10": 600.7 });
    assert_eq!(extract_max_viscosity(&metrics), Some(601));
}

#[test]
fn extract_max_viscosity_missing_returns_none() {
    let metrics = json!({});
    assert_eq!(extract_max_viscosity(&metrics), None);
}

// ── extract_avg_viscosity_from_raw ────────────────────────────────────────

#[test]
fn extract_avg_viscosity_empty_returns_none() {
    assert_eq!(extract_avg_viscosity_from_raw(&[]), None);
}

#[test]
fn extract_avg_viscosity_computes_average() {
    let pts = vec![
        json!({ "viscosity_cp": 100.0 }),
        json!({ "viscosity_cp": 200.0 }),
    ];
    // avg = 150, rounded = 150
    assert_eq!(extract_avg_viscosity_from_raw(&pts), Some(150));
}

#[test]
fn extract_avg_viscosity_ignores_zero_values() {
    let pts = vec![
        json!({ "viscosity_cp": 0.0 }),
        json!({ "viscosity_cp": 300.0 }),
    ];
    // only 300 is > 0, so avg = 300
    assert_eq!(extract_avg_viscosity_from_raw(&pts), Some(300));
}

// ── short_hash ────────────────────────────────────────────────────────────

#[test]
fn short_hash_is_deterministic() {
    assert_eq!(short_hash("hello"), short_hash("hello"));
}

#[test]
fn short_hash_differs_for_different_inputs() {
    assert_ne!(short_hash("hello"), short_hash("world"));
}

#[test]
fn short_hash_has_expected_length() {
    // 6 bytes × 2 hex chars = 12 chars
    assert_eq!(short_hash("test").len(), 12);
}
