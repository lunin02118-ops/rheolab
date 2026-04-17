//! # Cycle Detection Algorithms
//!
//! This module provides algorithms for detecting and classifying rheological
//! test cycles from step data. It identifies the pattern of measurements
//! to determine the test type (API, ISO, SST, Custom).
//!
//! ## Detection Strategies
//!
//! ### 1. Anchor-Based Detection (Primary)
//! Uses "mixing" steps as anchors to split data into cycles. Mixing steps
//! are identified by:
//! - Duration significantly longer than neighbors
//! - Shear rate matching a detected "edge rate" pattern
//! - Position at the end with long duration
//!
//! ### 2. SST Detection
//! Detects Stress-Sweep Tests by looking for alternating high/low rate patterns
//! where the ratio is ≥ 3x and high rate ≥ 200 s⁻¹.
//!
//! ### 3. Repeating Sequence Detection
//! Detects custom patterns that repeat (e.g., 100→150→125→100 repeated).
//! Used for SWB and similar multi-rate protocols.
//!
//! ## Cycle Type Classification
//!
//! | Type | Pattern | Example Rates |
//! |------|---------|---------------|
//! | API RP 39 | Symmetric ramp | 100→75→50→25→50→75→100 |
//! | ISO 13503-1 | Monotonic ramp | 100→75→50→25 or 25→50→75→100 |
//! | SST | High/Low alternating | 500→100→500→100 |
//! | Custom | Any other pattern | Varies |
//!
//! ## Constants
//!
//! - `SHEAR_RATE_MIXING_MIN`: 50 s⁻¹ - below this is definitely not mixing
//! - `DURATION_MIXING_MIN`: 25 s - minimum duration for a step to be mixing
//! - `DURATION_LONG_STEP_RATIO`: 1.5 - how much longer than neighbors
//! - `DURATION_END_STEP_MIN`: 120 s - long final steps are mixing
//! - `SHEAR_RATE_HIGH`: 400 s⁻¹ - above this is not mixing (SST high-rate)
//!
//! ## C# Port Considerations
//!
//! 1. Constants can be `const double` or configurable parameters
//! 2. Use `List<T>` instead of `Vec<T>`
//! 3. `HashSet<T>` for unique rate detection
//! 4. Consider extracting classification logic into a separate service

use crate::types::{RheoStep, RheoCycle};

// ============================================================================
// CONSTANTS - Detection Thresholds
// ============================================================================

/// Minimum shear rate for a mixing step candidate (s⁻¹).
/// Steps with rates below this are measurement steps, not mixing.
const SHEAR_RATE_MIXING_MIN: f64 = 50.0;

/// Minimum duration for a step to be considered mixing (seconds).
/// Short steps are typically measurement or transition steps.
const DURATION_MIXING_MIN: f64 = 25.0;

/// Ratio threshold for duration-based mixing detection.
/// A step is mixing if its duration is > 1.5× the average of its neighbors.
const DURATION_LONG_STEP_RATIO: f64 = 1.5;

/// Minimum duration for a final step to be considered mixing (seconds).
/// Long final steps are typically post-test conditioning.
const DURATION_END_STEP_MIN: f64 = 120.0;

/// Maximum shear rate for mixing step detection (s⁻¹).
/// Very high rates (like SST high-rate phases) are not mixing steps.
const SHEAR_RATE_HIGH: f64 = 400.0;

// ============================================================================
// MIXING STEP DETECTION
// ============================================================================

