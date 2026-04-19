//! Repeating-sequence detection — identifies custom protocols whose rate
//! pattern repeats (e.g. SWB: 100→150→125→100, 100→150→125→100, …).

use crate::types::{RheoStep, RheoCycle};

/// Checks if this looks like a repeating sequence pattern (3+ distinct rates).
///
/// Performs several pre-filters before the expensive search in
/// [`detect_repeating_sequence_cycles_internal`]:
/// - 3–5 distinct rounded rate levels
/// - `max < 3 × min` (otherwise it would be an SST pattern)
/// - rejects pure monotonic ramps and symmetric ramps (low ramp changes)
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
    // (not a valid repeating pattern) — skip this check, let actual pattern detection decide
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

        // Symmetric ramp pattern — not a repeating sequence
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

/// Search for the best repeating pattern of lengths 3..=6, scored by repeat
/// count and coverage.  Returns `None` if no pattern repeats at least twice.
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
                // Calculate baseline (mode — most frequent rate)
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
