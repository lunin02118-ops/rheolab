//! Anchor-based cycle detection — the primary strategy for splitting a
//! schedule into rheological cycles using mixing steps as anchor points.

use crate::types::{RheoStep, RheoCycle};
use super::{DURATION_MIXING_MIN, SHEAR_RATE_MIXING_MIN};
use super::mixing::is_mixing_step;
use super::classify::{create_cycle, merge_symmetric_cycles};

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
