//! Sprint 1 / S1-1 — comparison-PDF microbench for P10 validation.
//!
//! Measures Rust-only `generate_comparison_pdf` time on synthetic
//! comparison fixtures (3 / 5 / 10 experiments) **without** IPC, UI,
//! or license gates.  This is the diagnostic Sprint 0 deferred — the
//! `perf:*` infra runs against the debug E2E build, so it cannot
//! validate the `[profile.release.package.*]` opt-level=3 overrides
//! P10 added.
//!
//! ## Why it lives in `src-tauri/examples/`
//!
//! The P10 overrides live in `src-tauri/Cargo.toml`:
//!
//! ```toml
//! [profile.release.package.rheolab-core]
//! opt-level = 3
//! [profile.release.package.typst]
//! opt-level = 3
//! # ...
//! ```
//!
//! Those `[profile.release.package.*]` overrides only apply when
//! `rheolab-core` and the Typst stack are compiled **as path-deps of
//! src-tauri** — i.e. when the build's root crate is `src-tauri`.
//! Building from `src/rust/rheolab-core/` standalone (e.g.
//! `cargo run --manifest-path src/rust/rheolab-core/Cargo.toml --example ...`)
//! ignores those overrides because rheolab-core's own Cargo.toml has
//! no profile section.  Putting the example here guarantees we
//! measure exactly the binary the production app ships.
//!
//! ## Usage
//!
//! Direct:
//! ```pwsh
//! cargo build --release --manifest-path src-tauri/Cargo.toml --example bench_comparison_pdf
//! ./src-tauri/target/release/examples/bench_comparison_pdf.exe --n 3 --iterations 5
//! ```
//!
//! Orchestrated (3-/5-/10-experiment sweep + JSON output):
//! ```pwsh
//! npm run perf:microbench:pdf
//! ```
//!
//! ## Output
//!
//! - **stdout**: human-readable Markdown table.
//! - **`--json <path>`**: machine-readable JSON for the orchestrator.
//!
//! ## Determinism
//!
//! Fixtures are synthesised in-process from deterministic
//! parameters (peak viscosity, decay factor, duration) — no PRNG,
//! no clock-based input.  Two consecutive runs on the same machine
//! produce byte-identical PDFs.  The only non-determinism comes from
//! Typst's font metric lookup and SVG layout, both of which are
//! cached after the first iteration; iteration 1 is therefore the
//! slowest and intentionally NOT excluded from the percentile
//! aggregation (we want a pessimistic p95, not a warmup-stripped one).
use std::env;
use std::fs;
use std::process;
use std::time::Instant;

use rheolab_core::report_generator::comparison::{
    generate_comparison_excel, generate_comparison_pdf, ComparisonChartConfig,
    ComparisonExperimentEntry, ComparisonMetrics, ComparisonReportInput, SectionToggles,
    TouchPointConfig,
};
use rheolab_core::report_generator::{DataPoint, ReportInput, ReportMetadata, ReportSettings};
use rheolab_core::types::RheoPoint;
use rheolab_enterprise::db::columnar::decode_typed;
use rusqlite::{params, Connection};

#[derive(Debug, Clone, Copy)]
enum ReportFormat {
    Pdf,
    Xlsx,
}

impl ReportFormat {
    fn parse(value: &str) -> Self {
        match value {
            "pdf" => ReportFormat::Pdf,
            "xlsx" | "excel" => ReportFormat::Xlsx,
            other => {
                eprintln!("invalid --format '{}': expected pdf or xlsx", other);
                process::exit(2);
            }
        }
    }

    fn as_str(&self) -> &'static str {
        match self {
            ReportFormat::Pdf => "pdf",
            ReportFormat::Xlsx => "xlsx",
        }
    }

    fn schema(&self) -> &'static str {
        match self {
            ReportFormat::Pdf => "rheolab.microbench.pdf_comparison.v1",
            ReportFormat::Xlsx => "rheolab.microbench.xlsx_comparison.v1",
        }
    }
}

#[derive(Debug)]
struct Args {
    n: usize,
    iterations: usize,
    duration_hours: f64,
    format: ReportFormat,
    json_output: Option<String>,
    label: Option<String>,
    quiet: bool,
    load_fixture: Option<String>,
    experiment_index: usize,
    all_experiments: bool,
}

