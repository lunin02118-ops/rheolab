//! Excel comparison report assembler (ADR-0010, Phase 1.E).
//!
//! Produces an XLSX workbook with:
//! 1. A **Summary** sheet — per-experiment summary table (one row each).
//! 2. An **Overlap Chart** sheet — paired (time, viscosity) columns for
//!    every experiment plus a native Excel ScatterSmooth chart.
//! 3. One sheet per experiment, populated via
//!    [`super::super::excel::write_single_experiment_to_sheet`].
//! 4. A hidden **DebugInfo** sheet — single-experiment first entry's
//!    settings, mirroring the single-exp path for diagnostics.

use rust_xlsxwriter::{
    Chart, ChartFont, ChartFormat,
    ChartLegendPosition, ChartLine, ChartLineDashType, ChartMarker, ChartMarkerType,
    ChartSolidFill, ChartType, Color, Format, FormatAlign, FormatBorder, Workbook,
    Worksheet, XlsxError,
};

use super::super::excel::{scaled_line_width, write_single_experiment_to_sheet, Styles};
use super::super::formatters::convert_viscosity;
use super::super::touch_point::{
    TouchPointInput, TouchPointType, SmartTouchPointOptions,
    calculate_smart_touch_points,
};
use super::types::ComparisonReportInput;
use super::allocate_sheet_name;

#[cfg(test)]
use super::EXCEL_SHEET_NAME_MAX_LEN;

/// Generate a comparison XLSX report.
///
/// Returns the complete workbook as a byte buffer ready to be streamed
/// back to the UI or written to disk.
pub fn generate_comparison_excel(
    input: &ComparisonReportInput,
) -> Result<Vec<u8>, String> {
    if input.experiments.is_empty() {
        return Err("comparison report requires at least one experiment".to_string());
    }

    generate_comparison_excel_internal(input)
        .map_err(|e| format!("Excel comparison generation error: {}", e))
}

fn generate_comparison_excel_internal(
    input: &ComparisonReportInput,
) -> Result<Vec<u8>, XlsxError> {
    let mut workbook = Workbook::new();
    let styles = Styles::new();
    let is_ru = input.language.trim().to_lowercase().starts_with("ru");

    // Track used sheet names so dedupe suffixes work across ALL sheets.
    let mut used_names: Vec<String> = Vec::new();

    // ── Pre-allocate per-experiment sheet names ─────────────────────────
    let exp_sheet_names: Vec<String> = input.experiments.iter()
        .map(|entry| allocate_sheet_name(&entry.display_name, &mut used_names))
        .collect();

    // ── Compute chart data in memory (no sheet yet) ─────────────────────
    // We compute everything first, then create sheets in the desired tab
    // order: visible sheets first, hidden _ChartData last.
    let data_sheet_name = allocate_sheet_name("_ChartData", &mut used_names);
    let chart_data = compute_chart_data_layout(input, is_ru)?;

    // ── Sheet 1 (visible): Overlap Chart ────────────────────────────────
    let overlap_name = allocate_sheet_name(
        if is_ru { "Общий график" } else { "Overlap Chart" },
        &mut used_names,
    );
    {
        let sheet = workbook.add_worksheet();
        sheet.set_name(&overlap_name)?;
        write_overlap_chart_sheet(sheet, input, &data_sheet_name, &chart_data, is_ru)?;
    }

    // ── Per-experiment report sheets ────────────────────────────────────
    for (i, entry) in input.experiments.iter().enumerate() {
        let mut per_exp = entry.report_input.clone();
        per_exp.settings.show_calibration   = entry.section_toggles.show_calibration;
        per_exp.settings.show_raw_data      = entry.section_toggles.show_raw_data;
        if !entry.section_toggles.show_rheology {
            per_exp.cycle_results.clear();
            per_exp.cycles.clear();
        }

        let name = &exp_sheet_names[i];
        let sheet = workbook.add_worksheet();
        sheet.set_name(name)?;
        write_single_experiment_to_sheet(sheet, name, &per_exp, &styles)?;
    }

    // ── Hidden data sheet — chart series reference this by name ─────────
    // Created after all visible sheets so it appears last in the tab bar.
    {
        let data_sheet = workbook.add_worksheet();
        data_sheet.set_name(&data_sheet_name)?;
        data_sheet.set_hidden(true);
        write_chart_data_to_sheet(data_sheet, &chart_data)?;
    }

    // ── Hidden DebugInfo sheet (mirrors single-exp path) ───────────────
    let debug_name = allocate_sheet_name("DebugInfo", &mut used_names);
    let debug = workbook.add_worksheet();
    debug.set_name(&debug_name)?;
    debug.set_hidden(true);
    debug.write_string(0, 0, "Setting")?;
    debug.write_string(0, 1, "Value")?;
    debug.write_string(1, 0, "Language")?;
    debug.write_string(1, 1, &input.language)?;
    debug.write_string(2, 0, "Unit System")?;
    debug.write_string(2, 1, &input.unit_system)?;
    debug.write_string(3, 0, "Experiments")?;
    debug.write_number(3, 1, input.experiments.len() as f64)?;
    debug.write_string(4, 0, "Axis Mode")?;
    debug.write_string(4, 1, &input.comparison_chart.axis_mode)?;
    debug.write_string(5, 0, "Generated At")?;
    debug.write_string(5, 1, &input.generated_at)?;

    workbook.save_to_buffer()
}

// ── Overlap Chart sheet ──────────────────────────────────────────────────────

/// Default palette — matches `EXPERIMENT_COLORS` in `comparison-chart-constants.ts`.
const DEFAULT_PALETTE: &[u32] = &[
    0x1E90FF, // DodgerBlue
    0xFF4500, // OrangeRed
    0x228B22, // ForestGreen
    0xFF1493, // DeepPink
    0xFFD700, // Gold
    0x8A2BE2, // BlueViolet
    0x00CED1, // DarkTurquoise
    0xFF6347, // Tomato
];

