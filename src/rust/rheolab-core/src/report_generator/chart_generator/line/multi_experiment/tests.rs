//! Tests for the multi-experiment chart renderer.

use super::*;
use plotters::style::RGBColor;
use crate::report_generator::chart_generator::common::{ChartConfig, ChartPoint};

fn mk_points(n: usize, visc_base: f64, temp_base: f64) -> Vec<ChartPoint> {
    (0..n).map(|i| {
        let t = i as f64;
        ChartPoint {
            time_min: t,
            viscosity_cp: visc_base + t * 5.0,
            temperature_c: Some(temp_base + t * 0.5),
            shear_rate: Some(100.0),
            pressure_bar: None,
            bath_temperature_c: None,
        }
    }).collect()
}

fn mk_config() -> ChartConfig {
    ChartConfig {
        show_temperature: true,
        show_shear_rate: false,
        show_pressure: false,
        show_bath_temperature: false,
        shear_rate_axis: "left".to_string(),
        pressure_axis: "right".to_string(),
        axis_mode: "shared".to_string(),
        width: 1400,
        height: 700,
        label_left: "Viscosity".into(),
        label_right: "Temperature".into(),
        label_bottom: "Time".into(),
        name_viscosity: "V".into(),
        name_temperature: "T".into(),
        name_shear_rate: "S".into(),
        name_pressure: "P".into(),
        name_bath_temperature: "BT".into(),
        touch_points: vec![],
        viscosity_threshold: None,
        line_styles: None,
        skip_downsample: true,
        time_format: String::new(),
    }
}

#[test]
fn renders_two_experiment_svg_with_expected_colours() {
    let experiments = vec![
        ExperimentSeries {
            points: mk_points(10, 500.0, 20.0),
            color: RGBColor(0xFF, 0x00, 0x00),
            display_name: "Exp A".into(),
        },
        ExperimentSeries {
            points: mk_points(10, 700.0, 25.0),
            color: RGBColor(0x00, 0x80, 0x00),
            display_name: "Exp B".into(),
        },
    ];
    let (svg, ranges) = generate_multi_experiment_chart_svg(&experiments, &mk_config())
        .expect("render should succeed");

    assert!(svg.starts_with("<svg"), "expected SVG prefix");
    assert!(svg.contains("#FF0000"), "expected first experiment colour (red)");
    assert!(svg.contains("#008000"), "expected second experiment colour (green)");
    // X range should cover the data (0..9) minutes
    assert!((ranges.x_min - 0.0).abs() < 1e-6);
    assert!((ranges.x_max - 9.0).abs() < 1e-6);
    // Left scale must envelope both experiments' viscosity [500..745]
    assert!(ranges.y_left_min <= 500.0);
    assert!(ranges.y_left_max >= 745.0);
}

#[test]
fn errors_on_empty_experiments() {
    let config = mk_config();
    let err = generate_multi_experiment_chart_svg(&[], &config).unwrap_err();
    assert!(err.contains("No experiments"));
}

#[test]
fn errors_when_all_experiments_empty() {
    let experiments = vec![ExperimentSeries {
        points: vec![],
        color: RGBColor(0, 0, 0),
        display_name: "empty".into(),
    }];
    let err = generate_multi_experiment_chart_svg(&experiments, &mk_config())
        .unwrap_err();
    assert!(err.contains("No data points"));
}

#[test]
fn single_experiment_renders_like_shared_single() {
    // When N=1 the output should be a valid SVG and the axis-mode behaviour
    // should match the shared-axis single-exp path closely enough for smoke.
    let experiments = vec![ExperimentSeries {
        points: mk_points(50, 500.0, 20.0),
        color: RGBColor(0x3B, 0x82, 0xF6),
        display_name: "solo".into(),
    }];
    let (svg, _) = generate_multi_experiment_chart_svg(&experiments, &mk_config()).unwrap();
    assert!(svg.contains("<svg"));
    assert!(svg.contains("#3B82F6"), "single-exp colour should be present");
}

#[test]
fn downsamples_when_skip_flag_false() {
    let mut cfg = mk_config();
    cfg.skip_downsample = false;
    // 10_000 points per experiment → downsample applied → SVG stays reasonably small.
    let experiments = vec![
        ExperimentSeries {
            points: mk_points(10_000, 500.0, 20.0),
            color: RGBColor(0xFF, 0x00, 0x00),
            display_name: "a".into(),
        },
        ExperimentSeries {
            points: mk_points(10_000, 700.0, 25.0),
            color: RGBColor(0x00, 0x80, 0x00),
            display_name: "b".into(),
        },
    ];
    let (svg, _) = generate_multi_experiment_chart_svg(&experiments, &cfg).unwrap();
    // 2 series × 750 pts each ≈ ~30 KB after Plotters; way less than the
    // 20k-pt-per-experiment worst case of ~2 MB.  Sanity check only.
    assert!(svg.len() < 500_000, "SVG should be downsampled; got {} bytes", svg.len());
}