/// Determines if a step at the given index is a "mixing" (conditioning) step.
///
/// Mixing steps are used to homogenize the sample or reach equilibrium and
/// should typically be excluded from model calculations. They are identified
/// by one of three methods:
///
/// 1. **Edge Rate Matching**: Step rate matches a previously detected edge rate
/// 2. **Duration-Based**: Step is significantly longer than its neighbors
/// 3. **End Step**: Final step with long duration (post-test conditioning)
///
/// # Arguments
/// * `steps` - All steps in the sequence
/// * `index` - Index of the step to check
/// * `edge_rate` - Optional pre-detected edge rate for matching
///
/// # Returns
/// `true` if the step is identified as a mixing step
///
/// # Algorithm
/// ```text
/// 1. Reject if index invalid or duration < 25s or rate > 400 s⁻¹
/// 2. Accept if rate matches edge_rate (±10 s⁻¹)
/// 3. Accept if duration > 1.5× average neighbor duration
/// 4. Accept if last step and duration ≥ 120s
/// ```
pub fn is_mixing_step(steps: &[RheoStep], index: usize, edge_rate: Option<f64>) -> bool {
    if index >= steps.len() {
        return false;
    }

    let step = &steps[index];

    // Filter: too short or too high rate
    if step.duration < DURATION_MIXING_MIN {
        return false;
    }
    if step.avg_shear_rate > SHEAR_RATE_HIGH {
        return false;
    }

    // Method 1: Rate matches detected edge rate
    if let Some(rate) = edge_rate {
        let rounded_rate = (step.avg_shear_rate / 5.0).round() * 5.0;
        if (rounded_rate - rate).abs() < 10.0 {
            return true;
        }
    }

    // Method 2: Duration-based (much longer than neighbors)
    if index > 0 && index < steps.len() - 1 {
        let prev_dur = steps[index - 1].duration;
        let next_dur = steps[index + 1].duration;
        let avg_neighbor_dur = (prev_dur + next_dur) / 2.0;
        if step.duration > avg_neighbor_dur * DURATION_LONG_STEP_RATIO {
            return true;
        }
    }

    // Method 3: End step with long duration
    if index == steps.len() - 1 {
        return step.duration >= DURATION_END_STEP_MIN;
    }

    false
}

// ============================================================================
// ANCHOR-BASED CYCLE DETECTION
// ============================================================================

/// Detects rheological cycles using anchor-based strategy (internal Rust version).
///
/// This is the primary cycle detection algorithm. It identifies "mixing" steps
/// as anchors and splits the data into cycles at these anchor points.
///
/// # Arguments
/// * `steps` - All detected steps from the schedule detector
///
/// # Returns
/// Vector of `RheoCycle` objects, each containing its constituent steps
/// and classification (API, ISO, Custom).
///
/// # Algorithm
///
/// 1. **Determine Edge Rate**: Analyze first few steps to find a repeating rate
///    that indicates mixing steps.
///
/// 2. **Iterate Through Steps**: For each step, determine if it's a mixing step.
///
/// 3. **Cycle Splitting**: When a mixing step is found and current cycle has
///    enough body content, finalize the cycle and start a new one.
///
/// 4. **Time Gap Detection**: Large gaps between steps (> 5× typical duration)
///    also trigger cycle boundaries.
///
/// 5. **Symmetric Merging**: Adjacent cycles that form ramp-down + ramp-up
///    patterns are merged into single API-style cycles.
///
/// # Edge Rate Detection
/// ```text
/// - Look at first 4 steps
/// - If first rate appears ≥ 2 times OR first step duration > 45s
/// - Use that rate as the "edge rate" for mixing detection
/// ```
///
/// # Cycle Requirements
/// - Minimum 3 steps per cycle
/// - Must have at least one "body" step (non-mixing)
///
/// # Example
/// ```text
/// Input:  [100, 100, 75, 50, 25, 100]  (rates)
/// Result: Cycle 1 with steps [100, 75, 50, 25, 100] classified as API
/// ```
pub fn detect_anchor_cycles_internal(steps: &[RheoStep]) -> Vec<RheoCycle> {
    if steps.is_empty() {
        return Vec::new();
    }

    // Determine edge rate (simplified logic)
    let mut edge_rate: Option<f64> = None;
    if steps.len() >= 3 {
        let first_rate = (steps[0].avg_shear_rate / 5.0).round() * 5.0;
        // Check if first few steps have similar rate
        let mut repeat_count = 1;
        for step in steps.iter().take(4).skip(1) {
            let rate = (step.avg_shear_rate / 5.0).round() * 5.0;
            if (rate - first_rate).abs() < 10.0 {
                repeat_count += 1;
            } else {
                break;
            }
        }
        if repeat_count >= 2 || steps[0].duration > 45.0 {
            edge_rate = Some(first_rate);
        }
    }

    let mut cycles: Vec<RheoCycle> = Vec::new();
    let mut current_cycle_steps: Vec<RheoStep> = Vec::new();
    let mut cycle_id_counter = 1;

    for i in 0..steps.len() {
        let step = steps[i].clone();
        let is_mixing = is_mixing_step(steps, i, edge_rate);

        // Check for large time gap (indicates cycle boundary)
        if !current_cycle_steps.is_empty() {
            let prev_step = &current_cycle_steps[current_cycle_steps.len() - 1];
            let time_gap = step.start_time - prev_step.end_time;
            let typical_duration = step.duration.max(prev_step.duration).max(30.0);

            if time_gap > typical_duration * 5.0 {
                 if current_cycle_steps.len() >= 3 {
                    cycles.push(create_cycle(std::mem::take(&mut current_cycle_steps), cycle_id_counter));
                    cycle_id_counter += 1;
                 } else {
                    current_cycle_steps.clear();
                 }
                 current_cycle_steps.push(step);
                 continue;
            }
        }

        if is_mixing {
             // Check if current cycle has body content (non-mixing steps)
             let has_body = current_cycle_steps.iter().any(|s| 
                s.avg_shear_rate < SHEAR_RATE_MIXING_MIN || s.duration < DURATION_MIXING_MIN
             );

             if current_cycle_steps.len() >= 3 && has_body {
                 cycles.push(create_cycle(std::mem::take(&mut current_cycle_steps), cycle_id_counter));
                 cycle_id_counter += 1;
             }
             current_cycle_steps.push(step);
        } else {
            current_cycle_steps.push(step);
        }
    }

    // Finalize last cycle
    if current_cycle_steps.len() >= 3 {
        cycles.push(create_cycle(current_cycle_steps, cycle_id_counter));
    }

    // Try to merge symmetric cycles (e.g. split API pattern)
    merge_symmetric_cycles(cycles)
}

