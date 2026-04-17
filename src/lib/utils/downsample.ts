/**
 * LTTB Downsampling Algorithm
 * Reduces data points while preserving visual shape
 */
export function downsampleLTTB<T extends { x: number; y: number }>(
    data: T[],
    threshold: number
): T[] {
    if (data.length <= threshold) return data;

    const sampled: T[] = [data[0]]; // Always keep first point
    const bucketSize = (data.length - 2) / (threshold - 2);

    let a = 0; // Previous selected point index

    for (let i = 0; i < threshold - 2; i++) {
        // Calculate bucket range
        const bucketStart = Math.floor((i + 1) * bucketSize) + 1;
        const bucketEnd = Math.min(
            Math.floor((i + 2) * bucketSize) + 1,
            data.length - 1
        );

        // Calculate average point of next bucket for comparison
        let avgX = 0, avgY = 0;
        const nextBucketStart = bucketEnd;
        const nextBucketEnd = Math.min(
            Math.floor((i + 3) * bucketSize) + 1,
            data.length
        );
        const nextBucketSize = nextBucketEnd - nextBucketStart;

        for (let j = nextBucketStart; j < nextBucketEnd; j++) {
            avgX += data[j].x;
            avgY += data[j].y;
        }
        avgX /= nextBucketSize || 1;
        avgY /= nextBucketSize || 1;

        // Find point with maximum area in current bucket
        let maxArea = -1;
        let maxIdx = bucketStart;

        for (let j = bucketStart; j < bucketEnd; j++) {
            const area = Math.abs(
                (data[a].x - avgX) * (data[j].y - data[a].y) -
                (data[a].x - data[j].x) * (avgY - data[a].y)
            );
            if (area > maxArea) {
                maxArea = area;
                maxIdx = j;
            }
        }

        sampled.push(data[maxIdx]);
        a = maxIdx;
    }

    sampled.push(data[data.length - 1]); // Always keep last point
    return sampled;
}

/**
 * Multi-channel LTTB: selects points that best preserve shape across ALL
 * specified channels simultaneously. This avoids distortion when the visible
 * channel differs from the channel used for point selection.
 *
 * Algorithm: normalise each channel to [0,1] range, then pick the point in
 * each bucket whose combined normalised deviation from the previous selected
 * point is maximised.
 */
export function downsampleLTTBMultiChannel<T>(
    data: T[],
    threshold: number,
    xKey: keyof T,
    yKeys: (keyof T)[]
): T[] {
    if (data.length <= threshold) return data;

    // Pre-compute per-channel ranges for normalisation
    const ranges = yKeys.map(k => {
        let min = Infinity, max = -Infinity;
        for (const d of data) {
            const v = Number(d[k]) || 0;
            if (v < min) min = v;
            if (v > max) max = v;
        }
        const range = max - min || 1;
        return { min, range };
    });

    const getX = (d: T) => Number(d[xKey]) || 0;

    // Pre-allocate reusable buffers to avoid per-call array allocation in the hot loop.
    const nCh = yKeys.length;
    const avgYNorm = new Float64Array(nCh);
    const aYNorm   = new Float64Array(nCh);
    const jYNorm   = new Float64Array(nCh);

    /** Write normalised Y values for datum `d` into pre-allocated `out` buffer. */
    const fillYNorm = (d: T, out: Float64Array) => {
        for (let ci = 0; ci < nCh; ci++) {
            out[ci] = ((Number(d[yKeys[ci]]) || 0) - ranges[ci].min) / ranges[ci].range;
        }
    };

    const sampled: T[] = [data[0]];
    const bucketSize = (data.length - 2) / (threshold - 2);
    let a = 0;

    for (let i = 0; i < threshold - 2; i++) {
        const bucketStart = Math.floor((i + 1) * bucketSize) + 1;
        const bucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, data.length - 1);

        // Average of next bucket (normalised)
        const nextBucketStart = bucketEnd;
        const nextBucketEnd = Math.min(Math.floor((i + 3) * bucketSize) + 1, data.length);
        const nextBucketCount = nextBucketEnd - nextBucketStart || 1;

        let avgX = 0;
        avgYNorm.fill(0);
        for (let j = nextBucketStart; j < nextBucketEnd; j++) {
            avgX += getX(data[j]);
            fillYNorm(data[j], jYNorm); // reuse jYNorm as temp
            for (let ci = 0; ci < nCh; ci++) avgYNorm[ci] += jYNorm[ci];
        }
        avgX /= nextBucketCount;
        for (let ci = 0; ci < nCh; ci++) avgYNorm[ci] /= nextBucketCount;

        const aX = getX(data[a]);
        fillYNorm(data[a], aYNorm);

        let maxScore = -1;
        let maxIdx = bucketStart;

        for (let j = bucketStart; j < bucketEnd; j++) {
            const jX = getX(data[j]);
            fillYNorm(data[j], jYNorm);

            // Sum of triangle areas across all channels (normalised)
            let score = 0;
            for (let ci = 0; ci < nCh; ci++) {
                score += Math.abs(
                    (aX - avgX) * (jYNorm[ci] - aYNorm[ci]) -
                    (aX - jX) * (avgYNorm[ci] - aYNorm[ci])
                );
            }

            if (score > maxScore) {
                maxScore = score;
                maxIdx = j;
            }
        }

        sampled.push(data[maxIdx]);
        a = maxIdx;
    }

    sampled.push(data[data.length - 1]);
    return sampled;
}

