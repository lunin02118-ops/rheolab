/**
 * Empty-state tests for Library and Comparison pages  (5B.6)
 *
 * These pages each render a specific empty-state UI when:
 *   - Library:    renders skeleton/tabs without experiments (ExperimentList handles its own empty)
 *   - Comparison: no experiments selected → shows "Добавить тест" button
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React, { Suspense } from 'react';

// ════════════════════════════════════════════════════════════════════════════
// 1. Comparison Page — no experiments selected
// ════════════════════════════════════════════════════════════════════════════

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
        experiments: [],
        displaySettings,
        addExperiment: vi.fn().mockReturnValue(true),
        removeExperiment: vi.fn(),
        updateDisplaySettings: vi.fn(),
        getMaxExperiments: () => 6,
        isInComparison: () => false,
        rehydrateIfNeeded: vi.fn(),
        releaseHeavyData: vi.fn(),
        _hasHydrated: true,
    };
    const useComparisonStore = Object.assign(
        (selector: (s: unknown) => unknown) => selector(storeState),
        { getState: () => storeState }
    );
    return { useComparisonStore };
});

vi.mock('@/components/comparison/comparison-selector', () => ({
    ComparisonSelector: () => <div data-testid="MockComparisonSelector" />,
    clearComparisonSelectorCache: vi.fn(),
}));

vi.mock('@/components/comparison/comparison-chart-uplot', () => ({
    ComparisonChartUPlot: () => <div data-testid="MockComparisonChart" />,
}));

vi.mock('@/components/comparison/comparison-controls', () => ({
    AxisSelector: () => <div />,
    LegendToggle: () => <div />,
    ExperimentChip: () => <div />,
    ViscosityThresholdControl: () => <div />,
}));

describe('ComparisonPage — no experiments', () => {
    it('renders the comparison page root', async () => {
        const { default: ComparisonPage } = await import('@/app/dashboard/comparison/page');
        render(<ComparisonPage />);
        expect(screen.getByTestId('ComparisonPageRoot')).toBeDefined();
    });

    it('shows "Добавить тест" button when under the limit', async () => {
        const { default: ComparisonPage } = await import('@/app/dashboard/comparison/page');
        render(<ComparisonPage />);
        expect(screen.getByTestId('OpenExperimentSelectorButton')).toBeDefined();
        expect(screen.getByText(/Добавить тест/i)).toBeDefined();
    });

    it('shows 0/6 counter badge', async () => {
        const { default: ComparisonPage } = await import('@/app/dashboard/comparison/page');
        render(<ComparisonPage />);
        expect(screen.getByText('0/6')).toBeDefined();
    });

    it('does not show any ExperimentChip when list is empty', async () => {
        const { default: ComparisonPage } = await import('@/app/dashboard/comparison/page');
        render(<ComparisonPage />);
        // selected-experiments area should have no chips
        const chipsArea = screen.getByTestId('SelectedExperimentsChips');
        // No chip content besides the counter and add button
        expect(chipsArea.querySelectorAll('[data-testid="MockComparisonChip"]')).toHaveLength(0);
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Library Page — renders root
// ════════════════════════════════════════════════════════════════════════════

vi.mock('react-router-dom', () => ({
    useSearchParams: () => [new URLSearchParams()],
}));

vi.mock('@/components/library/experiment-filters', () => ({
    ExperimentFilters: () => <div data-testid="MockExperimentFilters" />,
}));

vi.mock('@/components/library/experiment-list', () => ({
    ExperimentList: () => <div data-testid="MockExperimentList" />,
}));

vi.mock('@/components/library/reagents-manager', () => ({
    ReagentsManager: () => <div data-testid="MockReagentsManager" />,
}));

describe('LibraryPage — initial render', () => {
    it('renders the library page root element', async () => {
        const { default: LibraryPage } = await import('@/app/dashboard/library/page');
        render(<LibraryPage />);
        expect(screen.getByTestId('LibraryPageRoot')).toBeDefined();
    });

    it('shows Experiments tab by default', async () => {
        const { default: LibraryPage } = await import('@/app/dashboard/library/page');
        render(
            <Suspense fallback={<div>loading</div>}>
                <LibraryPage />
            </Suspense>
        );
        expect(screen.getByTestId('ExperimentsTabButton')).toBeDefined();
        expect(screen.getByTestId('ReagentsTabButton')).toBeDefined();
    });

    it('renders ExperimentList in default experiments tab', async () => {
        const { default: LibraryPage } = await import('@/app/dashboard/library/page');
        render(<LibraryPage />);
        expect(screen.getByTestId('MockExperimentList')).toBeDefined();
    });
});
