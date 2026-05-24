/**
 * Hook encapsulating report export logic (PDF + Excel).
 *
 * Manages exporting state, builds report input, generates blobs,
 * and saves them via Tauri or browser fallback.
 */

import { useState, useMemo, useCallback } from 'react';
import type { ParseResult } from '@/lib/store/experiment-data-store';
import type { RheoCycle, GraceCycleResult } from '@/lib/analysis/types';
import type { RecipeComponent } from '@/lib/parsing/types';
import type { RheologyParameterRow, RheologyParameterSource, WaterParams } from '@/types';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import { generatePdfReportBlob, generateExcelReportBlob } from '@/lib/reports/client';
import { saveBlob, saveBlobsToDir, type SaveBlobItem } from '@/lib/reports/report-save';
import {
    mapRawData,
    mapCycleResults,
    buildPdfReportInput,
    buildExcelReportInput,
    type ReportBuildContext,
    mapRheologyParameterRows,
} from '@/lib/reports/report-builders';
import { extractExperimentMetadata } from '@/lib/metadata-utils';
import { logger } from '@/lib/logger';

export interface UseReportExportOptions {
    parseResult: ParseResult;
    editedRecipe: RecipeComponent[];
    editedWaterParams: Partial<WaterParams> | null;
    editedWaterSource: string;
    cycleResults: Map<number, GraceCycleResult>;
    cycles: RheoCycle[];
    // Settings
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
    rheologySource: RheologyParameterSource;
    instrumentRheology?: RheologyParameterRow[];
    reportViscosityRates: number[];
    isExpert: boolean;
    companyName: string;
    companyLogo: string | null;
    chartSettings: ChartSettings;
}

