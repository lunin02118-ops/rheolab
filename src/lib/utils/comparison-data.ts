/**
 * comparison-data.ts
 *
 * Pure, side-effect-free utilities for transforming raw RheoPoint arrays into
 * the aligned Structure-of-Arrays (SoA) format required by uPlot when comparing
 * multiple experiments on a single shared time axis.
 *
 * Keeping this logic separate from the React component makes it fully unit-testable
 * without any DOM / uPlot / ResizeObserver setup.
 */

import type { RheoPoint } from '@/types';
import {
    downsampleRheoPointsSmart,
    downsampleRheoPointsMultiChannel,
} from './downsample';

// ─── Public types ────────────────────────────────────────────────────────────

export type DownsampleMode = 'smart' | 'lttb' | 'off';

/** A single experiment's points after sanitisation, downsampling and
 *  time-normalisation (time_min = minutes since first point of THIS experiment). */
export interface ProcessedExperiment {
    /** Points sorted chronologically, time_min: minutes from experiment start. */
    points: (RheoPoint & { time_min: number })[];
}

/**
 * One series data array aligned to `sortedTimes`.
 * `null` means "no data for this experiment at this time slot".
 */
export type AlignedSeries = (number | null)[];

/** Complete SoA data package ready to pass to `new uPlot()`. */
export interface ComparisonUPlotData {
    /** `uPlot.AlignedData[0]` — the shared X-axis (minutes). */
    times: number[];
    /**
     * One entry per (experiment × metric) combination, in the same order they
     * were requested.  Maps directly to `uPlot.AlignedData[1..n]`.
     */
    series: AlignedSeries[];
}

// ─── Step 1: sanitise + downsample + time-normalise ─────────────────────────

/**
 * Takes raw `rawPoints` from an `Experiment` record (may be a JSON string or
 * an array, may contain NaN / string time_sec values) and returns a clean,
 * sorted, downsampled array with `time_min` added.
 *
 * @param rawPoints  Raw data as stored in the DB / Zustand store.
 * @param mode       Downsampling algorithm.
 * @param threshold  Target point count after downsampling.
 */
export function sanitiseAndNormalisePoints(
    rawPoints: RheoPoint[] | string | undefined | null,
    mode: DownsampleMode,
    threshold: number,
): ProcessedExperiment['points'] {
    const parsed: RheoPoint[] =
        typeof rawPoints === 'string' ? JSON.parse(rawPoints) : (rawPoints ?? []);

    // 1. Coerce time_sec to number and filter bad rows
    let valid = parsed
        .map(p => ({ ...p, time_sec: Number(p.time_sec) }))
        .filter(p => !isNaN(p.time_sec));

    // 2. Chronological sort (required by LTTB and two-pointer alignment)
    valid.sort((a, b) => a.time_sec - b.time_sec);

    // 3. Downsample on clean, sorted data
    if (valid.length > 0) {
        if (mode === 'smart') valid = downsampleRheoPointsSmart(valid, threshold);
        else if (mode !== 'off') valid = downsampleRheoPointsMultiChannel(valid, threshold);
    }

    // 4. Normalise time to minutes from this experiment's own t=0
    const t0 = valid.length > 0 ? valid[0].time_sec : 0;
    return valid.map(p => ({
        ...p,
        time_min: Math.round(((p.time_sec - t0) / 60) * 100) / 100,
    }));
}

// ─── Step 1b: sanitise + downsample from ColumnarData (SoA fast path) ──────────

/**
 * Identical pipeline to `sanitiseAndNormalisePoints` but reads directly from
 * a `ColumnarData` structure, avoiding the AoS object-graph allocation that
 * the rawPoints path requires.
 *
 * Use this when the comparison store has already converted rawPoints to
 * ColumnarData (DB-backed experiments), which halves heap usage vs. AoS.
 */
