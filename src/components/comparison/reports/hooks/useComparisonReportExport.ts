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
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import type { ComparisonDisplaySettings } from '@/lib/store/comparison-store';
import type { ComparisonReportEntrySource } from '@/lib/reports/comparison-builders';
import type {
    ComparisonChartConfig,
    ComparisonSectionToggles,
    ReportChartLineSettings,
} from '@/lib/analysis/report-types/types';

import { buildComparisonReportInput } from '@/lib/reports/comparison-builders';
import {
    buildExcelReportInput,
    buildPdfReportInput,
} from '@/lib/reports/report-builders';
import {
    experimentToReportBuildContext,
    type ComparisonExperimentContextOverrides,
} from '@/lib/reports/comparison-experiment-adapter';
import {
    generateComparisonExcelReportBlob,
    generateComparisonPdfReportBlob,
} from '@/lib/reports/client';
import { saveBlob, saveBlobsToDir, type SaveBlobItem } from '@/lib/reports/report-save';
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

// ── Hook ───────────────────────────────────────────────────────────────────

export function useComparisonReportExport(options: UseComparisonReportExportOptions) {
    const [isExporting, setIsExporting] = useState(false);
    const [isExcelExporting, setIsExcelExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);

    const overrides = useMemo<ComparisonExperimentContextOverrides>(() => ({
        language: options.language,
        unitSystem: options.unitSystem,
        companyName: options.companyName,
        companyLogo: options.companyLogo,
        chartSettings: options.chartSettings,
        showCalibration: options.showCalibration,
        showRawData: options.showRawData,
        showRecipe: options.showRecipe,
        showWaterAnalysis: options.showWaterAnalysis,
        showRheology: options.showRheology,
        showTouchPoints: options.displaySettings.showTouchPoints,
        viscosityThreshold: options.displaySettings.viscosityThreshold,
        showTargetTime: options.displaySettings.showTargetTime,
        targetTime: options.displaySettings.targetTime,
        reportViscosityRates: options.reportViscosityRates,
        isExpert: options.isExpert,
    }), [
        options.language,
        options.unitSystem,
        options.companyName,
        options.companyLogo,
        options.chartSettings,
        options.showCalibration,
        options.showRawData,
        options.showRecipe,
        options.showWaterAnalysis,
        options.showRheology,
        options.displaySettings.showTouchPoints,
        options.displaySettings.viscosityThreshold,
        options.displaySettings.showTargetTime,
        options.displaySettings.targetTime,
        options.reportViscosityRates,
        options.isExpert,
    ]);

    /**
     * Build the N per-experiment `ComparisonReportEntrySource` objects.
     * Each entry reuses the single-exp builder so the wire payload is
     * byte-identical to what a single-experiment export would produce.
     *
     * The second argument switches between the PDF and Excel flavour —
     * both are structurally identical for the comparison renderer, but
     * the Rust side checks specific flavour-only settings (e.g.
     * `showAdvancedStats` for PDF), so we keep them explicit.
     */
    const buildEntries = useCallback(
        async (flavour: 'pdf' | 'excel'): Promise<ComparisonReportEntrySource[]> => {
            const entries: ComparisonReportEntrySource[] = [];
            for (const exp of options.experiments) {
                const ctx = await experimentToReportBuildContext(exp, overrides);
                const reportInput = flavour === 'pdf' ? buildPdfReportInput(ctx) : buildExcelReportInput(ctx);
                entries.push({
                    id: exp.id,
                    displayName: exp.name ?? exp.id,
                    reportInput,
                    sectionToggles: {
                        ...DEFAULT_SECTION_TOGGLES,
                        showCalibration: options.showCalibration,
                        showRawData: options.showRawData,
                        showRecipe: options.showRecipe,
                        showWaterAnalysis: options.showWaterAnalysis,
                        showRheology: options.showRheology,
                    },
                });
            }
            return entries;
        },
        [
            options.experiments,
            overrides,
            options.showCalibration,
            options.showRawData,
            options.showRecipe,
            options.showWaterAnalysis,
            options.showRheology,
        ],
    );

    const comparisonChartConfig = useMemo(
        () => buildComparisonChartConfig(options.displaySettings, options.chartSettings, options.brushRange),
        [options.displaySettings, options.chartSettings, options.brushRange],
    );

    const buildPayload = useCallback(
        async (flavour: 'pdf' | 'excel') => buildComparisonReportInput({
            language: options.language,
            unitSystem: options.unitSystem,
            companyName: options.companyName || undefined,
            companyLogoBase64: options.companyLogo ?? undefined,
            comparisonChart: comparisonChartConfig,
            entries: await buildEntries(flavour),
        }),
        [
            buildEntries,
            comparisonChartConfig,
            options.language,
            options.unitSystem,
            options.companyName,
            options.companyLogo,
        ],
    );

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
        try {
            const blob = await generateComparisonPdfReportBlob(await buildPayload('pdf'));
            await saveBlob({
                blob,
                filename: `${baseFilename}.pdf`,
                filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
            });
        } catch (err) {
            logger.error('[ComparisonReport] PDF generation failed:', err);
            const msg = err instanceof Error ? err.message : String(err);
            setExportError(`Ошибка генерации PDF: ${msg}`);
        } finally {
            setIsExporting(false);
        }
    }, [options.experiments.length, buildPayload, baseFilename]);

    const handleDownloadExcel = useCallback(async () => {
        if (options.experiments.length === 0) {
            setExportError('Добавьте хотя бы один эксперимент');
            return;
        }
        setIsExcelExporting(true);
        setExportError(null);
        try {
            const blob = await generateComparisonExcelReportBlob(await buildPayload('excel'));
            await saveBlob({
                blob,
                filename: `${baseFilename}.xlsx`,
                filters: [{ name: 'Excel Spreadsheet', extensions: ['xlsx'] }],
            });
        } catch (err) {
            logger.error('[ComparisonReport] Excel generation failed:', err);
            const msg = err instanceof Error ? err.message : String(err);
            setExportError(`Ошибка генерации Excel: ${msg}`);
        } finally {
            setIsExcelExporting(false);
        }
    }, [options.experiments.length, buildPayload, baseFilename]);

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
        try {
            const items: SaveBlobItem[] = [];
            const pdfBlob = await generateComparisonPdfReportBlob(await buildPayload('pdf'));
            items.push({ blob: pdfBlob, filename: `${baseFilename}.pdf` });
            const excelBlob = await generateComparisonExcelReportBlob(await buildPayload('excel'));
            items.push({ blob: excelBlob, filename: `${baseFilename}.xlsx` });

            await saveBlobsToDir(items);
        } catch (err) {
            logger.error('[ComparisonReport] Combined export failed:', err);
            const msg = err instanceof Error ? err.message : String(err);
            setExportError(`Ошибка генерации отчёта: ${msg}`);
        } finally {
            setIsExporting(false);
            setIsExcelExporting(false);
        }
    }, [options.experiments.length, handleDownloadPdf, handleDownloadExcel, buildPayload, baseFilename]);

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
