use super::options::ComparisonReportByIdsSettings;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentReportByIdRequest {
    pub experiment_id: String,
    pub settings: ComparisonReportByIdsSettings,
    #[serde(default)]
    pub recipe_override: Option<Vec<ExperimentReportRecipeOverride>>,
    #[serde(default)]
    pub water_override: Option<ExperimentReportWaterOverride>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentReportRecipeOverride {
    pub name: String,
    pub concentration: f64,
    pub unit: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub batch_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentReportWaterOverride {
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

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonReportByIdsRequest {
    pub experiment_ids: Vec<String>,
    pub settings: ComparisonReportByIdsSettings,
}

#[allow(dead_code)]
pub enum ReportOutput {
    Bytes(Vec<u8>),
    TempFile { path: PathBuf, byte_count: u64 },
}
