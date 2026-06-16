import type { Experiment, ExperimentSavePayload, TestMetrics } from '@/types';
import type { RheoDataPoint } from '@/lib/parsing/types';
import { columnarToRawPoints } from '@/lib/utils/columnar';
import { isFluidType } from '@/lib/constants/fluid-types';
import { detectTestCategoryAndType } from '@/lib/utils/test-type-detector';

export function isFileBackedComparisonExperiment(exp: Experiment): boolean {
    return typeof exp.id === 'string' && exp.id.startsWith('file-');
}

export function localComparisonExperimentLabel(exp: Experiment): string {
    return stringValue((exp as { originalFilename?: unknown }).originalFilename)
        ?? stringValue(exp.name)
        ?? exp.id;
}

export function withLocalComparisonSaveConflictSuffix(
    payload: ExperimentSavePayload,
): ExperimentSavePayload {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return {
        ...payload,
        name: `${payload.name} ${stamp}`,
    };
}

export function buildLocalComparisonExperimentSavePayload(exp: Experiment): ExperimentSavePayload {
    const points = rawPointsForExperiment(exp);
    if (points.length === 0) {
        throw new Error('Локальный файл не содержит точек данных для сохранения.');
    }

    const originalFilename = localComparisonExperimentLabel(exp);
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

function dateForExperiment(exp: Experiment): Date {
    if (exp.testDate instanceof Date && !Number.isNaN(exp.testDate.getTime())) return exp.testDate;
    if (typeof exp.testDate === 'string') {
        const parsed = new Date(exp.testDate);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date();
}
