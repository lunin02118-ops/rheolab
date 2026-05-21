use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ParsingMetadata {
    pub filename: String,
    pub test_date: Option<String>,
    pub instrument_type: Option<String>,
    pub geometry: Option<String>,
    #[serde(rename = "geometrySource")]
    pub geometry_source: Option<String>,
    pub used_ai: bool,
}

#[derive(Debug, Clone)]
pub struct HeaderCandidate {
    pub row_index: usize,
    pub score: f64,
    pub mapping: ColumnMapping,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ColumnMapping {
    pub time_col: Option<usize>,
    pub viscosity_col: Option<usize>,
    pub temperature_col: Option<usize>,
    pub shear_rate_col: Option<usize>,
    pub shear_stress_col: Option<usize>,
    pub pressure_col: Option<usize>,
    pub rpm_col: Option<usize>,
    pub bath_temp_col: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiContextRow {
    pub row_index: usize,
    pub cells: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiContextCandidate {
    pub source_sheet: Option<String>,
    pub section_start_row: usize,
    pub header_row_index: usize,
    pub header_cells: Vec<String>,
    pub unit_row: Option<AiContextRow>,
    pub sample_rows: Vec<AiContextRow>,
    pub instrument_hint: Option<String>,
    pub heuristic_mapping: ColumnMapping,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMappedColumn {
    pub index: usize,
    pub confidence: Option<f32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AiMappingResponse {
    pub selected_candidate: usize,
    pub mapping: BTreeMap<String, AiMappedColumn>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ParsingResult {
    pub data: Vec<crate::types::RheoPoint>,
    pub metadata: ParsingMetadata,
    #[serde(default)]
    pub instrument_rheology: Vec<RheologyParameterRow>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ColumnarParsingResult {
    pub data: crate::types::ColumnarData,
    pub metadata: ParsingMetadata,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct RheologyParameterRow {
    pub cycle_no: i32,
    pub time_min: Option<f64>,
    pub end_time_min: Option<f64>,
    pub temp_c: Option<f64>,
    pub pressure_bar: Option<f64>,
    pub n_prime: Option<f64>,
    pub kv_pasn: Option<f64>,
    pub k_prime_pasn: Option<f64>,
    pub k_slot_pasn: Option<f64>,
    pub k_pipe_pasn: Option<f64>,
    pub r2: Option<f64>,
    pub viscosities: BTreeMap<String, f64>,
    pub bingham_pv_pas: Option<f64>,
    pub bingham_yp_pa: Option<f64>,
    pub bingham_r2: Option<f64>,
    pub calc_points: Option<i32>,
    pub source_sheet: Option<String>,
    pub source_row: Option<i32>,
    pub units: BTreeMap<String, String>,
}