/// **Regression — 2026-04-24 viscosity-reported-dashed bug**
///
/// In the **shared-axis** comparison chart, every metric of a single
/// experiment uses the **same** experiment palette colour (the
/// comparison UI distinguishes metrics by dash style, not hue).  The
/// legacy post-processing collapsed `(stroke, stroke-width)` into a
/// string-replace key, so setting `bath_temperature.style = "dashed"`
/// accidentally re-wrote **every** polyline of that experiment's
/// colour — including viscosity and temperature — to have
/// `stroke-dasharray="8,4"`.
///
/// The user-visible symptom (screenshot attached to the bug report):
/// viscosity curves appeared dashed in the PDF despite being set to
/// `"solid"` in the settings panel.
///
/// Invariant this test locks in: for a single-experiment comparison
/// chart with `viscosity.style = "solid"` and
/// `bath_temperature.style = "dashed"`, exactly **one** polyline
/// attached to that experiment's stroke colour carries
/// `stroke-dasharray`.  Zero would mean the dash overlay is lost;
/// two (or more) is the regressed behaviour.
#[test]
fn dashed_bath_temp_does_not_leak_to_same_coloured_viscosity() {
    use crate::report_generator::types::{LineSettings, ChartLineSettings};

    // Single experiment with a deliberately unique colour so our
    // matcher can find its polylines without clashing with axis
    // colours (#3B82F6 / #F97316 / #475569) or the grid (#C8C8C8).
    let experiments = vec![ExperimentSeries {
        points: (0..15).map(|i| {
            let t = i as f64;
            ChartPoint {
                time_min: t,
                viscosity_cp: 500.0 + t * 10.0,
                temperature_c: Some(40.0 + t * 0.5),
                shear_rate: None,
                pressure_bar: None,
                bath_temperature_c: Some(60.0 + t * 0.2),
            }
        }).collect(),
        color: RGBColor(0x12, 0x34, 0x56), // outside axis / grid palette
        display_name: "regression".into(),
    }];

    // Settings: viscosity solid, temperature solid, bath temp dashed.
    let ls = ChartLineSettings {
        viscosity: LineSettings { color: "#123456".into(), width: 2, style: "solid".into() },
        temperature: LineSettings { color: "#123456".into(), width: 2, style: "solid".into() },
        shear_rate: LineSettings::default(),
        pressure: LineSettings::default(),
        rpm: LineSettings::default(),
        bath_temperature: Some(LineSettings {
            color: "#123456".into(),
            width: 2,
            style: "dashed".into(),
        }),
    };

    let mut cfg = mk_config();
    cfg.show_temperature = true;
    cfg.show_bath_temperature = true;
    cfg.line_styles = Some((&ls).into());

    let (svg, _) = generate_multi_experiment_chart_svg(&experiments, &cfg)
        .expect("render should succeed");

    // Sanity check: experiment colour is actually present.
    assert!(
        svg.contains("#123456"),
        "expected experiment stroke colour #123456 in SVG output",
    );

    // Count polylines attached to the experiment colour that carry
    // `stroke-dasharray`.  With the bug, viscosity + temperature +
    // bath_temp all match → 3.  Correct behaviour: only bath_temp → 1.
    let mut dashed_exp_polylines = 0usize;
    for chunk in svg.split("<polyline").skip(1) {
        // chunk spans up to the next "<polyline" marker; the opening
        // tag we care about is bounded by the first "/>" or ">".
        let tag_end = chunk.find("/>").unwrap_or_else(|| chunk.find(">").unwrap_or(chunk.len()));
        let tag = &chunk[..tag_end];
        let has_exp_colour = tag.contains(r##"stroke="#123456""##);
        let has_dash       = tag.contains("stroke-dasharray");
        if has_exp_colour && has_dash {
            dashed_exp_polylines += 1;
        }
    }

    assert_eq!(
        dashed_exp_polylines, 1,
        "expected exactly 1 dashed polyline (bath_temperature), got {}. \
         Bug symptom: viscosity and/or temperature polylines also received \
         stroke-dasharray because they share the experiment's stroke colour.",
        dashed_exp_polylines,
    );
}

#[test]
fn threshold_line_rendered_when_set() {
    // Compare SVG size with and without a threshold line: the threshold
    // path adds multiple short dashed segments + glyph paths for the
    // label, so its SVG should be meaningfully larger.  Text in Plotters
    // is rendered as `<path>` glyphs (not `<text>`), so we can't assert
    // on the literal label string.
    let mut cfg_no = mk_config();
    cfg_no.viscosity_threshold = None;
    let experiments = vec![ExperimentSeries {
        points: mk_points(10, 500.0, 20.0),
        color: RGBColor(0xAB, 0xCD, 0xEF),
        display_name: "x".into(),
    }];
    let (svg_no, _) = generate_multi_experiment_chart_svg(&experiments, &cfg_no).unwrap();

    let mut cfg_yes = mk_config();
    // Data range for mk_points(10, 500, _) is viscosity ∈ [500, 545].
    // Keep the threshold inside that range so it is actually drawn.
    cfg_yes.viscosity_threshold = Some(520.0);
    let (svg_yes, _) = generate_multi_experiment_chart_svg(&experiments, &cfg_yes).unwrap();

    assert!(
        svg_yes.len() > svg_no.len(),
        "threshold SVG should be larger than without; got {} vs {}",
        svg_yes.len(),
        svg_no.len(),
    );
}
