/**
 * GOLDEN STANDARD TESTS (Rust)
 *
 * Port of tests/analysis/golden/golden.test.ts
 * Validates cycle detection against real fixture data.
 *
 * IF THIS TEST FAILS: Fix the logic, do NOT change the test.
 */
use std::fs;
use std::path::PathBuf;

use rheolab_core::parser::rheo_parser::parse_rheo_data;
use rheolab_core::types::{RheoCycle, RheoStep};
use rheolab_core::{detect_anchor_cycles_internal, is_sst_pattern, process_cycle_internal};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn load_steps(name: &str) -> Vec<RheoStep> {
    let path = fixtures_dir().join(format!("{}.json", name));
    let content = fs::read_to_string(&path).expect(&format!("Failed to read fixture: {:?}", path));
    serde_json::from_str(&content).expect(&format!("Failed to parse fixture: {:?}", path))
}

fn get_processed_rates(cycle: &RheoCycle) -> Vec<i32> {
    let processed = process_cycle_internal(cycle);
    processed
        .iter()
        .map(|s| s.avg_shear_rate.round() as i32)
        .collect()
}

fn contains_pattern(actual: &[i32], expected: &[i32]) -> bool {
    expected
        .iter()
        .all(|exp| actual.iter().any(|act| (act - exp).abs() <= 10))
}

// ==================== STANDARD PATTERNS ====================

#[test]
fn test_golden_chandler_iso_ramp() {
    // Expected: [100, 75, 50, 25]
    let steps = load_steps("chandler_steps");
    println!("[GOLDEN] Chandler: {} steps loaded", steps.len());

    let cycles = detect_anchor_cycles_internal(&steps);
    println!("[GOLDEN] Chandler: {} cycles detected", cycles.len());

    assert!(!cycles.is_empty(), "Should detect at least 1 cycle");

    let rates = get_processed_rates(&cycles[0]);
    println!("[GOLDEN] Chandler Cycle 1 rates: {:?}", rates);

    // Check pattern contains expected rates
    assert!(
        contains_pattern(&rates, &[100, 75, 50, 25]),
        "Expected pattern [100, 75, 50, 25], got {:?}",
        rates
    );
}

#[test]
fn test_golden_bsl_symmetric_api() {
    // BSL has a symmetric body but includes low non-standard rate (10),
    // so the cycle must remain Custom (not API) while preserving full body pattern.

    let steps = load_steps("bsl_steps");
    println!("[GOLDEN] BSL: {} steps loaded", steps.len());

    let cycles = detect_anchor_cycles_internal(&steps);
    println!("[GOLDEN] BSL: {} cycles detected", cycles.len());

    assert!(!cycles.is_empty(), "Should detect at least 1 cycle");

    let rates = get_processed_rates(&cycles[0]);
    println!("[GOLDEN] BSL Cycle 1 rates: {:?}", rates);
    println!("[GOLDEN] BSL Cycle 1 type: {}", cycles[0].cycle_type);

    // Verify BSL correct parsing
    // User requested BSL to be Custom (not API) because of non-standard rates (10)
    assert_eq!(
        cycles[0].cycle_type, "Custom",
        "Expected Cycle 1 to be Custom type"
    );

    // Check for full symmetric pattern [75, 50, 25, 10, 25, 50, 75]
    // Note: mixing step 100 should be excluded from processing
    assert!(
        contains_pattern(&rates, &[75, 50, 25, 10, 25, 50, 75]),
        "Expected API symmetric pattern, got {:?}",
        rates
    );
}

#[test]
fn test_golden_grace_symmetric_api() {
    // Expected: [75, 50, 25, 50, 75]
    let steps = load_steps("grace_steps");
    println!("[GOLDEN] Grace: {} steps loaded", steps.len());

    let cycles = detect_anchor_cycles_internal(&steps);
    println!("[GOLDEN] Grace: {} cycles detected", cycles.len());

    assert!(!cycles.is_empty(), "Should detect at least 1 cycle");

    let rates = get_processed_rates(&cycles[0]);
    println!("[GOLDEN] Grace Cycle 1 rates: {:?}", rates);

    // Check symmetric pattern
    assert!(
        contains_pattern(&rates, &[75, 50, 25]),
        "Expected pattern contains [75, 50, 25], got {:?}",
        rates
    );

    // Ensure no mixing step (100) in result
    assert!(
        rates.iter().all(|&r| r < 90),
        "Should exclude mixing steps (>90), got {:?}",
        rates
    );
}

