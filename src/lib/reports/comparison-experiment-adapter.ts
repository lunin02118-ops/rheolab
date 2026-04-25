/**
 * @fileoverview Adapter that turns a comparison-store `Experiment` (a DB
 * record) into the `ReportBuildContext` shape consumed by the single-exp
 * `buildPdfReportInput` / `buildExcelReportInput` helpers.
 *
 * Why not reuse a bare ReportsPanel flow directly?  Comparison experiments
 * live in the comparison store as lightweight DB records — they do **not**
 * carry live `cycleResults: Map<number, GraceCycleResult>` or a re-analysed
 * `cycles: RheoCycle[]`.  This adapter runs the full Grace analysis
 * pipeline on-demand for each experiment's columnar data, populating
 * `cycleResults` and `cycles` so the Rust report renderer can emit
 * the per-cycle "Реология" section.
 *
 * @module reports/comparison-experiment-adapter
 */

import type { Experiment, ColumnarData, WaterParams } from '@/types';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import type { RecipeComponent } from '@/lib/parsing/types';
import type { ReportBuildContext } from '@/lib/reports/report-builders';
import { mapRawData, mapCycleResults } from '@/lib/reports/report-builders';
import { columnarToRawPoints } from '@/lib/utils/columnar';
import { analyzeData } from '@/lib/analysis/client';
import { DEFAULT_VISCOSITY_SHEAR_RATES } from '@/lib/analysis/constants';
import type { RheoPointsColumnar } from '@/types/tauri';

// ── Internal types ─────────────────────────────────────────────────────────

/**
 * Shape of one reagent as stored on `StoredExperiment.reagents` — we only
 * reach for a small subset of fields, so we avoid pulling in the whole
 * generated type here.
 */
interface StoredReagentLite {
    reagentId?: string | null;
    reagentName?: string | null;
    concentration: number;
    unit: string;
    category?: string | null;
    batchNumber?: string | null;
    reagent?: { name?: string | null; category?: string | null } | null;
}

/**
 * Shape of the calibration blob as stored on a DB experiment — mirrors
 * `StoredExperiment.calibration` (JsonValue | null).  We pick only the
 * fields the Rust `CalibrationReport` struct actually consumes.
 */
