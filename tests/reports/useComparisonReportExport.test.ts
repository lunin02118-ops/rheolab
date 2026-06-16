// @vitest-environment jsdom
/**
 * Tests for src/components/comparison/reports/hooks/useComparisonReportExport.ts
 *
 * Verifies the hook wires together the adapter → single-exp builders →
 * comparison builder → client byte generators → saveBytes/saveBytesToDir
 * chain correctly, including error bookkeeping and input validation.
 */
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ─────────────────────────────────────────────────────────

vi.mock('@/lib/reports/client', () => ({
    generateComparisonPdfReportByIdsBytes: vi.fn(),
    generateComparisonExcelReportByIdsBytes: vi.fn(),
}));

vi.mock('@/lib/reports/report-save', () => ({
    saveBytes: vi.fn(),
    saveBytesToDir: vi.fn(),
}));

vi.mock('@/lib/experiments/client', () => ({
    saveExperiment: vi.fn(),
    getExperimentsCount: vi.fn(),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────

import {
    generateComparisonExcelReportByIdsBytes,
    generateComparisonPdfReportByIdsBytes,
} from '@/lib/reports/client';
import { saveBytes, saveBytesToDir } from '@/lib/reports/report-save';
import { getExperimentsCount, saveExperiment } from '@/lib/experiments/client';
import { useComparisonReportExport, type UseComparisonReportExportOptions } from '@/components/comparison/reports/hooks/useComparisonReportExport';
import { useComparisonStore } from '@/lib/store/comparison-store';
import { useLicenseStore } from '@/lib/store/license-store';
import type { Experiment } from '@/types';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import type { ComparisonDisplaySettings } from '@/lib/store/comparison-store';
import type { ExpertSettings } from '@/lib/store/analysis-settings-store';

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

function makeExpertSettings(overrides: Partial<ExpertSettings> = {}): ExpertSettings {
    return {
        pointsToAverage: 7,
        viscosityShearRates: [40, 100, 220],
        stepSplitting: false,
        splitStartDuration: 5,
        splitEndDuration: 6,
        minDurationForSplit: 45,
        aiModel: 'test-model',
        externalAiEnabled: false,
        forceAiParsing: false,
        timeShiftEnabled: false,
        ...overrides,
    };
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
        expertSettings: makeExpertSettings(),
        ...overrides,
    };
}

function makeFileBackedExperiment(id = 'file-local-1', filename = 'local.dat'): Experiment {
    return {
        ...makeExperiment(id, filename.replace(/\.[^/.]+$/, '')),
        originalFilename: filename,
        testDate: new Date('2026-06-15T00:00:00Z'),
        instrumentType: 'Grace M5600',
        rawPoints: [{
            time_sec: 300,
            viscosity_cp: 100,
            temperature_c: 25,
            speed_rpm: 100,
            shear_rate_s1: 170,
            shear_stress_pa: 10,
            pressure_bar: 0,
        }],
    } as unknown as Experiment;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('useComparisonReportExport', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(generateComparisonPdfReportByIdsBytes).mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
        vi.mocked(generateComparisonExcelReportByIdsBytes).mockResolvedValue(new Uint8Array([80, 75, 3, 4]));
        vi.mocked(saveExperiment).mockResolvedValue({ success: true, experimentId: 'saved-local-1' });
        vi.mocked(getExperimentsCount).mockResolvedValue(0);
        useComparisonStore.getState().clear();
        useLicenseStore.setState({
            result: null,
            isInitialized: false,
            isLoading: false,
            status: 'invalid',
            isDemo: false,
            isExpired: false,
            isActive: false,
            daysRemaining: 0,
            experimentsRemaining: -1,
        });
        localStorage.clear();
        vi.mocked(saveBytes).mockResolvedValue();
        vi.mocked(saveBytesToDir).mockResolvedValue();
    });

    it('exposes isExporting=false and no error on mount', () => {
        const { result } = renderHook(() => useComparisonReportExport(makeOptions()));
        expect(result.current.isExporting).toBe(false);
        expect(result.current.isExcelExporting).toBe(false);
        expect(result.current.exportError).toBeNull();
    });

    // ── PDF ──────────────────────────────────────────────────────────────

    describe('handleDownloadPdf', () => {
        it('calls PDF by-ids generator and saves via saveBytes', async () => {
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
            await result.current.handleDownloadPdf();
        });

            expect(generateComparisonPdfReportByIdsBytes).toHaveBeenCalledTimes(1);
            const request = vi.mocked(generateComparisonPdfReportByIdsBytes).mock.calls[0][0];
            expect(request.experimentIds).toEqual(['1', '2']);
            expect(request.settings.language).toBe('en');
            expect(request.settings.unitSystem).toBe('SI');
            expect(request.settings.companyName).toBe('Acme');
            expect(request.settings.reportSettings.reportViscosityRates).toEqual([40, 100]);
            expect(request.settings.reportSettings.showAdvancedStats).toBe(true);
            expect(request.settings.reportSettings.showTemperature).toBe(true);
            expect(request.settings.reportSettings.showBathTemperature).toBe(false);
            expect(request.settings.reportSettings.shearRateAxis).toBe('right');
            expect(request.settings.reportSettings.rheologyUnits?.viscosity).toBe('cP');
            expect(request.settings.analysisSettings?.viscosityShearRates).toEqual([40, 100]);
            expect(request.settings.analysisSettings?.pointsToAverage).toBe(1);
            expect(request.settings.detectionSettings).toEqual({
                stepSplitting: true,
                splitStartDuration: 30,
                splitEndDuration: 30,
                minDurationForSplit: 90,
            });

            expect(saveBytes).toHaveBeenCalledTimes(1);
            const saveArgs = vi.mocked(saveBytes).mock.calls[0][0];
            expect(saveArgs.filename).toMatch(/^comparison-report_\d{4}-\d{2}-\d{2}\.pdf$/);
            expect(saveArgs.mimeType).toBe('application/pdf');
            expect(saveArgs.filters[0]).toEqual({ name: 'PDF Document', extensions: ['pdf'] });
        });

        it('forwards expert analysis settings into by-id comparison reports', async () => {
            const expertSettings = makeExpertSettings({
                pointsToAverage: 11,
                stepSplitting: false,
                splitStartDuration: 12,
                splitEndDuration: 13,
                minDurationForSplit: 140,
            });
            const { result } = renderHook(() =>
                useComparisonReportExport(makeOptions({
                    isExpert: true,
                    expertSettings,
                    reportViscosityRates: [40, 220],
                })),
            );

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            const request = vi.mocked(generateComparisonPdfReportByIdsBytes).mock.calls[0][0];
            expect(request.settings.analysisSettings).toEqual({
                pointsToAverage: 11,
                viscosityShearRates: [40, 220],
            });
            expect(request.settings.detectionSettings).toEqual({
                stepSplitting: false,
                splitStartDuration: 12,
                splitEndDuration: 13,
                minDurationForSplit: 140,
            });
        });

        it('forwards rheology source override into by-id comparison reports', async () => {
            const { result } = renderHook(() =>
                useComparisonReportExport(makeOptions({ rheologySourceOverride: 'program' })),
            );

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            const request = vi.mocked(generateComparisonPdfReportByIdsBytes).mock.calls[0][0];
            expect(request.settings.rheologySourceOverride).toBe('program');
        });

        it('surfaces generator errors onto exportError', async () => {
            vi.mocked(generateComparisonPdfReportByIdsBytes).mockRejectedValueOnce(new Error('License expired'));
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            expect(result.current.exportError).toContain('License expired');
            expect(result.current.isExporting).toBe(false);
            expect(saveBytes).not.toHaveBeenCalled();
        });

        it('guards against empty experiments', async () => {
            const { result } = renderHook(() => useComparisonReportExport(makeOptions({ experiments: [] })));

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            expect(generateComparisonPdfReportByIdsBytes).not.toHaveBeenCalled();
            expect(result.current.exportError).toMatch(/хотя бы один/);
        });

        it('autosaves file-backed experiments before by-id export', async () => {
            const confirmLocalFileSave = vi.fn().mockResolvedValue(true);
            const { result } = renderHook(() =>
                useComparisonReportExport(makeOptions({
                    experiments: [makeFileBackedExperiment()],
                    confirmLocalFileSave,
                })),
            );

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            expect(confirmLocalFileSave).toHaveBeenCalledWith({
                count: 1,
                fileNames: ['local.dat'],
                exportKind: 'pdf',
            });
            expect(saveExperiment).toHaveBeenCalledTimes(1);
            expect(generateComparisonPdfReportByIdsBytes).toHaveBeenCalledTimes(1);
            const request = vi.mocked(generateComparisonPdfReportByIdsBytes).mock.calls[0][0];
            expect(request.experimentIds).toEqual(['saved-local-1']);
            expect(saveBytes).toHaveBeenCalledTimes(1);
            expect(result.current.exportError).toBeNull();
        });

        it('autosaves two local files before exporting their saved ids', async () => {
            vi.mocked(saveExperiment)
                .mockResolvedValueOnce({ success: true, experimentId: 'db-1' })
                .mockResolvedValueOnce({ success: true, experimentId: 'db-2' });
            const confirmLocalFileSave = vi.fn().mockResolvedValue(true);
            const { result } = renderHook(() =>
                useComparisonReportExport(makeOptions({
                    experiments: [
                        makeFileBackedExperiment('file-one', 'one.dat'),
                        makeFileBackedExperiment('file-two', 'two.dat'),
                    ],
                    confirmLocalFileSave,
                })),
            );

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            expect(confirmLocalFileSave).toHaveBeenCalledWith({
                count: 2,
                fileNames: ['one.dat', 'two.dat'],
                exportKind: 'pdf',
            });
            expect(saveExperiment).toHaveBeenCalledTimes(2);
            expect(generateComparisonPdfReportByIdsBytes).toHaveBeenCalledTimes(1);
            expect(vi.mocked(generateComparisonPdfReportByIdsBytes).mock.calls[0][0].experimentIds)
                .toEqual(['db-1', 'db-2']);
            expect(result.current.exportError).toBeNull();
        });

        it('does not save or export when quota is lower than local file count', async () => {
            useLicenseStore.setState({
                result: {
                    status: 'demo',
                    source: 'demo',
                    experimentsRemaining: 1,
                } as never,
                isInitialized: true,
                isLoading: false,
                status: 'demo',
                isDemo: true,
                experimentsRemaining: 1,
            });
            const confirmLocalFileSave = vi.fn().mockResolvedValue(true);
            const { result } = renderHook(() =>
                useComparisonReportExport(makeOptions({
                    experiments: [
                        makeFileBackedExperiment('file-one', 'one.dat'),
                        makeFileBackedExperiment('file-two', 'two.dat'),
                    ],
                    confirmLocalFileSave,
                })),
            );

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            expect(confirmLocalFileSave).not.toHaveBeenCalled();
            expect(saveExperiment).not.toHaveBeenCalled();
            expect(generateComparisonPdfReportByIdsBytes).not.toHaveBeenCalled();
            expect(saveBytes).not.toHaveBeenCalled();
            expect(result.current.exportError).toContain('осталось 1');
        });

        it('does not save or export when the user cancels local-file save confirmation', async () => {
            const confirmLocalFileSave = vi.fn().mockResolvedValue(false);
            const { result } = renderHook(() =>
                useComparisonReportExport(makeOptions({
                    experiments: [makeFileBackedExperiment()],
                    confirmLocalFileSave,
                })),
            );

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            expect(confirmLocalFileSave).toHaveBeenCalledTimes(1);
            expect(saveExperiment).not.toHaveBeenCalled();
            expect(generateComparisonPdfReportByIdsBytes).not.toHaveBeenCalled();
            expect(saveBytes).not.toHaveBeenCalled();
            expect(result.current.exportError).toBeNull();
        });

        it('does not export or partially replace comparison state when a later local save fails', async () => {
            const first = makeFileBackedExperiment('file-one', 'one.dat');
            const second = makeFileBackedExperiment('file-two', 'two.dat');
            useComparisonStore.getState().addExperiment(first);
            useComparisonStore.getState().addExperiment(second);
            vi.mocked(saveExperiment)
                .mockResolvedValueOnce({ success: true, experimentId: 'db-1' })
                .mockResolvedValueOnce({ success: false, error: 'Disk write failed' });
            const { result } = renderHook(() =>
                useComparisonReportExport(makeOptions({
                    experiments: [first, second],
                    confirmLocalFileSave: vi.fn().mockResolvedValue(true),
                })),
            );

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            expect(saveExperiment).toHaveBeenCalledTimes(2);
            expect(generateComparisonPdfReportByIdsBytes).not.toHaveBeenCalled();
            expect(saveBytes).not.toHaveBeenCalled();
            expect(result.current.exportError).toContain('two.dat');
            expect(result.current.exportError).toContain('Disk write failed');
            expect(useComparisonStore.getState().experimentIds).toEqual(['file-one', 'file-two']);
        });

        it('does not autosave again after a file-backed experiment was replaced', async () => {
            const confirmLocalFileSave = vi.fn().mockResolvedValue(true);
            const { result } = renderHook(() =>
                useComparisonReportExport(makeOptions({
                    experiments: [makeFileBackedExperiment()],
                    confirmLocalFileSave,
                })),
            );

            await act(async () => {
                await result.current.handleDownloadPdf();
            });
            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            expect(confirmLocalFileSave).toHaveBeenCalledTimes(1);
            expect(saveExperiment).toHaveBeenCalledTimes(1);
            expect(generateComparisonPdfReportByIdsBytes).toHaveBeenCalledTimes(2);
            expect(vi.mocked(generateComparisonPdfReportByIdsBytes).mock.calls[1][0].experimentIds)
                .toEqual(['saved-local-1']);
        });

        it('does not autosave when the trial save limit is exhausted', async () => {
            useLicenseStore.setState({
                result: {
                    status: 'demo',
                    source: 'demo',
                    experimentsRemaining: 0,
                    message: 'Пробный лимит исчерпан.',
                } as never,
                isInitialized: true,
                isLoading: false,
                status: 'demo',
                isDemo: true,
                experimentsRemaining: 0,
            });
            const { result } = renderHook(() =>
                useComparisonReportExport(makeOptions({
                    experiments: [makeFileBackedExperiment()],
                })),
            );

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            expect(saveExperiment).not.toHaveBeenCalled();
            expect(generateComparisonPdfReportByIdsBytes).not.toHaveBeenCalled();
            expect(saveBytes).not.toHaveBeenCalled();
            expect(result.current.exportError).toContain('Пробный лимит');
        });

        it('clears previous errors on clearError()', async () => {
            vi.mocked(generateComparisonPdfReportByIdsBytes).mockRejectedValueOnce(new Error('boom'));
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

        it('surfaces by-ids IPC unavailability without legacy payload fallback', async () => {
            vi.mocked(generateComparisonPdfReportByIdsBytes).mockRejectedValueOnce(
                new Error('Unknown IPC command reports_generate_comparison_pdf_by_ids'),
            );
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
                await result.current.handleDownloadPdf();
            });

            expect(generateComparisonPdfReportByIdsBytes).toHaveBeenCalledTimes(1);
            expect(saveBytes).not.toHaveBeenCalled();
            expect(result.current.exportError).toContain('reports_generate_comparison_pdf_by_ids');
        });

        it('emits a buffer-release diagnostic event after saving PDF bytes', async () => {
            const releases: unknown[] = [];
            const onRelease = (event: Event) => {
                releases.push((event as CustomEvent).detail);
            };
            window.addEventListener('rheolab:comparison-export-buffers-released', onRelease);

            try {
                const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

                await act(async () => {
                    await result.current.handleDownloadPdf();
                });
            } finally {
                window.removeEventListener('rheolab:comparison-export-buffers-released', onRelease);
            }

            expect(releases).toEqual([{ kind: 'pdf' }]);
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

            const request = vi.mocked(generateComparisonPdfReportByIdsBytes).mock.calls[0][0];
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

            const request = vi.mocked(generateComparisonPdfReportByIdsBytes).mock.calls[0][0];
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

            const request = vi.mocked(generateComparisonPdfReportByIdsBytes).mock.calls[0][0];
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

            const request = vi.mocked(generateComparisonExcelReportByIdsBytes).mock.calls[0][0];
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

            expect(generateComparisonExcelReportByIdsBytes).toHaveBeenCalledTimes(1);
            const request = vi.mocked(generateComparisonExcelReportByIdsBytes).mock.calls[0][0];
            expect(request.experimentIds).toEqual(['1', '2']);
            const saveArgs = vi.mocked(saveBytes).mock.calls[0][0];
            expect(saveArgs.filename).toMatch(/\.xlsx$/);
            expect(saveArgs.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            expect(saveArgs.filters[0]).toEqual({ name: 'Excel Spreadsheet', extensions: ['xlsx'] });
        });

        it('autosaves file-backed experiments before Excel by-id export', async () => {
            const { result } = renderHook(() =>
                useComparisonReportExport(makeOptions({
                    experiments: [makeFileBackedExperiment()],
                })),
            );

            await act(async () => {
                await result.current.handleDownloadExcel();
            });

            expect(saveExperiment).toHaveBeenCalledTimes(1);
            expect(generateComparisonExcelReportByIdsBytes).toHaveBeenCalledTimes(1);
            const request = vi.mocked(generateComparisonExcelReportByIdsBytes).mock.calls[0][0];
            expect(request.experimentIds).toEqual(['saved-local-1']);
            expect(saveBytes).toHaveBeenCalledTimes(1);
            expect(result.current.exportError).toBeNull();
        });
    });

    // ── Combined download ───────────────────────────────────────────────

    describe('handleDownloadAll', () => {
        it('falls back to single-format handler when only one flag is set', async () => {
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
            await result.current.handleDownloadAll(true, false);
        });

            expect(generateComparisonPdfReportByIdsBytes).toHaveBeenCalledTimes(1);
            expect(generateComparisonExcelReportByIdsBytes).not.toHaveBeenCalled();
            expect(saveBytes).toHaveBeenCalledTimes(1);
            expect(saveBytesToDir).not.toHaveBeenCalled();
        });

        it('saves PDF + Excel to one directory when both flags are set', async () => {
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
                await result.current.handleDownloadAll(true, true);
            });

            expect(generateComparisonPdfReportByIdsBytes).toHaveBeenCalledTimes(1);
            expect(generateComparisonExcelReportByIdsBytes).toHaveBeenCalledTimes(1);
            expect(saveBytesToDir).toHaveBeenCalledTimes(1);
            const items = vi.mocked(saveBytesToDir).mock.calls[0][0];
            expect(items).toHaveLength(2);
            expect(items.map(i => i.filename)).toEqual(
                expect.arrayContaining([expect.stringMatching(/\.pdf$/), expect.stringMatching(/\.xlsx$/)]),
            );
        });

        it('autosaves a file-backed experiment once for combined PDF + Excel export', async () => {
            const { result } = renderHook(() =>
                useComparisonReportExport(makeOptions({
                    experiments: [makeFileBackedExperiment()],
                })),
            );

            await act(async () => {
                await result.current.handleDownloadAll(true, true);
            });

            expect(saveExperiment).toHaveBeenCalledTimes(1);
            expect(generateComparisonPdfReportByIdsBytes).toHaveBeenCalledTimes(1);
            expect(generateComparisonExcelReportByIdsBytes).toHaveBeenCalledTimes(1);
            expect(vi.mocked(generateComparisonPdfReportByIdsBytes).mock.calls[0][0].experimentIds)
                .toEqual(['saved-local-1']);
            expect(vi.mocked(generateComparisonExcelReportByIdsBytes).mock.calls[0][0].experimentIds)
                .toEqual(['saved-local-1']);
            expect(saveBytesToDir).toHaveBeenCalledTimes(1);
        });

        it('emits one combined buffer-release diagnostic event after saving both formats', async () => {
            const releases: unknown[] = [];
            const onRelease = (event: Event) => {
                releases.push((event as CustomEvent).detail);
            };
            window.addEventListener('rheolab:comparison-export-buffers-released', onRelease);

            try {
                const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

                await act(async () => {
                    await result.current.handleDownloadAll(true, true);
                });
            } finally {
                window.removeEventListener('rheolab:comparison-export-buffers-released', onRelease);
            }

            expect(releases).toEqual([{ kind: 'all' }]);
        });

        it('does nothing when both format flags are false', async () => {
            const { result } = renderHook(() => useComparisonReportExport(makeOptions()));

            await act(async () => {
                await result.current.handleDownloadAll(false, false);
            });

            expect(generateComparisonPdfReportByIdsBytes).not.toHaveBeenCalled();
            expect(generateComparisonExcelReportByIdsBytes).not.toHaveBeenCalled();
            expect(saveBytes).not.toHaveBeenCalled();
            expect(saveBytesToDir).not.toHaveBeenCalled();
        });
    });
});