// ============================================================================
// SST (STRESS-SWEEP TEST) DETECTION
// ============================================================================

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
/// * `steps_js` - JavaScript array of RheoStep objects
///
/// # Returns
/// * `Ok(JsValue)` - Array of RheoCycle objects with type "SST"
/// * `Err(JsValue)` - Error message
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
/// Internal SST cycle detection — works with native Rust types (no JsValue).
/// Called directly from Tauri commands and from the WASM binding below.
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

fn create_cycle(steps: Vec<RheoStep>, id: i32) -> RheoCycle {
    let duration: f64 = steps.iter().map(|s| s.duration).sum();
    
    // Classify cycle type based on pattern (matching TypeScript logic)
    let rates: Vec<i32> = steps.iter()
        .map(|s| (s.avg_shear_rate / 5.0).round() as i32 * 5)
        .collect();
    
    let (cycle_type, description) = classify_cycle_type(&rates, id);
    
    RheoCycle {
        id,
        cycle_index: Some(id),
        cycle_type,
        steps,
        description,
        duration,
    }
}

/// Classify cycle type based on rates pattern (API/ISO/Custom)
fn classify_cycle_type(rates: &[i32], id: i32) -> (String, String) {
    if rates.len() < 2 {
        return ("Custom".to_string(), format!("Cycle {}", id));
    }
    
    // Helper: check if rates contain a value (with tolerance)
    let has_rate = |target: i32, tol: i32| -> bool {
        rates.iter().any(|&r| (r - target).abs() <= tol)
    };
    
    // Get max rate for mixing step detection
    let max_rate = *rates.iter().max().unwrap_or(&0);
    let mixing_tol = 5;
    let is_mixing_rate = |r: i32| (r - max_rate).abs() < mixing_tol;
    
    // Find body (excluding mixing at start/end)
    let mut body_start = 0;
    while body_start < rates.len() && is_mixing_rate(rates[body_start]) {
        body_start += 1;
    }
    let mut body_end = rates.len().saturating_sub(1);
    while body_end > body_start && is_mixing_rate(rates[body_end]) {
        body_end = body_end.saturating_sub(1);
    }
    
    let body_rates: Vec<i32> = if body_start <= body_end {
        rates[body_start..=body_end].to_vec()
    } else {
        rates.to_vec()
    };
    
    // Check symmetry (first half mirrors second half) - use body rates without mixing
    let is_symmetric = is_symmetric_pattern(&body_rates);
    
    // Check monotonicity
    let rates_to_check = if body_rates.len() >= 3 { &body_rates } else { rates };
    let is_monotonic = is_monotonic_pattern(rates_to_check);
    
    // API RP 39 pattern check
    let has_api_rates = has_rate(75, 5) && has_rate(50, 5) && has_rate(25, 5);
    let has_low_rates = has_rate(10, 3) || has_rate(5, 3) || has_rate(3, 2);
    let is_api_pattern = is_symmetric && has_api_rates && !has_low_rates;
    
    // ISO 13503-1 pattern check
    let unique_rates: std::collections::HashSet<i32> = rates_to_check.iter()
        .map(|&r| (r / 10) * 10)
        .collect();
    let has_enough_levels = unique_rates.len() >= 3;
    let has_anomalous_rates = rates_to_check.iter().any(|&r| r > 200 && r < 400);
    let is_iso_pattern = is_monotonic && rates.len() >= 3 && has_enough_levels && !has_anomalous_rates;
    
    // Classify
    if is_api_pattern {
        ("API".to_string(), "API RP 39 Cycle".to_string())
    } else if is_iso_pattern {
        let direction = if rates_to_check.first() > rates_to_check.last() { "Ramp ↓" } else { "Ramp ↑" };
        ("ISO".to_string(), format!("ISO 13503-1 Cycle ({})", direction))
    } else {
        ("Custom".to_string(), format!("Cycle {}", id))
    }
}

