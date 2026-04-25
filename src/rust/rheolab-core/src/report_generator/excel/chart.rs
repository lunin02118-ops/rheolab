//! Scatter-smooth chart construction for the Excel report.
//!
//! The chart references the raw-data columns laid down by [`super::raw_data`]
//! so this module does not touch any data itself — only axis/series/legend
//! configuration.  A dedicated `write_series` helper collapses the five
//! `if input.settings.show_*` blocks from the monolithic version into a
//! single call site per series.

use rust_xlsxwriter::{
    Chart, ChartFont, ChartFormat, ChartLegendPosition, ChartLine, ChartLineDashType,
    ChartMarker, ChartType, Color, Worksheet, XlsxError,
};
use super::super::types::{LineSettings, ReportInput};
use super::super::formatters::time_axis_unit;
use super::raw_data::RAW_DATA_START_COL;

// ── helpers ─────────────────────────────────────────────────────────────

/// Global scale factor applied to **every** data-series line width in
/// the Excel report.  Empirically the rust_xlsxwriter / Office renderer
/// draws lines noticeably thicker than both the Typst PDF export and the
/// in-app uPlot chart at the same nominal point size — users consistently
/// report Excel charts looking "too bold".  A 33 % reduction (keep 67 %)
/// aligns the perceived stroke weight across all three surfaces.
///
/// Applied at the single point where user settings / defaults become a
/// `ChartLine` width so decorative strokes (gridlines, threshold overlay,
/// touch-point marker borders) intentionally stay unscaled.
///
/// `pub(crate)` so the comparison chart (separate module) can reuse the
/// exact same factor without drifting.
pub(crate) const EXCEL_LINE_WIDTH_SCALE: f64 = 0.67;

/// Shrink a nominal line width by [`EXCEL_LINE_WIDTH_SCALE`], clamping to
/// a minimum of 0.25 pt so very thin source widths (e.g. shear-rate's
/// 0.75 default) remain visible on paper.
#[inline]
pub(crate) fn scaled_line_width(nominal: f64) -> f64 {
    (nominal * EXCEL_LINE_WIDTH_SCALE).max(0.25)
}

fn parse_hex_to_rgb(hex: &str) -> u32 {
    let hex = hex.trim_start_matches('#');
    u32::from_str_radix(hex, 16).unwrap_or(0x3B82F6)
}

fn style_to_dash_type(style: &str) -> ChartLineDashType {
    match style {
        "dashed" => ChartLineDashType::Dash,
        "dotted" => ChartLineDashType::RoundDot,
        _ => ChartLineDashType::Solid,
    }
}

/// Apply user-provided line style (if any) onto a [`ChartLine`], falling
/// back to the supplied defaults otherwise.
///
/// Both the user-override and the default-fallback widths are piped
/// through [`scaled_line_width`] — see [`EXCEL_LINE_WIDTH_SCALE`] for the
/// motivation.  This is the only place in the single-exp Excel pipeline
/// where a data-series stroke width is materialised, so scaling here
/// gives the whole chart a consistent visual weight in one shot.
fn apply_line_style(
    line: &mut ChartLine,
    user: Option<&LineSettings>,
    default_rgb: u32,
    default_width: f64,
    default_dash: Option<ChartLineDashType>,
) {
    match user {
        Some(ls) => {
            line.set_color(Color::RGB(parse_hex_to_rgb(&ls.color)))
                .set_width(scaled_line_width(ls.width as f64))
                .set_dash_type(style_to_dash_type(&ls.style));
        }
        None => {
            line.set_color(Color::RGB(default_rgb))
                .set_width(scaled_line_width(default_width));
            if let Some(dash) = default_dash {
                line.set_dash_type(dash);
            }
        }
    }
}

/// Add one data series — a column under `RAW_DATA_START_COL + data_col_offset`.
///
/// `sheet_name` must match the actual worksheet name that hosts the raw
/// data columns.  The comparison assembler uses this to point the chart
/// at per-experiment sheets whose names are user-provided, rather than
/// the hard-coded "Report" literal of the single-experiment path.
fn add_series(
    chart: &mut Chart,
    sheet_name: &str,
    name: &str,
    data_col_offset: u16,
    last_row: u32,
    line: &ChartLine,
    secondary_axis: bool,
) {
    let start_col = RAW_DATA_START_COL as u16;
    let data_col  = start_col + data_col_offset;
    let series = chart.add_series();
    series
        .set_name(name)
        .set_categories((sheet_name, 1, start_col, last_row, start_col))
        .set_values((sheet_name, 1, data_col, last_row, data_col))
        .set_format(ChartFormat::new().set_line(line))
        .set_marker(ChartMarker::new().set_none());
    if secondary_axis {
        series.set_secondary_axis(true);
    } else {
        series.set_secondary_axis(false);
    }
}

