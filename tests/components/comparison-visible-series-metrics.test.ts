import { describe, expect, it } from 'vitest';
import {
    comparisonVisibleSeriesMetrics,
    normalizeComparisonSeriesMetrics,
} from '@/components/comparison/comparison-visible-series-metrics';

describe('comparisonVisibleSeriesMetrics', () => {
    it('normalizes UI metric keys to series API keys and skips none', () => {
        expect(normalizeComparisonSeriesMetrics([
            'viscosity_cp',
            'temperature_c',
            'none',
            'bath_temperature_c',
            'shear_stress_pa',
        ])).toEqual([
            'viscosityCp',
            'temperatureC',
            'bathTemperatureC',
            'shearStressPa',
        ]);
    });

    it('deduplicates repeated metrics without reordering the first visible slot', () => {
        expect(comparisonVisibleSeriesMetrics({
            primaryMetric: 'temperature_c',
            leftSecondaryMetric: 'temperatureC',
            secondaryMetric: 'viscosity_cp',
            tertiaryMetric: 'none',
        })).toEqual(['temperatureC', 'viscosityCp']);
    });

    it('adds minimal smart/touch support metrics only when requested', () => {
        expect(comparisonVisibleSeriesMetrics(
            {
                primaryMetric: 'viscosity_cp',
                leftSecondaryMetric: 'none',
                secondaryMetric: 'temperature_c',
                tertiaryMetric: 'none',
            },
            { includeSmartDownsampleSupport: true },
        )).toEqual(['viscosityCp', 'temperatureC', 'shearRate']);

        expect(comparisonVisibleSeriesMetrics(
            {
                primaryMetric: 'temperature_c',
                leftSecondaryMetric: 'none',
                secondaryMetric: 'none',
                tertiaryMetric: 'none',
            },
            { includeTouchPointSupport: true },
        )).toEqual(['temperatureC', 'viscosityCp', 'shearRate']);
    });

    it('falls back to viscosity when all visible slots are empty or unknown', () => {
        expect(comparisonVisibleSeriesMetrics({
            primaryMetric: 'none',
            leftSecondaryMetric: 'unsupported_metric',
            secondaryMetric: 'none',
            tertiaryMetric: 'none',
        })).toEqual(['viscosityCp']);
    });
});
