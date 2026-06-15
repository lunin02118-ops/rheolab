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
import type { Experiment, ExperimentSavePayload, RheologyParameterSource, TestMetrics } from '@/types';
import type { ComparisonReportByIdsRequest } from '@/types/tauri';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import { useComparisonStore, type ComparisonDisplaySettings } from '@/lib/store/comparison-store';
import type { ExpertSettings } from '@/lib/store/analysis-settings-store';
import type { RheoDataPoint } from '@/lib/parsing/types';
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
import { saveExperiment } from '@/lib/experiments/client';
import { EXPERIMENT_COLORS } from '@/components/comparison/comparison-chart-constants';
import { columnarToRawPoints } from '@/lib/utils/columnar';
import { isFluidType } from '@/lib/constants/fluid-types';
import { detectTestCategoryAndType } from '@/lib/utils/test-type-detector';
import { useLicenseStore } from '@/lib/store/license-store';
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
    rheologySourceOverride?: RheologyParameterSource;

    reportViscosityRates: number[];
    isExpert: boolean;
    expertSettings: ExpertSettings;
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

function toFiniteNumber(value: unknown, fallback: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
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
const LOCAL_EXPORT_SAVE_ERROR =
    'Не удалось сохранить локальный файл перед экспортом. Проверьте данные и повторите экспорт.';

type ComparisonExportKind = 'pdf' | 'excel' | 'all';

function isFileBackedComparisonExperiment(exp: Experiment): boolean {
    return typeof exp.id === 'string' && exp.id.startsWith('file-');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
    if (value instanceof Date) return value.toISOString();
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function finiteOrZero(value: unknown): number {
    return numberValue(value) ?? 0;
}

function sanitizeRawPoints(points: RheoDataPoint[]): RheoDataPoint[] {
    return points
        .filter((point) => (
            Number.isFinite(point.time_sec) &&
            Number.isFinite(point.viscosity_cp) &&
            Number.isFinite(point.temperature_c)
        ))
        .map((point) => ({
            time_sec: finiteOrZero(point.time_sec),
            viscosity_cp: finiteOrZero(point.viscosity_cp),
            temperature_c: finiteOrZero(point.temperature_c),
            speed_rpm: finiteOrZero(point.speed_rpm),
            shear_rate_s1: finiteOrZero(point.shear_rate_s1),
            shear_stress_pa: finiteOrZero(point.shear_stress_pa),
            pressure_bar: finiteOrZero(point.pressure_bar),
            bath_temperature_c: numberValue(point.bath_temperature_c),
        }));
}

function rawPointsForExperiment(exp: Experiment): RheoDataPoint[] {
    const rawPoints = (exp as { rawPoints?: unknown }).rawPoints;
    if (Array.isArray(rawPoints) && rawPoints.length > 0) {
        return sanitizeRawPoints(rawPoints as RheoDataPoint[]);
    }

    const columnarData = (exp as { columnarData?: unknown }).columnarData;
    const timeSec = (columnarData as { timeSec?: { length?: unknown } } | undefined)?.timeSec;
    if (columnarData && typeof columnarData === 'object' && typeof timeSec?.length === 'number') {
        return sanitizeRawPoints(columnarToRawPoints(columnarData as Parameters<typeof columnarToRawPoints>[0]));
    }

    return [];
}

function averageInWindow(points: RheoDataPoint[], startMin: number, endMin: number): number {
    const values = points
        .filter((point) => {
            const minutes = point.time_sec / 60;
            return minutes >= startMin && minutes <= endMin && Number.isFinite(point.viscosity_cp);
        })
        .map((point) => point.viscosity_cp);
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildFallbackMetrics(points: RheoDataPoint[]): TestMetrics {
    return {
        n_prime: 0,
        k_prime: 0,
        initialViscosity_5_10: averageInWindow(points, 5, 10),
        comparisonViscosity_5_30: averageInWindow(points, 5, 30),
        avgViscosity_10_120: averageInWindow(points, 10, 120),
        subgroup: 'without_stabilizer',
    };
}

function metricsForExperiment(exp: Experiment, points: RheoDataPoint[]): TestMetrics {
    const metrics = (exp as { metrics?: unknown }).metrics;
    return isRecord(metrics) ? metrics as unknown as TestMetrics : buildFallbackMetrics(points);
}

function originalFilenameFor(exp: Experiment): string {
    return stringValue((exp as { originalFilename?: unknown }).originalFilename)
        ?? stringValue(exp.name)
        ?? 'comparison-local-file';
}

function dateForExperiment(exp: Experiment): Date {
    if (exp.testDate instanceof Date && !Number.isNaN(exp.testDate.getTime())) return exp.testDate;
    if (typeof exp.testDate === 'string') {
        const parsed = new Date(exp.testDate);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
}

function buildLocalExperimentSavePayload(exp: Experiment): ExperimentSavePayload {
    const points = rawPointsForExperiment(exp);
    if (points.length === 0) {
        throw new Error('Локальный файл не содержит точек данных для сохранения.');
    }

    const originalFilename = originalFilenameFor(exp);
    const fluidType = typeof exp.fluidType === 'string' && isFluidType(exp.fluidType)
        ? exp.fluidType
        : 'Linear';
    const maxTemp = Math.max(...points.map((point) => finiteOrZero(point.temperature_c)));
    const durationMin = points.length > 1
        ? Math.max(...points.map((point) => finiteOrZero(point.time_sec))) / 60
        : 0;
    const detectedType = detectTestCategoryAndType({
        fluidType,
        filename: originalFilename,
        instrumentType: stringValue(exp.instrumentType) ?? '',
        maxTemp,
        durationMin,
    });
    const record = exp as Record<string, unknown>;
    const reagents = Array.isArray(record.reagents)
        ? record.reagents as ExperimentSavePayload['reagents']
        : [];
    const hasInstrumentRheology = Array.isArray(record.instrumentRheology)
        && record.instrumentRheology.length > 0;

    return {
        name: stringValue(exp.name) ?? originalFilename.replace(/\.[^/.]+$/, ''),
        fieldName: stringValue(exp.fieldName) ?? '',
        operatorName: stringValue(exp.operatorName) ?? '',
        wellNumber: stringValue((exp as { wellNumber?: unknown }).wellNumber) ?? '',
        testId: stringValue((exp as { testId?: unknown }).testId) ?? undefined,
        originalFilename,
        testDate: dateForExperiment(exp),
        instrumentType: stringValue(exp.instrumentType) ?? 'Unknown',
        geometry: stringValue((exp as { geometry?: unknown }).geometry),
        geometrySource: stringValue((exp as { geometrySource?: unknown }).geometrySource),
        waterSource: stringValue(exp.waterSource) ?? 'Не указано',
        waterParams: isRecord(record.waterParams)
            ? record.waterParams as unknown as ExperimentSavePayload['waterParams']
            : undefined,
        fluidType,
        testGroup: detectedType.testCategory === 'Drilling'
            ? 'Rheology'
            : detectedType.testType === 'Hydration' ? 'Hydration' : 'Rheology',
        testCategory: detectedType.testCategory,
        testType: detectedType.testType,
        metrics: metricsForExperiment(exp, points),
        rawPoints: points,
        calibration: isRecord(record.calibration)
            ? record.calibration as unknown as ExperimentSavePayload['calibration']
            : null,
        reagents,
        parsedBy: stringValue((exp as { parsedBy?: unknown }).parsedBy),
        parseSource: stringValue((exp as { parseSource?: unknown }).parseSource),
        rheologySource: hasInstrumentRheology ? 'instrument' : 'program',
        rheologyParameters: hasInstrumentRheology
            ? record.instrumentRheology as ExperimentSavePayload['rheologyParameters']
            : [],
    };
}

function withConflictSuffix(payload: ExperimentSavePayload): ExperimentSavePayload {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return {
        ...payload,
        name: `${payload.name} ${stamp}`,
    };
}

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
// expected shape after Sprint 1: the UI emits a bounded by-IDs request and
// `cmp:pdf:byIdsRoundtrip` absorbs native DB load + render work.
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

    const persistLocalExperimentsForExport = useCallback(async (): Promise<Experiment[]> => {
        if (!options.experiments.some(isFileBackedComparisonExperiment)) {
            return options.experiments;
        }

        const replacementById = new Map<string, Experiment>();

        for (const exp of options.experiments) {
            if (!isFileBackedComparisonExperiment(exp)) continue;

            const saveCheck = useLicenseStore.getState().canSaveExperiment();
            if (!saveCheck.allowed) {
                throw new Error(saveCheck.message ?? LOCAL_EXPORT_SAVE_ERROR);
            }

            const payload = buildLocalExperimentSavePayload(exp);
            let result = await withPerf('autosave:fileBacked', () => saveExperiment(payload));
            if (!result.success && result.code === 'NAME_CONFLICT') {
                result = await withPerf(
                    'autosave:fileBackedConflictRetry',
                    () => saveExperiment(withConflictSuffix(payload)),
                );
            }
            if (!result.success || !result.experimentId) {
                const detail = result.error || result.message || LOCAL_EXPORT_SAVE_ERROR;
                throw new Error(`${LOCAL_EXPORT_SAVE_ERROR} ${detail}`);
            }

            const savedExperiment = {
                ...exp,
                id: result.experimentId,
                rawPoints: [],
                columnarData: undefined,
                originalFilename: payload.originalFilename,
                testDate: payload.testDate,
                fluidType: payload.fluidType,
                instrumentType: payload.instrumentType,
                waterSource: payload.waterSource,
                fieldName: payload.fieldName,
                operatorName: payload.operatorName,
            } as Experiment;
            useComparisonStore.getState().replaceExperiment(exp.id, savedExperiment);
            void useLicenseStore.getState().refreshExperimentsCount();
            replacementById.set(exp.id, savedExperiment);
        }

        return options.experiments.map((exp) => replacementById.get(exp.id) ?? exp);
    }, [options.experiments]);

    const buildByIdsRequest = useCallback((experiments: Experiment[]): ComparisonReportByIdsRequest => ({
        experimentIds: experiments.map((exp) => exp.id),
        settings: {
            language: options.language,
            unitSystem: options.unitSystem,
            companyName: options.companyName || undefined,
            companyLogoBase64: options.companyLogo ?? undefined,
            generatedAt: new Date().toISOString(),
            rheologySourceOverride: options.rheologySourceOverride,
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
                showAdvancedStats: true,
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
                pointsToAverage: Math.max(
                    0,
                    Math.round(toFiniteNumber(options.isExpert ? options.expertSettings.pointsToAverage : 1, 1)),
                ),
                viscosityShearRates: options.reportViscosityRates,
            },
            detectionSettings: {
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
            },
        },
    }), [
        comparisonChartConfig,
        options.language,
        options.unitSystem,
        options.companyName,
        options.companyLogo,
        options.showCalibration,
        options.showRawData,
        options.showRecipe,
        options.showWaterAnalysis,
        options.showRheology,
        options.rheologySourceOverride,
        options.isExpert,
        options.expertSettings,
        options.chartSettings,
        options.reportViscosityRates,
    ]);

    const generatePdfBytes = useCallback(async (experiments: Experiment[]) => {
        const request = buildByIdsRequest(experiments);
        return await withPerf('pdf:byIdsRoundtrip', () => generateComparisonPdfReportByIdsBytes(request));
    }, [buildByIdsRequest]);

    const generateExcelBytes = useCallback(async (experiments: Experiment[]) => {
        const request = buildByIdsRequest(experiments);
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
            const exportExperiments = await persistLocalExperimentsForExport();
            bytes = await generatePdfBytes(exportExperiments);
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
    }, [options.experiments.length, persistLocalExperimentsForExport, generatePdfBytes, baseFilename]);

    const handleDownloadExcel = useCallback(async () => {
        if (options.experiments.length === 0) {
            setExportError('Добавьте хотя бы один эксперимент');
            return;
        }
        setIsExcelExporting(true);
        setExportError(null);
        let bytes: Uint8Array | null = null;
        try {
            const exportExperiments = await persistLocalExperimentsForExport();
            bytes = await generateExcelBytes(exportExperiments);
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
    }, [options.experiments.length, persistLocalExperimentsForExport, generateExcelBytes, baseFilename]);

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
            const exportExperiments = await persistLocalExperimentsForExport();
            pdfBytes = await generatePdfBytes(exportExperiments);
            items.push({ bytes: pdfBytes, filename: `${baseFilename}.pdf`, mimeType: PDF_MIME });
            excelBytes = await generateExcelBytes(exportExperiments);
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
    }, [
        options.experiments.length,
        handleDownloadPdf,
        handleDownloadExcel,
        persistLocalExperimentsForExport,
        generatePdfBytes,
        generateExcelBytes,
        baseFilename,
    ]);

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
