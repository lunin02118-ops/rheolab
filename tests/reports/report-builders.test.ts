/**
 * Tests for src/lib/reports/report-builders.ts
 * Pure data-mapping helpers for PDF and Excel report generation.
 */
import { describe, it, expect } from 'vitest';
import { mapRawData, mapCycleResults } from '@/lib/reports/report-builders';
import type { GraceCycleResult } from '@/lib/analysis/types';

// ── mapRawData ─────────────────────────────────────────────────────────────

describe('mapRawData', () => {
    it('returns empty array for empty input', () => {
        expect(mapRawData([])).toEqual([]);
    });

    it('maps time_sec correctly', () => {
        const result = mapRawData([{
            time_sec: 120, viscosity_cp: 100, temperature_c: 25,
            shear_rate_s1: 50, shear_stress_pa: 5, speed_rpm: 60, pressure_bar: 1,
        }]);
        expect(result[0].time_sec).toBe(120);
    });

    it('maps shear_rate_s1 to both shear_rate and shear_stress fields', () => {
        const result = mapRawData([{
            time_sec: 0, viscosity_cp: 50, temperature_c: 25,
            shear_rate_s1: 75, shear_stress_pa: 7.5, speed_rpm: 90, pressure_bar: 0,
        }]);
        expect(result[0].shear_rate).toBe(75);
    });

    it('maps shear_stress_pa to shear_stress_pa and shear_stress', () => {
        const result = mapRawData([{
            time_sec: 0, viscosity_cp: 50, temperature_c: 25,
            shear_rate_s1: 50, shear_stress_pa: 4.5, speed_rpm: 60, pressure_bar: 0,
        }]);
        expect(result[0].shear_stress_pa).toBe(4.5);
        expect(result[0].shear_stress).toBe(4.5);
    });

    it('maps pressure_bar', () => {
        const result = mapRawData([{
            time_sec: 0, viscosity_cp: 50, temperature_c: 25,
            shear_rate_s1: 50, shear_stress_pa: 0, speed_rpm: 0, pressure_bar: 2.5,
        }]);
        expect(result[0].pressure_bar).toBe(2.5);
    });

    it('maps optional bath_temperature_c', () => {
        const result = mapRawData([{
            time_sec: 0, viscosity_cp: 50, temperature_c: 25,
            shear_rate_s1: 50, shear_stress_pa: 0, speed_rpm: 0, pressure_bar: 0,
            bath_temperature_c: 60,
        }]);
        expect(result[0].bath_temperature_c).toBe(60);
    });

    it('preserves length for multi-row input', () => {
        const rows = [
            { time_sec: 0, viscosity_cp: 50, temperature_c: 25, shear_rate_s1: 0, shear_stress_pa: 0, speed_rpm: 0, pressure_bar: 0 },
            { time_sec: 60, viscosity_cp: 80, temperature_c: 26, shear_rate_s1: 50, shear_stress_pa: 5, speed_rpm: 60, pressure_bar: 0 },
            { time_sec: 120, viscosity_cp: 120, temperature_c: 27, shear_rate_s1: 100, shear_stress_pa: 10, speed_rpm: 120, pressure_bar: 0.5 },
        ];
        expect(mapRawData(rows)).toHaveLength(3);
    });
});

// ── mapCycleResults ────────────────────────────────────────────────────────

describe('mapCycleResults', () => {
    it('returns empty array for empty map', () => {
        expect(mapCycleResults(new Map())).toEqual([]);
    });

    function makeGrace(overrides: Partial<GraceCycleResult> = {}): GraceCycleResult {
        return {
            cycleNo: 1,
            timeMin: 0,
            endTimeMin: 30,
            timeSec: 0,
            tempC: 25,
            pressure_bar: 1,
            n_prime: 0.8,
            Kv_PaSn: 0,
            K_prime_PaSn: 0.05,
            K_prime_slot_PaSn: 0,
            K_pipe_PaSn: 0,
            r2: 0.99,
            viscosities: { 40: 50, 100: 40, 170: 35 },
            bingham_PV_PaS: 0,
            bingham_YP_Pa: 0,
            bingham_r2: 0,
            calcPoints: 0,
            ...overrides,
        };
    }

    it('maps cycleNo', () => {
        const result = mapCycleResults(new Map([[1, makeGrace({ cycleNo: 1 })]]));
        expect(result[0].cycleNo).toBe(1);
    });

    it('maps n_prime to nPrime', () => {
        const result = mapCycleResults(new Map([[1, makeGrace({ n_prime: 0.75 })]]));
        expect(result[0].nPrime).toBe(0.75);
    });

    it('maps K_prime_PaSn to kPrime', () => {
        const result = mapCycleResults(new Map([[1, makeGrace({ K_prime_PaSn: 0.04 })]]));
        expect(result[0].kPrime).toBe(0.04);
    });

    it('maps r2', () => {
        const result = mapCycleResults(new Map([[1, makeGrace({ r2: 0.95 })]]));
        expect(result[0].r2).toBe(0.95);
    });

    it('maps viscosities map', () => {
        const result = mapCycleResults(new Map([[1, makeGrace({ viscosities: { 40: 60, 100: 45 } })]]));
        expect(result[0].viscosities[40]).toBe(60);
        expect(result[0].viscosities[100]).toBe(45);
    });

    it('maps multiple cycle results', () => {
        const map = new Map([
            [1, makeGrace({ cycleNo: 1 })],
            [2, makeGrace({ cycleNo: 2 })],
        ]);
        expect(mapCycleResults(map)).toHaveLength(2);
    });

    it('uses timeMin from endTimeMin when timeMin is absent', () => {
        const result = mapCycleResults(new Map([[1, makeGrace({ endTimeMin: 45 })]]));
        expect(result[0].timeMin).toBe(45);
    });

    it('maps tempC', () => {
        const result = mapCycleResults(new Map([[1, makeGrace({ tempC: 80 })]]));
        expect(result[0].tempC).toBe(80);
    });
});
