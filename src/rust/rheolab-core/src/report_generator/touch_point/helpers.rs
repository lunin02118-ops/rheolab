//! Pre-processing helpers for touch-point detection:
//! dominant-rate clustering, shear-rate filtering, viscosity-peak detection.

use super::types::TouchPointInput;

/// Minimum number of consecutive declining windows to confirm trend reversal.
const MIN_DECLINING_WINDOWS: usize = 2;
/// Step size for sliding window (fraction of window width).
const WINDOW_STEP_FRACTION: f64 = 0.5;
/// Minimum relative drop between two consecutive sliding windows before the
/// algorithm counts it as a decline.  Mirrors the TS `MIN_DECLINE_RATIO`
/// (BUG #7 fix): on noisy plateau data the old code treated even 0.01 %
/// fluctuations as declines, occasionally flagging the ramp-up itself as
/// the peak.  1 % is conservative enough to filter noise but still detects
/// every real peak observed in the fixture suite.
const MIN_DECLINE_RATIO: f64 = 0.01;

/// Return the smallest index `i` in `arr` for which `arr[i] >= value`,
/// or `arr.len()` when no such index exists.  Assumes `arr` is sorted
/// ascending.  Used by [`find_dominant_shear_rate`]'s symmetric clustering.
fn lower_bound(arr: &[f64], value: f64) -> usize {
    let (mut l, mut r) = (0usize, arr.len());
    while l < r {
        let m = (l + r) / 2;
        if arr[m] < value {
            l = m + 1;
        } else {
            r = m;
        }
    }
    l
}

/// Return the smallest index `i` in `arr` for which `arr[i] > value`,
/// or `arr.len()` when no such index exists.  Assumes `arr` is sorted.
fn upper_bound(arr: &[f64], value: f64) -> usize {
    let (mut l, mut r) = (0usize, arr.len());
    while l < r {
        let m = (l + r) / 2;
        if arr[m] <= value {
            l = m + 1;
        } else {
            r = m;
        }
    }
    l
}

/// Determine the dominant (most frequent) shear rate in the dataset.
///
/// For each observed rate `r` the function counts how many rates fall
/// inside the **symmetric** window `[r·(1−t), r·(1+t)]` and returns the
/// median of the largest such window — BUG #8 fix.  The old greedy
/// implementation grew each cluster only UPWARDS from its start
/// (bounded by `centre·(1+tolerance)`), biasing the choice of cluster
/// centre and occasionally picking an outlier at the boundary between
/// two real clusters.  Ignores zero / absent shear rates.
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

    let mut best_count: usize = 0;
    let mut best_centre: f64 = rates[0];

    for i in 0..rates.len() {
        let centre = rates[i];
        let lo = centre * (1.0 - tolerance);
        let hi = centre * (1.0 + tolerance);
        let lo_idx = lower_bound(&rates, lo);
        let hi_idx = upper_bound(&rates, hi);
        let count = hi_idx - lo_idx;
        if count > best_count {
            best_count = count;
            best_centre = rates[lo_idx + count / 2];
        }
    }

    Some(best_centre)
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
        // BUG #7 fix: require at least MIN_DECLINE_RATIO (1 %) relative
        // drop so that micro-oscillations of the sliding-window average
        // on a noisy plateau are not counted as a genuine decline.
        // Zero-valued plateau averages are treated as equal (identity
        // threshold) to avoid divide-by-zero in edge cases.
        let prev = windows[i - 1].avg;
        let curr = windows[i].avg;
        let decline_threshold = if prev > 0.0 {
            prev * (1.0 - MIN_DECLINE_RATIO)
        } else {
            prev
        };
        if curr < decline_threshold {
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
