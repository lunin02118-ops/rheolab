import type { Experiment, RheologyParameterSource } from '@/types';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import type {
    ComparisonChartConfig,
    ComparisonReportInput,
    ComparisonSectionToggles,
} from '@/lib/analysis/report-types/comparison-report-inputs';
import { buildExcelReportInput, buildPdfReportInput } from '@/lib/reports/report-builders';
import {
    buildComparisonReportInput,
    type ComparisonReportEntrySource,
} from '@/lib/reports/comparison-builders';
import {
    experimentToReportBuildContext,
    type ComparisonExperimentContextOverrides,
} from '@/lib/reports/comparison-experiment-adapter';
import { getExperimentsByIds } from '@/lib/experiments/client';
import { tauriRawRecordsToColumnar } from '@/lib/utils/columnar';

export type ComparisonDirectReportKind = 'pdf' | 'excel';

export interface ComparisonDirectReportOptions {
    experiments: Experiment[];
    comparisonChartConfig: ComparisonChartConfig;
    chartSettings: ChartSettings;
    language: 'ru' | 'en';
    unitSystem: 'SI' | 'SI_Pas' | 'Imperial';
    companyName: string;
    companyLogo: string | null;
    showCalibration: boolean;
    showRawData: boolean;
    showRecipe: boolean;
    showWaterAnalysis: boolean;
    showRheology: boolean;
    rheologySourceOverride?: RheologyParameterSource;
    showTouchPoints: boolean;
    viscosityThreshold: number;
    showTargetTime: boolean;
    targetTime: number;
    reportViscosityRates: number[];
    isExpert: boolean;
}

function isFileBackedExperiment(exp: Experiment): boolean {
    return typeof exp.id === 'string' && exp.id.startsWith('file-');
}

function columnarLength(exp: Experiment): number {
    const columnarData = (exp as Record<string, unknown>).columnarData as
        | { timeSec?: { length?: unknown } }
        | undefined;
    const length = Number(columnarData?.timeSec?.length);
    return Number.isFinite(length) ? length : 0;
}

function rawPointLength(exp: Experiment): number {
    const rawPoints = (exp as Record<string, unknown>).rawPoints;
    return Array.isArray(rawPoints) ? rawPoints.length : 0;
}

function hasReportData(exp: Experiment): boolean {
    return columnarLength(exp) > 0 || rawPointLength(exp) > 0;
}

function ensureColumnarData(exp: Experiment): Experiment {
    if (columnarLength(exp) > 0) return exp;

    const rawPoints = (exp as Record<string, unknown>).rawPoints;
    if (!Array.isArray(rawPoints) || rawPoints.length === 0) return exp;

    return {
        ...exp,
        columnarData: tauriRawRecordsToColumnar(rawPoints as Array<Record<string, unknown>>),
        rawPoints: [],
    } as Experiment;
}

export function hasFileBackedComparisonExperiment(experiments: Experiment[]): boolean {
    return experiments.some(isFileBackedExperiment);
}

export async function resolveComparisonExperimentsForDirectReport(
    experiments: Experiment[],
): Promise<Experiment[]> {
    const dbIdsToFetch = experiments
        .filter((exp) => !isFileBackedExperiment(exp) && !hasReportData(exp))
        .map((exp) => exp.id);

    const fetchedById = new Map<string, Experiment>();
    if (dbIdsToFetch.length > 0) {
        const response = await getExperimentsByIds(dbIdsToFetch);
        if (!response.success) {
            throw new Error(response.error || 'Не удалось загрузить эксперименты из базы');
        }
        for (const exp of response.experiments) {
            fetchedById.set(exp.id, exp as unknown as Experiment);
        }
    }

    return experiments.map((exp) => {
        const source = !isFileBackedExperiment(exp) && !hasReportData(exp)
            ? fetchedById.get(exp.id) ?? exp
            : exp;
        const normalized = ensureColumnarData(source);

        if (!hasReportData(normalized)) {
            const name = normalized.name || normalized.id;
            if (isFileBackedExperiment(normalized)) {
                throw new Error(
                    `Локальный файл "${name}" потерял данные для отчёта. Добавьте файл в сравнение заново.`,
                );
            }
            throw new Error(`Не удалось загрузить данные эксперимента "${name}" для отчёта`);
        }

        return normalized;
    });
}

export async function buildComparisonDirectReportInput(
    options: ComparisonDirectReportOptions,
    kind: ComparisonDirectReportKind,
): Promise<ComparisonReportInput> {
    const experiments = await resolveComparisonExperimentsForDirectReport(options.experiments);

    const sectionToggles: ComparisonSectionToggles = {
        showCalibration: options.showCalibration,
        showRawData: options.showRawData,
        showRecipe: options.showRecipe,
        showWaterAnalysis: options.showWaterAnalysis,
        showRheology: options.showRheology,
    };

    const overrides: ComparisonExperimentContextOverrides = {
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
        rheologySourceOverride: options.rheologySourceOverride,
        showTouchPoints: options.showTouchPoints,
        viscosityThreshold: options.viscosityThreshold,
        showTargetTime: options.showTargetTime,
        targetTime: options.targetTime,
        reportViscosityRates: options.reportViscosityRates,
        isExpert: options.isExpert,
    };

    const entries: ComparisonReportEntrySource[] = [];
    for (const exp of experiments) {
        const context = await experimentToReportBuildContext(exp, overrides);
        entries.push({
            id: exp.id,
            displayName: exp.name || exp.id,
            reportInput: kind === 'pdf'
                ? buildPdfReportInput(context)
                : buildExcelReportInput(context),
            sectionToggles,
        });
    }

    return buildComparisonReportInput({
        language: options.language,
        unitSystem: options.unitSystem,
        companyName: options.companyName || undefined,
        companyLogoBase64: options.companyLogo ?? undefined,
        generatedAt: new Date().toISOString(),
        comparisonChart: options.comparisonChartConfig,
        entries,
    });
}
