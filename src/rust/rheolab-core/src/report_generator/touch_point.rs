//! Smart touch-point (threshold crossing) calculation.
//!
//! Accounts for:
//!  1. Shear-rate ramps — only considers points at the dominant (main mixing)
//!     shear rate (determined automatically as the mode, ±5 % tolerance).
//!  2. Initial viscosity ramp-up — uses a 1-minute sliding-window average to
//!     detect when the viscosity trend changes from rising to falling (peak),
//!     and only searches for the threshold crossing *after* the peak.
//!
//! The algorithm is a 1:1 Rust port of `src/lib/utils/touch-point.ts` so that
//! PDF / Excel reports produce the same touch-point as the frontend chart.

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_TREND_WINDOW_MIN: f64 = 1.0;
const DEFAULT_SHEAR_RATE_TOLERANCE: f64 = 0.05;
/// Minimum number of consecutive declining windows to confirm trend reversal.
const MIN_DECLINING_WINDOWS: usize = 2;
/// Step size for sliding window (fraction of window width).
const WINDOW_STEP_FRACTION: f64 = 0.5;
/// Default time-based centred moving-average window (minutes) for smoothing
/// viscosity before threshold detection.  Matches the TS default of 3 min.
const DEFAULT_SMOOTHING_WINDOW_MIN: f64 = 3.0;
/// Minimum number of consecutive *smoothed* viscosity values at-or-below
/// the threshold to confirm a sustained crossing.  Reduced from 5 to 3
/// because the smoothing pass already filters single-point noise.
const MIN_CONSECUTIVE_BELOW: usize = 3;
/// Number of smoothed data points to look back when verifying that a
/// threshold crossing is on a genuinely DESCENDING viscosity trend.
const SLOPE_LOOKBACK_POINTS: usize = 10;

// ─── Input / output types ────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct TouchPointInput {
    pub time_min: f64,
    pub viscosity_cp: f64,
    pub shear_rate: f64, // 0.0 means absent
}

#[derive(Debug, Clone)]
pub enum TouchPointType {
    Threshold,
    Target,
}

#[derive(Debug, Clone)]
pub struct TouchPointResult {
    pub time: f64,
    pub viscosity: f64,
    pub tp_type: TouchPointType,
}

pub struct SmartTouchPointOptions {
    pub viscosity_threshold: f64,
    pub show_target_time: bool,
    pub target_time: f64,
    pub trend_window_minutes: f64,
    pub shear_rate_tolerance: f64,
    /// Width of the centred moving-average smoothing window in minutes.
    /// Default matches TS: 3 min (±1.5 min each side).
    pub smoothing_window_minutes: f64,
}

impl Default for SmartTouchPointOptions {
    fn default() -> Self {
        Self {
            viscosity_threshold: 500.0,
            show_target_time: true,
            target_time: 10.0,
            trend_window_minutes: DEFAULT_TREND_WINDOW_MIN,
            shear_rate_tolerance: DEFAULT_SHEAR_RATE_TOLERANCE,
            smoothing_window_minutes: DEFAULT_SMOOTHING_WINDOW_MIN,
        }
    }
}

// ─── Core algorithm ──────────────────────────────────────────────────────────

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

// ─── Main entry point ────────────────────────────────────────────────────────