export function useReportExport(options: UseReportExportOptions) {
    const [isExporting, setIsExporting] = useState(false);
    const [isExcelExporting, setIsExcelExporting] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);

    const { parseResult, cycleResults } = options;

    // Pre-compute data mappings once when source data changes
    const rawDataMapped = useMemo(() => mapRawData(parseResult.data), [parseResult.data]);
    const instrumentRheologyMapped = useMemo(
        () => mapRheologyParameterRows(parseResult.instrumentRheology ?? options.instrumentRheology ?? []),
        [parseResult.instrumentRheology, options.instrumentRheology],
    );
    const programCycleResultsMapped = useMemo(() => mapCycleResults(cycleResults), [cycleResults]);
    const cycleResultsMapped = options.rheologySource === 'instrument'
        ? instrumentRheologyMapped
        : programCycleResultsMapped;

    const legacyFields = useMemo(
        () => extractExperimentMetadata(parseResult.metadata),
        [parseResult.metadata],
    );

    /** Build the shared context object for report builders. */
    const buildContext = useCallback((): ReportBuildContext => ({
        rawDataMapped,
        cycleResultsMapped,
        metadata: parseResult.metadata,
        legacyFields,
        editedRecipe: options.editedRecipe,
        editedWaterParams: options.editedWaterParams,
        editedWaterSource: options.editedWaterSource,
        cycles: options.cycles,
        companyName: options.companyName,
        companyLogo: options.companyLogo,
        chartSettings: options.chartSettings,
        language: options.language,
        unitSystem: options.unitSystem,
        showTouchPoints: options.showTouchPoints,
        viscosityThreshold: options.viscosityThreshold,
        showTargetTime: options.showTargetTime,
        targetTime: options.targetTime,
        showCalibration: options.showCalibration,
        showRawData: options.showRawData,
        showRecipe: options.showRecipe,
        showWaterAnalysis: options.showWaterAnalysis,
        reportViscosityRates: options.reportViscosityRates,
        isExpert: options.isExpert,
        rheologySource: options.rheologySource,
    }), [
        rawDataMapped, cycleResultsMapped, parseResult.metadata, legacyFields,
        options.editedRecipe, options.editedWaterParams, options.editedWaterSource,
        options.cycles, options.companyName, options.companyLogo, options.chartSettings,
        options.language, options.unitSystem, options.showTouchPoints,
        options.viscosityThreshold, options.showTargetTime, options.targetTime,
        options.showCalibration, options.showRawData,
        options.showRecipe, options.showWaterAnalysis,
        options.reportViscosityRates, options.isExpert, options.rheologySource,
    ]);

    const handleDownload = useCallback(async () => {
        setIsExporting(true);
        setIsCapturing(true);
        await new Promise(resolve => setTimeout(resolve, 100));
        setExportError(null);

        const timings: string[] = [];
        const t0 = performance.now();

        try {
            logger.debug('[ReportsPanel] Starting PDF generation...');
            logger.info('[ReportsPanel] Capturing chart as SVG...');
            const _chartImage = null;

            const t2 = performance.now();
            timings.push(`Capture: ${(t2 - t0).toFixed(0)}ms`);

            const pdfInput = buildPdfReportInput(buildContext());
            const blob = await generatePdfReportBlob(pdfInput);

            const t3 = performance.now();
            timings.push(`PDF Gen: ${(t3 - t2).toFixed(0)}ms`);
            timings.push(`TOTAL: ${(t3 - t0).toFixed(0)}ms`);
            logger.info('[ReportsPanel] PDF generation timings:', timings.join(', '));

            const filename = `${parseResult.metadata.filename || 'report'}_${new Date().toISOString().split('T')[0]}.pdf`;
            await saveBlob({
                blob,
                filename,
                filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
            });
        } catch (err) {
            logger.error('Report generation failed:', err);
            const errorMessage = err instanceof Error ? err.message : String(err);
            setExportError(`Ошибка генерации PDF: ${errorMessage}`);
        } finally {
            setIsCapturing(false);
            setIsExporting(false);
        }
    }, [buildContext, parseResult.metadata.filename]);

    const handleExcelDownload = useCallback(async () => {
        setIsExcelExporting(true);
        setExportError(null);
        try {
            const excelInput = buildExcelReportInput(buildContext());
            logger.info('[ReportsPanel] Generating Excel with settings:', excelInput.settings);

            const blob = await generateExcelReportBlob(excelInput);
            const filename = `${parseResult.metadata.filename || 'report'}_${new Date().toISOString().split('T')[0]}.xlsx`;
            await saveBlob({
                blob,
                filename,
                filters: [{ name: 'Excel Spreadsheet', extensions: ['xlsx'] }],
            });
        } catch (err) {
            logger.error('[ReportsPanel] Excel generation failed:', err);
            const errorMessage = err instanceof Error ? err.message : String(err);
            setExportError(`Ошибка генерации Excel: ${errorMessage}`);
        } finally {
            setIsExcelExporting(false);
        }
    }, [buildContext, parseResult.metadata.filename]);

    /** Generate both PDF + Excel and save via a single folder dialog. */
    const handleDownloadAll = useCallback(async (wantPdf: boolean, wantExcel: boolean) => {
        if (!wantPdf && !wantExcel) return;

        // If only one format, use the dedicated handler (single-file save dialog)
        if (wantPdf && !wantExcel) { await handleDownload(); return; }
        if (!wantPdf && wantExcel) { await handleExcelDownload(); return; }

        // Both formats — generate blobs, then save to one folder
        setIsExporting(true);
        setIsExcelExporting(true);
        setIsCapturing(true);
        setExportError(null);
        await new Promise(resolve => setTimeout(resolve, 100));

        try {
            const ctx = buildContext();
            const baseName = `${parseResult.metadata.filename || 'report'}_${new Date().toISOString().split('T')[0]}`;
            const items: SaveBlobItem[] = [];

            // PDF
            const pdfInput = buildPdfReportInput(ctx);
            const pdfBlob = await generatePdfReportBlob(pdfInput);
            items.push({ blob: pdfBlob, filename: `${baseName}.pdf` });

            // Excel
            const excelInput = buildExcelReportInput(ctx);
            const excelBlob = await generateExcelReportBlob(excelInput);
            items.push({ blob: excelBlob, filename: `${baseName}.xlsx` });

            await saveBlobsToDir(items);
        } catch (err) {
            logger.error('[ReportsPanel] Combined export failed:', err);
            const errorMessage = err instanceof Error ? err.message : String(err);
            setExportError(`Ошибка генерации отчёта: ${errorMessage}`);
        } finally {
            setIsCapturing(false);
            setIsExporting(false);
            setIsExcelExporting(false);
        }
    }, [buildContext, parseResult.metadata.filename, handleDownload, handleExcelDownload]);

    return {
        isExporting,
        isExcelExporting,
        isCapturing,
        exportError,
        clearError: useCallback(() => setExportError(null), []),
        handleDownload,
        handleExcelDownload,
        handleDownloadAll,
        /** Pre-mapped raw data — reuse for chart preview */
        chartData: rawDataMapped,
    };
}
