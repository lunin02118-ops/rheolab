//! In-memory chart-data layout computation.
//!
//! `compute_chart_data_layout` walks the comparison input, picks column
//! positions for every paired (time, viscosity) series and any secondary
//! metric that needs to overlay the chart, and builds a flat `(row, col,
//! value)` cell list that `write_chart_data_to_sheet` will dump verbatim
//! into the hidden `_ChartData` worksheet later.
//!
//! Keeping data computation separate from sheet I/O lets the orchestrator
//! create visible sheets first and pin the hidden data sheet at the end of
//! the tab order.

use rust_xlsxwriter::{Worksheet, XlsxError};

use super::super::super::formatters::convert_viscosity;
use super::super::super::touch_point::{
    calculate_smart_touch_points, SmartTouchPointOptions, TouchPointInput, TouchPointType,
};
use super::super::types::ComparisonReportInput;
use super::helpers::canonical_to_internal;

/// Touch-point result cached from data-sheet pass, used for both markers and
/// the text summary written below the chart.
pub(super) struct TouchPointResult {
    pub(super) exp_index: usize,
    pub(super) tp_type: TouchPointType,
    pub(super) time_min: f64,
    pub(super) viscosity_display: f64,
    /// Row in the hidden data sheet where the marker cell lives.
    pub(super) data_row: u32,
}

/// One secondary metric to be overlaid on the comparison chart.
///
/// Each visible secondary metric gets one column per experiment in the
/// hidden `_ChartData` sheet.  `exp_cols` is parallel to
/// `ChartDataLayout::exp_columns` — element *i* holds `(data_col, last_row)`
/// for experiment *i*.
pub(super) struct SecondaryMetricInfo {
    /// Internal short key, e.g. `"temperature"`, `"shear_rate"`.
    pub(super) metric: String,
    /// Per-experiment: (data_col, last_row).
    pub(super) exp_cols: Vec<(u16, u32)>,
    /// `true` ⇒ series goes on the secondary (right) Y-axis.
    pub(super) on_right: bool,
}

/// Layout metadata returned by [`compute_chart_data_layout`].
pub(super) struct ChartDataLayout {
    /// Per-experiment: (col_time, col_visc, last_row).
    pub(super) exp_columns: Vec<(u16, u16, u32)>,
    /// Global max time value (for the threshold horizontal line and
    /// the chart x-axis `set_max` clamp — the latter removes empty space
    /// at the right of the plot area that Excel's auto-scale would
    /// otherwise pad with).
    pub(super) global_max_time: f64,
    /// Threshold helper cells: (col_time, col_visc) — two rows (0 and 1).
    pub(super) threshold_cells: Option<(u16, u16)>,
    /// Touch-point helper cells column pair (col_time, col_visc).
    pub(super) tp_cols: (u16, u16),
    /// Collected touch-point results.
    pub(super) touch_points: Vec<TouchPointResult>,
    /// Raw cell values: (row, col, value) — written to _ChartData sheet later.
    pub(super) cells: Vec<(u32, u16, f64)>,
    /// Secondary metric columns added after the helper area.
    pub(super) secondary_metrics: Vec<SecondaryMetricInfo>,
}

