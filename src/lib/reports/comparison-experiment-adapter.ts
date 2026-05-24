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

import type {
    Experiment,
    ColumnarData,
    RheologyParameterRow,
    RheologyParameterSource,
    WaterParams,
} from '@/types';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import type { RecipeComponent } from '@/lib/parsing/types';
import type { ReportBuildContext } from '@/lib/reports/report-builders';
import { mapRawData, mapCycleResults, mapRheologyParameterRows } from '@/lib/reports/report-builders';
import { columnarToRawPoints, tauriRawRecordsToColumnar } from '@/lib/utils/columnar';
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

// ── Analysis cache ─────────────────────────────────────────────────────────
//
// Comparison report exports run the full Grace analysis pipeline once
// per experiment per export.  When the same selection is exported in
// PDF and Excel back-to-back (the dominant flow) the analysis runs
// twice for every experiment; for a 5-experiment comparison that's
// 5 redundant analyses on the second click.
//
// PERF-002 (audit-preflight): cache the analysis output keyed by
// (expId, updatedAt, geometry, sorted shear-rates).  The key includes
// `updatedAt` so editing an experiment invalidates its cache entry on
// the next access; it includes the shear-rate set so switching expert
// mode rates also invalidates.  All other inputs to `analyzeData` are
// constants (beginner-mode detection settings) so they don't need to
// be in the key.
//
// Cap is small: comparison views rarely exceed a few dozen experiments
// at once; 50 entries is generous and keeps memory bounded.  LRU
// eviction is implemented via Map's insertion-order semantics:
// re-inserting on hit moves a key to the end; oldest is at the front.

interface AnalysisCacheValue {
    readonly cycles: ReportBuildContext['cycles'];
    readonly cycleResultsMapped: ReportBuildContext['cycleResultsMapped'];
}

const ANALYSIS_CACHE_CAP = 50;
const analysisCache = new Map<string, AnalysisCacheValue>();

function buildAnalysisCacheKey(
    expId: string,
    updatedAt: string,
    geometryKey: string,
    shearRates: readonly number[],
): string {
    const ratesSig = [...shearRates]
        .sort((a, b) => a - b)
        .map((r) => r.toFixed(2))
        .join(',');
    return `${expId}|${updatedAt}|${geometryKey}|${ratesSig}`;
}

function analysisCacheGet(key: string): AnalysisCacheValue | undefined {
    const v = analysisCache.get(key);
    if (!v) return undefined;
    // LRU touch: move to end of insertion order.
    analysisCache.delete(key);
    analysisCache.set(key, v);
    return v;
}

function analysisCacheSet(key: string, value: AnalysisCacheValue): void {
    if (analysisCache.has(key)) analysisCache.delete(key);
    analysisCache.set(key, value);
    while (analysisCache.size > ANALYSIS_CACHE_CAP) {
        const oldest = analysisCache.keys().next().value;
        if (oldest === undefined) break;
        analysisCache.delete(oldest);
    }
}

/**
 * Clear the comparison-adapter analysis cache.
 *
 * Useful for tests and for the (currently unused) "regenerate all"
 * code path that wants to force a re-analysis even when nothing in the
 * cache key has changed.
 */
export function clearComparisonAnalysisCache(): void {
    analysisCache.clear();
}

/**
 * Inspect the current analysis cache size — exposed for tests only.
 * Do not consume from production code.
 *
 * @internal
 */
