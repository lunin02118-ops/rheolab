/**
 * Empty-state tests for Library and Comparison pages  (5B.6)
 *
 * These pages each render a specific empty-state UI when:
 *   - Library:    renders skeleton/tabs without experiments (ExperimentList handles its own empty)
 *   - Comparison: no experiments selected → shows "Добавить тест" button
 */
// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React, { Suspense } from 'react';

const libraryMocks = vi.hoisted(() => ({
    lastFiltersProps: null as null | {
        filters: Record<string, unknown>;
        onChange: (filters: Record<string, unknown>) => void;
    },
    lastListProps: null as null | {
        filters: Record<string, unknown>;
        viewMode: string;
    },
}));

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
        sessionId: 'test-session',
        activeTab: 'chart',
        setActiveTab: vi.fn(),
        viewport: null,
        setViewport: vi.fn(),
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
    ExperimentFilters: (props: {
        filters: Record<string, unknown>;
        onChange: (filters: Record<string, unknown>) => void;
    }) => {
        libraryMocks.lastFiltersProps = props;
        return (
            <button
                type="button"
                data-testid="MockExperimentFilters"
                onClick={() => props.onChange({
                    ...props.filters,
                    searchQuery: 'session search',
                    reagentNames: ['Guar'],
                    hasCrossing: 'yes',
                })}
            >
                {String(props.filters.searchQuery ?? '')}
            </button>
        );
    },
}));

vi.mock('@/components/library/experiment-list', () => ({
    ExperimentList: (props: {
        filters: Record<string, unknown>;
        viewMode: string;
    }) => {
        libraryMocks.lastListProps = props;
        return <div data-testid="MockExperimentList" />;
    },
}));

vi.mock('@/components/library/reagents-manager', () => ({
    ReagentsManager: () => <div data-testid="MockReagentsManager" />,
}));

describe('LibraryPage — initial render', () => {
    beforeEach(() => {
        sessionStorage.clear();
        localStorage.clear();
        libraryMocks.lastFiltersProps = null;
        libraryMocks.lastListProps = null;
    });

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

    it('restores library filters from sessionStorage', async () => {
        sessionStorage.setItem('rheolab-library-filters', JSON.stringify({
            searchQuery: 'saved query',
            reagentNames: ['Guar', 42],
            hasCrossing: 'yes',
        }));
        const { default: LibraryPage } = await import('@/app/dashboard/library/page');

        render(<LibraryPage />);

        expect(libraryMocks.lastFiltersProps?.filters.searchQuery).toBe('saved query');
        expect(libraryMocks.lastFiltersProps?.filters.reagentNames).toEqual(['Guar']);
        expect(libraryMocks.lastFiltersProps?.filters.hasCrossing).toBe('yes');
        expect(libraryMocks.lastListProps?.filters.searchQuery).toBe('saved query');
    });

    it('persists library filter changes for the current session', async () => {
        const { default: LibraryPage } = await import('@/app/dashboard/library/page');

        render(<LibraryPage />);
        fireEvent.click(screen.getByTestId('MockExperimentFilters'));

        const stored = JSON.parse(sessionStorage.getItem('rheolab-library-filters') ?? '{}');
        expect(stored.searchQuery).toBe('session search');
        expect(stored.reagentNames).toEqual(['Guar']);
        expect(stored.hasCrossing).toBe('yes');
    });

    it('keeps filters after leaving and returning to the library page', async () => {
        const { default: LibraryPage } = await import('@/app/dashboard/library/page');
        const first = render(<LibraryPage />);

        fireEvent.click(screen.getByTestId('MockExperimentFilters'));
        first.unmount();
        render(<LibraryPage />);

        expect(libraryMocks.lastFiltersProps?.filters.searchQuery).toBe('session search');
        expect(libraryMocks.lastListProps?.filters.searchQuery).toBe('session search');
    });
});
