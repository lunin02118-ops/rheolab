use crate::types::{RheoPoint, RheoStep};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleConfig {
    #[serde(rename = "shearRateTolerance")]
    pub shear_rate_tolerance: f64,
    #[serde(rename = "shearRateRelTolerance")]
    pub shear_rate_rel_tolerance: f64,
    #[serde(rename = "minStepDuration")]
    pub min_step_duration: f64,
    #[serde(rename = "stepSplitting")]
    pub step_splitting: bool,
    #[serde(rename = "splitStartDuration")]
    pub split_start_duration: f64,
    #[serde(rename = "splitEndDuration")]
    pub split_end_duration: f64,
    #[serde(rename = "minDurationForSplit")]
    pub min_duration_for_split: f64,
}

impl Default for ScheduleConfig {
    fn default() -> Self {
        Self {
            shear_rate_tolerance: 2.0,
            shear_rate_rel_tolerance: 5.0,
            min_step_duration: 5.0,
            step_splitting: true,
            split_start_duration: 30.0,
            split_end_duration: 30.0,
            min_duration_for_split: 90.0,
        }
    }
}

pub fn detect_schedule(data: &[RheoPoint], config: &ScheduleConfig) -> Vec<RheoStep> {
    if data.is_empty() {
        return Vec::new();
    }

    let mut steps: Vec<RheoStep> = Vec::new();
    let mut step_id_counter = 1;

    let sr_abs_tol = config.shear_rate_tolerance;
    let sr_rel_tol_decimal = config.shear_rate_rel_tolerance / 100.0;

    let mut i = 0;
    while i < data.len() {
        let current_rate = data[i].shear_rate.unwrap_or(0.0);
        let mut segment_end_idx = i;
        let mut j = i + 1;

        // Find segment with similar shear rate
        while j < data.len() {
            let next_rate = data[j].shear_rate.unwrap_or(0.0);

            let mut allowed_deviation = sr_abs_tol;
            if current_rate.abs() > 1e-6 {
                allowed_deviation = sr_abs_tol.max((current_rate * sr_rel_tol_decimal).abs());
            }

            if (next_rate - current_rate).abs() > allowed_deviation {
                break;
            }
            segment_end_idx = j;
            j += 1;
        }

        // Process segment
        let segment_points = &data[i..=segment_end_idx];
        let start_time = segment_points[0].time_sec;
        let end_time = segment_points[segment_points.len() - 1].time_sec;

        let mut duration = 0.0;
        let mut step_start_time = start_time;

        if steps.is_empty() {
            duration = end_time - start_time;
            step_start_time = start_time;
        } else if let Some(last_step) = steps.last() {
            let prev_step_end = last_step.end_time;
            duration = end_time - prev_step_end;
            step_start_time = prev_step_end;
        }

        // Filter short steps
        if duration >= config.min_step_duration - 1e-5 {
            let count = segment_points.len() as f64;
            let avg_rate = segment_points
                .iter()
                .map(|p| p.shear_rate.unwrap_or(0.0))
                .sum::<f64>()
                / count;
            let avg_stress = segment_points
                .iter()
                .map(|p| p.shear_stress.unwrap_or(0.0))
                .sum::<f64>()
                / count;
            let avg_visc = segment_points.iter().map(|p| p.viscosity_cp).sum::<f64>() / count;
            let avg_temp = segment_points.iter().map(|p| p.temperature_c).sum::<f64>() / count;
            let avg_press = segment_points
                .iter()
                .map(|p| p.pressure_bar.unwrap_or(0.0))
                .sum::<f64>()
                / count;

            let base_step = RheoStep {
                id: step_id_counter,
                start_time: step_start_time,
                end_time,
                duration,
                avg_shear_rate: avg_rate,
                avg_shear_stress: avg_stress,
                avg_viscosity: avg_visc,
                avg_temperature: avg_temp,
                avg_pressure: avg_press,
                points: segment_points.to_vec(),
                calc_points_count: segment_points.len() as i32,
                is_ramp: false,
                start_index: i as i32,
                end_index: segment_end_idx as i32,
                is_split_start: false,
            };
            step_id_counter += 1;

            // Step Splitting Logic
            if config.step_splitting && duration >= config.min_duration_for_split {
                let min_total = config.split_start_duration + config.split_end_duration + 0.1;
                if duration > min_total {
                    // Split into Start + End (ignore middle conditioning part)

                    // Part 1: Start segment
                    let t_start = step_start_time;
                    let t_end1 = t_start + config.split_start_duration;
                    steps.push(create_split_step(
                        &base_step,
                        segment_points,
                        t_start,
                        t_end1,
                        step_id_counter,
                    ));
                    step_id_counter += 1;

                    // Part 2: End segment
                    let t_end2 = end_time;
                    let t_start2 = t_end2 - config.split_end_duration;
                    steps.push(create_split_step(
                        &base_step,
                        segment_points,
                        t_start2,
                        t_end2,
                        step_id_counter,
                    ));
                    step_id_counter += 1;
                } else {
                    steps.push(base_step);
                }
            } else {
                steps.push(base_step);
            }
        }

        i = segment_end_idx + 1;
    }

    steps
}

