/**
 * Unit tests — src/lib/utils/comparison-data.ts
 *
 * Tests the pure data-alignment pipeline used by the Comparison chart.
 * No DOM, no React, no uPlot  — pure functions only.
 *
 * Test methodology:
 *  1. sanitiseAndNormalisePoints  — input cleaning + time normalisation
 *  2. buildSharedTimeAxis         — deduplication + sort
 *  3. alignSeriesLastKnown        — zero-order hold (kept for reference / backward compat)
 *  3b. alignSeriesLinear          — linear interpolation between data points (default)
 *  4. buildComparisonUPlotData    — end-to-end integration (uses alignSeriesLinear)
 *
 * Regression scenarios covered:
 *  • Single experiment — no regressions introduced
 *  • Two experiments with disjoint time points — both series fully covered
 *  • NaN / string time_sec values are silently dropped
 *  • Unsorted input is sorted before processing
 *  • Slots before first / after last point of an experiment stay null
 *  • Empty experiments don't crash
 *  • Four active metrics across two experiments (full SoA layout)
 */

import { describe, it, expect } from 'vitest';
import type { RheoPoint } from '@/types';
import {
    sanitiseAndNormalisePoints,
    sanitiseAndNormaliseColumnarDirect,
    buildSharedTimeAxis,
    alignSeriesLastKnown,
    alignSeriesLinear,
    alignSeriesFromColumnarLinear,
    buildComparisonUPlotData,
    type ProcessedExperiment,
} from '@/lib/utils/comparison-data';
import type { ColumnarData } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal RheoPoint with sane defaults */
function pt(time_sec: number, viscosity_cp = 100, temperature_c = 25): RheoPoint {
    return { time_sec, viscosity_cp, temperature_c };
}

/** Returns all defined (non-null) indices of a series */
function definedAt(series: (number | null)[]): number[] {
    return series.map((v, i) => (v !== null ? i : -1)).filter(i => i >= 0);
}

// ─── 1. sanitiseAndNormalisePoints ────────────────────────────────────────────

describe('sanitiseAndNormalisePoints', () => {

    it('returns empty array for null / undefined input', () => {
        expect(sanitiseAndNormalisePoints(null, 'off', 1000)).toHaveLength(0);
        expect(sanitiseAndNormalisePoints(undefined, 'off', 1000)).toHaveLength(0);
    });

    it('returns empty array for empty array input', () => {
        expect(sanitiseAndNormalisePoints([], 'off', 1000)).toHaveLength(0);
    });

    it('accepts a JSON string and parses it', () => {
        const raw = JSON.stringify([pt(0), pt(60), pt(120)]);
        const result = sanitiseAndNormalisePoints(raw, 'off', 1000);
        expect(result).toHaveLength(3);
    });

    it('drops points with NaN time_sec', () => {
        const points = [pt(0), { ...pt(60), time_sec: NaN }, pt(120)];
        const result = sanitiseAndNormalisePoints(points, 'off', 1000);
        expect(result).toHaveLength(2);
        expect(result.map(p => p.time_sec)).toEqual([0, 120]);
    });

    it('coerces string time_sec values to numbers', () => {
        const points = [
            { ...pt(0), time_sec: '0' as unknown as number },
            { ...pt(60), time_sec: '60' as unknown as number },
        ];
        const result = sanitiseAndNormalisePoints(points, 'off', 1000);
        expect(result).toHaveLength(2);
    });

    it('drops points whose string time_sec is not numeric', () => {
        const points = [
            pt(0),
            { ...pt(60), time_sec: 'abc' as unknown as number },
            pt(120),
        ];
        const result = sanitiseAndNormalisePoints(points, 'off', 1000);
        expect(result).toHaveLength(2);
    });

    it('sorts unsorted input chronologically', () => {
        const points = [pt(120), pt(0), pt(60)];
        const result = sanitiseAndNormalisePoints(points, 'off', 1000);
        expect(result.map(p => p.time_sec)).toEqual([0, 60, 120]);
    });

    it('normalises time_min: first point is always 0', () => {
        const points = [pt(3600), pt(3660), pt(3720)]; // starts at 1 hour
        const result = sanitiseAndNormalisePoints(points, 'off', 1000);
        expect(result[0].time_min).toBe(0);
        expect(result[1].time_min).toBe(1);   // 60s / 60 = 1 min
        expect(result[2].time_min).toBe(2);
    });

    it('rounds time_min to 2 decimal places', () => {
        // 1 second / 60 = 0.016666... → 0.02
        const points = [pt(0), pt(1)];
        const result = sanitiseAndNormalisePoints(points, 'off', 1000);
        expect(result[1].time_min).toBe(0.02);
    });

    it('downsample mode "off" preserves all points', () => {
        const points = Array.from({ length: 50 }, (_, i) => pt(i * 60));
        const result = sanitiseAndNormalisePoints(points, 'off', 10);
        expect(result).toHaveLength(50);
    });

    it('downsample mode "smart" reduces point count below threshold', () => {
        const points = Array.from({ length: 2000 }, (_, i) => pt(i * 10));
        const result = sanitiseAndNormalisePoints(points, 'smart', 200);
        expect(result.length).toBeLessThanOrEqual(200 * 1.1); // allow 10% buffer
    });
});

