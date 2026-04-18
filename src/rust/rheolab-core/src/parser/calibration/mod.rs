use serde::{Deserialize, Serialize};

mod parsers;
pub use parsers::{parse_calibration_data, parse_calibration_from_buffer};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CalibrationDataPoint {
    pub id: i32,
    pub rpm: f64,
    #[serde(rename = "shearRate")]
    pub shear_rate: f64,
    #[serde(rename = "shearStress")]
    pub shear_stress: f64,
    pub signal: f64,
    #[serde(rename = "calculatedStress")]
    pub calculated_stress: f64,
    pub error: f64,
    pub viscosity: f64,
    pub temperature: f64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BSLMeta {
    pub filename: String,
    pub date: String,
    pub rotor: String,
    pub moment: f64,
    #[serde(rename = "calibrationFluid")]
    pub calibration_fluid: String,
    #[serde(rename = "calibrationType")]
    pub calibration_type: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CalibrationMeta {
    #[serde(rename = "deviceType")]
    pub device_type: String,
    #[serde(rename = "bslMeta")]
    pub bsl_meta: Option<BSLMeta>,
    #[serde(rename = "rSquared")]
    pub r_squared: f64,
    pub slope: f64,
    pub intercept: f64,
    pub hysteresis: f64,
    pub stdev: f64,
    #[serde(rename = "lastCalDate")]
    pub last_cal_date: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CalibrationReport {
    pub meta: CalibrationMeta,
    pub data: Vec<CalibrationDataPoint>,
    pub status: String,
    pub issues: Vec<String>,
}
