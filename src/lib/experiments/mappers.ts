/**
 * Experiment data mappers.
 *
 * Converts raw experiment records from the database into ParseResult
 * objects for use in the dashboard.
 *
 * @module experiments/mappers
 */

import { toFiniteNumber } from '@/lib/utils/numbers';
import type { ParseResult, RheologyParameterRow } from '@/types';
import type { RecipeComponent } from '@/components/analysis/recipe-panel';
import type { ExperimentDetailMeta } from '@/types/tauri';

function extractInstrumentRheologyRows(value: unknown): RheologyParameterRow[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((row): row is Partial<RheologyParameterRow> => {
            if (!row || typeof row !== 'object') return false;
            const source = (row as { source?: unknown }).source;
            return source === 'instrument';
        })
        .map((row) => ({
            ...row,
            source: 'instrument' as const,
            cycleNo: Number(row.cycleNo ?? 0),
        }))
        .filter((row) => Number.isFinite(row.cycleNo) && row.cycleNo > 0);
}

/**
 * Map a raw experiment record from the DB into a ParseResult.
 *
 * This was previously inlined in dashboard/page.tsx (~100 lines).
 * Extracted for reusability and testability.
 */
export function mapExperimentToParseResult(exp: Record<string, unknown>): ParseResult {
    const calibrationRecord = exp.calibration as Record<string, unknown> | undefined;

    const data = (exp.rawPoints as Record<string, unknown>[]).map((p) => ({
        time_sec: toFiniteNumber(p.time_sec),
        viscosity_cp: toFiniteNumber(p.viscosity_cp),
        temperature_c: toFiniteNumber(p.temperature_c),
        speed_rpm: toFiniteNumber(p.rpm ?? p.speed_rpm),
        shear_rate_s1: toFiniteNumber(p.shear_rate_s1 ?? p.shear_rate),
        shear_stress_pa: toFiniteNumber(p.shear_stress_pa ?? p.shear_stress),
        pressure_bar: toFiniteNumber(p.pressure_bar, 0),
        bath_temperature_c: p.bath_temperature_c != null ? toFiniteNumber(p.bath_temperature_c) : undefined,
    }));

    // Do NOT build columnarData here. The SoA/columnarData path is for the
    // WASM parser which natively produces SoA output. When the store sees
    // columnarData it zeroes out data[] to save memory, which breaks the
    // chart (DashboardContent builds chartData from data[]). Library loads
    // go through the AoS data[] path — no columnar encoding needed.
    return {
        success: true,
        source: 'regex',
        data,
        instrumentRheology: extractInstrumentRheologyRows(exp.rheologyParameters),
        metadata: {
            filename: String(exp.originalFilename ?? ''),
            experimentId: exp.id != null ? String(exp.id) : undefined,
            rheologySource: exp.rheologySource === 'instrument' ? 'instrument' : 'program',
            instrumentType: exp.instrumentType != null ? String(exp.instrumentType) : undefined,
            testDate: new Date(exp.testDate as string),
            geometry: exp.geometry != null ? String(exp.geometry) : undefined,
            geometrySource: exp.geometry
                ? ((exp.geometrySource as 'context' | 'loose' | 'physics' | 'default' | undefined) || 'default')
                : 'default',
            calibration: calibrationRecord
                ? {
                    deviceType: String(calibrationRecord.deviceType ?? ''),
                    rSquared: toFiniteNumber(calibrationRecord.rSquared),
                    slope: toFiniteNumber(calibrationRecord.slope),
                    intercept: toFiniteNumber(calibrationRecord.intercept),
                    hysteresis: toFiniteNumber(calibrationRecord.hysteresis),
                    stdev: toFiniteNumber(calibrationRecord.stdev),
                    status: calibrationRecord.status === 'PASS' ? 'PASS' : 'FAIL',
                    lastCalDate: calibrationRecord.calibrationDate
                        ? String(calibrationRecord.calibrationDate)
                        : undefined,
                    calibrationDate: calibrationRecord.calibrationDate
                        ? new Date(String(calibrationRecord.calibrationDate))
                        : undefined,
                    issues: Array.isArray(calibrationRecord.issues)
                        ? calibrationRecord.issues.map((issue: unknown) => String(issue))
                        : [],
                    rawData: typeof calibrationRecord.rawData === 'string'
                        ? calibrationRecord.rawData
                        : JSON.stringify(calibrationRecord.rawData ?? []),
                }
                : undefined,
            filenameMetadata: {
                testId: (exp.testId ?? exp.name) as string | undefined,
                fieldName: exp.fieldName as string | undefined,
                operatorName: exp.operatorName as string | undefined,
                wellNumber: exp.wellNumber as string | undefined,
                waterSource: exp.waterSource as string | undefined,
                savedExperimentName: exp.name as string | undefined,

                laboratoryName: (exp.laboratory as Record<string, unknown> | undefined)?.name as string | undefined,
            },
            // V8 round-trip: restore parser provenance
            parsedBy: exp.parsedBy as string | undefined || undefined,
            parseSource: exp.parseSource as string | undefined || undefined,
        },
        summary: {
            pointCount: data.length,
            viscosityRange: {
                min: toFiniteNumber(exp.viscosityMin, 0),
                max: toFiniteNumber((exp.metrics as Record<string, unknown> | undefined)?.maxViscosity, 0),
            },
            temperatureRange: {
                min: 0,
                max: toFiniteNumber((exp.metrics as Record<string, unknown> | undefined)?.maxTemp, 0),
            },
            pressureRange: {
                min: 0,
                max: toFiniteNumber(exp.pressureMax, 0),
            },
            timeRange: exp.timeRangeMin != null && exp.timeRangeMax != null
                ? {
                    start: toFiniteNumber(exp.timeRangeMin, 0),
                    end: toFiniteNumber(exp.timeRangeMax, 0),
                    durationMinutes: (toFiniteNumber(exp.timeRangeMax, 0) - toFiniteNumber(exp.timeRangeMin, 0)) / 60,
                }
                : undefined,
        },
    };
}

