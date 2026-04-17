/**
 * Tests for src/lib/analysis/report-types/converters.ts
 * Data conversion between TypeScript and WASM-compatible structures.
 */
import { describe, it, expect } from 'vitest';
import {
    convertPointsToWasm,
    convertStepsToWasm,
    convertWasmStepsToTS,
    convertWasmCyclesToTS,
} from '@/lib/analysis/report-types/converters';
import type { RheoPoint, RheoStep } from '@/lib/analysis/types';

// ── Helpers ────────────────────────────────────────────────────────────────

function makePoint(overrides: Partial<RheoPoint> = {}): RheoPoint {
    return {
        time_sec: 10,
        viscosity_cp: 100,
        temperature_c: 25,
        shear_rate: 50,
        shear_stress: 5,
        pressure_bar: 1,
        ...overrides,
    };
}

function makeStep(overrides: Partial<RheoStep> = {}): RheoStep {
    return {
        id: 1,
        startTime: 0,
        endTime: 60,
        duration: 60,
        avgShearRate: 50,
        avgShearStress: 5,
        avgViscosity: 100,
        avgTemperature: 25,
        avgPressure: 1,
        points: [makePoint()],
        calcPointsCount: 1,
        isRamp: false,
        startIndex: 0,
        endIndex: 0,
        ...overrides,
    };
}

// ── convertPointsToWasm ─────────────────────────────────────────────────────

describe('convertPointsToWasm', () => {
    it('returns empty array for empty input', () => {
        expect(convertPointsToWasm([])).toEqual([]);
    });

    it('maps field names correctly', () => {
        const result = convertPointsToWasm([makePoint({ time_sec: 5, viscosity_cp: 200, temperature_c: 30 })]) as Record<string, unknown>[];
        expect(result[0].time_sec).toBe(5);
        expect(result[0].viscosity_cp).toBe(200);
        expect(result[0].temperature_c).toBe(30);
    });

    it('handles NaN viscosity with 0 fallback', () => {
        const result = convertPointsToWasm([makePoint({ viscosity_cp: NaN })]) as Record<string, unknown>[];
        expect(result[0].viscosity_cp).toBe(0);
    });

    it('handles null pressure_bar as nullable', () => {
        const result = convertPointsToWasm([makePoint({ pressure_bar: undefined })]) as Record<string, unknown>[];
        // pressure_bar → null/undefined via toNullableFiniteNumber
        expect(result[0].pressure_bar == null || result[0].pressure_bar === 0).toBe(true);
    });

    it('preserves length for multi-point array', () => {
        const points = [makePoint(), makePoint({ time_sec: 20 }), makePoint({ time_sec: 30 })];
        expect(convertPointsToWasm(points)).toHaveLength(3);
    });
});

// ── convertStepsToWasm ──────────────────────────────────────────────────────

describe('convertStepsToWasm', () => {
    it('returns empty array for empty input', () => {
        expect(convertStepsToWasm([])).toEqual([]);
    });

    it('maps step id and times correctly', () => {
        const result = convertStepsToWasm([makeStep({ id: 7, startTime: 10, endTime: 70 })]);
        expect(result[0].id).toBe(7);
        expect(result[0].startTime).toBe(10);
        expect(result[0].endTime).toBe(70);
    });

    it('maps nested points array', () => {
        const step = makeStep({ points: [makePoint({ time_sec: 5 }), makePoint({ time_sec: 10 })] });
        const result = convertStepsToWasm([step]);
        expect(result[0].points).toHaveLength(2);
        expect(result[0].points[0].time_sec).toBe(5);
    });

    it('preserves isRamp flag', () => {
        const result = convertStepsToWasm([makeStep({ isRamp: true })]);
        expect(result[0].isRamp).toBe(true);
    });

    it('converts NaN avgShearRate to 0', () => {
        const result = convertStepsToWasm([makeStep({ avgShearRate: NaN })]);
        expect(result[0].avgShearRate).toBe(0);
    });
});

// ── convertWasmStepsToTS ────────────────────────────────────────────────────

describe('convertWasmStepsToTS', () => {
    it('returns empty array for empty input', () => {
        expect(convertWasmStepsToTS([])).toEqual([]);
    });

    it('computes duration from times when WASM returns 0 duration', () => {
        const wasmStep = {
            id: 1, startTime: 10, endTime: 70, duration: 0,
            avgShearRate: 50, avgShearStress: 5, avgViscosity: 100,
            avgTemperature: 25, avgPressure: 1,
            points: [], calcPointsCount: 0, isRamp: false, startIndex: 0, endIndex: 0, isSplitStart: false,
        };
        const result = convertWasmStepsToTS([wasmStep]);
        expect(result[0].duration).toBe(60);
    });

    it('uses provided duration when > 0', () => {
        const wasmStep = {
            id: 1, startTime: 10, endTime: 70, duration: 55,
            avgShearRate: 50, avgShearStress: 5, avgViscosity: 100,
            avgTemperature: 25, avgPressure: 1,
            points: [], calcPointsCount: 0, isRamp: false, startIndex: 0, endIndex: 0, isSplitStart: false,
        };
        const result = convertWasmStepsToTS([wasmStep]);
        expect(result[0].duration).toBe(55);
    });
});

// ── convertWasmCyclesToTS ───────────────────────────────────────────────────

describe('convertWasmCyclesToTS', () => {
    it('returns empty array for empty input', () => {
        expect(convertWasmCyclesToTS([])).toEqual([]);
    });

    it('handles null/undefined input gracefully', () => {
        // @ts-expect-error testing null input
        expect(convertWasmCyclesToTS(null)).toEqual([]);
    });

    it('converts a minimal cycle', () => {
        const wasmCycles = [{
            id: 1, type: 'API', description: 'Cycle 1', duration: 120,
            startTime: 0, endTime: 120, startIndex: 0, endIndex: 10,
            steps: [{
                id: 1, startTime: 0, endTime: 60, duration: 60,
                avgShearRate: 50, avgShearStress: 5, avgViscosity: 100,
                avgTemperature: 25, avgPressure: 1,
                points: [], calcPointsCount: 0, isRamp: false, startIndex: 0, endIndex: 0, isSplitStart: false,
            }],
        }];
        const result = convertWasmCyclesToTS(wasmCycles);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1);
        expect(result[0].steps).toHaveLength(1);
    });
});
