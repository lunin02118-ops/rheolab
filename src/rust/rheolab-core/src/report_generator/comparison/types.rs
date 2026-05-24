//! Comparison report input types.
//!
//! See `docs/adr/ADR-0010-comparison-report-generation.md` for the full data
//! contract.  This struct is the mirror of the TypeScript
//! `ComparisonReportInput` (in `src/lib/analysis/report-types/` once Phase 2
//! lands).
//!
//! **Naming convention**: the whole payload uses **snake_case** on the wire,
//! matching `convertReportInputToWasm` in `src/lib/analysis/report-types/
//! report-converter.ts`.  The Phase-2 client builder must emit the same
//! shape so the two ends stay in sync.

use serde::{Deserialize, Serialize};

use super::super::types::{ChartLineSettings, ReportInput};

// ── Main input ──────────────────────────────────────────────────────────────

/// Full payload for one comparison-report generation call.
///
/// Sheet/page 1 is the **comparison chart + summary table**, rendered from
/// [`ComparisonReportInput::comparison_chart`] and a roll-up across every
/// entry in [`experiments`](ComparisonReportInput::experiments).
///
/// Sheets/pages 2..N+1 are **one compact per-experiment report** each,
/// assembled from each entry's [`ComparisonExperimentEntry::report_input`]
/// in the same shape the existing single-exp pipeline consumes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonReportInput {
    /// "ru" | "en"
    pub language: String,

    /// "SI" | "SI_Pas" | "Imperial"
    pub unit_system: String,

    #[serde(default)]
    pub company_name: Option<String>,

    /// Data URI or base-64 encoded PNG/JPEG/GIF/SVG company logo (same
    /// format as the single-exp path).
    #[serde(default)]
    pub company_logo_base64: Option<String>,

    /// ISO-8601 timestamp captured client-side at the moment the user
    /// pressed "Generate".
    pub generated_at: String,

    /// Configuration for the sheet/page 1 comparison chart.
    pub comparison_chart: ComparisonChartConfig,

    /// Per-experiment entries — rendered on sheets/pages 2..N+1 in order.
    pub experiments: Vec<ComparisonExperimentEntry>,
}

// ── Comparison chart config ─────────────────────────────────────────────────

/// All information needed to render the sheet/page 1 chart **and** to echo
/// the user's exact visual settings on that page's summary table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonChartConfig {
    pub metrics: ComparisonMetrics,

    /// "shared" | "individual"
    pub axis_mode: String,

    /// Optional [min, max] in minutes — captured from the chart brush at
    /// generate-time.  When `None`, the renderer uses the full data range.
    #[serde(default)]
    pub brush_range: Option<[f64; 2]>,

    pub touch_point: TouchPointConfig,

    /// Per-metric line style overrides (colour / width / dash).  Reuses the
    /// same `ChartLineSettings` that the single-exp path consumes.
    pub line_settings: ChartLineSettings,

    /// Per-experiment colour palette (hex strings like "#1E90FF") — sourced
    /// from `EXPERIMENT_COLORS` in `comparison-chart-constants.ts`.  The
    /// renderer cycles through this list using `index % len`.
    pub experiment_colors: Vec<String>,

    /// "seconds" | "minutes" | "hh:mm:ss"
    #[serde(default = "default_time_format")]
    pub time_format: String,

    /// "off" | "smart" | "fast"
    #[serde(default = "default_downsample_mode")]
    pub downsample_mode: String,

    /// Target SVG width in pixels.  Default: 1400 (A4 landscape fit).
    #[serde(default = "default_chart_width")]
    pub chart_width: u32,

    /// Target SVG height in pixels.  Default: 700.
    #[serde(default = "default_chart_height")]
    pub chart_height: u32,
}

fn default_time_format() -> String {
    "minutes".to_string()
}
fn default_downsample_mode() -> String {
    "smart".to_string()
}
fn default_chart_width() -> u32 {
    1400
}
fn default_chart_height() -> u32 {
    700
}

/// Which metrics are visible on the comparison chart.  Mirrors the four
/// `*Metric` props on `ComparisonChartUPlot`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonMetrics {
    /// Always a real metric key, e.g. "viscosity_cp".
    pub primary: String,

    /// Metric key or the literal "none".
    pub left_secondary: String,

    /// Metric key or "none".
    pub secondary: String,

    /// Metric key or "none".
    pub tertiary: String,
}

/// Touch-point overlay configuration.  Mirrors the `ViscosityThresholdControl`
/// state inside the Comparison tab.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TouchPointConfig {
    pub enabled: bool,

    /// cP
    pub viscosity_threshold: f64,

    pub show_target_time: bool,

    /// minutes
    pub target_time: f64,
}

// ── Per-experiment entry ────────────────────────────────────────────────────

