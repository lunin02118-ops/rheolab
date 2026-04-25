//! Input/output types for smart touch-point calculation.

use super::{
    DEFAULT_TREND_WINDOW_MIN, DEFAULT_SHEAR_RATE_TOLERANCE,
    DEFAULT_SMOOTHING_WINDOW_MIN,
};

#[derive(Debug, Clone)]
pub struct TouchPointInput {
    pub time_min: f64,
    pub viscosity_cp: f64,
    pub shear_rate: f64, // 0.0 means absent
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TouchPointType {
    Threshold,
    Target,
}

/// Optional hint describing why a touch-point coordinate was adjusted.
/// Mirrors the TS `TouchPointResult.anomaly` string literal union so the
/// 1:1 parity between frontend and report generator is preserved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TouchPointAnomaly {
    /// `target`-type only: the two points bracketing `targetTime` belong
    /// to different shear-rate plateaus, so the algorithm anchored the
    /// marker to the nearest raw data point instead of interpolating
    /// across the vertical jump.
    ShearRateJump,
}

#[derive(Debug, Clone)]
pub struct TouchPointResult {
    pub time: f64,
    pub viscosity: f64,
    pub tp_type: TouchPointType,
    /// Set only when the algorithm had to work around a curve
    /// discontinuity; `None` for the common case.
    pub anomaly: Option<TouchPointAnomaly>,
}

pub struct SmartTouchPointOptions {
    pub viscosity_threshold: f64,
    pub show_target_time: bool,
    pub target_time: f64,
    pub trend_window_minutes: f64,
    pub shear_rate_tolerance: f64,
    /// Width of the centred moving-average smoothing window in minutes.
    /// Default matches TS: 3 min (±1.5 min each side).
    pub smoothing_window_minutes: f64,
}

impl Default for SmartTouchPointOptions {
    fn default() -> Self {
        Self {
            viscosity_threshold: 500.0,
            show_target_time: true,
            target_time: 10.0,
            trend_window_minutes: DEFAULT_TREND_WINDOW_MIN,
            shear_rate_tolerance: DEFAULT_SHEAR_RATE_TOLERANCE,
            smoothing_window_minutes: DEFAULT_SMOOTHING_WINDOW_MIN,
        }
    }
}
