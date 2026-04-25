/**
 * Tests for src/hooks/useRheologyData.ts
 *
 * Focus: bath-temperature null handling.
 *
 * When a parser merges two tables (e.g. OFITE 1100 Sweep Data + Log Data)
 * and only one of them carries `bath_temperature_c`, the resulting rows
 * have bath temperature on some indices and `undefined` / `null` on
 * others. The chart hook must emit `null` into the uPlot series so uPlot
 * renders a gap — NOT `0`, which would drag the orange dashed line down
 * to the X-axis at every missing point and look like a spurious cooling
 * event. See user-reported regression 2026-04-22.
 */
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRheologyData, type RheoPoint } from '@/hooks/useRheologyData';
import type { ColumnarData } from '@/types';

const baseUnits = {
    viscosityUnit: 'cP' as const,
    temperatureUnit: '°C' as const,
    bathTemperatureUnit: '°C' as const,
    pressureUnit: 'bar' as const,
};

function runHook(params: {
    data?: RheoPoint[];
    columnarData?: ColumnarData | null;
}) {
    return renderHook(() =>
        useRheologyData({
            data: params.data ?? [],
            columnarData: params.columnarData ?? null,
            timeShiftEnabled: false,
            downsampleMode: 'off',
            captureMode: false,
            pdfMode: false,
            showTouchPoints: false,
            viscosityThreshold: 50,
            showTargetTime: false,
            targetTime: 10,
            units: baseUnits,
        }),
    );
}

describe('useRheologyData — bath temperature null handling', () => {
    // ── AoS path (legacy, no columnarData) ─────────────────────────────────

    it('AoS: emits null into bathTemperatures when bath_temperature_c is undefined', () => {
        const data: RheoPoint[] = [
            { time_sec: 0,  viscosity_cp: 500, temperature_c: 100, bath_temperature_c: 110 },
            { time_sec: 60, viscosity_cp: 480, temperature_c: 101 /* no bath */ },
            { time_sec: 120, viscosity_cp: 470, temperature_c: 102, bath_temperature_c: 112 },
        ];
        const { result } = runHook({ data });
        const bathSeries = result.current.uPlotData[6] as Array<number | null>;
        expect(bathSeries).toHaveLength(3);
        expect(bathSeries[0]).toBe(110);
        expect(bathSeries[1]).toBeNull();   // ← regression guard: NOT 0
        expect(bathSeries[2]).toBe(112);
    });

    it('AoS: preserves 0 as a genuine measurement (bath_temperature_c = 0 is not a gap)', () => {
        const data: RheoPoint[] = [
            { time_sec: 0, viscosity_cp: 500, temperature_c: 25, bath_temperature_c: 0 },
        ];
        const { result } = runHook({ data });
        const bathSeries = result.current.uPlotData[6] as Array<number | null>;
        expect(bathSeries[0]).toBe(0);    // 0 °C is a valid reading, not a missing value
        expect(bathSeries[0]).not.toBeNull();
    });

    // ── Columnar path (preferred modern path) ──────────────────────────────

    it('columnar: emits null into bathTemperatures when bathTemperatureC[i] is null', () => {
        // Mimics the OFITE 1100 Sweep + Log merge:
        // row 0, 2 — Log Data rows with bath temp
        // row 1 — Sweep Data row, no bath temp
        const columnarData: ColumnarData = {
            timeSec: [0, 60, 120],
            viscosityCp: [500, 480, 470],
            temperatureC: [100, 101, 102],
            shearRate: [10, 10, 10],
            shearStress: [1, 1, 1],
            pressureBar: [1, 1, 1],
            speedRpm: [300, 300, 300],
            bathTemperatureC: [110, null, 112],
        };
        const { result } = runHook({ columnarData });
        const bathSeries = result.current.uPlotData[6] as Array<number | null>;
        expect(bathSeries).toHaveLength(3);
        expect(bathSeries[0]).toBe(110);
        expect(bathSeries[1]).toBeNull();   // ← regression guard: NOT 0
        expect(bathSeries[2]).toBe(112);
    });

    it('columnar: emits null for ALL points when bathTemperatureC array is absent', () => {
        const columnarData: ColumnarData = {
            timeSec: [0, 60, 120],
            viscosityCp: [500, 480, 470],
            temperatureC: [100, 101, 102],
            shearRate: [10, 10, 10],
            shearStress: [1, 1, 1],
            pressureBar: [1, 1, 1],
            speedRpm: [300, 300, 300],
            // no bathTemperatureC field at all
        };
        const { result } = runHook({ columnarData });
        const bathSeries = result.current.uPlotData[6] as Array<number | null>;
        expect(bathSeries).toHaveLength(3);
        expect(bathSeries.every((v) => v === null)).toBe(true);
    });

    it('columnar: converts bath temperature through the unit converter (°F)', () => {
        const columnarData: ColumnarData = {
            timeSec: [0],
            viscosityCp: [500],
            temperatureC: [100],
            shearRate: [10],
            shearStress: [1],
            pressureBar: [1],
            speedRpm: [300],
            bathTemperatureC: [100],  // 100 °C
        };
        const { result } = renderHook(() =>
            useRheologyData({
                data: [],
                columnarData,
                timeShiftEnabled: false,
                downsampleMode: 'off',
                captureMode: false,
                pdfMode: false,
                showTouchPoints: false,
                viscosityThreshold: 50,
                showTargetTime: false,
                targetTime: 10,
                units: { ...baseUnits, bathTemperatureUnit: '°F' },
            }),
        );
        const bathSeries = result.current.uPlotData[6] as Array<number | null>;
        expect(bathSeries[0]).toBe(212);   // 100 °C → 212 °F
    });
});
