// @vitest-environment jsdom
/**
 * UI-018 PERF — ReportTab re-render guard.
 *
 * Regression guard for React #185 ("Maximum update depth exceeded"), which
 * was triggered by `useBrandingStore(s => ({...}))` returning a fresh object
 * on every render.  The fix is `useShallow` around every object-returning
 * Zustand selector inside ReportTab.
 *
 * This test counts how many times ReportTab renders when:
 *   (a) it's first mounted (should be bounded, not thousands)
 *   (b) an unrelated Zustand store mutates (should be 0 extra renders)
 *   (c) the viscosity unit (the one field ReportTab actually reads) mutates
 *       (should be exactly 1 extra render batch)
 *
 * If any selector inside ReportTab loses its `useShallow` wrapper, test (a)
 * or test (b) will explode into thousands of renders and fail the < 50 bound.
 */
import React, { Profiler } from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock useLicense to avoid pulling in the full license resolver.
vi.mock('@/hooks/useLicense', () => ({
    useLicense: () => ({ result: null, isInitialized: true }),
}));

// Mock useReportExport — ReportTab only needs its shape, not its behaviour.
vi.mock('@/components/reports/hooks/useReportExport', () => ({
    useReportExport: () => ({
        isExporting: false,
        isExcelExporting: false,
        exportError: null,
        clearError: vi.fn(),
        handleDownload: vi.fn(),
        handleExcelDownload: vi.fn(),
    }),
}));

import { ReportTab } from '@/components/analysis/ReportTab';
import { UIModeProvider } from '@/contexts/ui-mode-context';
import { useChartSettingsStore } from '@/lib/store/chart-settings-store';
import { useBrandingStore } from '@/lib/store/branding-store';

const mockParseResult = {
    metadata: {
        filename: 'perf-test.xlsx',
        instrumentType: 'Grace' as const,
        testDate: new Date('2026-01-01'),
        fluidType: 'mud' as const,
        testGroup: 'A' as const,
        geometry: 'R1B5',
        geometrySource: 'parsed' as const,
    },
    columnarData: {
        time_s: new Float64Array([0, 10]),
        viscosity_cp: new Float64Array([100, 105]),
        temperature_c: new Float64Array([25, 26]),
        speed_rpm: new Float64Array([300, 300]),
        shear_rate_s1: new Float64Array([511, 511]),
        shear_stress_pa: new Float64Array([51, 54]),
        bath_temperature_c: new Float64Array([25, 25]),
        pressure_bar: new Float64Array([0, 0]),
    },
    warnings: [],
};

beforeEach(() => {
    // Reset stores so each test starts from a clean baseline.
    act(() => {
        useChartSettingsStore.getState().setLineSettings('viscosity', { unit: 'mPa·s' });
    });
});

function renderReportTab() {
    let count = 0;
    const onRender = () => { count++; };
    render(
        <UIModeProvider>
            <Profiler id="ReportTab" onRender={onRender}>
                <ReportTab
                    parseResult={mockParseResult as never}
                    editedRecipe={[]}
                    editedWaterParams={null}
                    editedWaterSource=""
                    cycleResults={new Map()}
                    cycles={[]}
                />
            </Profiler>
        </UIModeProvider>
    );
    return {
        getCount: () => count,
        resetCount: () => { count = 0; },
    };
}

describe('UI-018 PERF — ReportTab re-render guard', () => {
    it('initial mount renders a bounded number of times (no React #185)', () => {
        const { getCount } = renderReportTab();
        // 1–3 renders is normal (React 19 Strict/Suspense).  50 is a
        // comfortable ceiling that would still catch an infinite loop.
        expect(getCount()).toBeGreaterThan(0);
        expect(getCount()).toBeLessThan(50);
    });

    it('unrelated branding field mutation does NOT re-render ReportTab unboundedly', () => {
        const { getCount, resetCount } = renderReportTab();
        resetCount();

        // setCompanyName mutates a field that ReportTab reads via useShallow.
        // The expected delta is 1 batched render. > 10 would indicate a
        // selector regression.
        act(() => {
            useBrandingStore.getState().setCompanyName('Another Name Co.');
        });

        expect(getCount()).toBeLessThan(10);
    });

    it('viscosity unit change triggers a bounded re-render (single source of truth)', () => {
        const { getCount, resetCount } = renderReportTab();
        resetCount();

        act(() => {
            useChartSettingsStore.getState().setLineSettings('viscosity', { unit: 'Pa·s' });
        });

        // Bounded delta — any infinite loop would blow past this ceiling.
        expect(getCount()).toBeLessThan(10);
    });
});
