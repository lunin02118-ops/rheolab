/**
 * Experiment data mappers.
 *
 * Converts raw experiment records from the database into ParseResult
 * objects for use in the dashboard.
 *
 * @module experiments/mappers
 */

import { toFiniteNumber } from '@/lib/utils/numbers';
import type { ParseResult } from '@/types';
import type { RecipeComponent } from '@/components/analysis/recipe-panel';

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
        metadata: {
            filename: String(exp.originalFilename ?? ''),
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
