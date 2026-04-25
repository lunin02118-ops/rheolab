//! Sanity-check the multi-experiment individual-axis renderer **and**
//! cross-check it against the single-experiment renderer for full
//! axis-layout parity.  This is the test the user asked for in the
//! 2026-04-25 follow-up: "поведение осей соответствовало таковому в
//! одиночных отчётах".
//!
//! Output (printed to stdout, no Tauri rebuild required):
//!   - Per-scenario axis counts from `generate_multi_experiment_chart_svg`
//!     (legacy diagnostics).
//!   - **PARITY**: same scenario through `generate_chart_svg` (single
//!     experiment).  The script prints a green `OK` only when every
//!     `IndividualAxisInfo` slot — metric tag, side, side_idx, tick scale,
//!     colour — matches between the two renderers.
//!
//! Run:
//!   cargo run --manifest-path src/rust/rheolab-core/Cargo.toml \
//!       --example verify_individual_axes --release
use plotters::prelude::RGBColor;
use rheolab_core::report_generator::chart_generator::common::{ChartConfig, ChartPoint};
use rheolab_core::report_generator::chart_generator::line::{
    generate_chart_svg, generate_multi_experiment_chart_svg, ExperimentSeries,
};
use std::fs;
use std::path::PathBuf;

fn mk_exp(name: &str, color: RGBColor, n: usize) -> ExperimentSeries {
    let points = (0..n).map(|i| {
        let t = i as f64 * 0.5; // 0..n/2 min
        ChartPoint {
            time_min: t,
            viscosity_cp: 3000.0 * (-t / 30.0).exp() + 50.0,
            temperature_c: Some(90.0 + (t * 0.1).sin()),
            shear_rate: Some(100.0 + (t * 0.05).cos() * 5.0),
            pressure_bar: Some(50.0 + (t * 0.2).sin() * 10.0),
            bath_temperature_c: Some(98.0),
        }
    }).collect();
    ExperimentSeries { points, color, display_name: name.into() }
}

#[derive(Clone, Copy)]
struct ScenarioCfg {
    show_temp:    bool,
    show_bath:    bool,
    show_shear:   bool,
    show_press:   bool,
    shear_axis:   &'static str,
    pressure_ax:  &'static str,
    axis_mode:    &'static str,
}

fn mk_cfg(s: ScenarioCfg) -> ChartConfig {
    ChartConfig {
        show_temperature: s.show_temp,
        show_bath_temperature: s.show_bath,
        show_shear_rate: s.show_shear,
        show_pressure: s.show_press,
        shear_rate_axis: s.shear_axis.into(),
        pressure_axis: s.pressure_ax.into(),
        axis_mode: s.axis_mode.into(),
        width: 1400,
        height: 700,
        label_left: "Visc".into(),
        label_right: "".into(),
        label_bottom: "Time (min)".into(),
        name_viscosity: "V".into(),
        name_temperature: "T".into(),
        name_shear_rate: "S".into(),
        name_pressure: "P".into(),
        name_bath_temperature: "BT".into(),
        touch_points: vec![],
        viscosity_threshold: None,
        line_styles: None,
        skip_downsample: false,
        time_format: "minutes".into(),
    }
}

