//! Overlap-chart worksheet writer.
//!
//! Builds the visible "Overlap Chart" sheet — chart only + a touch-point
//! text summary table below it.  All series source data lives on the
//! hidden `_ChartData` sheet (populated separately by
//! [`super::layout::write_chart_data_to_sheet`]).

use rust_xlsxwriter::{
    Chart, ChartFont, ChartFormat,
    ChartLegendPosition, ChartLine, ChartLineDashType, ChartMarker, ChartMarkerType,
    ChartSolidFill, ChartType, Color, Format, FormatAlign, FormatBorder,
    Worksheet, XlsxError,
};

use super::super::super::excel::scaled_line_width;
use super::super::super::formatters::convert_viscosity;
use super::super::super::touch_point::TouchPointType;
use super::super::types::ComparisonReportInput;
use super::helpers::{parse_color_hex, style_to_dash, DEFAULT_PALETTE};
use super::layout::{ChartDataLayout, TouchPointResult};

/// Build the Overlap Chart sheet — chart only + touch-point text summary.
/// All source data lives on the hidden `_ChartData` sheet.
pub(super) fn write_overlap_chart_sheet(
    sheet: &mut Worksheet,
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
        let visc_unit_label = super::super::super::formatters::get_viscosity_unit(unit_system);
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
