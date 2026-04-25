/**
 * Tests for src/lib/utils/columnar.ts
 *
 * Covers:
 *   - columnarToRawPoints()      — SoA → AoS, null coercion, bathTemperature
 *   - rawPointsToColumnar()      — AoS → SoA, bathTemperature detection
 *   - tauriRawRecordsToColumnar() — wire format → SoA, field aliasing, null handling
 *   - rawPointsFromParseResult() — null guard, rawPoints preference, columnar fallback
 *   - round-trip fidelity        — columnarToRawPoints ↔ rawPointsToColumnar
 */

import { describe, expect, it } from 'vitest';
import {
    columnarToRawPoints,
    rawPointsToColumnar,
    tauriRawRecordsToColumnar,
    rawPointsFromParseResult,
} from '@/lib/utils/columnar';
import type { ColumnarData } from '@/types';
import type { RheoDataPoint } from '@/lib/parsing/types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeColumnar(n = 3, withBath = false): ColumnarData {
    const timeSec = Array.from({ length: n }, (_, i) => i * 10);
    const viscosityCp = Array.from({ length: n }, (_, i) => i * 100 + 50);
    const temperatureC = Array.from({ length: n }, (_, i) => 60 + i);
    const shearRate = Array.from({ length: n }, (_, i) => i * 5.0);
    const shearStress = Array.from({ length: n }, (_, i) => i * 2.5);
    const pressureBar = Array.from({ length: n }, () => 1.0);
    const speedRpm = Array.from({ length: n }, (_, i) => i * 3.0);
    const bathTemperatureC = withBath ? Array.from({ length: n }, (_, i) => 25 + i) : undefined;
    return { timeSec, viscosityCp, temperatureC, shearRate, shearStress, pressureBar, speedRpm, ...(bathTemperatureC ? { bathTemperatureC } : {}) };
}

function makeRawPoints(n = 3, withBath = false): RheoDataPoint[] {
    return Array.from({ length: n }, (_, i) => ({
        time_sec: i * 10,
        viscosity_cp: i * 100 + 50,
        temperature_c: 60 + i,
        shear_rate_s1: i * 5.0,
        shear_stress_pa: i * 2.5,
        pressure_bar: 1.0,
        speed_rpm: i * 3.0,
        ...(withBath ? { bath_temperature_c: 25 + i } : {}),
    }));
}

// ── columnarToRawPoints ───────────────────────────────────────────────────────

describe('columnarToRawPoints()', () => {
    it('converts SoA to AoS with correct length', () => {
        const col = makeColumnar(5);
        expect(columnarToRawPoints(col)).toHaveLength(5);
    });

    it('maps first element correctly', () => {
        const col = makeColumnar(3);
        const pts = columnarToRawPoints(col);
        expect(pts[0].time_sec).toBe(col.timeSec[0]);
        expect(pts[0].viscosity_cp).toBe(col.viscosityCp[0]);
        expect(pts[0].temperature_c).toBe(col.temperatureC[0]);
        expect(pts[0].shear_rate_s1).toBe(col.shearRate[0]);
        expect(pts[0].shear_stress_pa).toBe(col.shearStress[0]);
        expect(pts[0].pressure_bar).toBe(col.pressureBar[0]);
        expect(pts[0].speed_rpm).toBe(col.speedRpm[0]);
    });

    it('coerces null shear fields to 0', () => {
        const col: ColumnarData = {
            timeSec: [1], viscosityCp: [10], temperatureC: [50],
            shearRate: [null], shearStress: [null],
            pressureBar: [null], speedRpm: [null],
        };
        const pts = columnarToRawPoints(col);
        expect(pts[0].shear_rate_s1).toBe(0);
        expect(pts[0].shear_stress_pa).toBe(0);
        expect(pts[0].pressure_bar).toBe(0);
        expect(pts[0].speed_rpm).toBe(0);
    });

    it('includes bath_temperature_c when bathTemperatureC array present', () => {
        const col = makeColumnar(2, true);
        const pts = columnarToRawPoints(col);
        expect(pts[0].bath_temperature_c).toBe(col.bathTemperatureC![0]);
        expect(pts[1].bath_temperature_c).toBe(col.bathTemperatureC![1]);
    });

    it('omits bath_temperature_c key when bathTemperatureC missing', () => {
        const col = makeColumnar(2, false);
        const pts = columnarToRawPoints(col);
        expect('bath_temperature_c' in pts[0]).toBe(false);
    });

    it('coerces null bathTemperature entries to undefined', () => {
        const col: ColumnarData = {
            timeSec: [1], viscosityCp: [10], temperatureC: [50],
            shearRate: [0], shearStress: [0], pressureBar: [0], speedRpm: [0],
            bathTemperatureC: [null],
        };
        const pts = columnarToRawPoints(col);
        // null entry → no key or undefined
        expect(pts[0].bath_temperature_c == null).toBe(true);
    });

    it('handles empty array', () => {
        const empty: ColumnarData = {
            timeSec: [], viscosityCp: [], temperatureC: [],
            shearRate: [], shearStress: [], pressureBar: [], speedRpm: [],
        };
        expect(columnarToRawPoints(empty)).toHaveLength(0);
    });
});

