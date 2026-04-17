/**
 * Unit tests — scale-name / axis-side / axis-label logic in ComparisonChartUPlot.
 *
 * The three helpers (getScaleName, getIsRight, getAxisLabel) live inside the
 * component's useMemo.  We replicate the same pure logic here so that:
 *  1. Regressions in the logic are caught without a DOM/canvas environment.
 *  2. The bath_temperature_c → temperature_c merge is explicitly documented.
 *
 * If the component logic changes these helpers must be updated here too.
 */

import { describe, it, expect } from 'vitest';
import { getStrokeDasharray } from '@/lib/store/chart-settings-store';

// ─── Mirror of the helpers in comparison-chart-uplot.tsx ──────────────────────
// Keep in sync with: src/components/comparison/comparison-chart-uplot.tsx

function getScaleName(
    metric: string,
    isShared: boolean,
    leftMetrics: string[],
): string {
    const canonical = metric === 'bath_temperature_c' ? 'temperature_c' : metric;
    if (isShared) return leftMetrics.includes(metric) ? 'left' : 'right';
    return canonical;
}

function getIsRight(
    metric: string,
    activeMetrics: string[],
    rightMetrics: string[],
    isShared: boolean,
    leftMetrics: string[],
): boolean {
    const sn = getScaleName(metric, isShared, leftMetrics);
    return activeMetrics.some(
        m => getScaleName(m, isShared, leftMetrics) === sn && rightMetrics.includes(m),
    );
}

function getAxisLabel(
    metric: string,
    activeMetrics: string[],
    isShared: boolean,
    leftMetrics: string[],
    metricLabels: Record<string, string>,
): string {
    const sn = getScaleName(metric, isShared, leftMetrics);
    const metricsOnScale = activeMetrics.filter(
        m => getScaleName(m, isShared, leftMetrics) === sn,
    );
    return metricsOnScale.map(m => metricLabels[m] || m).join(' / ');
}

// ─── Fixture labels (subset matching METRIC_LABELS in the component) ──────────
const LABELS: Record<string, string> = {
    viscosity_cp: 'Вязкость (сП)',
    temperature_c: 'Температура (°C)',
    bath_temperature_c: 'Темп. бани (°C)',
    shear_rate_s1: 'Скорость сдвига (1/с)',
    pressure_bar: 'Давление (бар)',
};

// ─── getScaleName ─────────────────────────────────────────────────────────────

describe('getScaleName', () => {
    describe('individual mode', () => {
        const isShared = false;
        const leftMetrics = ['viscosity_cp'];
        const _rightMetrics = ['temperature_c'];

        it('regular metric returns its own key', () => {
            expect(getScaleName('viscosity_cp', isShared, leftMetrics)).toBe('viscosity_cp');
            expect(getScaleName('temperature_c', isShared, leftMetrics)).toBe('temperature_c');
            expect(getScaleName('shear_rate_s1', isShared, leftMetrics)).toBe('shear_rate_s1');
        });

        it('bath_temperature_c always maps to temperature_c', () => {
            expect(getScaleName('bath_temperature_c', isShared, leftMetrics)).toBe('temperature_c');
        });

        it('bath_temperature_c returns temperature_c regardless of side position', () => {
            // bath on left side selectors
            const leftWithBath = ['viscosity_cp', 'bath_temperature_c'];
            expect(getScaleName('bath_temperature_c', isShared, leftWithBath)).toBe('temperature_c');
            // bath on right side selectors
            expect(getScaleName('bath_temperature_c', isShared, ['viscosity_cp'])).toBe('temperature_c');
        });
    });

    describe('shared mode', () => {
        const isShared = true;
        const leftMetrics = ['viscosity_cp', 'shear_rate_s1'];

        it('left-side metric returns "left"', () => {
            expect(getScaleName('viscosity_cp', isShared, leftMetrics)).toBe('left');
            expect(getScaleName('shear_rate_s1', isShared, leftMetrics)).toBe('left');
        });

        it('right-side metric returns "right"', () => {
            expect(getScaleName('temperature_c', isShared, leftMetrics)).toBe('right');
            expect(getScaleName('pressure_bar', isShared, leftMetrics)).toBe('right');
        });

        it('bath_temperature_c that is on right returns "right" (shared uses position, not canonical)', () => {
            // In shared mode the canonical mapping is NOT applied — side is by selector position
            const leftOnly = ['viscosity_cp'];
            expect(getScaleName('bath_temperature_c', isShared, leftOnly)).toBe('right');
        });

        it('bath_temperature_c placed on left returns "left" in shared mode', () => {
            const leftWithBath = ['viscosity_cp', 'bath_temperature_c'];
            expect(getScaleName('bath_temperature_c', isShared, leftWithBath)).toBe('left');
        });
    });
});

// ─── getIsRight ───────────────────────────────────────────────────────────────

