/**
 * Tests for src/hooks/chart-options/build-axes-series.ts
 *
 * Focus: right-axis label composition when bath temperature is on.
 *
 * Regression guard (2026-04-22): user reported that the right-axis title
 * read only "Температура (°C)" even when the bath-temperature line was
 * visible on that axis. Both the shared-axes and individual-axes branches
 * must surface the bath-temp name in the axis title so the legend on the
 * chart matches the series being drawn.
 */
import { describe, it, expect } from 'vitest';

import { buildAxes } from '@/hooks/chart-options/build-axes-series';
import { DEFAULT_CHART_SETTINGS } from '@/lib/store/chart-settings-defaults';
import { buildChartTranslations } from '@/hooks/chart-options/translations';

const t = buildChartTranslations({
    activeSettings: DEFAULT_CHART_SETTINGS,
    chartSettings: DEFAULT_CHART_SETTINGS,
    language: 'ru',
});

function getAxes(params: {
    isShared: boolean;
    showTemperature: boolean;
    showBathTemperature: boolean;
}) {
    return buildAxes({
        activeSettings: DEFAULT_CHART_SETTINGS,
        t,
        isDark: true,
        isShared: params.isShared,
        showTemperature: params.showTemperature,
        showBathTemperature: params.showBathTemperature,
        showShearRate: false,
        showPressure: false,
        showRpm: false,
        effectiveShearRateAxis: 'left',
        effectivePressureAxis: 'right',
        timeFmt: 'minutes',
    });
}

describe('buildAxes — right-axis title surfacing bath temperature', () => {
    // ── Individual-axes mode (default) ─────────────────────────────────────

    describe('individual-axes mode', () => {
        it('shows "Температура / Темп. бани (°C)" when both temperature and bath are on', () => {
            const axes = getAxes({ isShared: false, showTemperature: true, showBathTemperature: true });
            const tempAxis = axes.find((a) => a.scale === 'temperature');
            expect(tempAxis).toBeDefined();
            expect(tempAxis!.label).toBe('Температура / Темп. бани (°C)');
            expect(tempAxis!.show).toBe(true);
        });

        it('shows "Темп. бани (°C)" when only bath is on', () => {
            const axes = getAxes({ isShared: false, showTemperature: false, showBathTemperature: true });
            const tempAxis = axes.find((a) => a.scale === 'temperature');
            expect(tempAxis).toBeDefined();
            expect(tempAxis!.label).toBe('Темп. бани (°C)');
            expect(tempAxis!.show).toBe(true);   // axis must render to host the bath line
        });

        it('shows "Температура (°C)" when only sample temperature is on', () => {
            const axes = getAxes({ isShared: false, showTemperature: true, showBathTemperature: false });
            const tempAxis = axes.find((a) => a.scale === 'temperature');
            expect(tempAxis!.label).toBe('Температура (°C)');
            expect(tempAxis!.show).toBe(true);
        });

        it('hides the temperature axis when neither is on', () => {
            const axes = getAxes({ isShared: false, showTemperature: false, showBathTemperature: false });
            const tempAxis = axes.find((a) => a.scale === 'temperature');
            expect(tempAxis!.show).toBe(false);
        });
    });

    // ── Shared-axes mode ───────────────────────────────────────────────────

    describe('shared-axes mode', () => {
        it('includes "Темп. бани" in the right-axis label when only bath is on', () => {
            const axes = getAxes({ isShared: true, showTemperature: false, showBathTemperature: true });
            const rightAxis = axes.find((a) => a.scale === 'right');
            expect(rightAxis).toBeDefined();
            expect(rightAxis!.label).toContain('Темп. бани');
            expect(rightAxis!.show).toBe(true);
        });

        it('includes combined label when both temperature and bath are on', () => {
            const axes = getAxes({ isShared: true, showTemperature: true, showBathTemperature: true });
            const rightAxis = axes.find((a) => a.scale === 'right');
            expect(rightAxis!.label).toContain('Температура');
            expect(rightAxis!.label).toContain('Темп. бани');
        });

        it('shows only "Температура" when bath is off', () => {
            const axes = getAxes({ isShared: true, showTemperature: true, showBathTemperature: false });
            const rightAxis = axes.find((a) => a.scale === 'right');
            expect(rightAxis!.label).toContain('Температура');
            expect(rightAxis!.label).not.toContain('Темп. бани');
        });

        it('hides the right axis when both temperature and bath are off', () => {
            const axes = getAxes({ isShared: true, showTemperature: false, showBathTemperature: false });
            const rightAxis = axes.find((a) => a.scale === 'right');
            expect(rightAxis!.show).toBe(false);
        });
    });
});