/// Check if pattern is symmetric (e.g., [75, 50, 25, 50, 75])
fn is_symmetric_pattern(rates: &[i32]) -> bool {
    if rates.len() < 3 {
        return false;
    }
    
    // Check if rates form a symmetric pattern around the middle
    let mid = rates.len() / 2;
    let tolerance = 5;
    
    for i in 0..mid {
        let left = rates[i];
        let right = rates[rates.len() - 1 - i];
        if (left - right).abs() > tolerance {
            return false;
        }
    }
    
    true
}

// --- Cycle Merging Logic ---

    /// Merges adjacent cycles that form a symmetric pattern (e.g. Ramp Down + Ramp Up)
    fn merge_symmetric_cycles(cycles: Vec<RheoCycle>) -> Vec<RheoCycle> {
        if cycles.len() < 2 {
            return cycles;
        }
        
        let mut result = Vec::new();
        let mut i = 0;
        
        while i < cycles.len() {
            // Check if we have a next cycle to merge with
            if i + 1 >= cycles.len() {
                result.push(cycles[i].clone());
                break;
            }
            
            let current = &cycles[i];
            let next = &cycles[i + 1];
            
            let curr_rates: Vec<f64> = current.steps.iter().map(|s| s.avg_shear_rate).collect();
            let next_rates: Vec<f64> = next.steps.iter().map(|s| s.avg_shear_rate).collect();
            
            if curr_rates.is_empty() || next_rates.is_empty() {
                result.push(current.clone());
                i += 1;
                continue;
            }
            
            // Guarded: curr_rates / next_rates are non-empty (checked above).
            let is_ramp_down = curr_rates.first().expect("non-empty: guarded") > curr_rates.last().expect("non-empty: guarded");
            // Ramp Up: first < last
            let is_ramp_up = next_rates.first().expect("non-empty: guarded") < next_rates.last().expect("non-empty: guarded");
            
            if is_ramp_down && is_ramp_up {
                let end_rate = *curr_rates.last().expect("non-empty: guarded");
                let start_rate = *next_rates.first().expect("non-empty: guarded");
                
                // Check continuity: end of first should be close to start of second
                // OR second starts where first ended (with small gap)
                // In BSL case: end=25, start=10. This is NOT continuous by equal value, but is continuous in sequence.
                // TS Logic: Math.abs(endRate - startRate) < 10 || (endRate > startRate && nextRates[1] > startRate)
                
                let is_continuous = (end_rate - start_rate).abs() < 10.0 || 
                                   (end_rate > start_rate && next_rates.len() > 1 && next_rates[1] > start_rate);
                                   
                if is_continuous {
                    // Merge steps
                    let mut merged_steps = current.steps.clone();
                    merged_steps.extend(next.steps.clone());
                    
                    // Re-classify the merged cycle
                    let id = current.id;
                    let merged_cycle = create_cycle(merged_steps, id);
                    
                    // Note: We do NOT force API type here anymore.
                    // The classifier will determine if it's API (std pattern) or Custom (e.g. BSL with low rates).
                    // But we DO merge them into a single cycle structure.
                    
                    result.push(merged_cycle);
                    i += 2;
                    continue;
                }
            }
            
            result.push(current.clone());
            i += 1;
        }
        
        result
    }

    // --- Checker Functions ---

    /// Check if pattern is monotonic (strictly increasing or decreasing)
    fn is_monotonic_pattern(rates: &[i32]) -> bool {
    if rates.len() < 2 {
        return false;
    }
    
    let is_increasing = rates.windows(2).all(|w| w[1] >= w[0] - 5);
    let is_decreasing = rates.windows(2).all(|w| w[1] <= w[0] + 5);
    
    is_increasing || is_decreasing
}

