// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ReportTab } from '@/components/analysis/ReportTab';
import { UIModeProvider } from '@/contexts/ui-mode-context';
import type { ParseResult } from '@/lib/store/experiment-data-store';

const mocks = vi.hoisted(() => ({
    downloadAll: vi.fn(),
    clearError: vi.fn(),
}));

vi.mock('@/hooks/useLicense', () => ({
    useLicense: () => ({ result: null, isInitialized: true }),
}));

vi.mock('@/components/reports/hooks/useReportExport', () => ({
    useReportExport: () => ({
        isExporting: false,
        isExcelExporting: false,
        exportError: null,
        clearError: mocks.clearError,
        handleDownloadAll: mocks.downloadAll,
    }),
}));

vi.mock('@/components/reports/hooks/useReportExportById', () => ({
    useReportExportById: () => ({
        isExporting: false,
        isExcelExporting: false,
        exportError: null,
        clearError: mocks.clearError,
        handleDownloadAll: mocks.downloadAll,
    }),
}));

const parseResult = {
    metadata: {
        filename: 'saved-report.xlsx',
        experimentId: 'exp-1',
        instrumentType: 'Grace',
        testDate: new Date('2026-01-01'),
        geometry: 'R1B5',
        geometrySource: 'context',
    },
    columnarData: {
        timeSec: [0, 10],
        viscosityCp: [100, 105],
        temperatureC: [25, 26],
        speedRpm: [300, 300],
        shearRate: [511, 511],
        shearStress: [51, 54],
        bathTemperatureC: [25, 25],
        pressureBar: [0, 0],
    },
    success: true,
    source: 'regex',
    data: [],
    summary: { pointCount: 2 },
    instrumentRheology: [],
    warnings: [],
} satisfies ParseResult;

function renderReportTab() {
    return render(
        <UIModeProvider>
            <ReportTab
                parseResult={parseResult}
                savedExperimentId="exp-1"
                editedRecipe={[]}
                editedWaterParams={null}
                editedWaterSource=""
                cycleResults={new Map()}
                cycles={[]}
            />
        </UIModeProvider>,
    );
}

describe('ReportTab rheology source controls', () => {
    beforeEach(() => {
        mocks.downloadAll.mockClear();
        mocks.clearError.mockClear();
        localStorage.clear();
    });

    it('removes the saved-default source and confirms program exports', () => {
        renderReportTab();

        expect(screen.queryByTestId('ReportRheologySourceSaved')).toBeNull();
        expect(screen.queryByText('Как сохранено')).toBeNull();

        fireEvent.click(screen.getByTestId('ReportRheologySourceProgram'));
        fireEvent.click(screen.getByTestId('ReportDownloadButton'));

        expect(mocks.downloadAll).not.toHaveBeenCalled();
        expect(screen.getByTestId('ProgramRheologyConfirmDialog')).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: 'ОК' }));

        expect(mocks.downloadAll).toHaveBeenCalledWith(true, true);
    });
});
