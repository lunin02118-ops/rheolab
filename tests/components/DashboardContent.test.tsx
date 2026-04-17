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
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardContent } from '@/components/dashboard/DashboardContent';
import type { DashboardContentProps } from '@/components/dashboard/DashboardContent';

// ── Mocks ─────────────────────────────────────────────────────────────────

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

vi.mock('@/components/analysis/cycle-results-table', () => ({
    CycleResultsTable: () => <div data-testid="MockCycleResultsTable" />,
}));

vi.mock('@/components/analysis/cycle-editor-dialog', () => ({
    CycleEditorDialog: () => null,
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
    CollapsibleCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/logo', () => ({
    Logo: () => <div data-testid="MockLogo" />,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

import React from 'react';

const mockParseResult = {
    metadata: {
        filename: 'test.xlsx',
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

    // ── tab navigation ─────────────────────────────────────────────────────

    it('switches to table tab on click', () => {
        render(<DashboardContent {...makeProps()} />);
        const tableTab = screen.getByRole('tab', { name: /Таблица/i });
        fireEvent.click(tableTab);
        expect(screen.getByTestId('MockRawDataTable')).toBeDefined();
    });

    it('switches to recipe tab on click', () => {
        render(<DashboardContent {...makeProps()} />);
        const recipeTab = screen.getByRole('tab', { name: /Рецептура/i });
        fireEvent.click(recipeTab);
        expect(screen.getByTestId('MockRecipePanel')).toBeDefined();
    });

    it('switches to water tab on click', () => {
        render(<DashboardContent {...makeProps()} />);
        const waterTab = screen.getByTestId('WaterTabButton');
        fireEvent.click(waterTab);
        expect(screen.getByTestId('MockWaterAnalysisPanel')).toBeDefined();
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
