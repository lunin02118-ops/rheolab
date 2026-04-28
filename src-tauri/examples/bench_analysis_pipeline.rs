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
//! `src-tauri/src/commands/analysis/commands.rs`.  S1-4 (2026-04-29)
//! lifted the pipeline body into a `pub fn run_full_analysis_kernel`
//! so this bench calls the same function the IPC handler uses inside
//! `tokio::task::spawn_blocking` — no vendoring, no drift risk.
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

use rheolab_core::schedule_detector::ScheduleConfig;
use rheolab_core::types::RheoPoint;
use rheolab_core::ExpertSettings;
// S1-4: bench now exercises the exact same kernel as the
// `analysis_analyze_full` IPC handler.  Closes the S1-2 vendoring
// drift risk: any future change to the production pipeline shape
// is automatically picked up here.
use rheolab_enterprise::commands::analysis::run_full_analysis_kernel;
// Fixture-mode reuses the production columnar decoder + SQLite reader.
// Both crates are already regular deps of src-tauri (`rusqlite` with the
// `bundled` feature so no system SQLite needed), so the bench picks them
// up for free without touching Cargo.toml.
use rheolab_enterprise::db::columnar::decode_typed;
use rusqlite::{params, Connection};

#[derive(Debug)]
struct Args {
    /// Number of `analyze_full`-equivalent calls per timed iteration.
    /// Mirrors the PDF bench's `--n` so the orchestrator can sweep
    /// both targets with the same `--fixtures` syntax.
    n: usize,
    iterations: usize,
    /// Per-call data duration in hours (synthetic mode only — ignored
    /// when `--load-fixture` is set, where the duration is whatever
    /// the fixture experiment captured).
    duration_hours: f64,
    json_output: Option<String>,
    label: Option<String>,
    quiet: bool,
    /// Optional path to a `rheolab-fixture-seed-*.db` SQLite file.
    /// When set, the bench loads `Vec<RheoPoint>` from a real
    /// experiment instead of synthesising one — useful for
    /// validating that synthetic-fixture P10 gains transfer to
    /// production data.
    load_fixture: Option<String>,
    /// Which experiment to load from the fixture DB.  0-based index
    /// over `SELECT id FROM Experiment ORDER BY rowid LIMIT 1 OFFSET ?`.
    /// Ignored unless `--load-fixture` is set.
    experiment_index: usize,
    /// Sweep across **every** experiment in the fixture DB.  Each
    /// experiment becomes its own measurement (`--iterations` samples
    /// per row), then a corpus-level aggregate is reported.  Forces
    /// `--n=1` (one trace per pass = one experiment's data) and
    /// requires `--load-fixture` (synthetic data has no DB to sweep).
    /// S1-5 (2026-04-29).
    all_experiments: bool,
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
            load_fixture: None,
            experiment_index: 0,
            all_experiments: false,
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
                "--load-fixture" => {
                    args.load_fixture = Some(require_str(&mut iter, "--load-fixture"))
                }
                "--experiment-index" => {
                    args.experiment_index =
                        parse_required::<usize>(&mut iter, "--experiment-index")
                }
                "--all-experiments" => args.all_experiments = true,
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
        if args.n == 0 || args.iterations == 0 {
            eprintln!("invalid arguments: n and iterations must be positive");
            process::exit(2);
        }
        if args.load_fixture.is_none() && args.duration_hours <= 0.0 {
            eprintln!("invalid arguments: duration-hours must be positive in synthetic mode");
            process::exit(2);
        }
        if args.all_experiments && args.load_fixture.is_none() {
            eprintln!("invalid arguments: --all-experiments requires --load-fixture");
            process::exit(2);
        }
        if args.all_experiments && args.n != 1 {
            eprintln!(
                "[bench] --all-experiments forces --n=1 (one trace per pass = one experiment); ignoring --n {}",
                args.n
            );
            args.n = 1;
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
    println!("Synthetic mode (default):");
    println!("  --n N                 analyze_full calls per timed iteration (default: 1)");
    println!("  --iterations K        Iterations to run (default: 5)");
    println!("  --duration-hours H    Per-call data duration in hours (default: 4.0)");
    println!();
    println!("Fixture mode (real production data):");
    println!("  --load-fixture PATH   Path to a rheolab-fixture-seed-*.db SQLite file.");
    println!("                        Switches off synthetic generation; --duration-hours");
    println!("                        is ignored.");
    println!("  --experiment-index I  Which experiment to load (0-based, default: 0).");
    println!("  --all-experiments     Sweep every experiment in the fixture DB and emit");
    println!("                        per-experiment + corpus aggregate stats.  Requires");
    println!("                        --load-fixture; forces --n=1.  S1-5.");
    println!();
    println!("Common:");
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

// ── Fixture loader ──────────────────────────────────────────────────────────
//
// Reads one experiment's raw RheoPoint trace from a fixture seed DB.
// We trust the production decoder (`rheolab_enterprise::db::columnar::
// decode_typed`) to validate the blob and surface decoder errors.

/// Metadata returned alongside a fixture trace, useful for the JSON
/// sidecar so a future re-run can identify exactly which experiment
/// the numbers came from.
#[derive(Debug, Clone)]
struct FixtureMeta {
    experiment_id: String,
    experiment_name: String,
    instrument_type: String,
    geometry: Option<String>,
    point_count: usize,
    duration_sec: f64,
}

/// Single-experiment loader.  Fatal on any error — callers that want
/// to skip a broken row should use [`try_load_experiment_at`].
fn load_fixture_trace(db_path: &str, experiment_index: usize) -> (Vec<RheoPoint>, FixtureMeta) {
    let conn = open_fixture_db(db_path);
    let total = count_experiments(&conn);
    if (experiment_index as i64) >= total {
        eprintln!(
            "[bench] --experiment-index {} out of range (DB has {} experiments, max index {})",
            experiment_index,
            total,
            total - 1
        );
        process::exit(1);
    }
    try_load_experiment_at(&conn, experiment_index).unwrap_or_else(|e| {
        eprintln!("[bench] {}", e);
        process::exit(1);
    })
}

/// S1-5: shared connection opener.  Reused by single-experiment loader
/// and the `--all-experiments` sweep.
fn open_fixture_db(db_path: &str) -> Connection {
    Connection::open(db_path).unwrap_or_else(|e| {
        eprintln!("[bench] failed to open fixture DB '{}': {}", db_path, e);
        process::exit(1);
    })
}

/// S1-5: shared experiment-count probe.  Fatal on count failure or
/// empty DB (both indicate a malformed fixture).
fn count_experiments(conn: &Connection) -> i64 {
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM Experiment", [], |r| r.get(0))
        .unwrap_or_else(|e| {
            eprintln!("[bench] failed to count experiments: {}", e);
            process::exit(1);
        });
    if total == 0 {
        eprintln!("[bench] fixture DB has 0 experiments");
        process::exit(1);
    }
    total
}

/// S1-5: non-fatal single-experiment loader.  Returns `Err(msg)` on
/// any failure so a sweep can skip a single broken row without
/// killing the whole run.  Errors include: row read failure, missing
/// `ExperimentData` row, columnar decode failure, missing required
/// channel, and 0-point experiments (which would produce empty
/// pipeline output anyway).
fn try_load_experiment_at(
    conn: &Connection,
    experiment_index: usize,
) -> Result<(Vec<RheoPoint>, FixtureMeta), String> {
    let (exp_id, exp_name, instrument_type, geometry, duration_sec): (
        String,
        String,
        String,
        Option<String>,
        f64,
    ) = conn
        .query_row(
            "SELECT id, name, instrumentType, geometry, COALESCE(durationSeconds, 0) \
             FROM Experiment ORDER BY rowid LIMIT 1 OFFSET ?1",
            params![experiment_index as i64],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)? as f64,
                ))
            },
        )
        .map_err(|e| format!("read Experiment row idx={}: {}", experiment_index, e))?;

    let blob: Vec<u8> = conn
        .query_row(
            "SELECT dataBlob FROM ExperimentData WHERE experimentId = ?1",
            params![&exp_id],
            |row| row.get(0),
        )
        .map_err(|e| format!("read ExperimentData for '{}': {}", exp_id, e))?;

    let typed = decode_typed(&blob)
        .map_err(|e| format!("columnar decode for '{}': {}", exp_id, e))?;

    let n_points = typed.get("time_sec").map(|v| v.len()).unwrap_or(0);
    if n_points == 0 {
        return Err(format!("experiment '{}' has 0 points after decode", exp_id));
    }

    let get_required = |name: &str| -> Result<&Vec<Option<f64>>, String> {
        typed.get(name).ok_or_else(|| {
            format!(
                "required channel '{}' missing from blob for '{}'",
                name, exp_id
            )
        })
    };
    let time = get_required("time_sec")?;
    let visc = get_required("viscosity_cp")?;
    let temp = get_required("temperature_c")?;
    let shear_rate = typed.get("shear_rate");
    let shear_stress = typed.get("shear_stress_pa");
    let pressure = typed.get("pressure_bar");
    let rpm = typed.get("speed_rpm");
    let bath = typed.get("bath_temperature_c");

    let mut points = Vec::with_capacity(n_points);
    for i in 0..n_points {
        points.push(RheoPoint {
            time_sec: time[i].unwrap_or(0.0),
            viscosity_cp: visc[i].unwrap_or(0.0),
            temperature_c: temp[i].unwrap_or(0.0),
            shear_rate: shear_rate.and_then(|v| v.get(i).copied()).flatten(),
            shear_stress: shear_stress.and_then(|v| v.get(i).copied()).flatten(),
            pressure_bar: pressure.and_then(|v| v.get(i).copied()).flatten(),
            rpm: rpm.and_then(|v| v.get(i).copied()).flatten(),
            bath_temperature_c: bath.and_then(|v| v.get(i).copied()).flatten(),
        });
    }

    let meta = FixtureMeta {
        experiment_id: exp_id,
        experiment_name: exp_name,
        instrument_type,
        geometry,
        point_count: n_points,
        duration_sec,
    };
    Ok((points, meta))
}