/**
 * Adapter for RheoPoint data — uses multi-channel LTTB across all available
 * numeric channels so that ramps and peaks are preserved regardless of which
 * metric is currently displayed on screen.
 */
export function downsampleRheoPoints<T extends { time_sec: number }>(
    data: T[],
    threshold: number,
    yKey: keyof T = 'viscosity_cp' as keyof T
): T[] {
    if (data.length <= threshold) return data;

    const mapped = data.map((p, i) => ({
        x: p.time_sec,
        y: Number(p[yKey]) || 0,
        original: p,
        index: i
    }));

    const sampled = downsampleLTTB(mapped, threshold);
    return sampled.map(s => s.original);
}

/**
 * Multi-channel adapter for RheoPoint: preserves shape across viscosity,
 * shear_rate, shear_stress, temperature and pressure simultaneously.
 * Use this for charts where the user can switch between displayed metrics.
 */
export function downsampleRheoPointsMultiChannel<T extends {
    time_sec: number;
    viscosity_cp?: number;
    shear_rate?: number;
    shear_stress?: number;
    temperature_c?: number;
    pressure_bar?: number;
    bath_temperature_c?: number;
}>(data: T[], threshold: number): T[] {
    if (data.length <= threshold) return data;

    const channels: (keyof T)[] = (
        ['viscosity_cp', 'shear_rate', 'shear_rate_s1', 'shear_stress', 'shear_stress_pa', 'temperature_c', 'pressure_bar', 'bath_temperature_c'] as (keyof T)[]
    ).filter(k => data.some(d => d[k] != null && Number(d[k]) !== 0));

    if (channels.length === 0) return downsampleRheoPoints(data, threshold);

    return downsampleLTTBMultiChannel(data, threshold, 'time_sec' as keyof T, channels);
}

/**
 * Helper: get the shear_rate value from a point, checking both field names.
 */
function getShearRate(point: Record<string, unknown>): number {
    return Number(point.shear_rate ?? point.shear_rate_s1) || 0;
}