// ─── 2. buildSharedTimeAxis ───────────────────────────────────────────────────

describe('buildSharedTimeAxis', () => {

    it('returns empty array for empty experiments', () => {
        expect(buildSharedTimeAxis([])).toEqual([]);
    });

    it('returns all unique times from a single experiment', () => {
        const exp: ProcessedExperiment = {
            points: [
                { ...pt(0), time_min: 0 },
                { ...pt(60), time_min: 1 },
                { ...pt(120), time_min: 2 },
            ],
        };
        expect(buildSharedTimeAxis([exp])).toEqual([0, 1, 2]);
    });

    it('merges times from two experiments and deduplicates', () => {
        const exp1: ProcessedExperiment = {
            points: [
                { ...pt(0), time_min: 0 },
                { ...pt(60), time_min: 1 },
            ],
        };
        const exp2: ProcessedExperiment = {
            points: [
                { ...pt(0), time_min: 0 },
                { ...pt(30), time_min: 0.5 },
                { ...pt(60), time_min: 1 },
            ],
        };
        const axis = buildSharedTimeAxis([exp1, exp2]);
        expect(axis).toEqual([0, 0.5, 1]);
    });

    it('returns a sorted axis even if experiment points are out of order', () => {
        const exp: ProcessedExperiment = {
            points: [
                { ...pt(120), time_min: 2 },
                { ...pt(0), time_min: 0 },
                { ...pt(60), time_min: 1 },
            ],
        };
        expect(buildSharedTimeAxis([exp])).toEqual([0, 1, 2]);
    });

    it('filters NaN time_min values', () => {
        const exp: ProcessedExperiment = {
            points: [
                { ...pt(0), time_min: 0 },
                { ...pt(60), time_min: NaN },
                { ...pt(120), time_min: 2 },
            ],
        };
        expect(buildSharedTimeAxis([exp])).toEqual([0, 2]);
    });
});

// ─── 3. alignSeriesLastKnown ──────────────────────────────────────────────────

