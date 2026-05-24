//! # Cycle Processor - Step Extraction for Model Fitting
//!
//! This module processes detected rheological cycles to extract the steps
//! that should be used for model fitting (Bingham, Power Law calculations).
//!
//! ## Purpose
//!
//! Rheological test cycles often include "mixing" or "conditioning" steps
//! at their boundaries. These steps are used to homogenize the sample or
//! reach equilibrium but should NOT be included in model parameter calculations.
//!
//! ## Cycle Types and Processing Logic
//!
//! ### SST (Stress-Sweep Test)
//! - Returns all steps unchanged
//! - SST cycles are designed specifically for analysis at each rate
//!
//! ### API RP 39
//! - Symmetric pattern: mixing → ramp down → ramp up → mixing
//! - Filters out mixing steps at start and end (at max shear rate)
//! - Example: [100, 75, 50, 25, 50, 75, 100] → [75, 50, 25, 50, 75]
//!
//! ### ISO 13503-1 / Custom
//! - Monotonic ramp: mixing → body → mixing
//! - Extracts the ramp body, keeping one boundary step for curve fitting
//! - Ramp down: includes one mixing step at start
//! - Ramp up: includes one mixing step at end
//!
//! ## Algorithm Parameters
//!
//! - `mixing_rate_tolerance`: 10 s⁻¹ tolerance for max rate matching
//! - Minimum 3 steps required for a valid extraction
//!
//! ## C# Port Considerations
//!
//! 1. Use LINQ for filtering and slicing: `.Skip()`, `.Take()`, `.ToList()`
//! 2. Handle empty collections gracefully (early returns)
//! 3. Clone steps when returning to avoid reference issues

use crate::types::{RheoCycle, RheoStep};