/// Compute smart touch points: threshold crossing + optional target-time point.
pub fn calculate_smart_touch_points(
    points: &[TouchPointInput],
    options: &SmartTouchPointOptions,
) -> Vec<TouchPointResult> {
    if points.is_empty() {
        return Vec::new();
    }

    let mut results = Vec::new();

    // Step 1: dominant shear rate
    let dominant_rate = find_dominant_shear_rate(points, options.shear_rate_tolerance);

    let filtered: Vec<TouchPointInput> = match dominant_rate {
        Some(rate) => filter_by_shear_rate(points, rate, options.shear_rate_tolerance),
        None => points.to_vec(),
    };

    if filtered.is_empty() {
        return Vec::new();
    }

    // Step 2: find peak (end of ramp-up)
    let peak_time = find_viscosity_peak(&filtered, options.trend_window_minutes);

    let search_points: Vec<&TouchPointInput> = match peak_time {
        Some(pt) => filtered.iter().filter(|p| p.time_min >= pt).collect(),
        None => filtered.iter().collect(),
    };

    if search_points.is_empty() {
        return Vec::new();
    }

    // Step 3: find threshold crossing — pre-smooth viscosity with a centred
    // moving average to dampen transient noise, then require
    // MIN_CONSECUTIVE_BELOW consecutive smoothed values at-or-below threshold.
    {
        // Determine typical sampling interval from the TAIL (last ≤100
        // intervals) of the search region.  See the matching TS comment for
        // the rationale: tail sampling avoids the dense initial ramp-up burst
        // skewing the gap threshold, so multi-rate plateau intervals (e.g.
        // 1 min in Grace 3600) are correctly treated as normal, not as gaps.
        let mut interval_samples: Vec<f64> = Vec::with_capacity(100);
        let sample_start = search_points.len().saturating_sub(100).max(1);
        for i in sample_start..search_points.len() {
            interval_samples.push(
                search_points[i].time_min - search_points[i - 1].time_min,
            );
        }
        interval_samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median_interval = if interval_samples.is_empty() {
            0.1
        } else {
            interval_samples[interval_samples.len() / 2]
        };
        let gap_threshold = median_interval * 10.0;

        // Time-based centred MEDIAN smoothing: for each point i collect
        // all values within ±half_window minutes, sort, take the median.
        // Mirrors the TS implementation (1:1 parity for PDF/Excel reports).
        // The median is robust to spike outliers — sharp periodic peaks at
        // the operating shear rate cannot pull the smoothed baseline above
        // the threshold unlike the mean.
        let half_window = options.smoothing_window_minutes / 2.0;
        let mut smoothed = vec![0.0_f64; search_points.len()];
        {
            let mut w_lo: usize = 0;
            for i in 0..search_points.len() {
                let t_center = search_points[i].time_min;
                let t_lo = t_center - half_window;
                let t_hi = t_center + half_window;
                // Advance left boundary past t_lo
                while w_lo < i && search_points[w_lo].time_min < t_lo {
                    w_lo += 1;
                }
                // Find right boundary (scan forward from i)
                let mut w_hi = i;
                while w_hi + 1 < search_points.len()
                    && search_points[w_hi + 1].time_min <= t_hi
                {
                    w_hi += 1;
                }
                // Collect, sort, median
                let count = w_hi - w_lo + 1;
                let mut vals: Vec<f64> = (0..count)
                    .map(|j| search_points[w_lo + j].viscosity_cp)
                    .collect();
                vals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                let mid = count / 2;
                smoothed[i] = if count % 2 == 1 {
                    vals[mid]
                } else {
                    (vals[mid - 1] + vals[mid]) / 2.0
                };
            }
        }

        // Smoothing half-window in points for gap/slope checks.
        let smoothing_half_points: usize = if median_interval > 0.0 {
            ((half_window / median_interval).round() as usize).max(2)
        } else {
            SLOPE_LOOKBACK_POINTS
        };

        let mut run_start: usize = 0;
        let mut run_length: usize = 0;

        for i in 0..search_points.len() {
            if smoothed[i] <= options.viscosity_threshold {
                if run_length == 0 {
                    run_start = i;
                }
                run_length += 1;

                if run_length >= MIN_CONSECUTIVE_BELOW {
                    // Slope guard: accept only DESCENDING-trend crossings.
                    // Walk back SLOPE_LOOKBACK_POINTS + SMOOTHING_HALF_WINDOW
                    // checking for time gaps (interval > gap_threshold).
                    // If ANY gap is found, we are near a segment boundary
                    // where viscosity is ascending from recovery — reject.
                    if run_start > 0 {
                        let total_lookback = SLOPE_LOOKBACK_POINTS + smoothing_half_points;
                        let mut walk_idx = run_start;
                        let mut gap_found = false;
                        for _ in 0..total_lookback {
                            if walk_idx == 0 { break; }
                            let dt = search_points[walk_idx].time_min
                                - search_points[walk_idx - 1].time_min;
                            if dt > gap_threshold {
                                gap_found = true;
                                break;
                            }
                            walk_idx -= 1;
                        }

                        if gap_found {
                            // Near a data gap — ascending recovery → reject
                            run_length = 0;
                            continue;
                        }

                        // No gap — smoothed values are clean.  Check slope.
                        let effective_lookback = run_start.min(SLOPE_LOOKBACK_POINTS);
                        if smoothed[run_start] > smoothed[run_start - effective_lookback] {
                            // Viscosity is RISING — reject
                            run_length = 0;
                            continue;
                        }
                    }

                    // Confirmed sustained crossing on descending trend.
                    let mut first_idx = run_start;
                    for j in run_start..=i {
                        if search_points[j].viscosity_cp <= options.viscosity_threshold {
                            first_idx = j;
                            break;
                        }
                    }

                    let first = search_points[first_idx];
                    // Use the actual first below-threshold data point.
                    // No time interpolation — marker must sit exactly ON the data series.
                    results.push(TouchPointResult {
                        time: first.time_min,
                        viscosity: first.viscosity_cp,
                        tp_type: TouchPointType::Threshold,
                    });
                    break;
                }
            } else {
                run_length = 0;
            }
        }
    }

    // Step 4: target-time point (on shear-rate-filtered points)
    if options.show_target_time {
        for i in 0..filtered.len() {
            let p = &filtered[i];
            if p.time_min >= options.target_time {
                let mut exact_visc = p.viscosity_cp;
                if i > 0 && p.time_min > options.target_time {
                    let prev = &filtered[i - 1];
                    let dt = p.time_min - prev.time_min;
                    if dt.abs() > 0.001 {
                        let fraction = (options.target_time - prev.time_min) / dt;
                        exact_visc = prev.viscosity_cp + fraction * (p.viscosity_cp - prev.viscosity_cp);
                    }
                }
                results.push(TouchPointResult {
                    time: options.target_time,
                    viscosity: exact_visc,
                    tp_type: TouchPointType::Target,
                });
                break;
            }
        }
    }

    results
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_point(time_min: f64, viscosity_cp: f64, shear_rate: f64) -> TouchPointInput {
        TouchPointInput { time_min, viscosity_cp, shear_rate }
    }

    #[test]
    fn test_dominant_shear_rate_single_cluster() {
        let points = vec![
            make_point(0.0, 500.0, 100.0),
            make_point(1.0, 500.0, 101.0),
            make_point(2.0, 500.0, 99.0),
            make_point(3.0, 500.0, 200.0), // outlier (ramp)
        ];
        let rate = find_dominant_shear_rate(&points, 0.05).unwrap();
        assert!((rate - 100.0).abs() < 5.0, "expected ~100, got {}", rate);
    }

    #[test]
    fn test_dominant_shear_rate_no_data() {
        let points = vec![make_point(0.0, 500.0, 0.0)]; // no shear-rate data
        assert!(find_dominant_shear_rate(&points, 0.05).is_none());
    }

    #[test]
    fn test_filter_by_shear_rate() {
        let points = vec![
            make_point(0.0, 500.0, 100.0),
            make_point(1.0, 400.0, 200.0), // ramp
            make_point(2.0, 300.0, 102.0),
            make_point(3.0, 250.0, 98.0),
        ];
        let filtered = filter_by_shear_rate(&points, 100.0, 0.05);
        assert_eq!(filtered.len(), 3); // 100, 102, 98 are within ±5%
    }

    #[test]
    fn test_viscosity_peak_detected() {
        // Rising then falling viscosity
        let mut points = Vec::new();
        for i in 0..30 {
            let t = i as f64 * 0.5; // 0..15 min, step 0.5
            let v = if t < 5.0 {
                500.0 + t * 100.0 // rising to 1000
            } else {
                1000.0 - (t - 5.0) * 50.0 // falling
            };
            points.push(make_point(t, v, 100.0));
        }
        let peak = find_viscosity_peak(&points, 1.0);
        assert!(peak.is_some(), "peak should be detected");
        let pt = peak.unwrap();
        assert!(pt >= 3.0 && pt <= 7.0, "peak should be near t=5, got {}", pt);
    }

    #[test]
    fn test_no_peak_monotonically_falling() {
        let points: Vec<TouchPointInput> = (0..20)
            .map(|i| {
                let t = i as f64 * 0.5;
                make_point(t, 1000.0 - t * 30.0, 100.0)
            })
            .collect();
        // Monotonically falling → decline detected from the very start → peak is near beginning
        let peak = find_viscosity_peak(&points, 1.0);
        assert!(peak.is_some(), "monotonically falling data has peak at start");
        assert!(peak.unwrap() < 1.0, "peak should be near t=0, got {}", peak.unwrap());
    }

    #[test]
    fn test_smart_touch_points_basic() {
        // Simulate: rising 0-5min (ramp-up), then falling 5-20min crossing 500cP at ~15min
        let mut points = Vec::new();
        for i in 0..40 {
            let t = i as f64 * 0.5;
            let v = if t < 5.0 {
                300.0 + t * 140.0 // 300 → 1000
            } else {
                1000.0 - (t - 5.0) * 40.0 // 1000 → 400 at t=20
            };
            points.push(make_point(t, v, 100.0));
        }

        let results = calculate_smart_touch_points(
            &points,
            &SmartTouchPointOptions {
                viscosity_threshold: 500.0,
                show_target_time: true,
                target_time: 10.0,
                ..Default::default()
            },
        );

        // Should have threshold and target
        let threshold = results.iter().find(|r| matches!(r.tp_type, TouchPointType::Threshold));
        assert!(threshold.is_some(), "threshold should be found");
        let tp = threshold.unwrap();
        assert!(tp.time > 5.0, "threshold should be after peak (t=5), got {}", tp.time);

        let target = results.iter().find(|r| matches!(r.tp_type, TouchPointType::Target));
        assert!(target.is_some(), "target-time should be found");
        assert!((target.unwrap().time - 10.0).abs() < 0.01);
    }

    #[test]
    fn test_smart_touch_points_filters_shear_ramps() {
        // Main speed 100 s⁻¹, ramp at 200 s⁻¹ drops viscosity below threshold
        let points = vec![
            make_point(0.0, 800.0, 100.0),
            make_point(1.0, 900.0, 100.0),
            make_point(2.0, 1000.0, 100.0),
            make_point(3.0, 1050.0, 100.0),
            make_point(4.0, 1000.0, 100.0), // start declining
            make_point(5.0, 950.0, 100.0),
            make_point(6.0, 900.0, 100.0),
            // Ramp at 200 s⁻¹ — viscosity drops to 400 (should be IGNORED)
            make_point(7.0, 400.0, 200.0),
            make_point(7.5, 350.0, 200.0),
            // Back to 100 s⁻¹ — sustained decline through threshold
            make_point(8.0, 850.0, 100.0),
            make_point(9.0, 800.0, 100.0),
            make_point(10.0, 750.0, 100.0),
            make_point(11.0, 700.0, 100.0),
            make_point(12.0, 600.0, 100.0),
            make_point(13.0, 500.0, 100.0),
            make_point(14.0, 480.0, 100.0),
            make_point(15.0, 460.0, 100.0),
            make_point(16.0, 440.0, 100.0),
            make_point(17.0, 420.0, 100.0),
            make_point(18.0, 400.0, 100.0),
        ];

        let results = calculate_smart_touch_points(
            &points,
            &SmartTouchPointOptions {
                viscosity_threshold: 500.0,
                show_target_time: false,
                target_time: 10.0,
                ..Default::default()
            },
        );

        let threshold = results.iter().find(|r| matches!(r.tp_type, TouchPointType::Threshold));
        assert!(threshold.is_some(), "threshold should be found");
        let tp = threshold.unwrap();
        // Should NOT find the ramp drop at t=7; should find the real crossing at ~t=13
        assert!(tp.time >= 12.0, "threshold should be at ~13min (not at ramp t=7), got {}", tp.time);
    }

    #[test]
    fn test_smart_touch_points_no_shear_data_falls_back() {
        // All shear_rate = 0 → should fall back to using all points
        let points: Vec<TouchPointInput> = (0..30)
            .map(|i| {
                let t = i as f64;
                make_point(t, 1000.0 - t * 25.0, 0.0) // no shear data
            })
            .collect();

        let results = calculate_smart_touch_points(
            &points,
            &SmartTouchPointOptions {
                viscosity_threshold: 500.0,
                show_target_time: false,
                target_time: 10.0,
                ..Default::default()
            },
        );

        let threshold = results.iter().find(|r| matches!(r.tp_type, TouchPointType::Threshold));
        assert!(threshold.is_some(), "should find threshold even without shear-rate data");
    }
}