/// S1-5: load every experiment from the DB in rowid order.  Skips any
/// row that fails to load with a stderr warning so a single broken
/// experiment doesn't take down the whole sweep.  Fatal only if the
/// DB itself is unreadable or has 0 valid experiments after the loop.
fn load_all_fixture_traces(
    db_path: &str,
    quiet: bool,
) -> Vec<(Vec<RheoPoint>, FixtureMeta)> {
    let conn = open_fixture_db(db_path);
    let total = count_experiments(&conn);
    let mut traces: Vec<(Vec<RheoPoint>, FixtureMeta)> = Vec::with_capacity(total as usize);
    let mut skipped = 0usize;
    for idx in 0..total as usize {
        match try_load_experiment_at(&conn, idx) {
            Ok(pair) => traces.push(pair),
            Err(e) => {
                skipped += 1;
                if !quiet {
                    eprintln!("[bench] skipping idx={}: {}", idx, e);
                }
            }
        }
    }
    if traces.is_empty() {
        eprintln!(
            "[bench] no usable experiments in '{}' ({} attempted, all failed)",
            db_path, total
        );
        process::exit(1);
    }
    if skipped > 0 && !quiet {
        eprintln!(
            "[bench] sweep loaded {}/{} experiments ({} skipped)",
            traces.len(),
            total,
            skipped
        );
    }
    traces
}

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

