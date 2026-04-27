//! Cycle-boundary detection and construction.
//!
//! Mirrors `detectCyclesWasmOrchestrator` / `make_cycle` helpers in the old worker.

use rheolab_core::types::{RheoCycle, RheoStep};
use rheolab_core::{
    detect_anchor_cycles_internal, detect_repeating_sequence_cycles_internal,
    detect_sst_cycles_internal, is_repeating_sequence_pattern, is_sst_pattern,
};

/// Orchestrates cycle detection — mirrors `detectCyclesWasmOrchestrator` in the worker.
///
/// Priority:
/// 1. SST pattern → `detect_sst_cycles_internal`
/// 2. Repeating sequence → `detect_repeating_sequence_cycles_internal`
/// 3. Anchor-based → `detect_anchor_cycles_internal`
/// 4. Fallback: single cycle containing all steps
pub(crate) fn detect_cycles_native(steps: &[RheoStep]) -> Vec<RheoCycle> {
    if steps.is_empty() {
        return Vec::new();
    }

    // 1. SST
    if is_sst_pattern(steps) {
        return detect_sst_cycles_internal(steps);
    }

    // 2. Repeating sequence
    if is_repeating_sequence_pattern(steps) {
        if let Some(cycles) = detect_repeating_sequence_cycles_internal(steps) {
            if cycles.len() >= 2 {
                return cycles;
            }
        }
    }

    // 3. Anchor-based
    let anchor_cycles = detect_anchor_cycles_internal(steps);
    if !anchor_cycles.is_empty() {
        return anchor_cycles;
    }

    // 4. Fallback: single cycle with all steps
    let duration: f64 = steps.iter().map(|s| s.duration).sum();
    vec![RheoCycle {
        id: 1,
        cycle_index: Some(1),
        cycle_type: "Custom".to_string(),
        steps: steps.to_vec(),
        description: "Cycle 1".to_string(),
        duration,
    }]
}

/// Builds a `RheoCycle` from a step slice and an integer id.
pub(crate) fn make_cycle(steps: Vec<RheoStep>, id: i32) -> RheoCycle {
    let duration: f64 = steps.iter().map(|s| s.duration).sum();
    RheoCycle {
        id,
        cycle_index: Some(id),
        cycle_type: "Custom".to_string(),
        steps,
        description: format!("Cycle {}", id),
        duration,
    }
}
