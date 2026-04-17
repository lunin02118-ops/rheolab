use crate::types::RheoPoint;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HydrationMetrics {
    pub max_viscosity: f64,
    pub time_to_max: f64,
    pub viscosity_at_20_min: f64,
    pub avg_viscosity_55_to_60: f64,
    pub subgroup: String,
}

pub fn evaluate_hydration(data: &[RheoPoint]) -> Option<HydrationMetrics> {
    if data.len() < 5 {
        return None;
    }

    // Sort by time
    let mut sorted = data.to_vec();
    sorted.sort_by(|a, b| a.time_sec.partial_cmp(&b.time_sec).unwrap_or(std::cmp::Ordering::Equal));
    
    let start_time = sorted[0].time_sec;

    // 1. Find maximum viscosity and time to reach it
    let mut max_viscosity = 0.0;
    let mut time_to_max = 0.0;
    
    for point in &sorted {
        if point.viscosity_cp > max_viscosity {
            max_viscosity = point.viscosity_cp;
            time_to_max = point.time_sec - start_time;
        }
    }

    // 2. Interpolate viscosity at T = 20 minutes (1200 seconds)
    let target_time_20 = start_time + 20.0 * 60.0;
    let viscosity_at_20_min = interpolate_viscosity(&sorted, target_time_20).unwrap_or(0.0);

    // 3. Average viscosity in 55-60 minute range
    let start_55 = start_time + 55.0 * 60.0;
    let end_60 = start_time + 60.0 * 60.0;
    
    let points_55_to_60: Vec<&RheoPoint> = sorted.iter()
        .filter(|p| p.time_sec >= start_55 && p.time_sec <= end_60)
        .collect();

    let avg_viscosity_55_to_60 = if !points_55_to_60.is_empty() {
        let sum: f64 = points_55_to_60.iter().map(|p| p.viscosity_cp).sum();
        sum / points_55_to_60.len() as f64
    } else {
        // If no data in this range, use last available value if test is long enough.
        // Guarded: sorted is non-empty (data.len() >= 5 checked at top of evaluate_hydration).
        let last_point = sorted.last().expect("non-empty: data.len() >= 5 checked at entry");
        if last_point.time_sec - start_time >= 50.0 * 60.0 {
            last_point.viscosity_cp
        } else {
            0.0
        }
    };

    // 4. Determine subgroup based on average temperature
    let avg_temp = sorted.iter().map(|p| p.temperature_c).sum::<f64>() / sorted.len() as f64;
    let subgroup = if avg_temp < 15.0 { "cold_water_5c" } else { "standard_25c" };

    Some(HydrationMetrics {
        max_viscosity: (max_viscosity * 100.0).round() / 100.0,
        time_to_max: time_to_max.round(),
        viscosity_at_20_min: (viscosity_at_20_min * 100.0).round() / 100.0,
        avg_viscosity_55_to_60: (avg_viscosity_55_to_60 * 100.0).round() / 100.0,
        subgroup: subgroup.to_string(),
    })
}

fn interpolate_viscosity(data: &[RheoPoint], target_time: f64) -> Option<f64> {
    if data.is_empty() {
        return None;
    }

    let mut before: Option<&RheoPoint> = None;
    let mut after: Option<&RheoPoint> = None;

    for point in data {
        if point.time_sec <= target_time {
            before = Some(point);
        }
        if point.time_sec >= target_time && after.is_none() {
            after = Some(point);
            break;
        }
    }

    match (before, after) {
        (None, None) => None,
        (None, Some(a)) => Some(a.viscosity_cp),
        (Some(b), None) => Some(b.viscosity_cp),
        (Some(b), Some(a)) => {
            if (a.time_sec - b.time_sec).abs() < f64::EPSILON {
                Some(b.viscosity_cp)
            } else {
                let ratio = (target_time - b.time_sec) / (a.time_sec - b.time_sec);
                Some(b.viscosity_cp + ratio * (a.viscosity_cp - b.viscosity_cp))
            }
        }
    }
}

pub fn is_hydration_test(data: &[RheoPoint]) -> bool {
    if data.len() < 10 {
        return false;
    }

    let mut sorted = data.to_vec();
    sorted.sort_by(|a, b| a.time_sec.partial_cmp(&b.time_sec).unwrap_or(std::cmp::Ordering::Equal));
    
    let start_time = sorted[0].time_sec;
    // Guarded: sorted is non-empty (data.len() >= 10 checked at top of is_hydration_test).
    let duration = sorted.last().expect("non-empty: data.len() >= 10 checked at entry").time_sec - start_time;

    // Hydration tests are typically 60+ minutes (45 min threshold)
    if duration < 45.0 * 60.0 {
        return false;
    }

    // Check for relatively constant shear rate (no step schedule)
    // In TS: diff > 10
    let has_varied_shear_rate = sorted.windows(2).any(|w| {
        let p_prev = &w[0];
        let p_curr = &w[1];
        
        // Check if shear_rate exists (shear_rate is Option<f64>)
        let sr_prev = p_prev.shear_rate.unwrap_or(0.0);
        let sr_curr = p_curr.shear_rate.unwrap_or(0.0);
        
        // Skip if either is missing
        if sr_prev == 0.0 || sr_curr == 0.0 {
            return false;
        }
        
        (sr_curr - sr_prev).abs() > 10.0
    });

    // Hydration tests typically don't have varied shear rates
    // If first point has no shear rate, we assume it's hydration
    let first_has_shear_rate = sorted.first()
        .and_then(|p| p.shear_rate)
        .map(|sr| sr > 0.0)
        .unwrap_or(false);
    
    !has_varied_shear_rate || !first_has_shear_rate
}
