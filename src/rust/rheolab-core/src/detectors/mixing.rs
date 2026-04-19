//! Mixing step detection — identifies "conditioning" steps that separate cycles.

use crate::types::RheoStep;
use super::{
    DURATION_MIXING_MIN, DURATION_LONG_STEP_RATIO, DURATION_END_STEP_MIN, SHEAR_RATE_HIGH,
};

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
