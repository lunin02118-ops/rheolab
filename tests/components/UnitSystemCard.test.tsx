// @vitest-environment jsdom
/**
 * UI-018 — UnitSystemCard: preset-based unit system with per-parameter overrides.
 *
 * The card writes to `chartSettings.unitPreset` + `chartSettings.rheologyUnits`,
 * and syncs `chartSettings.lines.viscosity.unit` automatically.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { UnitSystemCard } from '@/components/analysis/UnitSystemCard';
import { useChartSettingsStore } from '@/lib/store/chart-settings-store';
import { METRIC_UNITS, IMPERIAL_UNITS } from '@/lib/store/chart-settings-defaults';

beforeEach(() => {
    act(() => {
        useChartSettingsStore.getState().applyUnitPreset('metric');
    });
});

describe('UnitSystemCard', () => {
    it('renders three preset buttons and marks Metric as active by default', () => {
        render(<UnitSystemCard />);
        const metric   = screen.getByRole('button', { name: /Метрический/i });
        const imperial = screen.getByRole('button', { name: /Имперский/i });
        const custom   = screen.getByRole('button', { name: /Ручная/i });
        expect(metric.getAttribute('aria-pressed')).toBe('true');
        expect(imperial.getAttribute('aria-pressed')).toBe('false');
        expect(custom.getAttribute('aria-pressed')).toBe('false');
    });

    it('switching to Imperial applies imperial units to store', () => {
        render(<UnitSystemCard />);
        fireEvent.click(screen.getByRole('button', { name: /Имперский/i }));
        const s = useChartSettingsStore.getState().settings;
        expect(s.unitPreset).toBe('imperial');
        expect(s.rheologyUnits.viscosity).toBe('cP');
        expect(s.rheologyUnits.temperature).toBe('°F');
        expect(s.rheologyUnits.pressure).toBe('psi');
        expect(s.lines.viscosity.unit).toBe('cP');
    });

    it('switching to Metric applies SI units to store', () => {
        render(<UnitSystemCard />);
        // First switch to imperial, then back to metric
        fireEvent.click(screen.getByRole('button', { name: /Имперский/i }));
        fireEvent.click(screen.getByRole('button', { name: /Метрический/i }));
        const s = useChartSettingsStore.getState().settings;
        expect(s.unitPreset).toBe('metric');
        expect(s.rheologyUnits.viscosity).toBe('mPa·s');
        expect(s.rheologyUnits.temperature).toBe('°C');
        expect(s.lines.viscosity.unit).toBe('mPa·s');
    });

    it('round-trip Metric → Imperial → Metric preserves units', () => {
        render(<UnitSystemCard />);
        fireEvent.click(screen.getByRole('button', { name: /Имперский/i }));
        expect(useChartSettingsStore.getState().settings.rheologyUnits).toEqual(IMPERIAL_UNITS);
        fireEvent.click(screen.getByRole('button', { name: /Метрический/i }));
        expect(useChartSettingsStore.getState().settings.rheologyUnits).toEqual(METRIC_UNITS);
    });

    it('external store mutation propagates to the card UI', () => {
        render(<UnitSystemCard />);
        act(() => {
            useChartSettingsStore.getState().applyUnitPreset('imperial');
        });
        const imperial = screen.getByRole('button', { name: /Имперский/i });
        expect(imperial.getAttribute('aria-pressed')).toBe('true');
    });

    it('timeFormat is included in preset units', () => {
        act(() => {
            useChartSettingsStore.getState().applyUnitPreset('metric');
        });
        expect(useChartSettingsStore.getState().settings.rheologyUnits.timeFormat).toBe('seconds');
        act(() => {
            useChartSettingsStore.getState().applyUnitPreset('imperial');
        });
        expect(useChartSettingsStore.getState().settings.rheologyUnits.timeFormat).toBe('minutes');
    });
});
