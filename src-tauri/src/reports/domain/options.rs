use crate::commands::experiments::types::RheologyParameterSource;
use serde::{Deserialize, Serialize};

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
    #[serde(default)]
    pub rheology_source_override: Option<RheologyParameterSource>,
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

pub(crate) fn default_comparison_analysis_settings() -> ComparisonByIdsAnalysisSettings {
    ComparisonByIdsAnalysisSettings {
        points_to_average: 0,
        viscosity_shear_rates: default_analysis_viscosity_shear_rates(),
    }
}