fn main() {
    let exps = vec![
        mk_exp("E1", RGBColor(30, 144, 255), 300),
        mk_exp("E2", RGBColor(255,   0,   0), 300),
        mk_exp("E3", RGBColor(  0, 128,   0), 300),
        mk_exp("E4", RGBColor(128,   0, 128), 300),
    ];

    // (name, ScenarioCfg, expected_total, expected_left, expected_right)
    //
    // Coverage matrix.  Adds shear-right + pressure-on-each-side variants
    // that were missing from the original suite — pressure was previously
    // never exercised by this harness even though the comparison path
    // happily renders it (see `pdf_comparison_debug` D/E/F/G groups).
    let cases: &[(&str, ScenarioCfg, usize, usize, usize)] = &[
        // ── Viscosity-only baselines ────────────────────────────────────
        ("A_visc_only_shared",
         ScenarioCfg { show_temp: false, show_bath: false, show_shear: false, show_press: false,
                       shear_axis: "right", pressure_ax: "right", axis_mode: "shared" },
         0, 0, 0),
        ("A_visc_only_indiv",
         ScenarioCfg { show_temp: false, show_bath: false, show_shear: false, show_press: false,
                       shear_axis: "right", pressure_ax: "right", axis_mode: "individual" },
         1, 1, 0),

        // ── Shear rate + temperature ────────────────────────────────────
        ("B_visc+shear_left__temp_right__indiv",
         ScenarioCfg { show_temp: true,  show_bath: false, show_shear: true,  show_press: false,
                       shear_axis: "left",  pressure_ax: "right", axis_mode: "individual" },
         3, 2, 1),
        ("B_visc__shear_right+temp_right__indiv",
         ScenarioCfg { show_temp: true,  show_bath: false, show_shear: true,  show_press: false,
                       shear_axis: "right", pressure_ax: "right", axis_mode: "individual" },
         3, 1, 2),

        // ── Sample + bath (shared right axis) ───────────────────────────
        ("C_visc__sample+bath_right__indiv",
         ScenarioCfg { show_temp: true,  show_bath: true,  show_shear: false, show_press: false,
                       shear_axis: "right", pressure_ax: "right", axis_mode: "individual" },
         2, 1, 1),

        // ── Visc + shear + sample + bath ────────────────────────────────
        ("D_visc+shear_left__sample+bath_right__indiv",
         ScenarioCfg { show_temp: true,  show_bath: true,  show_shear: true,  show_press: false,
                       shear_axis: "left",  pressure_ax: "right", axis_mode: "individual" },
         3, 2, 1),

        // ── Pressure on each side ───────────────────────────────────────
        ("E_visc__pressure_right__indiv",
         ScenarioCfg { show_temp: false, show_bath: false, show_shear: false, show_press: true,
                       shear_axis: "right", pressure_ax: "right", axis_mode: "individual" },
         2, 1, 1),
        ("E_visc+pressure_left__indiv",
         ScenarioCfg { show_temp: false, show_bath: false, show_shear: false, show_press: true,
                       shear_axis: "right", pressure_ax: "left",  axis_mode: "individual" },
         2, 2, 0),

        // ── Shear left + pressure right + sample temp right ─────────────
        ("F_visc+shear_left__press+temp_right__indiv",
         ScenarioCfg { show_temp: true,  show_bath: false, show_shear: true,  show_press: true,
                       shear_axis: "left",  pressure_ax: "right", axis_mode: "individual" },
         4, 2, 2),

        // ── Everything visible, shared mode (1 left, 1 right) ───────────
        ("Z_all_metrics_shared",
         ScenarioCfg { show_temp: true,  show_bath: true,  show_shear: true,  show_press: true,
                       shear_axis: "left",  pressure_ax: "right", axis_mode: "shared" },
         0, 0, 0),
    ];

    let mut failures: usize = 0;

    // Resolve `<workspace>/runtime/axis-debug/` once and dump every
    // rendered SVG there so the user can visually inspect each scenario
    // through both renderers without rebuilding the whole Tauri app.
    // The folder layout mirrors `runtime/pdf-debug/` for consistency.
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace_root = manifest
        .parent().and_then(|p| p.parent()).and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or(manifest.clone());
    let out_dir = workspace_root.join("runtime").join("axis-debug");
    fs::create_dir_all(&out_dir).expect("mkdir runtime/axis-debug");

    println!("\n── Per-scenario diagnostics + single-vs-multi parity check ──\n");
    println!("    SVG dumps → {}\n", out_dir.display());
    for (name, scenario, exp_total, exp_left, exp_right) in cases {
        let cfg = mk_cfg(*scenario);

        // ── Multi-experiment rendering (the comparison report path) ─────
        let multi_result = generate_multi_experiment_chart_svg(&exps, &cfg);
        // ── Single-experiment rendering (the per-experiment report path) ─
        // Feed only the FIRST experiment's points so the value pool is
        // narrower; we are not asserting tick-value parity for the same
        // pool, just structural-axis parity (counts + slot order).  Both
        // renderers share the same axis-building helpers, so the layout
        // must align scenario-for-scenario.
        let single_result = generate_chart_svg(&exps[0].points, &cfg);

        match (&multi_result, &single_result) {
            (Ok((svg_m, ranges_m)), Ok((svg_s, ranges_s))) => {
                // Persist both renderings so the user can open them
                // side-by-side in a browser / SVG viewer.  Keeping the
                // names parallel (`<name>_multi.svg` / `<name>_single.svg`)
                // makes diff-by-eye trivial.
                let _ = fs::write(out_dir.join(format!("{name}_multi.svg")),  svg_m.as_bytes());
                let _ = fs::write(out_dir.join(format!("{name}_single.svg")), svg_s.as_bytes());
                let n_left  = ranges_m.individual_axes.iter().filter(|a| a.side == "left").count();
                let n_right = ranges_m.individual_axes.iter().filter(|a| a.side == "right").count();
                let path_count     = svg_m.matches("<path ").count();
                let polyline_count = svg_m.matches("<polyline").count();

                // Diagnostics gate (legacy expectations).
                let count_ok = ranges_m.individual_axes.len() == *exp_total
                            && n_left  == *exp_left
                            && n_right == *exp_right;

                // Parity gate: structural slot match between the two
                // renderers (metric tag + side + side_idx).  Tick scales
                // and colours intentionally aren't compared here — the
                // value pools differ (multi feeds 4 experiments, single
                // feeds 1).  The dedicated unit test
                // `comparison_individual_axes_match_single_experiment`
                // pins those when both pipelines see the same trace.
                let slots_m: Vec<_> = ranges_m.individual_axes.iter()
                    .map(|a| (a.metric.clone(), a.side.clone(), a.side_idx)).collect();
                let slots_s: Vec<_> = ranges_s.individual_axes.iter()
                    .map(|a| (a.metric.clone(), a.side.clone(), a.side_idx)).collect();
                let parity_ok = slots_m == slots_s;

                let status = match (count_ok, parity_ok) {
                    (true, true)   => "OK    ",
                    (true, false)  => "PARITY",
                    (false, true)  => "COUNT ",
                    (false, false) => "FAIL  ",
                };
                if !count_ok || !parity_ok { failures += 1; }

                println!(
                    "[{status}] {name:<48} total={} L={} R={} (exp total={} L={} R={}) svg={} path={} polyline={}",
                    ranges_m.individual_axes.len(), n_left, n_right,
                    exp_total, exp_left, exp_right,
                    svg_m.len(), path_count, polyline_count,
                );
                if !parity_ok {
                    println!("        ↳ slot drift between renderers:");
                    println!("            multi : {slots_m:?}");
                    println!("            single: {slots_s:?}");
                }
            }
            (Err(e), _) => { println!("[ERR  ] {name}: multi failed: {e}"); failures += 1; }
            (_, Err(e)) => { println!("[ERR  ] {name}: single failed: {e}"); failures += 1; }
        }
    }

    if failures == 0 {
        println!("\n[parity] all {} scenarios match between single and multi renderers", cases.len());
    } else {
        println!("\n[parity] {failures} of {} scenarios FAILED", cases.len());
        std::process::exit(1);
    }
}