impl Args {
    fn parse() -> Self {
        let mut args = Args {
            n: 3,
            iterations: 5,
            duration_hours: 4.0,
            format: ReportFormat::Pdf,
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
                "--n" => {
                    args.n = parse_required::<usize>(&mut iter, "--n");
                }
                "--iterations" => {
                    args.iterations = parse_required::<usize>(&mut iter, "--iterations");
                }
                "--duration-hours" => {
                    args.duration_hours = parse_required::<f64>(&mut iter, "--duration-hours");
                }
                "--format" => {
                    args.format = ReportFormat::parse(&require_str(&mut iter, "--format"));
                }
                "--json" => {
                    args.json_output = Some(require_str(&mut iter, "--json"));
                }
                "--label" => {
                    args.label = Some(require_str(&mut iter, "--label"));
                }
                "--load-fixture" => {
                    args.load_fixture = Some(require_str(&mut iter, "--load-fixture"));
                }
                "--experiment-index" => {
                    args.experiment_index =
                        parse_required::<usize>(&mut iter, "--experiment-index");
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
            eprintln!("invalid arguments: n, iterations, duration-hours must be positive");
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
        args
    }
}

fn parse_required<T: std::str::FromStr>(iter: &mut impl Iterator<Item = String>, name: &str) -> T {
    iter.next().and_then(|v| v.parse().ok()).unwrap_or_else(|| {
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
    println!("Usage: bench_comparison_pdf [OPTIONS]");
    println!();
    println!("Options:");
    println!("  --n N                 Number of experiments (default: 3)");
    println!("  --iterations K        Iterations to run (default: 5)");
    println!("  --duration-hours H    Per-experiment data duration in hours (default: 4.0)");
    println!("  --format FMT          Report format: pdf or xlsx (default: pdf)");
    println!("  --load-fixture PATH   Load production-shaped experiments from a SQLite seed DB");
    println!("  --experiment-index I  First fixture experiment index to load (default: 0)");
    println!("  --all-experiments     Use every valid experiment in the fixture DB");
    println!("  --json PATH           Write results as JSON to PATH (sidecar)");
    println!("  --label TEXT          Free-form label written into the JSON sidecar");
    println!("  --quiet               Suppress per-iteration progress lines on stderr");
    println!("  --help, -h            Show this help");
}

#[derive(Debug, Clone)]
struct FixtureExperiment {
    id: String,
    name: String,
    instrument_type: String,
    points: Vec<RheoPoint>,
}

fn open_fixture_db(db_path: &str) -> Connection {
    Connection::open(db_path).unwrap_or_else(|e| {
        eprintln!("[bench] failed to open fixture DB '{}': {}", db_path, e);
        process::exit(1);
    })
}

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

fn try_load_fixture_experiment_at(
    conn: &Connection,
    experiment_index: usize,
) -> Result<FixtureExperiment, String> {
    let (id, name, instrument_type): (String, String, String) = conn
        .query_row(
            "SELECT id, name, instrumentType \
             FROM Experiment ORDER BY rowid LIMIT 1 OFFSET ?1",
            params![experiment_index as i64],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .map_err(|e| format!("read Experiment row idx={}: {}", experiment_index, e))?;

    let blob: Vec<u8> = conn
        .query_row(
            "SELECT dataBlob FROM ExperimentData WHERE experimentId = ?1",
            params![&id],
            |row| row.get(0),
        )
        .map_err(|e| format!("read ExperimentData for '{}': {}", id, e))?;

    let typed = decode_typed(&blob).map_err(|e| format!("columnar decode for '{}': {}", id, e))?;
    let n_points = typed.get("time_sec").map(|v| v.len()).unwrap_or(0);
    if n_points == 0 {
        return Err(format!("experiment '{}' has 0 points after decode", id));
    }

    let get_required = |name: &str| -> Result<&Vec<Option<f64>>, String> {
        typed
            .get(name)
            .ok_or_else(|| format!("required channel '{}' missing from blob for '{}'", name, id))
    };
    let time = get_required("time_sec")?;
    let viscosity = get_required("viscosity_cp")?;
    let temperature = get_required("temperature_c")?;
    let shear_rate = typed.get("shear_rate");
    let shear_stress = typed.get("shear_stress_pa");
    let pressure = typed.get("pressure_bar");
    let rpm = typed.get("speed_rpm");
    let bath = typed.get("bath_temperature_c");

    let mut points = Vec::with_capacity(n_points);
    for i in 0..n_points {
        points.push(RheoPoint {
            time_sec: time[i].unwrap_or(0.0),
            viscosity_cp: viscosity[i].unwrap_or(0.0),
            temperature_c: temperature[i].unwrap_or(0.0),
            shear_rate: shear_rate.and_then(|v| v.get(i).copied()).flatten(),
            shear_stress: shear_stress.and_then(|v| v.get(i).copied()).flatten(),
            pressure_bar: pressure.and_then(|v| v.get(i).copied()).flatten(),
            rpm: rpm.and_then(|v| v.get(i).copied()).flatten(),
            bath_temperature_c: bath.and_then(|v| v.get(i).copied()).flatten(),
        });
    }

    Ok(FixtureExperiment {
        id,
        name,
        instrument_type,
        points,
    })
}

fn load_fixture_experiments(args: &Args) -> Vec<FixtureExperiment> {
    let db_path = args
        .load_fixture
        .as_ref()
        .expect("load_fixture checked by caller");
    let conn = open_fixture_db(db_path);
    let total = count_experiments(&conn) as usize;
    let indexes: Vec<usize> = if args.all_experiments {
        (0..total).collect()
    } else {
        let end = args.experiment_index.saturating_add(args.n).min(total);
        if args.experiment_index >= end {
            eprintln!(
                "[bench] --experiment-index {} out of range (DB has {} experiments)",
                args.experiment_index, total
            );
            process::exit(1);
        }
        (args.experiment_index..end).collect()
    };

    let mut experiments = Vec::with_capacity(indexes.len());
    let mut skipped = 0usize;
    for idx in indexes {
        match try_load_fixture_experiment_at(&conn, idx) {
            Ok(experiment) => experiments.push(experiment),
            Err(e) => {
                skipped += 1;
                if !args.quiet {
                    eprintln!("[bench] skipping idx={}: {}", idx, e);
                }
            }
        }
    }
    if experiments.is_empty() {
        eprintln!("[bench] no usable experiments loaded from '{}'", db_path);
        process::exit(1);
    }
    if skipped > 0 && !args.quiet {
        eprintln!(
            "[bench] loaded {} fixture experiments ({} skipped)",
            experiments.len(),
            skipped
        );
    }
    experiments
}

fn point_to_data_point(point: &RheoPoint) -> DataPoint {
    DataPoint {
        time_sec: point.time_sec,
        viscosity_cp: point.viscosity_cp,
        temperature_c: Some(point.temperature_c),
        shear_rate: point.shear_rate,
        shear_stress_pa: point.shear_stress,
        speed_rpm: point.rpm,
        pressure_bar: point.pressure_bar,
        bath_temperature_c: point.bath_temperature_c,
    }
}

fn fixture_to_entry(idx: usize, fixture: FixtureExperiment) -> ComparisonExperimentEntry {
    let id = fixture.id;
    let display_name = format!("[FIXTURE #{:03}] {}", idx, fixture.name);
    let raw_data = fixture.points.iter().map(point_to_data_point).collect();

    ComparisonExperimentEntry {
        id: id.clone(),
        display_name,
        report_input: ReportInput {
            raw_data,
            metadata: ReportMetadata {
                filename: format!("{}.dat", fixture.name),
                test_id: Some(id),
                instrument_type: Some(fixture.instrument_type),
                ..Default::default()
            },
            cycle_results: vec![],
            recipe: vec![],
            water_params: None,
            cycles: vec![],
            settings: ReportSettings::default(),
            chart_image_base64: None,
            axis_values: None,
        },
        section_toggles: SectionToggles::default(),
    }
}

/// Build a synthetic experiment.  Curve shape mirrors the existing
/// `pdf_comparison_debug.rs` fixture (fast ramp to peak, exponential
/// decay) so the PDF exercises the same downsampling, touch-point,
/// and dual-axis code paths the production renderer hits.
///
/// Shape is deterministic in `idx` and `duration_hours`: two runs
/// with the same parameters produce the same input bytes.
fn mk_experiment(idx: usize, duration_hours: f64) -> ComparisonExperimentEntry {
    // Vary peak / decay across experiments so the PDF actually has
    // visually distinct curves — otherwise downsampling and axis
    // fitting would all degenerate to the same shape and we'd
    // measure the wrong code path (single-curve fast path).
    let peak_viscosity = 800.0 + (idx as f64) * 600.0; // 800, 1400, 2000, 2600 ...
    let decay_factor = 0.5 + (idx as f64) * 0.3; //          0.5, 0.8, 1.1, 1.4 ...
    let total_sec = (duration_hours * 3600.0) as usize;
    let n = total_sec / 30;

    let raw_data: Vec<DataPoint> = (0..n)
        .map(|i| {
            let t = i as f64 * 30.0;
            // Fast ramp in the first 60 s, then exponential cooldown.
            let v = if t < 60.0 {
                peak_viscosity * (t / 60.0).powf(1.5)
            } else {
                let decay_t = (t - 60.0) / 3600.0;
                let base = peak_viscosity * (-decay_factor * decay_t).exp();
                let noise = ((i as f64 * 0.173).sin() * 15.0).abs();
                (base + noise).max(50.0)
            };
            // Sample temperature: stays near the oven target with mild
            // variation, mimicking real instrument traces.
            let t_sample = 90.0 + (i as f64 * 0.0005).sin() * 3.0;
            // Bath temperature: warms up over the first 5 min then
            // tracks a few degrees above the sample.
            let t_bath = {
                let warmup_min = (t / 60.0).min(5.0);
                let target = 98.0 + (i as f64 * 0.0003).cos() * 2.0;
                25.0 + (target - 25.0) * (warmup_min / 5.0)
            };
            // Pressure: smooth ramp from rest to ~75 bar with mild
            // pulsation so the trace stays readable.
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

    let id = format!("BENCH-{:03}", idx);
    let display_name = format!(
        "[BENCH Experiment #{:03} (peak {:.0} cP, decay {:.1})]",
        idx, peak_viscosity, decay_factor
    );

    ComparisonExperimentEntry {
        id: id.clone(),
        display_name,
        report_input: ReportInput {
            raw_data,
            metadata: ReportMetadata {
                filename: format!("{id}.dat"),
                test_id: Some(id),
                ..Default::default()
            },
            cycle_results: vec![],
            recipe: vec![],
            water_params: None,
            cycles: vec![],
            settings: ReportSettings::default(),
            chart_image_base64: None,
            axis_values: None,
        },
        section_toggles: SectionToggles::default(),
    }
}

fn build_input(n: usize, duration_hours: f64) -> ComparisonReportInput {
    let experiments: Vec<ComparisonExperimentEntry> = (0..n)
        .map(|idx| mk_experiment(idx, duration_hours))
        .collect();
    build_input_from_entries(experiments)
}

fn build_input_from_entries(experiments: Vec<ComparisonExperimentEntry>) -> ComparisonReportInput {
    ComparisonReportInput {
        language: "en".into(),
        unit_system: "SI".into(),
        company_name: Some("RheoLab Bench".into()),
        company_logo_base64: None,
        generated_at: "2026-04-28T00:00:00Z".into(),
        comparison_chart: ComparisonChartConfig {
            metrics: ComparisonMetrics {
                primary: "viscosity_cp".into(),
                // Exercise the full multi-axis path so we measure the
                // realistic comparison-PDF render cost (the cheap
                // single-axis path would understate the time).
                left_secondary: "shear_rate".into(),
                secondary: "temperature_c".into(),
                tertiary: "pressure_bar".into(),
            },
            axis_mode: "individual".into(),
            brush_range: None,
            touch_point: TouchPointConfig {
                enabled: true,
                viscosity_threshold: 400.0,
                show_target_time: true,
                target_time: 60.0,
            },
            line_settings: Default::default(),
            // 10 colours so n=10 fixture has no wraparound (which would
            // visually merge two experiments and is a separate code path).
            experiment_colors: vec![
                "#1E90FF".into(),
                "#FF0000".into(),
                "#008000".into(),
                "#800080".into(),
                "#FF8C00".into(),
                "#008B8B".into(),
                "#B22222".into(),
                "#4B0082".into(),
                "#2F4F4F".into(),
                "#8B4513".into(),
            ],
            time_format: "hh:mm:ss".into(),
            downsample_mode: "smart".into(),
            chart_width: 1400,
            chart_height: 700,
        },
        experiments,
    }
}

fn percentile(samples: &[f64], pct: f64) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let mut sorted = samples.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    // nearest-rank, clamped to last index.
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

    if !args.quiet {
        match &args.load_fixture {
            Some(db_path) => eprintln!(
                "[bench] Building input from fixture DB: {} (n={}, all_experiments={})",
                db_path, args.n, args.all_experiments
            ),
            None => eprintln!(
                "[bench] Building input: n={}, duration_hours={}",
                args.n, args.duration_hours
            ),
        }
    }
    let t_build = Instant::now();
    let (input, mode) = match &args.load_fixture {
        Some(_) => {
            let entries = load_fixture_experiments(&args)
                .into_iter()
                .enumerate()
                .map(|(idx, fixture)| fixture_to_entry(idx, fixture))
                .collect();
            (build_input_from_entries(entries), "fixture")
        }
        None => (build_input(args.n, args.duration_hours), "synthetic"),
    };
    let build_ms = t_build.elapsed().as_secs_f64() * 1000.0;
    let total_points: usize = input
        .experiments
        .iter()
        .map(|e| e.report_input.raw_data.len())
        .sum();
    if !args.quiet {
        eprintln!(
            "[bench] {} experiments, {} total data points (input build: {:.1} ms)",
            input.experiments.len(),
            total_points,
            build_ms
        );
        eprintln!(
            "[bench] Running {} {} iteration(s)...",
            args.iterations,
            args.format.as_str()
        );
    }

    let mut wall_ms_samples: Vec<f64> = Vec::with_capacity(args.iterations);
    let mut byte_sizes: Vec<usize> = Vec::with_capacity(args.iterations);

    for i in 0..args.iterations {
        let t0 = Instant::now();
        let result = match args.format {
            ReportFormat::Pdf => generate_comparison_pdf(&input),
            ReportFormat::Xlsx => generate_comparison_excel(&input),
        };
        match result {
            Ok(bytes) => {
                let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;
                wall_ms_samples.push(elapsed_ms);
                byte_sizes.push(bytes.len());
                if !args.quiet {
                    eprintln!(
                        "[bench] iter {}/{}: {:.1} ms, {} bytes",
                        i + 1,
                        args.iterations,
                        elapsed_ms,
                        bytes.len()
                    );
                }
            }
            Err(e) => {
                eprintln!(
                    "[bench] ERROR iter {}/{}: generate_comparison_{} failed: {}",
                    i + 1,
                    args.iterations,
                    args.format.as_str(),
                    e
                );
                process::exit(1);
            }
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
    let mean_bytes: f64 =
        byte_sizes.iter().map(|&b| b as f64).sum::<f64>() / byte_sizes.len() as f64;

    // Markdown summary to stdout — easy to copy-paste into a report.
    println!();
    println!("# bench_comparison_{} results", args.format.as_str());
    println!();
    if let Some(label) = &args.label {
        println!("**Label:** `{}`", label);
        println!();
    }
    println!("| Parameter        | Value |");
    println!("|------------------|------:|");
    println!("| mode             | {} |", mode);
    println!("| format           | {} |", args.format.as_str());
    println!("| n_experiments    | {} |", input.experiments.len());
    if mode == "synthetic" {
        println!("| duration_hours   | {} |", args.duration_hours);
    }
    println!("| total_points     | {} |", total_points);
    println!("| iterations       | {} |", wall_ms_samples.len());
    println!();
    println!("| Metric           | Value |");
    println!("|------------------|------:|");
    println!("| wall_ms p50      | {:.1} |", p50);
    println!("| wall_ms p95      | {:.1} |", p95);
    println!("| wall_ms min      | {:.1} |", min);
    println!("| wall_ms max      | {:.1} |", max);
    println!("| wall_ms mean     | {:.1} |", mean);
    println!("| bytes (mean)     | {:.0} |", mean_bytes);

    // Optional JSON sidecar for the orchestrator (zero serde dep —
    // hand-rolled because we want to keep example dependencies
    // identical to the production binary).
    if let Some(json_path) = args.json_output {
        let label_field = match &args.label {
            Some(l) => format!(",\n  \"label\": \"{}\"", json_escape(l)),
            None => String::new(),
        };
        let samples_json = wall_ms_samples
            .iter()
            .zip(byte_sizes.iter())
            .map(|(ms, b)| format!("    {{ \"wall_ms\": {:.4}, \"bytes\": {} }}", ms, b))
            .collect::<Vec<_>>()
            .join(",\n");
        let bytes_field = match args.format {
            ReportFormat::Pdf => format!(",\n  \"pdf_bytes_mean\": {mean_bytes:.1}"),
            ReportFormat::Xlsx => format!(",\n  \"xlsx_bytes_mean\": {mean_bytes:.1}"),
        };
        let json = format!(
            r#"{{
  "schema": "{schema}",
  "mode": "{mode}",
  "format": "{format}",
  "n_experiments": {n},
  "duration_hours": {dh},
  "total_points": {tp},
  "iterations": {it}{label_field},
  "wall_ms": {{
    "p50": {p50:.4},
    "p95": {p95:.4},
    "min": {min:.4},
    "max": {max:.4},
    "mean": {mean:.4}
  }},
  "artifact_bytes_mean": {mb:.1}{bytes_field},
  "input_build_ms": {build_ms:.4},
  "samples": [
{samples}
  ]
}}
"#,
            schema = args.format.schema(),
            mode = mode,
            format = args.format.as_str(),
            n = input.experiments.len(),
            dh = if mode == "synthetic" {
                args.duration_hours
            } else {
                0.0
            },
            tp = total_points,
            it = wall_ms_samples.len(),
            label_field = label_field,
            p50 = p50,
            p95 = p95,
            min = min,
            max = max,
            mean = mean,
            mb = mean_bytes,
            bytes_field = bytes_field,
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
