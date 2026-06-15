// @vitest-environment jsdom
/**
 * W5-01 PERF — store selector audit guards.
 *
 * These tests pin the intended selector granularity for hot report/chart
 * surfaces. They should not re-render when unrelated chart settings mutate.
 */
import React, { Profiler } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/theme-context', () => ({
    useTheme: () => ({ resolvedTheme: 'light' }),
}));

import { RawDataTable } from '@/components/dashboard/raw-data-table';
import { useComparisonChartData } from '@/components/comparison/useComparisonChartData';
import { useChartSettingsStore } from '@/lib/store/chart-settings-store';

const rawRows = [
    {
        time_sec: 0,
        viscosity_cp: 100,
        temperature_c: 25,
        speed_rpm: 300,
        shear_rate_s1: 511,
        shear_stress_pa: 50,
        pressure_bar: 1,
        bath_temperature_c: 25,
    },
    {
        time_sec: 60,
        viscosity_cp: 120,
        temperature_c: 26,
        speed_rpm: 300,
        shear_rate_s1: 511,
        shear_stress_pa: 52,
        pressure_bar: 1,
        bath_temperature_c: 26,
    },
];

const comparisonExperiments = [
    {
        id: 'exp-alpha',
        name: 'Alpha',
        columnarData: {
            timeSec: [0, 60],
            viscosityCp: [100, 120],
            temperatureC: [25, 26],
            shearRate: [511, 511],
            shearStress: [50, 52],
            pressureBar: [1, 1],
            speedRpm: [300, 300],
        },
    },
];

const comparisonParams = {
    debouncedExperiments: comparisonExperiments as never,
    primaryMetric: 'viscosity_cp',
    leftSecondaryMetric: 'none',
    secondaryMetric: 'none',
    tertiaryMetric: 'none',
    showTouchPoints: false,
    viscosityThreshold: 200,
    showTargetTime: false,
    targetTime: 10,
    comparisonAxisMode: 'individual',
};

describe('W5-01 store selector audit', () => {
    beforeEach(() => {
        act(() => {
            useChartSettingsStore.getState().resetToDefaults();
        });
    });

    it('raw data table ignores unrelated line setting mutations', () => {
        let renders = 0;
        render(
            <Profiler id="RawDataTable" onRender={() => { renders++; }}>
                <RawDataTable data={rawRows} pageSize={25} />
            </Profiler>,
        );
        renders = 0;

        act(() => {
            useChartSettingsStore.getState().setLineSettings('viscosity', { width: 3 });
        });

        expect(renders).toBe(0);
    });

    it('comparison chart data ignores precision-only mutations', () => {
        let renders = 0;
        const { result } = renderHook(() => {
            renders++;
            return useComparisonChartData(comparisonParams);
        });
        const initialResult = result.current;
        renders = 0;

        act(() => {
            useChartSettingsStore.getState().setPrecision({ viscosity: 3 });
        });

        expect(renders).toBe(0);
        expect(result.current).toBe(initialResult);
    });
});