// ── main entry point ────────────────────────────────────────────────────

pub(super) fn build_chart(
    sheet: &mut Worksheet,
    sheet_name: &str,
    input: &ReportInput,
    is_ru: bool,
    has_bath: bool,
    max_time_display: f64,
    time_format: &str,
    last_row: u32,
) -> Result<(), XlsxError> {
    // Chart title - base name only (touch points shown in the table)
    let title_text = if is_ru { "Вязкость vs Время" } else { "Viscosity vs Time" };

    let mut chart = Chart::new(ChartType::ScatterSmooth);
    chart.title()
        .set_name(title_text)
        .set_font(ChartFont::new().set_name("Arial").set_size(12));

    // Set chart size - width matches rheological data (statistics) table exactly.
    // Table columns: 9 fixed (Cycle,Time,T,P,n',K',Ks,Kp,R²) + viscosity cols + 3 Bingham (PV,YP,R²B if expert)
    // Excel pixel formula: pixels = floor(col_width_chars * 7) + 5
    //   Col A (width=15) → 15*7+5 = 110 px
    //   Other cols (width=10) → 10*7+5 = 75 px
    let bingham_cols = if input.settings.show_advanced_stats { 3 } else { 0 };
    let stats_col_count = 9 + input.settings.viscosity_shear_rates.len() + bingham_cols;
    let chart_width = (110 + (stats_col_count - 1) * 75) as u32;
    chart.set_width(chart_width);
    chart.set_height(600);

    // Common gridline style
    let mut grid_line = ChartLine::new();
    grid_line.set_color(Color::Black).set_transparency(80).set_width(0.5);

    let line_settings = input.settings.line_settings.as_ref();

    // ── Series 1: Viscosity (always shown, primary axis) ────────────────
    let mut visc_line = ChartLine::new();
    apply_line_style(
        &mut visc_line,
        line_settings.map(|ls| &ls.viscosity),
        0x3B82F6, 2.0, None,
    );
    add_series(
        &mut chart,
        sheet_name,
        if is_ru { "Вязкость" } else { "Viscosity" },
        /* data_col_offset = */ 1,
        last_row, &visc_line, false,
    );

    // ── Series 2: Temperature (secondary axis when shown) ───────────────
    if input.settings.show_temperature {
        let mut temp_line = ChartLine::new();
        apply_line_style(
            &mut temp_line,
            line_settings.map(|ls| &ls.temperature),
            0xEF4444, 1.5, Some(ChartLineDashType::Dash),
        );
        add_series(
            &mut chart,
            sheet_name,
            if is_ru { "Температура" } else { "Temperature" },
            /* data_col_offset = */ 2,
            last_row, &temp_line, true,
        );
    }

    // ── Series 3: Shear Rate (axis follows user setting) ────────────────
    if input.settings.show_shear_rate {
        let is_right = input.settings.shear_rate_axis.trim().to_lowercase() != "left";
        let mut sr_line = ChartLine::new();
        apply_line_style(
            &mut sr_line,
            line_settings.map(|ls| &ls.shear_rate),
            0xA855F7, 0.75, None,
        );
        if line_settings.is_none() {
            // Preserve original transparency behaviour when no user-style given
            sr_line.set_transparency(50);
        }
        add_series(
            &mut chart,
            sheet_name,
            if is_ru { "Скорость сдвига" } else { "Shear Rate" },
            /* data_col_offset = */ 3,
            last_row, &sr_line, is_right,
        );
    }

    // ── Series 4: Pressure (axis follows user setting) ──────────────────
    if input.settings.show_pressure {
        let is_right = input.settings.pressure_axis.trim().to_lowercase() != "left";
        let mut pressure_line = ChartLine::new();
        apply_line_style(
            &mut pressure_line,
            line_settings.map(|ls| &ls.pressure),
            0x22C55E, 1.5, Some(ChartLineDashType::RoundDot),
        );
        add_series(
            &mut chart,
            sheet_name,
            if is_ru { "Давление" } else { "Pressure" },
            /* data_col_offset = */ 6,
            last_row, &pressure_line, is_right,
        );
    }

    // ── Series 5: Bath Temperature (secondary axis when present) ────────
    if has_bath && input.settings.show_bath_temperature {
        let mut bath_line = ChartLine::new();
        apply_line_style(
            &mut bath_line,
            line_settings.map(|ls| &ls.temperature),
            0xF97316, 1.5, Some(ChartLineDashType::Dash),
        );
        // Force dash style override even when user-style provided
        bath_line.set_dash_type(ChartLineDashType::Dash);
        add_series(
            &mut chart,
            sheet_name,
            if is_ru { "Темп. бани" } else { "Bath Temp" },
            /* data_col_offset = */ 7,
            last_row, &bath_line, true,
        );
    }

    // ── Axes ────────────────────────────────────────────────────────────
    // X-axis title and numeric format follow the resolved `time_format`:
    //   * "minutes"  → "Время (мин)" / "Time (min)",     num_format "0"
    //   * "seconds"  → "Время (с)"   / "Time (sec)",     num_format "0"
    //   * "hh:mm:ss" → "Время (чч:мм:сс)" / "Time (hh:mm:ss)", num_format "[h]:mm:ss"
    // The raw-data column stores values in matching units (min / sec /
    // Excel day-serial fraction) so `set_max(max_time_display)` is valid
    // without any further conversion.
    let lang = if is_ru { "ru" } else { "en" };
    let time_unit = time_axis_unit(time_format, lang);
    let x_axis_name = if is_ru {
        format!("Время ({})", time_unit)
    } else {
        format!("Time ({})", time_unit)
    };
    let x_num_format = match time_format {
        "hh:mm:ss" => "[h]:mm:ss",
        _          => "0", // minutes, seconds, and any unknown value
    };
    chart.x_axis()
        .set_name(&x_axis_name)
        .set_num_format(x_num_format)
        .set_min(0.0)
        .set_max(max_time_display)
        .set_major_gridlines(true)
        .set_major_gridlines_line(&grid_line);

    // Left axis — dynamic label
    let mut left_axis_parts = Vec::new();
    left_axis_parts.push(if is_ru { "Вязкость (сП)" } else { "Viscosity (cP)" });
    if input.settings.show_shear_rate && input.settings.shear_rate_axis.trim().to_lowercase() == "left" {
        left_axis_parts.push(if is_ru { "Скорость сдвига (1/с)" } else { "Shear Rate (1/s)" });
    }
    if input.settings.show_pressure && input.settings.pressure_axis.trim().to_lowercase() == "left" {
        left_axis_parts.push(if is_ru { "Давление (бар)" } else { "Pressure (bar)" });
    }
    let y_axis_name = left_axis_parts.join(" / ");
    chart.y_axis()
        .set_name(&y_axis_name)
        .set_num_format("0")
        .set_major_gridlines(true)
        .set_major_gridlines_line(&grid_line);

    // Right axis — only when something is plotted on it
    let mut right_axis_parts = Vec::new();
    if input.settings.show_temperature {
        right_axis_parts.push(if is_ru { "Температура (°C)" } else { "Temperature (C)" });
    }
    if input.settings.show_shear_rate && input.settings.shear_rate_axis.trim().to_lowercase() != "left" {
        right_axis_parts.push(if is_ru { "Скорость сдвига (1/с)" } else { "Shear Rate (1/s)" });
    }
    if input.settings.show_pressure && input.settings.pressure_axis.trim().to_lowercase() != "left" {
        right_axis_parts.push(if is_ru { "Давление (бар)" } else { "Pressure (bar)" });
    }
    if has_bath && input.settings.show_bath_temperature {
        right_axis_parts.push(if is_ru { "Темп. бани (°C)" } else { "Bath Temp (C)" });
    }
    if !right_axis_parts.is_empty() {
        let y2_axis_name = right_axis_parts.join(" / ");
        chart.y2_axis()
            .set_name(&y2_axis_name)
            .set_num_format("0");
    }

    chart.legend().set_position(ChartLegendPosition::Bottom);

    sheet.insert_chart(0, 0, &chart)?;
    Ok(())
}
