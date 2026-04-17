use criterion::{black_box, criterion_group, criterion_main, BenchmarkId, Criterion};
use rheolab_core::{
    report_generator::chart_generator::{ChartConfig, ChartPoint, generate_chart_svg},
    schedule_detector::{detect_schedule, ScheduleConfig},
    types::RheoPoint,
};

// ─── Data generators ─────────────────────────────────────────────────────────

/// Generate a synthetic constant-shear plateau with N points.
fn make_rheo_points(n: usize) -> Vec<RheoPoint> {
    (0..n)
        .map(|i| {
            let t = i as f64 * 2.0; // 2-second interval
            RheoPoint {
                time_sec: t,
                viscosity_cp: 500.0 + 50.0 * (t / 60.0).sin(),
                temperature_c: 25.0 + 0.5 * (t / 120.0).cos(),
                shear_rate: Some(100.0),
                shear_stress: None,
                pressure_bar: None,
                rpm: None,
                bath_temperature_c: None,
            }
        })
        .collect()
}

/// Generate a multi-step shear ramp: 5 plateaus at different shear rates.
fn make_step_ramp(points_per_step: usize) -> Vec<RheoPoint> {
    let shear_rates = [50.0, 100.0, 200.0, 100.0, 50.0f64];
    shear_rates
        .iter()
        .enumerate()
        .flat_map(|(step_idx, &sr)| {
            (0..points_per_step).map(move |i| {
                let t = (step_idx * points_per_step + i) as f64 * 2.0;
                RheoPoint {
                    time_sec: t,
                    viscosity_cp: 1000.0 / sr.sqrt() + 5.0 * (t * 0.1).sin(),
                    temperature_c: 25.0,
                    shear_rate: Some(sr),
                    shear_stress: None,
                    pressure_bar: None,
                    rpm: None,
                    bath_temperature_c: None,
                }
            })
        })
        .collect()
}

/// Generate ChartPoints with all channels populated (worst-case for LTTB).
fn make_chart_points_full(n: usize) -> Vec<ChartPoint> {
    (0..n)
        .map(|i| {
            let t = i as f64 / 60.0; // time in minutes
            ChartPoint {
                time_min: t,
                viscosity_cp: 500.0 + 200.0 * (t * 0.3).sin(),
                temperature_c: Some(25.0 + 5.0 * (t * 0.1).cos()),
                shear_rate: Some(100.0 + 20.0 * (t * 0.2).sin()),
                pressure_bar: Some(1.0 + 0.1 * (t * 0.05).sin()),
                bath_temperature_c: Some(22.0 + 1.0 * (t * 0.07).cos()),
            }
        })
        .collect()
}

fn default_chart_config() -> ChartConfig {
    ChartConfig {
        show_temperature: true,
        show_shear_rate: true,
        show_pressure: false,
        show_bath_temperature: false,
        shear_rate_axis: "right".to_string(),
        pressure_axis: "right".to_string(),
        axis_mode: "shared".to_string(),
        width: 800,
        height: 400,
        label_left: "Viscosity (cP)".to_string(),
        label_right: "Shear Rate (1/s)".to_string(),
        label_bottom: "Time (min)".to_string(),
        name_viscosity: "Viscosity".to_string(),
        name_temperature: "Temperature".to_string(),
        name_shear_rate: "Shear Rate".to_string(),
        name_pressure: "Pressure".to_string(),
        name_bath_temperature: "Bath Temp".to_string(),
        touch_points: vec![],
        viscosity_threshold: None,
        line_styles: None,
        skip_downsample: false,
    }
}

// ─── Benchmarks ──────────────────────────────────────────────────────────────

/// Bench: generate_chart_svg at various dataset sizes.
/// Exercises LTTB downsampling (n > 1500) and full SVG render path.
fn bench_chart_svg(c: &mut Criterion) {
    let mut group = c.benchmark_group("chart_svg");
    let config = default_chart_config();

    for n in [500usize, 2_000, 10_000, 50_000] {
        let points = make_chart_points_full(n);
        group.bench_with_input(BenchmarkId::from_parameter(n), &points, |b, pts| {
            b.iter(|| generate_chart_svg(black_box(pts), black_box(&config)))
        });
    }
    group.finish();
}

/// Bench: detect_schedule (step segmentation) at various dataset sizes.
fn bench_detect_schedule(c: &mut Criterion) {
    let config = ScheduleConfig::default();
    let mut group = c.benchmark_group("detect_schedule");

    for n in [1_000usize, 5_000, 20_000] {
        // Plateau data (no ramp): worst-case for schedule detector — all points are steps
        let data = make_rheo_points(n);
        group.bench_with_input(
            BenchmarkId::new("plateau", n),
            &data,
            |b, d| b.iter(|| detect_schedule(black_box(d), black_box(&config))),
        );

        // Multi-step ramp data: exercises ramp boundary detection
        let ramp_data = make_step_ramp(n / 5);
        group.bench_with_input(
            BenchmarkId::new("step_ramp", n),
            &ramp_data,
            |b, d| b.iter(|| detect_schedule(black_box(d), black_box(&config))),
        );
    }
    group.finish();
}

criterion_group!(benches, bench_chart_svg, bench_detect_schedule);
criterion_main!(benches);