/**
 * Smart downsampling: preserves ALL points on ramps/sweeps (where shear_rate
 * is changing) and only applies LTTB to steady-state plateaus (constant
 * shear_rate). This avoids distorting viscosity curves during speed steps.
 *
 * Algorithm:
 *  1. Classify every point as "ramp" or "plateau" by comparing shear_rate to
 *     its neighbours within a small window. A point is a "ramp point" when
 *     the relative change of shear_rate in the window exceeds `rampThreshold`.
 *  2. Split data into consecutive segments of the same class.
 *  3. Plateau segments are downsampled with multi-channel LTTB proportional
 *     to their length share of the total `threshold` budget.
 *  4. Ramp segments are kept in full.
 */
export function downsampleRheoPointsSmart<T extends {
    time_sec: number;
    viscosity_cp?: number;
    shear_rate?: number;
    shear_rate_s1?: number;
    shear_stress?: number;
    shear_stress_pa?: number;
    temperature_c?: number;
    pressure_bar?: number;
    bath_temperature_c?: number;
}>(data: T[], threshold: number): T[] {
    if (data.length <= threshold) return data;

    const n = data.length;
    // Window half-size for shear_rate change detection (in points)
    const WINDOW = 2;
    // Relative change threshold above which a point is classified as "ramp"
    const RAMP_THRESHOLD = 0.02; // 2 %

    // --- 1. Classify points ---
    const isRamp = new Uint8Array(n); // 1 = ramp, 0 = plateau

    for (let i = 0; i < n; i++) {
        const lo = Math.max(0, i - WINDOW);
        const hi = Math.min(n - 1, i + WINDOW);
        const srLo = getShearRate(data[lo] as unknown as Record<string, unknown>);
        const srHi = getShearRate(data[hi] as unknown as Record<string, unknown>);
        const base = (Math.abs(srLo) + Math.abs(srHi)) / 2 || 1;
        const rel = Math.abs(srHi - srLo) / base;
        isRamp[i] = rel > RAMP_THRESHOLD ? 1 : 0;
    }

    // Expand ramp regions by ±2 points to avoid clipping transition edges
    const expanded = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
        if (isRamp[i]) {
            for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) {
                expanded[j] = 1;
            }
        }
    }

    // --- 2. Build segments ---
    type Segment = { start: number; end: number; type: 'ramp' | 'plateau' };
    const segments: Segment[] = [];
    let segStart = 0;
    let segType: 'ramp' | 'plateau' = expanded[0] === 1 ? 'ramp' : 'plateau';

    for (let i = 1; i <= n; i++) {
        const curType: 'ramp' | 'plateau' | null = i < n ? (expanded[i] === 1 ? 'ramp' : 'plateau') : null;
        if (curType !== segType) {
            segments.push({ start: segStart, end: i - 1, type: segType });
            segStart = i;
            segType = curType as 'ramp' | 'plateau';
        }
    }

    // Total plateau points — budget is spread proportionally
    const totalPlateauPoints = segments
        .filter(s => s.type === 'plateau')
        .reduce((sum, s) => sum + (s.end - s.start + 1), 0);

    const channels: (keyof T)[] = (
        ['viscosity_cp', 'shear_rate', 'shear_rate_s1', 'shear_stress', 'shear_stress_pa', 'temperature_c', 'pressure_bar', 'bath_temperature_c'] as (keyof T)[]
    ).filter(k => data.some(d => d[k] != null && Number(d[k]) !== 0));

    const result: T[] = [];

    for (const seg of segments) {
        const slice = data.slice(seg.start, seg.end + 1);
        if (seg.type === 'ramp' || slice.length <= 2) {
            // Keep ramps intact
            result.push(...slice);
        } else {
            // Budget for this plateau: proportional share of threshold
            const budget = Math.max(
                4,
                Math.round((slice.length / totalPlateauPoints) * threshold)
            );
            if (slice.length <= budget) {
                result.push(...slice);
            } else if (channels.length === 0) {
                result.push(...downsampleRheoPoints(slice, budget));
            } else {
                result.push(
                    ...downsampleLTTBMultiChannel(slice, budget, 'time_sec' as keyof T, channels)
                );
            }
        }
    }

    return result;
}

