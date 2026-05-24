//! Shared types, constants, and response structs for experiment commands.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub(super) const DUPLICATE_CODE: &str = "DUPLICATE_ENTRY";
pub(super) const NAME_CONFLICT_CODE: &str = "NAME_CONFLICT";
pub(super) const NO_LAB_ID: &str = "__no_lab__";
/// Default userId for desktop-local experiments (no real auth session)
pub(crate) const LOCAL_USER_ID: &str = "desktop-local-admin";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum RheologyParameterSource {
    Instrument,
    Program,
}

impl Default for RheologyParameterSource {
    fn default() -> Self {
        Self::Program
    }
}

impl RheologyParameterSource {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Instrument => "instrument",
            Self::Program => "program",
        }
    }

    pub(crate) fn from_db(value: &str) -> Self {
        match value {
            "instrument" => Self::Instrument,
            _ => Self::Program,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RheologyParameterRow {
    #[serde(default)]
    pub source: RheologyParameterSource,
    pub cycle_no: i32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub time_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub end_time_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub temp_c: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub pressure_bar: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub n_prime: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[serde(rename = "kvPaSn")]
    pub kv_pasn: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[serde(rename = "kPrimePaSn")]
    pub k_prime_pasn: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[serde(rename = "kSlotPaSn")]
    pub k_slot_pasn: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[serde(rename = "kPipePaSn")]
    pub k_pipe_pasn: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub r2: Option<f64>,
    #[serde(default)]
    pub viscosities: BTreeMap<String, f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    #[serde(rename = "binghamPvPaS")]
    pub bingham_pv_pas: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bingham_yp_pa: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bingham_r2: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub calc_points: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub source_sheet: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub source_row: Option<i32>,
    #[serde(default)]
    pub units: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
#[derive(Default)]
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
    // ── Touch-point filters (PR2) ───────────────────────────────────────────
    // Precomputed at save time under FIXED defaults (threshold = 50 cP,
    // targetTime = 10 min).  The UI is explicit about this so the user
    // never confuses the library filter with their current Analysis-tab
    // threshold.  Values are sent as strings from the UI (minutes / cP);
    // an empty / whitespace string means "no filter" and is dropped
    // inside the query builder, identical to the existing range filters.
    /// Lower bound for `touchCrossingTimeMin` (minutes).
    #[serde(default)]
    pub crossing_time_min: Option<String>,
    /// Upper bound for `touchCrossingTimeMin` (minutes).
    #[serde(default)]
    pub crossing_time_max: Option<String>,
    /// Lower bound for `touchCrossingViscosityCp` (centipoise, cP).
    #[serde(default)]
    pub crossing_viscosity_min: Option<String>,
    /// Upper bound for `touchCrossingViscosityCp` (centipoise, cP).
    #[serde(default)]
    pub crossing_viscosity_max: Option<String>,
    /// Lower bound for `touchViscosityAtTargetCp` (centipoise, cP).
    #[serde(default)]
    pub viscosity_at_target_min: Option<String>,
    /// Upper bound for `touchViscosityAtTargetCp` (centipoise, cP).
    #[serde(default)]
    pub viscosity_at_target_max: Option<String>,
    /// Tri-state selector over the precomputed `touchHasCrossing` flag.
    /// Accepts `"yes"`, `"no"`, or empty / missing (= no filter).  Any other
    /// value is ignored by the query builder rather than producing an error,
    /// matching the permissive string-based contract of the other filters.
    #[serde(default)]
    pub has_crossing: Option<String>,
    /// Viscosity threshold (cP) for the touch-point filter — user input.
    ///
    /// When **set** to a positive number, the query builder leaves the
    /// precomputed `touchHasCrossing` / `touchCrossingTimeMin` columns
    /// alone and instead re-runs the smart-touch-point algorithm against
    /// each candidate experiment with this threshold.  This unlocks lab
    /// workflows where the "gel break-point" isn't the default 50 cP
    /// (e.g. crosslinked fluids often break at 500 cP).  Computation is
    /// O(N·points) per query but coarse-pruned by `maxViscosity >= threshold`
    /// so only plausibly-crossing rows hit the algorithm.
    ///
    /// When **omitted / empty / non-numeric**, the fast precomputed path
    /// for the library-fixed 50 cP threshold is used.
    #[serde(default)]
    pub viscosity_threshold: Option<String>,
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
pub struct ExperimentDetailMetaResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub experiment: Option<ExperimentDetailMeta>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ExperimentDetailMetaResponse {
    pub(super) fn ok(experiment: ExperimentDetailMeta) -> Self {
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
    #[serde(default)]
    pub rheology_source: RheologyParameterSource,
    #[serde(default)]
    pub rheology_parameters: Vec<RheologyParameterRow>,
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
    #[serde(default)]
    pub rheology_source: RheologyParameterSource,
    #[serde(default)]
    pub rheology_parameters: Vec<RheologyParameterRow>,
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

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentDetailMeta {
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
    pub calibration: Option<Value>,
    pub reagents: Vec<StoredExperimentReagent>,
    pub summary: ExperimentDetailSummary,
    pub user: Option<StoredExperimentUser>,
    pub laboratory: Option<StoredExperimentLaboratory>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parsed_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parse_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra_fields: Option<Value>,
    #[serde(default)]
    pub rheology_source: RheologyParameterSource,
    #[serde(default)]
    pub rheology_parameters: Vec<RheologyParameterRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentDetailSummary {
    pub point_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_range_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_range_max: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viscosity_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_viscosity: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avg_viscosity: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pressure_max: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RawTablePageResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<RawTablePage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl RawTablePageResponse {
    pub(super) fn ok(page: RawTablePage) -> Self {
        Self {
            success: true,
            page: Some(page),
            error: None,
        }
    }

    pub(super) fn err(error: impl Into<String>) -> Self {
        Self {
            success: false,
            page: None,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RawTablePage {
    pub experiment_id: String,
    pub total_rows: usize,
    pub page: usize,
    pub page_size: usize,
    pub total_pages: usize,
    pub has_bath_temperature: bool,
    pub rows: Vec<RawTableRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RawTableRow {
    pub index: usize,
    pub time_sec: Option<f64>,
    pub viscosity_cp: Option<f64>,
    pub temperature_c: Option<f64>,
    pub speed_rpm: Option<f64>,
    pub shear_rate_s1: Option<f64>,
    pub shear_stress_pa: Option<f64>,
    pub pressure_bar: Option<f64>,
    pub bath_temperature_c: Option<f64>,
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
    // ── Precomputed touch-point metrics (PR2) ───────────────────────────
    // Populated by the save-path / backfill described in
    // `db::touch_point_precompute`.  All fields are `Option` so list items
    // for experiments that have not yet been precomputed (pending backfill)
    // serialise without the fields, keeping the payload identical to the
    // pre-v0002 shape for those rows.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub touch_has_crossing: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub touch_crossing_time_min: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub touch_crossing_viscosity_cp: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub touch_viscosity_at_target_cp: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub touch_precompute_version: Option<i64>,
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
    /// Library-wide coverage / range stats for the touch-point precomputed
    /// columns.  Used by the UI to:
    ///   * Show "в БД: X..Y" hints beneath each touch-point range filter so
    ///     users pick sensible values instead of filtering to zero rows.
    ///   * Render a contextual empty-state when a touch-point filter hides
    ///     everything ("из 220 эксп. только 1 достиг порога 50 сП…").
    /// Computed against the WHOLE library — independent of the current
    /// filter panel selections — so the hints remain stable while the user
    /// is editing filter values.
    pub touch_point_stats: TouchPointLibraryStats,
}

/// Library-wide touch-point coverage snapshot.
///
/// All range bounds are `Option` because they're only defined when at
/// least one row has a non-NULL value for the underlying column:
///   * `crossing_*`  — populated only for rows where the smoothed
///     viscosity actually crossed the library threshold (50 cP).
///   * `viscosity_at_target_*` — populated when the experiment runs
///     long enough to have a sample at / past the 10-min target.
///
/// When the library is empty these are all `None` and
/// `total_experiments == 0`; the UI treats that as "скрыть подсказки".
#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TouchPointLibraryStats {
    /// Total experiments in the library (same as `experiments_count`).
    pub total_experiments: usize,
    /// Number of experiments whose smoothed viscosity crossed the
    /// library-fixed threshold (50 cP) — i.e. `touchHasCrossing = 1`.
    pub with_crossing_count: usize,
    /// Number of experiments that have a non-NULL
    /// `touchViscosityAtTargetCp` (i.e. the curve extends to / past
    /// the 10-min target).
    pub with_target_viscosity_count: usize,
    /// Observed minimum of `touchCrossingTimeMin` in minutes.
    pub crossing_time_min_minutes: Option<f64>,
    /// Observed maximum of `touchCrossingTimeMin` in minutes.
    pub crossing_time_max_minutes: Option<f64>,
    /// Observed minimum of `touchCrossingViscosityCp` in centipoise.
    pub crossing_viscosity_min_cp: Option<f64>,
    /// Observed maximum of `touchCrossingViscosityCp` in centipoise.
    pub crossing_viscosity_max_cp: Option<f64>,
    /// Observed minimum of `touchViscosityAtTargetCp` in centipoise.
    pub viscosity_at_target_min_cp: Option<f64>,
    /// Observed maximum of `touchViscosityAtTargetCp` in centipoise.
    pub viscosity_at_target_max_cp: Option<f64>,
}
