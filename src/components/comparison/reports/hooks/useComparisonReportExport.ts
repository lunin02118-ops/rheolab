/**
 * @fileoverview React hook encapsulating comparison-report export logic
 * (PDF + Excel + combined).
 *
 * Mirrors `@/components/reports/hooks/useReportExport` for single
 * experiments, but feeds N per-experiment payloads + one shared chart
 * config through the Rust comparison pipeline.
 *
 * @module comparison/reports/hooks/useComparisonReportExport
 */

import { useCallback, useMemo, useState } from 'react';
import type { Experiment } from '@/types';
import type { ComparisonReportByIdsRequest } from '@/types/tauri';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import type { ComparisonDisplaySettings } from '@/lib/store/comparison-store';
import type {
    ComparisonChartConfig,
    ComparisonSectionToggles,
    ReportChartLineSettings,
} from '@/lib/analysis/report-types/types';

import {
    generateComparisonExcelReportByIdsBytes,
    generateComparisonPdfReportByIdsBytes,
} from '@/lib/reports/client';
import { saveBytes, saveBytesToDir, type SaveBytesItem } from '@/lib/reports/report-save';
import { EXPERIMENT_COLORS } from '@/components/comparison/comparison-chart-constants';
import { logger } from '@/lib/logger';

// ── Public options ─────────────────────────────────────────────────────────

export interface UseComparisonReportExportOptions {
    experiments: Experiment[];
    displaySettings: ComparisonDisplaySettings;
    chartSettings: ChartSettings;
    /**
     * Optional [minMinutes, maxMinutes] brush window captured from the
     * live comparison chart at the moment the user clicked "Generate".
     * Leave undefined to render the full data range.
     */
    brushRange?: [number, number];

    language: 'ru' | 'en';
    unitSystem: 'SI' | 'SI_Pas' | 'Imperial';
    companyName: string;
    companyLogo: string | null;

    /** Global section toggles applied uniformly to every experiment (MVP). */
    showCalibration: boolean;
    showRawData: boolean;
    showRecipe: boolean;
    showWaterAnalysis: boolean;
    showRheology: boolean;

    reportViscosityRates: number[];
    isExpert: boolean;
}

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Build the snake_case-ready `line_settings` object by mirroring the
 * single-exp line-settings helper — duplicated here rather than imported
 * to avoid reaching into the single-exp internals.  Field names mirror
 * {@link ReportChartLineSettings}.
 */
function buildLineSettingsForComparison(cs: ChartSettings): ReportChartLineSettings {
    return {
        viscosity: {
            color: cs.lines.viscosity.color,
            width: cs.lines.viscosity.width,
            style: cs.lines.viscosity.style,
        },
        temperature: {
            color: cs.lines.temperature.color,
            width: cs.lines.temperature.width,
            style: cs.lines.temperature.style,
        },
        shearRate: {
            color: cs.lines.shearRate.color,
            width: cs.lines.shearRate.width,
            style: cs.lines.shearRate.style,
        },
        pressure: {
            color: cs.lines.pressure.color,
            width: cs.lines.pressure.width,
            style: cs.lines.pressure.style,
        },
        rpm: {
            color: cs.lines.rpm.color,
            width: cs.lines.rpm.width,
            style: cs.lines.rpm.style,
        },
        bathTemperature: {
            color: cs.lines.bathTemperature.color,
            width: cs.lines.bathTemperature.width,
            style: cs.lines.bathTemperature.style,
        },
    };
}

function buildComparisonChartConfig(
    displaySettings: ComparisonDisplaySettings,
    chartSettings: ChartSettings,
    brushRange: [number, number] | undefined,
): ComparisonChartConfig {
    return {
        metrics: {
            primary: displaySettings.primaryMetric,
            leftSecondary: displaySettings.leftSecondaryMetric,
            secondary: displaySettings.secondaryMetric,
            tertiary: displaySettings.tertiaryMetric,
        },
        // Fallback `'individual'` mirrors the store's real default
        // (`chart-settings-defaults.ts`: `comparisonAxisMode: 'individual'`).
        // Keeping the fallback at `'shared'` silently crushed extra
        // metrics (e.g. shear-rate on the left) onto the viscosity scale
        // when persisted state was missing this key — user report
        // 2026-04-24: "Раздельные оси сломаны!".
        axisMode: chartSettings.comparisonAxisMode ?? 'individual',
        brushRange,
        touchPoint: {
            enabled: displaySettings.showTouchPoints,
            viscosityThreshold: displaySettings.viscosityThreshold,
            showTargetTime: displaySettings.showTargetTime,
            targetTime: displaySettings.targetTime,
        },
        lineSettings: buildLineSettingsForComparison(chartSettings),
        experimentColors: [...EXPERIMENT_COLORS],
        timeFormat: chartSettings.rheologyUnits?.timeFormat,
    };
}

