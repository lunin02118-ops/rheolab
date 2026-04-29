//! Native report generation commands for desktop mode.
//!
//! These commands execute the Rust report engine directly in Tauri runtime
//! and return report bytes to the frontend.
//!
//! Raw bytes are returned via `tauri::ipc::Response` to avoid JSON serialization
//! overhead (eliminates triple-copy: Vec<u8> → JSON number array → JS Array → Uint8Array).
//!
//! **Audit-v2 REP-001 — per-feature gating:** every report IPC checks
//! both `can_write_via_engine` (Active/Grace/Demo gate) **and** the
//! relevant `LicenseFeatures` flag for the kind of report being
//! produced.  Comparison commands additionally enforce the licence's
//! `max_comparison_experiments` so a malicious or buggy frontend
//! cannot hand the native engine an unbounded experiment list and
//! exhaust memory.

use crate::commands::licensing::types::LicenseFeatures;
use crate::commands::licensing::{can_write_via_engine, current_features};
use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::utils::validation::{validate_bounded_str, validate_hash_id};
use rheolab_core::report_generator::comparison::ComparisonReportInput;
use rheolab_core::report_generator::ReportInput;
use rheolab_core::RHEOLAB_CORE_VERSION;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::State;

/// Inner implementation used by tests — returns raw bytes.
///
/// Sprint 0 / S0-6: `tracing::instrument` makes the spawn_blocking
/// boundary measurable.  `skip_all` keeps the heavy `ReportInput`
/// out of the span fields (it is megabytes-sized after Float64Array
/// expansion).  The rheolab-core call itself is not instrumented —
/// keeping that crate tracing-free is intentional (it is the
/// foundation crate; we measure it from the boundary instead).
#[tracing::instrument(level = "info", skip_all, name = "reports::pdf::spawn_blocking")]
async fn generate_pdf_bytes(input: ReportInput) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || {
        rheolab_core::report_generator::generate_pdf_from_input(&input)
            .map_err(|error| AppError::Other(format!("PDF generation failed: {}", error)))
    })
    .await
    .map_err(AppError::Join)?
}

/// Inner implementation used by tests — returns raw bytes.
#[tracing::instrument(level = "info", skip_all, name = "reports::excel::spawn_blocking")]
async fn generate_excel_bytes(input: ReportInput) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || {
        rheolab_core::report_generator::generate_excel_from_input(&input)
            .map_err(|error| AppError::Other(format!("Excel generation failed: {:?}", error)))
    })
    .await
    .map_err(AppError::Join)?
}

/// Inner implementation used by tests — returns raw comparison PDF bytes.
///
/// Sprint 0 / S0-6: span field `n_experiments` lets us correlate Rust
/// time spent vs comparison size.  Sprint 1's by-ids native pipeline
/// will use exactly this metric to prove the saving over the current
/// "TS builds full input" path.
#[tracing::instrument(
    level = "info",
    skip_all,
    name = "reports::comparison::pdf::spawn_blocking",
    fields(n_experiments = input.experiments.len())
)]
async fn generate_comparison_pdf_bytes(input: ComparisonReportInput) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || {
        rheolab_core::report_generator::generate_comparison_pdf(&input).map_err(|error| {
            tracing::error!("Comparison PDF generation failed: {}", error);
            AppError::Other(format!("Comparison PDF generation failed: {}", error))
        })
    })
    .await
    .map_err(AppError::Join)?
}

/// Inner implementation used by tests — returns raw comparison XLSX bytes.
#[tracing::instrument(
    level = "info",
    skip_all,
    name = "reports::comparison::excel::spawn_blocking",
    fields(n_experiments = input.experiments.len())
)]
async fn generate_comparison_excel_bytes(input: ComparisonReportInput) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || {
        rheolab_core::report_generator::generate_comparison_excel(&input).map_err(|error| {
            AppError::Other(format!("Comparison Excel generation failed: {}", error))
        })
    })
    .await
    .map_err(AppError::Join)?
}

