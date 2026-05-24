/**
 * Tests for src/components/dashboard/DashboardContent.tsx  (5B.3)
 *
 * DashboardContent is a pure-props component that renders the analysis
 * results panel: tabs (chart / table / recipe / water / calibration),
 * a save button, instrument / geometry selectors, and the results table.
 *
 * Strategy: mock the heavy chart/table children and the useLicense hook;
 * drive everything through explicit props.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DashboardContent } from '@/components/dashboard/DashboardContent';
import type { DashboardContentProps } from '@/components/dashboard/DashboardContent';

// ── Mocks ─────────────────────────────────────────────────────────────────

const dashboardMocks = vi.hoisted(() => ({
    cycleResultsTable: vi.fn(),
}));

vi.mock('@/hooks/useLicense', () => ({
    useLicense: () => ({
        result: null,
        isInitialized: true,
    }),
}));

// Stub heavy chart / analysis components
vi.mock('@/components/charts/rheology-chart-uplot', () => ({
    RheologyChart: ({ title }: { title?: string }) => (
        <div data-testid="MockRheologyChart">{title}</div>
    ),
}));

vi.mock('@/components/dashboard/raw-data-table', () => ({
    RawDataTable: () => <div data-testid="MockRawDataTable" />,
}));

vi.mock('@/components/dashboard/raw-data-table-by-id', () => ({
    RawDataTableById: () => <div data-testid="MockRawDataTableById" />,
}));

vi.mock('@/components/analysis/cycle-results-table', () => ({
    CycleResultsTable: (props: {
        cycles: Array<{ id: number; cycleIndex?: number }>;
        results: Map<number, unknown>;
        preferResultTiming?: boolean;
        onEditCycle?: (cycleId: number) => void;
    }) => {
        dashboardMocks.cycleResultsTable(props);
        const firstCycle = props.cycles[0];
        const firstResult = props.results.values().next().value as {
            timeMin?: number;
            endTimeMin?: number;
            n_prime?: number;
            K_prime_PaSn?: number;
        } | undefined;
        const firstVisibleResult = firstCycle
            ? props.results.get(firstCycle.id) as typeof firstResult
            : firstResult;
        return (
            <div>
                <div
                    data-testid="MockCycleResultsTable"
                    data-cycle-count={String(props.cycles.length)}
                    data-result-count={String(props.results.size)}
                    data-prefer-result-timing={String(Boolean(props.preferResultTiming))}
                    data-first-cycle-id={String(firstCycle?.id ?? '')}
                    data-first-cycle-index={String(firstCycle?.cycleIndex ?? '')}
                    data-first-time-min={String(firstVisibleResult?.timeMin ?? '')}
                    data-first-end-time-min={String(firstVisibleResult?.endTimeMin ?? '')}
                    data-first-n-prime={String(firstVisibleResult?.n_prime ?? '')}
                    data-first-k-prime={String(firstVisibleResult?.K_prime_PaSn ?? '')}
                />
                {firstCycle && props.onEditCycle && (
                    <button
                        type="button"
                        data-testid="MockEditCycleButton"
                        onClick={() => props.onEditCycle?.(firstCycle.id)}
                    >
                        edit
                    </button>
                )}
            </div>
        );
    },
}));

vi.mock('@/components/analysis/ReportTab', () => ({
    ReportTab: ({
        parseResult,
        savedExperimentId,
    }: {
        parseResult: { metadata: { filename: string } };
        savedExperimentId?: string;
    }) => (
        <div data-testid="MockReportTab">
            Report for {parseResult.metadata.filename}
            {savedExperimentId ? ` by-id ${savedExperimentId}` : ''}
        </div>
    ),
}));

vi.mock('@/components/analysis/cycle-editor-dialog', () => ({
    CycleEditorDialog: ({ cycle }: { cycle: { id: number } | null }) => (
        <div data-testid="MockCycleEditorDialog" data-cycle-id={String(cycle?.id ?? '')} />
    ),
}));

vi.mock('@/components/analysis/recipe-panel', () => ({
    RecipePanel: () => <div data-testid="MockRecipePanel" />,
}));

vi.mock('@/components/analysis/water-analysis-panel', () => ({
    WaterAnalysisPanel: () => <div data-testid="MockWaterAnalysisPanel" />,
}));

vi.mock('@/components/calibration/CalibrationPanel', () => ({
    CalibrationPanel: () => <div data-testid="MockCalibrationPanel" />,
}));

vi.mock('@/components/dashboard/parsing-logs', () => ({
    ParsingLogs: () => <div data-testid="MockParsingLogs" />,
}));

vi.mock('@/components/dashboard/instrument-selector', () => ({
    InstrumentSelector: () => <div data-testid="MockInstrumentSelector" />,
}));

vi.mock('@/components/dashboard/geometry-selector', () => ({
    GeometrySelector: () => <div data-testid="MockGeometrySelector" />,
}));

vi.mock('@/lib/utils/columnar', () => ({
    rawPointsFromParseResult: () => [],
}));

vi.mock('@/components/ui/collapsible-card', () => ({
    CollapsibleCard: ({
        title,
        headerActions,
        children,
    }: {
        title: React.ReactNode;
        headerActions?: React.ReactNode;
        children: React.ReactNode;
    }) => (
        <div>
            <div>
                <div>{title}</div>
                <div>{headerActions}</div>
            </div>
            {children}
        </div>
    ),
}));

vi.mock('@/components/ui/logo', () => ({
    Logo: () => <div data-testid="MockLogo" />,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

import React from 'react';

const mockParseResult = {
    metadata: {
        filename: 'test.xlsx',
        experimentId: 'exp_1',
        instrumentType: 'Grace' as const,
        testDate: new Date('2026-01-01'),
        fluidType: 'mud' as const,
        testGroup: 'A' as const,
        geometry: 'R1B5',
        geometrySource: 'parsed' as const,
    },
    columnarData: {
        time_s: new Float64Array([0, 10, 20]),
        viscosity_cp: new Float64Array([100, 105, 102]),
        temperature_c: new Float64Array([25, 26, 25]),
        speed_rpm: new Float64Array([300, 300, 300]),
        shear_rate_s1: new Float64Array([511, 511, 511]),
        shear_stress_pa: new Float64Array([51, 54, 52]),
        bath_temperature_c: new Float64Array([25, 25, 25]),
        pressure_bar: new Float64Array([0, 0, 0]),
    },
    warnings: [],
};

function makeProps(overrides: Partial<DashboardContentProps> = {}): DashboardContentProps {
    return {
        parseResult: mockParseResult as never,
        cycles: [],
        cycleResults: new Map(),
        allSteps: [],
        isExpert: false,
        editedRecipe: [],
        setEditedRecipe: vi.fn(),
        editedWaterSource: '',
        setEditedWaterSource: vi.fn(),
        editedWaterParams: null,
        setEditedWaterParams: vi.fn(),
        onSaveClick: vi.fn(),
        onInstrumentChange: vi.fn(),
        onGeometryChange: vi.fn(),
        geometryOverride: null,
        cycleOverrides: new Map(),
        setCycleOverrides: vi.fn(),
        patternOverride: null,
        setPatternOverride: vi.fn(),
        ...overrides,
    };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('DashboardContent', () => {

    // ── null guard ─────────────────────────────────────────────────────────

    it('renders nothing when parseResult is null', () => {
        const { container } = render(<DashboardContent {...makeProps({ parseResult: null })} />);
        expect(container.firstChild).toBeNull();
    });

    // ── chart tab (default) ────────────────────────────────────────────────

    it('renders the chart tab by default', () => {
        render(<DashboardContent {...makeProps()} />);
        expect(screen.getByTestId('MockRheologyChart')).toBeDefined();
    });

    it('switches rheology analysis between program and parsed instrument results', async () => {
        render(<DashboardContent {...makeProps({
            parseResult: {
                ...mockParseResult,
                instrumentRheology: [{
                    source: 'instrument',
                    cycleNo: 1,
                    timeMin: 755.8,
                    endTimeMin: 755.8,
                    nPrime: 0.61,
                    kPrimePaSn: 0.22,
                }],
            } as never,
            cycles: [{
                id: 1,
                cycleIndex: 1,
                type: 'API',
                steps: [{ startTime: 600 } as never],
                description: 'API RP 39 Cycle',
                duration: 180,
            } as never],
            cycleResults: new Map([[1, {
                cycleNo: 1,
                timeMin: 10,
                endTimeMin: 13,
                n_prime: 0.44,
                K_prime_PaSn: 0.18,
            } as never]]),
        })} />);

        const initialTable = await screen.findByTestId('MockCycleResultsTable');
        expect(initialTable.getAttribute('data-prefer-result-timing')).toBe('false');
        expect(initialTable.getAttribute('data-first-n-prime')).toBe('0.44');

        fireEvent.click(screen.getByTestId('AnalysisRheologySourceProgram'));

        const programTable = screen.getByTestId('MockCycleResultsTable');
        expect(programTable.getAttribute('data-prefer-result-timing')).toBe('false');
        expect(programTable.getAttribute('data-first-n-prime')).toBe('0.44');

        fireEvent.click(screen.getByTestId('AnalysisRheologySourceInstrument'));

        const table = screen.getByTestId('MockCycleResultsTable');
        expect(table.getAttribute('data-result-count')).toBe('1');
        expect(table.getAttribute('data-prefer-result-timing')).toBe('true');
        expect(table.getAttribute('data-first-time-min')).toBe('755.8');
        expect(table.getAttribute('data-first-end-time-min')).toBe('755.8');
        expect(table.getAttribute('data-first-n-prime')).toBe('0.61');
        expect(table.getAttribute('data-first-k-prime')).toBe('0.22');
        expect(screen.queryByTestId('InstrumentRheologyUnavailable')).toBeNull();
    });

    it('renders parsed instrument rows even when program cycle ids do not match', async () => {
        render(<DashboardContent {...makeProps({
            parseResult: {
                ...mockParseResult,
                instrumentRheology: [{
                    source: 'instrument',
                    cycleNo: 1,
                    timeMin: 13,
                    endTimeMin: 13,
                    nPrime: 0.55,
                    kPrimePaSn: 16.3,
                    sourceSheet: 'Power Law Data',
                }],
            } as never,
            cycles: [{
                id: 99,
                cycleIndex: 99,
                type: 'API',
                steps: [{ startTime: 600 } as never],
                description: 'Program cycle with unrelated id',
                duration: 180,
            } as never],
            cycleResults: new Map([[99, {
                cycleNo: 99,
                timeMin: 10,
                endTimeMin: 13,
                n_prime: 0.44,
                K_prime_PaSn: 0.18,
            } as never]]),
        })} />);

        await screen.findByTestId('MockCycleResultsTable');
        fireEvent.click(screen.getByTestId('AnalysisRheologySourceInstrument'));

        const table = screen.getByTestId('MockCycleResultsTable');
        expect(table.getAttribute('data-prefer-result-timing')).toBe('true');
        expect(table.getAttribute('data-cycle-count')).toBe('1');
        expect(table.getAttribute('data-first-cycle-id')).toBe('-1');
        expect(table.getAttribute('data-first-cycle-index')).toBe('1');
        expect(table.getAttribute('data-first-n-prime')).toBe('0.55');
        expect(table.getAttribute('data-first-k-prime')).toBe('16.3');
    });

    it('uses saved instrument source as the default for loaded experiments', async () => {
        render(<DashboardContent {...makeProps({
            parseResult: {
                ...mockParseResult,
                metadata: {
                    ...mockParseResult.metadata,
                    rheologySource: 'instrument',
                },
                instrumentRheology: [{
                    source: 'instrument',
                    cycleNo: 1,
                    timeMin: 21,
                    endTimeMin: 22,
                    nPrime: 0.58,
                    kPrimePaSn: 0.19,
                }],
            } as never,
            cycles: [{
                id: 1,
                cycleIndex: 1,
                type: 'API',
                steps: [{ startTime: 600 } as never],
                description: 'API RP 39 Cycle',
                duration: 180,
            } as never],
            cycleResults: new Map([[1, {
                cycleNo: 1,
                timeMin: 10,
                endTimeMin: 13,
                n_prime: 0.44,
                K_prime_PaSn: 0.18,
            } as never]]),
        })} />);

        const table = await screen.findByTestId('MockCycleResultsTable');
        expect(table.getAttribute('data-prefer-result-timing')).toBe('true');
        expect(table.getAttribute('data-first-n-prime')).toBe('0.58');
        expect(table.getAttribute('data-first-k-prime')).toBe('0.19');
    });

    it('shows a clear message when instrument rheology was not parsed', async () => {
        render(<DashboardContent {...makeProps({
            cycles: [{
                id: 1,
                cycleIndex: 1,
                type: 'API',
                steps: [],
                description: 'API RP 39 Cycle',
                duration: 180,
            } as never],
            cycleResults: new Map([[1, {} as never]]),
        })} />);

        expect(await screen.findByTestId('MockCycleResultsTable')).toBeDefined();

        fireEvent.click(screen.getByTestId('AnalysisRheologySourceInstrument'));

        expect(screen.getByTestId('InstrumentRheologyUnavailable')).toBeDefined();
        expect(screen.getByText('Таблица реологических расчётов не найдена')).toBeDefined();
        expect(screen.queryByTestId('MockCycleResultsTable')).toBeNull();
    });

    // ── tab navigation ─────────────────────────────────────────────────────

    it('switches to table tab on click', async () => {
        render(<DashboardContent {...makeProps()} />);
        const tableTab = screen.getByRole('tab', { name: /Таблица/i });
        fireEvent.click(tableTab);
        expect(await screen.findByTestId('MockRawDataTable')).toBeDefined();
    });

    it('renders paged raw table without full-data load for metadata-only saved experiments', async () => {
        const onRequireFullData = vi.fn().mockResolvedValue(true);
        render(<DashboardContent {...makeProps({
            isMetadataOnly: true,
            onRequireFullData,
        })} />);
        const tableTab = screen.getByRole('tab', { name: /Таблица/i });
        fireEvent.click(tableTab);
        expect(onRequireFullData).not.toHaveBeenCalled();
        expect(await screen.findByTestId('MockRawDataTableById')).toBeDefined();
        expect(screen.queryByText(/Загружаем полный набор данных/i)).toBeNull();
    });

    it('switches to recipe tab on click', async () => {
        render(<DashboardContent {...makeProps()} />);
        const recipeTab = screen.getByRole('tab', { name: /Рецептура/i });
        fireEvent.click(recipeTab);
        expect(await screen.findByTestId('MockRecipePanel')).toBeDefined();
    });

    it('switches to water tab on click', async () => {
        render(<DashboardContent {...makeProps()} />);
        const waterTab = screen.getByTestId('WaterTabButton');
        fireEvent.click(waterTab);
        expect(await screen.findByTestId('MockWaterAnalysisPanel')).toBeDefined();
    });

    it('switches to report tab on click and renders ReportTab', async () => {
        render(<DashboardContent {...makeProps()} />);
        const reportBtn = screen.getByTestId('ReportTabButton');
        fireEvent.click(reportBtn);
        const panel = await screen.findByTestId('MockReportTab');
        expect(panel).toBeDefined();
        expect(panel.textContent).toContain('test.xlsx');
    });

    it('renders saved report tab by id without full-data load for metadata-only experiments', async () => {
        const onRequireFullData = vi.fn().mockResolvedValue(true);
        render(<DashboardContent {...makeProps({
            isMetadataOnly: true,
            onRequireFullData,
        })} />);
        const reportBtn = screen.getByTestId('ReportTabButton');
        fireEvent.click(reportBtn);
        const panel = await screen.findByTestId('MockReportTab');

        expect(onRequireFullData).not.toHaveBeenCalled();
        expect(panel.textContent).toContain('by-id exp_1');
        expect(screen.queryByText(/Загружаем полный набор данных/i)).toBeNull();
    });

    it('loads full saved experiment before opening expert cycle editor from metadata-only view', async () => {
        const onRequireFullData = vi.fn().mockResolvedValue(true);
        render(<DashboardContent {...makeProps({
            isExpert: true,
            isMetadataOnly: true,
            onRequireFullData,
            cycles: [{
                id: 1,
                cycleIndex: 1,
                type: 'API',
                steps: [],
                description: 'API RP 39 Cycle',
                duration: 180,
            } as never],
            cycleResults: new Map([[1, {
                cycleNo: 1,
                timeMin: 10,
                endTimeMin: 13,
                n_prime: 0.44,
                K_prime_PaSn: 0.18,
            } as never]]),
        })} />);

        expect(await screen.findByTestId('MockCycleResultsTable')).toBeDefined();
        fireEvent.click(screen.getByTestId('MockEditCycleButton'));

        await waitFor(() => expect(onRequireFullData).toHaveBeenCalledOnce());
        const dialog = await screen.findByTestId('MockCycleEditorDialog');
        expect(dialog.getAttribute('data-cycle-id')).toBe('1');
    });

    it('does not open expert cycle editor when metadata-only full-data load fails', async () => {
        const onRequireFullData = vi.fn().mockResolvedValue(false);
        render(<DashboardContent {...makeProps({
            isExpert: true,
            isMetadataOnly: true,
            onRequireFullData,
            cycles: [{
                id: 1,
                cycleIndex: 1,
                type: 'API',
                steps: [],
                description: 'API RP 39 Cycle',
                duration: 180,
            } as never],
            cycleResults: new Map([[1, {
                cycleNo: 1,
                timeMin: 10,
                endTimeMin: 13,
                n_prime: 0.44,
                K_prime_PaSn: 0.18,
            } as never]]),
        })} />);

        expect(await screen.findByTestId('MockCycleResultsTable')).toBeDefined();
        fireEvent.click(screen.getByTestId('MockEditCycleButton'));

        await waitFor(() => expect(onRequireFullData).toHaveBeenCalledOnce());
        expect(screen.queryByTestId('MockCycleEditorDialog')).toBeNull();
    });

    // ── save callback ──────────────────────────────────────────────────────

    it('calls onSaveClick when the save button is clicked', () => {
        const onSaveClick = vi.fn();
        render(<DashboardContent {...makeProps({ onSaveClick })} />);
        // Save button is in the tab bar next to the Сохранить label
        const saveBtn = screen.getByRole('button', { name: /Сохранить/i });
        fireEvent.click(saveBtn);
        expect(onSaveClick).toHaveBeenCalledOnce();
    });
});