// ── Metric key normalisation ─────────────────────────────────────────────────

/// Bridge canonical UI metric keys to internal short keys.
///
/// The production UI sends canonical keys like `"shear_rate_s1"` while the
/// chart builder expects short keys (`"shear_rate"`).  Unknown / already-
/// internal keys pass through unchanged.
fn canonical_to_internal(key: &str) -> &str {
    match key {
        "shear_rate_s1" | "shearRate" | "shear_rate" => "shear_rate",
        "viscosity_cp" | "viscosityCp" | "viscosity" => "viscosity",
        "temperature_c" | "temperatureC" | "temperature" => "temperature",
        "bath_temperature_c" | "bathTemperatureC" | "bath_temperature" => "bath_temperature",
        "pressure_bar" | "pressureBar" | "pressure" => "pressure",
        other => other,
    }
}

fn parse_color_hex(hex: &str) -> u32 {
    let hex = hex.trim_start_matches('#');
    u32::from_str_radix(hex, 16).unwrap_or(0x3B82F6)
}

fn style_to_dash(style: &str) -> ChartLineDashType {
    match style {
        "dashed" => ChartLineDashType::Dash,
        "dotted" => ChartLineDashType::RoundDot,
        _ => ChartLineDashType::Solid,
    }
}

/// Touch-point result cached from data-sheet pass, used for both markers and
/// the text summary written below the chart.
struct TouchPointResult {
    exp_index: usize,
    tp_type: TouchPointType,
    time_min: f64,
    viscosity_display: f64,
    /// Row in the hidden data sheet where the marker cell lives.
    data_row: u32,
}

/// One secondary metric to be overlaid on the comparison chart.
///
/// Each visible secondary metric gets one column per experiment in the
/// hidden `_ChartData` sheet.  `exp_cols` is parallel to
/// `ChartDataLayout::exp_columns` — element *i* holds `(data_col, last_row)`
/// for experiment *i*.
struct SecondaryMetricInfo {
    /// Internal short key, e.g. `"temperature"`, `"shear_rate"`.
    metric: String,
    /// Per-experiment: (data_col, last_row).
    exp_cols: Vec<(u16, u32)>,
    /// `true` ⇒ series goes on the secondary (right) Y-axis.
    on_right: bool,
}

/// Layout metadata returned by `compute_chart_data_layout`.
struct ChartDataLayout {
    /// Per-experiment: (col_time, col_visc, last_row).
    exp_columns: Vec<(u16, u16, u32)>,
    /// Global max time value (for the threshold horizontal line and
    /// the chart x-axis `set_max` clamp — the latter removes empty space
    /// at the right of the plot area that Excel's auto-scale would
    /// otherwise pad with).
    global_max_time: f64,
    /// Threshold helper cells: (col_time, col_visc) — two rows (0 and 1).
    threshold_cells: Option<(u16, u16)>,
    /// Touch-point helper cells column pair (col_time, col_visc).
    tp_cols: (u16, u16),
    /// Collected touch-point results.
    touch_points: Vec<TouchPointResult>,
    /// Raw cell values: (row, col, value) — written to _ChartData sheet later.
    cells: Vec<(u32, u16, f64)>,
    /// Secondary metric columns added after the helper area.
    secondary_metrics: Vec<SecondaryMetricInfo>,
}

