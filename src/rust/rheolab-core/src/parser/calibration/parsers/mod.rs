//! Calibration parsing root — dispatches into BSL R1 or Chandler 5550
//! device-specific parsers and exposes the two public entrypoints.
//!
//! # Module layout
//! - [`math`]      — linear regression, hysteresis, stdev, interpolation
//! - [`meta`]      — device detection + metadata/table-start scanners
//! - [`bsl`]       — BSL R1 calibration parser
//! - [`chandler`]  — Chandler 5550 calibration parser
//! - [`buffer`]    — XLSX / XLS / CSV buffer → parser dispatch

use super::{CalibrationMeta, CalibrationReport};

mod bsl;
mod buffer;
mod chandler;
mod math;
mod meta;

pub use buffer::parse_calibration_from_buffer;

// Universal calibration quality limits (industry standard for Couette rheometers)
// StdDev < 4 dyne/cm², Hysteresis < 8 dyne/cm², R² > 0.99
const CALIBRATION_LIMITS_STDEV: f64 = 4.0;       // dyne/cm²
const CALIBRATION_LIMITS_HYSTERESIS: f64 = 8.0;  // dyne/cm²
const CALIBRATION_LIMITS_R_SQUARED: f64 = 0.99;

pub(super) const R1B1_GEOMETRY_FACTOR: f64 = 1.703;  // K-factor for R1B1 (universal)
pub(super) const UNIT_CONVERSION_PA_TO_DYNE_CM2: f64 = 10.0;

pub fn parse_calibration_data(rows: &[Vec<String>]) -> Result<CalibrationReport, String> {
    let device_type = meta::detect_device_type(rows).ok_or("Не удалось определить тип калибровочного файла")?;

    match device_type.as_str() {
        "bslR1" => bsl::parse_bsl_data(rows),
        "chandler5550" | "chandlerCSV" => chandler::parse_chandler_data(rows),
        _ => Err(format!("Неподдерживаемый тип устройства: {}", device_type)),
    }
}

pub(super) fn analyze_quality(meta: &CalibrationMeta) -> Vec<String> {
    let mut issues = Vec::new();

    if meta.stdev >= CALIBRATION_LIMITS_STDEV {
        issues.push(format!("STDEV ({:.2}) превышает предел {} dyne/cm²", meta.stdev, CALIBRATION_LIMITS_STDEV));
    }

    if meta.hysteresis >= CALIBRATION_LIMITS_HYSTERESIS {
        issues.push(format!("Гистерезис ({:.2}) превышает предел {} dyne/cm²", meta.hysteresis, CALIBRATION_LIMITS_HYSTERESIS));
    }

    if meta.r_squared < CALIBRATION_LIMITS_R_SQUARED {
        issues.push(format!("R² ({}) ниже минимального порога {}", meta.r_squared, CALIBRATION_LIMITS_R_SQUARED));
    }

    issues
}
