//! Line-chart rendering entry point.
//!
//! The implementation is split by axis mode:
//!
//! - `shared`     — one left scale + one right scale for all visible metrics
//!   (used when `ChartConfig::axis_mode != "individual"`).
//! - `individual` — every visible metric gets its own Y scale/axis column.
//!
//! Both share upstream LTTB downsampling and the common types/helpers in
//! [`super::common`].
mod individual;
pub mod multi_experiment;
mod shared;

pub use multi_experiment::{generate_multi_experiment_chart_svg, ExperimentSeries};

use super::common::*;

/// Generate an SVG chart from a set of measurement points.
///
/// Dispatches to the appropriate renderer based on `config.axis_mode`
/// ("individual" → [`individual::render`], anything else → [`shared::render`]).
///
/// The point set is LTTB-downsampled to 1500 points unless
/// `config.skip_downsample` is set (used by tests and the PDF export path
/// that already pre-filters data).
pub fn generate_chart_svg(
    points: &[ChartPoint],
    config: &ChartConfig,
) -> Result<(String, ChartRanges), String> {
    if points.is_empty() {
        return Err("No data points provided".to_string());
    }

    // LTTB downsample (shared by both render modes).
    let points = if config.skip_downsample {
        points.to_vec()
    } else {
        lttb_downsample_chart(points, 1500)
    };

    if config.axis_mode.trim().to_lowercase() == "individual" {
        individual::render(&points, config)
    } else {
        shared::render(&points, config)
    }
}
