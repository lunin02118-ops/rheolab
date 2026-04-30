/**
 * Tests for src/components/charts/rheology-chart-uplot.tsx  (5B.4)
 *
 * Strategy: mock all custom hooks (data, visibility, sizing, options)
 * and the UPlotChart DOM sink so the component can run in jsdom.
 * Tests focus on the component's own branching logic (empty data guard,
 * stat cards, preview / captureMode wrappers, title display).
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RheologyChart } from '@/components/charts/rheology-chart-uplot';
import { DEFAULT_CHART_SETTINGS } from '@/lib/store/chart-settings-defaults';

// ── Mocks ─────────────────────────────────────────────────────────────────

vi.mock('@/components/charts/uplot-chart', () => ({
    UPlotChart: () => <div data-testid="MockUPlotChart" />,
}));

vi.mock('@/components/ui/collapsible-card', () => ({
    CollapsibleCard: ({ title, children }: { title: string; children: React.ReactNode }) => (
        <div>
            <span data-testid="CollapsibleCardTitle">{title}</span>
            {children}
        </div>
    ),
}));

vi.mock('@/components/ui/stat-card', () => ({
    StatCard: ({ label, value }: { label: string; value: string }) => (
        <div data-testid="StatCard">
            <span>{label}</span>
            <span>{value}</span>
        </div>
    ),
}));

vi.mock('@/components/ui/instrument-badges', () => ({
    InstrumentBadges: () => <div data-testid="MockInstrumentBadges" />,
}));

// Hook defaults (can be overridden per-test via mockReturnValue)
const mockVisibility = vi.fn();
const mockRheologyData = vi.fn();
const mockChartResize = vi.fn();
const mockChartOptions = vi.fn();

vi.mock('@/hooks/useRheologyVisibility', () => ({
    useRheologyVisibility: (...args: unknown[]) => mockVisibility(...args),
}));
vi.mock('@/hooks/useRheologyData', () => ({
    useRheologyData: (...args: unknown[]) => mockRheologyData(...args),
}));
vi.mock('@/hooks/useChartResize', () => ({
    useChartResize: (...args: unknown[]) => mockChartResize(...args),
}));
vi.mock('@/hooks/useRheologyChartOptions', () => ({
    useRheologyChartOptions: (...args: unknown[]) => mockChartOptions(...args),
}));

// ── Default mock return values ─────────────────────────────────────────────

function setupDefaults(
    hasData = true,
    visibilityOverrides: Partial<ReturnType<typeof mockVisibility>> = {},
) {
    mockVisibility.mockReturnValue({
        activeSettings: DEFAULT_CHART_SETTINGS,
        chartSettings: DEFAULT_CHART_SETTINGS,
        timeShiftEnabled: false,
        downsampleMode: 'auto',
        showTemperature: true,
        showShearRate: false,
        showPressure: false,
        showRpm: false,
        showBathTemperature: false,
        effectiveShearRateAxis: 'left',
        effectivePressureAxis: 'right',
        axisMode: 'dual',
        ...visibilityOverrides,
    });

    const timeArr = hasData ? [0, 10, 20] : [];
    mockRheologyData.mockReturnValue({
        uPlotData: [timeArr, [100, 105, 102], [25, 26, 25]],
        stats: hasData
            ? { maxVisc: 110, avgVisc: 102, avgTemp: 25, maxPressure: null, duration: 0.5 }
            : null,
        touchPoints: [],
    });

    mockChartResize.mockReturnValue({ width: 800, height: 400 });

    mockChartOptions.mockReturnValue({
        series: [
            {},
            { label: 'Вязкость', stroke: '#60a5fa', width: 2, show: true },
            { label: 'Температура', stroke: '#fb923c', width: 1.5, show: true },
        ],
    });
}

const baseData = [
    { time_sec: 0, viscosity_cp: 100, temperature_c: 25, speed_rpm: 300, shear_rate_s1: 511, shear_stress_pa: 51, bath_temperature_c: 25, pressure_bar: 0 },
    { time_sec: 10, viscosity_cp: 105, temperature_c: 26, speed_rpm: 300, shear_rate_s1: 511, shear_stress_pa: 54, bath_temperature_c: 25, pressure_bar: 0 },
];

// ── Tests ──────────────────────────────────────────────────────────────────

import React from 'react';

describe('RheologyChart', () => {
    beforeEach(() => {
        setupDefaults(true);
    });

    // ── empty data guard ────────────────────────────────────────────────────

    it('shows "Нет данных" when uPlotData has no time points', () => {
        setupDefaults(false);
        render(<RheologyChart data={[]} />);
        expect(screen.getByText(/Нет данных для отображения/i)).toBeDefined();
    });

    it('does not render UPlotChart when there is no data', () => {
        setupDefaults(false);
        render(<RheologyChart data={[]} />);
        expect(screen.queryByTestId('MockUPlotChart')).toBeNull();
    });

    // ── normal render ───────────────────────────────────────────────────────

    it('renders UPlotChart when data is present', () => {
        render(<RheologyChart data={baseData} />);
        expect(screen.getByTestId('MockUPlotChart')).toBeDefined();
    });

    it('renders stat cards when data is present', () => {
        render(<RheologyChart data={baseData} />);
        const cards = screen.getAllByTestId('StatCard');
        expect(cards.length).toBeGreaterThan(0);
        expect(screen.getByText('Макс. вязкость')).toBeDefined();
        expect(screen.getByText(/110.*mPa/)).toBeDefined();
    });

    it('renders custom title in CollapsibleCard', () => {
        render(<RheologyChart data={baseData} title="My Test Chart" />);
        expect(screen.getByTestId('CollapsibleCardTitle').textContent).toBe('My Test Chart');
    });

    it('falls back to default title when no title prop', () => {
        render(<RheologyChart data={baseData} />);
        expect(screen.getByTestId('CollapsibleCardTitle').textContent).toBe('График реологии');
    });

    // ── previewMode ─────────────────────────────────────────────────────────

    it('renders as previewMode wrapper with title', () => {
        render(<RheologyChart data={baseData} previewMode={true} title="Preview Chart" />);
        expect(screen.getByText('Preview Chart')).toBeDefined();
        // Should NOT use CollapsibleCard in previewMode
        expect(screen.queryByTestId('CollapsibleCardTitle')).toBeNull();
    });

    // ── stat cards hidden in captureMode ────────────────────────────────────

    it('does not render stat cards in captureMode', () => {
        render(<RheologyChart data={baseData} captureMode={true} />);
        expect(screen.queryByTestId('StatCard')).toBeNull();
    });

    it('passes zoom/reset viewport callbacks with source-second conversion', () => {
        setupDefaults(true, { timeShiftEnabled: true });
        const onViewportRangeChange = vi.fn();
        const onViewportReset = vi.fn();

        render(
            <RheologyChart
                data={baseData}
                viewportTimeOriginSec={30}
                onViewportRangeChange={onViewportRangeChange}
                onViewportReset={onViewportReset}
            />,
        );

        const optionsParams = mockChartOptions.mock.calls.at(-1)?.[0] as {
            onZoomRange?: (min: number, max: number) => void;
            onResetRange?: () => void;
        };

        optionsParams.onZoomRange?.(1, 2);
        expect(onViewportRangeChange).toHaveBeenCalledWith({ xMinSec: 90, xMaxSec: 150 });

        optionsParams.onResetRange?.();
        expect(onViewportReset).toHaveBeenCalledOnce();
    });
});
