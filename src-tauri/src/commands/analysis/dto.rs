//! Input / Output DTOs for the native analysis pipeline.
//!
//! All types are `#[derive(Deserialize)]` / `#[derive(Serialize)]`
//! for Tauri IPC payload transport. Validators enforce cross-field
//! invariants that serde cannot express.

use crate::error::{AppError, Result};
use rheolab_core::schedule_detector::ScheduleConfig;
use rheolab_core::types::{RheoCycle, RheoPoint, RheoStep};
use rheolab_core::{ExpertSettings, GraceCycleResult};
use serde::{Deserialize, Serialize};

/// Known geometry keys supported by `rheolab_core::grace::get_geometry()`.
/// Any unrecognised key silently falls back to R1B5 in the core —
/// we validate up-front to surface the problem early.
pub(super) const KNOWN_GEOMETRY_KEYS: &[&str] = &["R1B1", "R1B2", "R1B5"];

pub(super) fn validate_geometry_key(key: &str) -> Result<()> {
    if !KNOWN_GEOMETRY_KEYS.contains(&key) {
        return Err(AppError::BadRequest(format!(
            "unknown geometry_key '{}'; expected one of: {}",
            key,
            KNOWN_GEOMETRY_KEYS.join(", "),
        )));
    }
    Ok(())
}

/// Structure-of-Arrays input for raw rheometer points.
///
/// Avoids materialising N JS objects on the TypeScript side when columnar
/// `Float64Array` data is already available from the parser.  `into_aos()`
/// converts to the `Vec<RheoPoint>` expected by downstream pipeline helpers.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RheoPointsColumnar {
    pub time_sec: Vec<f64>,
    pub viscosity_cp: Vec<f64>,
    pub temperature_c: Vec<f64>,
    /// `null` encodes a missing (optional) measurement.
    pub shear_rate: Vec<Option<f64>>,
    pub shear_stress: Vec<Option<f64>>,
    pub pressure_bar: Vec<Option<f64>>,
    pub rpm: Vec<Option<f64>>,
}

impl RheoPointsColumnar {
    /// Validate that the columnar data is well-formed.
    pub(super) fn validate(&self) -> Result<()> {
        let len = self.time_sec.len();
        if len == 0 {
            return Err(AppError::BadRequest("rheo_points must not be empty".into()));
        }
        // All columns must have the same length — a mismatch indicates a frontend bug.
        if self.viscosity_cp.len() != len
            || self.temperature_c.len() != len
            || self.shear_rate.len() != len
            || self.shear_stress.len() != len
            || self.pressure_bar.len() != len
            || self.rpm.len() != len
        {
            return Err(AppError::BadRequest(
                "rheo_points column arrays must all have the same length".into(),
            ));
        }
        Ok(())
    }

    /// Convert SoA → AoS, producing the `Vec<RheoPoint>` expected by the
    /// pipeline helpers (`detect_schedule`, `process_cycle_internal`, …).
    pub fn into_aos(self) -> Vec<RheoPoint> {
        let len = self.time_sec.len();
        (0..len)
            .map(|i| RheoPoint {
                time_sec: self.time_sec[i],
                viscosity_cp: self.viscosity_cp[i],
                temperature_c: self.temperature_c[i],
                shear_rate: self.shear_rate[i],
                shear_stress: self.shear_stress[i],
                pressure_bar: self.pressure_bar[i],
                rpm: self.rpm[i],
                bath_temperature_c: None,
            })
            .collect()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeFullInput {
    pub(super) rheo_points: RheoPointsColumnar,
    pub(super) geometry_key: String,
    pub(super) settings: ExpertSettings,
    pub(super) detection_settings: ScheduleConfig,
    /// Serialised as `[[cycleId, [stepId, …]], …]` (JSON has no integer Map keys).
    #[serde(default)]
    pub(super) cycle_overrides: Vec<(i32, Vec<i32>)>,
}

impl AnalyzeFullInput {
    pub(super) fn validate(&self) -> Result<()> {
        self.rheo_points.validate()?;
        validate_geometry_key(&self.geometry_key)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectStepsInput {
    pub(super) rheo_points: RheoPointsColumnar,
    pub(super) detection_settings: ScheduleConfig,
}

impl DetectStepsInput {
    pub(super) fn validate(&self) -> Result<()> {
        self.rheo_points.validate()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegroupByPatternInput {
    pub(super) all_steps: Vec<RheoStep>,
    pub(super) shear_rate_pattern: Vec<f64>,
    pub(super) geometry_key: String,
    pub(super) settings: ExpertSettings,
}

impl RegroupByPatternInput {
    pub(super) fn validate(&self) -> Result<()> {
        // Empty pattern is a valid fast-path (returns empty cycles immediately).
        if self.shear_rate_pattern.is_empty() {
            return Ok(());
        }
        validate_geometry_key(&self.geometry_key)
    }
}

/// Shared output shape for commands that return cycles + results + steps.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisOutput {
    pub cycles: Vec<RheoCycle>,
    /// `[[cycleId, GraceCycleResult], …]`
    pub results: Vec<(i32, GraceCycleResult)>,
    pub all_steps: Vec<RheoStep>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectStepsOutput {
    pub steps: Vec<RheoStep>,
}
