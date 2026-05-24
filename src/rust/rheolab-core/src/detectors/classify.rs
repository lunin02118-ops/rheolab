//! Cycle classification and shared cycle-construction helpers.
//!
//! This module hosts the logic that is independent of a particular detection
//! strategy: assembling a [`RheoCycle`] from its steps, classifying a pattern
//! as API/ISO/Custom, and merging ramp-down + ramp-up pairs into a single
//! symmetric cycle.

use crate::types::{RheoCycle, RheoStep};

/// Build a [`RheoCycle`] from its component steps and assign a classification.
///
/// Rates are rounded to the nearest 5 s⁻¹ before pattern matching — this is
/// intentional: it aligns with the TypeScript reference implementation and
/// keeps the classifier tolerant of small measurement jitter.
pub(super) fn create_cycle(steps: Vec<RheoStep>, id: i32) -> RheoCycle {
    let duration: f64 = steps.iter().map(|s| s.duration).sum();

    // Classify cycle type based on pattern (matching TypeScript logic)
    let rates: Vec<i32> = steps
        .iter()
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

/// Classify cycle type based on rates pattern (API/ISO/Custom).
fn classify_cycle_type(rates: &[i32], id: i32) -> (String, String) {
    if rates.len() < 2 {
        return ("Custom".to_string(), format!("Cycle {}", id));
    }

    // Helper: check if rates contain a value (with tolerance)
    let has_rate =
        |target: i32, tol: i32| -> bool { rates.iter().any(|&r| (r - target).abs() <= tol) };

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

    // Check symmetry (first half mirrors second half) — use body rates without mixing
    let is_symmetric = is_symmetric_pattern(&body_rates);

    // Check monotonicity
    let rates_to_check = if body_rates.len() >= 3 {
        &body_rates
    } else {
        rates
    };
    let is_monotonic = is_monotonic_pattern(rates_to_check);

    // API RP 39 pattern check
    let has_api_rates = has_rate(75, 5) && has_rate(50, 5) && has_rate(25, 5);
    let has_low_rates = has_rate(10, 3) || has_rate(5, 3) || has_rate(3, 2);
    let is_api_pattern = is_symmetric && has_api_rates && !has_low_rates;

    // ISO 13503-1 pattern check
    let unique_rates: std::collections::HashSet<i32> =
        rates_to_check.iter().map(|&r| (r / 10) * 10).collect();
    let has_enough_levels = unique_rates.len() >= 3;
    let has_anomalous_rates = rates_to_check.iter().any(|&r| r > 200 && r < 400);
    let is_iso_pattern =
        is_monotonic && rates.len() >= 3 && has_enough_levels && !has_anomalous_rates;

    // Classify
    if is_api_pattern {
        ("API".to_string(), "API RP 39 Cycle".to_string())
    } else if is_iso_pattern {
        let direction = if rates_to_check.first() > rates_to_check.last() {
            "Ramp ↓"
        } else {
            "Ramp ↑"
        };
        (
            "ISO".to_string(),
            format!("ISO 13503-1 Cycle ({})", direction),
        )
    } else {
        ("Custom".to_string(), format!("Cycle {}", id))
    }
}

/// Check if pattern is symmetric (e.g., [75, 50, 25, 50, 75]).
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

/// Check if pattern is monotonic (strictly increasing or decreasing).
fn is_monotonic_pattern(rates: &[i32]) -> bool {
    if rates.len() < 2 {
        return false;
    }

    let is_increasing = rates.windows(2).all(|w| w[1] >= w[0] - 5);
    let is_decreasing = rates.windows(2).all(|w| w[1] <= w[0] + 5);

    is_increasing || is_decreasing
}

/// Merges adjacent cycles that form a symmetric pattern (e.g. Ramp Down + Ramp Up).
///
/// When an anchor-based detector splits an API cycle across its apex, the two
/// halves come back as separate ramp-down and ramp-up cycles. This function
/// reunites them into a single cycle that the classifier can re-label as API.
pub(super) fn merge_symmetric_cycles(cycles: Vec<RheoCycle>) -> Vec<RheoCycle> {
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
        let is_ramp_down = curr_rates.first().expect("non-empty: guarded")
            > curr_rates.last().expect("non-empty: guarded");
        // Ramp Up: first < last
        let is_ramp_up = next_rates.first().expect("non-empty: guarded")
            < next_rates.last().expect("non-empty: guarded");

        if is_ramp_down && is_ramp_up {
            let end_rate = *curr_rates.last().expect("non-empty: guarded");
            let start_rate = *next_rates.first().expect("non-empty: guarded");

            // Check continuity: end of first should be close to start of second
            // OR second starts where first ended (with small gap).
            // In BSL case: end=25, start=10. NOT continuous by equal value but
            // continuous in sequence.
            // TS Logic: Math.abs(endRate - startRate) < 10 ||
            //           (endRate > startRate && nextRates[1] > startRate)

            let is_continuous = (end_rate - start_rate).abs() < 10.0
                || (end_rate > start_rate && next_rates.len() > 1 && next_rates[1] > start_rate);

            if is_continuous {
                // Merge steps
                let mut merged_steps = current.steps.clone();
                merged_steps.extend(next.steps.clone());

                // Re-classify the merged cycle.
                // Note: We do NOT force API type here — the classifier decides
                // whether it's API (standard pattern) or Custom (e.g. BSL with
                // low rates). But the cycle is merged into one structure.
                let id = current.id;
                let merged_cycle = create_cycle(merged_steps, id);

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
