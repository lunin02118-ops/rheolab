/**
 * Pure functions to build PdfReportInput and ExcelReportInput objects.
 *
 * These are side-effect-free data assemblers extracted from ReportsPanel
 * so they can be unit-tested independently.
 */

import type { PdfReportInput, ExcelReportInput } from '@/lib/analysis/report-types/types';
import type { RheoCycle, GraceCycleResult } from '@/lib/analysis/types';
import type { RecipeComponent } from '@/lib/parsing/types';
import type { WaterParams } from '@/types';
import type { ChartSettings } from '@/lib/store/chart-settings-store';

// ── Local type aliases ──────────────────────────────────────────────────

type RecipeWithBatch = RecipeComponent & { batchNumber?: string };
type WaterParamsExtended = WaterParams & { salinity?: number; hardness?: number };

// ── Shared mapping helpers ──────────────────────────────────────────────

export interface RawDataRow {
    time_sec: number;
    viscosity_cp: number;
    temperature_c: number;
    shear_rate: number;
    shear_stress_pa: number;
    shear_stress: number;
    speed_rpm: number;
    pressure_bar: number;
    bath_temperature_c?: number;
}

export interface CycleResultRow {
    cycleNo: number;
    timeMin: number;
    tempC: number;
    pressure_bar: number;
    nPrime: number;
    kPrime: number;
    kSlot?: number;
    kPipe?: number;
    r2: number;
    viscAt40?: number;
    viscAt100?: number;
    viscAt170?: number;
    viscosities: Record<number, number>;
    binghamPv?: number;
    binghamYp?: number;
    binghamR2?: number;
}

export function mapRawData(data: Array<{
    time_sec: number;
    viscosity_cp: number;
    temperature_c: number;
    shear_rate_s1: number;
    shear_stress_pa: number;
    speed_rpm: number;
    pressure_bar: number;
    bath_temperature_c?: number;
}>): RawDataRow[] {
    return data.map(p => ({
        time_sec: p.time_sec,
        viscosity_cp: p.viscosity_cp,
        temperature_c: p.temperature_c,
        shear_rate: p.shear_rate_s1,
        shear_stress_pa: p.shear_stress_pa,
        shear_stress: p.shear_stress_pa,
        speed_rpm: p.speed_rpm,
        pressure_bar: p.pressure_bar,
        bath_temperature_c: p.bath_temperature_c,
    }));
}

export function mapCycleResults(cycleResults: Map<number, GraceCycleResult>): CycleResultRow[] {
    return Array.from(cycleResults.values()).map((r: GraceCycleResult) => ({
        cycleNo: r.cycleNo,
        timeMin: r.timeMin || r.endTimeMin || 0,
        tempC: r.tempC || 25,
        pressure_bar: r.pressure_bar,
        nPrime: r.n_prime || 0,
        kPrime: r.K_prime_PaSn || 0,
        kSlot: isFinite(r.K_prime_slot_PaSn) ? r.K_prime_slot_PaSn : undefined,
        kPipe: isFinite(r.K_pipe_PaSn) ? r.K_pipe_PaSn : undefined,
        r2: r.r2 || 0,
        viscAt40: r.viscAt40,
        viscAt100: r.viscAt100,
        viscAt170: r.viscAt170,
        viscosities: r.viscosities || {},
        binghamPv: r.bingham_PV_PaS,
        binghamYp: r.bingham_YP_Pa,
        binghamR2: r.bingham_r2,
    }));
}

// ── Line settings builder (shared between PDF and Excel) ────────────────

function buildLineSettings(reportSettings: ChartSettings) {
    return {
        viscosity: {
            color: reportSettings.lines.viscosity.color,
            width: reportSettings.lines.viscosity.width,
            style: reportSettings.lines.viscosity.style,
        },
        temperature: {
            color: reportSettings.lines.temperature.color,
            width: reportSettings.lines.temperature.width,
            style: reportSettings.lines.temperature.style,
        },
        shearRate: {
            color: reportSettings.lines.shearRate.color,
            width: reportSettings.lines.shearRate.width,
            style: reportSettings.lines.shearRate.style,
        },
        pressure: {
            color: reportSettings.lines.pressure.color,
            width: reportSettings.lines.pressure.width,
            style: reportSettings.lines.pressure.style,
        },
        rpm: {
            color: reportSettings.lines.rpm.color,
            width: reportSettings.lines.rpm.width,
            style: reportSettings.lines.rpm.style,
        },
        bathTemperature: {
            color: reportSettings.lines.bathTemperature.color,
            width: reportSettings.lines.bathTemperature.width,
            style: reportSettings.lines.bathTemperature.style,
        },
    };
}

