//! Sprint 1 / S1-2 — analysis-pipeline microbench for P10 validation.
//!
//! Sister bench to `bench_comparison_pdf.rs`.  Where the PDF bench
//! measured Typst + plotters + chart layout, **this** bench measures
//! the pure-CPU analysis path P10 was actually designed for:
//!
//!     detect_schedule  →  filter_parasitic_steps  →
//!     detect_cycles_native  →  process_all_cycles
//!         ├─ process_cycle_internal  (mixing-step removal)
//!         └─ calculate_grace_internal (Bingham + Power Law fits)
//!
//! That chain is the body of `analysis_analyze_full` in
//! `src-tauri/src/commands/analysis/commands.rs`.  We replicate it
//! here from `rheolab_core` public primitives — the two src-tauri
//! orchestration helpers (`detect_cycles_native`, `process_all_cycles`)
//! are only `pub(crate)`/`pub(super)` so we vendor them inline.
//!
//! ## Why it lives in `src-tauri/examples/`
//!
//! Same reason as the PDF bench: the `[profile.release.package.*]`
//! overrides P10 added live in `src-tauri/Cargo.toml` and only apply
//! when `rheolab-core` is compiled as a path-dep of `src-tauri`.
//! Building from `rheolab-core/` standalone would silently miss them.
//!
//! ## Why this is the *interesting* P10 measurement
//!
//! `calculate_grace_internal` runs Bingham + Power Law least-squares
//! fits over hundreds of (rate, stress) pairs per cycle, with `f64`
//! `powf` + `ln` calls in the hot path.  `detect_schedule` does
//! sliding-window rate clustering with relative-tolerance comparisons
//! across thousands of points.  Both are **CPU-bound, allocation-light,
//! tight numeric loops** — exactly the workload that benefits from
//! `opt-level=3`'s aggressive vectorisation, inlining, and unrolling.
//!
//! If P10 doesn't help here, it doesn't help anywhere in the codebase.
//!
//! ## Usage
//!
//! ```pwsh
//! cargo build --release --example bench_analysis_pipeline --manifest-path src-tauri/Cargo.toml
//! ./src-tauri/target/release/examples/bench_analysis_pipeline.exe --n 1 --iterations 5 --duration-hours 4
//! ```
//!
//! Or via the orchestrator:
//!
//! ```pwsh
//! npm run perf:microbench:analysis
//! ```
use std::env;
use std::fs;
use std::process;
use std::time::Instant;

use rheolab_core::parasitic_filter::filter_parasitic_steps;
use rheolab_core::schedule_detector::{detect_schedule, ScheduleConfig};
use rheolab_core::types::{RheoCycle, RheoPoint, RheoStep};
use rheolab_core::{
    calculate_grace_internal, detect_anchor_cycles_internal,
    detect_repeating_sequence_cycles_internal, detect_sst_cycles_internal,
    is_repeating_sequence_pattern, is_sst_pattern, process_cycle_internal, ExpertSettings,
    GraceCycleResult, GraceInputParams,
};

#[derive(Debug)]
struct Args {
    /// Number of `analyze_full`-equivalent calls per timed iteration.
    /// Mirrors the PDF bench's `--n` so the orchestrator can sweep
    /// both targets with the same `--fixtures` syntax.
    n: usize,
    iterations: usize,
    duration_hours: f64,
    json_output: Option<String>,
    label: Option<String>,
    quiet: bool,
}

impl Args {
    fn parse() -> Self {
        let mut args = Args {
            n: 1,
            iterations: 5,
            duration_hours: 4.0,
            json_output: None,
            label: None,
            quiet: false,
        };
        let mut iter = env::args().skip(1);
        while let Some(arg) = iter.next() {
            match arg.as_str() {
                "--n" => args.n = parse_required::<usize>(&mut iter, "--n"),
                "--iterations" => args.iterations = parse_required::<usize>(&mut iter, "--iterations"),
                "--duration-hours" => {
                    args.duration_hours = parse_required::<f64>(&mut iter, "--duration-hours")
                }
                "--json" => args.json_output = Some(require_str(&mut iter, "--json")),
                "--label" => args.label = Some(require_str(&mut iter, "--label")),
                "--quiet" => args.quiet = true,
                "--help" | "-h" => {
                    print_help();
                    process::exit(0);
                }
                other => {
                    eprintln!("unknown argument: {}", other);
                    print_help();
                    process::exit(2);
                }
            }
        }
        if args.n == 0 || args.iterations == 0 || args.duration_hours <= 0.0 {
            eprintln!("invalid arguments: n, iterations, duration-hours must be positive");
            process::exit(2);
        }
        args
    }
}

