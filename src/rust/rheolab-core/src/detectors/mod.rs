//! # Cycle Detection Algorithms
//!
//! This module provides algorithms for detecting and classifying rheological
//! test cycles from step data. It identifies the pattern of measurements
//! to determine the test type (API, ISO, SST, Custom).
//!
//! ## Detection Strategies
//!
//! ### 1. Anchor-Based Detection (Primary) — [`anchor`]
//! Uses "mixing" steps as anchors to split data into cycles. Mixing steps
//! are identified by:
//! - Duration significantly longer than neighbors
//! - Shear rate matching a detected "edge rate" pattern
//! - Position at the end with long duration
//!
//! ### 2. SST Detection — [`sst`]
//! Detects Stress-Sweep Tests by looking for alternating high/low rate patterns
//! where the ratio is ≥ 3x and high rate ≥ 200 s⁻¹.
//!
//! ### 3. Repeating Sequence Detection — [`repeating`]
//! Detects custom patterns that repeat (e.g., 100→150→125→100 repeated).
//! Used for SWB and similar multi-rate protocols.
//!
//! ## Cycle Type Classification — [`classify`]
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
//! - [`SHEAR_RATE_MIXING_MIN`]: 50 s⁻¹ — below this is definitely not mixing
//! - [`DURATION_MIXING_MIN`]: 25 s — minimum duration for a step to be mixing
//! - [`DURATION_LONG_STEP_RATIO`]: 1.5 — how much longer than neighbors
//! - [`DURATION_END_STEP_MIN`]: 120 s — long final steps are mixing
//! - [`SHEAR_RATE_HIGH`]: 400 s⁻¹ — above this is not mixing (SST high-rate)
//!
//! ## C# Port Considerations
//!
//! 1. Constants can be `const double` or configurable parameters
//! 2. Use `List<T>` instead of `Vec<T>`
//! 3. `HashSet<T>` for unique rate detection
//! 4. Consider extracting classification logic into a separate service

// ============================================================================
// CONSTANTS - Detection Thresholds
// ============================================================================

/// Minimum shear rate for a mixing step candidate (s⁻¹).
/// Steps with rates below this are measurement steps, not mixing.
pub(crate) const SHEAR_RATE_MIXING_MIN: f64 = 50.0;

/// Minimum duration for a step to be considered mixing (seconds).
/// Short steps are typically measurement or transition steps.
pub(crate) const DURATION_MIXING_MIN: f64 = 25.0;

/// Ratio threshold for duration-based mixing detection.
/// A step is mixing if its duration is > 1.5× the average of its neighbors.
pub(crate) const DURATION_LONG_STEP_RATIO: f64 = 1.5;

/// Minimum duration for a final step to be considered mixing (seconds).
/// Long final steps are typically post-test conditioning.
pub(crate) const DURATION_END_STEP_MIN: f64 = 120.0;

/// Maximum shear rate for mixing step detection (s⁻¹).
/// Very high rates (like SST high-rate phases) are not mixing steps.
pub(crate) const SHEAR_RATE_HIGH: f64 = 400.0;

// ============================================================================
// SUB-MODULES
// ============================================================================

mod mixing;
mod classify;
mod anchor;
mod sst;
mod repeating;

// ============================================================================
// PUBLIC API
// ============================================================================

pub use anchor::detect_anchor_cycles_internal;
pub use sst::{is_sst_pattern, detect_sst_cycles_internal};
pub use repeating::{is_repeating_sequence_pattern, detect_repeating_sequence_cycles_internal};

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests;