// ── rawPointsToColumnar ───────────────────────────────────────────────────────

describe('rawPointsToColumnar()', () => {
    it('converts AoS to SoA with correct length', () => {
        const pts = makeRawPoints(4);
        const col = rawPointsToColumnar(pts);
        expect(col.timeSec).toHaveLength(4);
        expect(col.viscosityCp).toHaveLength(4);
    });

    it('maps values correctly', () => {
        const pts = makeRawPoints(2);
        const col = rawPointsToColumnar(pts);
        expect(col.timeSec[0]).toBe(pts[0].time_sec);
        expect(col.viscosityCp[1]).toBe(pts[1].viscosity_cp);
        expect(col.shearRate[0]).toBe(pts[0].shear_rate_s1);
        expect(col.speedRpm[1]).toBe(pts[1].speed_rpm);
    });

    it('includes bathTemperatureC only when at least one point has it', () => {
        const pts = makeRawPoints(3, true);
        const col = rawPointsToColumnar(pts);
        expect(col.bathTemperatureC).toBeDefined();
        expect(col.bathTemperatureC![0]).toBe(pts[0].bath_temperature_c);
    });

    it('omits bathTemperatureC when no point has bath_temperature_c', () => {
        const pts = makeRawPoints(3, false);
        const col = rawPointsToColumnar(pts);
        expect(col.bathTemperatureC).toBeUndefined();
    });

    it('stores null in bathTemperatureC for points without the field', () => {
        const pts: RheoDataPoint[] = [
            { time_sec: 0, viscosity_cp: 10, temperature_c: 50, shear_rate_s1: 1, shear_stress_pa: 1, pressure_bar: 1, speed_rpm: 1, bath_temperature_c: 25 },
            { time_sec: 1, viscosity_cp: 20, temperature_c: 51, shear_rate_s1: 2, shear_stress_pa: 2, pressure_bar: 2, speed_rpm: 2 }, // no bath
        ];
        const col = rawPointsToColumnar(pts);
        expect(col.bathTemperatureC![1]).toBeNull();
    });

    it('handles empty array', () => {
        const col = rawPointsToColumnar([]);
        expect(col.timeSec).toHaveLength(0);
    });
});

// ── Round-trip fidelity ───────────────────────────────────────────────────────

describe('columnarToRawPoints ↔ rawPointsToColumnar round-trip', () => {
    it('preserves all numeric values (no bath)', () => {
        const original = makeColumnar(10, false);
        const pts = columnarToRawPoints(original);
        const restored = rawPointsToColumnar(pts);
        expect(restored.timeSec).toEqual(original.timeSec);
        expect(restored.viscosityCp).toEqual(original.viscosityCp);
        expect(restored.temperatureC).toEqual(original.temperatureC);
        expect(restored.shearRate).toEqual(original.shearRate);
        expect(restored.shearStress).toEqual(original.shearStress);
        expect(restored.pressureBar).toEqual(original.pressureBar);
        expect(restored.speedRpm).toEqual(original.speedRpm);
    });

    it('preserves bath temperature in round-trip', () => {
        const original = makeColumnar(5, true);
        const pts = columnarToRawPoints(original);
        const restored = rawPointsToColumnar(pts);
        expect(restored.bathTemperatureC).toBeDefined();
        expect(restored.bathTemperatureC).toEqual(original.bathTemperatureC);
    });
});

// ── tauriRawRecordsToColumnar ─────────────────────────────────────────────────