/**
 * Map lightweight saved-experiment metadata into the dashboard's ParseResult
 * shape without raw points. Chart and analysis hot paths then load by id.
 */
export function mapExperimentDetailMetaToParseResult(meta: ExperimentDetailMeta): ParseResult {
    const calibrationRecord = meta.calibration as Record<string, unknown> | null | undefined;
    const metrics = (meta.metrics ?? {}) as Record<string, unknown>;
    const timeStart = meta.summary.timeRangeMin;
    const timeEnd = meta.summary.timeRangeMax;

    return {
        success: true,
        source: 'regex',
        data: [],
        instrumentRheology: extractInstrumentRheologyRows(meta.rheologyParameters),
        parsedBy: (meta.parsedBy as ParseResult['parsedBy']) || undefined,
        metadata: {
            filename: meta.originalFilename,
            experimentId: meta.id,
            rheologySource: meta.rheologySource === 'instrument' ? 'instrument' : 'program',
            instrumentType: meta.instrumentType || undefined,
            testDate: new Date(meta.testDate),
            geometry: meta.geometry || undefined,
            geometrySource: meta.geometry
                ? ((meta.geometrySource as ParseResult['metadata']['geometrySource']) || 'default')
                : 'default',
            calibration: calibrationRecord
                ? {
                    deviceType: String(calibrationRecord.deviceType ?? ''),
                    rSquared: toFiniteNumber(calibrationRecord.rSquared),
                    slope: toFiniteNumber(calibrationRecord.slope),
                    intercept: toFiniteNumber(calibrationRecord.intercept),
                    hysteresis: toFiniteNumber(calibrationRecord.hysteresis),
                    stdev: toFiniteNumber(calibrationRecord.stdev),
                    status: calibrationRecord.status === 'PASS' ? 'PASS' : 'FAIL',
                    lastCalDate: calibrationRecord.calibrationDate
                        ? String(calibrationRecord.calibrationDate)
                        : undefined,
                    calibrationDate: calibrationRecord.calibrationDate
                        ? new Date(String(calibrationRecord.calibrationDate))
                        : undefined,
                    issues: Array.isArray(calibrationRecord.issues)
                        ? calibrationRecord.issues.map((issue: unknown) => String(issue))
                        : [],
                    rawData: typeof calibrationRecord.rawData === 'string'
                        ? calibrationRecord.rawData
                        : JSON.stringify(calibrationRecord.rawData ?? []),
                }
                : undefined,
            filenameMetadata: {
                testId: meta.testId || meta.name || undefined,
                testType: meta.testType || undefined,
                testTypeFull: meta.testCategory || undefined,
                fieldName: meta.fieldName || undefined,
                operatorName: meta.operatorName || undefined,
                wellNumber: meta.wellNumber || undefined,
                waterSource: meta.waterSource || undefined,
                savedExperimentName: meta.name || undefined,
                laboratoryName: meta.laboratory?.name,
            },
            parsedBy: meta.parsedBy || undefined,
            parseSource: meta.parseSource || undefined,
        },
        summary: {
            pointCount: meta.summary.pointCount,
            viscosityRange: {
                min: toFiniteNumber(meta.summary.viscosityMin, 0),
                max: toFiniteNumber(meta.summary.maxViscosity ?? metrics.maxViscosity, 0),
                avg: meta.summary.avgViscosity != null
                    ? toFiniteNumber(meta.summary.avgViscosity, 0)
                    : undefined,
            },
            temperatureRange: {
                min: 0,
                max: toFiniteNumber(metrics.maxTemp ?? metrics.maxTemperatureC, 0),
                avg: metrics.avgTemperatureC != null
                    ? toFiniteNumber(metrics.avgTemperatureC, 0)
                    : undefined,
            },
            pressureRange: {
                min: 0,
                max: toFiniteNumber(meta.summary.pressureMax, 0),
            },
            timeRange: timeStart != null && timeEnd != null
                ? {
                    start: toFiniteNumber(timeStart, 0),
                    end: toFiniteNumber(timeEnd, 0),
                    durationMinutes: (toFiniteNumber(timeEnd, 0) - toFiniteNumber(timeStart, 0)) / 60,
                }
                : undefined,
        },
    };
}

export function isMetadataOnlyParseResult(parseResult: ParseResult | null): boolean {
    return !!parseResult?.metadata?.experimentId
        && (parseResult.data?.length ?? 0) === 0
        && !parseResult.columnarData
        && (parseResult.summary?.pointCount ?? 0) > 0;
}

/**
 * Map raw reagent records from the DB into recipe components.
 */
export function mapReagentsToRecipe(
    reagents: Record<string, unknown>[]
): RecipeComponent[] {
    return reagents.map((r) => ({
        abbreviation: (r.reagent as Record<string, unknown>)?.name as string || '',
        concentration: (r.concentration as number) ?? 0,
        unit: (r.unit as string) ?? '',
        category: (r.reagent as Record<string, unknown>)?.category as string | undefined,
        reagentId: r.reagentId as string | undefined,
        reagentName: (r.reagent as Record<string, unknown>)?.name as string | undefined,
        batchNumber: r.batchNumber ? String(r.batchNumber) : undefined,
        productionDate: r.productionDate ? new Date(r.productionDate as string) : undefined,
    }));
}
