import { useCallback, useMemo, useState } from 'react';
import type {
    ComparisonReportByIdsSettings,
    ExperimentReportByIdRequest,
    ExperimentReportRecipeOverride,
    ExperimentReportWaterOverride,
} from '@/types/tauri';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import type { ExpertSettings } from '@/lib/store/analysis-settings-store';
import type { RecipeComponent } from '@/lib/parsing/types';
import type { RheologyParameterSource, WaterParams } from '@/types';
import type { ReportChartLineSettings } from '@/lib/analysis/report-types/report-inputs';
import {
    generateExcelReportByIdBytes,
    generatePdfReportByIdBytes,
} from '@/lib/reports/client';
import { saveBytes, saveBytesToDir, type SaveBytesItem } from '@/lib/reports/report-save';
import { logger } from '@/lib/logger';
import { DEFAULT_VISCOSITY_SHEAR_RATES } from '@/lib/analysis/constants';
import { toFiniteNumber } from '@/lib/utils/numbers';

const PDF_MIME = 'application/pdf';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface UseReportExportByIdOptions {
    experimentId: string;
    filename: string;
    editedRecipe: RecipeComponent[];
    editedWaterParams: Partial<WaterParams> | null;
    editedWaterSource: string;
    language: 'ru' | 'en';
    unitSystem: 'SI' | 'SI_Pas' | 'Imperial';
    showTouchPoints: boolean;
    viscosityThreshold: number;
    showTargetTime: boolean;
    targetTime: number;
    showCalibration: boolean;
    showRawData: boolean;
    showRecipe: boolean;
    showWaterAnalysis: boolean;
    rheologySourceOverride?: RheologyParameterSource;
    reportViscosityRates: number[];
    isExpert: boolean;
    companyName: string;
    companyLogo: string | null;
    chartSettings: ChartSettings;
    expertSettings: ExpertSettings;
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function buildLineSettings(chartSettings: ChartSettings): ReportChartLineSettings {
    return {
        viscosity: {
            color: chartSettings.lines.viscosity.color,
            width: chartSettings.lines.viscosity.width,
            style: chartSettings.lines.viscosity.style,
        },
        temperature: {
            color: chartSettings.lines.temperature.color,
            width: chartSettings.lines.temperature.width,
            style: chartSettings.lines.temperature.style,
        },
        shearRate: {
            color: chartSettings.lines.shearRate.color,
            width: chartSettings.lines.shearRate.width,
            style: chartSettings.lines.shearRate.style,
        },
        pressure: {
            color: chartSettings.lines.pressure.color,
            width: chartSettings.lines.pressure.width,
            style: chartSettings.lines.pressure.style,
        },
        rpm: {
            color: chartSettings.lines.rpm.color,
            width: chartSettings.lines.rpm.width,
            style: chartSettings.lines.rpm.style,
        },
        bathTemperature: {
            color: chartSettings.lines.bathTemperature.color,
            width: chartSettings.lines.bathTemperature.width,
            style: chartSettings.lines.bathTemperature.style,
        },
    };
}

function buildRecipeOverride(recipe: RecipeComponent[]): ExperimentReportRecipeOverride[] {
    return recipe.map((item) => {
        const withBatch = item as RecipeComponent & { batchNumber?: string };
        return {
            name: item.reagentName || item.abbreviation || 'Unknown Component',
            concentration: finiteNumber(item.concentration) ?? 0,
            unit: item.unit || 'кг/м³',
            category: item.category,
            batchNumber: withBatch.batchNumber,
        };
    });
}

function buildWaterOverride(
    source: string,
    params: Partial<WaterParams> | null,
): ExperimentReportWaterOverride | undefined {
    if (!params && !source.trim()) {
        return undefined;
    }
    return {
        source: source || undefined,
        salinity: finiteNumber((params as { salinity?: unknown } | null)?.salinity),
        ph: finiteNumber(params?.ph),
        hardness: finiteNumber((params as { hardness?: unknown } | null)?.hardness),
        fe: finiteNumber(params?.fe),
        ca: finiteNumber(params?.ca),
        mg: finiteNumber(params?.mg),
        cl: finiteNumber(params?.cl),
        so4: finiteNumber(params?.so4),
        hco3: finiteNumber(params?.hco3),
    };
}

function sanitizeRates(rates: readonly number[]): number[] {
    const unique = new Set<number>();
    for (const rate of rates) {
        if (!Number.isFinite(rate) || rate <= 0) continue;
        unique.add(Math.round(rate));
    }
    return unique.size > 0 ? [...unique] : [...DEFAULT_VISCOSITY_SHEAR_RATES];
}

type ReportByIdExportKind = 'pdf' | 'excel' | 'all';

function emitReportByIdRequest(kind: ReportByIdExportKind, request: ExperimentReportByIdRequest): void {
    if (typeof window === 'undefined') return;

    try {
        const hook = (window as unknown as {
            __RHEOLAB_REPORT_BY_ID_REQUEST_HOOK__?: (event: {
                kind: ReportByIdExportKind;
                request: ExperimentReportByIdRequest;
            }) => void;
        }).__RHEOLAB_REPORT_BY_ID_REQUEST_HOOK__;
        if (typeof hook === 'function') {
            hook({ kind, request });
        }
    } catch {
        // Best-effort E2E observer only. Report export must not depend on it.
    }
}

export function useReportExportById(options: UseReportExportByIdOptions) {
    const [isExporting, setIsExporting] = useState(false);
    const [isExcelExporting, setIsExcelExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);

    const baseFilename = useMemo(() => {
        const date = new Date().toISOString().split('T')[0];
        return `${options.filename || 'report'}_${date}`;
    }, [options.filename]);

    const buildRequest = useCallback((): ExperimentReportByIdRequest => {
        const reportViscosityRates = sanitizeRates(
            options.isExpert ? options.reportViscosityRates : DEFAULT_VISCOSITY_SHEAR_RATES,
        );
        const pointsToAverage = Math.max(
            0,
            Math.round(toFiniteNumber(options.isExpert ? options.expertSettings.pointsToAverage : 1, 1)),
        );
        const detectionSettings = {
            stepSplitting: options.isExpert ? Boolean(options.expertSettings.stepSplitting) : true,
            splitStartDuration: Math.max(
                0,
                toFiniteNumber(options.isExpert ? options.expertSettings.splitStartDuration : 30, 30),
            ),
            splitEndDuration: Math.max(
                0,
                toFiniteNumber(options.isExpert ? options.expertSettings.splitEndDuration : 30, 30),
            ),
            minDurationForSplit: Math.max(
                0,
                toFiniteNumber(options.isExpert ? options.expertSettings.minDurationForSplit : 90, 90),
            ),
        };
        const settings: ComparisonReportByIdsSettings = {
            language: options.language,
            unitSystem: options.unitSystem,
            companyName: options.companyName || undefined,
            companyLogoBase64: options.companyLogo ?? undefined,
            generatedAt: new Date().toISOString(),
            rheologySourceOverride: options.rheologySourceOverride,
            comparisonChart: {
                metrics: {
                    primary: 'viscosity_cp',
                    leftSecondary: 'none',
                    secondary: 'temperature_c',
                    tertiary: 'none',
                },
                axisMode: options.chartSettings.comparisonAxisMode ?? 'individual',
                touchPoint: {
                    enabled: options.showTouchPoints,
                    viscosityThreshold: options.viscosityThreshold,
                    showTargetTime: options.showTargetTime,
                    targetTime: options.targetTime,
                },
                lineSettings: buildLineSettings(options.chartSettings),
                experimentColors: [options.chartSettings.lines.viscosity.color || '#3b82f6'],
                timeFormat: options.chartSettings.rheologyUnits.timeFormat,
                downsampleMode: options.chartSettings.downsampleMode === 'aggressive'
                    ? 'fast'
                    : options.chartSettings.downsampleMode,
            },
            sectionToggles: {
                showCalibration: options.showCalibration,
                showRawData: options.showRawData,
                showRecipe: options.showRecipe,
                showWaterAnalysis: options.showWaterAnalysis,
                showRheology: true,
            },
            reportSettings: {
                showTemperature: options.chartSettings.lines.temperature.visible,
                showShearRate: options.chartSettings.lines.shearRate.visible,
                showPressure: options.chartSettings.lines.pressure.visible,
                showBathTemperature: options.chartSettings.lines.bathTemperature.visible,
                shearRateAxis: options.chartSettings.lines.shearRate.axis,
                pressureAxis: options.chartSettings.lines.pressure.axis,
                showAdvancedStats: true,
                reportViscosityRates,
                rheologyUnits: {
                    viscosity: options.chartSettings.rheologyUnits.viscosity,
                    temperature: options.chartSettings.rheologyUnits.temperature,
                    pressure: options.chartSettings.rheologyUnits.pressure,
                    consistency: options.chartSettings.rheologyUnits.consistency,
                    plasticViscosity: options.chartSettings.rheologyUnits.plasticViscosity,
                    yieldPoint: options.chartSettings.rheologyUnits.yieldPoint,
                    timeFormat: options.chartSettings.rheologyUnits.timeFormat,
                },
            },
            analysisSettings: {
                pointsToAverage,
                viscosityShearRates: reportViscosityRates,
            },
            detectionSettings,
        };

        return {
            experimentId: options.experimentId,
            settings,
            recipeOverride: options.showRecipe ? buildRecipeOverride(options.editedRecipe) : undefined,
            waterOverride: options.showWaterAnalysis
                ? buildWaterOverride(options.editedWaterSource, options.editedWaterParams)
                : undefined,
        };
    }, [
        options.chartSettings,
        options.companyLogo,
        options.companyName,
        options.editedRecipe,
        options.editedWaterParams,
        options.editedWaterSource,
        options.experimentId,
        options.expertSettings,
        options.isExpert,
        options.language,
        options.reportViscosityRates,
        options.showCalibration,
        options.showRawData,
        options.showRecipe,
        options.rheologySourceOverride,
        options.showTargetTime,
        options.showTouchPoints,
        options.showWaterAnalysis,
        options.targetTime,
        options.unitSystem,
        options.viscosityThreshold,
    ]);

    const handleDownload = useCallback(async () => {
        setIsExporting(true);
        setExportError(null);
        let bytes: Uint8Array | null = null;
        try {
            const request = buildRequest();
            emitReportByIdRequest('pdf', request);
            bytes = await generatePdfReportByIdBytes(request);
            await saveBytes({
                bytes,
                filename: `${baseFilename}.pdf`,
                mimeType: PDF_MIME,
                filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
            });
        } catch (err) {
            logger.error('[ReportsPanel] PDF by-id generation failed:', err);
            const errorMessage = err instanceof Error ? err.message : String(err);
            setExportError(`Ошибка генерации PDF: ${errorMessage}`);
        } finally {
            bytes = null;
            setIsExporting(false);
        }
    }, [baseFilename, buildRequest]);

    const handleExcelDownload = useCallback(async () => {
        setIsExcelExporting(true);
        setExportError(null);
        let bytes: Uint8Array | null = null;
        try {
            const request = buildRequest();
            emitReportByIdRequest('excel', request);
            bytes = await generateExcelReportByIdBytes(request);
            await saveBytes({
                bytes,
                filename: `${baseFilename}.xlsx`,
                mimeType: XLSX_MIME,
                filters: [{ name: 'Excel Spreadsheet', extensions: ['xlsx'] }],
            });
        } catch (err) {
            logger.error('[ReportsPanel] Excel by-id generation failed:', err);
            const errorMessage = err instanceof Error ? err.message : String(err);
            setExportError(`Ошибка генерации Excel: ${errorMessage}`);
        } finally {
            bytes = null;
            setIsExcelExporting(false);
        }
    }, [baseFilename, buildRequest]);

    const handleDownloadAll = useCallback(async (wantPdf: boolean, wantExcel: boolean) => {
        if (!wantPdf && !wantExcel) return;
        if (wantPdf && !wantExcel) {
            await handleDownload();
            return;
        }
        if (!wantPdf && wantExcel) {
            await handleExcelDownload();
            return;
        }

        setIsExporting(true);
        setIsExcelExporting(true);
        setExportError(null);
        const items: SaveBytesItem[] = [];
        let pdfBytes: Uint8Array | null = null;
        let excelBytes: Uint8Array | null = null;
        try {
            const request = buildRequest();
            emitReportByIdRequest('all', request);
            pdfBytes = await generatePdfReportByIdBytes(request);
            items.push({ bytes: pdfBytes, filename: `${baseFilename}.pdf`, mimeType: PDF_MIME });
            excelBytes = await generateExcelReportByIdBytes(request);
            items.push({ bytes: excelBytes, filename: `${baseFilename}.xlsx`, mimeType: XLSX_MIME });
            await saveBytesToDir(items);
        } catch (err) {
            logger.error('[ReportsPanel] Combined by-id export failed:', err);
            const errorMessage = err instanceof Error ? err.message : String(err);
            setExportError(`Ошибка генерации отчёта: ${errorMessage}`);
        } finally {
            pdfBytes = null;
            excelBytes = null;
            items.length = 0;
            setIsExporting(false);
            setIsExcelExporting(false);
        }
    }, [baseFilename, buildRequest, handleDownload, handleExcelDownload]);

    return {
        isExporting,
        isExcelExporting,
        isCapturing: false,
        exportError,
        clearError: useCallback(() => setExportError(null), []),
        handleDownload,
        handleExcelDownload,
        handleDownloadAll,
    };
}
