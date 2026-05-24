// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
    ComparisonReportSettings,
    type ComparisonReportSettingsProps,
} from '@/components/comparison/reports/ComparisonReportSettings';

function makeProps(overrides: Partial<ComparisonReportSettingsProps> = {}): ComparisonReportSettingsProps {
    return {
        language: 'ru',
        setLanguage: vi.fn(),
        showCalibration: false,
        setShowCalibration: vi.fn(),
        showRawData: false,
        setShowRawData: vi.fn(),
        showRecipe: true,
        setShowRecipe: vi.fn(),
        showWaterAnalysis: false,
        setShowWaterAnalysis: vi.fn(),
        showRheology: true,
        setShowRheology: vi.fn(),
        rheologySourceMode: 'instrument',
        setRheologySourceMode: vi.fn(),
        canUseCalibration: false,
        isExporting: false,
        isExcelExporting: false,
        exportError: null,
        onClearError: vi.fn(),
        onDownloadPdf: vi.fn(),
        onDownloadExcel: vi.fn(),
        experimentCount: 2,
        ...overrides,
    };
}

describe('ComparisonReportSettings rheology source controls', () => {
    it('shows only explicit instrument/program choices', () => {
        render(<ComparisonReportSettings {...makeProps()} />);

        expect(screen.queryByTestId('ComparisonReportRheologySourceSaved')).toBeNull();
        expect(screen.queryByText('Как сохранено')).toBeNull();
        expect(screen.getByTestId('ComparisonReportRheologySourceInstrument')).toBeDefined();
        expect(screen.getByTestId('ComparisonReportRheologySourceProgram')).toBeDefined();
    });

    it('requires confirmation before exporting a calculated rheology table', () => {
        const onDownloadPdf = vi.fn();
        render(<ComparisonReportSettings {...makeProps({
            rheologySourceMode: 'program',
            onDownloadPdf,
        })} />);

        fireEvent.click(screen.getByTestId('ComparisonReportPdfButton'));

        expect(onDownloadPdf).not.toHaveBeenCalled();
        expect(screen.getByTestId('ProgramRheologyConfirmDialog')).toBeDefined();
        expect(screen.getByText(/В отчёт будет загружена расчётная таблица реологии/)).toBeDefined();

        fireEvent.click(screen.getByRole('button', { name: 'ОК' }));

        expect(onDownloadPdf).toHaveBeenCalledTimes(1);
    });

    it('does not ask for confirmation when exporting the instrument table', () => {
        const onDownloadExcel = vi.fn();
        render(<ComparisonReportSettings {...makeProps({
            rheologySourceMode: 'instrument',
            onDownloadExcel,
        })} />);

        fireEvent.click(screen.getByTestId('ComparisonReportExcelButton'));

        expect(screen.queryByTestId('ProgramRheologyConfirmDialog')).toBeNull();
        expect(onDownloadExcel).toHaveBeenCalledTimes(1);
    });
});
