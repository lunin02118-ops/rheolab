//! Report Data Types
//!
//! Mirrors the TypeScript interfaces exactly for seamless serialization.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Main input for report generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportInput {
    /// Raw measurement data points (optional for PDF reports)
    #[serde(default)]
    pub raw_data: Vec<DataPoint>,
    /// Test metadata
    pub metadata: ReportMetadata,
    /// Cycle analysis results
    pub cycle_results: Vec<CycleResult>,
    /// Reagent recipe
    pub recipe: Vec<Reagent>,
    /// Water analysis parameters
    #[serde(default)]
    pub water_params: Option<WaterParams>,
    /// Detected cycles
    #[serde(default)]
    pub cycles: Vec<CycleInfo>,
    /// Report settings
    pub settings: ReportSettings,
    /// Chart image as base64 (for PDF)
    #[serde(default)]
    pub chart_image_base64: Option<String>,
    /// Axis ranges for Typst rendering
    #[serde(default)]
    pub axis_values: Option<AxisValues>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AxisValues {
    pub time_min: f64,
    pub time_max: f64,
    pub viscosity_min: f64,
    pub viscosity_max: f64,
    pub temperature_min: f64,
    pub temperature_max: f64,
    pub shear_rate_min: f64,
    pub shear_rate_max: f64,
    pub pressure_min: f64,
    pub pressure_max: f64,
}

/// Single data point from rheometer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataPoint {
    pub time_sec: f64,
    pub viscosity_cp: f64,
    #[serde(default)]
    pub temperature_c: Option<f64>,
    #[serde(default)]
    pub bath_temperature_c: Option<f64>,
    #[serde(default)]
    pub shear_rate: Option<f64>,
    #[serde(default)]
    pub shear_stress_pa: Option<f64>,
    #[serde(default)]
    pub speed_rpm: Option<f64>,
    #[serde(default)]
    pub pressure_bar: Option<f64>,
}

/// Test metadata - matching ExperimentMetadata from TypeScript
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ReportMetadata {
    pub filename: String,
    #[serde(default)]
    pub test_id: Option<String>,
    #[serde(default)]
    pub test_date: Option<String>,
    #[serde(default)]
    pub operator_name: Option<String>,
    #[serde(default)]
    pub laboratory_name: Option<String>,
    #[serde(default)]
    pub field_name: Option<String>,
    #[serde(default)]
    pub well_number: Option<String>,
    #[serde(default)]
    pub instrument_type: Option<String>,
    #[serde(default)]
    pub geometry: Option<String>,
    #[serde(default)]
    pub company_name: Option<String>,
    #[serde(default)]
    pub company_logo_base64: Option<String>,
    /// Calibration data (optional)
    #[serde(default)]
    pub calibration: Option<CalibrationData>,
}

/// Calibration data for instruments
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CalibrationData {
    pub device_type: Option<String>,
    pub calibration_date: Option<String>,
    pub last_cal_date: Option<String>,
    pub r_squared: Option<f64>,
    pub slope: Option<f64>,
    pub intercept: Option<f64>,
    pub hysteresis: Option<f64>,
    pub stdev: Option<f64>,
    pub status: Option<String>,
}

/// Cycle analysis result - matching GraceCycleResult from TypeScript
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CycleResult {
    #[serde(default)]
    pub cycle_no: i32,
    #[serde(default, alias = "endTimeMin")]
    pub time_min: f64,
    #[serde(default)]
    pub temp_c: f64,
    #[serde(default)]
    pub pressure_bar: Option<f64>,
    #[serde(default)]
    pub n_prime: f64,
    #[serde(default, alias = "K_prime_PaSn")]
    pub k_prime: f64,
    #[serde(default, alias = "K_prime_slot_PaSn")]
    pub k_slot: Option<f64>,
    #[serde(default, alias = "K_pipe_PaSn")]
    pub k_pipe: Option<f64>,
    #[serde(default)]
    pub r2: f64,
    #[serde(default)]
    pub visc_at_40: Option<f64>,
    #[serde(default)]
    pub visc_at_100: Option<f64>,
    #[serde(default)]
    pub visc_at_170: Option<f64>,
    /// Dynamic viscosities map: shear_rate -> viscosity_cp
    #[serde(default)]
    pub viscosities: HashMap<String, f64>,
    #[serde(alias = "bingham_PV_PaS")]
    #[serde(default)]
    pub bingham_pv: Option<f64>,
    #[serde(alias = "bingham_YP_Pa")]
    #[serde(default)]
    pub bingham_yp: Option<f64>,
    #[serde(default)]
    pub bingham_r2: Option<f64>,
}

