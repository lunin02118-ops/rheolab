//! Smart touch-point (threshold crossing) calculation.
//!
//! Accounts for:
//!  1. Shear-rate ramps — only considers points at the dominant (main mixing)
//!     shear rate (determined automatically as the mode, ±5 % tolerance).
//!  2. Initial viscosity ramp-up — uses a 1-minute sliding-window average to
//!     detect when the viscosity trend changes from rising to falling (peak),
//!     and only searches for the threshold crossing *after* the peak.
//!
//! The algorithm is a 1:1 Rust port of `src/lib/utils/touch-point.ts` so that
//! PDF / Excel reports produce the same touch-point as the frontend chart.
//!
//! # Module layout
//! - [`types`]     — [`TouchPointInput`], [`TouchPointResult`], [`SmartTouchPointOptions`]
//! - [`helpers`]   — dominant-rate clustering, shear-rate filtering, viscosity-peak detection
//! - [`algorithm`] — [`calculate_smart_touch_points`] main entry point

// ─── Default constants (public for defaulting SmartTouchPointOptions) ───────

pub(crate) const DEFAULT_TREND_WINDOW_MIN: f64 = 1.0;
pub(crate) const DEFAULT_SHEAR_RATE_TOLERANCE: f64 = 0.05;
/// Default time-based centred moving-average window (minutes) for smoothing
/// viscosity before threshold detection.  Matches the TS default of 3 min.
pub(crate) const DEFAULT_SMOOTHING_WINDOW_MIN: f64 = 3.0;

// ─── Sub-modules ────────────────────────────────────────────────────────────

mod algorithm;
mod helpers;
mod types;

// ─── Public API ─────────────────────────────────────────────────────────────

pub use algorithm::calculate_smart_touch_points;
pub use helpers::{filter_by_shear_rate, find_dominant_shear_rate, find_viscosity_peak};
pub use types::{
    SmartTouchPointOptions, TouchPointAnomaly, TouchPointInput, TouchPointResult, TouchPointType,
};

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests;
