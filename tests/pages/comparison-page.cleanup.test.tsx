// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const releaseHeavyData = vi.fn();
const rehydrateIfNeeded = vi.fn().mockResolvedValue(undefined);
const updateDisplaySettings = vi.fn();
const addExperiment = vi.fn().mockReturnValue(true);
const removeExperiment = vi.fn();

vi.mock('@/lib/store/comparison-store', () => {
    const displaySettings = {
        primaryMetric: 'viscosity_cp',
        leftSecondaryMetric: 'none',
        secondaryMetric: 'temperature_c',
        tertiaryMetric: 'none',
        showLegend: true,
        showControls: false,
        showTouchPoints: false,
        viscosityThreshold: 200,
        showTargetTime: true,
        targetTime: 10,
    };

    const storeState = {
        experiments: [
            {
                id: 'exp-db-1',
                name: 'Stored experiment',
                rawPoints: [],
                columnarData: { timeSec: [0, 1], viscosityCp: [10, 11] },
            },
        ],
        displaySettings,
        addExperiment,
        removeExperiment,
        updateDisplaySettings,
        getMaxExperiments: () => 6,
        isInComparison: () => false,
        rehydrateIfNeeded,
        releaseHeavyData,
        _hasHydrated: true,
    };

    const useComparisonStore = Object.assign(
        (selector: (s: typeof storeState) => unknown) => selector(storeState),
        {
            getState: () => storeState,
            setState: (patch: Partial<typeof storeState>) => Object.assign(storeState, patch),
        },
    );

    return { useComparisonStore };
});

vi.mock('@/components/comparison/comparison-selector', () => ({
    ComparisonSelector: () => null,
}));

vi.mock('@/components/comparison/comparison-chart-uplot', () => ({
    ComparisonChartUPlot: () => <div data-testid="MockComparisonChart" />,
}));

vi.mock('@/components/comparison/comparison-controls', () => ({
    AxisSelector: () => null,
    LegendToggle: () => null,
    ExperimentChip: ({ name }: { name: string }) => <div>{name}</div>,
    ViscosityThresholdControl: () => null,
}));

describe('ComparisonPage cleanup', () => {
    beforeEach(() => {
        releaseHeavyData.mockClear();
        rehydrateIfNeeded.mockClear();
        updateDisplaySettings.mockClear();
        addExperiment.mockClear();
        removeExperiment.mockClear();
    });

    it('releases heavy comparison data on unmount', async () => {
        const { default: ComparisonPage } = await import('@/app/dashboard/comparison/page');
        const { unmount } = render(<ComparisonPage />);

        unmount();

        expect(releaseHeavyData).toHaveBeenCalledTimes(1);
    });
});