/// Reagent in recipe
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reagent {
    #[serde(alias = "reagentName")]
    pub name: String,
    pub concentration: f64,
    pub unit: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub batch_number: Option<String>,
}

/// Water analysis parameters
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WaterParams {
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub salinity: Option<f64>,
    #[serde(default)]
    pub ph: Option<f64>,
    #[serde(default)]
    pub hardness: Option<f64>,
    #[serde(default)]
    pub fe: Option<f64>,
    #[serde(default)]
    pub ca: Option<f64>,
    #[serde(default)]
    pub mg: Option<f64>,
    #[serde(default)]
    pub cl: Option<f64>,
    #[serde(default)]
    pub so4: Option<f64>,
    #[serde(default)]
    pub hco3: Option<f64>,
}

/// Cycle info for ramp string display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CycleInfo {
    #[serde(rename = "type")]
    pub cycle_type: String,
    pub steps: Vec<StepInfo>,
}

/// Step info within a cycle
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepInfo {
    pub avg_shear_rate: f64,
}

/// Individual line settings for chart rendering
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LineSettings {
    #[serde(default = "default_line_color")]
    pub color: String,
    #[serde(default = "default_line_width")]
    pub width: u8,
    #[serde(default = "default_line_style")]
    pub style: String,
}

fn default_line_color() -> String {
    "#3b82f6".to_string()
}
fn default_line_width() -> u8 {
    2
}
fn default_line_style() -> String {
    "solid".to_string()
}

/// All chart line settings
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChartLineSettings {
    #[serde(default)]
    pub viscosity: LineSettings,
    #[serde(default)]
    pub temperature: LineSettings,
    #[serde(default)]
    pub shear_rate: LineSettings,
    #[serde(default)]
    pub pressure: LineSettings,
    #[serde(default)]
    pub rpm: LineSettings,
    #[serde(default)]
    pub bath_temperature: Option<LineSettings>,
}

/// Report generation settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReportSettings {
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_unit_system")]
    pub unit_system: String,
    #[serde(default)]
    pub show_temperature: bool,
    #[serde(default)]
    pub show_shear_rate: bool,
    #[serde(default)]
    pub show_pressure: bool,
    #[serde(default)]
    pub show_bath_temperature: bool,
    #[serde(default)]
    pub show_touch_points: bool,
    #[serde(default = "default_viscosity_threshold")]
    pub viscosity_threshold: f64,
    #[serde(default)]
    pub show_target_time: bool,
    #[serde(default = "default_target_time")]
    pub target_time: f64,
    #[serde(default)]
    pub show_calibration: bool,
    /// Whether to include raw data table in the report
    #[serde(default)]
    pub show_raw_data: bool,
    #[serde(default = "default_shear_rate_axis")]
    pub shear_rate_axis: String,
    #[serde(default = "default_pressure_axis")]
    pub pressure_axis: String,
    /// Axis layout mode for the chart:
    /// - "individual" (Раздельные): viscosity on its own left scale, other metrics on right
    /// - "shared" (Общие): metrics share a unified left/right scale based on their axis setting
    #[serde(default = "default_axis_mode")]
    pub axis_mode: String,
    /// Dynamic viscosity shear rates (e.g. [40, 100, 170])
    #[serde(default = "default_viscosity_shear_rates")]
    pub viscosity_shear_rates: Vec<i32>,
    /// When false (Beginner mode), omit PV / YP / R²B columns from the stats table.
    #[serde(default = "default_show_advanced_stats")]
    pub show_advanced_stats: bool,
    /// Line settings for chart rendering (colors, widths, styles)
    #[serde(default)]
    pub line_settings: Option<ChartLineSettings>,
    /// Per-category display unit overrides (viscosity / K' / PV / YP / time format).
    ///
    /// When present, the report stats table uses THESE labels + their
    /// accompanying unit conversions instead of falling back to the
    /// coarse `unit_system` enum (which forces every quantity into the
    /// same Imperial-or-SI bucket and breaks mixed presets like
    /// "cP viscosity + Pa·s^n K'").  See `formatters.rs::render_*_with`
    /// for the conversion table.  Absent → legacy `unit_system` path.
    #[serde(default)]
    pub rheology_units: Option<RheologyUnits>,
    #[serde(default = "default_rheology_source")]
    pub rheology_source: String,
}