describe('alignSeriesLastKnown', () => {

    it('returns all nulls for an empty points array', () => {
        const times = [0, 1, 2];
        expect(alignSeriesLastKnown([], times, 'viscosity_cp')).toEqual([null, null, null]);
    });

    it('maps exact time matches correctly', () => {
        const points: ProcessedExperiment['points'] = [
            { ...pt(0, 100), time_min: 0 },
            { ...pt(60, 200), time_min: 1 },
            { ...pt(120, 300), time_min: 2 },
        ];
        const times = [0, 1, 2];
        expect(alignSeriesLastKnown(points, times, 'viscosity_cp')).toEqual([100, 200, 300]);
    });

    it('uses last-known-value for slots between experiment points', () => {
        // Experiment has points at t=0 and t=2 only.
        // Shared axis has t=0, 1, 2 — slot t=1 belongs to another experiment.
        const points: ProcessedExperiment['points'] = [
            { ...pt(0, 100), time_min: 0 },
            { ...pt(120, 300), time_min: 2 },
        ];
        const times = [0, 1, 2];
        const result = alignSeriesLastKnown(points, times, 'viscosity_cp');
        // t=1 is inside [0,2] range → should hold value from t=0 → 100
        expect(result[0]).toBe(100);
        expect(result[1]).toBe(100); // last known value
        expect(result[2]).toBe(300);
    });

    it('returns null BEFORE experiment starts', () => {
        // Experiment starts at t=1, shared axis has t=0 too (from another exp)
        const points: ProcessedExperiment['points'] = [
            { ...pt(60, 200), time_min: 1 },
            { ...pt(120, 300), time_min: 2 },
        ];
        const times = [0, 1, 2];
        const result = alignSeriesLastKnown(points, times, 'viscosity_cp');
        expect(result[0]).toBeNull();  // t=0 before this experiment
        expect(result[1]).toBe(200);
        expect(result[2]).toBe(300);
    });

    it('returns null AFTER experiment ends', () => {
        // Experiment ends at t=1, shared axis continues to t=2
        const points: ProcessedExperiment['points'] = [
            { ...pt(0, 100), time_min: 0 },
            { ...pt(60, 200), time_min: 1 },
        ];
        const times = [0, 1, 2];
        const result = alignSeriesLastKnown(points, times, 'viscosity_cp');
        expect(result[0]).toBe(100);
        expect(result[1]).toBe(200);
        expect(result[2]).toBeNull(); // t=2 after this experiment ends
    });

    it('handles null / undefined field values by returning null', () => {
        const points: ProcessedExperiment['points'] = [
            { ...pt(0, 100), time_min: 0, shear_rate_s1: undefined },
            { ...pt(60, 200), time_min: 1, shear_rate_s1: undefined },
        ];
        const times = [0, 1];
        const result = alignSeriesLastKnown(points, times, 'shear_rate_s1');
        expect(result).toEqual([null, null]);
    });

    it('handles an empty times array without throwing', () => {
        const points: ProcessedExperiment['points'] = [
            { ...pt(0, 100), time_min: 0 },
        ];
        expect(() => alignSeriesLastKnown(points, [], 'viscosity_cp')).not.toThrow();
        expect(alignSeriesLastKnown(points, [], 'viscosity_cp')).toEqual([]);
    });

    it('key regression: two experiments with fully disjoint time points — both series are non-null', () => {
        // This is the exact scenario that was broken:
        // Exp1 has points at t=0,1,2; Exp2 has points at t=0.5,1.5,2.5
        // Shared axis = [0, 0.5, 1, 1.5, 2, 2.5]
        // OLD code: exact match only → Exp1 series was null at t=0.5, 1.5, 2.5
        //                           → Exp2 series was null at t=0, 1, 2
        // NEW code: last-known-value → no null gaps inside each experiment's range

        const exp1Points: ProcessedExperiment['points'] = [
            { ...pt(0, 100), time_min: 0 },
            { ...pt(60, 110), time_min: 1 },
            { ...pt(120, 120), time_min: 2 },
        ];
        const exp2Points: ProcessedExperiment['points'] = [
            { ...pt(30, 200), time_min: 0.5 },
            { ...pt(90, 210), time_min: 1.5 },
            { ...pt(150, 220), time_min: 2.5 },
        ];
        const times = [0, 0.5, 1, 1.5, 2, 2.5];

        const series1 = alignSeriesLastKnown(exp1Points, times, 'viscosity_cp');
        const series2 = alignSeriesLastKnown(exp2Points, times, 'viscosity_cp');

        // Exp1 covers [0,2] → slots 0..4 should be non-null, slot 5 (t=2.5) null
        expect(series1[0]).not.toBeNull(); // t=0
        expect(series1[1]).not.toBeNull(); // t=0.5 — last-known from t=0
        expect(series1[2]).not.toBeNull(); // t=1
        expect(series1[3]).not.toBeNull(); // t=1.5 — last-known from t=1
        expect(series1[4]).not.toBeNull(); // t=2
        expect(series1[5]).toBeNull();     // t=2.5 after Exp1 ends

        // Exp2 covers [0.5,2.5] → slot 0 (t=0) null, rest non-null
        expect(series2[0]).toBeNull();     // t=0 before Exp2 starts
        expect(series2[1]).not.toBeNull(); // t=0.5
        expect(series2[2]).not.toBeNull(); // t=1 — last-known from t=0.5
        expect(series2[3]).not.toBeNull(); // t=1.5
        expect(series2[4]).not.toBeNull(); // t=2 — last-known from t=1.5
        expect(series2[5]).not.toBeNull(); // t=2.5
    });
});

