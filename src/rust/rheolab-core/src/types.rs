use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RheoPoint {
    #[serde(default, alias = "timeSec", alias = "time")]
    pub time_sec: f64,
    #[serde(default, alias = "viscosityCp", alias = "viscosity")]
    pub viscosity_cp: f64,
    #[serde(default, alias = "temperatureC", alias = "temperature")]
    pub temperature_c: f64,
    #[serde(default, alias = "shearRate", alias = "shear_rate_s1")]
    pub shear_rate: Option<f64>,
    #[serde(default, alias = "shearStress", alias = "shear_stress_pa")]
    pub shear_stress: Option<f64>,
    #[serde(default, alias = "pressureBar", alias = "pressure")]
    pub pressure_bar: Option<f64>,
    #[serde(default, alias = "speed_rpm", alias = "speedRpm")]
    pub rpm: Option<f64>,
    #[serde(default, alias = "bathTemperatureC", skip_serializing_if = "Option::is_none")]
    pub bath_temperature_c: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ColumnarData {
    #[serde(rename = "timeSec")]
    pub time_sec: Vec<f64>,
    #[serde(rename = "viscosityCp")]
    pub viscosity_cp: Vec<f64>,
    #[serde(rename = "temperatureC")]
    pub temperature_c: Vec<f64>,
    #[serde(rename = "shearRate")]
    pub shear_rate: Vec<Option<f64>>,
    #[serde(rename = "shearStress")]
    pub shear_stress: Vec<Option<f64>>,
    #[serde(rename = "pressureBar")]
    pub pressure_bar: Vec<Option<f64>>,
    #[serde(rename = "speedRpm")]
    pub rpm: Vec<Option<f64>>,
    #[serde(rename = "bathTemperatureC", skip_serializing_if = "Vec::is_empty", default)]
    pub bath_temperature_c: Vec<Option<f64>>,
}

impl ColumnarData {
    pub fn from_aos(points: &[RheoPoint]) -> Self {
        let len = points.len();
        let mut time_sec = Vec::with_capacity(len);
        let mut viscosity_cp = Vec::with_capacity(len);
        let mut temperature_c = Vec::with_capacity(len);
        let mut shear_rate = Vec::with_capacity(len);
        let mut shear_stress = Vec::with_capacity(len);
        let mut pressure_bar = Vec::with_capacity(len);
        let mut rpm = Vec::with_capacity(len);
        let mut bath_temperature_c = Vec::with_capacity(len);

        for p in points {
            time_sec.push(p.time_sec);
            viscosity_cp.push(p.viscosity_cp);
            temperature_c.push(p.temperature_c);
            shear_rate.push(p.shear_rate);
            shear_stress.push(p.shear_stress);
            pressure_bar.push(p.pressure_bar);
            rpm.push(p.rpm);
            bath_temperature_c.push(p.bath_temperature_c);
        }

        // Only include bath_temperature_c if any value is Some
        let has_bath = bath_temperature_c.iter().any(|v| v.is_some());

        Self {
            time_sec,
            viscosity_cp,
            temperature_c,
            shear_rate,
            shear_stress,
            pressure_bar,
            rpm,
            bath_temperature_c: if has_bath { bath_temperature_c } else { Vec::new() },
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct RheoStep {
    #[serde(default)]
    pub id: i32,
    #[serde(default, rename = "startTime", alias = "start_time")]
    pub start_time: f64,
    #[serde(default, rename = "endTime", alias = "end_time")]
    pub end_time: f64,
    #[serde(default)]
    pub duration: f64,
    #[serde(default, rename = "avgShearRate", alias = "avg_shear_rate")]
    pub avg_shear_rate: f64,
    #[serde(default, rename = "avgShearStress", alias = "avg_shear_stress")]
    pub avg_shear_stress: f64,
    #[serde(default, rename = "avgViscosity", alias = "avg_viscosity")]
    pub avg_viscosity: f64,
    #[serde(default, rename = "avgTemperature", alias = "avg_temperature")]
    pub avg_temperature: f64,
    #[serde(default, rename = "avgPressure", alias = "avg_pressure")]
    pub avg_pressure: f64,
    #[serde(default)]
    pub points: Vec<RheoPoint>,
    #[serde(default, rename = "calcPointsCount", alias = "calc_points_count")]
    pub calc_points_count: i32,
    #[serde(default, rename = "isRamp", alias = "is_ramp")]
    pub is_ramp: bool,
    #[serde(default, rename = "startIndex", alias = "start_index")]
    pub start_index: i32,
    #[serde(default, rename = "endIndex", alias = "end_index")]
    pub end_index: i32,
    #[serde(default, rename = "isSplitStart", alias = "is_split_start")]
    pub is_split_start: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct RheoCycle {
    #[serde(default)]
    pub id: i32,
    #[serde(default, rename = "cycleIndex", alias = "cycle_index")]
    pub cycle_index: Option<i32>,
    #[serde(default, rename = "type", alias = "cycle_type")]
    pub cycle_type: String,
    #[serde(default)]
    pub steps: Vec<RheoStep>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub duration: f64,
}
