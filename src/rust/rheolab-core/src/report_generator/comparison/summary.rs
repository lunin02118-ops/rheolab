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

        Self {
            display_name: display_name.to_string(),
            test_id,
            data_points,
            duration_min,
            max_viscosity_cp,
            final_viscosity_cp,
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