/// Compute chart data layout and all cell values in memory (no sheet I/O).
///
/// The returned `ChartDataLayout` contains everything needed to both
/// construct the chart series references AND to populate the hidden
/// `_ChartData` sheet later — which lets us create that sheet last in the
/// tab order.
pub(super) fn compute_chart_data_layout(
    input: &ComparisonReportInput,
    _is_ru: bool,
) -> Result<ChartDataLayout, XlsxError> {
    let unit_system = &input.unit_system;
    let cfg = &input.comparison_chart;
    let n = input.experiments.len();
    let time_fmt = &cfg.time_format;

    let convert_time = |elapsed_sec: f64| -> f64 {
        match time_fmt.as_str() {
            "seconds" => elapsed_sec.round(),
            "hh:mm:ss" => elapsed_sec / 86_400.0,
            _ => elapsed_sec / 60.0,
        }
    };

    let mut cells: Vec<(u32, u16, f64)> = Vec::new();

    // ── Paired data columns ──────────────────────────────────────────
    let mut exp_columns: Vec<(u16, u16, u32)> = Vec::with_capacity(n);
    let mut global_max_time: f64 = 0.0;

    for (i, entry) in input.experiments.iter().enumerate() {
        let col_time = (i * 2) as u16;
        let col_visc = col_time + 1;
        let raw = &entry.report_input.raw_data;
        let first_time = raw.first().map(|p| p.time_sec).unwrap_or(0.0);
        let mut last_row: u32 = 0;

        for (j, pt) in raw.iter().enumerate() {
            let row = j as u32;
            let elapsed = pt.time_sec - first_time;
            let time_val = convert_time(elapsed);
            let visc = convert_viscosity(pt.viscosity_cp, unit_system);
            cells.push((row, col_time, time_val));
            cells.push((row, col_visc, visc));
            last_row = row;
            if time_val > global_max_time {
                global_max_time = time_val;
            }
        }
        exp_columns.push((col_time, col_visc, last_row));
    }

    // ── Helper area starts after the paired data columns ─────────────
    let helper_col_base = (n * 2) as u16;

    // ── Threshold helper cells ───────────────────────────────────────
    let has_threshold = cfg.touch_point.enabled && cfg.touch_point.viscosity_threshold > 0.0;
    let threshold_cells = if has_threshold && !exp_columns.is_empty() {
        let tc = helper_col_base;
        let vc = helper_col_base + 1;
        let threshold_visc = convert_viscosity(cfg.touch_point.viscosity_threshold, unit_system);
        cells.push((0, tc, 0.0));
        cells.push((0, vc, threshold_visc));
        cells.push((1, tc, global_max_time));
        cells.push((1, vc, threshold_visc));
        Some((tc, vc))
    } else {
        None
    };

    // ── Touch-point marker cells ─────────────────────────────────────
    let tp_tc = helper_col_base + 2;
    let tp_vc = helper_col_base + 3;
    let mut touch_points: Vec<TouchPointResult> = Vec::new();
    let mut helper_row: u32 = 0;

    if cfg.touch_point.enabled {
        for (i, entry) in input.experiments.iter().enumerate() {
            let raw = &entry.report_input.raw_data;
            if raw.len() < 3 {
                continue;
            }

            let first_time_sec = raw.first().map(|p| p.time_sec).unwrap_or(0.0);
            let inputs: Vec<TouchPointInput> = raw
                .iter()
                .filter(|p| p.time_sec.is_finite() && p.viscosity_cp.is_finite())
                .map(|p| TouchPointInput {
                    time_min: (p.time_sec - first_time_sec) / 60.0,
                    viscosity_cp: p.viscosity_cp,
                    shear_rate: p.shear_rate.unwrap_or(0.0),
                })
                .collect();

            let results = calculate_smart_touch_points(
                &inputs,
                &SmartTouchPointOptions {
                    viscosity_threshold: cfg.touch_point.viscosity_threshold,
                    show_target_time: cfg.touch_point.show_target_time,
                    target_time: cfg.touch_point.target_time,
                    ..Default::default()
                },
            );

            for r in &results {
                let visc_display = convert_viscosity(r.viscosity, unit_system);
                let tp_time = convert_time(r.time * 60.0);
                cells.push((helper_row, tp_tc, tp_time));
                cells.push((helper_row, tp_vc, visc_display));

                touch_points.push(TouchPointResult {
                    exp_index: i,
                    tp_type: r.tp_type.clone(),
                    time_min: r.time,
                    viscosity_display: visc_display,
                    data_row: helper_row,
                });
                helper_row += 1;
            }
        }
    }

    // ── Secondary metric columns ────────────────────────────────────
    //
    // Resolve which additional metrics the user placed in the left_secondary,
    // secondary, and tertiary slots — mirror the PDF path's slot logic.
    let in_left = |key: &str| canonical_to_internal(&cfg.metrics.left_secondary) == key;
    let in_right = |key: &str| {
        canonical_to_internal(&cfg.metrics.secondary) == key
            || canonical_to_internal(&cfg.metrics.tertiary) == key
    };
    let in_any = |key: &str| in_left(key) || in_right(key);

    // List of (internal_key, on_right).  We iterate this once to build
    // `SecondaryMetricInfo` entries.
    struct MetricSpec {
        key: &'static str,
        on_right: bool,
    }

    let mut specs: Vec<MetricSpec> = Vec::new();
    for &key in &["temperature", "shear_rate", "pressure", "bath_temperature"] {
        if in_any(key) {
            specs.push(MetricSpec {
                key,
                on_right: !in_left(key),
            });
        }
    }

    // Allocate columns after the last touch-point helper column.
    let mut next_col = helper_col_base + 4; // threshold(2) + tp(2) = +4
    let mut secondary_metrics: Vec<SecondaryMetricInfo> = Vec::new();

    for spec in &specs {
        let mut exp_cols: Vec<(u16, u32)> = Vec::with_capacity(n);
        for entry in input.experiments.iter() {
            let col = next_col;
            next_col += 1;
            let raw = &entry.report_input.raw_data;
            let mut last_row: u32 = 0;

            for (j, pt) in raw.iter().enumerate() {
                let val = match spec.key {
                    "temperature" => pt.temperature_c,
                    "shear_rate" => pt.shear_rate,
                    "pressure" => pt.pressure_bar,
                    "bath_temperature" => pt.bath_temperature_c,
                    _ => None,
                };
                if let Some(v) = val {
                    cells.push((j as u32, col, v));
                    last_row = j as u32;
                }
            }
            // Even when the experiment has no data for this metric, record
            // the column position (last_row stays 0) so the index stays
            // aligned with `exp_columns`.
            exp_cols.push((col, last_row));
        }
        secondary_metrics.push(SecondaryMetricInfo {
            metric: spec.key.to_string(),
            exp_cols,
            on_right: spec.on_right,
        });
    }

    Ok(ChartDataLayout {
        exp_columns,
        global_max_time,
        threshold_cells,
        tp_cols: (tp_tc, tp_vc),
        touch_points,
        cells,
        secondary_metrics,
    })
}

/// Write pre-computed chart data cells to the hidden `_ChartData` sheet.
pub(super) fn write_chart_data_to_sheet(
    sheet: &mut Worksheet,
    data: &ChartDataLayout,
) -> Result<(), XlsxError> {
    for &(row, col, val) in &data.cells {
        sheet.write_number(row, col, val)?;
    }
    Ok(())
}