export function sanitiseAndNormaliseColumnar(
    col: import('@/types').ColumnarData,
    mode: DownsampleMode,
    threshold: number,
): ProcessedExperiment['points'] {
    const n = col.timeSec.length;
    if (n === 0) return [];

    // 1. Collect valid indices and sort by time — avoids creating objects for
    //    invalid entries and lets us defer materialisation.
    const validIndices: number[] = [];
    for (let i = 0; i < n; i++) {
        const t = col.timeSec[i];
        if (t != null && !isNaN(t)) validIndices.push(i);
    }
    if (validIndices.length === 0) return [];

    validIndices.sort((a, b) => col.timeSec[a] - col.timeSec[b]);

    // 2. Materialise only valid, sorted entries for the downsample pipeline
    const t0 = col.timeSec[validIndices[0]];
    let points: Array<RheoPoint & { time_min: number }> = validIndices.map(i => {
        const point: Record<string, unknown> = {
            time_sec: col.timeSec[i],
            viscosity_cp: col.viscosityCp[i] ?? 0,
            temperature_c: col.temperatureC[i] ?? 0,
            time_min: Math.round(((col.timeSec[i] - t0) / 60) * 100) / 100,
        };
        if (col.shearRate[i] != null) point.shear_rate_s1 = col.shearRate[i];
        if (col.shearStress[i] != null) point.shear_stress_pa = col.shearStress[i];
        if (col.pressureBar[i] != null) point.pressure_bar = col.pressureBar[i];
        if (col.speedRpm[i] != null) point.speed_rpm = col.speedRpm[i];
        if (col.bathTemperatureC?.[i] != null) point.bath_temperature_c = col.bathTemperatureC![i];
        return point as unknown as RheoPoint & { time_min: number };
    });

    // 3. Downsample (operates on already-sorted array)
    if (points.length > 0) {
        if (mode === 'smart') points = downsampleRheoPointsSmart(points, threshold) as typeof points;
        else if (mode !== 'off') points = downsampleRheoPointsMultiChannel(points, threshold) as typeof points;
    }

    return points;
}

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

// ─── Columnar-native pipeline (SoA throughout, zero full AoS allocation) ─────

/**
 * Post-downsample columnar structure for the comparison pipeline.
 * Float64Arrays allow faster iteration and lower per-element GC pressure than
 * boxed `number[]` objects.
 */
export interface ProcessedColumnar {
    timeMins: Float64Array;
    viscosityCp: Float64Array;
    temperatureC: Float64Array;
    shearRate: Float64Array;       // keyed as 'shear_rate_s1' in metrics
    shearStress: Float64Array;     // keyed as 'shear_stress_pa'
    pressureBar: Float64Array;
    speedRpm: Float64Array;
    bathTemperatureC: Float64Array;
}

/**
 * Select `threshold` indices from `validIndices` using single-axis LTTB
 * on (timeSec, viscosityCp). Returns a strict subset of `validIndices`.
 */
function lttbSelectIndicesColumnar(
    validIndices: number[],
    timeSec: number[],
    viscosityCp: number[],
    threshold: number,
): number[] {
    const n = validIndices.length;
    if (n <= threshold) return validIndices;

    const selected: number[] = [validIndices[0]];
    const bucketSize = (n - 2) / (threshold - 2);
    let a = 0;

    for (let i = 0; i < threshold - 2; i++) {
        const bStart = Math.floor((i + 1) * bucketSize) + 1;
        const bEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n - 1);

        const nStart = bEnd;
        const nEnd = Math.min(Math.floor((i + 3) * bucketSize) + 1, n);
        const nCount = nEnd - nStart || 1;
        let avgX = 0, avgY = 0;
        for (let j = nStart; j < nEnd; j++) {
            avgX += timeSec[validIndices[j]];
            avgY += viscosityCp[validIndices[j]];
        }
        avgX /= nCount;
        avgY /= nCount;

        const aIdx = validIndices[a];
        let maxArea = -1, maxIdx = bStart;
        for (let j = bStart; j < bEnd; j++) {
            const jIdx = validIndices[j];
            const area = Math.abs(
                (timeSec[aIdx] - avgX) * (viscosityCp[jIdx] - viscosityCp[aIdx]) -
                (timeSec[aIdx] - timeSec[jIdx]) * (avgY - viscosityCp[aIdx]),
            );
            if (area > maxArea) { maxArea = area; maxIdx = j; }
        }
        selected.push(validIndices[maxIdx]);
        a = maxIdx;
    }
    selected.push(validIndices[n - 1]);
    return selected;
}

/**
 * Columnar-native smart downsample: classifies ramp vs plateau on shear rate,
 * preserves ramp points in full, LTTB on plateau segments proportionally.
 */