// --- Repeating Sequence Detector ---

/// Checks if this looks like a repeating sequence pattern (3+ distinct rates)
pub fn is_repeating_sequence_pattern(steps: &[RheoStep]) -> bool {
    if steps.len() < 6 { return false; }

    let rates: Vec<i32> = steps.iter().map(|s| (s.avg_shear_rate / 10.0).round() as i32 * 10).collect();
    let mut unique_rates = rates.clone();
    unique_rates.sort();
    unique_rates.dedup();

    // Must have 3-4 distinct rate levels
    if unique_rates.len() < 3 || unique_rates.len() > 5 { return false; }

    // Guarded: unique_rates.len() >= 3 checked above.
    let min_rate = *unique_rates.first().expect("non-empty: len >= 3 checked above") as f64;
    let max_rate = *unique_rates.last().expect("non-empty: len >= 3 checked above") as f64;

    // Max rate should be < 3x min rate (otherwise would be SST)
    if max_rate >= min_rate * 3.0 { return false; }

    // SPECIAL CHECK for November-like patterns
    let has_low_rate = unique_rates.iter().any(|&r| (30..=50).contains(&r));
    let has_high_rate = unique_rates.iter().any(|&r| (90..=110).contains(&r));
    let has_mid_rates = unique_rates.iter().any(|&r| (55..=85).contains(&r));

    if has_low_rate && has_high_rate && has_mid_rates && unique_rates.len() >= 4 {
        return false;
    }

    // Count direction changes
    let mut direction_changes = 0;
    for i in 2..rates.len() {
        let prev_dir = rates[i - 1] - rates[i - 2];
        let curr_dir = rates[i] - rates[i - 1];
        if (prev_dir > 5 && curr_dir < -5) || (prev_dir < -5 && curr_dir > 5) {
            direction_changes += 1;
        }
    }

    // If pattern has <= 2 direction changes, check if it's a symmetric/monotonic ramp
    // (not a valid repeating pattern) - skip this check, let actual pattern detection decide
    if direction_changes <= 2 {
        let step_rates: Vec<f64> = steps.iter().map(|s| s.avg_shear_rate).collect();
        let high_rate_threshold = max_rate * 0.85;
        let low_rate_threshold = min_rate * 1.15;

        let has_high_start = step_rates.iter().take(3).any(|r| *r >= high_rate_threshold);
        let has_high_end = step_rates.iter().rev().take(3).any(|r| *r >= high_rate_threshold);
        
        let mid_start = steps.len() / 3;
        let mid_end = steps.len() * 2 / 3;
        let has_low_middle = step_rates[mid_start..=mid_end.min(step_rates.len()-1)]
            .iter().any(|r| *r <= low_rate_threshold);

        // Symmetric ramp pattern - not a repeating sequence
        if has_high_start && has_low_middle && has_high_end {
            return false;
        }

        // Check for pure monotonic ramp (no repetition possible)
        let mut is_monotonic_down = true;
        let mut is_monotonic_up = true;
        for i in 1..step_rates.len() {
            if step_rates[i] > step_rates[i - 1] + 10.0 { is_monotonic_down = false; }
            if step_rates[i] < step_rates[i - 1] - 10.0 { is_monotonic_up = false; }
        }

        if is_monotonic_down || is_monotonic_up {
            return false;
        }
    }

    // Check if pattern repeats
    let cycles = detect_repeating_sequence_cycles_internal(steps);
    cycles.is_some_and(|c| c.len() >= 2)
}

