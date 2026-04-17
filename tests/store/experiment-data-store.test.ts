import { describe, test, expect, beforeEach } from 'vitest';
import { useExperimentDataStore } from '@/lib/store/experiment-data-store';

// Mock persist middleware to avoid storage issues in tests
// In a real setup we might need to mock zustand/middleware/persist
// For now, we assume the store works in memory for tests

describe('ExperimentDataStore', () => {
    beforeEach(() => {
        useExperimentDataStore.getState().reset();
    });

    test('should update metadata', () => {
        const initialResult: any = {  
            success: true,
            data: [],
            metadata: { filename: 'test.xlsx', instrumentType: 'old' },
            summary: { pointCount: 0 }
        };

        useExperimentDataStore.getState().setParseResult(initialResult);

        useExperimentDataStore.getState().updateMetadata({ instrumentType: 'new' });

        const result = useExperimentDataStore.getState().parseResult;
        expect(result?.metadata.instrumentType).toBe('new');
        expect(result?.metadata.filename).toBe('test.xlsx');
    });

    test('should update geometry and recalculate RPM', () => {
        const initialData = [{
            viscosity_cp: 1000,
            shear_stress_pa: 100,
            shear_rate_s1: 100, // Consistent: 100 * 1000 / 1000 = 100
            speed_rpm: 10, // K = 10
            time_sec: 0,
            temperature_c: 25,
            pressure_bar: 0
        }];

        const initialResult: any = {  
            success: true,
            data: initialData,
            metadata: { filename: 'test.xlsx', geometry: 'R1B1' },
            summary: { pointCount: 1 }
        };

        useExperimentDataStore.getState().setParseResult(initialResult);

        // Change geometry to K=5. Since physics is consistent, RPM should update.
        // New RPM = SR / K = 100 / 5 = 20
        useExperimentDataStore.getState().updateGeometry('R1B2', 5);

        const result = useExperimentDataStore.getState().parseResult;
        expect(result?.metadata.geometry).toBe('R1B2');
        expect(result?.data[0].speed_rpm).toBe(20);
        expect(result?.data[0].shear_rate_s1).toBe(100); // SR should stay same
    });

    test('should normalize camelCase point payload in setParseResult', () => {
        const initialResult: any = {  
            success: true,
            data: [
                {
                    timeSec: 30,
                    viscosityCp: 250,
                    temperatureC: 27,
                    speedRpm: 180,
                    shearRateS1: 95,
                    shearStressPa: 18,
                    pressureBar: 0.12
                }
            ],
            metadata: { filename: 'test.xlsx' },
            summary: { pointCount: 1 }
        };

        useExperimentDataStore.getState().setParseResult(initialResult);

        const result = useExperimentDataStore.getState().parseResult;
        expect(result?.data[0]).toMatchObject({
            time_sec: 30,
            viscosity_cp: 250,
            temperature_c: 27,
            speed_rpm: 180,
            shear_rate_s1: 95,
            shear_stress_pa: 18,
            pressure_bar: 0.12
        });
    });

    // ── normalizePoint edge cases ─────────────────────────────────────────

    test('normalizePoint coerces NaN to 0 for required numeric fields', () => {
        const result: any = {
            success: true,
            data: [{ time_sec: NaN, viscosity_cp: NaN, temperature_c: NaN, speed_rpm: NaN, shear_rate_s1: NaN, shear_stress_pa: NaN, pressure_bar: NaN }],
            metadata: { filename: 'test.xlsx' },
            summary: { pointCount: 1 },
        };
        useExperimentDataStore.getState().setParseResult(result);
        const pt = useExperimentDataStore.getState().parseResult?.data[0];
        expect(pt?.time_sec).toBe(0);
        expect(pt?.viscosity_cp).toBe(0);
        expect(pt?.temperature_c).toBe(0);
    });

    test('normalizePoint coerces string numbers to Number', () => {
        const result: any = {
            success: true,
            data: [{ time_sec: '10', viscosity_cp: '250.5', temperature_c: '65', speed_rpm: '200', shear_rate_s1: '50', shear_stress_pa: '12', pressure_bar: '1.5' }],
            metadata: { filename: 'test.xlsx' },
            summary: { pointCount: 1 },
        };
        useExperimentDataStore.getState().setParseResult(result);
        const pt = useExperimentDataStore.getState().parseResult?.data[0];
        expect(pt?.time_sec).toBe(10);
        expect(pt?.viscosity_cp).toBe(250.5);
    });

    test('normalizePoint handles null/undefined fields gracefully (uses 0)', () => {
        const result: any = {
            success: true,
            data: [{ time_sec: null, viscosity_cp: undefined, temperature_c: 50, speed_rpm: null, shear_rate_s1: undefined, shear_stress_pa: null, pressure_bar: undefined }],
            metadata: { filename: 'test.xlsx' },
            summary: { pointCount: 1 },
        };
        useExperimentDataStore.getState().setParseResult(result);
        const pt = useExperimentDataStore.getState().parseResult?.data[0];
        expect(pt?.time_sec).toBe(0);
        expect(pt?.viscosity_cp).toBe(0);
        expect(pt?.temperature_c).toBe(50);
    });

    test('normalizePoint uses snake_case key priority over camelCase', () => {
        // When both exist, snake_case should win (first in lookup list)
        const result: any = {
            success: true,
            data: [{ time_sec: 99, timeSec: 11, viscosity_cp: 300, viscosityCp: 100, temperature_c: 60, temperatureC: 20, speed_rpm: 5, shear_rate_s1: 10, shear_stress_pa: 3, pressure_bar: 1 }],
            metadata: { filename: 'test.xlsx' },
            summary: { pointCount: 1 },
        };
        useExperimentDataStore.getState().setParseResult(result);
        const pt = useExperimentDataStore.getState().parseResult?.data[0];
        expect(pt?.time_sec).toBe(99);
        expect(pt?.viscosity_cp).toBe(300);
    });

    test('normalizePoint does not include bath_temperature_c when absent', () => {
        const result: any = {
            success: true,
            data: [{ time_sec: 0, viscosity_cp: 10, temperature_c: 50, speed_rpm: 1, shear_rate_s1: 1, shear_stress_pa: 1, pressure_bar: 1 }],
            metadata: { filename: 'test.xlsx' },
            summary: { pointCount: 1 },
        };
        useExperimentDataStore.getState().setParseResult(result);
        const pt = useExperimentDataStore.getState().parseResult?.data[0];
        expect(pt?.bath_temperature_c).toBeUndefined();
    });

    test('normalizePoint includes bath_temperature_c when present', () => {
        const result: any = {
            success: true,
            data: [{ time_sec: 0, viscosity_cp: 10, temperature_c: 50, speed_rpm: 1, shear_rate_s1: 1, shear_stress_pa: 1, pressure_bar: 1, bath_temperature_c: 25.5 }],
            metadata: { filename: 'test.xlsx' },
            summary: { pointCount: 1 },
        };
        useExperimentDataStore.getState().setParseResult(result);
        const pt = useExperimentDataStore.getState().parseResult?.data[0];
        expect(pt?.bath_temperature_c).toBe(25.5);
    });

    test('normalizeData handles non-array input gracefully', () => {
        const result: any = {
            success: true,
            data: 'not-an-array',
            metadata: { filename: 'test.xlsx' },
            summary: { pointCount: 0 },
        };
        useExperimentDataStore.getState().setParseResult(result);
        expect(useExperimentDataStore.getState().parseResult?.data).toEqual([]);
    });

    // ── reset() snapshot ──────────────────────────────────────────────────

    test('reset() returns all state to initial values', () => {
        // Set up some state
        useExperimentDataStore.getState().setIsLoading(true);
        useExperimentDataStore.getState().setError('some error');
        useExperimentDataStore.getState().setWaterSource('River');
        useExperimentDataStore.getState().setRecipe([{ abbreviation: 'KCl', concentration: 5, unit: 'g/L' }]);

        // Reset
        useExperimentDataStore.getState().reset();
        const s = useExperimentDataStore.getState();

        expect(s.parseResult).toBeNull();
        expect(s.isLoading).toBe(false);
        expect(s.error).toBeNull();
        expect(s.recipe).toEqual([]);
        expect(s.waterSource).toBe('');
    });

    // ── setError / setIsLoading ───────────────────────────────────────────

    test('setError stores the error message', () => {
        useExperimentDataStore.getState().setError('parse failed');
        expect(useExperimentDataStore.getState().error).toBe('parse failed');
    });

    test('setError(null) clears the error', () => {
        useExperimentDataStore.getState().setError('fail');
        useExperimentDataStore.getState().setError(null);
        expect(useExperimentDataStore.getState().error).toBeNull();
    });

    test('setIsLoading toggles loading state', () => {
        useExperimentDataStore.getState().setIsLoading(true);
        expect(useExperimentDataStore.getState().isLoading).toBe(true);
        useExperimentDataStore.getState().setIsLoading(false);
        expect(useExperimentDataStore.getState().isLoading).toBe(false);
    });

    // ── setCycleOverrides ─────────────────────────────────────────────────

    test('setCycleOverrides accepts a Map directly', () => {
        const map = new Map([[1, [0, 30]], [2, [30, 60]]]);
        useExperimentDataStore.getState().setCycleOverrides(map);
        const overrides = useExperimentDataStore.getState().cycleOverrides;
        expect(overrides.get(1)).toEqual([0, 30]);
        expect(overrides.get(2)).toEqual([30, 60]);
    });

    test('setCycleOverrides accepts an updater function', () => {
        const initial = new Map([[1, [0, 30]]]);
        useExperimentDataStore.getState().setCycleOverrides(initial);
        useExperimentDataStore.getState().setCycleOverrides((prev) => {
            const next = new Map(prev);
            next.set(2, [30, 60]);
            return next;
        });
        expect(useExperimentDataStore.getState().cycleOverrides.size).toBe(2);
    });

    // ── setPatternOverride ────────────────────────────────────────────────

    test('setPatternOverride stores pattern', () => {
        useExperimentDataStore.getState().setPatternOverride([1, 2, 3, 1]);
        expect(useExperimentDataStore.getState().patternOverride).toEqual([1, 2, 3, 1]);
    });

    test('setPatternOverride(null) clears pattern', () => {
        useExperimentDataStore.getState().setPatternOverride([1, 2]);
        useExperimentDataStore.getState().setPatternOverride(null);
        expect(useExperimentDataStore.getState().patternOverride).toBeNull();
    });
});
