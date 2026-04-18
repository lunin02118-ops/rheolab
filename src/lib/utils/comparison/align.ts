import type { RheoPoint } from '@/types';
import type {
    DownsampleMode,
    ProcessedExperiment,
    AlignedSeries,
    ComparisonUPlotData,
    ProcessedColumnar,
} from './types';
import { sanitiseAndNormalisePoints } from './normalize';

// ─── Step 2: build the unified time axis ─────────────────────────────────────

/**
 * Merges the time points from all processed experiments into a single sorted,
 * deduplicated array — the shared X-axis for uPlot.
 */
export function buildSharedTimeAxis(
    processedExps: ProcessedExperiment[],
): number[] {
    const set = new Set<number>();
    for (const { points } of processedExps) {
        for (const p of points) {
            if (!isNaN(p.time_min)) set.add(p.time_min);
        }
    }
    return Array.from(set).sort((a, b) => a - b);
}

// ─── Step 3: align each experiment's series to the shared axis ───────────────

/**
 * Aligns one experiment's values for a single `metric` to the shared `sortedTimes`
 * axis using a **last-known-value** (zero-order hold) strategy:
 *
 * - For each slot `t` in `sortedTimes`, we report the value of the most recent
 *   point in `points` whose `time_min ≤ t`.
 * - Slots before the experiment starts or after it ends stay `null` — this
 *   avoids painting phantom data outside the experiment's own time range.
 *
 * This is the correct approach for comparing experiments with different sample
 * rates / start times, and is what was broken before the fix (the old code
 * required an *exact* timestamp match, producing `null` gaps for all cross-
 * experiment time slots).
 *
 * @param points      Output of `sanitiseAndNormalisePoints`.
 * @param sortedTimes Shared X-axis from `buildSharedTimeAxis`.
 * @param metric      Key of the RheoPoint field to extract.
 */
export function alignSeriesLastKnown(
    points: ProcessedExperiment['points'],
    sortedTimes: number[],
    metric: string,
): AlignedSeries {
    const n = sortedTimes.length;
    const series: AlignedSeries = new Array(n).fill(null);

    if (points.length === 0) return series;

    const tMin = points[0].time_min;
    const tMax = points[points.length - 1].time_min;

    let pIdx = 0;
    for (let tIdx = 0; tIdx < n; tIdx++) {
        const t = sortedTimes[tIdx];

        // Outside this experiment's time range → null (no data)
        if (t < tMin || t > tMax) continue;

        // Advance pointer to the last point whose time_min ≤ t
        while (pIdx + 1 < points.length && points[pIdx + 1].time_min <= t) {
            pIdx++;
        }

        const raw = (points[pIdx] as unknown as Record<string, unknown>)[metric];
        const val = Number(raw);
        series[tIdx] = raw != null && !isNaN(val) ? val : null;
    }

    return series;
}

/**
 * Aligns one experiment's values for a single `metric` to the shared `sortedTimes`
 * axis using **linear interpolation** (first-order hold):
 *
 * - For each slot `t` in `sortedTimes`, we linearly interpolate between the
 *   two surrounding points in `points` (the one just before and the one just
 *   after `t`).
 * - When `t` coincides exactly with a data point, that point's value is used.
 * - Slots before the experiment starts or after it ends stay `null`.
 *
 * This produces smooth curves when one experiment has many more points than
 * another — no staircase / zero-order-hold artefacts.
 *
 * @param points      Output of `sanitiseAndNormalisePoints`.
 * @param sortedTimes Shared X-axis from `buildSharedTimeAxis`.
 * @param metric      Key of the RheoPoint field to extract.
 */
export function alignSeriesLinear(
    points: ProcessedExperiment['points'],
    sortedTimes: number[],
    metric: string,
): AlignedSeries {
    const n = sortedTimes.length;
    const series: AlignedSeries = new Array(n).fill(null);

    if (points.length === 0) return series;

    const tMin = points[0].time_min;
    const tMax = points[points.length - 1].time_min;

    let pIdx = 0;
    for (let tIdx = 0; tIdx < n; tIdx++) {
        const t = sortedTimes[tIdx];

        // Outside this experiment's time range → null (no data)
        if (t < tMin || t > tMax) continue;

        // Advance pointer so that points[pIdx].time_min ≤ t < points[pIdx+1].time_min
        while (pIdx + 1 < points.length && points[pIdx + 1].time_min <= t) {
            pIdx++;
        }

        const rawLeft = (points[pIdx] as unknown as Record<string, unknown>)[metric];
        const v0 = Number(rawLeft);
        if (rawLeft == null || isNaN(v0)) continue;

        // Check if a right neighbour exists for interpolation
        if (pIdx + 1 < points.length) {
            const t0 = points[pIdx].time_min;
            const t1 = points[pIdx + 1].time_min;
            const dt = t1 - t0;
            if (dt > 0 && t > t0) {
                const rawRight = (points[pIdx + 1] as unknown as Record<string, unknown>)[metric];
                const v1 = Number(rawRight);
                if (rawRight != null && !isNaN(v1)) {
                    const fraction = (t - t0) / dt;
                    series[tIdx] = v0 + fraction * (v1 - v0);
                    continue;
                }
            }
        }

        // Exact hit or no right neighbour — use left value as-is
        series[tIdx] = v0;
    }

    return series;
}

