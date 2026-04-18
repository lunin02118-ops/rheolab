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

#[derive(Debug, Clone)]
pub enum TouchPointType {
    Threshold,
    Target,
}

#[derive(Debug, Clone)]
pub struct TouchPointResult {
    pub time: f64,
    pub viscosity: f64,
    pub tp_type: TouchPointType,
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