#[test]
fn test_golden_brookfield_multi_cycle() {
    // Expected: 6 cycles of [75, 50, 25, 50, 75]
    let steps = load_steps("brookfield_steps");
    println!("[GOLDEN] Brookfield: {} steps loaded", steps.len());

    let cycles = detect_anchor_cycles_internal(&steps);
    println!("[GOLDEN] Brookfield: {} cycles detected", cycles.len());

    // Should detect multiple cycles
    assert!(
        cycles.len() >= 5,
        "Should detect at least 5 cycles, got {}",
        cycles.len()
    );
    assert!(
        cycles.len() <= 8,
        "Should detect at most 8 cycles, got {}",
        cycles.len()
    );

    // Check first cycle
    let rates = get_processed_rates(&cycles[0]);
    println!("[GOLDEN] Brookfield Cycle 1 rates: {:?}", rates);

    assert!(
        contains_pattern(&rates, &[75, 50, 25]),
        "Cycle 1 should contain pattern [75, 50, 25], got {:?}",
        rates
    );

    // Check all cycles have low and high points
    for (i, cycle) in cycles.iter().enumerate() {
        let cycle_rates = get_processed_rates(cycle);
        assert!(
            cycle_rates.iter().any(|&r| r <= 30),
            "Cycle {} should have low point (<=30), got {:?}",
            i + 1,
            cycle_rates
        );
        assert!(
            cycle_rates.iter().any(|&r| r >= 70),
            "Cycle {} should have high point (>=70), got {:?}",
            i + 1,
            cycle_rates
        );
    }
}

#[test]
fn test_golden_ofite_1100() {
    // Ofite 1100 DAT format test
    // With correct parseAsync export, we get 100 steps from 440 points (Sweep Data + Log Data combined)
    // Expected: API symmetric pattern [75, 50, 25, 50, 75]

    let steps = load_steps("ofite_1100_steps");
    println!("[GOLDEN] Ofite 1100: {} steps loaded", steps.len());

    // Should have ~100 steps after correct multi-section parsing
    assert!(
        steps.len() >= 90,
        "Should have ~100 steps, got {}",
        steps.len()
    );

    let cycles = detect_anchor_cycles_internal(&steps);
    println!("[GOLDEN] Ofite 1100: {} cycles detected", cycles.len());

    // Should detect multiple cycles
    assert!(
        cycles.len() >= 10,
        "Should detect many cycles, got {}",
        cycles.len()
    );

    let rates = get_processed_rates(&cycles[0]);
    println!("[GOLDEN] Ofite 1100 Cycle 1 rates: {:?}", rates);
    println!("[GOLDEN] Ofite 1100 Cycle 1 type: {}", cycles[0].cycle_type);

    // First cycle should be API with pattern [75, 50, 25, 50, 75]
    assert_eq!(
        cycles[0].cycle_type, "API",
        "First cycle should be API type"
    );
    assert_eq!(rates, vec![75, 50, 25, 50, 75], "API pattern should match");
    assert!(
        cycles[0].steps.len() >= 5,
        "Cycle should have at least 5 steps"
    );
}

// ==================== COMPLEX PATTERNS ====================

#[test]
fn test_golden_swb_mamontovskoe() {
    // Expected: Multiple cycles of [150, 125, 100]
    let steps = load_steps("swb_mamontovskoe_steps");
    println!("[GOLDEN] SWB: {} steps loaded", steps.len());

    let cycles = detect_anchor_cycles_internal(&steps);
    println!("[GOLDEN] SWB: {} cycles detected", cycles.len());

    // Should detect multiple separate cycles
    assert!(
        cycles.len() >= 3,
        "Should detect at least 3 cycles, got {}",
        cycles.len()
    );

    // Check first cycle
    let rates = get_processed_rates(&cycles[0]);
    println!("[GOLDEN] SWB Cycle 1 rates: {:?}", rates);

    // SWB pattern should have ~150, ~125, ~100
    assert!(
        rates.iter().any(|&r| r >= 140 && r <= 160),
        "Should have rate ~150, got {:?}",
        rates
    );
    assert!(
        rates.iter().any(|&r| r >= 120 && r <= 135),
        "Should have rate ~125, got {:?}",
        rates
    );

    // Cycles should not be giant merged ones
    for cycle in &cycles[..3.min(cycles.len())] {
        assert!(
            cycle.steps.len() < 10,
            "Cycle should have <10 steps (not merged), got {}",
            cycle.steps.len()
        );
    }
}

#[test]
fn test_golden_sst_mamontovskoe() {
    // Expected: 3 cycles of [511, 100]
    let steps = load_steps("sst_mamontovskoe_steps");
    println!("[GOLDEN] SST: {} steps loaded", steps.len());

    // First check if it's detected as SST pattern
    let is_sst = is_sst_pattern(&steps);
    println!("[GOLDEN] SST: is_sst_pattern = {}", is_sst);

    // For SST we need to use detect_sst_cycles through WASM binding
    // Since we can't call WASM in native tests, we'll verify the pattern detection
    assert!(is_sst, "Should be detected as SST pattern");

    // Verify step rates match expected SST pattern (high ~511, low ~100)
    let rates: Vec<i32> = steps
        .iter()
        .map(|s| s.avg_shear_rate.round() as i32)
        .collect();
    let has_high = rates.iter().any(|&r| r >= 500);
    let has_low = rates.iter().any(|&r| r >= 90 && r <= 110);

    assert!(has_high, "Should have high rate (~511), got {:?}", rates);
    assert!(has_low, "Should have low rate (~100), got {:?}", rates);
}

