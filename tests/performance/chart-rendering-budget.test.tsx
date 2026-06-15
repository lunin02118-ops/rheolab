// @vitest-environment jsdom
/**
 * W5-02 PERF — chart rendering budget phase 1.
 *
 * Guards the chart hot path against avoidable React/uPlot churn:
 * stable inputs should keep the prepared uPlot data, series, axes, and
 * touch-point arrays referentially stable across parent rerenders.
 */
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/theme-context', () => ({
    useTheme: () => ({ resolvedTheme: 'light' }),
}));

import { useComparisonChartData } from '@/components/comparison/useComparisonChartData';

const comparisonExperiments = [
    {
        id: 'exp-alpha',
        name: 'Alpha',
        columnarData: {
            timeSec: [0, 60, 120],
            viscosityCp: [100, 120, 130],
            temperatureC: [25, 26, 27],
            shearRate: [511, 511, 511],
            shearStress: [50, 52, 53],
            pressureBar: [1, 1, 1],
            speedRpm: [300, 300, 300],
        },
    },
];

const params = {
    debouncedExperiments: comparisonExperiments as never,
    primaryMetric: 'viscosity_cp',
    leftSecondaryMetric: 'none',
    secondaryMetric: 'temperature_c',
    tertiaryMetric: 'none',
    showTouchPoints: false,
    viscosityThreshold: 200,
    showTargetTime: false,
    targetTime: 10,
    comparisonAxisMode: 'individual',
};

describe('W5-02 chart rendering budget', () => {
    it('keeps prepared comparison series references stable for unchanged inputs', () => {
        const { result, rerender } = renderHook(() => useComparisonChartData(params));
        const first = result.current;

        rerender();

        expect(result.current).toBe(first);
        expect(result.current.uPlotData).toBe(first.uPlotData);
        expect(result.current.seriesConfig).toBe(first.seriesConfig);
        expect(result.current.axesConfig).toBe(first.axesConfig);
        expect(result.current.touchPoints).toBe(first.touchPoints);
    });
});