interface StoredCalibrationLite {
    deviceType?: string;
    lastCalDate?: string;
    rSquared?: number;
    slope?: number;
    intercept?: number;
    hysteresis?: number;
    stdev?: number;
    status?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function safeRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function extractColumnarData(exp: Experiment): ColumnarData | null {
    const col = (exp as Record<string, unknown>).columnarData as ColumnarData | undefined;
    return col && col.timeSec && col.timeSec.length > 0 ? col : null;
}

function mapStoredReagentToRecipeComponent(r: StoredReagentLite): RecipeComponent {
    // Prefer the joined reagent descriptor's name (shown in the UI), fall
    // back to the stored reagentName, finally to a clearly-visible
    // placeholder.  Abbreviation mirrors reagentName because the DB
    // schema does not carry a separate `abbreviation` column on
    // experiment reagents.
    const displayName = r.reagent?.name ?? r.reagentName ?? 'Unknown';
    return {
        abbreviation: displayName,
        reagentName: displayName,
        concentration: r.concentration,
        unit: r.unit,
        category: r.category ?? r.reagent?.category ?? undefined,
        reagentId: r.reagentId ?? undefined,
    };
}

function extractWaterParams(exp: Experiment): Partial<WaterParams> | null {
    const raw = safeRecord((exp as Record<string, unknown>).waterParams);
    if (Object.keys(raw).length === 0) return null;
    return {
        ph: typeof raw.ph === 'number' ? raw.ph : null,
        fe: typeof raw.fe === 'number' ? raw.fe : null,
        ca: typeof raw.ca === 'number' ? raw.ca : null,
        mg: typeof raw.mg === 'number' ? raw.mg : null,
        cl: typeof raw.cl === 'number' ? raw.cl : null,
        so4: typeof raw.so4 === 'number' ? raw.so4 : null,
        hco3: typeof raw.hco3 === 'number' ? raw.hco3 : null,
    };
}

function extractCalibration(exp: Experiment): StoredCalibrationLite | undefined {
    const raw = safeRecord((exp as Record<string, unknown>).calibration);
    if (Object.keys(raw).length === 0) return undefined;
    return {
        deviceType: typeof raw.deviceType === 'string' ? raw.deviceType : undefined,
        lastCalDate: typeof raw.lastCalDate === 'string' ? raw.lastCalDate : undefined,
        rSquared: typeof raw.rSquared === 'number' ? raw.rSquared : undefined,
        slope: typeof raw.slope === 'number' ? raw.slope : undefined,
        intercept: typeof raw.intercept === 'number' ? raw.intercept : undefined,
        hysteresis: typeof raw.hysteresis === 'number' ? raw.hysteresis : undefined,
        stdev: typeof raw.stdev === 'number' ? raw.stdev : undefined,
        status: typeof raw.status === 'string' ? raw.status : undefined,
    };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Options that apply equally to every per-experiment context in a
 * comparison export — typically sourced from the Comparison-Report tab
 * global controls.
 */
export interface ComparisonExperimentContextOverrides {
    language: 'ru' | 'en';
    unitSystem: 'SI' | 'SI_Pas' | 'Imperial';
    companyName: string;
    companyLogo: string | null;
    chartSettings: ChartSettings;
    /** Applied uniformly to every experiment — tweak per-experiment in Phase 4. */
    showCalibration: boolean;
    showRawData: boolean;
    showRecipe: boolean;
    showWaterAnalysis: boolean;
    showRheology: boolean;
    showTouchPoints: boolean;
    viscosityThreshold: number;
    showTargetTime: boolean;
    targetTime: number;
    reportViscosityRates: number[];
    isExpert: boolean;
}

/**
 * Build `RheoPointsColumnar` from a comparison-store experiment's
 * `ColumnarData` (Float64Array fields → plain number[]).
 */
function columnarToRheoPoints(col: ColumnarData): RheoPointsColumnar {
    return {
        timeSec:      col.timeSec,
        viscosityCp:  col.viscosityCp,
        temperatureC: col.temperatureC,
        shearRate:    col.shearRate,
        shearStress:  col.shearStress,
        pressureBar:  col.pressureBar,
        rpm:          col.speedRpm,
    };
}

/**
 * Convert one comparison-store experiment into a
 * {@link ReportBuildContext} ready for
 * `buildPdfReportInput` / `buildExcelReportInput`.
 *
 * Runs the full Grace analysis pipeline on the experiment's columnar
 * data to populate `cycleResultsMapped` and `cycles`.  Uses
 * beginner-mode defaults so results are consistent across exports.
 *
 * @param exp       Experiment as returned by the comparison store (DB record).
 * @param overrides Global comparison-report settings.
 * @returns         A ready-to-use ReportBuildContext.
 */
export async function experimentToReportBuildContext(
    exp: Experiment,
    overrides: ComparisonExperimentContextOverrides,
): Promise<ReportBuildContext> {
    const record = exp as Record<string, unknown>;
    const columnar = extractColumnarData(exp);
    const rawPoints = columnar ? columnarToRawPoints(columnar) : [];
    const rawDataMapped = mapRawData(rawPoints);

    // ── Run analysis to populate rheology table ────────────────────
    let cycleResultsMapped: ReportBuildContext['cycleResultsMapped'] = [];
    let cycles: ReportBuildContext['cycles'] = [];

    if (columnar) {
        try {
            const geometryKey =
                typeof record.geometry === 'string' ? (record.geometry as string) : 'R1B5';
            const rheoPoints = columnarToRheoPoints(columnar);

            const detectionSettings = {
                stepSplitting: true,
                splitStartDuration: 30,
                splitEndDuration: 30,
                minDurationForSplit: 90,
            };
            const expertSettings = {
                pointsToAverage: 0,
                viscosityShearRates: [...DEFAULT_VISCOSITY_SHEAR_RATES] as number[],
                kIndexType: 'K_ind' as const,
                stepSplitting: true,
                splitStartDuration: 30,
                splitEndDuration: 30,
                minDurationForSplit: 90,
            };

            const result = await analyzeData(
                rheoPoints,
                geometryKey,
                expertSettings,
                detectionSettings,
            );

            cycles = result.cycles;
            cycleResultsMapped = mapCycleResults(result.results);
        } catch (e) {
            console.warn(`[comparison-adapter] analysis failed for ${exp.id}:`, e);
        }
    }

    const reagents = Array.isArray(record.reagents)
        ? (record.reagents as StoredReagentLite[])
        : [];
    const editedRecipe: RecipeComponent[] = reagents.map(mapStoredReagentToRecipeComponent);

    const editedWaterParams = extractWaterParams(exp);
    const editedWaterSource =
        typeof record.waterSource === 'string' ? (record.waterSource as string) : '';

    const testId = typeof record.testId === 'string' ? (record.testId as string) : undefined;
    const operatorName =
        typeof record.operatorName === 'string' ? (record.operatorName as string) : undefined;
    const fieldName = typeof record.fieldName === 'string' ? (record.fieldName as string) : undefined;
    const wellNumber =
        typeof record.wellNumber === 'string' ? (record.wellNumber as string) : undefined;
    const laboratoryName =
        safeRecord(record.laboratory).name as string | undefined;

    const testDate = (record.testDate as Date | string | undefined) ?? undefined;

    return {
        rawDataMapped,
        cycleResultsMapped,
        metadata: {
            filename: exp.name || 'report',
            testDate,
            instrumentType: typeof record.instrumentType === 'string' ? (record.instrumentType as string) : undefined,
            geometry: typeof record.geometry === 'string' ? (record.geometry as string) : undefined,
            geometrySource:
                typeof record.geometrySource === 'string' ? (record.geometrySource as string) : undefined,
            calibration: extractCalibration(exp),
        },
        legacyFields: {
            testId,
            operatorName,
            laboratoryName,
            fieldName,
            wellNumber,
        },
        editedRecipe,
        editedWaterParams,
        editedWaterSource,
        cycles,
        companyName: overrides.companyName,
        companyLogo: overrides.companyLogo,
        chartSettings: overrides.chartSettings,
        language: overrides.language,
        unitSystem: overrides.unitSystem,
        showTouchPoints: overrides.showTouchPoints,
        viscosityThreshold: overrides.viscosityThreshold,
        showTargetTime: overrides.showTargetTime,
        targetTime: overrides.targetTime,
        showCalibration: overrides.showCalibration,
        showRawData: overrides.showRawData,
        showRecipe: overrides.showRecipe,
        showWaterAnalysis: overrides.showWaterAnalysis,
        reportViscosityRates: overrides.reportViscosityRates,
        isExpert: overrides.isExpert,
    };
}