/// One entry per experiment that the user selected on the comparison view.
///
/// `report_input` contains exactly the payload the existing single-exp
/// pipeline already accepts, so the per-sheet / per-page rendering can be
/// delegated verbatim to refactored helpers (see
/// `write_single_experiment_to_sheet` in `excel/mod.rs` once Phase 1.C lands).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonExperimentEntry {
    /// Stable identifier from the TS experiment store.  Not rendered — kept
    /// for future cross-referencing in the summary table.
    pub id: String,

    /// Proposed sheet/page name.  The comparison assembler will run this
    /// through `sanitize_sheet_name()` before handing it to
    /// `rust_xlsxwriter`.
    pub display_name: String,

    pub report_input: ReportInput,

    pub section_toggles: SectionToggles,
}

/// Per-experiment section visibility.  Overrides `ReportSettings.show_*`
/// inside `report_input`, giving the UI a per-experiment granularity while
/// keeping the single-exp payload intact.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SectionToggles {
    pub show_calibration: bool,
    pub show_raw_data: bool,
    pub show_recipe: bool,
    pub show_water_analysis: bool,
    #[serde(default = "default_show_rheology")]
    pub show_rheology: bool,
}

fn default_show_rheology() -> bool {
    true
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chart_config_deserialises_snake_case() {
        let json = r##"{
            "metrics": {"primary":"viscosity_cp","left_secondary":"none","secondary":"temperature_c","tertiary":"none"},
            "axis_mode": "shared",
            "brush_range": [0.0, 30.0],
            "touch_point": {"enabled": true, "viscosity_threshold": 200.0, "show_target_time": false, "target_time": 10.0},
            "line_settings": {},
            "experiment_colors": ["#1E90FF","#FF0000"],
            "time_format": "minutes",
            "downsample_mode": "smart",
            "chart_width": 1400,
            "chart_height": 700
        }"##;
        let cfg: ComparisonChartConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.metrics.primary, "viscosity_cp");
        assert_eq!(cfg.axis_mode, "shared");
        assert_eq!(cfg.brush_range, Some([0.0, 30.0]));
        assert_eq!(cfg.experiment_colors.len(), 2);
        assert_eq!(cfg.chart_width, 1400);
    }

    #[test]
    fn chart_config_defaults_when_optional_missing() {
        let json = r##"{
            "metrics": {"primary":"viscosity_cp","left_secondary":"none","secondary":"none","tertiary":"none"},
            "axis_mode": "individual",
            "touch_point": {"enabled": false, "viscosity_threshold": 0.0, "show_target_time": false, "target_time": 0.0},
            "line_settings": {},
            "experiment_colors": []
        }"##;
        let cfg: ComparisonChartConfig = serde_json::from_str(json).unwrap();
        assert_eq!(cfg.time_format, "minutes");
        assert_eq!(cfg.downsample_mode, "smart");
        assert_eq!(cfg.chart_width, 1400);
        assert_eq!(cfg.chart_height, 700);
        assert!(cfg.brush_range.is_none());
    }

    #[test]
    fn full_input_parses_with_two_experiments() {
        let json = r##"{
            "language": "ru",
            "unit_system": "SI",
            "generated_at": "2026-04-22T00:00:00Z",
            "comparison_chart": {
                "metrics": {"primary":"viscosity_cp","left_secondary":"none","secondary":"none","tertiary":"none"},
                "axis_mode": "shared",
                "touch_point": {"enabled": false, "viscosity_threshold": 0.0, "show_target_time": false, "target_time": 0.0},
                "line_settings": {},
                "experiment_colors": ["#1E90FF","#FF0000"]
            },
            "experiments": [
                {
                    "id": "exp-1",
                    "display_name": "Chandler SST",
                    "report_input": {
                        "metadata": {"filename": "a.dat"},
                        "cycle_results": [],
                        "recipe": [],
                        "settings": {}
                    },
                    "section_toggles": {
                        "show_calibration": false,
                        "show_raw_data": false,
                        "show_recipe": true,
                        "show_water_analysis": false,
                        "show_rheology": true
                    }
                },
                {
                    "id": "exp-2",
                    "display_name": "Grace Report",
                    "report_input": {
                        "metadata": {"filename": "b.dat"},
                        "cycle_results": [],
                        "recipe": [],
                        "settings": {}
                    },
                    "section_toggles": {
                        "show_calibration": false,
                        "show_raw_data": false,
                        "show_recipe": true,
                        "show_water_analysis": false,
                        "show_rheology": true
                    }
                }
            ]
        }"##;
        let input: ComparisonReportInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.language, "ru");
        assert_eq!(input.experiments.len(), 2);
        assert_eq!(input.experiments[0].display_name, "Chandler SST");
        assert!(input.experiments[0].section_toggles.show_recipe);
    }
}
