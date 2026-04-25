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
    generateComparisonPdfReportBlob,
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
            viscosity: { color: '#3b82f6', width: 2, style: 'solid', unit: 'cP' },
            temperature: { color: '#ef4444', width: 2, style: 'solid', unit: '°C' },
            shearRate: { color: '#a855f7', width: 2, style: 'solid', unit: '1/s' },
            pressure: { color: '#06b6d4', width: 2, style: 'solid', unit: 'bar' },
            rpm: { color: '#10b981', width: 2, style: 'solid', unit: 'rpm' },
            bathTemperature: { color: '#f97316', width: 1, style: 'dashed', unit: '°C' },
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
        it('calls PDF generator with a payload built per-experiment and saves via saveBlob', async () => {
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            // adapter called once per experiment
            expect(experimentToReportBuildContext).toHaveBeenCalledTimes(2);
            expect(buildPdfReportInput).toHaveBeenCalledTimes(2);
            // buildExcelReportInput NOT called on the PDF path
            expect(buildExcelReportInput).not.toHaveBeenCalled();

            // Comparison PDF client called with an object that wraps the entries
            expect(generateComparisonPdfReportBlob).toHaveBeenCalledTimes(1);
            const payload = vi.mocked(generateComparisonPdfReportBlob).mock.calls[0][0];
            expect(payload.experiments).toHaveLength(2);
            expect(payload.experiments[0].id).toBe('1');
            expect(payload.experiments[1].id).toBe('2');

            // saveBlob got the MIME-correct blob
            expect(saveBlob).toHaveBeenCalledTimes(1);
            const saveArgs = vi.mocked(saveBlob).mock.calls[0][0];
            expect(saveArgs.filename).toMatch(/^comparison-report_\d{4}-\d{2}-\d{2}\.pdf$/);
            expect(saveArgs.filters[0]).toEqual({ name: 'PDF Document', extensions: ['pdf'] });
        });

        it('surfaces generator errors onto exportError', async () => {
            vi.mocked(generateComparisonPdfReportBlob).mockRejectedValueOnce(new Error('License expired'));
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

            expect(generateComparisonPdfReportBlob).not.toHaveBeenCalled();
            expect(result.current.exportError).toMatch(/хотя бы один/);
        });

        it('clears previous errors on clearError()', async () => {
            vi.mocked(generateComparisonPdfReportBlob).mockRejectedValueOnce(new Error('boom'));
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

            const payload = vi.mocked(generateComparisonPdfReportBlob).mock.calls[0][0];
            expect(payload.comparisonChart.touchPoint).toEqual({
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

            const payload = vi.mocked(generateComparisonPdfReportBlob).mock.calls[0][0];
            expect(payload.comparisonChart.touchPoint.enabled).toBe(false);
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

            const payload = vi.mocked(generateComparisonPdfReportBlob).mock.calls[0][0];
            for (const entry of payload.experiments) {
                expect(entry.sectionToggles).toEqual({
                    showCalibration: true,
                    showRawData: true,
                    showRecipe: false,
                    showWaterAnalysis: true,
                    showRheology: false,
                });
            }
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

            const payload = vi.mocked(generateComparisonExcelReportBlob).mock.calls[0][0];
            for (const entry of payload.experiments) {
                expect(entry.sectionToggles).toEqual({
                    showCalibration: false,
                    showRawData: false,
                    showRecipe: true,
                    showWaterAnalysis: false,
                    showRheology: true,
                });
            }
        });
    });

    // ── Excel ────────────────────────────────────────────────────────────

    describe('handleDownloadExcel', () => {
        it('uses the Excel builder and the Excel MIME-type filter', async () => {
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
                await result.current.handleDownloadExcel();
            });

            expect(buildExcelReportInput).toHaveBeenCalledTimes(2);
            expect(buildPdfReportInput).not.toHaveBeenCalled();
            expect(generateComparisonExcelReportBlob).toHaveBeenCalledTimes(1);
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

            expect(generateComparisonPdfReportBlob).toHaveBeenCalledTimes(1);
            expect(generateComparisonExcelReportBlob).not.toHaveBeenCalled();
            expect(saveBlob).toHaveBeenCalledTimes(1);
            expect(saveBlobsToDir).not.toHaveBeenCalled();
        });

        it('saves PDF + Excel to one directory when both flags are set', async () => {
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
                await result.current.handleDownloadAll(true, true);
            });

            expect(generateComparisonPdfReportBlob).toHaveBeenCalledTimes(1);
            expect(generateComparisonExcelReportBlob).toHaveBeenCalledTimes(1);
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

            expect(generateComparisonPdfReportBlob).not.toHaveBeenCalled();
            expect(generateComparisonExcelReportBlob).not.toHaveBeenCalled();
            expect(saveBlob).not.toHaveBeenCalled();
            expect(saveBlobsToDir).not.toHaveBeenCalled();
        });
    });
});
