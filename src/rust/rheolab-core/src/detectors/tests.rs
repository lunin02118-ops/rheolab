//! Unit tests for cycle-detection algorithms.
//!
//! Each test constructs a synthetic [`RheoStep`] sequence and exercises a
//! single detector function. Integration-style tests that run the full
//! parse → detect → process pipeline live in `tests/golden_tests.rs`.

use crate::types::RheoStep;
use super::{
    detect_sst_cycles_internal, is_sst_pattern,
    is_repeating_sequence_pattern, detect_repeating_sequence_cycles_internal,
};
use super::mixing::is_mixing_step;
use super::classify::create_cycle;

fn create_test_step(id: i32, start: f64, duration: f64, rate: f64) -> RheoStep {
    RheoStep {
        id,
        start_time: start,
        end_time: start + duration,
        duration,
        avg_shear_rate: rate,
        avg_shear_stress: rate * 0.1,
        avg_viscosity: 100.0,
        avg_temperature: 25.0,
        avg_pressure: 0.0,
        points: vec![],
        calc_points_count: 10,
        is_ramp: false,
        start_index: 0,
        end_index: 10,
        is_split_start: false,
    }
}

#[test]
fn test_is_mixing_step_by_edge_rate() {
    let steps = vec![
        create_test_step(1, 0.0, 60.0, 100.0),    // Mixing candidate
        create_test_step(2, 60.0, 30.0, 50.0),    // Normal step
        create_test_step(3, 90.0, 30.0, 25.0),    // Normal step
    ];

    // Edge rate = 100
    assert!(is_mixing_step(&steps, 0, Some(100.0)));
    assert!(!is_mixing_step(&steps, 1, Some(100.0)));
}

#[test]
fn test_is_mixing_step_by_duration() {
    let steps = vec![
        create_test_step(1, 0.0, 30.0, 50.0),     // Short step
        create_test_step(2, 30.0, 120.0, 60.0),   // Very long step
        create_test_step(3, 150.0, 30.0, 40.0),   // Short step
    ];

    // Step 2 is much longer than neighbors
    assert!(is_mixing_step(&steps, 1, None));
    assert!(!is_mixing_step(&steps, 0, None));
}

#[test]
fn test_is_sst_pattern_valid() {
    // Alternating 100/500 pattern
    let steps = vec![
        create_test_step(1, 0.0, 60.0, 500.0),
        create_test_step(2, 60.0, 60.0, 100.0),
        create_test_step(3, 120.0, 60.0, 500.0),
        create_test_step(4, 180.0, 60.0, 100.0),
    ];

    assert!(is_sst_pattern(&steps));
}

#[test]
fn test_is_sst_pattern_invalid_single_rate() {
    // All same rate - not SST
    let steps = vec![
        create_test_step(1, 0.0, 60.0, 100.0),
        create_test_step(2, 60.0, 60.0, 100.0),
        create_test_step(3, 120.0, 60.0, 100.0),
    ];

    assert!(!is_sst_pattern(&steps));
}

#[test]
fn test_is_sst_pattern_invalid_ratio() {
    // Ratio less than 3x - not SST
    let steps = vec![
        create_test_step(1, 0.0, 60.0, 100.0),
        create_test_step(2, 60.0, 60.0, 150.0),
        create_test_step(3, 120.0, 60.0, 100.0),
    ];

    assert!(!is_sst_pattern(&steps));
}

#[test]
fn test_is_repeating_sequence_pattern() {
    // Pattern: 50 -> 75 -> 100 is monotonically increasing, so it should NOT be detected
    // as a repeating pattern (it's a ramp, not a repeating sequence)
    let monotonic_steps = vec![
        create_test_step(1, 0.0, 60.0, 50.0),
        create_test_step(2, 60.0, 60.0, 75.0),
        create_test_step(3, 120.0, 60.0, 100.0),
        create_test_step(4, 180.0, 60.0, 50.0),
        create_test_step(5, 240.0, 60.0, 75.0),
        create_test_step(6, 300.0, 60.0, 100.0),
    ];

    // Monotonic pattern should be rejected (each sub-sequence is just a ramp)
    let monotonic_result = is_repeating_sequence_pattern(&monotonic_steps);
    assert!(!monotonic_result, "Monotonic ramp pattern should NOT be detected as repeating sequence");

    // Note: Positive test case covered by test_swb_pattern_150_125_100_repeated
}

#[test]
fn test_create_cycle() {
    let steps = vec![
        create_test_step(1, 0.0, 30.0, 100.0),
        create_test_step(2, 30.0, 30.0, 40.0),
        create_test_step(3, 60.0, 30.0, 90.0),
    ];

    let cycle = create_cycle(steps.clone(), 1);

    assert_eq!(cycle.id, 1);
    assert_eq!(cycle.cycle_type, "Custom");
    assert_eq!(cycle.steps.len(), 3);
    assert!((cycle.duration - 90.0).abs() < 0.01);
}