// ── Pipeline driver ───────────────────────────────────────────────────
//
// S1-4 (2026-04-29): replaced two vendored helpers
// (`vendored_detect_cycles` + `vendored_process_all_cycles`, ~140 LOC
// each mirroring the `pub(crate)`/`pub(super)` originals in
// `src-tauri/src/commands/analysis/`) with a single call to
// `run_full_analysis_kernel`.  The kernel is the same code path
// `analysis_analyze_full` uses internally, so the bench now
// measures exactly what production runs — no drift risk.

/// One full analyze pipeline pass on a single trace.  Returns
/// `(cycles_detected, results_count, points_consumed)` for end-of-run
/// reporting (not used inside the hot timing loop).
///
/// Calls `run_full_analysis_kernel` directly — the same function the
/// `analysis_analyze_full` IPC command runs inside its
/// `tokio::task::spawn_blocking`.  We don't pass any cycle overrides
/// (that's a UI-driven feature) and we don't await anything (we
/// already run on a worker thread of our own).
fn run_pipeline(
    points: Vec<RheoPoint>,
    detection_settings: &ScheduleConfig,
    settings: &ExpertSettings,
    geometry_key: &str,
) -> (usize, usize, usize) {
    let n_points = points.len();
    let output = run_full_analysis_kernel(
        points,
        geometry_key,
        settings,
        detection_settings,
        &[],
    );
    (output.cycles.len(), output.results.len(), n_points)
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

// ── S1-5: per-experiment measurement record ──────────────────────────────
//
// Holds metadata + raw samples for one experiment in the all-experiments
// sweep.  Used to build per-experiment markdown rows and (after the
// sweep finishes) the corpus-level aggregate.

#[derive(Debug, Clone)]
struct ExperimentMeasurement {
    meta: FixtureMeta,
    cycles_detected: usize,
    samples_ms: Vec<f64>,
    p50: f64,
    p95: f64,
    min: f64,
    max: f64,
    mean: f64,
}

fn measure_experiment(
    points: &[RheoPoint],
    meta: FixtureMeta,
    iterations: usize,
    detection_settings: &ScheduleConfig,
    settings: &ExpertSettings,
    geometry_key: &str,
) -> ExperimentMeasurement {
    let mut samples_ms = Vec::with_capacity(iterations);
    let mut cycles_detected = 0usize;
    for _ in 0..iterations {
        // Fresh owned Vec each iteration — matches the IPC path's
        // deserialise-produces-fresh-allocations cost model.
        let cloned = points.to_vec();
        let t0 = Instant::now();
        let (c, _r, _) = run_pipeline(cloned, detection_settings, settings, geometry_key);
        let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;
        samples_ms.push(elapsed_ms);
        cycles_detected = c;
    }
    let p50 = percentile(&samples_ms, 0.50);
    let p95 = percentile(&samples_ms, 0.95);
    let min = samples_ms.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = samples_ms.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let mean = samples_ms.iter().sum::<f64>() / samples_ms.len() as f64;
    ExperimentMeasurement {
        meta,
        cycles_detected,
        samples_ms,
        p50,
        p95,
        min,
        max,
        mean,
    }
}

/// S1-5 entry point for `--all-experiments` sweep.  Loads every
/// experiment from the fixture DB, runs `--iterations` measurements
/// per row, prints a per-experiment markdown table + corpus aggregate,
/// optionally writes a JSON sidecar with per-experiment + corpus
/// blocks.  Has its own self-contained main-style flow rather than
/// extending the synthetic/single-fixture path because the per-row
/// output shape is fundamentally different (table-of-rows vs
/// single-row).
fn run_all_experiments_mode(args: &Args) {
    let db_path = args
        .load_fixture
        .as_ref()
        .expect("--all-experiments requires --load-fixture (already validated in Args::parse)");

    let detection_settings = ScheduleConfig::default();
    let settings = ExpertSettings {
        points_to_average: 0,
        viscosity_shear_rates: vec![40.0, 100.0, 170.0],
    };
    let geometry_key = "R1B1";

    if !args.quiet {
        eprintln!(
            "[bench] all-experiments mode: loading every experiment from '{}'",
            db_path
        );
    }
    let t_build = Instant::now();
    let traces = load_all_fixture_traces(db_path, args.quiet);
    let build_ms = t_build.elapsed().as_secs_f64() * 1000.0;
    let total_points: usize = traces.iter().map(|(p, _)| p.len()).sum();
    if !args.quiet {
        eprintln!(
            "[bench] loaded {} experiments, {} total raw points, build {:.1} ms",
            traces.len(),
            total_points,
            build_ms,
        );
        eprintln!(
            "[bench] running {} iteration(s) per experiment...",
            args.iterations
        );
    }

    let n_to_measure = traces.len();
    let mut measurements: Vec<ExperimentMeasurement> = Vec::with_capacity(n_to_measure);
    for (i, (points, meta)) in traces.into_iter().enumerate() {
        if !args.quiet {
            eprintln!(
                "[bench] [{}/{}] idx={} {} ({} pts)",
                i + 1,
                n_to_measure,
                i,
                meta.experiment_name,
                points.len()
            );
        }
        let m = measure_experiment(
            &points,
            meta,
            args.iterations,
            &detection_settings,
            &settings,
            geometry_key,
        );
        if !args.quiet {
            eprintln!(
                "[bench]     cycles={} mean={:.2} ms p50={:.2} p95={:.2}",
                m.cycles_detected, m.mean, m.p50, m.p95,
            );
        }
        measurements.push(m);
    }

    // ── Corpus aggregate ────────────────────────────────────────────
    let n_exp = measurements.len();
    let mut all_samples: Vec<f64> =
        Vec::with_capacity(n_exp.saturating_mul(args.iterations));
    for m in &measurements {
        all_samples.extend_from_slice(&m.samples_ms);
    }
    let pooled_p50 = percentile(&all_samples, 0.50);
    let pooled_p95 = percentile(&all_samples, 0.95);
    let pooled_mean = if all_samples.is_empty() {
        0.0
    } else {
        all_samples.iter().sum::<f64>() / all_samples.len() as f64
    };
    let mut means: Vec<f64> = measurements.iter().map(|m| m.mean).collect();
    means.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median_of_means = if means.is_empty() {
        0.0
    } else {
        means[means.len() / 2]
    };
    let total_per_iter_mean: f64 = measurements.iter().map(|m| m.mean).sum();

    // ── Markdown output ─────────────────────────────────────────────
    println!();
    println!("# bench_analysis_pipeline — all-experiments DB sweep");
    println!();
    if let Some(label) = &args.label {
        println!("**Label:** `{}`", label);
        println!();
    }
    println!("**Fixture:** `{}`  ", db_path);
    println!("**Experiments measured:** {}  ", n_exp);
    println!("**Iterations per experiment:** {}", args.iterations);
    println!();
    println!("| idx | experiment | instr | geom | points | cycles | mean ms | p50 | p95 | min | max |");
    println!("|----:|------------|-------|------|------:|-------:|--------:|----:|----:|----:|----:|");
    for (i, m) in measurements.iter().enumerate() {
        let name_short: String = m.meta.experiment_name.chars().take(35).collect();
        let instr_short: String = m.meta.instrument_type.chars().take(20).collect();
        println!(
            "| {} | {} | {} | {} | {} | {} | {:.2} | {:.2} | {:.2} | {:.2} | {:.2} |",
            i,
            name_short,
            instr_short,
            m.meta.geometry.as_deref().unwrap_or("-"),
            m.meta.point_count,
            m.cycles_detected,
            m.mean,
            m.p50,
            m.p95,
            m.min,
            m.max,
        );
    }
    println!();
    println!("## Corpus aggregate");
    println!();
    println!("| Metric | Value |");
    println!("|--------|------:|");
    println!("| n_experiments               | {} |", n_exp);
    println!("| iterations_per_experiment   | {} |", args.iterations);
    println!("| total_samples               | {} |", all_samples.len());
    println!("| pooled wall_ms p50          | {:.2} |", pooled_p50);
    println!("| pooled wall_ms p95          | {:.2} |", pooled_p95);
    println!("| pooled wall_ms mean         | {:.2} |", pooled_mean);
    println!("| median of per-exp means     | {:.2} |", median_of_means);
    println!("| total wall_ms per full pass | {:.2} |", total_per_iter_mean);

    // ── JSON sidecar ────────────────────────────────────────────────
    if let Some(json_path) = &args.json_output {
        let label_field = match &args.label {
            Some(l) => format!(",\n  \"label\": \"{}\"", json_escape(l)),
            None => String::new(),
        };
        let exp_blocks = measurements
            .iter()
            .enumerate()
            .map(|(i, m)| {
                let samples_json = m
                    .samples_ms
                    .iter()
                    .map(|ms| format!("{:.4}", ms))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(
                    "    {{\n      \"index\": {},\n      \"experiment_id\": \"{}\",\n      \"experiment_name\": \"{}\",\n      \"instrument_type\": \"{}\",\n      \"geometry\": {},\n      \"duration_sec\": {:.4},\n      \"point_count\": {},\n      \"cycles_detected\": {},\n      \"wall_ms\": {{\n        \"p50\": {:.4},\n        \"p95\": {:.4},\n        \"min\": {:.4},\n        \"max\": {:.4},\n        \"mean\": {:.4}\n      }},\n      \"samples_ms\": [{}]\n    }}",
                    i,
                    json_escape(&m.meta.experiment_id),
                    json_escape(&m.meta.experiment_name),
                    json_escape(&m.meta.instrument_type),
                    match &m.meta.geometry {
                        Some(g) => format!("\"{}\"", json_escape(g)),
                        None => "null".to_string(),
                    },
                    m.meta.duration_sec,
                    m.meta.point_count,
                    m.cycles_detected,
                    m.p50,
                    m.p95,
                    m.min,
                    m.max,
                    m.mean,
                    samples_json,
                )
            })
            .collect::<Vec<_>>()
            .join(",\n");
        let json = format!(
            r#"{{
  "schema": "rheolab.microbench.analysis_pipeline.v1",
  "mode": "all_experiments",
  "fixture_path": "{db_path}",
  "n_experiments": {n_exp},
  "iterations_per_experiment": {iters}{label_field},
  "input_build_ms": {build_ms:.4},
  "experiments": [
{experiments}
  ],
  "corpus": {{
    "n_experiments": {n_exp},
    "iterations_per_experiment": {iters},
    "total_samples": {total_samples},
    "wall_ms_pooled_p50": {pp50:.4},
    "wall_ms_pooled_p95": {pp95:.4},
    "wall_ms_pooled_mean": {pmean:.4},
    "wall_ms_median_of_means": {mom:.4},
    "wall_ms_total_per_iter_mean": {totper:.4}
  }}
}}
"#,
            db_path = json_escape(db_path),
            n_exp = n_exp,
            iters = args.iterations,
            label_field = label_field,
            build_ms = build_ms,
            experiments = exp_blocks,
            total_samples = all_samples.len(),
            pp50 = pooled_p50,
            pp95 = pooled_p95,
            pmean = pooled_mean,
            mom = median_of_means,
            totper = total_per_iter_mean,
        );
        if let Err(e) = fs::write(json_path, &json) {
            eprintln!("[bench] failed to write JSON to {}: {}", json_path, e);
            process::exit(1);
        }
        if !args.quiet {
            eprintln!("[bench] wrote JSON sidecar to {}", json_path);
        }
    }
}