fn parse_required<T: std::str::FromStr>(
    iter: &mut impl Iterator<Item = String>,
    name: &str,
) -> T {
    iter.next()
        .and_then(|v| v.parse().ok())
        .unwrap_or_else(|| {
            eprintln!("{} requires a valid value", name);
            process::exit(2);
        })
}

fn require_str(iter: &mut impl Iterator<Item = String>, name: &str) -> String {
    iter.next().unwrap_or_else(|| {
        eprintln!("{} requires a value", name);
        process::exit(2);
    })
}

fn print_help() {
    println!("Usage: bench_analysis_pipeline [OPTIONS]");
    println!();
    println!("Options:");
    println!("  --n N                 analyze_full calls per timed iteration (default: 1)");
    println!("  --iterations K        Iterations to run (default: 5)");
    println!("  --duration-hours H    Per-call data duration in hours (default: 4.0)");
    println!("  --json PATH           Write results as JSON to PATH (sidecar)");
    println!("  --label TEXT          Free-form label written into the JSON sidecar");
    println!("  --quiet               Suppress per-iteration progress lines on stderr");
    println!("  --help, -h            Show this help");
}

// ── Synthetic fixture: API RP 39 schedule ───────────────────────────────────
//
// We build a deterministic raw-point trace that imitates an API RP 39
// rheology test: repeating cycles of [mixing, ramp-down, ramp-up, mixing]
// at a fixed sampling rate.  The fluid follows a power-law model
// (n' = 0.8, K = 0.5 Pa·sⁿ) so `calculate_grace_internal` actually has
// non-trivial regression work to do — otherwise the Power-Law fit
// degenerates to a flat line and the bench understates real CPU cost.

const STEP_DURATION_SEC: f64 = 60.0;            // 1 min per step (typical API)
const STEPS_PER_CYCLE: usize = 8;               // mixing, 100,75,50,25,25,50,75,100 mixing
const SAMPLING_HZ: f64 = 1.0;                   // 1 Hz raw point rate (typical)
const N_PRIME: f64 = 0.8;                       // Power-law exponent
const K_PASN: f64 = 0.5;                        // Power-law consistency (Pa·sⁿ)
const PAS_TO_CP: f64 = 1000.0;                  // Pa·s → cP

/// Shear-rate schedule, one entry per step within one cycle.
/// Mimics API RP 39 ramp-down + ramp-up with mixing at ends.
const SHEAR_RATE_PROFILE: [f64; STEPS_PER_CYCLE] = [
    100.0, 75.0, 50.0, 25.0, 25.0, 50.0, 75.0, 100.0,
];

/// Build a synthetic rheometer trace covering `duration_hours` hours.
/// Returns (points, cycle_count).
fn synthesise_trace(duration_hours: f64) -> (Vec<RheoPoint>, usize) {
    let total_sec = duration_hours * 3600.0;
    let cycle_duration_sec = STEP_DURATION_SEC * STEPS_PER_CYCLE as f64;
    let n_cycles = (total_sec / cycle_duration_sec).floor() as usize;
    let n_cycles = n_cycles.max(1); // always at least one cycle

    let points_per_step = (STEP_DURATION_SEC * SAMPLING_HZ) as usize;
    let dt = 1.0 / SAMPLING_HZ;

    let mut points = Vec::with_capacity(n_cycles * STEPS_PER_CYCLE * points_per_step);
    let mut t: f64 = 0.0;
    let mut idx = 0usize;

    for _cycle in 0..n_cycles {
        for &rate in SHEAR_RATE_PROFILE.iter() {
            for _ in 0..points_per_step {
                // Power-law stress with mild deterministic noise so the
                // R² fit is realistic (not a perfect 1.000).
                let noise = ((idx as f64 * 0.137).sin() * 0.04 + 1.0).max(0.5);
                let stress = K_PASN * rate.powf(N_PRIME) * noise;
                let viscosity = (stress / rate) * PAS_TO_CP;

                // Mild temperature drift around 90 °C, mild pressure ramp.
                let temp = 90.0 + (t / 3600.0).sin() * 1.5;
                let pressure = 5.0 + 70.0 * (1.0 - (-0.5 * (t / 3600.0)).exp());

                points.push(RheoPoint {
                    time_sec: t,
                    viscosity_cp: viscosity,
                    temperature_c: temp,
                    shear_rate: Some(rate),
                    shear_stress: Some(stress),
                    pressure_bar: Some(pressure),
                    rpm: None,
                    bath_temperature_c: None,
                });

                t += dt;
                idx += 1;
            }
        }
    }

    (points, n_cycles)
}