/** Map metric key string to the corresponding Float64Array in a ProcessedColumnar. */
function getColumnarMetricArray(pc: ProcessedColumnar, metric: string): Float64Array {
    switch (metric) {
        case 'viscosity_cp':     return pc.viscosityCp;
        case 'temperature_c':    return pc.temperatureC;
        case 'bath_temperature_c': return pc.bathTemperatureC;
        case 'shear_rate_s1':
        case 'shear_rate':       return pc.shearRate;
        case 'shear_stress_pa':  return pc.shearStress;
        case 'pressure_bar':     return pc.pressureBar;
        case 'speed_rpm':        return pc.speedRpm;
        default:                 return new Float64Array(0);
    }
}

/**
 * Align a single columnar metric to the shared time axis using last-known-value
 * forward fill. Semantically identical to `alignSeriesLastKnown` but operates
 * on typed arrays — no property access by string key, no boxed object reads.
 */
export function alignSeriesFromColumnar(
    pc: ProcessedColumnar,
    sortedTimes: number[],
    metric: string,
): AlignedSeries {
    const n = sortedTimes.length;
    const series: AlignedSeries = new Array(n).fill(null);
    const m = pc.timeMins.length;
    if (m === 0) return series;

    const tMin = pc.timeMins[0];
    const tMax = pc.timeMins[m - 1];
    const values = getColumnarMetricArray(pc, metric);

    let pIdx = 0;
    for (let tIdx = 0; tIdx < n; tIdx++) {
        const t = sortedTimes[tIdx];
        if (t < tMin || t > tMax) continue;
        while (pIdx + 1 < m && pc.timeMins[pIdx + 1] <= t) pIdx++;
        const val = values[pIdx];
        series[tIdx] = !isNaN(val) ? val : null;
    }
    return series;
}

/**
 * Align a single columnar metric to the shared time axis using **linear
 * interpolation**. Semantically identical to `alignSeriesLinear` but operates
 * on `Float64Array` typed arrays for better throughput.
 *
 * For each slot `t` inside `[tMin, tMax]` the value is linearly interpolated
 * between the two bracketing data points. Slots outside the range stay `null`.
 */
export function alignSeriesFromColumnarLinear(
    pc: ProcessedColumnar,
    sortedTimes: number[],
    metric: string,
): AlignedSeries {
    const n = sortedTimes.length;
    const series: AlignedSeries = new Array(n).fill(null);
    const m = pc.timeMins.length;
    if (m === 0) return series;

    const tMin = pc.timeMins[0];
    const tMax = pc.timeMins[m - 1];
    const values = getColumnarMetricArray(pc, metric);

    let pIdx = 0;
    for (let tIdx = 0; tIdx < n; tIdx++) {
        const t = sortedTimes[tIdx];
        if (t < tMin || t > tMax) continue;

        // Advance so that timeMins[pIdx] ≤ t < timeMins[pIdx+1]
        while (pIdx + 1 < m && pc.timeMins[pIdx + 1] <= t) pIdx++;

        const v0 = values[pIdx];
        if (isNaN(v0)) continue;

        // Linear interpolation when a right neighbour exists
        if (pIdx + 1 < m) {
            const t0 = pc.timeMins[pIdx];
            const t1 = pc.timeMins[pIdx + 1];
            const dt = t1 - t0;
            if (dt > 0 && t > t0) {
                const v1 = values[pIdx + 1];
                if (!isNaN(v1)) {
                    series[tIdx] = v0 + ((t - t0) / dt) * (v1 - v0);
                    continue;
                }
            }
        }

        // Exact hit or no right neighbour
        series[tIdx] = v0;
    }
    return series;
}

// ─── Convenience: full pipeline ──────────────────────────────────────────────

/**
 * High-level helper used by `ComparisonChartUPlot`.
 * Runs Steps 1-3 for every experiment × metric combination and returns a
 * ready-to-use SoA bundle.
 */
export function buildComparisonUPlotData(
    rawExperiments: Array<{ rawPoints: RheoPoint[] | string | undefined | null }>,
    metrics: string[],
    mode: DownsampleMode,
    threshold: number,
): { data: ComparisonUPlotData; processedExps: ProcessedExperiment[] } {
    // Step 1
    const processedExps: ProcessedExperiment[] = rawExperiments.map(exp => ({
        points: sanitiseAndNormalisePoints(exp.rawPoints, mode, threshold),
    }));

    // Step 2
    const times = buildSharedTimeAxis(processedExps);

    // Step 3 — linear interpolation between data points (no staircase artefacts)
    const series: AlignedSeries[] = [];
    for (const processed of processedExps) {
        for (const metric of metrics) {
            series.push(alignSeriesLinear(processed.points, times, metric));
        }
    }

    return {
        data: { times, series },
        processedExps,
    };
}
