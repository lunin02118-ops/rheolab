/**
 * series-snap.ts
 *
 * Helpers for snapping touch-point markers to the closest visible series
 * point.  Ensures markers are drawn exactly on the displayed curve, even
 * when the chart data has been downsampled (LTTB) or the Y axis is in a
 * different display unit than the raw algorithm input.
 *
 * Pure module — no React / DOM dependencies; safe to import from unit tests.
 *
 * Related bug fixes from the touch-point audit:
 *  - BUG #2  raw-vs-downsampled mismatch: algorithm sees raw data, chart
 *            shows a downsampled series; marker coordinates from raw can
 *            land between visible points.
 *  - BUG #3  shear-rate-filtering mismatch: the algorithm filters by the
 *            dominant shear rate, but the chart renders all points.
 *            Snapping to the visible series re-anchors the marker to the
 *            actually-drawn curve.
 */

export interface SeriesSnapResult {
    /** X coordinate (time in minutes) used for rendering. */
    time: number;
    /** Y coordinate in the current display unit used for rendering. */
    viscosityDisplay: number;
    /**
     * True when the marker was placed on an existing series vertex
     * (distance ≤ samplingInterval × radiusMultiplier).  False when
     * interpolated between two neighbours or falling back to raw.
     */
    snapped: boolean;
}

/**
 * Find the index of the nearest element to `target` in a sorted array via
 * binary search.  Returns `-1` for an empty array.
 */
export function findNearestTimeIndex(times: ArrayLike<number>, target: number): number {
    const n = times.length;
    if (n === 0) return -1;
    if (n === 1) return 0;

    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (times[mid] < target) lo = mid + 1;
        else hi = mid;
    }
    if (lo === 0) return 0;
    const prevDist = Math.abs(times[lo - 1] - target);
    const currDist = Math.abs(times[lo] - target);
    return prevDist <= currDist ? lo - 1 : lo;
}

/**
 * Median sampling interval of a sorted `times` array — i.e. the typical
 * distance between *consecutive* points.  Samples up to 50 stride-spaced
 * consecutive-interval probes to stay O(1) amortised for large inputs
 * while remaining independent of the absolute length.
 */
export function medianSamplingInterval(times: ArrayLike<number>): number {
    const n = times.length;
    if (n < 2) return 0;
    const SAMPLE = Math.min(50, n - 1);
    const stride = Math.max(1, Math.floor((n - 1) / SAMPLE));
    const intervals: number[] = [];
    // Sample the consecutive-point delta every `stride` positions — this
    // gives a representative distribution of real sampling intervals
    // without scanning all n-1 deltas on large arrays.
    for (let i = stride; i < n; i += stride) {
        intervals.push(times[i] - times[i - 1]);
    }
    if (intervals.length === 0) return times[n - 1] - times[0];
    intervals.sort((a, b) => a - b);
    return intervals[intervals.length >> 1];
}

/**
 * Snap a touch-point coordinate `(rawTime, rawViscosityDisplay)` to the
 * closest visible series point when it is within
 * `samplingInterval × radiusMultiplier` of an existing vertex.
 *
 * Otherwise falls back to linear interpolation in display-unit space
 * between the two neighbouring vertices, which guarantees the marker
 * still sits on the rendered poly-line (not between two visible points).
 *
 * When the target is outside the series range, the raw coordinate is
 * returned unchanged with `snapped=false`.
 */
export function snapToSeries(
    rawTime: number,
    rawViscosityDisplay: number,
    times: ArrayLike<number>,
    viscosities: ArrayLike<number>,
    samplingInterval: number,
    radiusMultiplier = 1.5,
): SeriesSnapResult {
    const n = times.length;
    if (n === 0 || n !== viscosities.length) {
        return { time: rawTime, viscosityDisplay: rawViscosityDisplay, snapped: false };
    }

    const idx = findNearestTimeIndex(times, rawTime);
    const distance = Math.abs(times[idx] - rawTime);
    const radius = Math.max(samplingInterval * radiusMultiplier, 1e-9);

    if (distance <= radius) {
        return { time: times[idx], viscosityDisplay: viscosities[idx], snapped: true };
    }

    // Interpolate between neighbours in display-unit space.
    let lo = idx;
    let hi = idx;
    if (times[idx] > rawTime && idx > 0) {
        lo = idx - 1;
        hi = idx;
    } else if (times[idx] < rawTime && idx + 1 < n) {
        lo = idx;
        hi = idx + 1;
    }
    if (lo === hi) {
        // rawTime lies outside [times[0], times[n-1]] — keep raw coordinates.
        return { time: rawTime, viscosityDisplay: rawViscosityDisplay, snapped: false };
    }
    const dt = times[hi] - times[lo];
    const frac = dt > 1e-9 ? (rawTime - times[lo]) / dt : 0;
    const interpolated = viscosities[lo] + frac * (viscosities[hi] - viscosities[lo]);
    return { time: rawTime, viscosityDisplay: interpolated, snapped: false };
}