describe('tauriRawRecordsToColumnar()', () => {
    it('converts basic records with standard field names', () => {
        const records = [
            { time_sec: 0, viscosity_cp: 10, temperature_c: 50, shear_rate_s1: 1, shear_stress_pa: 2, pressure_bar: 0.5, speed_rpm: 3 },
            { time_sec: 10, viscosity_cp: 20, temperature_c: 51, shear_rate_s1: 2, shear_stress_pa: 4, pressure_bar: 0.8, speed_rpm: 6 },
        ];
        const col = tauriRawRecordsToColumnar(records);
        expect(col.timeSec).toEqual([0, 10]);
        expect(col.viscosityCp).toEqual([10, 20]);
        expect(col.shearRate).toEqual([1, 2]);
        expect(col.speedRpm).toEqual([3, 6]);
    });

    it('handles legacy shear_rate alias (instead of shear_rate_s1)', () => {
        const records = [{ time_sec: 0, viscosity_cp: 10, temperature_c: 50, shear_rate: 5.5, shear_stress_pa: 2, pressure_bar: 1, speed_rpm: 3 }];
        const col = tauriRawRecordsToColumnar(records);
        expect(col.shearRate[0]).toBe(5.5);
    });

    it('handles legacy rpm alias (instead of speed_rpm)', () => {
        const records = [{ time_sec: 0, viscosity_cp: 10, temperature_c: 50, shear_rate_s1: 1, shear_stress_pa: 2, pressure_bar: 1, rpm: 9.9 }];
        const col = tauriRawRecordsToColumnar(records);
        expect(col.speedRpm[0]).toBe(9.9);
    });

    it('handles legacy shear_stress alias', () => {
        const records = [{ time_sec: 0, viscosity_cp: 10, temperature_c: 50, shear_rate_s1: 1, shear_stress: 7.7, pressure_bar: 1, speed_rpm: 3 }];
        const col = tauriRawRecordsToColumnar(records);
        expect(col.shearStress[0]).toBe(7.7);
    });

    it('stores null when optional numeric fields are absent', () => {
        const records = [{ time_sec: 0, viscosity_cp: 10, temperature_c: 50 }];
        const col = tauriRawRecordsToColumnar(records);
        expect(col.shearRate[0]).toBeNull();
        expect(col.shearStress[0]).toBeNull();
        expect(col.pressureBar[0]).toBeNull();
        expect(col.speedRpm[0]).toBeNull();
    });

    it('coerces string numbers via Number()', () => {
        const records = [{ time_sec: '5', viscosity_cp: '200', temperature_c: '60', shear_rate_s1: '10', shear_stress_pa: '3', pressure_bar: '1', speed_rpm: '30' }];
        const col = tauriRawRecordsToColumnar(records as never);
        expect(col.timeSec[0]).toBe(5);
        expect(col.viscosityCp[0]).toBe(200);
    });

    it('includes bathTemperatureC only when at least one record has it', () => {
        const records = [
            { time_sec: 0, viscosity_cp: 1, temperature_c: 50, bath_temperature_c: 25 },
            { time_sec: 1, viscosity_cp: 2, temperature_c: 51 },
        ];
        const col = tauriRawRecordsToColumnar(records);
        expect(col.bathTemperatureC).toBeDefined();
        expect(col.bathTemperatureC![0]).toBe(25);
        expect(col.bathTemperatureC![1]).toBeNull();
    });

    it('omits bathTemperatureC when no record has it', () => {
        const records = [{ time_sec: 0, viscosity_cp: 1, temperature_c: 50 }];
        const col = tauriRawRecordsToColumnar(records);
        expect(col.bathTemperatureC).toBeUndefined();
    });

    it('handles empty array', () => {
        const col = tauriRawRecordsToColumnar([]);
        expect(col.timeSec).toHaveLength(0);
    });

    it('accepts camelCase records (legacy / WASM-parser shape)', () => {
        // Mirror of the Rust-side slow-path fix: before the alias fallback
        // was in place a record using camelCase keys would materialise as
        // all-zero columns and the chart drew a flat line at 0.
        const records = [
            { timeSec: 0,  viscosityCp: 800, temperatureC: 70, shearRate: 511, shearStress: 2, pressureBar: 1, speedRpm: 30 },
            { timeSec: 60, viscosityCp: 450, temperatureC: 70, shearRate: 511, shearStress: 2, pressureBar: 1, speedRpm: 30 },
        ];
        const col = tauriRawRecordsToColumnar(records);
        expect(col.timeSec).toEqual([0, 60]);
        expect(col.viscosityCp).toEqual([800, 450]);
        expect(col.temperatureC).toEqual([70, 70]);
        expect(col.shearRate).toEqual([511, 511]);
        expect(col.speedRpm).toEqual([30, 30]);
    });
});

// ── rawPointsFromParseResult ──────────────────────────────────────────────────

describe('rawPointsFromParseResult()', () => {
    it('returns [] for null input', () => {
        expect(rawPointsFromParseResult(null)).toEqual([]);
    });

    it('returns [] for undefined input', () => {
        expect(rawPointsFromParseResult(undefined)).toEqual([]);
    });

    it('returns [] when both data and columnarData are absent', () => {
        expect(rawPointsFromParseResult({})).toEqual([]);
    });

    it('returns rawPoints from data array when present', () => {
        const pts = makeRawPoints(3);
        const result = rawPointsFromParseResult({ data: pts });
        expect(result).toBe(pts); // same reference — no conversion
    });

    it('returns [] when data is present but empty', () => {
        // empty data → falls through to columnarData
        const col = makeColumnar(0);
        expect(rawPointsFromParseResult({ data: [], columnarData: col })).toEqual([]);
    });

    it('falls back to converting columnarData when data absent', () => {
        const col = makeColumnar(4);
        const result = rawPointsFromParseResult({ columnarData: col });
        expect(result).toHaveLength(4);
        expect(result[0].time_sec).toBe(col.timeSec[0]);
    });

    it('prefers data over columnarData when both present', () => {
        const pts = makeRawPoints(2);
        const col = makeColumnar(5); // different length — should not be used
        const result = rawPointsFromParseResult({ data: pts, columnarData: col });
        expect(result).toHaveLength(2);
        expect(result).toBe(pts);
    });
});

// ── Performance budget ────────────────────────────────────────────────────────

describe('performance', () => {
    it('round-trips 10k points in under 200ms', () => {
        const pts = makeRawPoints(10_000);
        const start = performance.now();
        const col = rawPointsToColumnar(pts);
        columnarToRawPoints(col);
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(200);
    });
});
