/**
 * touch-point.ts
 *
 * Smart touch-point (threshold crossing) calculation that accounts for:
 *  1. Shear-rate ramps — only considers points at the dominant (main mixing) shear rate
 *  2. Initial viscosity ramp-up — uses a 1-minute sliding window to detect
 *     when viscosity trend changes from rising to falling (peak), and only
 *     searches for the threshold crossing after the peak.
 *
 * Exported as pure functions — no React / DOM dependencies.
 */

// ─── Public types ────────────────────────────────────────────────────────────

export interface TouchPointInput {
    /** Time in minutes (from experiment start) */
    time_min: number;
    /** Viscosity in cP */
    viscosity_cp: number;
    /** Shear rate in 1/s (may be 0 or absent) */
    shear_rate: number;
}

export interface TouchPointResult {
    time: number;
    viscosity: number;
    type: 'threshold' | 'target';
}

export interface SmartTouchPointOptions {
    /** Viscosity threshold in cP (e.g. 500) */
    viscosityThreshold: number;
    /** Whether to also find the target-time point */
    showTargetTime: boolean;
    /** Target time in minutes (e.g. 10) */
    targetTime: number;
    /** Sliding window size in minutes for trend detection (default: 1) */
    trendWindowMinutes?: number;
    /** Tolerance for shear-rate filtering as fraction (default: 0.05 = ±5%) */
    shearRateTolerance?: number;
    /**
     * Width of the centred moving-average smoothing window in minutes
     * (default: 3 min).  A time-based window scales with sampling rate and
     * handles long-period oscillations (e.g. crosslinked gel break dynamics)
     * that a fixed ±2-point window cannot suppress.
     */
    smoothingWindowMinutes?: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_TREND_WINDOW_MIN = 1.0;
const DEFAULT_SHEAR_RATE_TOLERANCE = 0.05;
/** Minimum number of consecutive declining windows to confirm trend reversal */
const MIN_DECLINING_WINDOWS = 2;
/** Step size for sliding window (fraction of window) */
const WINDOW_STEP_FRACTION = 0.5;
/**
 * Default time-based centred moving-average window (in minutes) applied to
 * viscosity before threshold comparison.  A time-based window gives consistent
 * behaviour regardless of sampling rate and handles long-period oscillations
 * (gel-break dynamics, crosslinked fluids) that a fixed 5-point window misses.
 *
 * NOTE: We use the MEDIAN of the window, not the mean, so that sharp periodic
 * spikes (e.g. gel-break viscosity peaks in crosslinked fracturing-fluid tests)
 * do not pull the smoothed value above the threshold when the true baseline is
 * already below it.  For a window with 75 % of points at 20 cP and 25 % spikes
 * at 200 cP: mean = 65 cP > 50 cP (false non-detection), median = 20 cP (correct).
 */
const DEFAULT_SMOOTHING_WINDOW_MIN = 3.0;
/**
 * Minimum number of consecutive *smoothed* viscosity values that must be
 * at-or-below the threshold before we accept the crossing as real.
 * Reduced from the previous value of 5 (with raw data) to 3, because the
 * smoothing pass already filters single-point noise.
 */
const MIN_CONSECUTIVE_BELOW = 3;
/**
 * Number of smoothed data points to look back when verifying that a
 * threshold crossing is on a genuinely DESCENDING viscosity trend.
 * On the ascending recovery after a shear-rate ramp (e.g. 200→1000 cP)
 * smoothed values temporarily pass through the threshold from below —
 * these must be rejected.  With typical 2-second sampling this lookback
 * covers ~20 seconds, enough to distinguish ascending from descending.
 */
const SLOPE_LOOKBACK_POINTS = 10;

// ─── Core algorithm ──────────────────────────────────────────────────────────

/**
 * Determine the dominant (most frequent) shear rate in the dataset.
 *
 * Groups shear rates into buckets of ±tolerance and returns the centre of the
 * largest bucket.  Ignores zero / absent shear rates.
 */
export function findDominantShearRate(
    points: TouchPointInput[],
    tolerance: number = DEFAULT_SHEAR_RATE_TOLERANCE,
): number | null {
    // Collect non-zero shear rates
    const rates: number[] = [];
    for (const p of points) {
        if (p.shear_rate > 0) rates.push(p.shear_rate);
    }
    if (rates.length === 0) return null;

    // Sort ascending
    rates.sort((a, b) => a - b);

    // Greedy clustering: walk sorted list, group values within ±tolerance of
    // the cluster centre (first element of cluster).
    let bestStart = 0;
    let bestCount = 0;

    let clusterStart = 0;
    while (clusterStart < rates.length) {
        const centre = rates[clusterStart];
        const hi = centre * (1 + tolerance);
        let clusterEnd = clusterStart;
        while (clusterEnd < rates.length && rates[clusterEnd] <= hi) {
            clusterEnd++;
        }
        const count = clusterEnd - clusterStart;
        if (count > bestCount) {
            bestCount = count;
            bestStart = clusterStart;
        }
        clusterStart = clusterEnd;
    }

    // Return median of largest cluster as dominant rate
    const clusterMid = bestStart + Math.floor(bestCount / 2);
    return rates[clusterMid];
}

/**
 * Filter points to only those recorded at approximately the dominant shear rate.
 * Non-dominant points (ramps at other shear rates) are excluded.
 * The downstream `findViscosityPeak` then ensures the touch-point search
 * starts only on the descending trend (after the viscosity peak), which
 * naturally skips any transient readings near ramp boundaries.
 */
export function filterByShearRate(
    points: TouchPointInput[],
    dominantRate: number,
    tolerance: number = DEFAULT_SHEAR_RATE_TOLERANCE,
): TouchPointInput[] {
    const lo = dominantRate * (1 - tolerance);
    const hi = dominantRate * (1 + tolerance);
    return points.filter(p => p.shear_rate >= lo && p.shear_rate <= hi);
}

/**
 * Find the time at which the viscosity ramp-up ends (peak) using a sliding
 * window average.  Returns the time (minutes) of the peak, or `null` if no
 * peak is detected (monotonically falling from start → search from beginning).
 *
 * Algorithm:
 *  - Compute average viscosity in consecutive overlapping windows of
 *    `windowMinutes` width, stepping by `windowMinutes * WINDOW_STEP_FRACTION`.
 *  - When `MIN_DECLINING_WINDOWS` consecutive windows show a lower average than
 *    the previous window, the peak is at the start of the first declining window.
 */
export function findViscosityPeak(
    points: TouchPointInput[],
    windowMinutes: number = DEFAULT_TREND_WINDOW_MIN,
): number | null {
    if (points.length < 2) return null;

    const step = windowMinutes * WINDOW_STEP_FRACTION;
    const tStart = points[0].time_min;
    const tEnd = points[points.length - 1].time_min;

    // Not enough time range for even one window — can't determine trend
    if (tEnd - tStart < windowMinutes) return null;

    // Compute window averages — O(n) two-pointer approach.
    // Points are already sorted by time_min within the filtered set.
    interface WindowAvg { tCenter: number; avg: number }
    const windows: WindowAvg[] = [];

    let pLeft = 0;   // inclusive left pointer into points[]
    let pRight = 0;  // exclusive right pointer into points[]
    let sum = 0;
    let count = 0;

    for (let wStart = tStart; wStart + windowMinutes <= tEnd + 0.001; wStart += step) {
        const wEnd = wStart + windowMinutes;

        // Shrink window: remove points that fell behind wStart
        while (pLeft < points.length && points[pLeft].time_min < wStart) {
            sum -= points[pLeft].viscosity_cp;
            count--;
            pLeft++;
        }

        // Expand window: add points that entered before wEnd
        while (pRight < points.length && points[pRight].time_min < wEnd) {
            sum += points[pRight].viscosity_cp;
            count++;
            pRight++;
        }

        if (count > 0) {
            windows.push({ tCenter: wStart + windowMinutes / 2, avg: sum / count });
        }
    }

    if (windows.length < 2) return null;

    // Detect first sustained decline (MIN_DECLINING_WINDOWS consecutive drops).
    // Gap-aware: when shear-rate filtering creates time gaps in the data
    // (e.g. the 100 s⁻¹ timeline jumps from t=8 to t=12 because 511 s⁻¹
    // points in between were removed), a single window comparison across
    // the gap shows a huge average drop that is NOT a real viscosity decline.
    // Reset the declining counter when the gap between consecutive window
    // centres exceeds 3× the normal step.
    const maxGap = step * 3;
    let decliningCount = 0;
    for (let i = 1; i < windows.length; i++) {
        const dt = windows[i].tCenter - windows[i - 1].tCenter;
        if (dt > maxGap) {
            // Data gap — this "decline" is an artefact, not real
            decliningCount = 0;
            continue;
        }
        if (windows[i].avg < windows[i - 1].avg) {
            decliningCount++;
            if (decliningCount >= MIN_DECLINING_WINDOWS) {
                // Peak is at the window just before the decline started
                const peakIdx = i - decliningCount;
                return windows[Math.max(0, peakIdx)].tCenter;
            }
        } else {
            decliningCount = 0;
        }
    }

    // No sustained decline found — viscosity keeps rising the whole test.
    // In this case there's no "end of ramp-up", so we return null (search
    // from the beginning, using the classic behaviour).
    return null;
}

/**
 * Main entry point: compute smart touch points.
 *
 * Returns 0–2 results: optionally a `threshold` point and a `target` point.
 */
export function calculateSmartTouchPoints(
    points: TouchPointInput[],
    options: SmartTouchPointOptions,
): TouchPointResult[] {
    const {
        viscosityThreshold,
        showTargetTime,
        targetTime,
        trendWindowMinutes = DEFAULT_TREND_WINDOW_MIN,
        shearRateTolerance = DEFAULT_SHEAR_RATE_TOLERANCE,
        smoothingWindowMinutes = DEFAULT_SMOOTHING_WINDOW_MIN,
    } = options;

    if (points.length === 0) return [];

    const results: TouchPointResult[] = [];

    // ── Step 1: determine dominant shear rate ────────────────────────────
    const dominantRate = findDominantShearRate(points, shearRateTolerance);

    // If no shear-rate data available, fall back: use all points
    const filtered = dominantRate != null
        ? filterByShearRate(points, dominantRate, shearRateTolerance)
        : points;

    if (filtered.length === 0) return [];

    // ── Step 2: find peak (end of ramp-up) on filtered points ────────────
    const peakTime = findViscosityPeak(filtered, trendWindowMinutes);

    // Points to search: after peak (or from start if no peak detected)
    const searchPoints = peakTime != null
        ? filtered.filter(p => p.time_min >= peakTime)
        : filtered;

    if (searchPoints.length === 0) return [];

    // ── Step 3: find threshold crossing ──────────────────────────────────
    // Pre-smooth viscosity with a centred moving average to dampen transient
    // noise, then look for MIN_CONSECUTIVE_BELOW consecutive smoothed values
    // at-or-below the threshold.  Once confirmed, we report the first *raw*
    // point in the run that is at-or-below the threshold (with interpolation).
    {
        // Determine the typical sampling interval from the TAIL (last ≤100
        // intervals) of the search region.  Sampling from the tail — where the
        // actual threshold crossing occurs — avoids the gap threshold being
        // dominated by the dense initial ramp-up burst (e.g. Grace 3600
        // experiments have 5-second 100 s⁻¹ measurements at the start, but
        // 1-min intervals during the multi-rate plateau that follows).  Using
        // tail-based sampling gives a representative interval for the region
        // we actually search, so any interval > 10× that is a true data gap
        // caused by shear-rate filtering rather than a normal multi-rate cycle.
        const intervalSamples: number[] = [];
        const intervalSampleStart = Math.max(1, searchPoints.length - 100);
        for (let i = intervalSampleStart; i < searchPoints.length; i++) {
            intervalSamples.push(searchPoints[i].time_min - searchPoints[i - 1].time_min);
        }
        intervalSamples.sort((a, b) => a - b);
        const medianInterval = intervalSamples.length > 0
            ? intervalSamples[Math.floor(intervalSamples.length / 2)]
            : 0.1;
        const gapThreshold = medianInterval * 10;

        // Time-based centred MEDIAN smoothing: for each point i collect all
        // values within ±halfWindow minutes, sort, take the median.
        // The median is robust to spike outliers — sharp periodic peaks at the
        // operating shear rate (gel-break dynamics in crosslinked fluids) cannot
        // pull the smoothed baseline above the threshold unlike the mean.
        // Example: 75 % of window at 20 cP, 25 % spikes at 200 cP →
        //   mean = 65 cP > 50 cP  (false non-detection with mean)
        //   median = 20 cP ≤ 50 cP  (correct detection with median)
        //
        // Complexity: O(n × k log k), k = window size in points.
        // Typical k ≤ 6 for 30 s sampling / 3-min window → very fast.
        // At 2 s sampling k ≈ 90 → still < 1 ms for a 300-min dataset.
        const halfWindow = smoothingWindowMinutes / 2.0;
        const smoothed = new Float64Array(searchPoints.length);
        let wLo = 0; // left boundary — moves forward monotonically
        for (let i = 0; i < searchPoints.length; i++) {
            const tCenter = searchPoints[i].time_min;
            const tLo = tCenter - halfWindow;
            const tHi = tCenter + halfWindow;
            // Advance left boundary past tLo
            while (wLo < i && searchPoints[wLo].time_min < tLo) wLo++;
            // Find right boundary (window extends past i, scan forward)
            let wHi = i;
            while (wHi + 1 < searchPoints.length && searchPoints[wHi + 1].time_min <= tHi) wHi++;
            // Collect, sort, median
            const count = wHi - wLo + 1;
            const vals = new Float64Array(count);
            for (let j = 0; j < count; j++) vals[j] = searchPoints[wLo + j].viscosity_cp;
            vals.sort(); // ascending in-place
            const mid = Math.floor(count / 2);
            smoothed[i] = count % 2 === 1 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
        }

        // Compute the smoothing half-window in points (for gap/slope checks).
        // Use the median sampling interval so a data gap doesn't skew the count.
        const smoothingHalfPoints = intervalSamples.length > 0
            ? Math.max(2, Math.round(halfWindow / medianInterval))
            : SLOPE_LOOKBACK_POINTS;

        let runStart = -1;  // index where the current below-threshold run began
        let runLength = 0;

        for (let i = 0; i < searchPoints.length; i++) {
            if (smoothed[i] <= viscosityThreshold) {
                if (runLength === 0) runStart = i;
                runLength++;

                if (runLength >= MIN_CONSECUTIVE_BELOW) {
                    // ── Slope guard: accept only DESCENDING-trend crossings ──
                    // Walk backwards from runStart checking for time gaps.
                    // Cover both the slope lookback range AND the smoothing
                    // half-window in points so the smoothed value at the
                    // lookback index is guaranteed gap-free.
                    if (runStart > 0) {
                        const totalLookback = SLOPE_LOOKBACK_POINTS + smoothingHalfPoints;
                        let walkIdx = runStart;
                        let gapFound = false;
                        for (let k = 0; k < totalLookback && walkIdx > 0; k++) {
                            const dt = searchPoints[walkIdx].time_min - searchPoints[walkIdx - 1].time_min;
                            if (dt > gapThreshold) { gapFound = true; break; }
                            walkIdx--;
                        }

                        if (gapFound) {
                            // Near a data gap — ascending recovery zone → reject
                            runLength = 0;
                            continue;
                        }

                        // No gap — smoothed values are clean.  Check slope.
                        const effectiveLookback = Math.min(runStart, SLOPE_LOOKBACK_POINTS);
                        if (smoothed[runStart] > smoothed[runStart - effectiveLookback]) {
                            // Viscosity is RISING into this crossing — reject it
                            runLength = 0;
                            continue;
                        }
                    }

                    // Confirmed sustained crossing on descending trend.
                    // Find the first RAW point at-or-below threshold in the run.
                    let firstIdx = runStart;
                    for (let j = runStart; j <= i; j++) {
                        if (searchPoints[j].viscosity_cp <= viscosityThreshold) {
                            firstIdx = j;
                            break;
                        }
                    }

                    const first = searchPoints[firstIdx];
                    // Use the actual first below-threshold data point.
                    // No time interpolation — marker must sit exactly ON the data series.
                    results.push({ time: first.time_min, viscosity: first.viscosity_cp, type: 'threshold' });
                    break;
                }
            } else {
                // Reset — this run was a transient dip
                runLength = 0;
            }
        }
    }

    // ── Step 4: find target-time point (on ALL points, not shear-rate filtered) ─
    // We use the original (unfiltered) point array so the marker matches the
    // actual chart curve at the requested time.  The previous approach used
    // shear-rate-filtered points, which gave wrong results for SST experiments
    // where different shear-rate phases alternate — the filtered set would skip
    // the phase the experiment is actually in at `targetTime`.
    if (showTargetTime) {
        let targetTimeFound = false;
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (!targetTimeFound && p.time_min >= targetTime) {
                targetTimeFound = true;
                let exactViscosity = p.viscosity_cp;
                if (i > 0 && p.time_min > targetTime) {
                    const prev = points[i - 1];
                    const dt = p.time_min - prev.time_min;
                    if (Math.abs(dt) > 0.001) {
                        const fraction = (targetTime - prev.time_min) / dt;
                        exactViscosity = prev.viscosity_cp + fraction * (p.viscosity_cp - prev.viscosity_cp);
                    }
                }
                results.push({ time: targetTime, viscosity: exactViscosity, type: 'target' });
                break;
            }
        }
    }

    return results;
}
