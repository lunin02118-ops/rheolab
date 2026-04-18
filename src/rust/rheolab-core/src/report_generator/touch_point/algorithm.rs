//! Smart touch-point main algorithm — threshold crossing detection with
//! centred moving-average smoothing, gap-aware slope check, and optional
//! target-time point.

use super::helpers::{find_dominant_shear_rate, filter_by_shear_rate, find_viscosity_peak};
use super::types::{SmartTouchPointOptions, TouchPointInput, TouchPointResult, TouchPointType};

/// Minimum number of consecutive *smoothed* viscosity values at-or-below
/// the threshold to confirm a sustained crossing.  Reduced from 5 to 3
/// because the smoothing pass already filters single-point noise.
const MIN_CONSECUTIVE_BELOW: usize = 3;
/// Number of smoothed data points to look back when verifying that a
/// threshold crossing is on a genuinely DESCENDING viscosity trend.
const SLOPE_LOOKBACK_POINTS: usize = 10;

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