// ==================== PARSER PARITY TESTS ====================

#[test]
fn test_parser_parity_ofite_1100() {
    // Integration guard for the Ofite 1100 tab-delimited `.dat` report.
    //
    // Historical bug (rediscovered 2026-04-22):
    //   The fixture shipped as `Ofite1100.dat` (no space) but this test
    //   asked for `Ofite 1100.dat` (with space). `path.exists()` returned
    //   false → `return;` silently skipped. The whole "Ofite parser
    //   works end-to-end" promise was a NO-OP for months.
    //
    // Fix: load from the canonical name (with space) and `expect()` on
    // the read, so a renamed / missing fixture fails the suite loudly.
    //
    // Structure of the real file (see tests/fixtures/Ofite 1100.dat):
    //   L1-L12   metadata (Experiment, Date, Time, Units …)
    //   L13      "Analyzed Data:"   — NOT raw, computed Kv/K/Kf/r/r² rows
    //   L30      "Sweep Data:"      — per-step ramp averages
    //                                 (E.T./Rate/Stress/Viscosity/RPM/Temp/Press),
    //                                 14 sweeps × 8 rate points ≈ 112 rows.
    //   L145     "Log Data:"        — 1-min time-series (≈ 328 rows):
    //                                 Temperature/Shear Stress/Viscosity/
    //                                 RPM/Shear Rate/Pressure/Bath Temp.
    //
    // `find_raw_data_sections()` must return BOTH section starts when
    // both are present — cycle detection needs the clean per-step rows
    // from "Sweep Data:" AND the heat-up / recovery context from
    // "Log Data:".  Returning priority-only used to drop Sweep Data
    // silently; the resulting step stream from Log Data alone produced
    // 120+ noisy mixing rows and weirdly-merged cycles (reproducer:
    // user screenshot 2026-04-22).

    let path = fixtures_dir().join("Ofite 1100.dat");
    let data = fs::read(&path).unwrap_or_else(|e| {
        panic!(
            "Ofite fixture unreadable at {:?}: {}. \
             If you renamed the fixture, keep the canonical \
             `Ofite 1100.dat` (with space) — this test pair \
             relies on that exact name.",
            path, e,
        )
    });

    let result = parse_rheo_data(&data, "Ofite 1100.dat")
        .expect("parse_rheo_data must succeed on a well-formed Ofite 1100 .dat");

    println!("[PARITY] Ofite Parsing: {} points", result.data.len());

    // Regression guard: the combined Log Data + Sweep Data extraction
    // must yield ≳ 400 rows.  If the single-section (priority XOR
    // fallback) logic ever comes back, this number drops to ~328 — and
    // the user-visible "noisy cycle #1" regression returns.
    assert!(
        result.data.len() >= 400,
        "Ofite 1100: expected ≥ 400 raw points (Sweep Data + Log Data \
         combined), got {}. `find_raw_data_sections()` likely regressed \
         back to priority-XOR-fallback, dropping Sweep Data rows.",
        result.data.len(),
    );

    // Instrument must be tagged as Ofite — regression guard for detect_instrument()
    // when the file is passed without a sheet-name hint (common in .dat path).
    assert_eq!(
        result.metadata.instrument_type.as_deref(),
        Some("Ofite 1100 Rheometer"),
        "instrument_type should be auto-detected as 'Ofite 1100 Rheometer'",
    );

    // Sanity on a single point: temperature and shear rate must be populated,
    // otherwise the `map_row()` column mapping for Ofite's header layout is off.
    let first = &result.data[0];
    assert!(
        first.temperature_c > 0.0,
        "first Ofite point must have a non-zero temperature, got {}",
        first.temperature_c,
    );
    assert!(
        first.shear_rate.unwrap_or(0.0) > 0.0,
        "first Ofite point must have a non-zero shear rate, got {:?}",
        first.shear_rate,
    );
}

#[test]
fn test_parser_dat_support() {
    // Test parsing of .dat file with tab delimiters
    let path = fixtures_dir().join("test_ofite.dat");
    let data = fs::read(&path).expect("Failed to read test_ofite.dat");

    let result = parse_rheo_data(&data, "test_ofite.dat");

    match result {
        Ok(res) => {
            println!("[TEST] DAT Parsing Success: {} points", res.data.len());
            assert!(
                res.data.len() >= 2,
                "Should parse at least 2 points from dummy file, got {}",
                res.data.len()
            );
            assert_eq!(
                res.metadata.instrument_type,
                Some("Ofite 1100 Rheometer".to_string())
            );
        }
        Err(e) => {
            panic!("Failed to parse .dat file: {}", e);
        }
    }
}
