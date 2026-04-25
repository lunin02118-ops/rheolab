//! Fast-iteration debug harness for the comparison PDF report.
//!
//! Run with:
//!   cargo run --manifest-path src/rust/rheolab-core/Cargo.toml \
//!       --example pdf_comparison_debug --release
//!
//! Output: `runtime/pdf-debug/comparison_debug.pdf` (opens automatically
//! on Windows if the `--open` flag is passed).
//!
//! The fixture here mirrors the 4-experiment case shown in the user's
//! screenshot (mPa·s range up to ~3000, 11+ hours time axis) so margin /
//! layout tweaks can be reviewed visually without rebuilding the Tauri
//! app, re-installing, or re-running the full test suite.
//!
//! Typical iteration loop (~5 s):
//!   1. Edit `pdf_comparison.rs` margin / layout constants
//!   2. `cargo run --example pdf_comparison_debug --release`
//!   3. Reload the resulting PDF in the viewer
//!
//! Author note: keep this file lean — it is a developer tool, not a test.

use rheolab_core::report_generator::comparison::{
    generate_comparison_pdf, ComparisonChartConfig, ComparisonExperimentEntry,
    ComparisonMetrics, ComparisonReportInput, SectionToggles, TouchPointConfig,
};
use rheolab_core::report_generator::pdf::generate_pdf_from_input;
use rheolab_core::report_generator::{
    DataPoint, ReportInput, ReportMetadata, ReportSettings,
};
use std::fs;
use std::path::PathBuf;

/// Mirror of `pdf_comparison::canonical_to_internal` — duplicated here so
/// the debug example can derive `ReportSettings.show_*` flags from the
/// same UI slot strings the comparison renderer normalises internally.
/// Keeping the two copies in sync is trivial: any new alias added to
/// the production helper should be added here too (and vice versa).
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

