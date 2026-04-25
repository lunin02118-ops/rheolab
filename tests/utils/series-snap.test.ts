import { describe, expect, test } from 'vitest';
import {
    findNearestTimeIndex,
    medianSamplingInterval,
    snapToSeries,
} from '../../src/lib/utils/series-snap';

describe('findNearestTimeIndex', () => {
    test('returns -1 for empty array', () => {
        expect(findNearestTimeIndex([], 5)).toBe(-1);
    });

    test('returns 0 for single-element array', () => {
        expect(findNearestTimeIndex([3.2], 5)).toBe(0);
    });

    test('finds exact match in middle', () => {
        expect(findNearestTimeIndex([1, 2, 3, 4, 5], 3)).toBe(2);
    });

    test('returns left neighbour when target is exactly between two values', () => {
        // Tie-breaks to the *earlier* (smaller index) point.
        expect(findNearestTimeIndex([1, 2, 3, 4, 5], 2.5)).toBe(1);
    });

    test('clamps to last index for target past the end', () => {
        expect(findNearestTimeIndex([0, 5, 10], 100)).toBe(2);
    });

    test('clamps to first index for target before the start', () => {
        expect(findNearestTimeIndex([0, 5, 10], -4)).toBe(0);
    });

    test('works with Float64Array', () => {
        const arr = new Float64Array([0, 1.5, 3, 4.5, 6]);
        expect(findNearestTimeIndex(arr, 4.9)).toBe(3);
    });
});

describe('medianSamplingInterval', () => {
    test('returns 0 for < 2 points', () => {
        expect(medianSamplingInterval([])).toBe(0);
        expect(medianSamplingInterval([7])).toBe(0);
    });

    test('returns the sampling step for evenly-spaced data', () => {
        const arr = new Float64Array(201).map((_, i) => i * 0.5);
        expect(medianSamplingInterval(arr)).toBeCloseTo(0.5, 3);
    });

    test('ignores large outlier gaps using the median', () => {
        // Most intervals are 1, one is 100 — median is still 1.
        const arr = [0, 1, 2, 3, 4, 104, 105, 106, 107];
        expect(medianSamplingInterval(arr)).toBe(1);
    });
});

describe('snapToSeries', () => {
    test('snaps to the nearest vertex within tolerance', () => {
        const times = new Float64Array([0, 1, 2, 3, 4, 5]);
        const viscs = new Float64Array([500, 480, 450, 420, 400, 380]);
        const snap = snapToSeries(3.1, 418, times, viscs, 1, 1.5);
        expect(snap.snapped).toBe(true);
        expect(snap.time).toBe(3);
        expect(snap.viscosityDisplay).toBe(420);
    });

    test('interpolates between neighbours when far from any vertex', () => {
        // With a 5 min sampling interval, the raw time t=2.5 is outside the
        // snap radius but the marker should still land on the rendered
        // line — so interpolate between t=0 and t=5.
        const times = new Float64Array([0, 5, 10]);
        const viscs = new Float64Array([500, 300, 100]);
        const snap = snapToSeries(2.5, 400, times, viscs, 5, 0); // radius=0 → no snap
        expect(snap.snapped).toBe(false);
        expect(snap.time).toBe(2.5);
        expect(snap.viscosityDisplay).toBeCloseTo(400, 3);
    });

    test('returns raw coordinates when series is empty', () => {
        const empty = new Float64Array(0);
        const snap = snapToSeries(1, 2, empty, empty, 0);
        expect(snap.snapped).toBe(false);
        expect(snap.time).toBe(1);
        expect(snap.viscosityDisplay).toBe(2);
    });

    test('falls back to raw when target is past the series end', () => {
        const times = new Float64Array([0, 1]);
        const viscs = new Float64Array([500, 450]);
        const snap = snapToSeries(100, 100, times, viscs, 1, 0);
        expect(snap.snapped).toBe(false);
        expect(snap.time).toBe(100);
        expect(snap.viscosityDisplay).toBe(100);
    });
});
