//! Shared types, constants, and response structs for experiment commands.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(super) const DUPLICATE_CODE: &str = "DUPLICATE_ENTRY";
pub(super) const NAME_CONFLICT_CODE: &str = "NAME_CONFLICT";
pub(super) const NO_LAB_ID: &str = "__no_lab__";
/// Default userId for desktop-local experiments (no real auth session)
pub(crate) const LOCAL_USER_ID: &str = "desktop-local-admin";

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentsListQuery {
    #[serde(default)]
    pub page: Option<usize>,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub laboratory_id: Option<String>,
    #[serde(default)]
    pub search_query: Option<String>,
    #[serde(default)]
    pub test_name: Option<String>,
    #[serde(default)]
    pub laboratory_name: Option<String>,
    #[serde(default)]
    pub field_name: Option<String>,
    #[serde(default)]
    pub operator_name: Option<String>,
    #[serde(default)]
    pub well_number: Option<String>,
    #[serde(default)]
    pub water_source: Option<String>,
    #[serde(default)]
    pub fluid_type: Option<String>,
    #[serde(default)]
    pub instrument_type: Option<String>,
    #[serde(default)]
    pub geometry: Option<String>,
    #[serde(default)]
    pub batch_number: Option<String>,
    #[serde(default)]
    pub reagent_name: Option<String>,
    #[serde(default)]
    pub reagent_names: Option<Vec<String>>,
    #[serde(default)]
    pub date_from: Option<String>,
    #[serde(default)]
    pub date_to: Option<String>,
    #[serde(default)]
    pub duration_min: Option<String>,
    #[serde(default)]
    pub duration_max: Option<String>,
    #[serde(default)]
    pub temp_min: Option<String>,
    #[serde(default)]
    pub temp_max: Option<String>,
    #[serde(default)]
    pub viscosity_min: Option<String>,
    #[serde(default)]
    pub viscosity_max: Option<String>,
    #[serde(default)]
    pub test_category: Option<String>,
    #[serde(default)]
    pub test_type: Option<String>,
    /// Keyset cursor: when set, skip OFFSET and instead use WHERE e.createdAt < cursor_date
    /// OR (e.createdAt = cursor_date AND e.id > cursor_id). Takes priority over `page`.
    #[serde(default)]
    pub after_id: Option<String>,
    /// Column to sort by. Validated server-side against an explicit whitelist.
    /// Ignored when using keyset cursor (cursor requires deterministic ordering).
    #[serde(default)]
    pub sort_by: Option<String>,
    /// Sort direction: "asc" or "desc". Defaults to "desc" when absent.
    #[serde(default)]
    pub sort_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentsPagination {
    pub page: usize,
    pub limit: usize,
    pub total: usize,
    pub total_pages: usize,
    /// Last item ID from this page — pass as `afterId` in next request
    /// for keyset (cursor-based) pagination instead of OFFSET.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentsListResponse {
    pub experiments: Vec<ExperimentListItem>,
    pub pagination: ExperimentsPagination,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentsCountResponse {
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentGetResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experiment: Option<StoredExperiment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ExperimentGetResponse {
    pub(super) fn ok(experiment: StoredExperiment) -> Self {
        Self {
            success: true,
            experiment: Some(experiment),
            error: None,
        }
    }

    pub(super) fn err(error: impl Into<String>) -> Self {
        Self {
            success: false,
            experiment: None,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentGetBatchResponse {
    pub success: bool,
    pub experiments: Vec<StoredExperiment>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Lightweight existence check — returns only the IDs that exist in the DB.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentExistenceResponse {
    pub existing_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentSaveResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experiment_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl ExperimentSaveResponse {
    pub(super) fn created(id: String) -> Self {
        Self {
            success: true,
            experiment_id: Some(id),
            message: Some("Experiment saved successfully".to_string()),
            error: None,
            code: None,
        }
    }

    pub(super) fn updated(id: String) -> Self {
        Self {
            success: true,
            experiment_id: Some(id),
            message: Some("Experiment updated successfully".to_string()),
            error: None,
            code: None,
        }
    }

    pub(super) fn duplicate() -> Self {
        Self {
            success: false,
            experiment_id: None,
            message: None,
            error: Some("Этот эксперимент уже сохранён в вашей библиотеке.".to_string()),
            code: Some(DUPLICATE_CODE.to_string()),
        }
    }

    pub(super) fn name_conflict(existing_id: String, existing_name: String) -> Self {
        Self {
            success: false,
            experiment_id: Some(existing_id),
            message: Some(existing_name),
            error: Some("Тест с таким названием уже существует в библиотеке.".to_string()),
            code: Some(NAME_CONFLICT_CODE.to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentDeleteResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentSavePayload {
    pub name: String,
    pub field_name: Option<String>,
    pub operator_name: Option<String>,
    pub well_number: Option<String>,
    pub test_id: Option<String>,
    pub original_filename: String,
    pub test_date: String,
    pub instrument_type: String,
    pub geometry: Option<String>,
    pub geometry_source: Option<String>,
    pub water_source: String,
    pub water_params: Option<Value>,
    pub fluid_type: String,
    pub test_group: String,
    pub test_sub_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub test_category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub test_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub dominant_pattern: Option<String>,
    pub metrics: Value,
    #[serde(default)]
    pub raw_points: Vec<Value>,
    pub calibration: Option<Value>,
    #[serde(default)]
    pub reagents: Vec<StoredExperimentReagent>,
    pub overwrite: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub laboratory_id: Option<String>,
    // V8 metadata round-trip fields
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub parsed_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub parse_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub time_range_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub time_range_max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub viscosity_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub pressure_max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub extra_fields: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StoredExperiment {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub name: String,
    pub field_name: Option<String>,
    pub operator_name: Option<String>,
    pub well_number: Option<String>,
    pub test_id: Option<String>,
    pub original_filename: String,
    pub test_date: String,
    pub instrument_type: String,
    pub geometry: Option<String>,
    pub geometry_source: Option<String>,
    pub water_source: String,
    pub water_params: Option<Value>,
    pub fluid_type: String,
    pub test_group: String,
    pub test_sub_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dominant_pattern: Option<String>,
    pub metrics: Value,
    pub raw_points: Vec<Value>,
    pub calibration: Option<Value>,
    pub reagents: Vec<StoredExperimentReagent>,
    pub max_viscosity: Option<i64>,
    pub avg_viscosity: Option<i64>,
    pub user: Option<StoredExperimentUser>,
    pub laboratory: Option<StoredExperimentLaboratory>,
    // V8 metadata round-trip fields
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parsed_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parse_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_range_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_range_max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viscosity_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pressure_max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra_fields: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StoredExperimentReagent {
    pub reagent_id: Option<String>,
    pub reagent_name: Option<String>,
    pub concentration: f64,
    pub unit: String,
    pub batch_number: Option<String>,
    pub production_date: Option<String>,
    pub category: Option<String>,
    pub reagent: Option<StoredReagentDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StoredReagentDescriptor {
    pub name: String,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StoredExperimentUser {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct StoredExperimentLaboratory {
    pub id: String,
    pub name: String,
}

/// Lightweight experiment summary for list/table views.
/// Excludes heavy payloads: rawPoints, metrics, calibration.
#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentListItem {
    pub id: String,
    pub created_at: String,
    pub updated_at: String,
    pub name: String,
    pub field_name: Option<String>,
    pub operator_name: Option<String>,
    pub well_number: Option<String>,
    pub test_id: Option<String>,
    pub original_filename: String,
    pub test_date: String,
    pub instrument_type: String,
    pub geometry: Option<String>,
    pub geometry_source: Option<String>,
    pub water_source: String,
    pub water_params: Option<Value>,
    pub fluid_type: String,
    pub test_group: String,
    pub test_sub_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dominant_pattern: Option<String>,
    pub max_viscosity: Option<i64>,
    pub avg_viscosity: Option<i64>,
    pub duration_seconds: Option<f64>,
    pub avg_temperature_c: Option<f64>,
    pub max_temperature_c: Option<f64>,
    pub reagents: Vec<StoredExperimentReagent>,
    pub user: Option<StoredExperimentUser>,
    pub laboratory: Option<StoredExperimentLaboratory>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LastContextResponse {
    pub field_name: Option<String>,
    pub operator_name: Option<String>,
    pub water_source: Option<String>,
    pub reagents: Vec<LastContextReagent>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LastContextReagent {
    pub reagent_id: String,
    pub reagent_name: String,
    pub concentration: f64,
    pub unit: String,
    pub batch_number: Option<String>,
    pub production_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct WaterSourcesResponse {
    pub water_sources: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentsFilterMetadataResponse {
    pub instrument_types: Vec<String>,
    pub fluid_types: Vec<String>,
    pub geometries: Vec<String>,
    pub reagent_names: Vec<String>,
    pub laboratory_names: Vec<String>,
    pub field_names: Vec<String>,
    pub water_sources: Vec<String>,
    pub test_categories: Vec<String>,
    pub test_types: Vec<String>,
}
