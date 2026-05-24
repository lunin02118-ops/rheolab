//! Smart touch-point main algorithm — threshold crossing detection with
//! centred moving-average smoothing, gap-aware slope check, and optional
//! target-time point.

use super::helpers::{filter_by_shear_rate, find_dominant_shear_rate, find_viscosity_peak};
use super::types::{
    SmartTouchPointOptions, TouchPointAnomaly, TouchPointInput, TouchPointResult, TouchPointType,
};

/// Relative shear-rate jump threshold (5 %) used by the target-time
/// interpolation guard.  Mirrors the TS `SHEAR_RATE_JUMP_RATIO`.
const SHEAR_RATE_JUMP_RATIO: f64 = 0.05;

fn is_shear_rate_jump(a: f64, b: f64) -> bool {
    if a <= 0.0 || b <= 0.0 {
        return false;
    }
    let denom = a.abs().max(b.abs());
    if denom <= 0.0 {
        return false;
    }
    ((a - b).abs() / denom) > SHEAR_RATE_JUMP_RATIO
}

/// Legacy point-based minimum-run floor — see
/// [`MIN_CONSECUTIVE_BELOW_SECONDS`] for the time-based budget that now
/// governs detection.  Retained as a lower bound so that extremely
/// sparse sampling (60 s plateau intervals) still demands at least
/// three consecutive points before accepting a crossing.
const MIN_CONSECUTIVE_BELOW: usize = 3;
/// Legacy point-based slope-guard lookback — see
/// [`SLOPE_LOOKBACK_SECONDS`] for the time-based budget that dominates
/// at typical sampling rates.
const SLOPE_LOOKBACK_POINTS: usize = 10;
/// Time-based equivalent of [`MIN_CONSECUTIVE_BELOW`] (BUG #6 fix).
/// At 1 s sampling this yields 30 points (30 s confirmation); at 60 s
/// sampling the legacy 3-point floor dominates (3 min confirmation).
const MIN_CONSECUTIVE_BELOW_SECONDS: f64 = 30.0;
/// Time-based slope-guard lookback (BUG #9 fix).  Matches the TS
/// `SLOPE_LOOKBACK_SECONDS = 30` constant — resolves to ~15 points at
/// 2 s sampling, or a single point at 60 s sampling, both of which
/// correctly capture the original algorithm's intent of looking ~30 s
/// back into the smoothed curve to reject ascending-trend crossings.
const SLOPE_LOOKBACK_SECONDS: f64 = 30.0;

/// Drop points whose `time_min` or `viscosity_cp` is NaN / infinite
/// (BUG #10 fix — 1:1 mirror of TS `sanitizeTouchPointInputs`).  Rust's
/// default `f64::partial_cmp` returns `None` for NaN, which would make
/// the downstream `sort_by` non-deterministic and could mis-place the
/// dominant cluster.  Non-finite shear rates are clamped to 0.0 so the
/// clustering helper treats them as "no rate info" rather than losing
/// the whole point.
fn sanitize_touch_point_inputs(points: &[TouchPointInput]) -> Vec<TouchPointInput> {
    let mut out = Vec::with_capacity(points.len());
    for p in points {
        if !p.time_min.is_finite() || !p.viscosity_cp.is_finite() {
            continue;
        }
        if p.shear_rate.is_finite() && p.shear_rate >= 0.0 {
            out.push(p.clone());
        } else {
            out.push(TouchPointInput {
                time_min: p.time_min,
                viscosity_cp: p.viscosity_cp,
                shear_rate: 0.0,
            });
        }
    }
    out
}