describe('getIsRight', () => {
    const isShared = false;
    const leftMetrics = ['viscosity_cp'];

    it('metric in rightMetrics is on right', () => {
        const active = ['viscosity_cp', 'temperature_c'];
        const right = ['temperature_c'];
        expect(getIsRight('temperature_c', active, right, isShared, leftMetrics)).toBe(true);
    });

    it('metric in leftMetrics is not on right', () => {
        const active = ['viscosity_cp', 'temperature_c'];
        const right = ['temperature_c'];
        expect(getIsRight('viscosity_cp', active, right, isShared, leftMetrics)).toBe(false);
    });

    it('bath_temperature_c coerced to temperature_c scale — inherits temperature_c side', () => {
        // temperature_c is in rightMetrics, bath is in active but not explicitly in rightMetrics
        const active = ['viscosity_cp', 'temperature_c', 'bath_temperature_c'];
        const right = ['temperature_c'];
        // Both temperature_c and bath_temperature_c map to scale 'temperature_c',
        // and temperature_c is in rightMetrics → isRight = true for bath too
        expect(getIsRight('bath_temperature_c', active, right, isShared, leftMetrics)).toBe(true);
    });

    it('bath_temperature_c alone in active without temperature_c on right is not right', () => {
        const active = ['viscosity_cp', 'bath_temperature_c'];
        const right: string[] = []; // neither is in rightMetrics
        expect(getIsRight('bath_temperature_c', active, right, isShared, leftMetrics)).toBe(false);
    });

    it('bath_temperature_c in rightMetrics directly makes it right', () => {
        const active = ['viscosity_cp', 'bath_temperature_c'];
        const right = ['bath_temperature_c'];
        // bath maps to scale 'temperature_c'; bath IS in rightMetrics → isRight = true
        // (because getIsRight checks: any m where getScaleName(m)===sn AND m in rightMetrics)
        expect(getIsRight('bath_temperature_c', active, right, isShared, leftMetrics)).toBe(true);
    });
});

// ─── getAxisLabel ─────────────────────────────────────────────────────────────

describe('getAxisLabel', () => {
    const isShared = false;
    const leftMetrics = ['viscosity_cp'];

    it('single metric → label from METRIC_LABELS', () => {
        const active = ['viscosity_cp', 'temperature_c'];
        expect(getAxisLabel('viscosity_cp', active, isShared, leftMetrics, LABELS))
            .toBe('Вязкость (сП)');
        expect(getAxisLabel('temperature_c', active, isShared, leftMetrics, LABELS))
            .toBe('Температура (°C)');
    });

    it('temperature_c + bath_temperature_c share scale → combined label', () => {
        const active = ['viscosity_cp', 'temperature_c', 'bath_temperature_c'];
        // Both map to 'temperature_c' scale in individual mode
        const label = getAxisLabel('temperature_c', active, isShared, leftMetrics, LABELS);
        expect(label).toContain('Температура (°C)');
        expect(label).toContain('Темп. бани (°C)');
        expect(label).toBe('Температура (°C) / Темп. бани (°C)');
    });

    it('bath_temperature_c queried directly gives same combined label as temperature_c', () => {
        const active = ['viscosity_cp', 'temperature_c', 'bath_temperature_c'];
        const labelFromTemp = getAxisLabel('temperature_c', active, isShared, leftMetrics, LABELS);
        const labelFromBath = getAxisLabel('bath_temperature_c', active, isShared, leftMetrics, LABELS);
        expect(labelFromTemp).toBe(labelFromBath);
    });

    it('only bath_temperature_c active → label is bath only', () => {
        const active = ['viscosity_cp', 'bath_temperature_c'];
        const label = getAxisLabel('bath_temperature_c', active, isShared, leftMetrics, LABELS);
        expect(label).toBe('Темп. бани (°C)');
    });

    it('unknown metric falls back to metric key', () => {
        const active = ['viscosity_cp', 'shear_stress_pa'];
        const label = getAxisLabel('shear_stress_pa', active, isShared, leftMetrics, LABELS);
        expect(label).toBe('shear_stress_pa'); // not in LABELS → returns key
    });
});

// ─── getStrokeDasharray — used by comparison chart for line style ──────────────

describe('getStrokeDasharray (comparison chart usage)', () => {
    it('solid returns undefined (no dash)', () => {
        expect(getStrokeDasharray('solid')).toBeUndefined();
    });

    it('dashed returns "5 5"', () => {
        expect(getStrokeDasharray('dashed')).toBe('5 5');
    });

    it('dotted returns "2 2"', () => {
        expect(getStrokeDasharray('dotted')).toBe('2 2');
    });

    it('dash string can be split to number array (as done in component)', () => {
        const dashStr = getStrokeDasharray('dashed')!;
        const dashArray = dashStr.split(' ').map(Number);
        expect(dashArray).toEqual([5, 5]);
    });

    it('dotted dash string splits correctly', () => {
        const dashStr = getStrokeDasharray('dotted')!;
        expect(dashStr.split(' ').map(Number)).toEqual([2, 2]);
    });
});

// ─── Scale-merge regression: bath temperature never creates a separate axis ───

describe('bath_temperature_c axis merge regression', () => {
    it('in individual mode: bath and temp produce only one unique scale name', () => {
        const isShared = false;
        const leftMetrics = ['viscosity_cp'];
        const active = ['viscosity_cp', 'temperature_c', 'bath_temperature_c'];

        const scales = active.map(m => getScaleName(m, isShared, leftMetrics));
        const uniqueScales = new Set(scales);

        // viscosity_cp → 'viscosity_cp'
        // temperature_c → 'temperature_c'
        // bath_temperature_c → 'temperature_c'   (merged!)
        expect(uniqueScales.size).toBe(2); // viscosity_cp + temperature_c
        expect(uniqueScales.has('temperature_c')).toBe(true);
        expect(uniqueScales.has('bath_temperature_c')).toBe(false);
    });

    it('in shared mode: both temperatures on right produce one "right" scale', () => {
        const isShared = true;
        const leftMetrics = ['viscosity_cp'];
        const active = ['viscosity_cp', 'temperature_c', 'bath_temperature_c'];

        const rightScales = active
            .map(m => getScaleName(m, isShared, leftMetrics))
            .filter(s => s === 'right');
        // temperature_c → 'right', bath_temperature_c → 'right' (by selector position)
        expect(rightScales).toHaveLength(2); // two series map to right, but same scale name
    });
});