/// Per-category display unit overrides mirrored from
/// `chartSettings.rheologyUnits` in the TS store.
///
/// Each field carries the *target* label string (e.g. `"Pa·s^n"`,
/// `"lbf·s^n/100ft²"`).  Formatters in `formatters.rs` accept this struct
/// and decide both the numerical conversion factor AND the rendered
/// label from the string alone — the report stays in lockstep with what
/// the UI stats table prints, including custom / mixed presets.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RheologyUnits {
    /// Viscosity display unit. One of `"mPa·s"` | `"Pa·s"` | `"cP"`.
    #[serde(default)]
    pub viscosity: String,
    /// Temperature display unit. One of `"°C"` | `"°F"`.
    #[serde(default)]
    pub temperature: String,
    /// Pressure display unit. One of `"bar"` | `"psi"`.
    #[serde(default)]
    pub pressure: String,
    /// Consistency index K' unit. One of `"Pa·s^n"` | `"lbf·s^n/100ft²"`.
    #[serde(default)]
    pub consistency: String,
    /// Plastic viscosity (PV) unit. One of `"Pa·s"` | `"cP"`.
    #[serde(default)]
    pub plastic_viscosity: String,
    /// Yield point (YP) unit. One of `"Pa"` | `"lbf/100ft²"`.
    #[serde(default)]
    pub yield_point: String,
    /// Time display format. One of `"seconds"` | `"minutes"` | `"hh:mm:ss"`.
    /// Controls the `Время (…)` column header AND the rendered cell value.
    #[serde(default)]
    pub time_format: String,
}

fn default_language() -> String {
    "ru".to_string()
}
fn default_unit_system() -> String {
    "SI".to_string()
}
fn default_viscosity_threshold() -> f64 {
    200.0
}
fn default_target_time() -> f64 {
    10.0
}
fn default_shear_rate_axis() -> String {
    "left".to_string()
}
fn default_pressure_axis() -> String {
    "right".to_string()
}
fn default_axis_mode() -> String {
    "individual".to_string()
}
fn default_viscosity_shear_rates() -> Vec<i32> {
    vec![40, 100, 170]
}
fn default_show_advanced_stats() -> bool {
    true
}
fn default_rheology_source() -> String {
    "program".to_string()
}

impl Default for ReportSettings {
    fn default() -> Self {
        Self {
            language: default_language(),
            unit_system: default_unit_system(),
            show_temperature: true,
            show_shear_rate: true,
            show_pressure: false,
            show_bath_temperature: false,
            show_touch_points: false,
            viscosity_threshold: default_viscosity_threshold(),
            show_target_time: false,
            target_time: default_target_time(),
            show_calibration: false,
            show_raw_data: false,
            shear_rate_axis: default_shear_rate_axis(),
            pressure_axis: default_pressure_axis(),
            axis_mode: default_axis_mode(),
            viscosity_shear_rates: default_viscosity_shear_rates(),
            show_advanced_stats: default_show_advanced_stats(),
            line_settings: None,
            rheology_units: None,
            rheology_source: default_rheology_source(),
        }
    }
}

/// Touch point detected on chart
#[derive(Debug, Clone)]
pub struct TouchPoint {
    pub label: String,
    pub time: f64,
    pub viscosity: f64,
    pub color: String,
}
