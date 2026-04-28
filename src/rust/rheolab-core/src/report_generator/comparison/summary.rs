//! Summary-row computation for the comparison report.
//!
//! The comparison view page/sheet 1 carries one row per experiment with a
//! handful of quick-glance metrics: experiment name, test ID, number of
//! data points, duration, peak viscosity, and final viscosity.  These are
//! all trivially derivable from each experiment's `ReportInput` — no
//! heavy statistics computation required.

use super::super::types::ReportInput;
use super::types::ComparisonExperimentEntry;

/// One row of the sheet/page 1 summary table.
///
/// All viscosity values are carried in the **storage unit (cP / mPa·s)**;
/// the renderer is responsible for converting to the user's preferred
/// display unit using `convert_viscosity`.
#[derive(Debug, Clone, PartialEq)]
pub struct ExperimentSummary {
    pub display_name: String,

    /// Test ID from metadata, falling back to `"—"` when absent.
    pub test_id: String,

    /// Number of raw data points in the experiment.
    pub data_points: usize,

    /// Total experiment duration in minutes
    /// (`last_time_sec - first_time_sec) / 60`).  0.0 when `raw_data` is empty.
    pub duration_min: f64,

    /// Maximum viscosity observed across the whole run (cP).  0.0 when empty.
    pub max_viscosity_cp: f64,

    /// Final (last) viscosity sample (cP).  0.0 when empty.
    pub final_viscosity_cp: f64,

    /// Arithmetic mean of every finite `temperature_c` sample (°C).
    /// `None` when the experiment has no temperature data at all — keeps the
    /// renderer from showing a misleading `0.0 °C` for runs where the
    /// instrument never reported temperature.
    pub avg_temp_c: Option<f64>,

    /// Arithmetic mean of every finite `pressure_bar` sample (bar).
    /// `None` when no pressure data was logged — most lab tests at
    /// atmospheric pressure leave this column empty in the source data,
    /// so propagating `None` lets the table show "—" rather than `0.0`.
    pub avg_pressure_bar: Option<f64>,
}

/// Average a stream of optional `f64`s, ignoring `None` and non-finite
/// entries. Returns `None` when no usable sample was found so the renderer
/// can show "—" rather than a misleading `0.0`. Splitting this out keeps
/// `from_report_input` readable and the computation easy to unit-test.
fn average_finite_optional<I>(samples: I) -> Option<f64>
where
    I: IntoIterator<Item = Option<f64>>,
{
    let mut sum = 0.0_f64;
    let mut count = 0_usize;
    for s in samples {
        if let Some(v) = s {
            if v.is_finite() {
                sum += v;
                count += 1;
            }
        }
    }
    if count == 0 { None } else { Some(sum / count as f64) }
}

impl ExperimentSummary {
    /// Build a single summary row from a display name and a [`ReportInput`].
    pub fn from_report_input(display_name: &str, input: &ReportInput) -> Self {
        let test_id = input.metadata.test_id.as_deref()
            .or(Some(input.metadata.filename.as_str()))
            .filter(|s| !s.is_empty())
            .unwrap_or("—")
            .to_string();

        let data_points = input.raw_data.len();

        let (duration_min, max_viscosity_cp, final_viscosity_cp) = if data_points == 0 {
            (0.0, 0.0, 0.0)
        } else {
            let first_time = input.raw_data.first().map(|p| p.time_sec).unwrap_or(0.0);
            let last_time  = input.raw_data.last() .map(|p| p.time_sec).unwrap_or(0.0);
            let duration = ((last_time - first_time) / 60.0).max(0.0);

            let max_v = input.raw_data.iter()
                .map(|p| p.viscosity_cp)
                .filter(|v| v.is_finite())
                .fold(f64::NEG_INFINITY, f64::max);
            let max_v = if max_v.is_finite() { max_v } else { 0.0 };

            let final_v = input.raw_data.last()
                .map(|p| p.viscosity_cp)
                .filter(|v| v.is_finite())
                .unwrap_or(0.0);

            (duration, max_v, final_v)
        };

        // Mean over every finite temperature / pressure sample. Both columns
        // are `Option<f64>` on `DataPoint`, so we can't lean on the
        // viscosity-side `is_finite()` filter alone.
        let avg_temp_c = average_finite_optional(
            input.raw_data.iter().map(|p| p.temperature_c),
        );
        let avg_pressure_bar = average_finite_optional(
            input.raw_data.iter().map(|p| p.pressure_bar),
        );

        Self {
            display_name: display_name.to_string(),
            test_id,
            data_points,
            duration_min,
            max_viscosity_cp,
            final_viscosity_cp,
            avg_temp_c,
            avg_pressure_bar,
        }
    }
}

