//! Multi-experiment line-chart renderer (comparison report page 1 / sheet 1).
//!
//! Produces a single SVG that stacks N experiments' series on a shared pair
//! of Y axes (left + right).  Each experiment gets its own colour from the
//! `EXPERIMENT_COLORS` palette passed in from the client; the metric (line
//! width, dash style) overrides come from `ChartConfig::line_styles` and are
//! applied uniformly to every experiment's series of the same metric.
//!
//! # Module layout
//!
//! Split into focused submodules so each section stays under ~500 LOC:
//!
//! | File | LOC | Responsibility |
//! |---|---:|---|
//! | `mod.rs` | ~70 | `ExperimentSeries` + entry fn (dispatch + downsample) |
//! | `dash_inject.rs` | ~150 | SVG post-processor: stroke-dasharray injector |
//! | `shared_axis.rs` | ~440 | Shared-axis renderer body |
//! | `individual_axis.rs` | ~445 | Individual-axis renderer body |
//! | `tests.rs` | ~260 | All 6 tests |
//!
//! Dispatches on `ChartConfig::axis_mode`:
//!   - `"individual"` → each visible metric gets its own Y scale/axis column
//!     (see [`individual_axis::render`]).
//!   - everything else → shared-axis mode (one left + one right scale)
//!     (see [`shared_axis::render`]).
//!
//! See `docs/adr/ADR-0010-comparison-report-generation.md` §4.3.

use plotters::prelude::*;
use super::super::common::*;

mod dash_inject;
mod individual_axis;
mod shared_axis;

#[cfg(test)]
mod tests;

/// One experiment's measurement points plus its assigned colour.
///
/// `display_name` is carried through for the comparison summary table and
/// future legend work, but is not drawn into the SVG itself (legend is
/// rendered by the Typst overlay in `pdf/template/chart_page.rs`).
#[derive(Debug, Clone)]
pub struct ExperimentSeries {
    pub points: Vec<ChartPoint>,
    pub color: RGBColor,
    pub display_name: String,
}

/// Render a shared-axis SVG chart for N experiments.
///
/// # Errors
///
/// - `"No experiments provided"` when `experiments` is empty.
/// - `"No data points provided"` when every experiment is empty.
/// - Propagates any Plotters/`SVGBackend` failure as `String`.
pub fn generate_multi_experiment_chart_svg(
    experiments: &[ExperimentSeries],
    config: &ChartConfig,
) -> Result<(String, ChartRanges), String> {
    if experiments.is_empty() {
        return Err("No experiments provided".to_string());
    }

    // LTTB-downsample each experiment independently.  The threshold is
    // divided across experiments so that a 10-experiment chart still fits
    // in a reasonable number of polyline points.  Floor at 200 pts/exp.
    let per_exp_threshold = (1500_usize / experiments.len().max(1)).max(200);
    let experiments: Vec<ExperimentSeries> = experiments
        .iter()
        .map(|e| {
            let points = if config.skip_downsample {
                e.points.clone()
            } else {
                lttb_downsample_chart(&e.points, per_exp_threshold)
            };
            ExperimentSeries {
                points,
                color: e.color,
                display_name: e.display_name.clone(),
            }
        })
        .collect();

    if experiments.iter().all(|e| e.points.is_empty()) {
        return Err("No data points provided".to_string());
    }

    // Dispatch on axis mode.  Individual mode gives every visible metric
    // its own Y scale and dedicated axis column; shared mode (default)
    // lumps everything onto one left + one right scale.
    if config.axis_mode.trim().to_lowercase() == "individual" {
        individual_axis::render(&experiments, config)
    } else {
        shared_axis::render(&experiments, config)
    }
}