// ─── 3b. alignSeriesLinear ───────────────────────────────────────────────────

describe('alignSeriesLinear', () => {

    it('returns all nulls for an empty points array', () => {
        const times = [0, 1, 2];
        expect(alignSeriesLinear([], times, 'viscosity_cp')).toEqual([null, null, null]);
    });

    it('maps exact time matches without modification', () => {
        const points: ProcessedExperiment['points'] = [
            { ...pt(0, 100), time_min: 0 },
            { ...pt(60, 200), time_min: 1 },
            { ...pt(120, 300), time_min: 2 },
        ];
        const times = [0, 1, 2];
        expect(alignSeriesLinear(points, times, 'viscosity_cp')).toEqual([100, 200, 300]);
    });

    it('linearly interpolates between two bracketing data points', () => {
        // Experiment has points at t=0 (v=100) and t=2 (v=300).
        // Shared axis has t=0, 1, 2 — slot t=1 is intermediate.
        // Linear interp: v(1) = 100 + (300-100) * (1-0)/(2-0) = 200
        const points: ProcessedExperiment['points'] = [
            { ...pt(0, 100), time_min: 0 },
            { ...pt(120, 300), time_min: 2 },
        ];
        const times = [0, 1, 2];
        const result = alignSeriesLinear(points, times, 'viscosity_cp');
        expect(result[0]).toBe(100);
        expect(result[1]).toBeCloseTo(200, 5); // linearly interpolated
        expect(result[2]).toBe(300);
    });

    it('returns null BEFORE experiment starts', () => {
        const points: ProcessedExperiment['points'] = [
            { ...pt(60, 200), time_min: 1 },
            { ...pt(120, 300), time_min: 2 },
        ];
        const times = [0, 1, 2];
        const result = alignSeriesLinear(points, times, 'viscosity_cp');
        expect(result[0]).toBeNull();  // t=0 before this experiment
        expect(result[1]).toBe(200);
        expect(result[2]).toBe(300);
    });

    it('returns null AFTER experiment ends', () => {
        const points: ProcessedExperiment['points'] = [
            { ...pt(0, 100), time_min: 0 },
            { ...pt(60, 200), time_min: 1 },
        ];
        const times = [0, 1, 2];
        const result = alignSeriesLinear(points, times, 'viscosity_cp');
        expect(result[0]).toBe(100);
        expect(result[1]).toBe(200);
        expect(result[2]).toBeNull(); // t=2 after this experiment ends
    });

    it('returns exact value for single-point experiment at its own time', () => {
        const points: ProcessedExperiment['points'] = [
            { ...pt(60, 500), time_min: 1 },
        ];
        const times = [0, 1, 2];
        const result = alignSeriesLinear(points, times, 'viscosity_cp');
        expect(result[0]).toBeNull();
        expect(result[1]).toBe(500);
        expect(result[2]).toBeNull();
    });

    it('handles null / undefined field values by returning null', () => {
        const points: ProcessedExperiment['points'] = [
            { ...pt(0, 100), time_min: 0, shear_rate_s1: undefined },
            { ...pt(60, 200), time_min: 1, shear_rate_s1: undefined },
        ];
        const times = [0, 1];
        const result = alignSeriesLinear(points, times, 'shear_rate_s1');
        expect(result).toEqual([null, null]);
    });

    it('handles an empty times array without throwing', () => {
        const points: ProcessedExperiment['points'] = [
            { ...pt(0, 100), time_min: 0 },
        ];
        expect(() => alignSeriesLinear(points, [], 'viscosity_cp')).not.toThrow();
        expect(alignSeriesLinear(points, [], 'viscosity_cp')).toEqual([]);
    });

    it('temperature staircase scenario: sparse exp fills in smooth ramp', () => {
        // Sparse experiment: temperature jumps every 2 min
        // Dense shared axis (from another exp): every 0.5 min
        // Expect linear interpolation between each 2-min bracket
        const points: ProcessedExperiment['points'] = [
            { ...pt(0, 100, 30), time_min: 0 },
            { ...pt(120, 100, 60), time_min: 2 },
            { ...pt(240, 100, 90), time_min: 4 },
        ];
        const times = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
        const result = alignSeriesLinear(points, times, 'temperature_c');

        // t=0 → 30, t=2 → 60, t=4 → 90  (exact points)
        expect(result[0]).toBeCloseTo(30, 5);
        expect(result[4]).toBeCloseTo(60, 5);
        expect(result[8]).toBeCloseTo(90, 5);

        // Intermediates must be strictly between adjacent exact values (smooth ramp)
        expect(result[1]).toBeCloseTo(37.5, 5); // 30 + (60-30)*0.25
        expect(result[2]).toBeCloseTo(45,   5); // 30 + (60-30)*0.50
        expect(result[3]).toBeCloseTo(52.5, 5); // 30 + (60-30)*0.75
        expect(result[5]).toBeCloseTo(67.5, 5); // 60 + (90-60)*0.25
    });

    it('disjoint experiments: both series have smooth non-null coverage', () => {
        // Exp1: t=0,1,2 viscosity 100,110,120
        // Exp2: t=0.5,1.5,2.5 viscosity 200,210,220
        // Shared axis = [0, 0.5, 1, 1.5, 2, 2.5]
        const exp1Points: ProcessedExperiment['points'] = [
            { ...pt(0, 100), time_min: 0 },
            { ...pt(60, 110), time_min: 1 },
            { ...pt(120, 120), time_min: 2 },
        ];
        const exp2Points: ProcessedExperiment['points'] = [
            { ...pt(30, 200), time_min: 0.5 },
            { ...pt(90, 210), time_min: 1.5 },
            { ...pt(150, 220), time_min: 2.5 },
        ];
        const times = [0, 0.5, 1, 1.5, 2, 2.5];

        const series1 = alignSeriesLinear(exp1Points, times, 'viscosity_cp');
        const series2 = alignSeriesLinear(exp2Points, times, 'viscosity_cp');

        // Exp1 covers [0,2] → slots 0..4 non-null, slot 5 null
        expect(series1[0]).not.toBeNull(); // t=0 exact: 100
        expect(series1[1]).toBeCloseTo(105, 5); // t=0.5 interp between 100 and 110
        expect(series1[2]).not.toBeNull(); // t=1 exact: 110
        expect(series1[3]).toBeCloseTo(115, 5); // t=1.5 interp between 110 and 120
        expect(series1[4]).not.toBeNull(); // t=2 exact: 120
        expect(series1[5]).toBeNull();     // t=2.5 after Exp1 ends

        // Exp2 covers [0.5,2.5] → slot 0 null, rest non-null
        expect(series2[0]).toBeNull();     // t=0 before Exp2 starts
        expect(series2[1]).not.toBeNull(); // t=0.5 exact: 200
        expect(series2[2]).toBeCloseTo(205, 5); // t=1 interp between 200 and 210
        expect(series2[3]).not.toBeNull(); // t=1.5 exact: 210
        expect(series2[4]).toBeCloseTo(215, 5); // t=2 interp between 210 and 220
        expect(series2[5]).not.toBeNull(); // t=2.5 exact: 220
    });
});

