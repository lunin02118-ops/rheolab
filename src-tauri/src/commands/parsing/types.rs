use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ParseRequest {
    pub filename: String,
    /// Preferred on desktop: Rust reads the file from disk — avoids 8× JSON array conversion over IPC.
    pub file_path: Option<String>,
    /// Web / WASM fallback only — present when filePath is absent.
    pub bytes: Option<Vec<u8>>,
    /// When true, skip heuristic parsing and use Groq AI for column mapping.
    pub force_ai: Option<bool>,
    /// AI model override (defaults to llama-4-scout).
    pub ai_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
pub struct ParsedPoint {
    pub time_sec: f64,
    pub viscosity_cp: f64,
    pub temperature_c: f64,
    pub speed_rpm: f64,
    pub shear_rate_s1: f64,
    pub shear_stress_pa: f64,
    pub pressure_bar: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bath_temperature_c: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SummaryRange {
    pub min: f64,
    pub max: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SummaryRangeWithAvg {
    pub min: f64,
    pub max: f64,
    pub avg: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TimeRange {
    pub start: f64,
    pub end: f64,
    pub duration_minutes: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ParseSummary {
    pub point_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_range: Option<TimeRange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viscosity_range: Option<SummaryRangeWithAvg>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature_range: Option<SummaryRangeWithAvg>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pressure_range: Option<SummaryRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RecipeComponentResponse {
    pub abbreviation: String,
    pub concentration: f64,
    pub unit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reagent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reagent_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FilenameMetadataResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_type_full: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub water_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recipe: Option<Vec<RecipeComponentResponse>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CalibrationResponse {
    pub device_type: String,
    pub r_squared: f64,
    pub slope: f64,
    pub intercept: f64,
    pub hysteresis: f64,
    pub stdev: f64,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_cal_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calibration_date: Option<String>,
    pub issues: Vec<String>,
    pub raw_data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiAppliedMappingEntry {
    pub field: String,
    pub index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum AiDiagnosticsStatus {
    Accepted,
    Failed,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AiDiagnostics {
    pub attempted: bool,
    pub provider: String,
    pub model: String,
    pub prompt_version: String,
    pub candidate_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected_candidate: Option<usize>,
    pub status: AiDiagnosticsStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub applied_mapping: Vec<AiAppliedMappingEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ParseMetadata {
    pub filename: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instrument_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geometry: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geometry_source: Option<String>,
    // Explicitly renamed to "usedAI" (not "usedAi") to match TypeScript convention
    // where "AI" is treated as an acronym. serde rename_all="camelCase" would produce
    // "usedAi" which the frontend cannot read as metadata.usedAI.
    #[serde(rename = "usedAI")]
    pub used_ai: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_diagnostics: Option<AiDiagnostics>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename_metadata: Option<FilenameMetadataResponse>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calibration: Option<CalibrationResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ParseFileResponse {
    pub success: bool,
    pub source: String,
    pub data: Vec<ParsedPoint>,
    pub metadata: ParseMetadata,
    pub summary: ParseSummary,
}