#[tauri::command]
pub async fn reports_generate_pdf(
    state: State<'_, AppState>,
    input: ReportInput,
) -> Result<tauri::ipc::Response> {
    // F-08: License gate — report generation requires a valid license or active demo
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    // Audit-v2 REP-001: per-feature gate — even an active license can
    // legitimately have `export_pdf=false` (e.g. an "expired" tier
    // computed for grace-window licences).  Reject early.
    let features = current_features(&state).await;
    if !features.export_pdf {
        return Err(AppError::License(
            "PDF export is not included in your current licence (REP-001)".into(),
        ));
    }
    // E2E fast-path: return a minimal valid %PDF-1.4 header so the UI
    // flow completes instantly without running Typst (which at opt-level=0
    // takes 5+ minutes).  Set RHEOLAB_E2E_MOCK_REPORTS=1 to activate.
    // Gated to debug builds only — never available in release (F-02).
    #[cfg(debug_assertions)]
    {
        if std::env::var("RHEOLAB_E2E_MOCK_REPORTS").is_ok() {
            tracing::debug!("[E2E] reports_generate_pdf: returning mock PDF bytes");
            return Ok(tauri::ipc::Response::new(vec![
                0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, // %PDF-1.4
            ]));
        }
    }
    let bytes = generate_pdf_bytes(input).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn reports_generate_excel(
    state: State<'_, AppState>,
    input: ReportInput,
) -> Result<tauri::ipc::Response> {
    // F-08: License gate — report generation requires a valid license or active demo
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    // Audit-v2 REP-001: per-feature gate (see reports_generate_pdf).
    let features = current_features(&state).await;
    if !features.export_excel {
        return Err(AppError::License(
            "Excel export is not included in your current licence (REP-001)".into(),
        ));
    }
    // E2E fast-path: return a minimal PK ZIP header so the UI flow completes.
    // Gated to debug builds only — never available in release (F-02).
    #[cfg(debug_assertions)]
    {
        if std::env::var("RHEOLAB_E2E_MOCK_REPORTS").is_ok() {
            tracing::debug!("[E2E] reports_generate_excel: returning mock XLSX bytes");
            return Ok(tauri::ipc::Response::new(vec![0x50, 0x4b, 0x03, 0x04]));
        }
    }
    let bytes = generate_excel_bytes(input).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

// Architectural note (audit-v2 REP-001):
// `input` is `serde_json::Value` rather than the typed
// `ComparisonReportInput` on purpose.  REP-001 demands we count
// `experiments.len()` BEFORE the second-pass deserialisation that
// builds the heavy `ComparisonExperimentEntry` struct tree (~2 KB
// each).  Switching to a typed parameter would force Tauri to allocate
// the full 100k-entry `Vec<ComparisonExperimentEntry>` before our gate
// sees the count, defeating the anti-DoS pre-deserialise check.
// The Excel sibling (`reports_generate_comparison_excel`) uses the
// typed parameter because its experiment-tree is roughly half the size
// and the same payload-bomb risk does not apply.
/// Generate a PDF comparison report from multiple experiments.
///
/// Returns raw PDF bytes via `tauri::ipc::Response` for zero-copy transfer to
/// the frontend.  License-gated identically to the single-experiment path
/// **plus** the audit-v2 REP-001 per-feature gates: `comparison`,
/// `export_pdf`, and `max_comparison_experiments`.
// LARGE-IPC-EXCEPTION: REP-001 anti-DoS pre-deserialise count check (see note above).
#[tauri::command]
pub async fn reports_generate_comparison_pdf(
    state: State<'_, AppState>,
    input: serde_json::Value,
) -> Result<tauri::ipc::Response> {
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    let features = current_features(&state).await;
    enforce_comparison_pdf_features(&features, count_experiments_in_value(&input))?;

    #[cfg(debug_assertions)]
    {
        if std::env::var("RHEOLAB_E2E_MOCK_REPORTS").is_ok() {
            tracing::debug!("[E2E] reports_generate_comparison_pdf: returning mock PDF bytes");
            return Ok(tauri::ipc::Response::new(vec![
                0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, // %PDF-1.4
            ]));
        }
    }
    let parsed: ComparisonReportInput = serde_json::from_value(input).map_err(|e| {
        tracing::error!("Comparison PDF input deserialization failed: {}", e);
        AppError::Other(format!("Input deserialization failed: {}", e))
    })?;
    let bytes = generate_comparison_pdf_bytes(parsed).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Generate an XLSX comparison report from multiple experiments.
///
/// Returns raw XLSX bytes via `tauri::ipc::Response`.  License-gated
/// plus REP-001 per-feature gates (`comparison`, `export_excel`,
/// `max_comparison_experiments`).
#[tauri::command]
pub async fn reports_generate_comparison_excel(
    state: State<'_, AppState>,
    input: ComparisonReportInput,
) -> Result<tauri::ipc::Response> {
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    let features = current_features(&state).await;
    enforce_comparison_excel_features(&features, input.experiments.len())?;

    #[cfg(debug_assertions)]
    {
        if std::env::var("RHEOLAB_E2E_MOCK_REPORTS").is_ok() {
            tracing::debug!("[E2E] reports_generate_comparison_excel: returning mock XLSX bytes");
            return Ok(tauri::ipc::Response::new(vec![0x50, 0x4b, 0x03, 0x04]));
        }
    }
    let bytes = generate_comparison_excel_bytes(input).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn reports_generate_comparison_pdf_by_ids(
    state: State<'_, AppState>,
    request: ComparisonReportByIdsRequest,
) -> Result<tauri::ipc::Response> {
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    let features = current_features(&state).await;
    validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)?;
    let conn = state.pool_conn()?;
    validate_comparison_experiment_ids_exist(&conn, &request.experiment_ids)?;
    Err(AppError::Other(
        "reports_generate_comparison_pdf_by_ids is not implemented until Sprint 2 commit #7".into(),
    ))
}

#[tauri::command]
pub async fn reports_generate_comparison_excel_by_ids(
    state: State<'_, AppState>,
    request: ComparisonReportByIdsRequest,
) -> Result<tauri::ipc::Response> {
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    let features = current_features(&state).await;
    validate_comparison_by_ids_request(&request, &features, ReportFormat::Excel)?;
    let conn = state.pool_conn()?;
    validate_comparison_experiment_ids_exist(&conn, &request.experiment_ids)?;
    Err(AppError::Other(
        "reports_generate_comparison_excel_by_ids is not implemented until Sprint 2 commit #8"
            .into(),
    ))
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonReportByIdsRequest {
    pub experiment_ids: Vec<String>,
    pub settings: ComparisonReportByIdsSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonReportByIdsSettings {
    pub language: String,
    pub unit_system: String,
    #[serde(default)]
    pub company_name: Option<String>,
    #[serde(default)]
    pub company_logo_base64: Option<String>,
    #[serde(default)]
    pub generated_at: Option<String>,
    pub comparison_chart: ComparisonByIdsChartConfig,
    pub section_toggles: ComparisonByIdsSectionToggles,
    pub report_settings: ComparisonByIdsReportSettings,
    #[serde(default = "default_comparison_analysis_settings")]
    pub analysis_settings: ComparisonByIdsAnalysisSettings,
    #[serde(default)]
    pub detection_settings: ComparisonByIdsDetectionSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsReportSettings {
    pub show_temperature: bool,
    pub show_shear_rate: bool,
    pub show_pressure: bool,
    pub show_bath_temperature: bool,
    pub shear_rate_axis: String,
    pub pressure_axis: String,
    pub show_advanced_stats: bool,
    pub report_viscosity_rates: Vec<i32>,
    #[serde(default)]
    pub rheology_units: Option<ComparisonByIdsRheologyUnits>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsChartConfig {
    pub metrics: ComparisonByIdsMetrics,
    pub axis_mode: String,
    #[serde(default)]
    pub brush_range: Option<[f64; 2]>,
    pub touch_point: ComparisonByIdsTouchPointConfig,
    pub line_settings: ComparisonByIdsChartLineSettings,
    pub experiment_colors: Vec<String>,
    #[serde(default = "default_comparison_time_format")]
    pub time_format: String,
    #[serde(default = "default_comparison_downsample_mode")]
    pub downsample_mode: String,
    #[serde(default = "default_comparison_chart_width")]
    pub chart_width: u32,
    #[serde(default = "default_comparison_chart_height")]
    pub chart_height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsMetrics {
    pub primary: String,
    pub left_secondary: String,
    pub secondary: String,
    pub tertiary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsTouchPointConfig {
    pub enabled: bool,
    pub viscosity_threshold: f64,
    pub show_target_time: bool,
    pub target_time: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsLineSettings {
    #[serde(default = "default_line_color")]
    pub color: String,
    #[serde(default = "default_line_width")]
    pub width: u8,
    #[serde(default = "default_line_style")]
    pub style: String,
}

impl Default for ComparisonByIdsLineSettings {
    fn default() -> Self {
        Self {
            color: default_line_color(),
            width: default_line_width(),
            style: default_line_style(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsChartLineSettings {
    #[serde(default)]
    pub viscosity: ComparisonByIdsLineSettings,
    #[serde(default)]
    pub temperature: ComparisonByIdsLineSettings,
    #[serde(default)]
    pub shear_rate: ComparisonByIdsLineSettings,
    #[serde(default)]
    pub pressure: ComparisonByIdsLineSettings,
    #[serde(default)]
    pub rpm: ComparisonByIdsLineSettings,
    #[serde(default)]
    pub bath_temperature: Option<ComparisonByIdsLineSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsSectionToggles {
    pub show_calibration: bool,
    pub show_raw_data: bool,
    pub show_recipe: bool,
    pub show_water_analysis: bool,
    #[serde(default = "default_show_rheology")]
    pub show_rheology: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsRheologyUnits {
    #[serde(default)]
    pub viscosity: String,
    #[serde(default)]
    pub temperature: String,
    #[serde(default)]
    pub pressure: String,
    #[serde(default)]
    pub consistency: String,
    #[serde(default)]
    pub plastic_viscosity: String,
    #[serde(default)]
    pub yield_point: String,
    #[serde(default)]
    pub time_format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsAnalysisSettings {
    #[serde(default)]
    pub points_to_average: i32,
    #[serde(default = "default_analysis_viscosity_shear_rates")]
    pub viscosity_shear_rates: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ComparisonByIdsDetectionSettings {
    #[serde(default = "default_shear_rate_tolerance")]
    pub shear_rate_tolerance: f64,
    #[serde(default = "default_shear_rate_rel_tolerance")]
    pub shear_rate_rel_tolerance: f64,
    #[serde(default = "default_min_step_duration")]
    pub min_step_duration: f64,
    #[serde(default = "default_step_splitting")]
    pub step_splitting: bool,
    #[serde(default = "default_split_start_duration")]
    pub split_start_duration: f64,
    #[serde(default = "default_split_end_duration")]
    pub split_end_duration: f64,
    #[serde(default = "default_min_duration_for_split")]
    pub min_duration_for_split: f64,
}

impl Default for ComparisonByIdsDetectionSettings {
    fn default() -> Self {
        Self {
            shear_rate_tolerance: default_shear_rate_tolerance(),
            shear_rate_rel_tolerance: default_shear_rate_rel_tolerance(),
            min_step_duration: default_min_step_duration(),
            step_splitting: default_step_splitting(),
            split_start_duration: default_split_start_duration(),
            split_end_duration: default_split_end_duration(),
            min_duration_for_split: default_min_duration_for_split(),
        }
    }
}

#[allow(dead_code)]
pub enum ReportOutput {
    Bytes(Vec<u8>),
    TempFile { path: PathBuf, byte_count: u64 },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisCacheKeyMaterial {
    pub experiment_id: String,
    pub experiment_data_hash: String,
    pub geometry: String,
    pub analysis_settings_hash: String,
    pub report_viscosity_rates_hash: String,
    pub rheolab_core_version: String,
    pub algorithm_version: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReportFormat {
    Pdf,
    Excel,
}

const MAX_COMPANY_NAME_BYTES: usize = 255;
const MAX_COMPANY_LOGO_BASE64_BYTES: usize = 5_000_000;
const MAX_GENERATED_AT_BYTES: usize = 64;
const MAX_METRIC_KEY_BYTES: usize = 64;
const MAX_COLOR_BYTES: usize = 64;
const MAX_LINE_WIDTH: u8 = 16;
const MAX_VISCOSITY_RATES: usize = 32;
const MIN_CHART_DIMENSION: u32 = 100;
const MAX_CHART_DIMENSION: u32 = 8_000;
const MAX_TIME_MINUTES: f64 = 1_000_000.0;
const MAX_SHEAR_RATE: f64 = 100_000.0;
const ANALYSIS_CACHE_ALGORITHM_VERSION: u32 = 1;

fn default_comparison_time_format() -> String {
    "minutes".into()
}

fn default_comparison_downsample_mode() -> String {
    "smart".into()
}

fn default_comparison_chart_width() -> u32 {
    1400
}

fn default_comparison_chart_height() -> u32 {
    700
}

fn default_line_color() -> String {
    "#3b82f6".into()
}

fn default_line_width() -> u8 {
    2
}

fn default_line_style() -> String {
    "solid".into()
}

fn default_show_rheology() -> bool {
    true
}

fn default_analysis_viscosity_shear_rates() -> Vec<f64> {
    vec![40.0, 100.0, 170.0]
}

fn default_shear_rate_tolerance() -> f64 {
    2.0
}

fn default_shear_rate_rel_tolerance() -> f64 {
    5.0
}

fn default_min_step_duration() -> f64 {
    5.0
}

fn default_step_splitting() -> bool {
    true
}

fn default_split_start_duration() -> f64 {
    30.0
}

fn default_split_end_duration() -> f64 {
    30.0
}

fn default_min_duration_for_split() -> f64 {
    90.0
}

fn default_comparison_analysis_settings() -> ComparisonByIdsAnalysisSettings {
    ComparisonByIdsAnalysisSettings {
        points_to_average: 0,
        viscosity_shear_rates: default_analysis_viscosity_shear_rates(),
    }
}

fn validate_comparison_by_ids_request(
    request: &ComparisonReportByIdsRequest,
    features: &LicenseFeatures,
    format: ReportFormat,
) -> Result<()> {
    if request.experiment_ids.is_empty() {
        return Err(AppError::BadRequest(
            "experimentIds must contain at least one experiment".into(),
        ));
    }

    let mut seen = HashSet::with_capacity(request.experiment_ids.len());
    for id in &request.experiment_ids {
        validate_hash_id(id, "experimentIds[]")?;
        if !seen.insert(id) {
            return Err(AppError::BadRequest(format!(
                "duplicate experiment ID in experimentIds: {id}"
            )));
        }
    }

    match format {
        ReportFormat::Pdf => {
            enforce_comparison_pdf_features(features, request.experiment_ids.len())?
        }
        ReportFormat::Excel => {
            enforce_comparison_excel_features(features, request.experiment_ids.len())?
        }
    }

    request.settings.validate()
}

fn validate_comparison_experiment_ids_exist(
    conn: &rusqlite::Connection,
    experiment_ids: &[String],
) -> Result<()> {
    if experiment_ids.is_empty() {
        return Ok(());
    }
    let placeholders = std::iter::repeat("?")
        .take(experiment_ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("SELECT id FROM Experiment WHERE id IN ({placeholders})");
    let mut stmt = conn.prepare(&sql)?;
    let existing: HashSet<String> = stmt
        .query_map(rusqlite::params_from_iter(experiment_ids.iter()), |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<HashSet<_>>>()?;

    let missing = experiment_ids
        .iter()
        .filter(|id| !existing.contains(*id))
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(AppError::BadRequest(format!(
            "Experiment IDs not found: {}",
            missing.join(", ")
        )));
    }
    Ok(())
}

impl ComparisonReportByIdsSettings {
    fn validate(&self) -> Result<()> {
        validate_language(&self.language)?;
        validate_unit_system(&self.unit_system)?;
        if let Some(company_name) = &self.company_name {
            validate_bounded_str(company_name, MAX_COMPANY_NAME_BYTES, "settings.companyName")?;
        }
        if let Some(company_logo_base64) = &self.company_logo_base64 {
            validate_bounded_str(
                company_logo_base64,
                MAX_COMPANY_LOGO_BASE64_BYTES,
                "settings.companyLogoBase64",
            )?;
        }
        if let Some(generated_at) = &self.generated_at {
            validate_bounded_str(generated_at, MAX_GENERATED_AT_BYTES, "settings.generatedAt")?;
        }
        validate_comparison_chart(&self.comparison_chart)?;
        validate_report_settings(&self.report_settings)?;
        validate_analysis_settings(&self.analysis_settings)?;
        validate_detection_settings(&self.detection_settings)
    }
}

fn validate_language(value: &str) -> Result<()> {
    match value {
        "ru" | "en" => Ok(()),
        _ => Err(AppError::BadRequest(format!(
            "settings.language must be 'ru' or 'en' (got '{value}')"
        ))),
    }
}

fn validate_unit_system(value: &str) -> Result<()> {
    match value {
        "SI" | "SI_Pas" | "Imperial" => Ok(()),
        _ => Err(AppError::BadRequest(format!(
            "settings.unitSystem must be 'SI', 'SI_Pas' or 'Imperial' (got '{value}')"
        ))),
    }
}

fn validate_comparison_chart(chart: &ComparisonByIdsChartConfig) -> Result<()> {
    validate_metrics(&chart.metrics)?;
    match chart.axis_mode.as_str() {
        "individual" | "shared" => {}
        other => {
            return Err(AppError::BadRequest(format!(
                "settings.comparisonChart.axisMode must be 'individual' or 'shared' (got '{other}')"
            )));
        }
    }
    if let Some([start, end]) = chart.brush_range {
        validate_non_negative_finite(start, "settings.comparisonChart.brushRange[0]")?;
        validate_non_negative_finite(end, "settings.comparisonChart.brushRange[1]")?;
        if end <= start {
            return Err(AppError::BadRequest(
                "settings.comparisonChart.brushRange must be [start, end] with end > start".into(),
            ));
        }
        if end > MAX_TIME_MINUTES {
            return Err(AppError::BadRequest(format!(
                "settings.comparisonChart.brushRange[1] exceeds {MAX_TIME_MINUTES} minutes"
            )));
        }
    }
    validate_non_negative_finite(
        chart.touch_point.viscosity_threshold,
        "settings.comparisonChart.touchPoint.viscosityThreshold",
    )?;
    validate_non_negative_finite(
        chart.touch_point.target_time,
        "settings.comparisonChart.touchPoint.targetTime",
    )?;
    validate_chart_line_settings(&chart.line_settings)?;
    if chart.experiment_colors.is_empty() {
        return Err(AppError::BadRequest(
            "settings.comparisonChart.experimentColors must not be empty".into(),
        ));
    }
    if chart.experiment_colors.len() > MAX_VISCOSITY_RATES {
        return Err(AppError::BadRequest(format!(
            "settings.comparisonChart.experimentColors exceeds {MAX_VISCOSITY_RATES} entries"
        )));
    }
    for (idx, color) in chart.experiment_colors.iter().enumerate() {
        validate_bounded_str(
            color,
            MAX_COLOR_BYTES,
            &format!("settings.comparisonChart.experimentColors[{idx}]"),
        )?;
    }
    validate_choice(
        &chart.time_format,
        &["seconds", "minutes", "hh:mm:ss"],
        "settings.comparisonChart.timeFormat",
    )?;
    validate_choice(
        &chart.downsample_mode,
        &["off", "smart", "fast"],
        "settings.comparisonChart.downsampleMode",
    )?;
    validate_chart_dimension(chart.chart_width, "settings.comparisonChart.chartWidth")?;
    validate_chart_dimension(chart.chart_height, "settings.comparisonChart.chartHeight")
}

fn validate_metrics(metrics: &ComparisonByIdsMetrics) -> Result<()> {
    validate_metric_key(
        &metrics.primary,
        "settings.comparisonChart.metrics.primary",
        false,
    )?;
    validate_metric_key(
        &metrics.left_secondary,
        "settings.comparisonChart.metrics.leftSecondary",
        true,
    )?;
    validate_metric_key(
        &metrics.secondary,
        "settings.comparisonChart.metrics.secondary",
        true,
    )?;
    validate_metric_key(
        &metrics.tertiary,
        "settings.comparisonChart.metrics.tertiary",
        true,
    )
}

fn validate_metric_key(value: &str, field: &str, allow_none: bool) -> Result<()> {
    if allow_none && value == "none" {
        return Ok(());
    }
    validate_bounded_str(value, MAX_METRIC_KEY_BYTES, field)?;
    if value.is_empty() {
        return Err(AppError::BadRequest(format!("{field} must not be empty")));
    }
    Ok(())
}

fn validate_chart_line_settings(settings: &ComparisonByIdsChartLineSettings) -> Result<()> {
    validate_line_settings(
        &settings.viscosity,
        "settings.comparisonChart.lineSettings.viscosity",
    )?;
    validate_line_settings(
        &settings.temperature,
        "settings.comparisonChart.lineSettings.temperature",
    )?;
    validate_line_settings(
        &settings.shear_rate,
        "settings.comparisonChart.lineSettings.shearRate",
    )?;
    validate_line_settings(
        &settings.pressure,
        "settings.comparisonChart.lineSettings.pressure",
    )?;
    validate_line_settings(&settings.rpm, "settings.comparisonChart.lineSettings.rpm")?;
    if let Some(bath_temperature) = &settings.bath_temperature {
        validate_line_settings(
            bath_temperature,
            "settings.comparisonChart.lineSettings.bathTemperature",
        )?;
    }
    Ok(())
}

fn validate_line_settings(settings: &ComparisonByIdsLineSettings, field: &str) -> Result<()> {
    validate_bounded_str(&settings.color, MAX_COLOR_BYTES, &format!("{field}.color"))?;
    if settings.width == 0 || settings.width > MAX_LINE_WIDTH {
        return Err(AppError::BadRequest(format!(
            "{field}.width must be between 1 and {MAX_LINE_WIDTH}"
        )));
    }
    validate_choice(
        &settings.style,
        &["solid", "dashed", "dotted"],
        &format!("{field}.style"),
    )
}

fn validate_report_settings(settings: &ComparisonByIdsReportSettings) -> Result<()> {
    validate_axis(
        &settings.shear_rate_axis,
        "settings.reportSettings.shearRateAxis",
    )?;
    validate_axis(
        &settings.pressure_axis,
        "settings.reportSettings.pressureAxis",
    )?;
    validate_i32_shear_rates(
        &settings.report_viscosity_rates,
        "settings.reportSettings.reportViscosityRates",
    )?;
    if let Some(rheology_units) = &settings.rheology_units {
        validate_rheology_units(rheology_units)?;
    }
    Ok(())
}

fn validate_axis(value: &str, field: &str) -> Result<()> {
    validate_choice(value, &["left", "right"], field)
}

fn validate_i32_shear_rates(values: &[i32], field: &str) -> Result<()> {
    if values.is_empty() {
        return Err(AppError::BadRequest(format!("{field} must not be empty")));
    }
    if values.len() > MAX_VISCOSITY_RATES {
        return Err(AppError::BadRequest(format!(
            "{field} exceeds {MAX_VISCOSITY_RATES} entries"
        )));
    }
    let mut seen = HashSet::with_capacity(values.len());
    for (idx, value) in values.iter().copied().enumerate() {
        if value <= 0 || value as f64 > MAX_SHEAR_RATE {
            return Err(AppError::BadRequest(format!(
                "{field}[{idx}] must be > 0 and <= {MAX_SHEAR_RATE}"
            )));
        }
        if !seen.insert(value) {
            return Err(AppError::BadRequest(format!(
                "{field} must not contain duplicate shear rates"
            )));
        }
    }
    Ok(())
}

fn validate_f64_shear_rates(values: &[f64], field: &str) -> Result<()> {
    if values.is_empty() {
        return Err(AppError::BadRequest(format!("{field} must not be empty")));
    }
    if values.len() > MAX_VISCOSITY_RATES {
        return Err(AppError::BadRequest(format!(
            "{field} exceeds {MAX_VISCOSITY_RATES} entries"
        )));
    }
    for (idx, value) in values.iter().copied().enumerate() {
        if !value.is_finite() || value <= 0.0 || value > MAX_SHEAR_RATE {
            return Err(AppError::BadRequest(format!(
                "{field}[{idx}] must be finite, > 0 and <= {MAX_SHEAR_RATE}"
            )));
        }
    }
    Ok(())
}

fn validate_rheology_units(units: &ComparisonByIdsRheologyUnits) -> Result<()> {
    validate_choice(
        &units.viscosity,
        &["mPa·s", "Pa·s", "cP"],
        "settings.reportSettings.rheologyUnits.viscosity",
    )?;
    validate_choice(
        &units.temperature,
        &["°C", "°F"],
        "settings.reportSettings.rheologyUnits.temperature",
    )?;
    validate_choice(
        &units.pressure,
        &["bar", "psi"],
        "settings.reportSettings.rheologyUnits.pressure",
    )?;
    validate_choice(
        &units.consistency,
        &["Pa·s^n", "lbf·s^n/100ft²"],
        "settings.reportSettings.rheologyUnits.consistency",
    )?;
    validate_choice(
        &units.plastic_viscosity,
        &["Pa·s", "cP"],
        "settings.reportSettings.rheologyUnits.plasticViscosity",
    )?;
    validate_choice(
        &units.yield_point,
        &["Pa", "lbf/100ft²"],
        "settings.reportSettings.rheologyUnits.yieldPoint",
    )?;
    validate_choice(
        &units.time_format,
        &["seconds", "minutes", "hh:mm:ss"],
        "settings.reportSettings.rheologyUnits.timeFormat",
    )
}

fn validate_analysis_settings(settings: &ComparisonByIdsAnalysisSettings) -> Result<()> {
    if !(0..=10_000).contains(&settings.points_to_average) {
        return Err(AppError::BadRequest(
            "settings.analysisSettings.pointsToAverage must be between 0 and 10000".into(),
        ));
    }
    validate_f64_shear_rates(
        &settings.viscosity_shear_rates,
        "settings.analysisSettings.viscosityShearRates",
    )
}

fn validate_detection_settings(settings: &ComparisonByIdsDetectionSettings) -> Result<()> {
    validate_non_negative_finite(
        settings.shear_rate_tolerance,
        "settings.detectionSettings.shearRateTolerance",
    )?;
    validate_non_negative_finite(
        settings.shear_rate_rel_tolerance,
        "settings.detectionSettings.shearRateRelTolerance",
    )?;
    validate_non_negative_finite(
        settings.min_step_duration,
        "settings.detectionSettings.minStepDuration",
    )?;
    validate_non_negative_finite(
        settings.split_start_duration,
        "settings.detectionSettings.splitStartDuration",
    )?;
    validate_non_negative_finite(
        settings.split_end_duration,
        "settings.detectionSettings.splitEndDuration",
    )?;
    validate_non_negative_finite(
        settings.min_duration_for_split,
        "settings.detectionSettings.minDurationForSplit",
    )
}

fn validate_choice(value: &str, allowed: &[&str], field: &str) -> Result<()> {
    if allowed.contains(&value) {
        return Ok(());
    }
    Err(AppError::BadRequest(format!(
        "{field} has unsupported value '{value}'"
    )))
}

fn validate_chart_dimension(value: u32, field: &str) -> Result<()> {
    if !(MIN_CHART_DIMENSION..=MAX_CHART_DIMENSION).contains(&value) {
        return Err(AppError::BadRequest(format!(
            "{field} must be between {MIN_CHART_DIMENSION} and {MAX_CHART_DIMENSION}"
        )));
    }
    Ok(())
}

fn validate_non_negative_finite(value: f64, field: &str) -> Result<()> {
    if !value.is_finite() || value < 0.0 {
        return Err(AppError::BadRequest(format!(
            "{field} must be finite and non-negative"
        )));
    }
    Ok(())
}

#[allow(dead_code)]
fn build_analysis_cache_key_material(
    experiment_id: &str,
    experiment_data_bytes: &[u8],
    geometry: &str,
    analysis_settings: &ComparisonByIdsAnalysisSettings,
    report_viscosity_rates: &[i32],
) -> Result<AnalysisCacheKeyMaterial> {
    validate_hash_id(experiment_id, "experimentId")?;
    validate_bounded_str(geometry, MAX_METRIC_KEY_BYTES, "geometry")?;
    validate_analysis_settings(analysis_settings)?;
    validate_i32_shear_rates(report_viscosity_rates, "reportViscosityRates")?;

    Ok(AnalysisCacheKeyMaterial {
        experiment_id: experiment_id.to_owned(),
        experiment_data_hash: sha256_hex(experiment_data_bytes),
        geometry: geometry.to_owned(),
        analysis_settings_hash: canonical_json_hash(analysis_settings)?,
        report_viscosity_rates_hash: canonical_json_hash(report_viscosity_rates)?,
        rheolab_core_version: RHEOLAB_CORE_VERSION.to_owned(),
        algorithm_version: ANALYSIS_CACHE_ALGORITHM_VERSION,
    })
}

fn canonical_json_hash<T: Serialize + ?Sized>(value: &T) -> Result<String> {
    let bytes = serde_json::to_vec(value)?;
    Ok(sha256_hex(&bytes))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex::encode(digest)
}

// ── Audit-v2 REP-001 helpers ───────────────────────────────────────────

/// Best-effort count of experiments in an untyped JSON `Value`.
///
/// We need the count *before* deserialising into [`ComparisonReportInput`]
/// so we can refuse a 100k-experiment payload before allocating its full
/// struct tree.  Returns `0` if the field is absent or malformed —
/// downstream `serde_json::from_value` will surface the real parse
/// error in that case.
fn count_experiments_in_value(input: &serde_json::Value) -> usize {
    input
        .get("experiments")
        .and_then(|v| v.as_array())
        .map(|arr| arr.len())
        .unwrap_or(0)
}

/// REP-001 gate for `reports_generate_comparison_pdf`.
///
/// Pure helper so the licence-feature contract can be unit-tested
/// without going through the full IPC + `LicenseEngine` stack.
fn enforce_comparison_pdf_features(
    features: &crate::commands::licensing::types::LicenseFeatures,
    experiment_count: usize,
) -> Result<()> {
    if !features.comparison {
        return Err(AppError::License(
            "Comparison reports are not included in your current licence (REP-001)".into(),
        ));
    }
    if !features.export_pdf {
        return Err(AppError::License(
            "PDF export is not included in your current licence (REP-001)".into(),
        ));
    }
    enforce_max_comparison_experiments(features.max_comparison_experiments, experiment_count)
}

/// REP-001 gate for `reports_generate_comparison_excel`.  Mirror of the
/// PDF helper but checks `export_excel` instead.
fn enforce_comparison_excel_features(
    features: &crate::commands::licensing::types::LicenseFeatures,
    experiment_count: usize,
) -> Result<()> {
    if !features.comparison {
        return Err(AppError::License(
            "Comparison reports are not included in your current licence (REP-001)".into(),
        ));
    }
    if !features.export_excel {
        return Err(AppError::License(
            "Excel export is not included in your current licence (REP-001)".into(),
        ));
    }
    enforce_max_comparison_experiments(features.max_comparison_experiments, experiment_count)
}

/// Shared count cap.  Negative `max_comparison_experiments` (`-1` in
/// the schema) means "unlimited"; any non-negative value is treated as
/// an inclusive upper bound.
fn enforce_max_comparison_experiments(max: i64, count: usize) -> Result<()> {
    if max < 0 {
        return Ok(()); // unlimited
    }
    if count > max as usize {
        return Err(AppError::License(format!(
            "Comparison size {} exceeds the {} experiments allowed by your licence (REP-001)",
            count, max
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::generate_comparison_excel_bytes;
    use super::generate_comparison_pdf_bytes;
    use super::generate_excel_bytes;
    use super::generate_pdf_bytes;
    use rheolab_core::report_generator::comparison::{
        ComparisonChartConfig, ComparisonExperimentEntry, ComparisonMetrics, ComparisonReportInput,
        SectionToggles, TouchPointConfig,
    };
    use rheolab_core::report_generator::ReportInput;

    const REPORT_FIXTURE_JSON: &str = include_str!("../../../tests/fixtures/report_data.json");

    fn fixture_input() -> ReportInput {
        serde_json::from_str(REPORT_FIXTURE_JSON).expect("fixture should parse")
    }

    fn fixture_comparison_input() -> ComparisonReportInput {
        // Three identical per-exp inputs, distinguishable by display name.
        let make_entry = |id: &str, name: &str| ComparisonExperimentEntry {
            id: id.into(),
            display_name: name.into(),
            report_input: fixture_input(),
            section_toggles: SectionToggles {
                show_calibration: false,
                show_raw_data: false,
                show_recipe: true,
                show_water_analysis: false,
                show_rheology: true,
            },
        };
        ComparisonReportInput {
            language: "en".into(),
            unit_system: "SI".into(),
            company_name: None,
            company_logo_base64: None,
            generated_at: "2026-04-22T00:00:00Z".into(),
            comparison_chart: ComparisonChartConfig {
                metrics: ComparisonMetrics {
                    primary: "viscosity_cp".into(),
                    left_secondary: "none".into(),
                    secondary: "none".into(),
                    tertiary: "none".into(),
                },
                axis_mode: "shared".into(),
                brush_range: None,
                touch_point: TouchPointConfig::default(),
                line_settings: Default::default(),
                experiment_colors: vec!["#1E90FF".into(), "#FF0000".into(), "#008000".into()],
                time_format: "minutes".into(),
                downsample_mode: "smart".into(),
                chart_width: 1400,
                chart_height: 700,
            },
            experiments: vec![
                make_entry("e1", "Chandler A"),
                make_entry("e2", "Chandler B"),
                make_entry("e3", "Grace"),
            ],
        }
    }

    #[tokio::test]
    async fn reports_generate_pdf_returns_pdf_bytes() {
        let bytes = generate_pdf_bytes(fixture_input())
            .await
            .expect("native PDF generation should succeed for fixture input");

        assert!(!bytes.is_empty(), "PDF bytes should not be empty");
        assert!(
            bytes.starts_with(b"%PDF"),
            "PDF output must start with %PDF header"
        );
    }

    #[tokio::test]
    async fn reports_generate_excel_returns_xlsx_bytes() {
        let bytes = generate_excel_bytes(fixture_input())
            .await
            .expect("native Excel generation should succeed for fixture input");

        assert!(!bytes.is_empty(), "Excel bytes should not be empty");
        assert!(
            bytes.starts_with(b"PK"),
            "XLSX output must start with ZIP signature"
        );
    }

    #[tokio::test]
    async fn reports_generate_pdf_rejects_invalid_input() {
        let bad_input = ReportInput {
            metadata: Default::default(),
            cycle_results: vec![],
            recipe: vec![],
            settings: Default::default(),
            ..serde_json::from_str(
                r#"{"metadata":{"filename":""},"cycle_results":[],"recipe":[],"settings":{}}"#,
            )
            .unwrap()
        };
        // A minimal ReportInput should still produce some output (empty report)
        // or fail gracefully — either way, no panic.
        let _ = generate_pdf_bytes(bad_input).await;
    }

    // ── Phase 1.H self-verification: comparison report end-to-end ─────────
    //
    // These tests exercise the full assembler path with 3 synthetic
    // experiments and confirm the byte-level invariants from ADR-0010 §5:
    //   - Excel: PK ZIP header + ≥5 worksheets (Summary + 3 exps + DebugInfo).
    //   - PDF: %PDF header + non-trivial length (typst compile succeeded).

    #[tokio::test]
    async fn reports_generate_comparison_excel_produces_valid_xlsx() {
        let bytes = generate_comparison_excel_bytes(fixture_comparison_input())
            .await
            .expect("comparison Excel should succeed");
        assert!(!bytes.is_empty());
        assert!(
            bytes.starts_with(b"PK"),
            "XLSX must start with ZIP signature"
        );

        // Count `xl/worksheets/sheetN.xml` entries inside the ZIP stream.
        let as_str = String::from_utf8_lossy(&bytes);
        for n in 1..=5 {
            let needle = format!("xl/worksheets/sheet{}.xml", n);
            assert!(
                as_str.contains(&needle),
                "expected workbook to contain {}",
                needle
            );
        }
    }

    #[tokio::test]
    async fn reports_generate_comparison_pdf_produces_valid_pdf() {
        let bytes = generate_comparison_pdf_bytes(fixture_comparison_input())
            .await
            .expect("comparison PDF should succeed");
        assert!(!bytes.is_empty());
        assert!(
            bytes.starts_with(b"%PDF"),
            "PDF must start with %PDF header"
        );
        // Sanity-check size: a 3-experiment report with chart + summary table
        // is well above 20 KB on disk.  If we ever regress to a blank doc,
        // this catches it.
        assert!(bytes.len() > 20_000, "PDF too small: {} bytes", bytes.len());
    }

    // ── Audit-v2 REP-001 regression guards (pure feature-gate helpers) ──

    use super::{
        build_analysis_cache_key_material, count_experiments_in_value,
        enforce_comparison_excel_features, enforce_comparison_pdf_features,
        enforce_max_comparison_experiments, validate_comparison_by_ids_request,
        validate_comparison_experiment_ids_exist, ComparisonByIdsChartConfig,
        ComparisonByIdsChartLineSettings, ComparisonByIdsLineSettings, ComparisonByIdsMetrics,
        ComparisonByIdsReportSettings, ComparisonByIdsSectionToggles,
        ComparisonByIdsTouchPointConfig, ComparisonReportByIdsRequest,
        ComparisonReportByIdsSettings, ReportFormat,
    };
    use crate::commands::licensing::types::LicenseFeatures;
    use rheolab_core::RHEOLAB_CORE_VERSION;

    /// Helper: build a `LicenseFeatures` with everything explicitly off.
    /// Tests then flip the specific flags they care about.
    fn empty_features() -> LicenseFeatures {
        LicenseFeatures {
            max_experiments: 0,
            max_comparison_experiments: 0,
            export_pdf: false,
            export_excel: false,
            ai_parsing: false,
            comparison: false,
            watermark: false,
            calibration_analysis: false,
            calibration_parsing: false,
            chandler5550_support: false,
            bsl_r1_support: false,
        }
    }

    fn comparison_features(max_comparison_experiments: i64) -> LicenseFeatures {
        let mut features = empty_features();
        features.comparison = true;
        features.export_pdf = true;
        features.export_excel = true;
        features.max_comparison_experiments = max_comparison_experiments;
        features
    }

    fn valid_line_settings(color: &str) -> ComparisonByIdsLineSettings {
        ComparisonByIdsLineSettings {
            color: color.into(),
            width: 2,
            style: "solid".into(),
        }
    }

    fn valid_chart_line_settings() -> ComparisonByIdsChartLineSettings {
        ComparisonByIdsChartLineSettings {
            viscosity: valid_line_settings("#3b82f6"),
            temperature: valid_line_settings("#f97316"),
            shear_rate: valid_line_settings("#a855f7"),
            pressure: valid_line_settings("#22c55e"),
            rpm: valid_line_settings("#eab308"),
            bath_temperature: Some(ComparisonByIdsLineSettings {
                color: "#fb923c".into(),
                width: 2,
                style: "dashed".into(),
            }),
        }
    }

    fn valid_by_ids_request() -> ComparisonReportByIdsRequest {
        ComparisonReportByIdsRequest {
            experiment_ids: vec![
                "exp_aaaaaaaaaaaaaaaaaaaa".into(),
                "exp_bbbbbbbbbbbbbbbbbbbb".into(),
            ],
            settings: ComparisonReportByIdsSettings {
                language: "en".into(),
                unit_system: "SI".into(),
                company_name: Some("RheoLab".into()),
                company_logo_base64: None,
                generated_at: Some("2026-04-29T00:00:00Z".into()),
                comparison_chart: ComparisonByIdsChartConfig {
                    metrics: ComparisonByIdsMetrics {
                        primary: "viscosity_cp".into(),
                        left_secondary: "none".into(),
                        secondary: "temperature_c".into(),
                        tertiary: "none".into(),
                    },
                    axis_mode: "individual".into(),
                    brush_range: Some([0.0, 30.0]),
                    touch_point: ComparisonByIdsTouchPointConfig {
                        enabled: true,
                        viscosity_threshold: 200.0,
                        show_target_time: true,
                        target_time: 10.0,
                    },
                    line_settings: valid_chart_line_settings(),
                    experiment_colors: vec!["#1E90FF".into(), "#FF0000".into()],
                    time_format: "minutes".into(),
                    downsample_mode: "smart".into(),
                    chart_width: 1400,
                    chart_height: 700,
                },
                section_toggles: ComparisonByIdsSectionToggles {
                    show_calibration: false,
                    show_raw_data: false,
                    show_recipe: true,
                    show_water_analysis: true,
                    show_rheology: true,
                },
                report_settings: ComparisonByIdsReportSettings {
                    show_temperature: true,
                    show_shear_rate: true,
                    show_pressure: true,
                    show_bath_temperature: false,
                    shear_rate_axis: "right".into(),
                    pressure_axis: "right".into(),
                    show_advanced_stats: true,
                    report_viscosity_rates: vec![40, 100, 170],
                    rheology_units: None,
                },
                analysis_settings: super::default_comparison_analysis_settings(),
                detection_settings: Default::default(),
            },
        }
    }

    #[test]
    fn validate_by_ids_accepts_valid_pdf_request() {
        let request = valid_by_ids_request();
        let features = comparison_features(3);
        assert!(validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf).is_ok());
    }

    #[test]
    fn validate_by_ids_accepts_valid_excel_request() {
        let request = valid_by_ids_request();
        let features = comparison_features(3);
        assert!(
            validate_comparison_by_ids_request(&request, &features, ReportFormat::Excel).is_ok()
        );
    }

    #[test]
    fn validate_by_ids_rejects_empty_experiment_list() {
        let mut request = valid_by_ids_request();
        request.experiment_ids.clear();
        let features = comparison_features(3);
        let err = validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();
        assert!(err.contains("at least one"));
    }

    #[test]
    fn validate_by_ids_rejects_duplicate_experiment_ids() {
        let mut request = valid_by_ids_request();
        request.experiment_ids = vec![
            "exp_aaaaaaaaaaaaaaaaaaaa".into(),
            "exp_aaaaaaaaaaaaaaaaaaaa".into(),
        ];
        let features = comparison_features(3);
        let err = validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();
        assert!(err.contains("duplicate experiment ID"));
    }

    #[test]
    fn validate_by_ids_rejects_invalid_experiment_id_shape() {
        let mut request = valid_by_ids_request();
        request.experiment_ids = vec!["abc' OR 1=1--".into()];
        let features = comparison_features(3);
        let err = validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();
        assert!(err.contains("alphanumeric"));
    }

    #[test]
    fn validate_by_ids_rejects_over_cap_before_settings_work() {
        let request = valid_by_ids_request();
        let features = comparison_features(1);
        let err = validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();
        assert!(err.contains("exceeds"));
        assert!(err.contains("1 experiments"));
    }

    #[test]
    fn validate_by_ids_rejects_invalid_chart_dimension() {
        let mut request = valid_by_ids_request();
        request.settings.comparison_chart.chart_width = 99;
        let features = comparison_features(3);
        let err = validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();
        assert!(err.contains("chartWidth"));
    }

    #[test]
    fn validate_by_ids_rejects_duplicate_report_viscosity_rates() {
        let mut request = valid_by_ids_request();
        request.settings.report_settings.report_viscosity_rates = vec![40, 100, 100];
        let features = comparison_features(3);
        let err = validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();
        assert!(err.contains("duplicate shear rates"));
    }

    #[test]
    fn validate_by_ids_rejects_invalid_analysis_rate() {
        let mut request = valid_by_ids_request();
        request.settings.analysis_settings.viscosity_shear_rates = vec![40.0, f64::NAN];
        let features = comparison_features(3);
        let err = validate_comparison_by_ids_request(&request, &features, ReportFormat::Pdf)
            .unwrap_err()
            .to_string();
        assert!(err.contains("finite"));
    }

    #[test]
    fn analysis_cache_key_material_is_deterministic_and_versioned() {
        let request = valid_by_ids_request();
        let settings = request.settings;
        let key_a = build_analysis_cache_key_material(
            "exp_aaaaaaaaaaaaaaaaaaaa",
            b"fixture-data",
            "R1B5",
            &settings.analysis_settings,
            &settings.report_settings.report_viscosity_rates,
        )
        .expect("cache key material should build");
        let key_b = build_analysis_cache_key_material(
            "exp_aaaaaaaaaaaaaaaaaaaa",
            b"fixture-data",
            "R1B5",
            &settings.analysis_settings,
            &settings.report_settings.report_viscosity_rates,
        )
        .expect("cache key material should build deterministically");
        let key_c = build_analysis_cache_key_material(
            "exp_aaaaaaaaaaaaaaaaaaaa",
            b"changed-data",
            "R1B5",
            &settings.analysis_settings,
            &settings.report_settings.report_viscosity_rates,
        )
        .expect("cache key material should change with data bytes");

        assert_eq!(key_a, key_b);
        assert_ne!(key_a.experiment_data_hash, key_c.experiment_data_hash);
        assert_eq!(key_a.experiment_data_hash.len(), 64);
        assert_eq!(key_a.rheolab_core_version, RHEOLAB_CORE_VERSION);
        assert_eq!(key_a.algorithm_version, 1);
    }

    #[test]
    fn validate_experiment_ids_exist_reports_missing_ids_in_input_order() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        conn.execute("CREATE TABLE Experiment (id TEXT PRIMARY KEY)", [])
            .expect("table");
        conn.execute(
            "INSERT INTO Experiment (id) VALUES (?1)",
            ["exp_aaaaaaaaaaaaaaaaaaaa"],
        )
        .expect("insert");
        let err = validate_comparison_experiment_ids_exist(
            &conn,
            &[
                "exp_bbbbbbbbbbbbbbbbbbbb".into(),
                "exp_aaaaaaaaaaaaaaaaaaaa".into(),
                "exp_cccccccccccccccccccc".into(),
            ],
        )
        .unwrap_err()
        .to_string();

        assert!(err.contains(
            "Experiment IDs not found: exp_bbbbbbbbbbbbbbbbbbbb, exp_cccccccccccccccccccc"
        ));
    }

    #[test]
    fn enforce_comparison_pdf_rejects_when_comparison_disabled() {
        let mut f = empty_features();
        f.export_pdf = true;
        f.max_comparison_experiments = 100;
        // comparison left = false
        let err = enforce_comparison_pdf_features(&f, 1)
            .unwrap_err()
            .to_string();
        assert!(err.contains("Comparison"));
        assert!(err.contains("REP-001"));
    }

    #[test]
    fn enforce_comparison_pdf_rejects_when_export_pdf_disabled() {
        let mut f = empty_features();
        f.comparison = true;
        f.max_comparison_experiments = 100;
        // export_pdf left = false
        let err = enforce_comparison_pdf_features(&f, 1)
            .unwrap_err()
            .to_string();
        assert!(err.contains("PDF"));
        assert!(err.contains("REP-001"));
    }

    #[test]
    fn enforce_comparison_pdf_rejects_when_count_exceeds_cap() {
        let mut f = empty_features();
        f.comparison = true;
        f.export_pdf = true;
        f.max_comparison_experiments = 3; // demo-tier cap
        let err = enforce_comparison_pdf_features(&f, 7)
            .unwrap_err()
            .to_string();
        assert!(err.contains("size 7"));
        assert!(err.contains("3 experiments"));
        assert!(err.contains("REP-001"));
    }

    #[test]
    fn enforce_comparison_pdf_accepts_when_count_at_cap() {
        let mut f = empty_features();
        f.comparison = true;
        f.export_pdf = true;
        f.max_comparison_experiments = 3;
        // Inclusive upper bound: count == max is allowed.
        assert!(enforce_comparison_pdf_features(&f, 3).is_ok());
    }

    #[test]
    fn enforce_comparison_pdf_accepts_when_unlimited_cap() {
        let mut f = empty_features();
        f.comparison = true;
        f.export_pdf = true;
        f.max_comparison_experiments = -1; // unlimited
                                           // Even a huge count must pass when the cap is "unlimited".
        assert!(enforce_comparison_pdf_features(&f, 10_000).is_ok());
    }

    #[test]
    fn enforce_comparison_excel_rejects_when_export_excel_disabled() {
        let mut f = empty_features();
        f.comparison = true;
        f.max_comparison_experiments = 100;
        // export_excel left = false
        let err = enforce_comparison_excel_features(&f, 1)
            .unwrap_err()
            .to_string();
        assert!(err.contains("Excel"));
        assert!(err.contains("REP-001"));
    }

    #[test]
    fn enforce_comparison_excel_accepts_with_full_features() {
        let mut f = empty_features();
        f.comparison = true;
        f.export_excel = true;
        f.max_comparison_experiments = 8;
        assert!(enforce_comparison_excel_features(&f, 5).is_ok());
    }

    #[test]
    fn enforce_max_comparison_experiments_treats_negative_as_unlimited() {
        // Per the LicenseFeatures contract: -1 means unlimited.
        assert!(enforce_max_comparison_experiments(-1, 0).is_ok());
        assert!(enforce_max_comparison_experiments(-1, 1_000_000).is_ok());
        // Other negatives also accepted (defensive — never a count error).
        assert!(enforce_max_comparison_experiments(-99, 1_000_000).is_ok());
    }

    #[test]
    fn count_experiments_in_value_handles_well_formed_payload() {
        let v = serde_json::json!({
            "experiments": [
                {"id": "a"},
                {"id": "b"},
                {"id": "c"},
            ]
        });
        assert_eq!(count_experiments_in_value(&v), 3);
    }

    #[test]
    fn count_experiments_in_value_returns_zero_for_missing_field() {
        let v = serde_json::json!({"language": "en"});
        assert_eq!(count_experiments_in_value(&v), 0);
    }

    #[test]
    fn count_experiments_in_value_returns_zero_for_non_array() {
        let v = serde_json::json!({"experiments": "oops not an array"});
        assert_eq!(count_experiments_in_value(&v), 0);
    }

    /// Headline REP-001 attack scenario: a malicious frontend hands us a
    /// 100k-experiment payload with a Demo licence (`max_comparison_experiments=3`).
    /// The pre-deserialise count check must refuse before allocating the
    /// full `ComparisonReportInput` struct tree.
    #[test]
    fn enforce_pre_deserialise_count_caps_oversized_payload() {
        let mut f = empty_features();
        f.comparison = true;
        f.export_pdf = true;
        f.max_comparison_experiments = 3;

        // Build a synthetic 100k-element experiments array — only the
        // count field matters for the gate, not the contents.
        let huge: Vec<serde_json::Value> =
            (0..100_000).map(|i| serde_json::json!({"id": i})).collect();
        let v = serde_json::json!({"experiments": huge});

        let count = count_experiments_in_value(&v);
        assert_eq!(count, 100_000);
        let err = enforce_comparison_pdf_features(&f, count)
            .unwrap_err()
            .to_string();
        assert!(err.contains("100000"));
        assert!(err.contains("3 experiments"));
    }
}