export function getComparisonAnalysisCacheSize(): number {
    return analysisCache.size;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function safeRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function extractColumnarData(exp: Experiment): ColumnarData | null {
    const record = exp as Record<string, unknown>;
    const col = record.columnarData as ColumnarData | undefined;
    if (col && col.timeSec && col.timeSec.length > 0) return col;

    const rawPoints = record.rawPoints;
    if (Array.isArray(rawPoints) && rawPoints.length > 0) {
        return tauriRawRecordsToColumnar(rawPoints as Array<Record<string, unknown>>);
    }

    return null;
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

function isRheologySource(value: unknown): value is RheologyParameterSource {
    return value === 'instrument' || value === 'program';
}

function extractRheologyRows(
    record: Record<string, unknown>,
    source: RheologyParameterSource,
): RheologyParameterRow[] {
    const storedRows = Array.isArray(record.rheologyParameters)
        ? record.rheologyParameters
        : [];

    if (storedRows.length > 0) {
        return storedRows
            .filter((row): row is RheologyParameterRow => {
                if (!row || typeof row !== 'object') return false;
                return (row as { source?: unknown }).source === source;
            })
            .map((row) => ({ ...row, source }));
    }

    if (source !== 'instrument' || !Array.isArray(record.instrumentRheology)) {
        return [];
    }

    return record.instrumentRheology
        .filter((row): row is RheologyParameterRow => {
            if (!row || typeof row !== 'object') return false;
            const rowSource = (row as { source?: unknown }).source;
            return rowSource === undefined || rowSource === 'instrument';
        })
        .map((row) => ({ ...row, source: 'instrument' }));
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
    rheologySourceOverride?: RheologyParameterSource;
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

    const savedSource = isRheologySource(record.rheologySource)
        ? record.rheologySource
        : undefined;
    const effectiveRheologySource = overrides.rheologySourceOverride ?? savedSource ?? 'program';
    if (effectiveRheologySource === 'instrument') {
        const instrumentRows = extractRheologyRows(record, 'instrument');
        if (instrumentRows.length === 0) {
            throw new Error(
                `Для эксперимента "${exp.name || exp.id}" выбрана реология прибора, но таблица реологических расчётов не найдена.`,
            );
        }
        cycleResultsMapped = mapRheologyParameterRows(instrumentRows);
    } else {
        const programRows = extractRheologyRows(record, 'program');
        if (programRows.length > 0) {
            cycleResultsMapped = mapRheologyParameterRows(programRows);
        }
    }

    if (columnar) {
        try {
            const geometryKey =
                typeof record.geometry === 'string' ? (record.geometry as string) : 'R1B5';

            // Use the *same* shear-rate list the comparison-report header is
            // built from. Otherwise the Rust pipeline only computes viscosities
            // for the hard-coded defaults [40, 100, 170] and any user-added
            // expert-mode rate (e.g. 220 1/s) renders as "-" for every cycle —
            // the column header shows up because it is driven by
            // `reportViscosityRates`, but no value is ever computed for it.
            // Filter out zero / negative rates: `calc_visc` returns 0 for
            // those and they would only pollute the report.
            const analysisShearRates = overrides.reportViscosityRates
                .filter((r) => Number.isFinite(r) && r > 0);
            const effectiveRates = analysisShearRates.length > 0
                ? analysisShearRates
                : ([...DEFAULT_VISCOSITY_SHEAR_RATES] as number[]);

            // PERF-002: short-circuit if we already analysed this exact
            // (experiment, updatedAt, geometry, shearRates) combination
            // earlier in this session.
            const updatedAt = typeof record.updatedAt === 'string'
                ? (record.updatedAt as string)
                : '';
            const cacheKey = buildAnalysisCacheKey(
                exp.id,
                updatedAt,
                geometryKey,
                effectiveRates,
            );
            const cached = analysisCacheGet(cacheKey);
            if (cached) {
                cycles = cached.cycles;
                if (cycleResultsMapped.length === 0) {
                    cycleResultsMapped = cached.cycleResultsMapped;
                }
            } else {
                const rheoPoints = columnarToRheoPoints(columnar);

                const detectionSettings = {
                    stepSplitting: true,
                    splitStartDuration: 30,
                    splitEndDuration: 30,
                    minDurationForSplit: 90,
                };

                const expertSettings = {
                    pointsToAverage: 0,
                    viscosityShearRates: effectiveRates,
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
                const analysisCycleResultsMapped = mapCycleResults(result.results);
                if (cycleResultsMapped.length === 0) {
                    cycleResultsMapped = analysisCycleResultsMapped;
                }
                analysisCacheSet(cacheKey, { cycles, cycleResultsMapped: analysisCycleResultsMapped });
            }
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
        rheologySource: effectiveRheologySource,
    };
}