/// Build one summary row per entry in `experiments`, preserving order.
pub fn build_summaries(entries: &[ComparisonExperimentEntry]) -> Vec<ExperimentSummary> {
    entries.iter()
        .map(|e| ExperimentSummary::from_report_input(&e.display_name, &e.report_input))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::super::types::{DataPoint, ReportMetadata, ReportSettings};

    fn mk_input(points: Vec<DataPoint>, test_id: Option<&str>, filename: &str) -> ReportInput {
        ReportInput {
            raw_data: points,
            metadata: ReportMetadata {
                filename: filename.to_string(),
                test_id: test_id.map(String::from),
                ..Default::default()
            },
            cycle_results: vec![],
            recipe: vec![],
            water_params: None,
            cycles: vec![],
            settings: ReportSettings::default(),
            chart_image_base64: None,
            axis_values: None,
        }
    }

    fn mk_point(t_sec: f64, visc_cp: f64) -> DataPoint {
        DataPoint {
            time_sec: t_sec,
            viscosity_cp: visc_cp,
            temperature_c: None,
            shear_rate: None,
            shear_stress_pa: None,
            speed_rpm: None,
            pressure_bar: None,
            bath_temperature_c: None,
        }
    }

    fn mk_full_point(t_sec: f64, visc_cp: f64, temp_c: Option<f64>, press_bar: Option<f64>) -> DataPoint {
        DataPoint {
            time_sec: t_sec,
            viscosity_cp: visc_cp,
            temperature_c: temp_c,
            shear_rate: None,
            shear_stress_pa: None,
            speed_rpm: None,
            pressure_bar: press_bar,
            bath_temperature_c: None,
        }
    }

    #[test]
    fn summary_computes_basic_metrics() {
        // 3 points over 5 minutes, viscosity 100, 300, 150 → max=300, final=150, duration=5.0
        let input = mk_input(
            vec![mk_point(0.0, 100.0), mk_point(150.0, 300.0), mk_point(300.0, 150.0)],
            Some("T-42"),
            "test.dat",
        );
        let s = ExperimentSummary::from_report_input("Chandler", &input);
        assert_eq!(s.display_name, "Chandler");
        assert_eq!(s.test_id, "T-42");
        assert_eq!(s.data_points, 3);
        assert!((s.duration_min - 5.0).abs() < 1e-6);
        assert_eq!(s.max_viscosity_cp, 300.0);
        assert_eq!(s.final_viscosity_cp, 150.0);
        // No temp / pressure logged → renderer must show "—".
        assert_eq!(s.avg_temp_c, None);
        assert_eq!(s.avg_pressure_bar, None);
    }

    #[test]
    fn summary_falls_back_to_filename_when_test_id_missing() {
        let input = mk_input(vec![mk_point(0.0, 42.0)], None, "experiment.dat");
        let s = ExperimentSummary::from_report_input("X", &input);
        assert_eq!(s.test_id, "experiment.dat");
    }

    #[test]
    fn summary_handles_empty_data_gracefully() {
        let input = mk_input(vec![], Some("empty"), "nil.dat");
        let s = ExperimentSummary::from_report_input("Y", &input);
        assert_eq!(s.data_points, 0);
        assert_eq!(s.duration_min, 0.0);
        assert_eq!(s.max_viscosity_cp, 0.0);
        assert_eq!(s.final_viscosity_cp, 0.0);
        assert_eq!(s.avg_temp_c, None);
        assert_eq!(s.avg_pressure_bar, None);
    }

    #[test]
    fn summary_averages_finite_temperature_and_pressure() {
        // 3 points, all with temp + pressure. Means: temp = (90 + 92 + 94) / 3 = 92,
        // pressure = (350 + 360 + 370) / 3 = 360.
        let input = mk_input(
            vec![
                mk_full_point(0.0,   100.0, Some(90.0), Some(350.0)),
                mk_full_point(60.0,  150.0, Some(92.0), Some(360.0)),
                mk_full_point(120.0, 200.0, Some(94.0), Some(370.0)),
            ],
            Some("T-A"),
            "tempPressure.dat",
        );
        let s = ExperimentSummary::from_report_input("Run-A", &input);
        let avg_t = s.avg_temp_c.expect("temp average should be Some");
        let avg_p = s.avg_pressure_bar.expect("pressure average should be Some");
        assert!((avg_t - 92.0).abs() < 1e-6);
        assert!((avg_p - 360.0).abs() < 1e-6);
    }

    #[test]
    fn summary_temperature_average_skips_non_finite_and_missing() {
        // Mix of None / NaN / finite: only the finite samples should count.
        // temp: None, 80, NaN, 100 → mean over {80, 100} = 90
        // pressure: 200, None, 220, None → mean over {200, 220} = 210
        let input = mk_input(
            vec![
                mk_full_point(0.0,    50.0, None,            Some(200.0)),
                mk_full_point(60.0,   60.0, Some(80.0),      None),
                mk_full_point(120.0,  70.0, Some(f64::NAN),  Some(220.0)),
                mk_full_point(180.0,  80.0, Some(100.0),     None),
            ],
            Some("T-B"),
            "mixed.dat",
        );
        let s = ExperimentSummary::from_report_input("Run-B", &input);
        let avg_t = s.avg_temp_c.expect("must average finite-only samples");
        let avg_p = s.avg_pressure_bar.expect("pressure has 2 finite samples");
        assert!((avg_t - 90.0).abs() < 1e-6);
        assert!((avg_p - 210.0).abs() < 1e-6);
    }

    #[test]
    fn summary_returns_none_when_every_sample_is_non_finite() {
        // Each point has non-finite temp; the renderer expects None to
        // surface as "—" rather than 0.0 (which would falsely imply
        // a measured ambient temperature).
        let input = mk_input(
            vec![
                mk_full_point(0.0,  100.0, Some(f64::NAN),       None),
                mk_full_point(60.0, 200.0, Some(f64::INFINITY),  None),
            ],
            Some("T-C"),
            "all-nan.dat",
        );
        let s = ExperimentSummary::from_report_input("Run-C", &input);
        assert_eq!(s.avg_temp_c, None);
        assert_eq!(s.avg_pressure_bar, None);
    }

    #[test]
    fn summary_preserves_order() {
        let a = mk_input(vec![mk_point(0.0, 100.0)], Some("A"), "a.dat");
        let b = mk_input(vec![mk_point(0.0, 200.0)], Some("B"), "b.dat");
        let entries = vec![
            ComparisonExperimentEntry {
                id: "1".into(), display_name: "A".into(),
                report_input: a,
                section_toggles: Default::default(),
            },
            ComparisonExperimentEntry {
                id: "2".into(), display_name: "B".into(),
                report_input: b,
                section_toggles: Default::default(),
            },
        ];
        let summaries = build_summaries(&entries);
        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[0].display_name, "A");
        assert_eq!(summaries[1].display_name, "B");
    }

    #[test]
    fn summary_skips_non_finite_viscosity() {
        let input = mk_input(
            vec![
                mk_point(0.0, 100.0),
                mk_point(60.0, f64::NAN),
                mk_point(120.0, 250.0),
            ],
            Some("T"),
            "t.dat",
        );
        let s = ExperimentSummary::from_report_input("Z", &input);
        // max ignores NaN
        assert_eq!(s.max_viscosity_cp, 250.0);
        // final = last sample's viscosity (250 is finite)
        assert_eq!(s.final_viscosity_cp, 250.0);
    }
}
