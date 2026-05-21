//! Multi-experiment comparison chart SVG renderer.
//!
//! Translates the user's UI settings (`ComparisonChartConfig`) into a
//! [`ChartConfig`] and feeds the per-experiment `raw_data` to
//! [`generate_multi_experiment_chart_svg`].  Returns the SVG, the
//! [`ChartRanges`] (used by the Typst overlay to draw matching tick
//! labels) and the populated [`ChartConfig`].

use super::super::super::chart_generator::{
    ChartConfig, ChartLineStyles, ChartPoint, ChartRanges, ChartTouchPoint,
    line::{generate_multi_experiment_chart_svg, ExperimentSeries},
    common::parse_hex_color,
};
use super::super::super::formatters::{
    convert_viscosity, get_viscosity_unit, resolve_units, time_axis_unit,
};
use super::super::super::touch_point::{
    TouchPointInput, SmartTouchPointOptions, calculate_smart_touch_points,
};
use super::super::types::ComparisonReportInput;
use super::touch_points::canonical_to_internal;

/// Render the multi-experiment comparison chart SVG.
pub(super) fn render_comparison_chart(
    input: &ComparisonReportInput,
    is_ru: bool,
) -> Result<(String, ChartRanges, ChartConfig), String> {
    let cfg = &input.comparison_chart;
    let unit_system = &input.unit_system;

    // Per-experiment series: each experiment's raw_data is converted to
    // display units and wrapped as `ExperimentSeries`.
    let mut series: Vec<ExperimentSeries> = Vec::with_capacity(input.experiments.len());
    for (i, entry) in input.experiments.iter().enumerate() {
        let first_time = entry.report_input.raw_data.first().map(|p| p.time_sec).unwrap_or(0.0);
        let points: Vec<ChartPoint> = entry.report_input.raw_data.iter().map(|p| ChartPoint {
            time_min: (p.time_sec - first_time) / 60.0,
            viscosity_cp: convert_viscosity(p.viscosity_cp, unit_system),
            temperature_c: p.temperature_c,
            shear_rate: p.shear_rate,
            pressure_bar: p.pressure_bar,
            bath_temperature_c: p.bath_temperature_c,
        }).collect();

        // Pick palette colour, cycling through the list.
        let color_hex = cfg.experiment_colors
            .get(i % cfg.experiment_colors.len().max(1))
            .cloned()
            .unwrap_or_else(|| "#3B82F6".to_string());
        let color = parse_hex_color(&color_hex);

        series.push(ExperimentSeries {
            points,
            color,
            display_name: entry.display_name.clone(),
        });
    }

    // Build shared-axis ChartConfig for the multi-exp renderer.  Axis
    // labels and per-axis metric names match the single-experiment path
    // (see `pdf/mod.rs::build_report`) so the comparison chart replicates
    // exactly what the user sees in the in-app dashboard.
    let visc_unit = get_viscosity_unit(unit_system);
    let l_visc      = if is_ru { format!("Вязкость ({})", visc_unit) } else { format!("Viscosity ({})", visc_unit) };
    let l_temp      = if is_ru { "Температура (°C)".to_string() }      else { "Temperature (°C)".to_string() };
    let l_shear     = if is_ru { "Скорость сдвига (1/с)".to_string() } else { "Shear Rate (1/s)".to_string() };
    let l_press     = if is_ru { "Давление (бар)".to_string() }         else { "Pressure (bar)".to_string() };
    let l_bath_temp = if is_ru { "Темп. бани (°C)".to_string() }        else { "Bath Temp (°C)".to_string() };

    // Short names used for per-metric axis titles in individual mode.
    let n_visc      = if is_ru { "Вязкость"      } else { "Viscosity" };
    let n_temp      = if is_ru { "Температура"   } else { "Temperature" };
    let n_shear     = if is_ru { "Скор. сдвига"  } else { "Shear Rate" };
    let n_press     = if is_ru { "Давление"      } else { "Pressure" };
    let n_bath_temp = if is_ru { "Темп. бани"    } else { "Bath Temp" };

    // Time-axis label follows the anchor experiment's `rheology_units.
    // time_format` so the comparison chart matches the dashboard the user
    // just saw.  If the anchor has no `rheology_units` override,
    // `resolve_units` returns `"minutes"` and this reduces to the legacy
    // "Время (мин)" / "Time (min)" label.
    let time_fmt = input.experiments
        .first()
        .map(|e| resolve_units(&e.report_input).time_format)
        .unwrap_or_else(|| "minutes".to_string());
    let time_unit = time_axis_unit(&time_fmt, if is_ru { "ru" } else { "en" });
    let l_time = if is_ru {
        format!("Время ({})", time_unit)
    } else {
        format!("Time ({})", time_unit)
    };

    // Visible metrics follow the user's `metrics` selection from the UI.
    // Slot semantics:
    //   - `left_secondary`       → additional LEFT axis
    //   - `secondary` / `tertiary` → additional RIGHT axes
    //   - `primary` is always viscosity (left)
    //
    // Both the production UI dropdown (`comparison-chart-constants.ts`)
    // and historic preset code use **canonical UI keys** like
    // `"shear_rate_s1"` / `"viscosity_cp"`, while the renderer below
    // (and its `ChartConfig::shear_rate_axis` / `show_shear_rate`
    // counterparts) work in **internal short keys** (`"shear_rate"`,
    // `"viscosity"`, …).  `canonical_to_internal` bridges the two so a
    // string mismatch in one slot doesn't silently drop the entire
    // metric from the chart — the user-facing symptom of the
    // 2026-04-25 bug report ("Раздельные оси не работают!").
    let in_left  = |key: &str| canonical_to_internal(&cfg.metrics.left_secondary) == key;
    let in_right = |key: &str|
        canonical_to_internal(&cfg.metrics.secondary)  == key
        || canonical_to_internal(&cfg.metrics.tertiary) == key;
    let in_any   = |key: &str| in_left(key) || in_right(key);

    let show_temperature      = in_any("temperature");
    let show_shear_rate       = in_any("shear_rate");
    let show_pressure         = in_any("pressure");
    let show_bath_temperature = in_any("bath_temperature");

    // Side for movable secondaries.  Default to "right" when the metric is
    // requested on neither side (shouldn't normally happen).
    let shear_rate_axis =
        if in_left("shear_rate") { "left" } else { "right" }.to_string();
    let pressure_axis =
        if in_left("pressure") { "left" } else { "right" }.to_string();

    // ── Axis labels — mirror single-exp `build_report` exactly ────────────
    // Left label: viscosity + whatever other left-side metrics the user
    // placed there, joined with " / " (same separator as the app).
    let mut left_parts: Vec<String> = vec![l_visc.clone()];
    if show_shear_rate && shear_rate_axis == "left" {
        left_parts.push(l_shear.clone());
    }
    if show_pressure && pressure_axis == "left" {
        left_parts.push(l_press.clone());
    }
    let label_left = left_parts.join(" / ");

    // Right label: sample temp + bath temp (both always share the °C axis
    // but list both names when both are visible) + shear/pressure if
    // placed on the right.
    let mut right_parts: Vec<String> = Vec::new();
    if show_temperature {
        right_parts.push(l_temp.clone());
    }
    if show_shear_rate && shear_rate_axis == "right" {
        right_parts.push(l_shear.clone());
    }
    if show_pressure && pressure_axis == "right" {
        right_parts.push(l_press.clone());
    }
    if show_bath_temperature {
        right_parts.push(l_bath_temp.clone());
    }
    let label_right = right_parts.join(" / ");

    // ── Compute touch-point markers for the chart SVG ──────────────
    let mut chart_touch_points: Vec<ChartTouchPoint> = Vec::new();
    if cfg.touch_point.enabled && cfg.touch_point.viscosity_threshold > 0.0 {
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

            let color = cfg.experiment_colors
                .get(i % cfg.experiment_colors.len().max(1))
                .map(|h| parse_hex_color(h))
                .unwrap_or_else(|| parse_hex_color("#3B82F6"));

            for r in &results {
                chart_touch_points.push(ChartTouchPoint {
                    time: r.time,
                    viscosity: convert_viscosity(r.viscosity, unit_system),
                    label: format!("{:.0}", convert_viscosity(r.viscosity, unit_system)),
                    color,
                });
            }
        }
    }

    // ── Dynamic SVG dimensions — fixed 2-cm page margin ───────────────
    // The Typst page margin is pinned to 2 cm left/right in
    // `build_chart_full_page` so the chart frame always sits 2 cm from the
    // page edge regardless of axis count.  That fixes the SVG→pt scale and
    // therefore also fixes the required SVG aspect ratio.
    //
    // A4 landscape body = 595 - top(3.5cm=99pt) - bottom(2cm=57pt) = 439pt.
    // The top/bottom margins intentionally match `build_typst_globals` so the
    // document header lands at the same vertical position as experiment pages.
    //
    // Budget below the chart frame (must fit on the same page):
    //   ~12pt spacer + ~9pt axis label + ~16pt spacer + legend box ≤ 95pt
    //   where the legend box itself scales with line count
    //   (≈ 27pt / 37pt for 2-line / 3-line wraps of 8pt text).
    //
    // Target chart render height = 350pt → leaves ~89pt for everything
    // below the chart, which fits a 3-line legend comfortably even with the
    // aligned header margins above.
    //   Rendered chart height = text_width_pt × svg_h / svg_w
    //   → svg_h = CHART_BODY_TARGET_PT × svg_w / text_width_pt
    const SVG_W: f64 = 1040.0;
    const CHART_BODY_TARGET_PT: f64 = 350.0;
    const A4_LANDSCAPE_W_PT: f64 = 842.0;
    const MARGIN_CM: f64 = 2.0;
    const MARGIN_PT: f64 = MARGIN_CM * 72.0 / 2.54; // ≈ 56.693 pt
    let text_width_pt = A4_LANDSCAPE_W_PT - 2.0 * MARGIN_PT; // ≈ 728.6 pt
    let svg_h_dynamic = ((CHART_BODY_TARGET_PT * SVG_W) / text_width_pt)
        .round()
        .clamp(400.0, 900.0) as u32;

    let chart_config = ChartConfig {
        show_temperature,
        show_shear_rate,
        show_pressure,
        show_bath_temperature,
        shear_rate_axis,
        pressure_axis,
        axis_mode: cfg.axis_mode.clone(),
        width: SVG_W as u32,
        height: svg_h_dynamic,
        label_left,
        label_right,
        label_bottom: l_time.to_string(),
        // Full metric names used by the per-axis title overlay in
        // individual mode — same as the single-exp report.
        name_viscosity:        n_visc.to_string(),
        name_temperature:      n_temp.to_string(),
        name_shear_rate:       n_shear.to_string(),
        name_pressure:         n_press.to_string(),
        name_bath_temperature: n_bath_temp.to_string(),
        touch_points: chart_touch_points,
        viscosity_threshold: if cfg.touch_point.enabled {
            Some(convert_viscosity(cfg.touch_point.viscosity_threshold, unit_system))
        } else {
            None
        },
        line_styles: Some(ChartLineStyles::from(&cfg.line_settings)),
        skip_downsample: matches!(cfg.downsample_mode.as_str(), "off"),
        time_format: time_fmt,
    };

    let (svg, ranges) = generate_multi_experiment_chart_svg(&series, &chart_config)?;
    Ok((svg, ranges, chart_config))
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    // Shared fixtures live in the parent `pdf_comparison` module's
    // `tests` submodule (declared in `mod.rs`).
    use super::super::tests::{mk_entry, mk_input, mk_input_full, mk_input_full_data};

    /// Build a realistic `ChartLineSettings` that mirrors what the UI
    /// sends in production — purple shear-rate, blue viscosity, etc.
    /// The default `ChartLineSettings::default()` leaves every colour as
    /// the empty string, which exercises a different code path and hides
    /// the production regression we want to pin down here.
    fn mk_line_settings_realistic() -> crate::report_generator::types::ChartLineSettings {
        use crate::report_generator::types::{ChartLineSettings, LineSettings};
        ChartLineSettings {
            viscosity:        LineSettings { color: "#3B82F6".into(), width: 2, style: "solid".into() },
            temperature:      LineSettings { color: "#F97316".into(), width: 2, style: "dotted".into() },
            shear_rate:       LineSettings { color: "#A855F7".into(), width: 2, style: "solid".into() },
            pressure:         LineSettings { color: "#22C55E".into(), width: 2, style: "solid".into() },
            rpm:              LineSettings { color: "#06B6D4".into(), width: 2, style: "solid".into() },
            bath_temperature: Some(LineSettings { color: "#EA580C".into(), width: 2, style: "dashed".into() }),
        }
    }

    /// Regression: comparison chart SVG must use dynamic dimensions that
    /// fill the full A4 landscape page body, matching chart_page.rs layout.
    ///
    /// Page margin is pinned to 2 cm = 56.693 pt on both sides, so
    /// text_width_pt = 842 - 2×56.693 = 728.614 pt, and
    /// svg_h = round(350 × 1040 / 728.614) = 500.
    #[test]
    fn comparison_svg_dimensions_match_fixed_2cm_margin() {
        let entries = vec![
            mk_entry("e1", "A", mk_input("T-1", 10)),
            mk_entry("e2", "B", mk_input("T-2", 10)),
        ];
        let input = mk_input_full(entries);
        let (_svg, _ranges, cfg) = render_comparison_chart(&input, true).unwrap();

        // Width must be fixed at 1040 (shared with single-exp).
        assert_eq!(cfg.width, 1040, "SVG width must match single-exp SVG_W=1040");
        // Height must be in the [400, 900] range enforced by the dynamic clamp.
        assert!(
            (400..=900).contains(&cfg.height),
            "SVG height={} must be in [400, 900] clamp range", cfg.height
        );

        // Pin the exact value so drift in MARGIN_CM or CHART_BODY_TARGET_PT
        // is caught immediately.
        assert_eq!(
            cfg.height, 500,
            "SVG height must be 500 for a 2-cm left/right page margin \
             (CHART_BODY_TARGET_PT = 350pt)"
        );

        // Aspect ratio check: rendered height must be ~350pt (the body target).
        let text_width_pt = 842.0 - 2.0 * (2.0 * 72.0 / 2.54); // 728.614
        let rendered_height_pt = text_width_pt * cfg.height as f64 / cfg.width as f64;
        assert!(
            (rendered_height_pt - 350.0).abs() < 1.0,
            "rendered height {rendered_height_pt:.1}pt must match CHART_BODY_TARGET=350pt",
        );
    }

    /// Regression: in individual-axis mode with `leftSecondary = shear_rate`
    /// the rendered SVG must include a shear-rate axis tick column and at
    /// least one data series on the shear-rate scale.  User report
    /// 2026-04-24: "Разхдельные оси сломаны! ... Но не отображается
    /// скорость сдвига!"
    #[test]
    fn individual_mode_with_shear_rate_on_left_draws_shear_rate_series() {
        let mut input = mk_input_full(vec![
            mk_entry("e1", "Exp A", mk_input_full_data("T-1", 20)),
            mk_entry("e2", "Exp B", mk_input_full_data("T-2", 20)),
        ]);
        // User's exact flow: individual mode, shear_rate on left, temp on right.
        input.comparison_chart.axis_mode = "individual".into();
        input.comparison_chart.metrics.left_secondary = "shear_rate".into();
        input.comparison_chart.metrics.secondary = "temperature_c".into();
        input.comparison_chart.line_settings = mk_line_settings_realistic();

        let (_svg, ranges, cfg) = render_comparison_chart(&input, true).unwrap();

        assert!(cfg.show_shear_rate, "cfg.show_shear_rate must be true");
        assert_eq!(cfg.shear_rate_axis, "left", "shear_rate_axis must be 'left'");
        assert!(cfg.show_temperature, "cfg.show_temperature must be true");

        // Chart ranges must expose three individual axes: viscosity (left,
        // idx 0), shear_rate (left, idx 1), temperature (right, idx 0).
        assert_eq!(
            ranges.individual_axes.len(), 3,
            "expected 3 individual axes (viscosity + shear_rate + temperature); got {}: {:?}",
            ranges.individual_axes.len(),
            ranges.individual_axes.iter().map(|a| &a.metric).collect::<Vec<_>>(),
        );
        let shear_axis = ranges.individual_axes.iter()
            .find(|a| a.metric == "shear_rate")
            .expect("shear_rate axis must be present in individual_axes");
        assert_eq!(shear_axis.side, "left", "shear_rate axis must be on the left side");
        assert_eq!(shear_axis.side_idx, 1, "shear_rate axis must be second on the left (side_idx=1)");

        // Also verify the Typst overlay actually emits a shear-rate tick
        // column — the bug report symptom is that the axis label is missing
        // from the PDF, so we assert the axis title appears in the source.
        let (src, _files) = super::super::build_comparison_typst_source(&input).unwrap();
        assert!(
            src.contains("Скор. сдвига") || src.contains("Shear Rate"),
            "shear-rate axis title must appear in the Typst overlay",
        );

        // The shear-rate axis colour (from line_styles default — purple-ish)
        // must colour its tick overlay.  `line_styles` default for shear rate
        // is `#A855F7`, which Typst renders as `rgb(168, 85, 247)`.
        assert!(
            src.contains("rgb(168, 85, 247)"),
            "shear-rate axis colour must appear at least once in the overlay (indicates tick labels drawn)",
        );
    }

    /// Parity gate: the comparison-report individual-axis renderer must
    /// produce **the same** `IndividualAxisInfo` layout (metric, side,
    /// side_idx, plus matching tick scales) as the single-experiment
    /// individual renderer when fed the same effective `ChartConfig`.
    /// This is the explicit guarantee the user spelled out in the
    /// 2026-04-25 follow-up: "поведение осей соответствовало таковому в
    /// одиночных отчётах".  Drift between the two renderers (e.g. a
    /// future tweak that adds an axis to single-exp but not multi-exp)
    /// will trip this test before it reaches the PDF.
    #[test]
    fn comparison_individual_axes_match_single_experiment() {
        use crate::report_generator::chart_generator::{
            ChartConfig, ChartLineStyle, ChartLineStyles, ChartPoint,
            line::{generate_chart_svg, generate_multi_experiment_chart_svg, ExperimentSeries},
            common::parse_hex_color,
        };

        // Build a synthetic per-experiment trace shared by both renderers.
        // Mirrors the shape `mk_input_full_data` uses so the value pools
        // produce identical nice-scale snapping.
        let points: Vec<ChartPoint> = (0..40)
            .map(|i| ChartPoint {
                time_min: (i as f64 * 30.0) / 60.0,
                viscosity_cp: 1500.0 + (i as f64) * 50.0,
                temperature_c: Some(105.0 + (i as f64 % 5.0)),
                shear_rate: Some(40.0 + (i as f64) * 2.0),
                pressure_bar: None,
                bath_temperature_c: None,
            })
            .collect();

        // Same `ChartConfig` for both pipelines — viscosity + shear (left)
        // + temperature (right), individual mode.  Mirrors the user's
        // production layout once `pdf_comparison::render_comparison_chart`
        // has bridged the slot scheme onto these fields.
        let line_styles = ChartLineStyles {
            viscosity:        ChartLineStyle { color: parse_hex_color("#3B82F6"), width: 2, style: "solid".into()  },
            temperature:      ChartLineStyle { color: parse_hex_color("#F97316"), width: 2, style: "dotted".into() },
            shear_rate:       ChartLineStyle { color: parse_hex_color("#A855F7"), width: 2, style: "solid".into()  },
            pressure:         ChartLineStyle { color: parse_hex_color("#22C55E"), width: 2, style: "solid".into()  },
            bath_temperature: ChartLineStyle { color: parse_hex_color("#EA580C"), width: 2, style: "dashed".into() },
        };
        let cfg = ChartConfig {
            show_temperature: true,
            show_shear_rate: true,
            show_pressure: false,
            show_bath_temperature: false,
            shear_rate_axis: "left".into(),
            pressure_axis: "right".into(),
            axis_mode: "individual".into(),
            width: 1400, height: 700,
            label_left:  "Вязкость / Скор. сдвига".into(),
            label_right: "Температура".into(),
            label_bottom:"Время (мин)".into(),
            name_viscosity:       "Вязкость".into(),
            name_temperature:     "Температура".into(),
            name_shear_rate:      "Скор. сдвига".into(),
            name_pressure:        "Давление".into(),
            name_bath_temperature:"Темп. бани".into(),
            touch_points: vec![],
            viscosity_threshold: None,
            line_styles: Some(line_styles),
            skip_downsample: true, // PDF path skips downsampling for full precision
            time_format: "minutes".into(),
        };

        // Single-experiment path.
        let (_svg_s, ranges_s) = generate_chart_svg(&points, &cfg)
            .expect("single-experiment renderer must succeed");

        // Comparison path with N=1 experiment carrying the same trace.
        let exp = ExperimentSeries {
            points: points.clone(),
            color: parse_hex_color("#1E90FF"),
            display_name: "Exp A".into(),
        };
        let (_svg_m, ranges_m) = generate_multi_experiment_chart_svg(&[exp], &cfg)
            .expect("comparison renderer must succeed");

        // ── Same number of axes, same metric in the same slot ──────────
        assert_eq!(
            ranges_s.individual_axes.len(),
            ranges_m.individual_axes.len(),
            "axis count differs between single and comparison renderers: \
             single={:?} multi={:?}",
            ranges_s.individual_axes.iter().map(|a| (&a.metric, &a.side, a.side_idx)).collect::<Vec<_>>(),
            ranges_m.individual_axes.iter().map(|a| (&a.metric, &a.side, a.side_idx)).collect::<Vec<_>>(),
        );
        for (s, m) in ranges_s.individual_axes.iter().zip(ranges_m.individual_axes.iter()) {
            assert_eq!(s.metric,   m.metric,   "metric tag drift");
            assert_eq!(s.side,     m.side,     "axis side drift");
            assert_eq!(s.side_idx, m.side_idx, "side_idx drift");
            // Tick scales must match to the same precision — the same
            // value pool must produce the same `calculate_nice_scale`
            // output in both pipelines.
            assert!((s.min        - m.min       ).abs() < 1e-9, "{} min drift",        s.metric);
            assert!((s.max        - m.max       ).abs() < 1e-9, "{} max drift",        s.metric);
            assert!((s.step       - m.step      ).abs() < 1e-9, "{} step drift",       s.metric);
            assert!((s.minor_step - m.minor_step).abs() < 1e-9, "{} minor_step drift", s.metric);
            // Same line_styles input must produce the same axis colour.
            assert_eq!(s.color_hex.to_lowercase(), m.color_hex.to_lowercase(), "{} colour drift", s.metric);
        }

        // X-axis range parity (time scale built from the same points).
        assert!((ranges_s.x_min - ranges_m.x_min).abs() < 1e-9, "x_min drift");
        assert!((ranges_s.x_max - ranges_m.x_max).abs() < 1e-9, "x_max drift");
        assert!((ranges_s.x_step - ranges_m.x_step).abs() < 1e-9, "x_step drift");
    }

    /// Regression: the **production** UI dropdown emits the canonical
    /// metric key `"shear_rate_s1"` (see
    /// `src/components/comparison/comparison-chart-constants.ts`:
    /// `METRIC_COLORS.shear_rate_s1`, plus `app/dashboard/comparison/page.tsx`
    /// `METRICS = [..., {value: 'shear_rate_s1', label: 'Скор. сдвига'}, ...]`),
    /// **not** `"shear_rate"`.  The previous regression tests above used
    /// the short form `"shear_rate"` and so silently passed even when the
    /// renderer was unable to recognise the production key — exactly the
    /// reason the user's PDF showed only viscosity, no shear-rate axis,
    /// despite the in-app preview rendering both.  This test pins the
    /// production scenario directly: shear rate metric encoded as
    /// `"shear_rate_s1"`, no right-side metrics, individual axis mode.
    #[test]
    fn individual_mode_with_shear_rate_s1_metric_key_draws_shear_rate_series() {
        let mut input = mk_input_full(vec![
            mk_entry("e1", "Exp A", mk_input_full_data("T-1", 20)),
            mk_entry("e2", "Exp B", mk_input_full_data("T-2", 20)),
        ]);
        // Mirror the user's exact comparison toolbar:
        //   СЛЕВА 1: Вязкость        → primary       = "viscosity_cp"
        //   СЛЕВА 2: Скор. сдвига    → leftSecondary = "shear_rate_s1"  ← canonical UI key
        //   СПРАВА 1/2: Выкл         → secondary / tertiary = "none"
        input.comparison_chart.axis_mode = "individual".into();
        input.comparison_chart.metrics.left_secondary = "shear_rate_s1".into();
        input.comparison_chart.metrics.secondary = "none".into();
        input.comparison_chart.metrics.tertiary = "none".into();
        input.comparison_chart.line_settings = mk_line_settings_realistic();

        let (_svg, ranges, cfg) = render_comparison_chart(&input, true).unwrap();

        assert!(
            cfg.show_shear_rate,
            "cfg.show_shear_rate must be true when metric key is 'shear_rate_s1' (production key)",
        );
        assert_eq!(cfg.shear_rate_axis, "left", "shear_rate_axis must be 'left'");

        // With shear rate on the left and nothing on the right we expect
        // exactly two individual axes: viscosity (left, idx 0) and
        // shear_rate (left, idx 1).  No right axes.
        let metrics: Vec<&String> = ranges.individual_axes.iter().map(|a| &a.metric).collect();
        assert!(
            metrics.iter().any(|m| m.as_str() == "shear_rate"),
            "individual_axes must contain a shear_rate axis (got {metrics:?})",
        );
        assert_eq!(
            metrics.len(), 2,
            "expected 2 individual axes (viscosity + shear_rate); got {}: {metrics:?}",
            metrics.len(),
        );
    }

    /// Regression: the SVG rendered for individual mode with shear_rate on
    /// the left must contain **two distinct left-side axis lines** — one
    /// for viscosity (leftmost inside the plot area) and one for shear
    /// rate (pushed further left by `AXIS_SPACING_PX`).  A broken build
    /// that silently collapses multi-axis mode would draw only the
    /// viscosity frame line.
    #[test]
    fn individual_mode_svg_draws_two_left_axis_lines() {
        let mut input = mk_input_full(vec![
            mk_entry("e1", "Exp A", mk_input_full_data("T-1", 20)),
            mk_entry("e2", "Exp B", mk_input_full_data("T-2", 20)),
        ]);
        input.comparison_chart.axis_mode = "individual".into();
        input.comparison_chart.metrics.left_secondary = "shear_rate".into();
        input.comparison_chart.metrics.secondary = "temperature_c".into();
        input.comparison_chart.line_settings = mk_line_settings_realistic();

        let (svg, ranges, _cfg) = render_comparison_chart(&input, true).unwrap();

        // Every axis in `individual_axes` should have a `<path>` or
        // `<line>` drawn in the SVG at the computed x position.  Rather
        // than parse SVG geometry, check that both the viscosity and
        // shear-rate line_style colours appear in the SVG stroke stream.
        let shear_color = ranges.individual_axes.iter()
            .find(|a| a.metric == "shear_rate")
            .map(|a| a.color_hex.clone())
            .expect("shear_rate axis must exist");
        let visc_color = ranges.individual_axes.iter()
            .find(|a| a.metric == "viscosity")
            .map(|a| a.color_hex.clone())
            .expect("viscosity axis must exist");

        assert!(
            svg.contains(&shear_color) || svg.to_lowercase().contains(&shear_color.to_lowercase()),
            "SVG must contain the shear-rate axis colour {shear_color} (indicates axis line drawn)",
        );
        assert!(
            svg.contains(&visc_color) || svg.to_lowercase().contains(&visc_color.to_lowercase()),
            "SVG must contain the viscosity axis colour {visc_color} (indicates axis line drawn)",
        );
    }
}