/// Compute chart data layout and all cell values in memory (no sheet I/O).
///
/// The returned `ChartDataLayout` contains everything needed to both
/// construct the chart series references AND to populate the hidden
/// `_ChartData` sheet later — which lets us create that sheet last in the
/// tab order.
fn compute_chart_data_layout(
    input: &ComparisonReportInput,
    _is_ru: bool,
) -> Result<ChartDataLayout, XlsxError> {
    let unit_system = &input.unit_system;
    let cfg = &input.comparison_chart;
    let n = input.experiments.len();
    let time_fmt = &cfg.time_format;

    let convert_time = |elapsed_sec: f64| -> f64 {
        match time_fmt.as_str() {
            "seconds"  => elapsed_sec.round(),
            "hh:mm:ss" => elapsed_sec / 86_400.0,
            _          => elapsed_sec / 60.0,
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
            if time_val > global_max_time { global_max_time = time_val; }
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
            if raw.len() < 3 { continue; }

            let first_time_sec = raw.first().map(|p| p.time_sec).unwrap_or(0.0);
            let inputs: Vec<TouchPointInput> = raw.iter()
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
    let in_left  = |key: &str| canonical_to_internal(&cfg.metrics.left_secondary) == key;
    let in_right = |key: &str|
        canonical_to_internal(&cfg.metrics.secondary)  == key
        || canonical_to_internal(&cfg.metrics.tertiary) == key;
    let in_any = |key: &str| in_left(key) || in_right(key);

    // List of (internal_key, extractor_fn, on_right).
    // We iterate this once to build `SecondaryMetricInfo` entries.
    struct MetricSpec {
        key: &'static str,
        on_right: bool,
    }

    let mut specs: Vec<MetricSpec> = Vec::new();
    for &key in &["temperature", "shear_rate", "pressure", "bath_temperature"] {
        if in_any(key) {
            specs.push(MetricSpec { key, on_right: !in_left(key) });
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
                    "temperature"      => pt.temperature_c,
                    "shear_rate"       => pt.shear_rate,
                    "pressure"         => pt.pressure_bar,
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
fn write_chart_data_to_sheet(
    sheet: &mut rust_xlsxwriter::Worksheet,
    data: &ChartDataLayout,
) -> Result<(), XlsxError> {
    for &(row, col, val) in &data.cells {
        sheet.write_number(row, col, val)?;
    }
    Ok(())
}

/// Build the Overlap Chart sheet — chart only + touch-point text summary.
/// All source data lives on the hidden `_ChartData` sheet.
fn write_overlap_chart_sheet(
    sheet: &mut rust_xlsxwriter::Worksheet,
    input: &ComparisonReportInput,
    data_sheet_name: &str,
    data: &ChartDataLayout,
    is_ru: bool,
) -> Result<(), XlsxError> {
    let unit_system = &input.unit_system;
    let cfg = &input.comparison_chart;
    let time_fmt = &cfg.time_format;

    // ── Build chart ──────────────────────────────────────────────────
    let mut chart = Chart::new(ChartType::ScatterStraight);

    let title_text = if is_ru { "Вязкость vs Время" } else { "Viscosity vs Time" };
    chart.title()
        .set_name(title_text)
        .set_font(ChartFont::new().set_name("Arial").set_size(12));

    chart.set_width(1200);
    chart.set_height(600);

    // ── One series per experiment — references hidden data sheet ─────
    for (i, entry) in input.experiments.iter().enumerate() {
        if i >= data.exp_columns.len() { break; }
        let (col_time, col_visc, last) = data.exp_columns[i];
        if last == 0 && entry.report_input.raw_data.is_empty() { continue; }

        let color_rgb = cfg.experiment_colors
            .get(i % cfg.experiment_colors.len().max(1))
            .map(|h| parse_color_hex(h))
            .unwrap_or(DEFAULT_PALETTE[i % DEFAULT_PALETTE.len()]);

        let visc_ls = &cfg.line_settings.viscosity;
        let mut line = ChartLine::new();
        // Scale user-provided width by the shared Excel factor so the
        // comparison chart and the single-exp chart end up with the same
        // perceived stroke weight (see `scaled_line_width` docs).
        line.set_color(Color::RGB(color_rgb))
            .set_width(scaled_line_width(visc_ls.width as f64))
            .set_dash_type(style_to_dash(&visc_ls.style));

        chart.add_series()
            .set_name(&entry.display_name)
            .set_categories((data_sheet_name, 0, col_time, last, col_time))
            .set_values((data_sheet_name, 0, col_visc, last, col_visc))
            .set_format(ChartFormat::new().set_line(&line))
            .set_marker(ChartMarker::new().set_none());
    }

    // ── Threshold reference line ─────────────────────────────────────
    //
    // Renders only the gray dashed-equivalent reference line; we used to
    // also draw a `"500 сП"`-style data label here pinned to the left of
    // the plot area, but Excel's `ChartDataLabelPosition::Left` puts the
    // label *exactly* on the y-coordinate of the data point — which sits
    // on top of the matching Y-axis tick label whenever the threshold
    // value happens to be a round, tick-aligned number (the common case:
    // 200 / 500 / 1000 cP).  See user feedback 2026-04-25 with the
    // overlapping `500` screenshot.  The threshold value is still fully
    // visible to the reader through the touch-points table heading
    // (`Точки касания (порог 500 сП)`) directly under the chart, so we
    // don't lose any information by dropping the on-chart text.
    if let Some((tc, vc)) = data.threshold_cells {
        let mut thresh_line = ChartLine::new();
        thresh_line
            .set_color(Color::RGB(0x808080))
            .set_width(0.75);

        chart.add_series()
            .set_categories((data_sheet_name, 0, tc, 1, tc))
            .set_values((data_sheet_name, 0, vc, 1, vc))
            .set_format(ChartFormat::new().set_line(&thresh_line))
            .set_marker(ChartMarker::new().set_none())
            .delete_from_legend(true);
    }

    // ── Touch-point marker series (small diamonds, professional) ────
    //
    // Every touch-point adds its own one-point series so the marker can
    // sit at an exact `(time, viscosity)` coordinate.  With N experiments
    // and both threshold + target-time overlays enabled this produces
    // `2·N` extra series on top of the N main lines — if we let Excel
    // legend them, users see 3·N entries dominated by redundant
    // "<exp> — порог / — на K мин" duplicates (cf. the cluttered legend
    // screenshot attached to the feature request).
    //
    // Hiding every marker series from the legend via
    // `.delete_from_legend(true)` keeps the visual overlay on the chart
    // intact while collapsing the legend to the N experiment lines.
    // Tooltips still show the per-marker `name` we compute for
    // accessibility / hover context, just not the legend rail.
    let (tp_tc, tp_vc) = data.tp_cols;
    for tp in &data.touch_points {
        let color_rgb = cfg.experiment_colors
            .get(tp.exp_index % cfg.experiment_colors.len().max(1))
            .map(|h| parse_color_hex(h))
            .unwrap_or(DEFAULT_PALETTE[tp.exp_index % DEFAULT_PALETTE.len()]);

        let mut no_line = ChartLine::new();
        no_line.set_width(0.0).set_color(Color::RGB(color_rgb));

        let mut marker = ChartMarker::new();
        marker
            .set_type(ChartMarkerType::Diamond)
            .set_size(5)
            .set_format(
                ChartFormat::new()
                    .set_solid_fill(ChartSolidFill::new().set_color(Color::RGB(color_rgb)))
                    .set_line(ChartLine::new().set_color(Color::White).set_width(0.75)),
            );

        // Keep the per-marker tooltip descriptive; the legend won't
        // display it thanks to `delete_from_legend(true)` below.
        let tp_label = match tp.tp_type {
            TouchPointType::Threshold => {
                if is_ru {
                    format!("{} — порог", &input.experiments[tp.exp_index].display_name)
                } else {
                    format!("{} — threshold", &input.experiments[tp.exp_index].display_name)
                }
            }
            TouchPointType::Target => {
                if is_ru {
                    format!("{} — на {} мин", &input.experiments[tp.exp_index].display_name, cfg.touch_point.target_time as i32)
                } else {
                    format!("{} — at {} min", &input.experiments[tp.exp_index].display_name, cfg.touch_point.target_time as i32)
                }
            }
        };

        chart.add_series()
            .set_name(&tp_label)
            .set_categories((data_sheet_name, tp.data_row, tp_tc, tp.data_row, tp_tc))
            .set_values((data_sheet_name, tp.data_row, tp_vc, tp.data_row, tp_vc))
            .set_format(ChartFormat::new().set_line(&no_line))
            .set_marker(&marker)
            .delete_from_legend(true);
    }

    // ── Secondary metric series ────────────────────────────────────
    //
    // For each visible secondary metric, add one series per experiment.
    // The series uses the experiment's palette colour but a metric-
    // specific dash/width to visually distinguish it from viscosity.
    for sm in &data.secondary_metrics {
        // Metric-specific line style defaults (same as single-exp chart).
        let (default_dash, default_width) = match sm.metric.as_str() {
            "temperature"      => (ChartLineDashType::Dash,     1.5),
            "shear_rate"       => (ChartLineDashType::Solid,     0.75),
            "pressure"         => (ChartLineDashType::RoundDot, 1.5),
            "bath_temperature" => (ChartLineDashType::Dash,     1.5),
            _                  => (ChartLineDashType::Solid,     1.0),
        };

        // Resolve user-override line_settings for the metric (if any).
        let user_ls = match sm.metric.as_str() {
            "temperature"      => Some(&cfg.line_settings.temperature),
            "shear_rate"       => Some(&cfg.line_settings.shear_rate),
            "pressure"         => Some(&cfg.line_settings.pressure),
            "bath_temperature" => cfg.line_settings.bath_temperature.as_ref()
                                    .or(Some(&cfg.line_settings.temperature)),
            _ => None,
        };

        let metric_label = match sm.metric.as_str() {
            "temperature"      => if is_ru { "Темп." }          else { "Temp" },
            "shear_rate"       => if is_ru { "Скор.сдвига" }    else { "SR" },
            "pressure"         => if is_ru { "Давл." }          else { "Press" },
            "bath_temperature" => if is_ru { "Темп.бани" }      else { "Bath" },
            _                  => "",
        };

        for (i, entry) in input.experiments.iter().enumerate() {
            if i >= sm.exp_cols.len() { break; }
            let (data_col, last_row) = sm.exp_cols[i];
            if last_row == 0 && entry.report_input.raw_data.is_empty() { continue; }

            // Category column = the experiment's time column from primary data.
            let (col_time, _, _) = data.exp_columns[i];

            // Use experiment colour with metric dash style.
            let color_rgb = cfg.experiment_colors
                .get(i % cfg.experiment_colors.len().max(1))
                .map(|h| parse_color_hex(h))
                .unwrap_or(DEFAULT_PALETTE[i % DEFAULT_PALETTE.len()]);

            let mut line = ChartLine::new();
            match user_ls {
                Some(ls) => {
                    line.set_color(Color::RGB(color_rgb))
                        .set_width(scaled_line_width(ls.width as f64))
                        .set_dash_type(style_to_dash(&ls.style));
                }
                None => {
                    line.set_color(Color::RGB(color_rgb))
                        .set_width(scaled_line_width(default_width))
                        .set_dash_type(default_dash);
                }
            }

            let series_name = format!("{} — {}", &entry.display_name, metric_label);

            let series = chart.add_series();
            series
                .set_name(&series_name)
                .set_categories((data_sheet_name, 0, col_time, last_row, col_time))
                .set_values((data_sheet_name, 0, data_col, last_row, data_col))
                .set_format(ChartFormat::new().set_line(&line))
                .set_marker(ChartMarker::new().set_none());
            if sm.on_right {
                series.set_secondary_axis(true);
            }
        }
    }

    // ── Axes ─────────────────────────────────────────────────────────
    let mut grid_line = ChartLine::new();
    grid_line.set_color(Color::Black).set_transparency(80).set_width(0.5);

    let mut axis_font = ChartFont::new();
    axis_font.set_name("Arial").set_size(9);
    let mut label_font = ChartFont::new();
    label_font.set_name("Arial").set_size(10);

    let (x_label, x_num_fmt) = match time_fmt.as_str() {
        "seconds"  => (if is_ru { "Время (сек)" } else { "Time (sec)" }, "#,##0"),
        "hh:mm:ss" => (if is_ru { "Время (чч:мм:сс)" } else { "Time (hh:mm:ss)" }, "[h]:mm:ss"),
        _          => (if is_ru { "Время (мин)" } else { "Time (min)" }, "0"),
    };
    chart.x_axis()
        .set_name(x_label)
        .set_name_font(&label_font)
        .set_font(&axis_font)
        .set_num_format(x_num_fmt)
        .set_min(0.0)
        .set_max(data.global_max_time)
        .set_major_gridlines(true)
        .set_major_gridlines_line(&grid_line);

    // ── Left Y axis — viscosity + any left-side secondary metrics ────
    let mut left_parts: Vec<&str> = vec![
        if is_ru { "Вязкость (сП)" } else { "Viscosity (cP)" }
    ];
    for sm in &data.secondary_metrics {
        if !sm.on_right {
            left_parts.push(match sm.metric.as_str() {
                "temperature"      => if is_ru { "Температура (°C)" }         else { "Temperature (°C)" },
                "shear_rate"       => if is_ru { "Скорость сдвига (1/с)" }    else { "Shear Rate (1/s)" },
                "pressure"         => if is_ru { "Давление (бар)" }           else { "Pressure (bar)" },
                "bath_temperature" => if is_ru { "Темп. бани (°C)" }          else { "Bath Temp (°C)" },
                _                  => "",
            });
        }
    }
    let y_label = left_parts.join(" / ");
    chart.y_axis()
        .set_name(&y_label)
        .set_name_font(&label_font)
        .set_font(&axis_font)
        .set_num_format("#,##0")
        .set_major_gridlines(true)
        .set_major_gridlines_line(&grid_line);

    // ── Right Y2 axis — only when at least one metric is on the right ─
    let mut right_parts: Vec<&str> = Vec::new();
    for sm in &data.secondary_metrics {
        if sm.on_right {
            right_parts.push(match sm.metric.as_str() {
                "temperature"      => if is_ru { "Температура (°C)" }         else { "Temperature (°C)" },
                "shear_rate"       => if is_ru { "Скорость сдвига (1/с)" }    else { "Shear Rate (1/s)" },
                "pressure"         => if is_ru { "Давление (бар)" }           else { "Pressure (bar)" },
                "bath_temperature" => if is_ru { "Темп. бани (°C)" }          else { "Bath Temp (°C)" },
                _                  => "",
            });
        }
    }
    if !right_parts.is_empty() {
        let y2_label = right_parts.join(" / ");
        chart.y2_axis()
            .set_name(&y2_label)
            .set_name_font(&label_font)
            .set_font(&axis_font)
            .set_num_format("0");
    }

    chart.legend().set_position(ChartLegendPosition::Bottom);

    sheet.insert_chart(0, 0, &chart)?;

    // ── Touch-point table below chart (professional styling) ──────────
    // Chart occupies ~30 rows in default sizing.  Start table at row 32.
    let text_start_row: u32 = 32;
    let mut row = text_start_row;

    if !data.touch_points.is_empty() {
        let visc_unit_label = super::super::formatters::get_viscosity_unit(unit_system);
        let threshold_visc = convert_viscosity(cfg.touch_point.viscosity_threshold, unit_system);

        // ── Formats ─────────────────────────────────────────────────
        let section_title_fmt = Format::new()
            .set_bold()
            .set_font_size(11)
            .set_font_color(Color::RGB(0x1E3A5F))
            .set_background_color(Color::RGB(0xEFF6FF))
            .set_border_bottom(FormatBorder::Medium)
            .set_border_color(Color::RGB(0x3B82F6))
            .set_align(FormatAlign::Left)
            .set_align(FormatAlign::VerticalCenter);

        let hdr_fmt = Format::new()
            .set_bold()
            .set_font_size(10)
            .set_font_color(Color::RGB(0x1E293B))
            .set_background_color(Color::RGB(0xF1F5F9))
            .set_border(FormatBorder::Thin)
            .set_border_color(Color::RGB(0xCBD5E1))
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter)
            .set_text_wrap();

        let cell_text = Format::new()
            .set_font_size(10)
            .set_border(FormatBorder::Thin)
            .set_border_color(Color::RGB(0xE2E8F0))
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter);

        let cell_num = Format::new()
            .set_font_size(10)
            .set_num_format("0.0")
            .set_border(FormatBorder::Thin)
            .set_border_color(Color::RGB(0xE2E8F0))
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter);

        let cell_visc = Format::new()
            .set_font_size(10)
            .set_num_format("#,##0")
            .set_border(FormatBorder::Thin)
            .set_border_color(Color::RGB(0xE2E8F0))
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter);

        let cell_text_alt = Format::new()
            .set_font_size(10)
            .set_border(FormatBorder::Thin)
            .set_border_color(Color::RGB(0xE2E8F0))
            .set_background_color(Color::RGB(0xF8FAFC))
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter);

        let cell_num_alt = Format::new()
            .set_font_size(10)
            .set_num_format("0.0")
            .set_border(FormatBorder::Thin)
            .set_border_color(Color::RGB(0xE2E8F0))
            .set_background_color(Color::RGB(0xF8FAFC))
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter);

        let cell_visc_alt = Format::new()
            .set_font_size(10)
            .set_num_format("#,##0")
            .set_border(FormatBorder::Thin)
            .set_border_color(Color::RGB(0xE2E8F0))
            .set_background_color(Color::RGB(0xF8FAFC))
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter);

        // Column widths — 3 columns now (Type column dropped since each
        // section header already conveys the touch-point kind).
        sheet.set_column_width(0, 32.0)?;  // A — Test Name
        sheet.set_column_width(1, 14.0)?;  // B — Time (min)
        sheet.set_column_width(2, 16.0)?;  // C — Viscosity

        // Shared column headers.
        let h_name = if is_ru { "Название теста" } else { "Test Name" };
        let h_time = if is_ru { "Время (мин)" } else { "Time (min)" };
        let h_visc = if is_ru {
            format!("Вязкость ({})", visc_unit_label)
        } else {
            format!("Viscosity ({})", visc_unit_label)
        };

        // Split rows once: threshold-crossings go into the first table,
        // target-time readings into the second.  Preserve the original
        // per-experiment order within each bucket.
        let threshold_rows: Vec<&TouchPointResult> = data.touch_points.iter()
            .filter(|r| matches!(r.tp_type, TouchPointType::Threshold))
            .collect();
        let target_rows: Vec<&TouchPointResult> = data.touch_points.iter()
            .filter(|r| matches!(r.tp_type, TouchPointType::Target))
            .collect();

        // Emit ONE three-column table with the supplied title + filtered
        // row slice.  Returns the row index just below the last data row
        // so the caller can chain a second table below.
        let write_table = |
            sheet: &mut Worksheet,
            row_start: u32,
            title: &str,
            rows: &[&TouchPointResult],
        | -> Result<u32, XlsxError> {
            if rows.is_empty() { return Ok(row_start); }
            let mut r = row_start;

            // Section title (spans all 3 columns).
            sheet.merge_range(r, 0, r, 2, title, &section_title_fmt)?;
            r += 1;

            // Column headers.
            sheet.write_string_with_format(r, 0, h_name, &hdr_fmt)?;
            sheet.write_string_with_format(r, 1, h_time, &hdr_fmt)?;
            sheet.write_string_with_format(r, 2, &h_visc, &hdr_fmt)?;
            sheet.set_row_height(r, 28.0)?;
            r += 1;

            // Data rows with alternating row backgrounds.
            for (idx, tp) in rows.iter().enumerate() {
                let exp_name = &input.experiments[tp.exp_index].display_name;
                let is_alt = idx % 2 == 1;
                let (tf, nf, vf) = if is_alt {
                    (&cell_text_alt, &cell_num_alt, &cell_visc_alt)
                } else {
                    (&cell_text, &cell_num, &cell_visc)
                };
                sheet.write_string_with_format(r, 0, exp_name, tf)?;
                sheet.write_number_with_format(r, 1, tp.time_min, nf)?;
                sheet.write_number_with_format(r, 2, tp.viscosity_display, vf)?;
                r += 1;
            }
            Ok(r)
        };

        // Blank row after chart.
        row += 1;

        // ── Table 1: Threshold crossings ────────────────────────────
        let threshold_title = if is_ru {
            format!("Точки касания (порог {} {})", threshold_visc as i64, visc_unit_label)
        } else {
            format!("Threshold Crossings (threshold {} {})", threshold_visc as i64, visc_unit_label)
        };
        row = write_table(sheet, row, &threshold_title, &threshold_rows)?;

        // Blank separator row between the two tables (only when the second
        // table will actually be rendered).
        if !threshold_rows.is_empty() && !target_rows.is_empty() {
            row += 1;
        }

        // ── Table 2: Viscosity at set time ──────────────────────────
        let target_title = if is_ru {
            format!("Вязкость в заданное время ({} мин)", cfg.touch_point.target_time as i32)
        } else {
            format!("Viscosity at Set Time ({} min)", cfg.touch_point.target_time as i32)
        };
        row = write_table(sheet, row, &target_title, &target_rows)?;

        // Silence the unused-var warning when the second table is empty.
        let _ = row;
    }

    Ok(())
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::super::types::{DataPoint, ReportInput, ReportMetadata, ReportSettings};
    use super::super::types::{
        ComparisonChartConfig, ComparisonExperimentEntry, ComparisonMetrics,
        SectionToggles, TouchPointConfig,
    };

    fn mk_point(t: f64, v: f64) -> DataPoint {
        DataPoint {
            time_sec: t, viscosity_cp: v,
            temperature_c: None, shear_rate: None, shear_stress_pa: None,
            speed_rpm: None, pressure_bar: None, bath_temperature_c: None,
        }
    }

    fn mk_input(test_id: &str, points: Vec<DataPoint>) -> ReportInput {
        ReportInput {
            raw_data: points,
            metadata: ReportMetadata { filename: format!("{}.dat", test_id), test_id: Some(test_id.into()), ..Default::default() },
            cycle_results: vec![], recipe: vec![], water_params: None, cycles: vec![],
            settings: ReportSettings::default(),
            chart_image_base64: None, axis_values: None,
        }
    }

    fn mk_entry(id: &str, display_name: &str, input: ReportInput) -> ComparisonExperimentEntry {
        ComparisonExperimentEntry {
            id: id.into(),
            display_name: display_name.into(),
            report_input: input,
            section_toggles: SectionToggles::default(),
        }
    }

    fn mk_comparison_input(entries: Vec<ComparisonExperimentEntry>) -> ComparisonReportInput {
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
            experiments: entries,
        }
    }

    #[test]
    fn rejects_empty_experiments() {
        let input = mk_comparison_input(vec![]);
        let err = generate_comparison_excel(&input).unwrap_err();
        assert!(err.contains("at least one experiment"));
    }

    #[test]
    fn produces_valid_xlsx_bytes() {
        let e1 = mk_entry("e1", "Chandler", mk_input("T-1", vec![mk_point(0.0, 100.0), mk_point(300.0, 250.0)]));
        let input = mk_comparison_input(vec![e1]);
        let bytes = generate_comparison_excel(&input).expect("generation");
        assert_eq!(&bytes[0..4], b"PK\x03\x04", "should be valid ZIP/XLSX");
        assert!(bytes.len() > 1000);
    }

    #[test]
    fn deterministic_across_runs() {
        let e1 = mk_entry("e1", "A", mk_input("T-1", vec![mk_point(0.0, 100.0)]));
        let e2 = mk_entry("e2", "B", mk_input("T-2", vec![mk_point(0.0, 200.0)]));
        let input = mk_comparison_input(vec![e1, e2]);
        let a = generate_comparison_excel(&input).unwrap();
        let b = generate_comparison_excel(&input).unwrap();
        assert_eq!(a, b, "generation must be byte-deterministic");
    }

    #[test]
    fn three_experiments_produce_workbook_with_six_sheets() {
        // _ChartData (hidden) + Overlap Chart + 3 experiments + DebugInfo = 6 sheets
        let entries = vec![
            mk_entry("e1", "A", mk_input("T-1", vec![mk_point(0.0, 100.0), mk_point(60.0, 200.0)])),
            mk_entry("e2", "B", mk_input("T-2", vec![mk_point(0.0, 150.0), mk_point(60.0, 250.0)])),
            mk_entry("e3", "C", mk_input("T-3", vec![mk_point(0.0, 180.0), mk_point(60.0, 270.0)])),
        ];
        let input = mk_comparison_input(entries);
        let bytes = generate_comparison_excel(&input).expect("generation");
        let as_str = String::from_utf8_lossy(&bytes);
        for n in 1..=6 {
            let needle = format!("xl/worksheets/sheet{}.xml", n);
            assert!(
                as_str.contains(&needle),
                "expected workbook to contain {}",
                needle,
            );
        }
        // _ChartData + Overlap Chart + 3 exps + DebugInfo = 6. No sheet7.
        assert!(!as_str.contains("xl/worksheets/sheet7.xml"));
    }

    #[test]
    fn duplicate_display_names_are_deduplicated() {
        let entries = vec![
            mk_entry("e1", "Report", mk_input("T-1", vec![mk_point(0.0, 100.0)])),
            mk_entry("e2", "Report", mk_input("T-2", vec![mk_point(0.0, 150.0)])),
        ];
        let input = mk_comparison_input(entries);
        let bytes = generate_comparison_excel(&input).expect("generation");
        // Having duplicate sheet names would make save_to_buffer() fail —
        // reaching this point confirms dedupe worked.
        assert!(bytes.len() > 1000);
    }

    #[test]
    fn experiment_name_with_forbidden_chars_is_sanitised() {
        let entries = vec![
            mk_entry("e1", "Report/1[SST]:*?", mk_input("T-1", vec![mk_point(0.0, 100.0)])),
        ];
        let input = mk_comparison_input(entries);
        let bytes = generate_comparison_excel(&input).expect("generation");
        assert!(bytes.len() > 1000);
    }

    #[test]
    fn overlong_name_truncated_to_excel_31_char_limit() {
        let long_name = "Very long experiment name that definitely exceeds the 31-char Excel limit";
        assert!(long_name.len() > EXCEL_SHEET_NAME_MAX_LEN);
        let entries = vec![
            mk_entry("e1", long_name, mk_input("T-1", vec![mk_point(0.0, 100.0)])),
        ];
        let input = mk_comparison_input(entries);
        let bytes = generate_comparison_excel(&input).expect("generation");
        assert!(bytes.len() > 1000);
    }

    #[test]
    fn overlap_chart_sheet_has_chart_xml() {
        // 3 experiments with 10 points each → Overlap Chart sheet must contain
        // a native Excel chart (chart1.xml inside the ZIP).
        let entries: Vec<_> = (0..3).map(|i| {
            let points: Vec<DataPoint> = (0..10)
                .map(|j| mk_point(j as f64 * 60.0, 100.0 + j as f64 * 30.0 + i as f64 * 50.0))
                .collect();
            mk_entry(&format!("e{}", i), &format!("Exp {}", i + 1), mk_input(&format!("T-{}", i + 1), points))
        }).collect();
        let input = mk_comparison_input(entries);
        let bytes = generate_comparison_excel(&input).expect("generation");
        let as_str = String::from_utf8_lossy(&bytes);
        // rust_xlsxwriter stores charts as xl/charts/chart1.xml inside the ZIP.
        assert!(as_str.contains("xl/charts/chart1.xml"),
            "Overlap Chart sheet must embed a native Excel chart");
    }

    #[test]
    fn overlap_chart_with_threshold_generates_successfully() {
        let entries = vec![
            mk_entry("e1", "A", mk_input("T-1", vec![mk_point(0.0, 100.0), mk_point(600.0, 500.0)])),
            mk_entry("e2", "B", mk_input("T-2", vec![mk_point(0.0, 200.0), mk_point(600.0, 400.0)])),
        ];
        let mut input = mk_comparison_input(entries);
        input.comparison_chart.touch_point.enabled = true;
        input.comparison_chart.touch_point.viscosity_threshold = 300.0;
        let bytes = generate_comparison_excel(&input).expect("generation with threshold");
        // Chart XML must be present (threshold adds an extra series).
        let as_str = String::from_utf8_lossy(&bytes);
        assert!(as_str.contains("xl/charts/chart1.xml"),
            "chart must be embedded even with threshold");
        // File should be larger than without threshold (extra series + data).
        let bytes_no_thresh = {
            let mut inp2 = input.clone();
            inp2.comparison_chart.touch_point.enabled = false;
            generate_comparison_excel(&inp2).unwrap()
        };
        assert!(bytes.len() > bytes_no_thresh.len(),
            "threshold variant ({}) must be larger than no-threshold ({})",
            bytes.len(), bytes_no_thresh.len());
    }

    #[test]
    fn touch_point_markers_generate_for_crossing_data() {
        // Build ramp data where viscosity rises through 300 cP threshold.
        let ramp = |offset: f64| -> Vec<DataPoint> {
            (0..20).map(|j| mk_point(
                j as f64 * 60.0,
                100.0 + offset + j as f64 * 30.0,
            )).collect()
        };
        let entries = vec![
            mk_entry("e1", "Exp A", mk_input("T-1", ramp(0.0))),
            mk_entry("e2", "Exp B", mk_input("T-2", ramp(50.0))),
        ];
        let mut input = mk_comparison_input(entries);
        input.comparison_chart.touch_point.enabled = true;
        input.comparison_chart.touch_point.viscosity_threshold = 300.0;
        let bytes_tp = generate_comparison_excel(&input).expect("generation with touch points");

        // With touch points disabled, file is smaller (no marker series).
        let mut input_no_tp = input.clone();
        input_no_tp.comparison_chart.touch_point.enabled = false;
        let bytes_no_tp = generate_comparison_excel(&input_no_tp).unwrap();
        assert!(bytes_tp.len() > bytes_no_tp.len(),
            "touch-point markers must add data: {} vs {}",
            bytes_tp.len(), bytes_no_tp.len());
    }

    // ── Secondary metric tests ──────────────────────────────────────────

    fn mk_point_full(t: f64, v: f64, temp: f64, sr: f64, press: f64, bath: f64) -> DataPoint {
        DataPoint {
            time_sec: t, viscosity_cp: v,
            temperature_c: Some(temp), shear_rate: Some(sr),
            shear_stress_pa: None, speed_rpm: None,
            pressure_bar: Some(press), bath_temperature_c: Some(bath),
        }
    }

    fn mk_input_full(test_id: &str, points: Vec<DataPoint>) -> ReportInput {
        ReportInput {
            raw_data: points,
            metadata: ReportMetadata { filename: format!("{}.dat", test_id), test_id: Some(test_id.into()), ..Default::default() },
            cycle_results: vec![], recipe: vec![], water_params: None, cycles: vec![],
            settings: ReportSettings::default(),
            chart_image_base64: None, axis_values: None,
        }
    }

    fn mk_full_entries() -> Vec<ComparisonExperimentEntry> {
        let ramp = |offset: f64| -> Vec<DataPoint> {
            (0..10).map(|j| mk_point_full(
                j as f64 * 60.0,
                100.0 + offset + j as f64 * 30.0,
                25.0 + j as f64 * 0.5,   // temperature
                10.0 + offset * 0.1,      // shear_rate
                1.0 + j as f64 * 0.1,     // pressure
                20.0 + j as f64 * 0.3,    // bath_temperature
            )).collect()
        };
        vec![
            mk_entry("e1", "Exp A", mk_input_full("T-1", ramp(0.0))),
            mk_entry("e2", "Exp B", mk_input_full("T-2", ramp(50.0))),
        ]
    }

    #[test]
    fn secondary_shear_rate_on_right_produces_larger_file() {
        let entries = mk_full_entries();
        let mut input = mk_comparison_input(entries.clone());
        let bytes_visc_only = generate_comparison_excel(&input).expect("visc-only");

        // Enable shear_rate on the right axis (canonical UI key).
        input.comparison_chart.metrics.secondary = "shear_rate_s1".into();
        let bytes_with_sr = generate_comparison_excel(&input).expect("with shear_rate");

        assert!(bytes_with_sr.len() > bytes_visc_only.len(),
            "shear_rate secondary ({}) must produce larger file than visc-only ({})",
            bytes_with_sr.len(), bytes_visc_only.len());
    }

    #[test]
    fn secondary_temperature_on_left_produces_larger_file() {
        let entries = mk_full_entries();
        let mut input = mk_comparison_input(entries.clone());
        let bytes_visc_only = generate_comparison_excel(&input).expect("visc-only");

        // Put temperature on the LEFT secondary.
        input.comparison_chart.metrics.left_secondary = "temperature_c".into();
        let bytes_with_temp = generate_comparison_excel(&input).expect("with temperature");

        assert!(bytes_with_temp.len() > bytes_visc_only.len(),
            "temperature secondary ({}) must produce larger file than visc-only ({})",
            bytes_with_temp.len(), bytes_visc_only.len());
    }

    #[test]
    fn multiple_secondary_metrics_all_present() {
        let entries = mk_full_entries();
        let mut input = mk_comparison_input(entries.clone());

        // Place shear_rate and temperature as secondaries, pressure as tertiary.
        input.comparison_chart.metrics.left_secondary = "temperature_c".into();
        input.comparison_chart.metrics.secondary = "shear_rate_s1".into();
        input.comparison_chart.metrics.tertiary = "pressure_bar".into();

        let bytes = generate_comparison_excel(&input).expect("multi-metric");
        assert!(bytes.len() > 5000, "multi-metric file must be substantial: {}", bytes.len());

        // Visc-only baseline must be smaller.
        let mut input_base = input.clone();
        input_base.comparison_chart.metrics.left_secondary = "none".into();
        input_base.comparison_chart.metrics.secondary = "none".into();
        input_base.comparison_chart.metrics.tertiary = "none".into();
        let bytes_base = generate_comparison_excel(&input_base).expect("visc-only");

        assert!(bytes.len() > bytes_base.len(),
            "multi-metric ({}) must be larger than visc-only ({})",
            bytes.len(), bytes_base.len());
    }

    #[test]
    fn canonical_keys_are_normalised_for_excel() {
        // Verify that canonical UI keys like "shear_rate_s1" and internal
        // keys like "shear_rate" produce identical workbook bytes.
        let entries = mk_full_entries();

        let mut input_canonical = mk_comparison_input(entries.clone());
        input_canonical.comparison_chart.metrics.secondary = "shear_rate_s1".into();

        let mut input_internal = mk_comparison_input(entries);
        input_internal.comparison_chart.metrics.secondary = "shear_rate".into();

        let bytes_canonical = generate_comparison_excel(&input_canonical).expect("canonical");
        let bytes_internal = generate_comparison_excel(&input_internal).expect("internal");

        assert_eq!(bytes_canonical, bytes_internal,
            "canonical and internal keys must produce identical output");
    }

    #[test]
    fn individual_axis_mode_with_secondary_generates_successfully() {
        // "individual" axis_mode should still work — Excel always uses
        // combined axes, but the code must not crash.
        let entries = mk_full_entries();
        let mut input = mk_comparison_input(entries);
        input.comparison_chart.axis_mode = "individual".into();
        input.comparison_chart.metrics.secondary = "shear_rate_s1".into();
        input.comparison_chart.metrics.left_secondary = "temperature_c".into();
        let bytes = generate_comparison_excel(&input).expect("individual + secondary");
        assert!(bytes.len() > 1000);
    }

    #[test]
    fn bath_temperature_secondary_produces_larger_file() {
        let entries = mk_full_entries();
        let mut input = mk_comparison_input(entries.clone());
        let bytes_base = generate_comparison_excel(&input).expect("base");

        input.comparison_chart.metrics.secondary = "bath_temperature_c".into();
        let bytes_bath = generate_comparison_excel(&input).expect("with bath temp");

        assert!(bytes_bath.len() > bytes_base.len(),
            "bath_temperature secondary ({}) must produce larger file than base ({})",
            bytes_bath.len(), bytes_base.len());
    }
}