fn main() {
    let args = Args::parse();

    // S1-5: dispatch to the all-experiments sweep on its own flow.
    // The single-fixture / synthetic flow below is kept untouched so
    // S1-2/S1-3 numbers remain reproducible.
    if args.all_experiments {
        run_all_experiments_mode(&args);
        return;
    }

    let detection_settings = ScheduleConfig::default();
    let settings = ExpertSettings {
        points_to_average: 0, // mirror typical UI default; raw averages used
        viscosity_shear_rates: vec![40.0, 100.0, 170.0],
    };
    let geometry_key = "R1B1";

    // ── Input source: synthetic vs fixture ──────────────────────────────
    let t_build = Instant::now();
    let (traces, fixture_meta, source_label, n_cycles_per_trace): (
        Vec<Vec<RheoPoint>>,
        Option<FixtureMeta>,
        String,
        usize,
    ) = match &args.load_fixture {
        Some(db_path) => {
            if !args.quiet {
                eprintln!(
                    "[bench] Loading fixture from '{}' (experiment-index={}, n={})",
                    db_path, args.experiment_index, args.n
                );
            }
            let (points, meta) = load_fixture_trace(db_path, args.experiment_index);
            // For --n > 1, replicate the same trace N times.  This
            // mirrors what synthetic mode does (same trace shape per
            // iteration) and matches the comparison-flow workload
            // pattern (analyse N experiments back-to-back).
            let traces: Vec<Vec<RheoPoint>> = (0..args.n).map(|_| points.clone()).collect();
            let label = format!(
                "fixture:{} idx={} ({})",
                std::path::Path::new(db_path)
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| db_path.clone()),
                args.experiment_index,
                meta.experiment_name
            );
            (traces, Some(meta), label, 0)
        }
        None => {
            if !args.quiet {
                eprintln!(
                    "[bench] Building {} synthetic trace(s) of {} h each",
                    args.n, args.duration_hours
                );
            }
            let traces: Vec<Vec<RheoPoint>> = (0..args.n)
                .map(|_| synthesise_trace(args.duration_hours).0)
                .collect();
            let n_cycles = synthesise_trace(args.duration_hours).1;
            (
                traces,
                None,
                format!("synthetic n={} duration={}h", args.n, args.duration_hours),
                n_cycles,
            )
        }
    };
    let build_ms = t_build.elapsed().as_secs_f64() * 1000.0;
    let total_points: usize = traces.iter().map(|t| t.len()).sum();

    if !args.quiet {
        eprintln!(
            "[bench] {} ({} total raw points, input build: {:.1} ms)",
            source_label, total_points, build_ms
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
    if fixture_meta.is_none() {
        println!("| duration_hours    | {} |", args.duration_hours);
    }
    println!("| total_points      | {} |", total_points);
    if fixture_meta.is_none() {
        println!("| cycles_per_trace  | {} |", n_cycles_per_trace);
    }
    if let Some(meta) = &fixture_meta {
        println!("| source            | fixture |");
        println!("| experiment_id     | `{}` |", meta.experiment_id);
        println!("| experiment_name   | {} |", meta.experiment_name);
        println!("| instrument_type   | {} |", meta.instrument_type);
        println!(
            "| geometry          | {} |",
            meta.geometry.as_deref().unwrap_or("-")
        );
        println!("| fixture_duration_sec | {:.0} |", meta.duration_sec);
    }
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
        let fixture_block = match &fixture_meta {
            Some(meta) => format!(
                ",\n  \"fixture\": {{\n    \"experiment_id\": \"{}\",\n    \"experiment_name\": \"{}\",\n    \"instrument_type\": \"{}\",\n    \"geometry\": {},\n    \"fixture_duration_sec\": {:.4},\n    \"point_count_per_trace\": {}\n  }}",
                json_escape(&meta.experiment_id),
                json_escape(&meta.experiment_name),
                json_escape(&meta.instrument_type),
                match &meta.geometry {
                    Some(g) => format!("\"{}\"", json_escape(g)),
                    None => "null".to_string(),
                },
                meta.duration_sec,
                meta.point_count,
            ),
            None => String::new(),
        };
        let json = format!(
            r#"{{
  "schema": "rheolab.microbench.analysis_pipeline.v1",
  "mode": "{mode}",
  "n_experiments": {n},
  "duration_hours": {dh},
  "total_points": {tp},
  "cycles_per_trace": {cyc},
  "iterations": {it}{label_field}{fixture_block},
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
            mode = if fixture_meta.is_some() { "fixture" } else { "synthetic" },
            n = args.n,
            dh = if fixture_meta.is_some() { 0.0 } else { args.duration_hours },
            tp = total_points,
            cyc = n_cycles_per_trace,
            it = wall_ms_samples.len(),
            label_field = label_field,
            fixture_block = fixture_block,
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