// ── Calibration data builder ────────────────────────────────────────────

function buildCalibrationData(calibration?: {
    deviceType?: string;
    lastCalDate?: string;
    rSquared?: number;
    slope?: number;
    intercept?: number;
    hysteresis?: number;
    stdev?: number;
    status?: string;
}) {
    if (!calibration) return undefined;
    return {
        deviceType: calibration.deviceType,
        calibrationDate: calibration.lastCalDate,
        rSquared: calibration.rSquared,
        slope: calibration.slope,
        intercept: calibration.intercept,
        hysteresis: calibration.hysteresis,
        stdev: calibration.stdev,
        status: calibration.status,
    };
}

// ── Formatted test date ─────────────────────────────────────────────────

function formatTestDate(testDate?: Date | string): string | undefined {
    if (!testDate) return undefined;
    if (testDate instanceof Date) return testDate.toISOString().split('T')[0];
    return String(testDate);
}

// ── Build context: everything the builders need ─────────────────────────

export interface ReportBuildContext {
    rawDataMapped: RawDataRow[];
    cycleResultsMapped: CycleResultRow[];
    metadata: {
        filename?: string;
        testDate?: Date | string;
        instrumentType?: string;
        geometry?: string;
        geometrySource?: string;
        sheetName?: string;
        calibration?: {
            deviceType?: string;
            lastCalDate?: string;
            rSquared?: number;
            slope?: number;
            intercept?: number;
            hysteresis?: number;
            stdev?: number;
            status?: string;
        };
        filenameMetadata?: { operatorName?: string };
    };
    legacyFields: {
        testId?: string;
        operatorName?: string;
        laboratoryName?: string;
        fieldName?: string;
        wellNumber?: string;
    };
    editedRecipe: RecipeComponent[];
    editedWaterParams: Partial<WaterParams> | null;
    editedWaterSource: string;
    cycles: RheoCycle[];
    companyName: string;
    companyLogo: string | null;
    reportSettings: ChartSettings;
    language: 'ru' | 'en';
    unitSystem: 'SI' | 'Imperial';
    showTouchPoints: boolean;
    viscosityThreshold: number;
    showTargetTime: boolean;
    targetTime: number;
    showCalibration: boolean;
    showRawData: boolean;
    reportViscosityRates: number[];
    isExpert: boolean;
}

// ── PDF builder ─────────────────────────────────────────────────────────