// ─── 4. buildComparisonUPlotData — integration ────────────────────────────────

describe('buildComparisonUPlotData', () => {

    it('produces correct SoA dimensions for one experiment, one metric', () => {
        const rawExp = { rawPoints: [pt(0), pt(60), pt(120)] };
        const { data } = buildComparisonUPlotData([rawExp], ['viscosity_cp'], 'off', 1000);
        expect(data.times).toHaveLength(3);
        expect(data.series).toHaveLength(1); // 1 exp × 1 metric
        expect(data.series[0]).toHaveLength(3);
    });

    it('produces correct SoA dimensions for two experiments, two metrics', () => {
        const exp1 = { rawPoints: [pt(0), pt(60)] };
        const exp2 = { rawPoints: [pt(0), pt(60)] };
        const { data } = buildComparisonUPlotData(
            [exp1, exp2],
            ['viscosity_cp', 'temperature_c'],
            'off',
            1000,
        );
        // 2 exps × 2 metrics = 4 series
        expect(data.series).toHaveLength(4);
        // Each series length equals shared axis length
        for (const s of data.series) {
            expect(s).toHaveLength(data.times.length);
        }
    });

    it('does not crash on empty experiments list', () => {
        const { data } = buildComparisonUPlotData([], ['viscosity_cp'], 'off', 1000);
        expect(data.times).toEqual([]);
        expect(data.series).toEqual([]);
    });

    it('does not crash on experiment with null rawPoints', () => {
        const rawExp = { rawPoints: null };
        expect(() =>
            buildComparisonUPlotData([rawExp], ['viscosity_cp'], 'off', 1000),
        ).not.toThrow();
    });

    it('key regression: second experiment series is non-empty when experiments have disjoint times', () => {
        // Matches the real-world bug: adding a second experiment caused all series to go null
        const exp1 = {
            rawPoints: [
                pt(0, 500, 40),
                pt(60, 480, 41),
                pt(120, 460, 41),
            ],
        };
        const exp2 = {
            rawPoints: [
                pt(30, 300, 35),
                pt(90, 280, 36),
                pt(150, 260, 36),
            ],
        };

        const { data } = buildComparisonUPlotData(
            [exp1, exp2],
            ['viscosity_cp'],
            'off',
            1000,
        );

        // series[0] = exp1 viscosity, series[1] = exp2 viscosity
        const exp1Series = data.series[0];
        const exp2Series = data.series[1];

        // Both series must have some non-null values
        expect(definedAt(exp1Series).length).toBeGreaterThan(0);
        expect(definedAt(exp2Series).length).toBeGreaterThan(0);

        // In particular, exp2 must NOT be all-null (that was the bug)
        expect(exp2Series.every(v => v === null)).toBe(false);
        // And exp1 must NOT be all-null either
        expect(exp1Series.every(v => v === null)).toBe(false);
    });

    it('produces correct viscosity values at known time slots', () => {
        // IMPORTANT: each experiment's time_min is normalised from its OWN start (t=0).
        // exp1 raw: [0s, 120s]  → time_min: [0, 2]  viscosity: [500, 400]
        // exp2 raw: [0s, 120s]  → time_min: [0, 2]  viscosity: [300, 200]
        // Both share the same normalised axis [0, 2], so shared axis = [0, 2].
        const exp1 = { rawPoints: [pt(0, 500), pt(120, 400)] };
        const exp2 = { rawPoints: [pt(0, 300), pt(120, 200)] };

        const { data } = buildComparisonUPlotData(
            [exp1, exp2],
            ['viscosity_cp'],
            'off',
            1000,
        );

        expect(data.times).toEqual([0, 2]);

        const s1 = data.series[0]; // exp1
        const s2 = data.series[1]; // exp2

        expect(s1[0]).toBe(500); // t=0 exact
        expect(s1[1]).toBe(400); // t=2 exact

        expect(s2[0]).toBe(300); // t=0 exact
        expect(s2[1]).toBe(200); // t=2 exact
    });

    it('two experiments with different data lengths produce no null gaps within their range', () => {
        // exp1: 3 points at [0,1,2] min;  exp2: 2 points at [0,2] min
        // shared axis: [0,1,2]
        // exp2 has no point at t=1, but last-known-value from t=0 should fill it
        const exp1 = {
            rawPoints: [pt(0, 500), pt(60, 480), pt(120, 460)],
        };
        const exp2 = {
            rawPoints: [pt(0, 300), pt(120, 200)],
        };

        const { data } = buildComparisonUPlotData(
            [exp1, exp2],
            ['viscosity_cp'],
            'off',
            1000,
        );

        expect(data.times).toEqual([0, 1, 2]);

        const s2 = data.series[1]; // exp2
        expect(s2[0]).toBe(300);       // t=0 exact
        expect(s2[1]).toBeCloseTo(250, 5); // t=1 linearly interpolated: 300 + (200-300)*0.5
        expect(s2[2]).toBe(200);       // t=2 exact
    });

    it('all series arrays have identical length equal to times length', () => {
        const exps = [
            { rawPoints: [pt(0), pt(60), pt(120), pt(180)] },
            { rawPoints: [pt(15), pt(75), pt(135)] },
            { rawPoints: [pt(30), pt(90), pt(150), pt(210)] },
        ];
        const { data } = buildComparisonUPlotData(
            exps,
            ['viscosity_cp', 'temperature_c'],
            'off',
            1000,
        );

        for (const s of data.series) {
            expect(s).toHaveLength(data.times.length);
        }
    });
});

