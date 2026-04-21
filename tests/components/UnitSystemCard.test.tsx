// @vitest-environment jsdom
/**
 * UI-018 — UnitSystemCard: single source of truth for viscosity units.
 *
 * The card writes directly to `chartSettings.lines.viscosity.unit`, which is
 * read by:
 *   - cycle-results-table (K', PV, YP, η@γ̇ headers & values)
 *   - ReportTab / ReportsPanel (derives Rust `unitSystem` enum)
 *   - RheologyChart Y-axis label
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import { UnitSystemCard } from '@/components/analysis/UnitSystemCard';
import { useChartSettingsStore } from '@/lib/store/chart-settings-store';

beforeEach(() => {
    // Reset viscosity unit to default before each test.
    act(() => {
        useChartSettingsStore.getState().setLineSettings('viscosity', { unit: 'mPa·s' });
    });
});

describe('UnitSystemCard', () => {
    it('renders three options and marks mPa·s as active by default', () => {
        render(<UnitSystemCard />);
        const si  = screen.getByRole('button', { name: /SI \(мПа·с\)/i });
        const pas = screen.getByRole('button', { name: /SI \(Па·с\)/i });
        const cp  = screen.getByRole('button', { name: /Imperial \(сП\)/i });
        expect(si.getAttribute('aria-pressed')).toBe('true');
        expect(pas.getAttribute('aria-pressed')).toBe('false');
        expect(cp.getAttribute('aria-pressed')).toBe('false');
    });

    it('switching to Pa·s writes to chart-settings store', () => {
        render(<UnitSystemCard />);
        fireEvent.click(screen.getByRole('button', { name: /SI \(Па·с\)/i }));
        expect(useChartSettingsStore.getState().settings.lines.viscosity.unit).toBe('Pa·s');
    });

    it('switching to Imperial (сП) writes to chart-settings store', () => {
        render(<UnitSystemCard />);
        fireEvent.click(screen.getByRole('button', { name: /Imperial \(сП\)/i }));
        expect(useChartSettingsStore.getState().settings.lines.viscosity.unit).toBe('cP');
    });

    it('visual active state follows the store', () => {
        render(<UnitSystemCard />);
        fireEvent.click(screen.getByRole('button', { name: /Imperial \(сП\)/i }));
        const cp  = screen.getByRole('button', { name: /Imperial \(сП\)/i });
        const si  = screen.getByRole('button', { name: /SI \(мПа·с\)/i });
        expect(cp.getAttribute('aria-pressed')).toBe('true');
        expect(si.getAttribute('aria-pressed')).toBe('false');
    });

    it('external store mutation propagates to the card UI', () => {
        render(<UnitSystemCard />);
        act(() => {
            useChartSettingsStore.getState().setLineSettings('viscosity', { unit: 'Pa·s' });
        });
        const pas = screen.getByRole('button', { name: /SI \(Па·с\)/i });
        expect(pas.getAttribute('aria-pressed')).toBe('true');
    });

    it('round-trip through all three units preserves the invariant', () => {
        render(<UnitSystemCard />);
        const btns = {
            si:  screen.getByRole('button', { name: /SI \(мПа·с\)/i }),
            pas: screen.getByRole('button', { name: /SI \(Па·с\)/i }),
            cp:  screen.getByRole('button', { name: /Imperial \(сП\)/i }),
        };
        fireEvent.click(btns.pas);
        expect(useChartSettingsStore.getState().settings.lines.viscosity.unit).toBe('Pa·s');
        fireEvent.click(btns.cp);
        expect(useChartSettingsStore.getState().settings.lines.viscosity.unit).toBe('cP');
        fireEvent.click(btns.si);
        expect(useChartSettingsStore.getState().settings.lines.viscosity.unit).toBe('mPa·s');
    });
});