// ── Vendored pipeline orchestrators ─────────────────────────────────────────
//
// These mirror `detect_cycles_native` (cycle_detection.rs) and
// `process_all_cycles` (cycle_processing.rs) from `src-tauri/src/commands/
// analysis/`.  They are `pub(crate)` / `pub(super)` there, so we copy
// the bodies — same logic, same calls, same output shape.  If those
// helpers ever drift in src-tauri we'd want to keep this in sync, but
// for a P10 validation tool a snapshot is fine and the vendored copy
// is intentionally short and self-contained.

fn vendored_detect_cycles(steps: &[RheoStep]) -> Vec<RheoCycle> {
    if steps.is_empty() {
        return Vec::new();
    }
    if is_sst_pattern(steps) {
        return detect_sst_cycles_internal(steps);
    }
    if is_repeating_sequence_pattern(steps) {
        if let Some(cycles) = detect_repeating_sequence_cycles_internal(steps) {
            if cycles.len() >= 2 {
                return cycles;
            }
        }
    }
    let anchor_cycles = detect_anchor_cycles_internal(steps);
    if !anchor_cycles.is_empty() {
        return anchor_cycles;
    }
    let duration: f64 = steps.iter().map(|s| s.duration).sum();
    vec![RheoCycle {
        id: 1,
        cycle_index: Some(1),
        cycle_type: "Custom".to_string(),
        steps: steps.to_vec(),
        description: "Cycle 1".to_string(),
        duration,
    }]
}

fn vendored_process_all_cycles(
    cycles: &[RheoCycle],
    geometry_key: &str,
    settings: &ExpertSettings,
) -> (Vec<RheoCycle>, Vec<(i32, GraceCycleResult)>) {
    let mut results: Vec<(i32, GraceCycleResult)> = Vec::new();
    let mut processed_cycles: Vec<RheoCycle> = Vec::new();

    for cycle in cycles {
        let filtered_steps: Vec<RheoStep> = process_cycle_internal(cycle);

        let pts_avg = settings.points_to_average as usize;
        let processed_steps: Vec<RheoStep> = filtered_steps
            .iter()
            .map(|step| {
                if pts_avg > 0 && step.points.len() >= pts_avg {
                    let pts = &step.points[step.points.len() - pts_avg..];
                    let n = pts.len() as f64;
                    let (sum_sr, sum_ss, sum_vis, sum_temp, sum_press) = pts.iter().fold(
                        (0.0_f64, 0.0_f64, 0.0_f64, 0.0_f64, 0.0_f64),
                        |(sr, ss, vis, temp, press), p| {
                            (
                                sr + p.shear_rate.unwrap_or(0.0),
                                ss + p.shear_stress.unwrap_or(0.0),
                                vis + p.viscosity_cp,
                                temp + p.temperature_c,
                                press + p.pressure_bar.unwrap_or(0.0),
                            )
                        },
                    );
                    RheoStep {
                        avg_shear_rate: sum_sr / n,
                        avg_shear_stress: sum_ss / n,
                        avg_viscosity: sum_vis / n,
                        avg_temperature: sum_temp / n,
                        avg_pressure: sum_press / n,
                        ..step.clone()
                    }
                } else {
                    step.clone()
                }
            })
            .collect();

        let duration: f64 = processed_steps.iter().map(|s| s.duration).sum();
        let processed_cycle = RheoCycle {
            steps: processed_steps.clone(),
            duration,
            ..cycle.clone()
        };

        let mut data_points: Vec<(f64, f64)> = Vec::new();
        for step in &processed_steps {
            let slice = if pts_avg > 0 && !step.points.is_empty() {
                let start = step.points.len().saturating_sub(pts_avg);
                &step.points[start..]
            } else {
                &step.points[..]
            };
            let mut added = 0usize;
            for p in slice {
                let rate = p.shear_rate.unwrap_or(0.0);
                let stress = p.shear_stress.unwrap_or(0.0);
                if rate > 1e-9 && stress > 1e-9 {
                    data_points.push((rate, stress));
                    added += 1;
                }
            }
            if added == 0 && step.avg_shear_rate > 1e-9 && step.avg_shear_stress > 1e-9 {
                data_points.push((step.avg_shear_rate, step.avg_shear_stress));
            }
        }

        if data_points.len() >= 2 {
            let step_count = processed_steps.len().max(1) as f64;
            let start_sec = processed_steps.first().map(|s| s.start_time).unwrap_or(0.0);
            let end_sec = processed_steps.last().map(|s| s.end_time).unwrap_or(start_sec);
            let avg_temp = processed_steps.iter().map(|s| s.avg_temperature).sum::<f64>() / step_count;
            let avg_pressure = processed_steps.iter().map(|s| s.avg_pressure).sum::<f64>() / step_count;
            let params = GraceInputParams {
                cycle_no: cycle.cycle_index.unwrap_or(cycle.id),
                time_min: start_sec / 60.0,
                end_time_min: end_sec / 60.0,
                temp_c: avg_temp,
                pressure_bar: avg_pressure,
            };
            if let Some(grace) =
                calculate_grace_internal(&data_points, geometry_key, settings, &params)
            {
                results.push((cycle.id, grace));
            }
        }

        processed_cycles.push(processed_cycle);
    }

    (processed_cycles, results)
}

