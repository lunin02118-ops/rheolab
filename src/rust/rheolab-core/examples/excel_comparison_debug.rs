//! Fast-iteration debug harness for the comparison Excel report.
//!
//! Run with:
//!   cargo run --manifest-path src/rust/rheolab-core/Cargo.toml \
//!       --example excel_comparison_debug --features excel --release
//!
//! Output: `runtime/excel-debug/` — one `.xlsx` per metric variant.
//!
//! Mirrors the PDF debug harness (`pdf_comparison_debug.rs`) so the same
//! metric-slot matrix is exercised for the Excel path.  Use this to
//! visually verify that secondary metrics (shear rate, temperature,
//! pressure, bath temperature) appear correctly on the overlap chart.
//!
//! Typical iteration loop (~5 s):
//!   1. Edit `excel_comparison.rs`
//!   2. `cargo run --example excel_comparison_debug --features excel --release`
//!   3. Open the `.xlsx` files in Excel / LibreOffice
//!
//! Author note: keep this file lean — it is a developer tool, not a test.

use rheolab_core::report_generator::comparison::{
    generate_comparison_excel, ComparisonChartConfig, ComparisonExperimentEntry, ComparisonMetrics,
    ComparisonReportInput, SectionToggles, TouchPointConfig,
};
use rheolab_core::report_generator::{DataPoint, ReportInput, ReportMetadata, ReportSettings};
use std::fs;
use std::path::PathBuf;

/// Build a synthetic experiment roughly shaped like a fracturing-fluid
/// viscosity decay: fast ramp to peak, then exponential cooldown.
fn mk_experiment(
    id: &str,
    display_name: &str,
    peak_viscosity: f64,
    decay_factor: f64,
    total_hours: f64,
) -> ComparisonExperimentEntry {
    let total_sec = (total_hours * 3600.0) as usize;
    let n = total_sec / 30;
    let raw_data: Vec<DataPoint> = (0..n)
        .map(|i| {
            let t = i as f64 * 30.0;
            let v = if t < 60.0 {
                peak_viscosity * (t / 60.0).powf(1.5)
            } else {
                let decay_t = (t - 60.0) / 3600.0;
                let base = peak_viscosity * (-decay_factor * decay_t).exp();
                let noise = ((i as f64 * 0.173).sin() * 15.0).abs();
                (base + noise).max(50.0)
            };
            let t_sample = 90.0 + (i as f64 * 0.0005).sin() * 3.0;
            let t_bath = {
                let warmup_min = (t / 60.0).min(5.0);
                let target = 98.0 + (i as f64 * 0.0003).cos() * 2.0;
                25.0 + (target - 25.0) * (warmup_min / 5.0)
            };
            let p_base = 5.0 + 70.0 * (1.0 - (-0.5 * (t / 3600.0)).exp());
            let p_bar = p_base + (i as f64 * 0.05).sin() * 3.5;
            DataPoint {
                time_sec: t,
                viscosity_cp: v,
                temperature_c: Some(t_sample),
                shear_rate: Some(100.0 + (i as f64 * 0.02).sin() * 8.0),
                shear_stress_pa: None,
                speed_rpm: None,
                pressure_bar: Some(p_bar),
                bath_temperature_c: Some(t_bath),
            }
        })
        .collect();

    let report_input = ReportInput {
        raw_data,
        metadata: ReportMetadata {
            filename: format!("{id}.dat"),
            test_id: Some(id.into()),
            ..Default::default()
        },
        cycle_results: vec![],
        recipe: vec![],
        water_params: None,
        cycles: vec![],
        settings: ReportSettings::default(),
        chart_image_base64: None,
        axis_values: None,
    };

    ComparisonExperimentEntry {
        id: id.into(),
        display_name: display_name.into(),
        report_input,
        section_toggles: SectionToggles::default(),
    }
}