#[test]
fn test_swb_pattern_150_125_100_repeated() {
    // SWB-like pattern from Mamontovskoe file: 100→150→125→100 repeated
    // This should be detected as repeating sequence
    let steps = vec![
        // Cycle 1
        create_test_step(1, 0.0, 30.0, 100.0),
        create_test_step(2, 30.0, 31.0, 150.0),
        create_test_step(3, 61.0, 31.0, 125.0),
        create_test_step(4, 92.0, 30.0, 100.0),
        // Cycle 2
        create_test_step(5, 122.0, 30.0, 100.0),
        create_test_step(6, 152.0, 31.0, 150.0),
        create_test_step(7, 183.0, 31.0, 125.0),
        create_test_step(8, 214.0, 30.0, 100.0),
        // Cycle 3
        create_test_step(9, 244.0, 30.0, 100.0),
        create_test_step(10, 274.0, 31.0, 150.0),
        create_test_step(11, 305.0, 31.0, 125.0),
        create_test_step(12, 336.0, 30.0, 100.0),
    ];

    // Should detect as repeating pattern
    let result = is_repeating_sequence_pattern(&steps);
    assert!(result, "SWB pattern should be detected as repeating sequence");

    // Should detect 3 cycles
    let cycles = detect_repeating_sequence_cycles_internal(&steps);
    assert!(cycles.is_some(), "Should detect cycles");
    let cycles = cycles.expect("Should detect cycles");
    assert!(cycles.len() >= 2, "Should detect at least 2 cycles, got {}", cycles.len());
}

#[test]
fn test_iso_pattern_150_125_100_descending() {
    // ISO-like pattern: 150→125→100 (descending ramp) repeated
    let steps = vec![
        // Cycle 1
        create_test_step(1, 0.0, 31.0, 150.0),
        create_test_step(2, 31.0, 31.0, 125.0),
        create_test_step(3, 62.0, 30.0, 100.0),
        // Cycle 2
        create_test_step(4, 92.0, 31.0, 150.0),
        create_test_step(5, 123.0, 31.0, 125.0),
        create_test_step(6, 154.0, 30.0, 100.0),
        // Cycle 3
        create_test_step(7, 184.0, 31.0, 150.0),
        create_test_step(8, 215.0, 31.0, 125.0),
        create_test_step(9, 246.0, 30.0, 100.0),
    ];

    // Should detect as repeating pattern (3 cycles of 3 steps each)
    let result = is_repeating_sequence_pattern(&steps);
    assert!(result, "ISO descending pattern should be detected as repeating sequence");

    let cycles = detect_repeating_sequence_cycles_internal(&steps);
    assert!(cycles.is_some(), "Should detect cycles");
    let cycles = cycles.expect("Should detect cycles");
    assert_eq!(cycles.len(), 3, "Should detect 3 cycles, got {}", cycles.len());
}

#[test]
fn test_real_swb_mamontovskoe_pattern() {
    // Real data from 8958 SWB Mamontovskoe file
    // Pattern from screenshot: 150→125→100 (3 steps per cycle)
    let steps = vec![
        // Cycle 1: steps 3,4,5 from screenshot
        create_test_step(1, 598.0, 31.0, 150.0),
        create_test_step(2, 629.0, 31.0, 125.0),
        create_test_step(3, 660.0, 30.0, 100.0),
        // Cycle 2
        create_test_step(4, 1310.0, 31.0, 150.0),
        create_test_step(5, 1341.0, 31.0, 125.0),
        create_test_step(6, 1372.0, 30.0, 100.0),
        // Cycle 3
        create_test_step(7, 2022.0, 31.0, 150.0),
        create_test_step(8, 2053.0, 31.0, 125.0),
        create_test_step(9, 2084.0, 30.0, 100.0),
        // Cycle 4
        create_test_step(10, 2734.0, 31.0, 150.0),
        create_test_step(11, 2765.0, 31.0, 125.0),
        create_test_step(12, 2796.0, 30.0, 100.0),
    ];

    println!("\n=== SWB Mamontovskoe Test ===");
    println!("Steps: {}", steps.len());

    for (i, s) in steps.iter().enumerate() {
        println!("Step {}: rate={:.0}, dur={:.0}s", i + 1, s.avg_shear_rate, s.duration);
    }

    let is_repeating = is_repeating_sequence_pattern(&steps);
    println!("Is repeating: {}", is_repeating);

    let cycles = detect_repeating_sequence_cycles_internal(&steps);
    println!("Detected cycles: {:?}", cycles.as_ref().map(|c| c.len()));

    if let Some(ref cycles) = cycles {
        for (i, c) in cycles.iter().enumerate() {
            let rates: Vec<String> = c.steps.iter().map(|s| format!("{:.0}", s.avg_shear_rate)).collect();
            println!("Cycle {}: {}", i + 1, rates.join("→"));
        }
    }

    assert!(is_repeating, "SWB Mamontovskoe pattern should be detected as repeating sequence");
    assert!(cycles.is_some(), "Should detect cycles");
    assert!(cycles.expect("Should detect cycles").len() >= 3, "Should detect at least 3 cycles");
}

// Reference: `detect_sst_cycles_internal` is currently only exercised via
// golden_tests.rs. Keeping the import here makes sure the public re-export
// stays reachable even if future refactors shuffle visibility.
#[allow(dead_code)]
fn _sst_reexport_is_reachable(steps: &[RheoStep]) {
    let _ = detect_sst_cycles_internal(steps);
}