/// One full analyze pipeline pass on a single trace.  Returns
/// `(cycles_detected, results_count, points_consumed)` for end-of-run
/// reporting (not used inside the hot timing loop).
fn run_pipeline(
    points: Vec<RheoPoint>,
    detection_settings: &ScheduleConfig,
    settings: &ExpertSettings,
    geometry_key: &str,
) -> (usize, usize, usize) {
    let n_points = points.len();
    let steps = detect_schedule(&points, detection_settings);
    let clean_steps = filter_parasitic_steps(&steps).filtered_steps;
    let cycles = vendored_detect_cycles(&clean_steps);
    let (_processed, results) = vendored_process_all_cycles(&cycles, geometry_key, settings);
    (cycles.len(), results.len(), n_points)
}

fn percentile(samples: &[f64], pct: f64) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let idx = ((sorted.len() as f64 - 1.0) * pct).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn main() {
    let args = Args::parse();

    let detection_settings = ScheduleConfig::default();
    let settings = ExpertSettings {
        points_to_average: 0, // mirror typical UI default; raw averages used
        viscosity_shear_rates: vec![40.0, 100.0, 170.0],
    };
    let geometry_key = "R1B1";

    if !args.quiet {
        eprintln!(
            "[bench] Building {} synthetic trace(s) of {} h each",
            args.n, args.duration_hours
        );
    }

    // Build N traces once, clone per-iteration (the pipeline takes by
    // value; we measure the analyse path, not the synthesis).
    let t_build = Instant::now();
    let traces: Vec<Vec<RheoPoint>> = (0..args.n)
        .map(|_| synthesise_trace(args.duration_hours).0)
        .collect();
    let build_ms = t_build.elapsed().as_secs_f64() * 1000.0;
    let total_points: usize = traces.iter().map(|t| t.len()).sum();
    let n_cycles = synthesise_trace(args.duration_hours).1;

    if !args.quiet {
        eprintln!(
            "[bench] {} trace(s), {} total raw points, ~{} cycles each (input build: {:.1} ms)",
            args.n, total_points, n_cycles, build_ms
        );
        eprintln!("[bench] Running {} iteration(s)...", args.iterations);
    }

    let mut wall_ms_samples: Vec<f64> = Vec::with_capacity(args.iterations);
    let mut last_cycle_count: usize = 0;
    let mut last_result_count: usize = 0;

    for i in 0..args.iterations {
        // Per-iteration trace clones so each pass starts from a fresh
        // owned Vec — matches what the IPC path does (deserialise
        // produces fresh allocations every call).
        let cloned: Vec<Vec<RheoPoint>> = traces.iter().map(|t| t.clone()).collect();

        let t0 = Instant::now();
        let mut cycles_total = 0usize;
        let mut results_total = 0usize;
        for trace in cloned.into_iter() {
            let (c, r, _) = run_pipeline(trace, &detection_settings, &settings, geometry_key);
            cycles_total += c;
            results_total += r;
        }
        let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;
        wall_ms_samples.push(elapsed_ms);
        last_cycle_count = cycles_total;
        last_result_count = results_total;

        if !args.quiet {
            eprintln!(
                "[bench] iter {}/{}: {:.1} ms, {} cycles, {} grace results",
                i + 1,
                args.iterations,
                elapsed_ms,
                cycles_total,
                results_total
            );
        }
    }

    let p50 = percentile(&wall_ms_samples, 0.50);
    let p95 = percentile(&wall_ms_samples, 0.95);
    let min = wall_ms_samples
        .iter()
        .cloned()
        .fold(f64::INFINITY, f64::min);
    let max = wall_ms_samples
        .iter()
        .cloned()
        .fold(f64::NEG_INFINITY, f64::max);
    let mean = wall_ms_samples.iter().sum::<f64>() / wall_ms_samples.len() as f64;

    println!();
    println!("# bench_analysis_pipeline results");
    println!();
    if let Some(label) = &args.label {
        println!("**Label:** `{}`", label);
        println!();
    }
    println!("| Parameter         | Value |");
    println!("|-------------------|------:|");
    println!("| n_traces          | {} |", args.n);
    println!("| duration_hours    | {} |", args.duration_hours);
    println!("| total_points      | {} |", total_points);
    println!("| cycles_per_trace  | {} |", n_cycles);
    println!("| iterations        | {} |", wall_ms_samples.len());
    println!();
    println!("| Metric            | Value |");
    println!("|-------------------|------:|");
    println!("| wall_ms p50       | {:.1} |", p50);
    println!("| wall_ms p95       | {:.1} |", p95);
    println!("| wall_ms min       | {:.1} |", min);
    println!("| wall_ms max       | {:.1} |", max);
    println!("| wall_ms mean      | {:.1} |", mean);
    println!("| cycles (last run) | {} |", last_cycle_count);
    println!("| results (last)    | {} |", last_result_count);

    if let Some(json_path) = args.json_output {
        let label_field = match &args.label {
            Some(l) => format!(",\n  \"label\": \"{}\"", json_escape(l)),
            None => String::new(),
        };
        let samples_json = wall_ms_samples
            .iter()
            .map(|ms| format!("    {{ \"wall_ms\": {:.4} }}", ms))
            .collect::<Vec<_>>()
            .join(",\n");
        let json = format!(
            r#"{{
  "schema": "rheolab.microbench.analysis_pipeline.v1",
  "n_experiments": {n},
  "duration_hours": {dh},
  "total_points": {tp},
  "cycles_per_trace": {cyc},
  "iterations": {it}{label_field},
  "wall_ms": {{
    "p50": {p50:.4},
    "p95": {p95:.4},
    "min": {min:.4},
    "max": {max:.4},
    "mean": {mean:.4}
  }},
  "cycles_last": {cl},
  "results_last": {rl},
  "input_build_ms": {build_ms:.4},
  "samples": [
{samples}
  ]
}}
"#,
            n = args.n,
            dh = args.duration_hours,
            tp = total_points,
            cyc = n_cycles,
            it = wall_ms_samples.len(),
            label_field = label_field,
            p50 = p50,
            p95 = p95,
            min = min,
            max = max,
            mean = mean,
            cl = last_cycle_count,
            rl = last_result_count,
            build_ms = build_ms,
            samples = samples_json,
        );
        if let Err(e) = fs::write(&json_path, &json) {
            eprintln!("[bench] failed to write JSON to {}: {}", json_path, e);
            process::exit(1);
        }
        if !args.quiet {
            eprintln!("[bench] wrote JSON sidecar to {}", json_path);
        }
    }
}