// ─── 5. Bath-temperature null handling (columnar path) ─────────────────────
//
// Regression guard 2026-04-22: when a parser merges two tables and only one
// of them carries `bath_temperature_c` (e.g. OFITE 1100 Sweep Data +
// Log Data), the missing rows arrive as `null` entries in
// `ColumnarData.bathTemperatureC`.  The comparison pipeline used to coerce
// these to `0` via `?? 0`, producing vertical spikes that drag the orange
// dashed line down to the X-axis at every missing point.  The fix uses
// `NaN` so the downstream align helpers emit proper `null` gaps.

describe('comparison columnar path — bath-temperature null handling', () => {
    function makeCol(bathTempC: Array<number | null>): ColumnarData {
        const n = bathTempC.length;
        return {
            timeSec: Array.from({ length: n }, (_, i) => i * 60),
            viscosityCp: Array.from({ length: n }, () => 500),
            temperatureC: Array.from({ length: n }, () => 100),
            shearRate: Array.from({ length: n }, () => 10),
            shearStress: Array.from({ length: n }, () => 1),
            pressureBar: Array.from({ length: n }, () => 1),
            speedRpm: Array.from({ length: n }, () => 300),
            bathTemperatureC: bathTempC,
        };
    }

    it('sanitiseAndNormaliseColumnarDirect stores NaN (not 0) for missing bath temp', () => {
        const col = makeCol([110, null, 112]);
        const pc = sanitiseAndNormaliseColumnarDirect(col, 'off', 1000);
        expect(pc.bathTemperatureC).toHaveLength(3);
        expect(pc.bathTemperatureC[0]).toBe(110);
        expect(Number.isNaN(pc.bathTemperatureC[1])).toBe(true);   // ← NaN, not 0
        expect(pc.bathTemperatureC[2]).toBe(112);
    });

    it('alignSeriesFromColumnarLinear emits null for NaN bath points on the shared axis', () => {
        const col = makeCol([110, null, 112]);
        const pc = sanitiseAndNormaliseColumnarDirect(col, 'off', 1000);

        // Shared time axis coincides with the experiment's own times (0, 1, 2 min)
        const sortedTimes = [0, 1, 2];
        const aligned = alignSeriesFromColumnarLinear(pc, sortedTimes, 'bath_temperature_c');

        expect(aligned).toHaveLength(3);
        expect(aligned[0]).toBe(110);
        expect(aligned[1]).toBeNull();   // ← was erroneously 0 before the fix
        expect(aligned[2]).toBe(112);
    });

    it('alignSeriesFromColumnarLinear does NOT render bath line through 0 when points are missing', () => {
        // Simulates OFITE 1100: rows 1,3,5 are "Sweep Data" without bath;
        // rows 0,2,4 are "Log Data" with bath temp at a steady 110.
        const col = makeCol([110, null, 110, null, 110, null]);
        const pc = sanitiseAndNormaliseColumnarDirect(col, 'off', 1000);

        const sortedTimes = [0, 1, 2, 3, 4, 5];
        const aligned = alignSeriesFromColumnarLinear(pc, sortedTimes, 'bath_temperature_c');

        // Regression guard: no 0 anywhere — the bug drew a line from 110 down
        // to 0 and back at every other point.
        for (const v of aligned) {
            expect(v === null || v === 110).toBe(true);
        }
    });
});