/// Compute smart touch points: threshold crossing + optional target-time point.
pub fn calculate_smart_touch_points(
    points: &[TouchPointInput],
    options: &SmartTouchPointOptions,
) -> Vec<TouchPointResult> {
    if points.is_empty() {
        return Vec::new();
    }

    // Drop NaN / ±Infinity points before any downstream statistic can
    // poison sort order or median selection.
    let clean_points = sanitize_touch_point_inputs(points);
    if clean_points.is_empty() {
        return Vec::new();
    }

    let mut results = Vec::new();

    // Step 1: dominant shear rate
    let dominant_rate = find_dominant_shear_rate(&clean_points, options.shear_rate_tolerance);

    let filtered: Vec<TouchPointInput> = match dominant_rate {
        Some(rate) => filter_by_shear_rate(&clean_points, rate, options.shear_rate_tolerance),
        None => clean_points.clone(),
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
            interval_samples.push(search_points[i].time_min - search_points[i - 1].time_min);
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
                while w_hi + 1 < search_points.len() && search_points[w_hi + 1].time_min <= t_hi {
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

        // ── BUG #6 & #9 fix (Rust mirror of TS): derive the confirmation
        // run length and the slope-guard lookback from absolute TIME on
        // top of a point-count floor.  At 1 s sampling the time budget
        // dominates (30 points); at 60 s sampling the floor dominates
        // (3 points = 3 min confirmation).  `median_interval` is already
        // in minutes, so convert the seconds constants accordingly.
        let min_below_min = MIN_CONSECUTIVE_BELOW_SECONDS / 60.0;
        let slope_lookback_min = SLOPE_LOOKBACK_SECONDS / 60.0;
        let required_below: usize = if median_interval > 0.0 {
            MIN_CONSECUTIVE_BELOW.max((min_below_min / median_interval).ceil() as usize)
        } else {
            MIN_CONSECUTIVE_BELOW
        };
        let slope_lookback: usize = if median_interval > 0.0 {
            SLOPE_LOOKBACK_POINTS.max((slope_lookback_min / median_interval).ceil() as usize)
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

                if run_length >= required_below {
                    // Slope guard: accept only DESCENDING-trend crossings.
                    // Walk back slope_lookback + smoothing_half_points
                    // checking for time gaps (interval > gap_threshold).
                    // If ANY gap is found, we are near a segment boundary
                    // where viscosity is ascending from recovery — reject.
                    if run_start > 0 {
                        let total_lookback = slope_lookback + smoothing_half_points;
                        let mut walk_idx = run_start;
                        let mut gap_found = false;
                        for _ in 0..total_lookback {
                            if walk_idx == 0 {
                                break;
                            }
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
                        let effective_lookback = run_start.min(slope_lookback);
                        if smoothed[run_start] > smoothed[run_start - effective_lookback] {
                            // Viscosity is RISING — reject
                            run_length = 0;
                            continue;
                        }
                    }

                    // Confirmed sustained crossing on descending trend.
                    // Walk BACKWARD from run_start to find where the RAW data
                    // actually first crossed below the threshold.  Smoothed
                    // detection confirmed the crossing is genuine (not noise);
                    // the marker should sit at the actual raw crossing, not at
                    // the delayed smoothed-curve crossing.
                    let mut first_idx = run_start;
                    while first_idx > 0
                        && search_points[first_idx - 1].viscosity_cp <= options.viscosity_threshold
                    {
                        first_idx -= 1;
                    }

                    let first = search_points[first_idx];
                    results.push(TouchPointResult {
                        time: first.time_min,
                        viscosity: first.viscosity_cp,
                        tp_type: TouchPointType::Threshold,
                        anomaly: None,
                    });
                    break;
                }
            } else {
                run_length = 0;
            }
        }
    }

    // Step 4: target-time point — run on the ALL-points input (not the
    // shear-rate-filtered set) so the marker tracks whatever curve the
    // chart actually shows at `target_time`.  Historically the Rust port
    // iterated `filtered` which hid shear-rate-jump anomalies for SST
    // experiments; the TS reference also switched to `points` and this
    // 1:1 sync brings Rust / PDF reports in line.
    if options.show_target_time {
        for i in 0..clean_points.len() {
            let p = &clean_points[i];
            if p.time_min >= options.target_time {
                let mut exact_visc = p.viscosity_cp;
                let mut exact_time = options.target_time;
                let mut anomaly: Option<TouchPointAnomaly> = None;

                if i > 0 && p.time_min > options.target_time {
                    let prev = &clean_points[i - 1];
                    let dt = p.time_min - prev.time_min;
                    if is_shear_rate_jump(prev.shear_rate, p.shear_rate) {
                        // Snap to the nearer neighbour instead of
                        // interpolating across a vertical curve jump.
                        let pick_prev = (options.target_time - prev.time_min).abs()
                            <= (p.time_min - options.target_time).abs();
                        let chosen = if pick_prev { prev } else { p };
                        exact_time = chosen.time_min;
                        exact_visc = chosen.viscosity_cp;
                        anomaly = Some(TouchPointAnomaly::ShearRateJump);
                    } else if dt.abs() > 0.001 {
                        let fraction = (options.target_time - prev.time_min) / dt;
                        exact_visc =
                            prev.viscosity_cp + fraction * (p.viscosity_cp - prev.viscosity_cp);
                    }
                }
                results.push(TouchPointResult {
                    time: exact_time,
                    viscosity: exact_visc,
                    tp_type: TouchPointType::Target,
                    anomaly,
                });
                break;
            }
        }
    }

    results
}