fn create_split_step(
    base_step: &RheoStep,
    points: &[RheoPoint],
    t0: f64,
    t1: f64,
    id: i32,
) -> RheoStep {
    let pts: Vec<RheoPoint> = points
        .iter()
        .filter(|p| p.time_sec >= t0 && p.time_sec <= t1)
        .cloned()
        .collect();

    let (avg_rate, avg_stress, avg_visc, avg_temp, avg_press) = if !pts.is_empty() {
        let count = pts.len() as f64;
        (
            pts.iter().map(|p| p.shear_rate.unwrap_or(0.0)).sum::<f64>() / count,
            pts.iter()
                .map(|p| p.shear_stress.unwrap_or(0.0))
                .sum::<f64>()
                / count,
            pts.iter().map(|p| p.viscosity_cp).sum::<f64>() / count,
            pts.iter().map(|p| p.temperature_c).sum::<f64>() / count,
            pts.iter()
                .map(|p| p.pressure_bar.unwrap_or(0.0))
                .sum::<f64>()
                / count,
        )
    } else {
        (
            base_step.avg_shear_rate,
            base_step.avg_shear_stress,
            base_step.avg_viscosity,
            base_step.avg_temperature,
            base_step.avg_pressure,
        )
    };

    RheoStep {
        id,
        start_time: t0,
        end_time: t1,
        duration: t1 - t0,
        avg_shear_rate: avg_rate,
        avg_shear_stress: avg_stress,
        avg_viscosity: avg_visc,
        avg_temperature: avg_temp,
        avg_pressure: avg_press,
        points: pts.clone(),
        calc_points_count: pts.len() as i32,
        is_ramp: false,
        start_index: -1,
        end_index: -1,
        is_split_start: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_point(time: f64, rate: f64) -> RheoPoint {
        RheoPoint {
            time_sec: time,
            shear_rate: Some(rate),
            shear_stress: Some(rate * 0.5),
            viscosity_cp: 500.0,
            temperature_c: 80.0,
            pressure_bar: None,
            rpm: None,
            bath_temperature_c: None,
        }
    }

    #[test]
    fn test_detect_schedule_duration_nonzero() {
        // Simulate a simple API-like pattern: rate 100 for 30s, then 75 for 30s, then 50 for 30s
        let mut points = Vec::new();
        // Step 1: rate=100, time 0..30 (10 points)
        for i in 0..10 {
            points.push(make_point(i as f64 * 3.0, 100.0));
        }
        // Step 2: rate=75, time 30..60 (10 points)
        for i in 0..10 {
            points.push(make_point(30.0 + i as f64 * 3.0, 75.0));
        }
        // Step 3: rate=50, time 60..90 (10 points)
        for i in 0..10 {
            points.push(make_point(60.0 + i as f64 * 3.0, 50.0));
        }

        let config = ScheduleConfig::default();
        let steps = detect_schedule(&points, &config);

        assert!(
            steps.len() >= 3,
            "Expected at least 3 steps, got {}",
            steps.len()
        );

        for (i, step) in steps.iter().enumerate() {
            println!(
                "Step {}: id={}, start_time={}, end_time={}, duration={}, avg_rate={}",
                i, step.id, step.start_time, step.end_time, step.duration, step.avg_shear_rate
            );
            assert!(
                step.duration > 0.0,
                "Step {} has duration=0! start={}, end={}",
                i,
                step.start_time,
                step.end_time
            );
        }
    }

    #[test]
    fn test_serde_roundtrip_duration() {
        let step = RheoStep {
            id: 1,
            start_time: 10.0,
            end_time: 40.0,
            duration: 30.0,
            avg_shear_rate: 100.0,
            avg_shear_stress: 50.0,
            avg_viscosity: 500.0,
            avg_temperature: 80.0,
            avg_pressure: 0.0,
            points: vec![],
            calc_points_count: 5,
            is_ramp: false,
            start_index: 0,
            end_index: 4,
            is_split_start: false,
        };

        // Serialize to JSON (same serde attributes as serde_wasm_bindgen)
        let json = serde_json::to_string(&step).unwrap();
        println!("Serialized JSON: {}", json);
        assert!(
            json.contains("\"duration\":30"),
            "JSON should contain duration:30, got: {}",
            json
        );

        // Deserialize back
        let deserialized: RheoStep = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.duration, 30.0, "Duration lost in roundtrip!");
        assert_eq!(
            deserialized.start_time, 10.0,
            "start_time lost in roundtrip!"
        );
        assert_eq!(deserialized.end_time, 40.0, "end_time lost in roundtrip!");

        // Also test deserialization from camelCase (which is what serde_wasm_bindgen produces)
        let camel_json = r#"{"id":1,"startTime":10,"endTime":40,"duration":30,"avgShearRate":100,"avgShearStress":50,"avgViscosity":500,"avgTemperature":80,"avgPressure":0,"points":[],"calcPointsCount":5,"isRamp":false,"startIndex":0,"endIndex":4,"isSplitStart":false}"#;
        let from_camel: RheoStep = serde_json::from_str(camel_json).unwrap();
        assert_eq!(
            from_camel.duration, 30.0,
            "Duration lost from camelCase JSON!"
        );
        println!("Serde roundtrip OK: duration={}", from_camel.duration);
    }
}