const DEFAULT_SECTION_TOGGLES: ComparisonSectionToggles = {
    showCalibration: false,
    showRawData: false,
    showRecipe: false,
    showWaterAnalysis: false,
    showRheology: true,
};

const PDF_MIME = 'application/pdf';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type ComparisonExportKind = 'pdf' | 'excel' | 'all';

function releaseComparisonExportBuffers(kind: ComparisonExportKind): void {
    if (typeof window === 'undefined') return;

    try {
        if (typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function') {
            for (const entry of performance.getEntriesByType('measure')) {
                if (entry.name.startsWith('cmp:')) {
                    performance.clearMeasures(entry.name);
                }
            }
        }
    } catch {
        // Best-effort cleanup only. Export success/failure must not depend on
        // browser User Timing support.
    }

    try {
        window.dispatchEvent(new CustomEvent('rheolab:comparison-export-buffers-released', {
            detail: { kind },
        }));
    } catch {
        // Non-fatal diagnostic hook for perf runners.
    }
}

// ── Sprint 0 / S0-6: comparison-flow perf instrumentation ──────────────────
//
// Lightweight wrapper around an async stage of the comparison-export
// pipeline.  Emits `performance.measure` entries (visible in DevTools →
// Performance) and a `logger.debug` line so headless workflow tests can
// grep durations.  Names use the stable `cmp:` prefix so a Sprint-1
// perf:compare run can filter the User Timing entries deterministically.
//
// The architectural goal of Sprint 1+ is to push the heavy `buildPayload`
// stage into Rust (native by-ids comparison reports), so we measure it
// **separately** from the IPC roundtrip and save-dialog stages.  The
// expected shape after Sprint 1: `cmp:pdf:buildPayload` collapses to a
// few ms, `cmp:pdf:ipcRoundtrip` absorbs what was previously TS work.
async function withPerf<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const startMark = `cmp:${name}:start`;
    const endMark = `cmp:${name}:end`;
    performance.mark(startMark);
    try {
        return await fn();
    } finally {
        performance.mark(endMark);
        try {
            const m = performance.measure(`cmp:${name}`, startMark, endMark);
            logger.debug(`[perf:cmp] ${name}: ${m.duration.toFixed(1)} ms`);
        } catch {
            // performance.measure can throw if a same-named mark was
            // cleared by a parallel call.  Keep the failure non-fatal —
            // report generation must never break because of instrumentation.
        }
        performance.clearMarks(startMark);
        performance.clearMarks(endMark);
    }
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useComparisonReportExport(options: UseComparisonReportExportOptions) {
    const [isExporting, setIsExporting] = useState(false);
    const [isExcelExporting, setIsExcelExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);

    const comparisonChartConfig = useMemo(
        () => buildComparisonChartConfig(options.displaySettings, options.chartSettings, options.brushRange),
        [options.displaySettings, options.chartSettings, options.brushRange],
    );

    const buildByIdsRequest = useCallback((): ComparisonReportByIdsRequest => ({
        experimentIds: options.experiments.map((exp) => exp.id),
        settings: {
            language: options.language,
            unitSystem: options.unitSystem,
            companyName: options.companyName || undefined,
            companyLogoBase64: options.companyLogo ?? undefined,
            generatedAt: new Date().toISOString(),
            comparisonChart: comparisonChartConfig,
            sectionToggles: {
                ...DEFAULT_SECTION_TOGGLES,
                showCalibration: options.showCalibration,
                showRawData: options.showRawData,
                showRecipe: options.showRecipe,
                showWaterAnalysis: options.showWaterAnalysis,
                showRheology: options.showRheology,
            },
            reportSettings: {
                showTemperature: options.chartSettings.lines.temperature.visible,
                showShearRate: options.chartSettings.lines.shearRate.visible,
                showPressure: options.chartSettings.lines.pressure.visible,
                showBathTemperature: options.chartSettings.lines.bathTemperature.visible,
                shearRateAxis: options.chartSettings.lines.shearRate.axis,
                pressureAxis: options.chartSettings.lines.pressure.axis,
                showAdvancedStats: options.isExpert,
                reportViscosityRates: options.reportViscosityRates,
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
                pointsToAverage: 0,
                viscosityShearRates: options.reportViscosityRates,
            },
        },
    }), [
        comparisonChartConfig,
        options.experiments,
        options.language,
        options.unitSystem,
        options.companyName,
        options.companyLogo,
        options.showCalibration,
        options.showRawData,
        options.showRecipe,
        options.showWaterAnalysis,
        options.showRheology,
        options.chartSettings,
        options.isExpert,
        options.reportViscosityRates,
    ]);

    const generatePdfBytes = useCallback(async () => {
        const request = buildByIdsRequest();
        return await withPerf('pdf:byIdsRoundtrip', () => generateComparisonPdfReportByIdsBytes(request));
    }, [buildByIdsRequest]);

    const generateExcelBytes = useCallback(async () => {
        const request = buildByIdsRequest();
        return await withPerf('excel:byIdsRoundtrip', () => generateComparisonExcelReportByIdsBytes(request));
    }, [buildByIdsRequest]);

    const baseFilename = useMemo(() => {
        const date = new Date().toISOString().split('T')[0];
        return `comparison-report_${date}`;
    }, []);

    // ── Handlers ───────────────────────────────────────────────────────────

    const handleDownloadPdf = useCallback(async () => {
        if (options.experiments.length === 0) {
            setExportError('Добавьте хотя бы один эксперимент');
            return;
        }
        setIsExporting(true);
        setExportError(null);
        let bytes: Uint8Array | null = null;
        try {
            bytes = await generatePdfBytes();
            await withPerf('pdf:saveBytes', () => saveBytes({
                bytes: bytes as Uint8Array,
                filename: `${baseFilename}.pdf`,
                mimeType: PDF_MIME,
                filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
            }));
        } catch (err) {
            logger.error('[ComparisonReport] PDF generation failed:', err);
            const msg = err instanceof Error ? err.message : String(err);
            setExportError(`Ошибка генерации PDF: ${msg}`);
        } finally {
            bytes = null;
            releaseComparisonExportBuffers('pdf');
            setIsExporting(false);
        }
    }, [options.experiments.length, generatePdfBytes, baseFilename]);

    const handleDownloadExcel = useCallback(async () => {
        if (options.experiments.length === 0) {
            setExportError('Добавьте хотя бы один эксперимент');
            return;
        }
        setIsExcelExporting(true);
        setExportError(null);
        let bytes: Uint8Array | null = null;
        try {
            bytes = await generateExcelBytes();
            await withPerf('excel:saveBytes', () => saveBytes({
                bytes: bytes as Uint8Array,
                filename: `${baseFilename}.xlsx`,
                mimeType: XLSX_MIME,
                filters: [{ name: 'Excel Spreadsheet', extensions: ['xlsx'] }],
            }));
        } catch (err) {
            logger.error('[ComparisonReport] Excel generation failed:', err);
            const msg = err instanceof Error ? err.message : String(err);
            setExportError(`Ошибка генерации Excel: ${msg}`);
        } finally {
            bytes = null;
            releaseComparisonExportBuffers('excel');
            setIsExcelExporting(false);
        }
    }, [options.experiments.length, generateExcelBytes, baseFilename]);

    /**
     * Emit both PDF and XLSX side-by-side via a single folder picker.
     * Falls back to individual browser downloads on web builds.
     */
    const handleDownloadAll = useCallback(async (wantPdf: boolean, wantExcel: boolean) => {
        if (!wantPdf && !wantExcel) return;
        if (wantPdf && !wantExcel) return handleDownloadPdf();
        if (!wantPdf && wantExcel) return handleDownloadExcel();

        if (options.experiments.length === 0) {
            setExportError('Добавьте хотя бы один эксперимент');
            return;
        }

        setIsExporting(true);
        setIsExcelExporting(true);
        setExportError(null);
        const items: SaveBytesItem[] = [];
        let pdfBytes: Uint8Array | null = null;
        let excelBytes: Uint8Array | null = null;
        try {
            pdfBytes = await generatePdfBytes();
            items.push({ bytes: pdfBytes, filename: `${baseFilename}.pdf`, mimeType: PDF_MIME });
            excelBytes = await generateExcelBytes();
            items.push({ bytes: excelBytes, filename: `${baseFilename}.xlsx`, mimeType: XLSX_MIME });

            await withPerf('all:saveBytesToDir', () => saveBytesToDir([...items]));
        } catch (err) {
            logger.error('[ComparisonReport] Combined export failed:', err);
            const msg = err instanceof Error ? err.message : String(err);
            setExportError(`Ошибка генерации отчёта: ${msg}`);
        } finally {
            items.length = 0;
            pdfBytes = null;
            excelBytes = null;
            releaseComparisonExportBuffers('all');
            setIsExporting(false);
            setIsExcelExporting(false);
        }
    }, [options.experiments.length, handleDownloadPdf, handleDownloadExcel, generatePdfBytes, generateExcelBytes, baseFilename]);

    const clearError = useCallback(() => setExportError(null), []);

    return {
        isExporting,
        isExcelExporting,
        exportError,
        clearError,
        handleDownloadPdf,
        handleDownloadExcel,
        handleDownloadAll,
    };
}