fn build_experiments() -> Vec<ComparisonExperimentEntry> {
    vec![
        mk_experiment("T-146", "Grace #146", 3000.0, 1.2, 3.0),
        mk_experiment("T-296", "Chandler #296", 2300.0, 1.8, 2.5),
        mk_experiment("T-482", "Mamontov #482", 2250.0, 2.4, 1.8),
    ]
}

fn build_input(left_secondary: &str, secondary: &str, tertiary: &str) -> ComparisonReportInput {
    ComparisonReportInput {
        language: "ru".into(),
        unit_system: "SI".into(),
        company_name: Some("RheoLab Enterprise".into()),
        company_logo_base64: None,
        generated_at: "2027-01-09T00:00:00Z".into(),
        comparison_chart: ComparisonChartConfig {
            metrics: ComparisonMetrics {
                primary: "viscosity_cp".into(),
                left_secondary: left_secondary.into(),
                secondary: secondary.into(),
                tertiary: tertiary.into(),
            },
            // Excel always uses combined axes (no individual mode).
            axis_mode: "shared".into(),
            brush_range: None,
            touch_point: TouchPointConfig {
                enabled: true,
                viscosity_threshold: 400.0,
                show_target_time: true,
                target_time: 60.0,
            },
            line_settings: Default::default(),
            experiment_colors: vec!["#1E90FF".into(), "#FF0000".into(), "#008000".into()],
            time_format: "minutes".into(),
            downsample_mode: "off".into(),
            chart_width: 1400,
            chart_height: 700,
        },
        experiments: build_experiments(),
    }
}

fn main() {
    // Variant matrix — same metric-slot combinations as the PDF harness,
    // but without the axis_mode dimension (Excel always uses combined).
    let variants: &[(&str, &str, &str, &str)] = &[
        // name,                                    left_secondary,  secondary,             tertiary
        ("A_visc_only", "none", "none", "none"),
        (
            "B_shear_left__temp_right",
            "shear_rate_s1",
            "temperature_c",
            "none",
        ),
        ("C_temp_left", "temperature_c", "none", "none"),
        ("D_shear_right", "none", "shear_rate_s1", "none"),
        ("E_pressure_right", "none", "pressure_bar", "none"),
        (
            "F_bath+sample_right",
            "none",
            "bath_temperature_c",
            "temperature_c",
        ),
        (
            "G_shear_left__bath+sample_right",
            "shear_rate_s1",
            "bath_temperature_c",
            "temperature_c",
        ),
        (
            "H_shear_left__pressure+temp_right",
            "shear_rate_s1",
            "pressure_bar",
            "temperature_c",
        ),
        (
            "I_pressure+bath_right",
            "none",
            "pressure_bar",
            "bath_temperature_c",
        ),
        (
            "J_temp_left__shear+pressure_right",
            "temperature_c",
            "shear_rate_s1",
            "pressure_bar",
        ),
    ];

    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or(manifest.clone());
    let out_dir = workspace_root.join("runtime").join("excel-debug");
    fs::create_dir_all(&out_dir).expect("mkdir runtime/excel-debug");

    println!("[excel_debug] generating {} variants...\n", variants.len());

    for (name, left_sec, sec, ter) in variants {
        let input = build_input(left_sec, sec, ter);
        let bytes = generate_comparison_excel(&input)
            .unwrap_or_else(|e| panic!("variant {name} failed: {e}"));

        let path = out_dir.join(format!("{name}.xlsx"));
        fs::write(&path, &bytes).expect("write XLSX");
        println!("  {name:<48} {:>7} bytes → {}", bytes.len(), path.display());
    }

    // Auto-open first on Windows.
    if std::env::args().any(|a| a == "--open") {
        let first = out_dir.join(format!("{}.xlsx", variants[0].0));
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", first.to_str().unwrap_or("")])
            .spawn();
    }

    println!(
        "\n[excel_debug] done — {} variants written\n            output dir → {}",
        variants.len(),
        out_dir.display()
    );
}