function smartSelectIndicesColumnar(
    validIndices: number[],
    timeSec: number[],
    shearRate: (number | null)[],
    viscosityCp: number[],
    threshold: number,
): number[] {
    const n = validIndices.length;
    if (n <= threshold) return validIndices;

    const WINDOW = 2;
    const RAMP_THRESHOLD = 0.02;
    const expanded = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
        const lo = Math.max(0, i - WINDOW);
        const hi = Math.min(n - 1, i + WINDOW);
        const srLo = shearRate[validIndices[lo]] ?? 0;
        const srHi = shearRate[validIndices[hi]] ?? 0;
        const base = (Math.abs(srLo) + Math.abs(srHi)) / 2 || 1;
        if (Math.abs(srHi - srLo) / base > RAMP_THRESHOLD) {
            for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) expanded[j] = 1;
        }
    }

    type Seg = { start: number; end: number; isRamp: boolean };
    const segments: Seg[] = [];
    let start = 0;
    for (let i = 1; i <= n; i++) {
        const prevRamp = expanded[start] === 1;
        if (i === n || (expanded[i] === 1) !== prevRamp) {
            segments.push({ start, end: i, isRamp: prevRamp });
            start = i;
        }
    }

    const nRamp = segments.filter(s => s.isRamp).reduce((a, s) => a + (s.end - s.start), 0);
    const nPlateau = n - nRamp;
    const plateauBudget = Math.max(0, threshold - nRamp);

    const selected: number[] = [];
    for (const seg of segments) {
        const len = seg.end - seg.start;
        const segIndices = validIndices.slice(seg.start, seg.end);
        if (seg.isRamp) {
            for (const idx of segIndices) selected.push(idx);
        } else {
            const budget = nPlateau > 0 ? Math.max(2, Math.round(plateauBudget * len / nPlateau)) : 2;
            for (const idx of lttbSelectIndicesColumnar(segIndices, timeSec, viscosityCp, budget)) selected.push(idx);
        }
    }
    return selected;
}

/**
 * Sanitise + downsample + normalise a `ColumnarData` experiment into a
 * `ProcessedColumnar` ready for comparison rendering.
 *
 * Key difference from `sanitiseAndNormaliseColumnar`: index selection happens
 * on the raw columnar arrays so only the ~threshold selected points are ever
 * materialised as Float64Arrays — avoiding the O(n) AoS allocation that the
 * old path performed before downsampling.
 */
export function sanitiseAndNormaliseColumnarDirect(
    col: import('@/types').ColumnarData,
    mode: DownsampleMode,
    threshold: number,
): ProcessedColumnar {
    const empty = (): ProcessedColumnar => ({
        timeMins: new Float64Array(0), viscosityCp: new Float64Array(0),
        temperatureC: new Float64Array(0), shearRate: new Float64Array(0),
        shearStress: new Float64Array(0), pressureBar: new Float64Array(0),
        speedRpm: new Float64Array(0), bathTemperatureC: new Float64Array(0),
    });

    const n = col.timeSec.length;
    if (n === 0) return empty();

    // 1. Collect valid indices and sort by time
    let validIndices: number[] = [];
    for (let i = 0; i < n; i++) {
        const t = col.timeSec[i];
        if (t != null && !isNaN(t)) validIndices.push(i);
    }
    if (validIndices.length === 0) return empty();
    validIndices.sort((a, b) => col.timeSec[a] - col.timeSec[b]);

    // 2. Select indices via columnar-native LTTB (no AoS until step 3)
    if (validIndices.length > threshold) {
        if (mode === 'smart') {
            validIndices = smartSelectIndicesColumnar(validIndices, col.timeSec, col.shearRate, col.viscosityCp, threshold);
        } else if (mode !== 'off') {
            validIndices = lttbSelectIndicesColumnar(validIndices, col.timeSec, col.viscosityCp, threshold);
        }
    }

    // 3. Materialise ONLY selected indices into typed arrays
    const m = validIndices.length;
    const t0 = col.timeSec[validIndices[0]];
    const timeMins     = new Float64Array(m);
    const viscosityCp  = new Float64Array(m);
    const temperatureC = new Float64Array(m);
    const shearRate    = new Float64Array(m);
    const shearStress  = new Float64Array(m);
    const pressureBar  = new Float64Array(m);
    const speedRpm     = new Float64Array(m);
    const bathTempC    = new Float64Array(m);

    for (let i = 0; i < m; i++) {
        const idx = validIndices[i];
        timeMins[i]     = Math.round(((col.timeSec[idx] - t0) / 60) * 100) / 100;
        viscosityCp[i]  = col.viscosityCp[idx] ?? 0;
        temperatureC[i] = col.temperatureC[idx] ?? 0;
        shearRate[i]    = col.shearRate[idx] ?? 0;
        shearStress[i]  = col.shearStress?.[idx] ?? 0;
        pressureBar[i]  = col.pressureBar[idx] ?? 0;
        speedRpm[i]     = col.speedRpm[idx] ?? 0;
        bathTempC[i]    = col.bathTemperatureC?.[idx] ?? 0;
    }

    return {
        timeMins, viscosityCp, temperatureC,
        shearRate, shearStress, pressureBar, speedRpm, bathTemperatureC: bathTempC,
    };
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