/// Build a synthetic experiment roughly shaped like a fracturing-fluid
/// viscosity decay: fast ramp to peak, then exponential cooldown.
fn mk_experiment(
    id: &str,
    display_name: &str,
    peak_viscosity: f64,
    decay_factor: f64,
    total_hours: f64,
) -> ComparisonExperimentEntry {
    // 1 sample / 30 s for the requested duration.
    let total_sec = (total_hours * 3600.0) as usize;
    let n = total_sec / 30;
    let raw_data: Vec<DataPoint> = (0..n)
        .map(|i| {
            let t = i as f64 * 30.0;
            // Fast ramp in first 60 s, then exponential decay.
            let v = if t < 60.0 {
                peak_viscosity * (t / 60.0).powf(1.5)
            } else {
                let decay_t = (t - 60.0) / 3600.0; // in hours
                let base = peak_viscosity * (-decay_factor * decay_t).exp();
                // Add mild noise to mimic real instrument traces.
                let noise = ((i as f64 * 0.173).sin() * 15.0).abs();
                (base + noise).max(50.0)
            };
            // Sample temperature (stays near the oven target)
            let t_sample = 90.0 + (i as f64 * 0.0005).sin() * 3.0;
            // Bath temperature: warms up for the first ~5 min, then holds
            // a few degrees above the sample so both traces remain
            // visually distinct on the right-hand axis.
            let t_bath = {
                let warmup_min = (t / 60.0).min(5.0);
                let target = 98.0 + (i as f64 * 0.0003).cos() * 2.0;
                25.0 + (target - 25.0) * (warmup_min / 5.0)
            };
            // Pressure curve: smooth ramp from ~5 bar at rest to ~75 bar
            // under shear, with mild pulsation so the trace stays readable.
            let p_base = 5.0 + 70.0 * (1.0 - (-0.5 * (t / 3600.0)).exp());
            let p_bar  = p_base + (i as f64 * 0.05).sin() * 3.5;
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

/// Shared 4-experiment fixture driving every variant below.
fn build_experiments() -> Vec<ComparisonExperimentEntry> {
    vec![
        mk_experiment("T-146",  "[Отчёт Grace #146 (09.01.2027)]", 3000.0, 1.2, 3.0),
        mk_experiment("T-296",  "[Отчёт Chandler #296 (09.01.2027)]", 2300.0, 1.8, 2.5),
        mk_experiment(
            "T-482",
            "[8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25 #482 (09.01.2027)]",
            2250.0,
            2.4,
            1.8,
        ),
        mk_experiment(
            "T-56",
            "[3.8_2.0_1.0_41C(7801_78)+18BorCat+RCP BorProp(con1000) #56 (09.01.2027)]",
            900.0,
            0.2,
            11.7,
        ),
    ]
}

/// Build a `ComparisonReportInput` for a given metric slot configuration.
///
/// - `left_secondary` → second LEFT axis
/// - `secondary`, `tertiary` → first / second RIGHT axes
/// - `axis_mode`      → "shared" | "individual"
fn build_input(
    left_secondary: &str,
    secondary: &str,
    tertiary: &str,
    axis_mode: &str,
) -> ComparisonReportInput {
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
            axis_mode: axis_mode.into(),
            brush_range: None,
            touch_point: TouchPointConfig {
                enabled: true,
                viscosity_threshold: 400.0,
                // Enable the target-time readout so every variant PDF
                // renders BOTH touch-point tables (threshold + set-time).
                show_target_time: true,
                target_time: 60.0,
            },
            // Per-metric reference colours (used for axis tick colour +
            // axis label colour in the individual mode).  Matches the
            // defaults in `ChartLineStyles::default()` so every metric
            // gets a visually distinct axis column.  `..Default::default()`
            // fills any metric fields we don't override here.
            line_settings: rheolab_core::report_generator::types::ChartLineSettings {
                viscosity: rheolab_core::report_generator::types::LineSettings {
                    color: "#3b82f6".into(), width: 2, style: "solid".into(), // blue
                },
                temperature: rheolab_core::report_generator::types::LineSettings {
                    color: "#ea580c".into(), width: 2, style: "solid".into(), // orange
                },
                shear_rate: rheolab_core::report_generator::types::LineSettings {
                    color: "#16a34a".into(), width: 2, style: "solid".into(), // green
                },
                pressure: rheolab_core::report_generator::types::LineSettings {
                    color: "#9333ea".into(), width: 2, style: "solid".into(), // purple
                },
                bath_temperature: Some(rheolab_core::report_generator::types::LineSettings {
                    color: "#dc2626".into(), width: 2, style: "dashed".into(), // red dashed
                }),
                ..Default::default()
            },
            experiment_colors: vec![
                "#1E90FF".into(),
                "#FF0000".into(),
                "#008000".into(),
                "#800080".into(),
            ],
            time_format: "hh:mm:ss".into(),
            // Disable downsampling so the full curves are visible during
            // debugging (otherwise a smart-downsampled viscosity trace can
            // look like "just a few markers" on a ≥10-hour time axis).
            downsample_mode: "off".into(),
            chart_width: 1400,
            chart_height: 700,
        },
        experiments: build_experiments(),
    }
}

/// Map a comparison-variant slot tuple onto the equivalent
/// single-experiment `ReportSettings`.  The mapping mirrors the bridge
/// in `pdf_comparison::render_comparison_chart` so the resulting axis
/// layout is byte-identical (modulo per-experiment colour / legend) to
/// the comparison PDF — this is what makes side-by-side single-vs-multi
/// PDF inspection useful.
fn settings_from_slots(left_sec: &str, sec: &str, ter: &str, axis_mode: &str) -> ReportSettings {
    let in_left  = |k: &str| canonical_to_internal(left_sec) == k;
    let in_right = |k: &str| canonical_to_internal(sec) == k || canonical_to_internal(ter) == k;
    let in_any   = |k: &str| in_left(k) || in_right(k);

    ReportSettings {
        show_temperature:      in_any("temperature"),
        show_shear_rate:       in_any("shear_rate"),
        show_pressure:         in_any("pressure"),
        show_bath_temperature: in_any("bath_temperature"),
        shear_rate_axis:       if in_left("shear_rate") { "left".into() } else { "right".into() },
        pressure_axis:         if in_left("pressure")   { "left".into() } else { "right".into() },
        axis_mode:             axis_mode.into(),
        // Match comparison defaults — no touch points / minimal sections
        // so the PDF stays focused on axes only.
        ..ReportSettings::default()
    }
}

/// Take the first experiment of the comparison fixture and re-emit it
/// as a single-experiment `ReportInput` carrying the axis settings
/// derived from the same slot tuple.  This is the "what would single-
/// experiment PDF look like with the same axis config?" reference.
fn build_single_input(
    cmp: &ComparisonReportInput,
    left_sec: &str,
    sec: &str,
    ter: &str,
    axis_mode: &str,
) -> ReportInput {
    let anchor = cmp.experiments.first().expect("at least one experiment");
    let mut single = anchor.report_input.clone();
    single.settings = settings_from_slots(left_sec, sec, ter, axis_mode);
    single
}

/// Resolve `<workspace>/runtime/pdf-debug/` once and return both the
/// folder path and the comparison/single output paths for `name`.
fn resolve_paths(name: &str) -> (PathBuf, PathBuf, PathBuf) {
    // Always resolve the output folder relative to the crate root (via
    // CARGO_MANIFEST_DIR) and then walk up two levels to the workspace
    // root.  Using an absolute path avoids "files disappeared" confusion
    // when the example is launched with `cargo run --manifest-path ...`
    // (which sets CWD to the manifest's directory rather than the repo
    // root).
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR")); // .../src/rust/rheolab-core
    let workspace_root = manifest
        .parent().and_then(|p| p.parent()).and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or(manifest.clone());
    let out_dir = workspace_root.join("runtime").join("pdf-debug");
    fs::create_dir_all(&out_dir).expect("mkdir runtime/pdf-debug");
    let cmp_path    = out_dir.join(format!("comparison_{name}.pdf"));
    let single_path = out_dir.join(format!("single_{name}.pdf"));
    (out_dir, cmp_path, single_path)
}

fn write_pdf(label: &'static str, name: &str, target: &PathBuf, bytes: &[u8]) {
    fs::write(target, bytes).expect("write PDF");
    println!(
        "[pdf_debug:{label}] {name:<48} {:>7} bytes → {}",
        bytes.len(),
        target.display()
    );
}

fn main() {
    // Every variant re-uses the same four experiments so side-by-side
    // comparison between PDFs is meaningful.
    //
    // Naming convention:
    //   <letter>_<left-side>__<right-side>_<axis-mode>.pdf
    //     letter      → stable lexical ordering in the folder
    //     left-side   → what metric goes on the left (visc always implicit)
    //     right-side  → metrics on the right axis/axes
    //     axis-mode   → "shared" (one scale per side) or "indiv" (per metric)
    let variants: &[(&str, &str, &str, &str, &str)] = &[
        // name,                                        left_secondary,  secondary,            tertiary,           axis_mode
        ("A1_visc_only__shared",                         "none",          "none",               "none",             "shared"),
        ("A2_visc_only__indiv",                          "none",          "none",               "none",             "individual"),

        ("B1_visc+shear_left__temp_right__shared",       "shear_rate",    "temperature_c",      "none",             "shared"),
        ("B2_visc+shear_left__temp_right__indiv",        "shear_rate",    "temperature_c",      "none",             "individual"),

        // ── Production-key variants ─────────────────────────────────────
        // Mirrors what the live UI dropdown actually sends — the metric
        // value `"shear_rate_s1"` (canonical UI key).  Before the fix
        // shipped on 2026-04-25 this collapsed silently to "no shear
        // axis" because the renderer matched the short literal
        // `"shear_rate"`.  Keep these variants in the harness so a
        // future regression is caught visually with a single
        // `cargo run --example pdf_comparison_debug --release`.
        ("B3_visc+shear_s1_left__off__indiv",            "shear_rate_s1", "none",               "none",             "individual"),
        ("B4_visc+shear_s1_left__temp_c_right__indiv",   "shear_rate_s1", "temperature_c",      "none",             "individual"),

        ("C1_visc_left__bath+sample_right__shared",      "none",          "bath_temperature_c", "temperature_c",    "shared"),
        ("C2_visc_left__bath+sample_right__indiv",       "none",          "bath_temperature_c", "temperature_c",    "individual"),

        ("D1_visc+shear_left__bath+sample_right__shared","shear_rate",    "bath_temperature_c", "temperature_c",    "shared"),
        ("D2_visc+shear_left__bath+sample_right__indiv", "shear_rate",    "bath_temperature_c", "temperature_c",    "individual"),

        // ── Pressure-focused variants ───────────────────────────────────
        // Pressure alone on the right axis.
        ("E1_visc_left__pressure_right__shared",         "none",          "pressure_bar",       "none",             "shared"),
        ("E2_visc_left__pressure_right__indiv",          "none",          "pressure_bar",       "none",             "individual"),

        // Shear left, pressure + sample temperature co-habiting the right
        // axis — exercises the case where pressure shares a side with
        // another metric of a *different* unit (bar vs °C).
        ("F1_visc+shear_left__pressure+temp_right__shared","shear_rate",  "pressure_bar",       "temperature_c",    "shared"),
        ("F2_visc+shear_left__pressure+temp_right__indiv","shear_rate",   "pressure_bar",       "temperature_c",    "individual"),

        // Pressure on the right alongside bath temperature — three
        // metrics competing on the right side (pressure + bath + sample
        // all via bath_temperature_c/temperature_c cannot be requested
        // at once because ComparisonMetrics exposes only 3 slots besides
        // the primary, so we pair pressure with bath here; use F2 for
        // pressure + sample).
        ("G1_visc_left__pressure+bath_right__shared",    "none",          "pressure_bar",       "bath_temperature_c","shared"),
        ("G2_visc_left__pressure+bath_right__indiv",     "none",          "pressure_bar",       "bath_temperature_c","individual"),
    ];

    println!("[pdf_debug] generating {} variants × 2 PDFs (comparison + single)...\n", variants.len());
    let mut first_path: Option<PathBuf> = None;

    // Resolve the debug output directory once so we can point the
    // Typst-source dump at the same folder and keep per-variant .typ
    // files next to each PDF.
    let (out_dir, _, _) = resolve_paths("_seed_");
    std::env::set_var("RHEOLAB_DEBUG_TYPST_DIR", &out_dir);

    for (name, left_sec, sec, ter, mode) in variants {
        let (_, cmp_path, single_path) = resolve_paths(name);

        // ── Comparison PDF (4 experiments stacked) ──────────────────────
        std::env::set_var(
            "RHEOLAB_DEBUG_TYPST_NAME",
            format!("comparison_{name}.typ"),
        );
        let cmp_input = build_input(left_sec, sec, ter, mode);
        let cmp_bytes = generate_comparison_pdf(&cmp_input)
            .unwrap_or_else(|e| panic!("variant {name} failed: {e}"));
        write_pdf("multi ", name, &cmp_path, &cmp_bytes);

        // ── Single-experiment PDF (anchor with mirrored settings) ───────
        // Same trace as the first comparison experiment, but rendered
        // through the per-experiment pipeline so the user can verify the
        // axis layout matches between the two flavours.
        std::env::set_var(
            "RHEOLAB_DEBUG_TYPST_NAME",
            format!("single_{name}.typ"),
        );
        let single_input = build_single_input(&cmp_input, left_sec, sec, ter, mode);
        let single_bytes = generate_pdf_from_input(&single_input)
            .unwrap_or_else(|e| panic!("variant {name} (single) failed: {e}"));
        write_pdf("single", name, &single_path, &single_bytes);

        if first_path.is_none() {
            first_path = Some(cmp_path);
        }
    }
    std::env::remove_var("RHEOLAB_DEBUG_TYPST_DIR");
    std::env::remove_var("RHEOLAB_DEBUG_TYPST_NAME");

    // Auto-open on Windows when `--open` is passed.
    if std::env::args().any(|a| a == "--open") {
        if let Some(p) = first_path {
            let _ = std::process::Command::new("cmd")
                .args(["/C", "start", "", p.to_str().unwrap_or("")])
                .spawn();
        }
    }

    println!("\n[pdf_debug] done — {} variants written ({} PDFs total)", variants.len(), variants.len() * 2);
    println!("            output dir → {}", out_dir.display());
}
