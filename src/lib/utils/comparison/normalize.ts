import type { RheoPoint, ColumnarData } from '@/types';
import {
    downsampleRheoPointsSmart,
    downsampleRheoPointsMultiChannel,
} from '../downsample';
import type { DownsampleMode, ProcessedExperiment, ProcessedColumnar } from './types';

// ─── Step 1: sanitise + downsample + time-normalise ─────────────────────────

function columnarTimeOriginSec(col: ColumnarData, fallback: number): number {
    return Number.isFinite(col.timeOriginSec) ? Number(col.timeOriginSec) : fallback;
}

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
    col: ColumnarData,
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
    const t0 = columnarTimeOriginSec(col, col.timeSec[validIndices[0]]);
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

// ─── Columnar-native pipeline (SoA throughout, zero full AoS allocation) ─────

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
    col: ColumnarData,
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
    const t0 = columnarTimeOriginSec(col, col.timeSec[validIndices[0]]);
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
        // NaN (not 0) for missing bath temp so alignSeriesFromColumnar* emits
        // `null` into the uPlot series — otherwise the bath-temp line would
        // drop to the X-axis at every point coming from a merged table that
        // lacks bath temperature (e.g. OFITE 1100 Sweep Data rows).
        bathTempC[i]    = col.bathTemperatureC?.[idx] ?? NaN;
    }

    return {
        timeMins, viscosityCp, temperatureC,
        shearRate, shearStress, pressureBar, speedRpm, bathTemperatureC: bathTempC,
    };
}
