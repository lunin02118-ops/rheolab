// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/reports/client', () => ({
    generatePdfReportByIdBytes: vi.fn(),
    generateExcelReportByIdBytes: vi.fn(),
}));

vi.mock('@/lib/reports/report-save', () => ({
    saveBytes: vi.fn(),
    saveBytesToDir: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
    logger: {
        error: vi.fn(),
    },
}));

import { DEFAULT_VISCOSITY_SHEAR_RATES } from '@/lib/analysis/constants';
import { DEFAULT_CHART_SETTINGS } from '@/lib/store/chart-settings-defaults';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import type { ExpertSettings } from '@/lib/store/analysis-settings-store';
import type { WaterParams } from '@/types';
import {
    generateExcelReportByIdBytes,
    generatePdfReportByIdBytes,
} from '@/lib/reports/client';
import { saveBytes, saveBytesToDir } from '@/lib/reports/report-save';
import {
    useReportExportById,
    type UseReportExportByIdOptions,
} from '@/components/reports/hooks/useReportExportById';

function makeChartSettings(): ChartSettings {
    return structuredClone(DEFAULT_CHART_SETTINGS);
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

function makeOptions(overrides: Partial<UseReportExportByIdOptions> = {}): UseReportExportByIdOptions {
    return {
        experimentId: 'exp_aaaaaaaaaaaaaaaaaaaa',
        filename: 'saved-report',
        editedRecipe: [],
        editedWaterParams: null,
        editedWaterSource: '',
        language: 'en',
        unitSystem: 'SI',
        showTouchPoints: false,
        viscosityThreshold: 0,
        showTargetTime: false,
        targetTime: 0,
        showCalibration: false,
        showRawData: false,
        showRecipe: false,
        showWaterAnalysis: false,
        reportViscosityRates: [40, 100],
        isExpert: false,
        companyName: 'Acme',
        companyLogo: null,
        chartSettings: makeChartSettings(),
        expertSettings: makeExpertSettings(),
        ...overrides,
    };
}

describe('useReportExportById', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(generatePdfReportByIdBytes).mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
        vi.mocked(generateExcelReportByIdBytes).mockResolvedValue(new Uint8Array([80, 75, 3, 4]));
        vi.mocked(saveBytes).mockResolvedValue();
        vi.mocked(saveBytesToDir).mockResolvedValue();
    });

    it('uses beginner analysis defaults even when expert settings are mutated', async () => {
        const { result } = renderHook(() =>
            useReportExportById(
                makeOptions({
                    isExpert: false,
                    reportViscosityRates: [999],
                    expertSettings: makeExpertSettings({
                        pointsToAverage: 999,
                        viscosityShearRates: [333],
                        stepSplitting: false,
                        splitStartDuration: 1,
                        splitEndDuration: 2,
                        minDurationForSplit: 3,
                    }),
                }),
            ),
        );

        await act(async () => {
            await result.current.handleDownload();
        });

        const request = vi.mocked(generatePdfReportByIdBytes).mock.calls[0][0];
        expect(request.settings.reportSettings.showAdvancedStats).toBe(true);
        expect(request.settings.reportSettings.reportViscosityRates).toEqual([...DEFAULT_VISCOSITY_SHEAR_RATES]);
        expect(request.settings.analysisSettings).toEqual({
            pointsToAverage: 1,
            viscosityShearRates: [...DEFAULT_VISCOSITY_SHEAR_RATES],
        });
        expect(request.settings.detectionSettings).toEqual({
            stepSplitting: true,
            splitStartDuration: 30,
            splitEndDuration: 30,
            minDurationForSplit: 90,
        });
    });

    it('forwards expert analysis settings in expert mode', async () => {
        const expertSettings = makeExpertSettings({
            pointsToAverage: 12,
            viscosityShearRates: [40, 220],
            stepSplitting: false,
            splitStartDuration: 11,
            splitEndDuration: 12,
            minDurationForSplit: 120,
        });
        const { result } = renderHook(() =>
            useReportExportById(
                makeOptions({
                    isExpert: true,
                    reportViscosityRates: [40, 220],
                    expertSettings,
                }),
            ),
        );

        await act(async () => {
            await result.current.handleDownload();
        });

        const request = vi.mocked(generatePdfReportByIdBytes).mock.calls[0][0];
        expect(request.settings.reportSettings.showAdvancedStats).toBe(true);
        expect(request.settings.analysisSettings).toEqual({
            pointsToAverage: 12,
            viscosityShearRates: [40, 220],
        });
        expect(request.settings.detectionSettings).toEqual({
            stepSplitting: false,
            splitStartDuration: 11,
            splitEndDuration: 12,
            minDurationForSplit: 120,
        });
    });

    it('forwards rheology source override for saved by-id exports', async () => {
        const { result } = renderHook(() =>
            useReportExportById(
                makeOptions({
                    rheologySourceOverride: 'instrument',
                }),
            ),
        );

        await act(async () => {
            await result.current.handleDownload();
        });

        const request = vi.mocked(generatePdfReportByIdBytes).mock.calls[0][0];
        expect(request.settings.rheologySourceOverride).toBe('instrument');
    });

    it('includes full water override fields for saved by-id exports', async () => {
        const waterParams = {
            salinity: 1234,
            ph: 8.2,
            hardness: 44,
            fe: 0.12,
            ca: 12.3,
            mg: 4.5,
            cl: 89,
            so4: 7.8,
            hco3: 145,
        } as Partial<WaterParams>;
        const { result } = renderHook(() =>
            useReportExportById(
                makeOptions({
                    showWaterAnalysis: true,
                    editedWaterSource: 'Edited water',
                    editedWaterParams: waterParams,
                }),
            ),
        );

        await act(async () => {
            await result.current.handleDownload();
        });

        const request = vi.mocked(generatePdfReportByIdBytes).mock.calls[0][0];
        expect(request.waterOverride).toEqual({
            source: 'Edited water',
            salinity: 1234,
            ph: 8.2,
            hardness: 44,
            fe: 0.12,
            ca: 12.3,
            mg: 4.5,
            cl: 89,
            so4: 7.8,
            hco3: 145,
        });
    });
});