pub fn detect_repeating_sequence_cycles_internal(steps: &[RheoStep]) -> Option<Vec<RheoCycle>> {
    if steps.len() < 6 { return None; }

    // Round rates for pattern matching (same as TS: Math.round(rate / 5) * 5)
    let rates: Vec<i32> = steps.iter().map(|s| ((s.avg_shear_rate / 5.0).round() as i32) * 5).collect();

    // Try pattern lengths from 3 to 6 steps
    for pattern_len in 3..=6 {
        let mut best_phase_result: Option<(Vec<RheoCycle>, f64)> = None;

        for offset in 0..pattern_len {
            if offset + pattern_len > rates.len() { continue; }

            let pattern: Vec<i32> = rates[offset..offset + pattern_len].to_vec();

            // Count how many times this pattern repeats
            let mut repeat_count = 0;
            let mut i = offset;
            let mut cycle_indices: Vec<usize> = Vec::new();

            while i + pattern_len <= rates.len() {
                let mut matches = true;
                for j in 0..pattern_len {
                    let rate = rates[i + j];
                    let target = pattern[j];
                    // Allow 15% tolerance on rate matching
                    let tolerance = ((target as f64) * 0.15).max(5.0) as i32;
                    if (rate - target).abs() > tolerance {
                        matches = false;
                        break;
                    }
                }
                if matches {
                    repeat_count += 1;
                    cycle_indices.push(i);
                    i += pattern_len;
                } else {
                    i += 1;
                }
            }

            // If pattern repeats at least 2 times, evaluate it
            if repeat_count >= 2 {
                // Calculate baseline (mode - most frequent rate)
                let mut rate_counts: std::collections::HashMap<i32, i32> = std::collections::HashMap::new();
                for r in &pattern {
                    *rate_counts.entry(*r).or_insert(0) += 1;
                }
                let mut baseline_rate = pattern[0];
                let mut max_count = 0;
                for (&rate, &count) in &rate_counts {
                    if count > max_count {
                        max_count = count;
                        baseline_rate = rate;
                    } else if count == max_count && rate < baseline_rate {
                        baseline_rate = rate;
                    }
                }

                // Score based on distance of first step from baseline
                let first_step_deviation = (pattern[0] - baseline_rate).abs();

                let mut score = (repeat_count * 1000) as f64;
                score += (first_step_deviation * 10) as f64;

                // Penalty for skipped steps (coverage)
                let covered_steps = repeat_count * pattern_len;
                let last_idx = cycle_indices[cycle_indices.len() - 1];
                let total_steps_in_range = (last_idx + pattern_len) - cycle_indices[0];
                let coverage_ratio = covered_steps as f64 / total_steps_in_range as f64;
                score *= coverage_ratio;

                let is_better = match &best_phase_result {
                    Some((_, s)) => score > *s,
                    None => true,
                };

                if is_better {
                    let cycles: Vec<RheoCycle> = cycle_indices.iter().enumerate().map(|(idx, &start_idx)| {
                        let cycle_steps = steps[start_idx..start_idx + pattern_len].to_vec();
                        let duration: f64 = cycle_steps.iter().map(|s| s.duration).sum();
                        let pattern_str: Vec<String> = pattern.iter().map(|r| r.to_string()).collect();
                        RheoCycle {
                            id: (idx + 1) as i32,
                            cycle_index: Some((idx + 1) as i32),
                            cycle_type: "Custom".to_string(),
                            steps: cycle_steps,
                            description: format!("Custom Cycle {} ({})", idx + 1, pattern_str.join("→")),
                            duration,
                        }
                    }).collect();
                    best_phase_result = Some((cycles, score));
                }
            }
        }

        if let Some((cycles, _)) = best_phase_result {
            return Some(cycles);
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let cycles = cycles.unwrap();
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
        let cycles = cycles.unwrap();
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
        
        // Print step rates
        for (i, s) in steps.iter().enumerate() {
            println!("Step {}: rate={:.0}, dur={:.0}s", i+1, s.avg_shear_rate, s.duration);
        }
        
        // Test: should detect as repeating pattern
        let is_repeating = is_repeating_sequence_pattern(&steps);
        println!("Is repeating: {}", is_repeating);
        
        // Test: should detect cycles
        let cycles = detect_repeating_sequence_cycles_internal(&steps);
        println!("Detected cycles: {:?}", cycles.as_ref().map(|c| c.len()));
        
        if let Some(ref cycles) = cycles {
            for (i, c) in cycles.iter().enumerate() {
                let rates: Vec<String> = c.steps.iter().map(|s| format!("{:.0}", s.avg_shear_rate)).collect();
                println!("Cycle {}: {}", i+1, rates.join("→"));
            }
        }
        
        assert!(is_repeating, "SWB Mamontovskoe pattern should be detected as repeating sequence");
        assert!(cycles.is_some(), "Should detect cycles");
        assert!(cycles.unwrap().len() >= 3, "Should detect at least 3 cycles");
    }
}

