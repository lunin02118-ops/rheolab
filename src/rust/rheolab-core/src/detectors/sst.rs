//! SST (Stress-Sweep Test) detection — identifies two-level alternating rate
//! patterns that characterise thixotropic-behaviour tests.

use crate::types::{RheoStep, RheoCycle};

/// Internal structure for SST phase grouping.
///
/// Groups consecutive steps that are either all "high rate" or all "low rate"
/// into phases for cycle pairing.
struct SSTPhase {
    /// True if this phase is at the high rate level
    is_high: bool,
    /// Steps belonging to this phase
    steps: Vec<RheoStep>,
    /// Total duration of all steps in the phase
    duration: f64,
}

/// Checks if the step data represents a Stress-Sweep Test (SST) pattern.
///
/// SST tests alternate between two distinct shear rate levels to measure
/// thixotropic (time-dependent) behavior. This function identifies the
/// characteristic 2-level alternating pattern.
///
/// # Arguments
/// * `steps` - All detected steps
///
/// # Returns
/// `true` if the pattern matches SST criteria
///
/// # Detection Criteria
/// 1. At least 3 steps
/// 2. Exactly 2 distinct rate levels (rounded to nearest 50 s⁻¹)
/// 3. High rate ≥ 3× low rate AND high rate ≥ 200 s⁻¹
/// 4. At least 3 phase transitions (High→Low→High or Low→High→Low)
///
/// # Example SST Patterns
/// ```text
/// Valid:   500→100→500→100 (ratio 5:1, high=500 ≥ 200)
/// Invalid: 150→100→150→100 (ratio 1.5:1, < 3x)
/// Invalid: 100→50→100→50   (high=100 < 200)
/// ```
pub fn is_sst_pattern(steps: &[RheoStep]) -> bool {
    if steps.len() < 3 { return false; }

    // Filter out short ramp steps for detection
    let significant_steps: Vec<&RheoStep> = steps.iter().filter(|s| s.duration > 20.0).collect();
    if significant_steps.len() < 2 { return false; }

    let rates: Vec<f64> = significant_steps.iter().map(|s| s.avg_shear_rate).collect();

    // Find unique rates (rounded to nearest 50)
    let mut unique_rates: Vec<i32> = rates.iter()
        .map(|r| (r / 50.0).round() as i32 * 50)
        .collect();
    unique_rates.sort();
    unique_rates.dedup();

    // SST typically has exactly 2 distinct rate levels
    if unique_rates.len() != 2 { return false; }

    let low_rate = unique_rates[0] as f64;
    let high_rate = unique_rates[1] as f64;

    // SST requires: highRate >= low * 3 AND highRate >= 200
    let is_valid_sst_ratio = high_rate >= low_rate * 3.0 && high_rate >= 200.0;
    if !is_valid_sst_ratio { return false; }

    // Count phase transitions (High <-> Low)
    let midpoint = (low_rate + high_rate) / 2.0;
    let mut phase_count = 1;
    let mut prev_is_high = rates[0] >= midpoint;

    for rate in rates.iter().skip(1) {
        let curr_is_high = *rate >= midpoint;
        if curr_is_high != prev_is_high {
            phase_count += 1;
            prev_is_high = curr_is_high;
        }
    }

    // SST needs at least 3 phases (2 transitions): H->L->H or L->H->L
    phase_count >= 3
}

/// Detects and groups SST cycles from step data.
///
/// Groups alternating high/low phases into cycle pairs. Each cycle contains
/// one high-rate phase and one low-rate phase.
///
/// # Arguments
/// * `steps` - Native Rust slice of [`RheoStep`]
///
/// # Returns
/// Vector of [`RheoCycle`] objects with type "SST"
///
/// # Algorithm
/// 1. Find high and low rate levels
/// 2. Group consecutive steps into phases (high or low)
/// 3. Pair adjacent phases into cycles (High+Low or Low+High)
/// 4. Handle odd final phase as incomplete cycle
///
/// # Note
/// Short transition steps (< 20s) are filtered out during cycle creation
/// but retained if they are the only step in a phase.
///
/// Internal SST cycle detection — works with native Rust types (no JsValue).
/// Called directly from Tauri commands and from the WASM binding in `lib.rs`.
pub fn detect_sst_cycles_internal(steps: &[RheoStep]) -> Vec<RheoCycle> {
    if steps.is_empty() { return Vec::new(); }

    // Find unique rates
    let mut unique_rates: Vec<i32> = steps.iter()
        .map(|s| (s.avg_shear_rate / 50.0).round() as i32 * 50)
        .collect();
    unique_rates.sort();
    unique_rates.dedup();

    if unique_rates.len() < 2 {
        // Return single cycle for single-rate data
        let duration: f64 = steps.iter().map(|s| s.duration).sum();
        let cycle = RheoCycle {
            id: 1,
            cycle_index: Some(1),
            cycle_type: "SST".to_string(),
            steps: steps.to_vec(),
            description: "SST Cycle (Single Rate)".to_string(),
            duration,
        };
        return vec![cycle];
    }

    let low_rate = unique_rates[0] as f64;
    let high_rate = unique_rates[unique_rates.len() - 1] as f64;
    let midpoint = (low_rate + high_rate) / 2.0;

    // Group consecutive steps into PHASES
    let mut phases: Vec<SSTPhase> = Vec::new();
    let mut current_phase: Option<SSTPhase> = None;

    for step in steps {
        let step_is_high = step.avg_shear_rate >= midpoint;
        if let Some(ref mut phase) = current_phase {
            if phase.is_high == step_is_high {
                phase.steps.push(step.clone());
                phase.duration += step.duration;
                continue;
            }
        }
        if let Some(closed_phase) = current_phase.take() {
            phases.push(closed_phase);
        }
        current_phase = Some(SSTPhase {
            is_high: step_is_high,
            steps: vec![step.clone()],
            duration: step.duration,
        });
    }
    if let Some(phase) = current_phase {
        phases.push(phase);
    }

    // Pair phases into cycles
    let mut cycles: Vec<RheoCycle> = Vec::new();
    let mut cycle_index = 1;
    let mut i = 0;
    while i < phases.len().saturating_sub(1) {
        let phase1 = &phases[i];
        let phase2 = &phases[i + 1];
        let mut cycle_steps: Vec<RheoStep> = phase1.steps.iter().chain(phase2.steps.iter()).cloned().collect();
        cycle_steps.retain(|s| {
            if s.duration > 20.0 { return true; }
            if phase1.steps.len() == 1 && phase1.steps[0].id == s.id { return true; }
            if phase2.steps.len() == 1 && phase2.steps[0].id == s.id { return true; }
            false
        });
        let duration: f64 = cycle_steps.iter().map(|s| s.duration).sum();
        cycles.push(RheoCycle {
            id: cycle_index,
            cycle_index: Some(cycle_index),
            cycle_type: "SST".to_string(),
            steps: cycle_steps,
            description: format!("SST Cycle {}", cycle_index),
            duration,
        });
        cycle_index += 1;
        i += 2;
    }
    // Handle odd last phase
    if phases.len() % 2 == 1 {
        let last_phase = &phases[phases.len() - 1];
        if last_phase.steps.len() >= 2 {
            cycles.push(RheoCycle {
                id: cycle_index,
                cycle_index: Some(cycle_index),
                cycle_type: "SST".to_string(),
                steps: last_phase.steps.clone(),
                description: format!("SST Cycle {} (Incomplete)", cycle_index),
                duration: last_phase.duration,
            });
        }
    }
    cycles
}
