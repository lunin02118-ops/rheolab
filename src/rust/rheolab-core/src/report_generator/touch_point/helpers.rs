//! Pre-processing helpers for touch-point detection:
//! dominant-rate clustering, shear-rate filtering, viscosity-peak detection.

use super::types::TouchPointInput;

/// Minimum number of consecutive declining windows to confirm trend reversal.
const MIN_DECLINING_WINDOWS: usize = 2;
/// Step size for sliding window (fraction of window width).
const WINDOW_STEP_FRACTION: f64 = 0.5;

/// Determine the dominant (most frequent) shear rate in the dataset.
///
/// Groups shear rates into buckets of ±tolerance and returns the centre of the
/// largest bucket.  Ignores zero / absent shear rates.
pub fn find_dominant_shear_rate(points: &[TouchPointInput], tolerance: f64) -> Option<f64> {
    let mut rates: Vec<f64> = points
        .iter()
        .filter(|p| p.shear_rate > 0.0)
        .map(|p| p.shear_rate)
        .collect();

    if rates.is_empty() {
        return None;
    }

    rates.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    // Greedy clustering: walk sorted list, group values within ±tolerance of
    // the cluster start.
    let mut best_start = 0usize;
    let mut best_count = 0usize;

    let mut cluster_start = 0usize;
    while cluster_start < rates.len() {
        let centre = rates[cluster_start];
        let hi = centre * (1.0 + tolerance);
        let mut cluster_end = cluster_start;
        while cluster_end < rates.len() && rates[cluster_end] <= hi {
            cluster_end += 1;
        }
        let count = cluster_end - cluster_start;
        if count > best_count {
            best_count = count;
            best_start = cluster_start;
        }
        cluster_start = cluster_end;
    }

    // Return median of largest cluster
    let mid = best_start + best_count / 2;
    Some(rates[mid])
}

/// Filter points to only those recorded at approximately the dominant shear rate.
/// Non-dominant points (ramps at other shear rates) are excluded.
/// The downstream `find_viscosity_peak` then ensures the touch-point search
/// starts only on the descending trend (after the viscosity peak), which
/// naturally skips any transient readings near ramp boundaries.
pub fn filter_by_shear_rate(
    points: &[TouchPointInput],
    dominant_rate: f64,
    tolerance: f64,
) -> Vec<TouchPointInput> {
    let lo = dominant_rate * (1.0 - tolerance);
    let hi = dominant_rate * (1.0 + tolerance);
    points
        .iter()
        .filter(|p| p.shear_rate >= lo && p.shear_rate <= hi)
        .cloned()
        .collect()
}

/// Find the time at which the viscosity ramp-up ends (peak) using a sliding-
/// window average.  Returns `None` if no peak is detected (monotonically
/// falling from start → search from beginning).
pub fn find_viscosity_peak(points: &[TouchPointInput], window_minutes: f64) -> Option<f64> {
    if points.len() < 2 {
        return None;
    }

    let step = window_minutes * WINDOW_STEP_FRACTION;
    let t_start = points[0].time_min;
    let t_end = points[points.len() - 1].time_min;

    if t_end - t_start < window_minutes {
        return None;
    }

    // Compute window averages
    struct WindowAvg {
        t_center: f64,
        avg: f64,
    }
    let mut windows: Vec<WindowAvg> = Vec::new();

    let mut w_start = t_start;
    while w_start + window_minutes <= t_end + 0.001 {
        let w_end = w_start + window_minutes;
        let mut sum = 0.0;
        let mut count = 0u32;
        for p in points {
            if p.time_min >= w_start && p.time_min < w_end {
                sum += p.viscosity_cp;
                count += 1;
            }
        }
        if count > 0 {
            windows.push(WindowAvg {
                t_center: w_start + window_minutes / 2.0,
                avg: sum / count as f64,
            });
        }
        w_start += step;
    }

    if windows.len() < 2 {
        return None;
    }

    // Detect first sustained decline.
    // Gap-aware: when shear-rate filtering creates time gaps in the data
    // (e.g. the 100 s⁻¹ timeline jumps from t=8 to t=12), a single window
    // comparison across the gap shows a huge average drop that is NOT a
    // real viscosity decline.  Reset declining counter when the gap
    // between consecutive window centres exceeds 3× the normal step.
    let max_gap = step * 3.0;
    let mut declining_count = 0usize;
    for i in 1..windows.len() {
        let dt = windows[i].t_center - windows[i - 1].t_center;
        if dt > max_gap {
            declining_count = 0;
            continue;
        }
        if windows[i].avg < windows[i - 1].avg {
            declining_count += 1;
            if declining_count >= MIN_DECLINING_WINDOWS {
                let peak_idx = i - declining_count;
                return Some(windows[peak_idx].t_center);
            }
        } else {
            declining_count = 0;
        }
    }

    // No sustained decline — viscosity keeps rising
    None
}