export function buildPdfReportInput(ctx: ReportBuildContext): PdfReportInput {
    const { reportSettings } = ctx;

    return {
        rawData: ctx.rawDataMapped,
        metadata: {
            filename: ctx.metadata.filename || 'report',
            testId: ctx.legacyFields.testId,
            testDate: formatTestDate(ctx.metadata.testDate),
            operatorName: ctx.legacyFields.operatorName,
            laboratoryName: ctx.legacyFields.laboratoryName,
            fieldName: ctx.legacyFields.fieldName,
            wellNumber: ctx.legacyFields.wellNumber,
            instrumentType: ctx.metadata.instrumentType,
            geometry: ctx.metadata.geometry,
            companyName: ctx.companyName,
            companyLogoBase64: ctx.companyLogo || undefined,
            calibration: buildCalibrationData(ctx.metadata.calibration),
        },
        cycleResults: ctx.cycleResultsMapped,
        recipe: ctx.editedRecipe.map((r: RecipeComponent) => {
            const recipeItem = r as RecipeWithBatch;
            return {
                name: r.reagentName || r.abbreviation || 'Unknown Component',
                concentration: r.concentration || 0,
                unit: r.unit || 'кг/м³',
                category: r.category,
                batchNumber: recipeItem.batchNumber,
            };
        }),
        waterParams: ctx.editedWaterParams ? (() => {
            const params = ctx.editedWaterParams as WaterParamsExtended;
            return {
                source: ctx.editedWaterSource,
                salinity: params.salinity,
                ph: ctx.editedWaterParams!.ph ?? undefined,
                hardness: params.hardness,
            };
        })() : undefined,
        chartImageBase64: undefined,
        cycles: ctx.cycles?.map(c => ({
            type: c.type,
            steps: c.steps.map(s => ({ avgShearRate: s.avgShearRate })),
        })),
        settings: {
            language: ctx.language,
            unitSystem: ctx.unitSystem,
            showTouchPoints: ctx.showTouchPoints,
            viscosityThreshold: ctx.viscosityThreshold,
            showTargetTime: ctx.showTargetTime,
            targetTime: ctx.targetTime,
            showCalibration: ctx.showCalibration,
            showRawData: ctx.showRawData,
            viscosityShearRates: ctx.reportViscosityRates,
            showAdvancedStats: ctx.isExpert,
            showTemperature: reportSettings.lines.temperature.visible,
            showShearRate: reportSettings.lines.shearRate.visible,
            showPressure: reportSettings.lines.pressure.visible,
            showBathTemperature: reportSettings.lines.bathTemperature.visible,
            shearRateAxis: reportSettings.lines.shearRate.axis,
            pressureAxis: reportSettings.lines.pressure.axis,
            axisMode: reportSettings.comparisonAxisMode ?? 'individual',
            lineSettings: buildLineSettings(reportSettings),
        },
    };
}

// ── Excel builder ───────────────────────────────────────────────────────

export function buildExcelReportInput(ctx: ReportBuildContext): ExcelReportInput {
    const { reportSettings } = ctx;

    return {
        rawData: ctx.rawDataMapped,
        metadata: {
            filename: ctx.metadata.filename || 'report',
            testId: ctx.legacyFields.testId,
            testDate: formatTestDate(ctx.metadata.testDate),
            operatorName: ctx.legacyFields.operatorName,
            fieldName: ctx.legacyFields.fieldName,
            wellNumber: ctx.legacyFields.wellNumber,
            instrumentType: ctx.metadata.instrumentType,
            geometry: ctx.metadata.geometry,
            companyName: ctx.companyName,
            laboratoryName: ctx.legacyFields?.laboratoryName,
            calibration: buildCalibrationData(ctx.metadata.calibration),
        },
        cycleResults: ctx.cycleResultsMapped,
        recipe: ctx.editedRecipe.map((r: RecipeComponent) => ({
            name: r.reagentName || r.abbreviation || '',
            concentration: r.concentration || 0,
            unit: r.unit || 'кг/м³',
            category: r.category,
        })),
        waterParams: ctx.editedWaterParams ? (() => {
            const params = ctx.editedWaterParams as WaterParamsExtended;
            return {
                source: ctx.editedWaterSource,
                salinity: params.salinity,
                ph: ctx.editedWaterParams!.ph ?? undefined,
                hardness: params.hardness,
            };
        })() : undefined,
        settings: {
            unitSystem: ctx.unitSystem,
            showTemperature: reportSettings.lines.temperature.visible,
            showShearRate: reportSettings.lines.shearRate.visible,
            showPressure: reportSettings.lines.pressure.visible,
            showBathTemperature: reportSettings.lines.bathTemperature.visible,
            showTouchPoints: ctx.showTouchPoints,
            showCalibration: ctx.showCalibration,
            showRawData: ctx.showRawData,
            viscosityThreshold: ctx.viscosityThreshold,
            showTargetTime: ctx.showTargetTime,
            targetTime: ctx.targetTime,
            language: ctx.language,
            viscosityShearRates: ctx.reportViscosityRates,
            showAdvancedStats: ctx.isExpert,
            shearRateAxis: reportSettings.lines.shearRate.axis,
            pressureAxis: reportSettings.lines.pressure.axis,
            axisMode: reportSettings.comparisonAxisMode ?? 'individual',
            lineSettings: buildLineSettings(reportSettings),
        },
        cycles: ctx.cycles?.map(c => ({
            type: c.type,
            steps: c.steps.map(s => ({ avgShearRate: s.avgShearRate })),
        })),
    };
}