/// Processes a rheological cycle to extract steps suitable for model calculation.
///
/// This function removes mixing/conditioning steps from the cycle boundaries
/// based on the cycle type and returns only the steps that should be used
/// for fitting rheological models.
///
/// # Arguments
/// * `cycle` - Reference to a `RheoCycle` containing detected steps
///
/// # Returns
/// Vector of `RheoStep` objects to use for model fitting.
///
/// # Algorithm by Cycle Type
///
/// ## SST (Stress-Sweep Test)
/// Returns all steps unchanged - SST is specifically designed for
/// steady-state analysis at each shear rate.
///
/// ## API RP 39
/// API cycles have symmetric patterns with mixing at boundaries:
/// 1. Find maximum shear rate (mixing rate)
/// 2. Skip steps at start that match mixing rate
/// 3. Skip steps at end that match mixing rate
/// 4. Return body steps (minimum 3 required)
///
/// ```text
/// Input:  [100*, 75, 50, 25, 50, 75, 100*]  (* = mixing)
/// Output: [75, 50, 25, 50, 75]
/// ```
///
/// ## ISO / Custom
/// Monotonic ramps with conditioning at boundaries:
/// 1. Find maximum shear rate (mixing rate)
/// 2. Count mixing steps at start and end
/// 3. For ramp-down (high→low): include one leading mixing step
/// 4. For ramp-up (low→high): include one trailing mixing step
/// 5. Return body steps (minimum 2 required in body)
///
/// ```text
/// Ramp Down: [100*, 75, 50, 25] → [100, 75, 50, 25]
/// Ramp Up:   [25, 50, 75, 100*] → [25, 50, 75, 100]
/// ```
///
/// # Edge Cases
/// - Empty cycle: returns empty vector
/// - Less than 3 steps after filtering: returns original steps
/// - Unknown cycle type: returns original steps
///
/// # Example
/// ```rust,ignore
/// // Conceptual example (not runnable - requires full setup)
/// let cycle = RheoCycle {
///     cycle_type: "API".to_string(),
///     steps: vec![mixing_step, /* data steps */, mixing_step],
///     // ... other fields
/// };
/// let calc_steps = process_cycle_for_calculation(&cycle);
/// // calc_steps contains only the data steps for regression
/// ```
pub fn process_cycle_for_calculation(cycle: &RheoCycle) -> Vec<RheoStep> {
    if cycle.steps.is_empty() {
        return Vec::new();
    }

    // SST cycles use all steps for analysis
    if cycle.cycle_type == "SST" {
        return cycle.steps.clone();
    }

    // Find maximum shear rate (typically the mixing rate)
    let max_rate = cycle
        .steps
        .iter()
        .map(|s| s.avg_shear_rate)
        .fold(0.0, f64::max);

    // Tolerance for matching mixing rate (10 s⁻¹)
    let mixing_rate_tolerance = 10.0;
    let is_mixing_rate = |rate: f64| (rate - max_rate).abs() < mixing_rate_tolerance;

    // API RP 39: Filter mixing steps at both ends
    if cycle.cycle_type == "API" {
        // Find first non-mixing step
        let mut start_idx = 0;
        while start_idx < cycle.steps.len() && is_mixing_rate(cycle.steps[start_idx].avg_shear_rate)
        {
            start_idx += 1;
        }

        // Find last non-mixing step
        let mut end_idx = cycle.steps.len().saturating_sub(1);
        while end_idx > start_idx && is_mixing_rate(cycle.steps[end_idx].avg_shear_rate) {
            end_idx -= 1;
        }

        // Validate: need at least 3 steps in body for meaningful regression
        if start_idx > end_idx {
            return cycle.steps.clone();
        }

        let api_steps = cycle.steps[start_idx..=end_idx].to_vec();
        if api_steps.len() >= 3 {
            return api_steps;
        } else {
            return cycle.steps.clone();
        }
    }

    // ISO / Custom: Extract body with optional boundary step for ramp fitting
    if cycle.cycle_type == "Custom" || cycle.cycle_type == "ISO" {
        // Count mixing steps at start
        let mut start_mix_count = 0;
        while start_mix_count < cycle.steps.len()
            && is_mixing_rate(cycle.steps[start_mix_count].avg_shear_rate)
        {
            start_mix_count += 1;
        }

        // Count mixing steps at end
        let mut end_mix_count = 0;
        while end_mix_count < cycle.steps.len() - start_mix_count
            && is_mixing_rate(cycle.steps[cycle.steps.len() - 1 - end_mix_count].avg_shear_rate)
        {
            end_mix_count += 1;
        }

        let body_start = start_mix_count;
        let body_end = cycle.steps.len() - end_mix_count;

        if body_end <= body_start {
            return cycle.steps.clone();
        }

        let body_steps = &cycle.steps[body_start..body_end];

        if body_steps.len() < 2 {
            return cycle.steps.clone();
        }

        // Determine ramp direction
        let first_body_rate = body_steps[0].avg_shear_rate;
        let last_body_rate = body_steps[body_steps.len() - 1].avg_shear_rate;
        let is_ramp_down = first_body_rate > last_body_rate + 5.0;
        let is_ramp_up = last_body_rate > first_body_rate + 5.0;

        // For ramp down: include one leading mixing step (helps anchor the curve)
        if is_ramp_down && start_mix_count > 0 {
            let effective_start = start_mix_count - 1;
            return cycle.steps[effective_start..body_end].to_vec();
        // For ramp up: include one trailing mixing step
        } else if is_ramp_up && end_mix_count > 0 {
            let effective_end = cycle.steps.len() - end_mix_count + 1;
            return cycle.steps[body_start..effective_end].to_vec();
        // Flat or minimal gradient: just use body
        } else if body_steps.len() >= 3 {
            return body_steps.to_vec();
        } else {
            return cycle.steps.clone();
        }
    }

    // Unknown cycle type: return all steps
    cycle.steps.clone()
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

    fn create_test_cycle(cycle_type: &str, steps: Vec<RheoStep>) -> RheoCycle {
        let duration: f64 = steps.iter().map(|s| s.duration).sum();
        RheoCycle {
            id: 1,
            cycle_index: Some(1),
            cycle_type: cycle_type.to_string(),
            steps,
            description: "Test cycle".to_string(),
            duration,
        }
    }

    #[test]
    fn test_sst_cycle_unchanged() {
        let steps = vec![
            create_test_step(1, 0.0, 30.0, 500.0),
            create_test_step(2, 30.0, 30.0, 100.0),
        ];
        let cycle = create_test_cycle("SST", steps.clone());

        let result = process_cycle_for_calculation(&cycle);

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].avg_shear_rate, 500.0);
        assert_eq!(result[1].avg_shear_rate, 100.0);
    }

    #[test]
    fn test_api_cycle_filters_mixing() {
        // API cycle: mixing(100) -> data(75, 50, 25) -> mixing(100)
        let steps = vec![
            create_test_step(1, 0.0, 30.0, 100.0),   // Mixing (max rate)
            create_test_step(2, 30.0, 30.0, 75.0),   // Data
            create_test_step(3, 60.0, 30.0, 50.0),   // Data
            create_test_step(4, 90.0, 30.0, 25.0),   // Data
            create_test_step(5, 120.0, 30.0, 100.0), // Mixing (max rate)
        ];
        let cycle = create_test_cycle("API", steps);

        let result = process_cycle_for_calculation(&cycle);

        // Should filter out mixing steps at start and end
        assert_eq!(result.len(), 3);
        assert!(!result
            .iter()
            .any(|s| (s.avg_shear_rate - 100.0).abs() < 1.0));
    }

    #[test]
    fn test_iso_cycle_ramp_down() {
        // ISO ramp down: 100 -> 75 -> 50 -> 25
        let steps = vec![
            create_test_step(1, 0.0, 60.0, 100.0),  // Mixing
            create_test_step(2, 60.0, 30.0, 75.0),  // Ramp
            create_test_step(3, 90.0, 30.0, 50.0),  // Ramp
            create_test_step(4, 120.0, 30.0, 25.0), // Ramp
        ];
        let cycle = create_test_cycle("ISO", steps);

        let result = process_cycle_for_calculation(&cycle);

        // Should include 1 mixing step for ramp down
        assert!(result.len() >= 3);
    }

    #[test]
    fn test_custom_cycle_body_extraction() {
        // Custom: mixing(100) -> body(50, 75) -> mixing(100)
        let steps = vec![
            create_test_step(1, 0.0, 60.0, 100.0),   // Mixing
            create_test_step(2, 60.0, 30.0, 50.0),   // Body
            create_test_step(3, 90.0, 30.0, 75.0),   // Body
            create_test_step(4, 120.0, 60.0, 100.0), // Mixing
        ];
        let cycle = create_test_cycle("Custom", steps);

        let result = process_cycle_for_calculation(&cycle);

        // Should extract body steps
        assert!(result.len() >= 2);
    }

    #[test]
    fn test_empty_cycle() {
        let cycle = create_test_cycle("Custom", vec![]);
        let result = process_cycle_for_calculation(&cycle);
        assert_eq!(result.len(), 0);
    }
}
