// @vitest-environment jsdom
/**
 * Tests for src/components/comparison/reports/hooks/useComparisonReportExport.ts
 *
 * Verifies the hook wires together the adapter → single-exp builders →
 * comparison builder → client blob generators → saveBlob/saveBlobsToDir
 * chain correctly, including error bookkeeping and input validation.
 */
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/reports/client', () => ({
    generateComparisonPdfReportBlob: vi.fn(),
    generateComparisonExcelReportBlob: vi.fn(),
    generateComparisonPdfReportByIdsBlob: vi.fn(),
    generateComparisonExcelReportByIdsBlob: vi.fn(),
}));

vi.mock('@/lib/reports/report-save', () => ({
    saveBlob: vi.fn(),
    saveBlobsToDir: vi.fn(),
}));

// Stub the heavyweight dependency — the hook only pipes its output into
// the comparison builder, so identity-preserving stubs are sufficient.
vi.mock('@/lib/reports/report-builders', () => ({
    buildPdfReportInput: vi.fn((ctx: unknown) => ({ pdf: ctx })),
    buildExcelReportInput: vi.fn((ctx: unknown) => ({ excel: ctx })),
}));

vi.mock('@/lib/reports/comparison-experiment-adapter', () => ({
    experimentToReportBuildContext: vi.fn((exp: { id: string }, overrides: unknown) => ({
        __mock: 'ctx',
        id: exp.id,
        overrides,
    })),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────

import {
    generateComparisonExcelReportBlob,
    generateComparisonExcelReportByIdsBlob,
    generateComparisonPdfReportBlob,
    generateComparisonPdfReportByIdsBlob,
} from '@/lib/reports/client';
import { saveBlob, saveBlobsToDir } from '@/lib/reports/report-save';
import {
    buildExcelReportInput,
    buildPdfReportInput,
} from '@/lib/reports/report-builders';
import { experimentToReportBuildContext } from '@/lib/reports/comparison-experiment-adapter';
import { useComparisonReportExport, type UseComparisonReportExportOptions } from '@/components/comparison/reports/hooks/useComparisonReportExport';
import type { Experiment } from '@/types';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import type { ComparisonDisplaySettings } from '@/lib/store/comparison-store';

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeExperiment(id: string, name = `Exp ${id}`): Experiment {
    return { id, name } as unknown as Experiment;
}

function makeDisplaySettings(): ComparisonDisplaySettings {
    return {
        primaryMetric: 'viscosity_cp',
        leftSecondaryMetric: 'none',
        secondaryMetric: 'temperature_c',
        tertiaryMetric: 'none',
        showLegend: true,
        showControls: true,
        showTouchPoints: true,
        viscosityThreshold: 200,
        showTargetTime: false,
        targetTime: 10,
    };
}

function makeChartSettings(): ChartSettings {
    return {
        comparisonAxisMode: 'shared',
        lines: {
            viscosity: { color: '#3b82f6', width: 2, style: 'solid', unit: 'cP', visible: true, axis: 'left' },
            temperature: { color: '#ef4444', width: 2, style: 'solid', unit: '°C', visible: true, axis: 'right' },
            shearRate: { color: '#a855f7', width: 2, style: 'solid', unit: '1/s', visible: true, axis: 'right' },
            pressure: { color: '#06b6d4', width: 2, style: 'solid', unit: 'bar', visible: true, axis: 'right' },
            rpm: { color: '#10b981', width: 2, style: 'solid', unit: 'rpm', visible: false, axis: 'right' },
            bathTemperature: { color: '#f97316', width: 1, style: 'dashed', unit: '°C', visible: false, axis: 'right' },
        },
        rheologyUnits: {
            viscosity: 'cP',
            temperature: '°C',
            pressure: 'bar',
            consistency: 'Pa·s^n',
            plasticViscosity: 'cP',
            yieldPoint: 'Pa',
            timeFormat: 'minutes',
        },
    } as unknown as ChartSettings;
}

function makeOptions(overrides: Partial<UseComparisonReportExportOptions> = {}): UseComparisonReportExportOptions {
    return {
        experiments: [makeExperiment('1', 'First'), makeExperiment('2', 'Second')],
        displaySettings: makeDisplaySettings(),
        chartSettings: makeChartSettings(),
        language: 'en',
        unitSystem: 'SI',
        companyName: 'Acme',
        companyLogo: null,
        showCalibration: true,
        showRawData: false,
        showRecipe: true,
        showWaterAnalysis: false,
        showRheology: true,
        reportViscosityRates: [40, 100],
        isExpert: false,
        ...overrides,
    };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('useComparisonReportExport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(generateComparisonPdfReportBlob).mockResolvedValue(
            new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' }),
        );
        vi.mocked(generateComparisonExcelReportBlob).mockResolvedValue(
            new Blob([new Uint8Array([80, 75, 3, 4])], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            }),
        );
        vi.mocked(generateComparisonPdfReportByIdsBlob).mockResolvedValue(
            new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' }),
        );
        vi.mocked(generateComparisonExcelReportByIdsBlob).mockResolvedValue(
            new Blob([new Uint8Array([80, 75, 3, 4])], {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            }),
        );
        localStorage.clear();
        vi.mocked(saveBlob).mockResolvedValue();
        vi.mocked(saveBlobsToDir).mockResolvedValue();
    });

    it('exposes isExporting=false and no error on mount', () => {
        const { result } = renderHook(() => useComparisonReportExport(makeOptions()));
        expect(result.current.isExporting).toBe(false);
        expect(result.current.isExcelExporting).toBe(false);
        expect(result.current.exportError).toBeNull();
    });

    // ── PDF ──────────────────────────────────────────────────────────────

    describe('handleDownloadPdf', () => {
        it('calls PDF by-ids generator and saves via saveBlob', async () => {
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            expect(experimentToReportBuildContext).not.toHaveBeenCalled();
            expect(buildPdfReportInput).not.toHaveBeenCalled();
            expect(buildExcelReportInput).not.toHaveBeenCalled();
            expect(generateComparisonPdfReportBlob).not.toHaveBeenCalled();
            expect(generateComparisonPdfReportByIdsBlob).toHaveBeenCalledTimes(1);
            const request = vi.mocked(generateComparisonPdfReportByIdsBlob).mock.calls[0][0];
            expect(request.experimentIds).toEqual(['1', '2']);
            expect(request.settings.language).toBe('en');
            expect(request.settings.unitSystem).toBe('SI');
            expect(request.settings.companyName).toBe('Acme');
            expect(request.settings.reportSettings.reportViscosityRates).toEqual([40, 100]);
            expect(request.settings.reportSettings.showAdvancedStats).toBe(false);
            expect(request.settings.reportSettings.showTemperature).toBe(true);
            expect(request.settings.reportSettings.showBathTemperature).toBe(false);
            expect(request.settings.reportSettings.shearRateAxis).toBe('right');
            expect(request.settings.reportSettings.rheologyUnits?.viscosity).toBe('cP');
            expect(request.settings.analysisSettings?.viscosityShearRates).toEqual([40, 100]);

            expect(saveBlob).toHaveBeenCalledTimes(1);
            const saveArgs = vi.mocked(saveBlob).mock.calls[0][0];
            expect(saveArgs.filename).toMatch(/^comparison-report_\d{4}-\d{2}-\d{2}\.pdf$/);
            expect(saveArgs.filters[0]).toEqual({ name: 'PDF Document', extensions: ['pdf'] });
        });

        it('surfaces generator errors onto exportError', async () => {
            vi.mocked(generateComparisonPdfReportByIdsBlob).mockRejectedValueOnce(new Error('License expired'));
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            expect(result.current.exportError).toContain('License expired');
            expect(result.current.isExporting).toBe(false);
            expect(saveBlob).not.toHaveBeenCalled();
        });

        it('guards against empty experiments', async () => {
            const { result } = renderHook(() => useComparisonReportExport(makeOptions({ experiments: [] })));

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            expect(generateComparisonPdfReportByIdsBlob).not.toHaveBeenCalled();
            expect(generateComparisonPdfReportBlob).not.toHaveBeenCalled();
            expect(result.current.exportError).toMatch(/хотя бы один/);
        });

        it('clears previous errors on clearError()', async () => {
            vi.mocked(generateComparisonPdfReportByIdsBlob).mockRejectedValueOnce(new Error('boom'));
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
                await result.current.handleDownloadPdf();
            });
            expect(result.current.exportError).not.toBeNull();

            act(() => {
                result.current.clearError();
            });
            expect(result.current.exportError).toBeNull();
        });

        it('falls back to legacy payload generation when PDF by-ids IPC is unavailable', async () => {
            vi.mocked(generateComparisonPdfReportByIdsBlob).mockRejectedValueOnce(
                new Error('Unknown IPC command reports_generate_comparison_pdf_by_ids'),
            );
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            expect(generateComparisonPdfReportByIdsBlob).toHaveBeenCalledTimes(1);
            expect(experimentToReportBuildContext).toHaveBeenCalledTimes(2);
            expect(buildPdfReportInput).toHaveBeenCalledTimes(2);
            expect(generateComparisonPdfReportBlob).toHaveBeenCalledTimes(1);
            const payload = vi.mocked(generateComparisonPdfReportBlob).mock.calls[0][0];
            expect(payload.experiments).toHaveLength(2);
            expect(payload.experiments[0].id).toBe('1');
            expect(payload.experiments[1].id).toBe('2');
            expect(saveBlob).toHaveBeenCalledTimes(1);
        });


        it('uses legacy payload generation when the emergency legacy flag is set', async () => {
            localStorage.setItem('rheolab.comparisonReports.forceLegacy', '1');
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            expect(generateComparisonPdfReportByIdsBlob).not.toHaveBeenCalled();
            expect(experimentToReportBuildContext).toHaveBeenCalledTimes(2);
            expect(buildPdfReportInput).toHaveBeenCalledTimes(2);
            expect(generateComparisonPdfReportBlob).toHaveBeenCalledTimes(1);
            expect(saveBlob).toHaveBeenCalledTimes(1);
        });
    });

    // ── Touch-point config propagation ────────────────────────────────

    describe('touch-point config in payload', () => {
        it('passes touch-point settings from displaySettings into the comparison payload', async () => {
            const display = makeDisplaySettings();
            display.showTouchPoints = true;
            display.viscosityThreshold = 350;
            display.showTargetTime = true;
            display.targetTime = 15;

            const { result } = renderHook(() =>
                useComparisonReportExport(makeOptions({ displaySettings: display })),
            );

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            const request = vi.mocked(generateComparisonPdfReportByIdsBlob).mock.calls[0][0];
            expect(request.settings.comparisonChart.touchPoint).toEqual({
                enabled: true,
                viscosityThreshold: 350,
                showTargetTime: true,
                targetTime: 15,
            });
        });

        it('disables touch-points when showTouchPoints is false', async () => {
            const display = makeDisplaySettings();
            display.showTouchPoints = false;
            display.viscosityThreshold = 200;

            const { result } = renderHook(() =>
                useComparisonReportExport(makeOptions({ displaySettings: display })),
            );

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            const request = vi.mocked(generateComparisonPdfReportByIdsBlob).mock.calls[0][0];
            expect(request.settings.comparisonChart.touchPoint.enabled).toBe(false);
        });
    });

    // ── Section toggles ─────────────────────────────────────────────────

    describe('section toggles propagation', () => {
        it('forwards all five section toggles into each experiment entry', async () => {
            const { result } = renderHook(() =>
                useComparisonReportExport(makeOptions({
                    showCalibration: true,
                    showRawData: true,
                    showRecipe: false,
                    showWaterAnalysis: true,
                    showRheology: false,
                })),
            );

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            const request = vi.mocked(generateComparisonPdfReportByIdsBlob).mock.calls[0][0];
            expect(request.settings.sectionToggles).toEqual({
                showCalibration: true,
                showRawData: true,
                showRecipe: false,
                showWaterAnalysis: true,
                showRheology: false,
            });
        });

        it('Excel path forwards section toggles identically', async () => {
            const { result } = renderHook(() =>
                useComparisonReportExport(makeOptions({
                    showCalibration: false,
                    showRawData: false,
                    showRecipe: true,
                    showWaterAnalysis: false,
                    showRheology: true,
                })),
            );

            await act(async () => {
                await result.current.handleDownloadExcel();
            });

            const request = vi.mocked(generateComparisonExcelReportByIdsBlob).mock.calls[0][0];
            expect(request.settings.sectionToggles).toEqual({
                showCalibration: false,
                showRawData: false,
                showRecipe: true,
                showWaterAnalysis: false,
                showRheology: true,
            });
        });
    });

    // ── Excel ────────────────────────────────────────────────────────────

    describe('handleDownloadExcel', () => {
        it('uses the Excel by-ids generator and the Excel MIME-type filter', async () => {
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
                await result.current.handleDownloadExcel();
            });

            expect(buildExcelReportInput).not.toHaveBeenCalled();
            expect(buildPdfReportInput).not.toHaveBeenCalled();
            expect(generateComparisonExcelReportBlob).not.toHaveBeenCalled();
            expect(generateComparisonExcelReportByIdsBlob).toHaveBeenCalledTimes(1);
            const request = vi.mocked(generateComparisonExcelReportByIdsBlob).mock.calls[0][0];
            expect(request.experimentIds).toEqual(['1', '2']);
            const saveArgs = vi.mocked(saveBlob).mock.calls[0][0];
            expect(saveArgs.filename).toMatch(/\.xlsx$/);
            expect(saveArgs.filters[0]).toEqual({ name: 'Excel Spreadsheet', extensions: ['xlsx'] });
        });
    });

    // ── Combined download ───────────────────────────────────────────────

    describe('handleDownloadAll', () => {
        it('falls back to single-format handler when only one flag is set', async () => {
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
                await result.current.handleDownloadAll(true, false);
            });

            expect(generateComparisonPdfReportByIdsBlob).toHaveBeenCalledTimes(1);
            expect(generateComparisonPdfReportBlob).not.toHaveBeenCalled();
            expect(generateComparisonExcelReportByIdsBlob).not.toHaveBeenCalled();
            expect(generateComparisonExcelReportBlob).not.toHaveBeenCalled();
            expect(saveBlob).toHaveBeenCalledTimes(1);
            expect(saveBlobsToDir).not.toHaveBeenCalled();
        });

        it('saves PDF + Excel to one directory when both flags are set', async () => {
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
                await result.current.handleDownloadAll(true, true);
            });

            expect(generateComparisonPdfReportByIdsBlob).toHaveBeenCalledTimes(1);
            expect(generateComparisonExcelReportByIdsBlob).toHaveBeenCalledTimes(1);
            expect(generateComparisonPdfReportBlob).not.toHaveBeenCalled();
            expect(generateComparisonExcelReportBlob).not.toHaveBeenCalled();
            expect(saveBlobsToDir).toHaveBeenCalledTimes(1);
            const items = vi.mocked(saveBlobsToDir).mock.calls[0][0];
            expect(items).toHaveLength(2);
            expect(items.map(i => i.filename)).toEqual(
                expect.arrayContaining([expect.stringMatching(/\.pdf$/), expect.stringMatching(/\.xlsx$/)]),
            );
        });

        it('does nothing when both format flags are false', async () => {
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
                await result.current.handleDownloadAll(false, false);
            });

            expect(generateComparisonPdfReportByIdsBlob).not.toHaveBeenCalled();
            expect(generateComparisonExcelReportByIdsBlob).not.toHaveBeenCalled();
            expect(generateComparisonPdfReportBlob).not.toHaveBeenCalled();
            expect(generateComparisonExcelReportBlob).not.toHaveBeenCalled();
            expect(saveBlob).not.toHaveBeenCalled();
            expect(saveBlobsToDir).not.toHaveBeenCalled();
        });
    });
});
