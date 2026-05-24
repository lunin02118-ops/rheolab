/**
 * Pure functions to build PdfReportInput and ExcelReportInput objects.
 *
 * These are side-effect-free data assemblers extracted from ReportsPanel
 * so they can be unit-tested independently.
 */

import type { PdfReportInput, ExcelReportInput } from '@/lib/analysis/report-types/types';
import type { RheoCycle, GraceCycleResult } from '@/lib/analysis/types';
import type { RecipeComponent } from '@/lib/parsing/types';
import type { RheologyParameterRow, RheologyParameterSource, WaterParams } from '@/types';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import {
    finiteOr,
    rheologyParameterRowToGraceCycleResult,
} from '@/lib/analysis/rheology-parameter-mapping';

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

function optionalFinite(value: number | null | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function mapGraceCycleResultToCycleResultRow(r: GraceCycleResult): CycleResultRow {
    return {
        cycleNo: r.cycleNo,
        timeMin: finiteOr(r.timeMin, finiteOr(r.endTimeMin, 0)),
        tempC: finiteOr(r.tempC, 25),
        pressure_bar: finiteOr(r.pressure_bar, 0),
        nPrime: finiteOr(r.n_prime, 0),
        kPrime: finiteOr(r.K_prime_PaSn, 0),
        kSlot: optionalFinite(r.K_prime_slot_PaSn),
        kPipe: optionalFinite(r.K_pipe_PaSn),
        r2: finiteOr(r.r2, 0),
        viscAt40: optionalFinite(r.viscAt40),
        viscAt100: optionalFinite(r.viscAt100),
        viscAt170: optionalFinite(r.viscAt170),
        viscosities: r.viscosities || {},
        binghamPv: optionalFinite(r.bingham_PV_PaS),
        binghamYp: optionalFinite(r.bingham_YP_Pa),
        binghamR2: optionalFinite(r.bingham_r2),
    };
}

export function mapCycleResults(cycleResults: Map<number, GraceCycleResult>): CycleResultRow[] {
    return Array.from(cycleResults.values()).map(mapGraceCycleResultToCycleResultRow);
}

export function mapRheologyParameterRows(rows: readonly RheologyParameterRow[]): CycleResultRow[] {
    return [...rows]
        .sort((a, b) => a.cycleNo - b.cycleNo)
        .map(row => mapGraceCycleResultToCycleResultRow(
            rheologyParameterRowToGraceCycleResult(row),
        ));
}

// ── Line settings builder (shared between PDF and Excel) ────────────────

function buildLineSettings(chartSettings: ChartSettings) {
    return {
        viscosity: {
            color: chartSettings.lines.viscosity.color,
            width: chartSettings.lines.viscosity.width,
            style: chartSettings.lines.viscosity.style,
            unit: chartSettings.lines.viscosity.unit,
        },
        temperature: {
            color: chartSettings.lines.temperature.color,
            width: chartSettings.lines.temperature.width,
            style: chartSettings.lines.temperature.style,
            unit: chartSettings.lines.temperature.unit,
        },
        shearRate: {
            color: chartSettings.lines.shearRate.color,
            width: chartSettings.lines.shearRate.width,
            style: chartSettings.lines.shearRate.style,
            unit: chartSettings.lines.shearRate.unit,
        },
        pressure: {
            color: chartSettings.lines.pressure.color,
            width: chartSettings.lines.pressure.width,
            style: chartSettings.lines.pressure.style,
            unit: chartSettings.lines.pressure.unit,
        },
        rpm: {
            color: chartSettings.lines.rpm.color,
            width: chartSettings.lines.rpm.width,
            style: chartSettings.lines.rpm.style,
            unit: chartSettings.lines.rpm.unit,
        },
        bathTemperature: {
            color: chartSettings.lines.bathTemperature.color,
            width: chartSettings.lines.bathTemperature.width,
            style: chartSettings.lines.bathTemperature.style,
            unit: chartSettings.lines.bathTemperature.unit,
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
    chartSettings: ChartSettings;
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
    reportViscosityRates: number[];
    isExpert: boolean;
    rheologySource: RheologyParameterSource;
}

// ── PDF builder ─────────────────────────────────────────────────────────

export function buildPdfReportInput(ctx: ReportBuildContext): PdfReportInput {
    const { chartSettings } = ctx;

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
        recipe: ctx.showRecipe ? ctx.editedRecipe.map((r: RecipeComponent) => {
            const recipeItem = r as RecipeWithBatch;
            return {
                name: r.reagentName || r.abbreviation || 'Unknown Component',
                concentration: r.concentration || 0,
                unit: r.unit || 'кг/м³',
                category: r.category,
                batchNumber: recipeItem.batchNumber,
            };
        }) : [],
        waterParams: ctx.showWaterAnalysis && ctx.editedWaterParams ? (() => {
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
            rheologySource: ctx.rheologySource,
            showCalibration: ctx.showCalibration,
            showRawData: ctx.showRawData,
            viscosityShearRates: ctx.reportViscosityRates,
            showAdvancedStats: true,
            showTemperature: chartSettings.lines.temperature.visible,
            showShearRate: chartSettings.lines.shearRate.visible,
            showPressure: chartSettings.lines.pressure.visible,
            showBathTemperature: chartSettings.lines.bathTemperature.visible,
            shearRateAxis: chartSettings.lines.shearRate.axis,
            pressureAxis: chartSettings.lines.pressure.axis,
            axisMode: chartSettings.comparisonAxisMode ?? 'individual',
            lineSettings: buildLineSettings(chartSettings),
            // Mirror the UI's per-category unit preferences into the
            // report input so the Rust backend can render stats with
            // the exact same labels and numeric conversions the user
            // sees on the Analysis tab.  Reading from `chartSettings`
            // here (not from `ctx.unitSystem`) ensures mixed / custom
            // presets like `{ viscosity: 'cP', consistency: 'Pa·s^n' }`
            // survive the trip to PDF / Excel.
            rheologyUnits: {
                viscosity: chartSettings.rheologyUnits.viscosity,
                temperature: chartSettings.rheologyUnits.temperature,
                pressure: chartSettings.rheologyUnits.pressure,
                consistency: chartSettings.rheologyUnits.consistency,
                plasticViscosity: chartSettings.rheologyUnits.plasticViscosity,
                yieldPoint: chartSettings.rheologyUnits.yieldPoint,
                timeFormat: chartSettings.rheologyUnits.timeFormat,
            },
        },
    };
}

// ── Excel builder ───────────────────────────────────────────────────────

export function buildExcelReportInput(ctx: ReportBuildContext): ExcelReportInput {
    const { chartSettings } = ctx;

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
        recipe: ctx.showRecipe ? ctx.editedRecipe.map((r: RecipeComponent) => ({
            name: r.reagentName || r.abbreviation || '',
            concentration: r.concentration || 0,
            unit: r.unit || 'кг/м³',
            category: r.category,
        })) : [],
        waterParams: ctx.showWaterAnalysis && ctx.editedWaterParams ? (() => {
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
            showTemperature: chartSettings.lines.temperature.visible,
            showShearRate: chartSettings.lines.shearRate.visible,
            showPressure: chartSettings.lines.pressure.visible,
            showBathTemperature: chartSettings.lines.bathTemperature.visible,
            showTouchPoints: ctx.showTouchPoints,
            showCalibration: ctx.showCalibration,
            showRawData: ctx.showRawData,
            viscosityThreshold: ctx.viscosityThreshold,
            showTargetTime: ctx.showTargetTime,
            targetTime: ctx.targetTime,
            rheologySource: ctx.rheologySource,
            language: ctx.language,
            viscosityShearRates: ctx.reportViscosityRates,
            showAdvancedStats: true,
            shearRateAxis: chartSettings.lines.shearRate.axis,
            pressureAxis: chartSettings.lines.pressure.axis,
            axisMode: chartSettings.comparisonAxisMode ?? 'individual',
            lineSettings: buildLineSettings(chartSettings),
            // See rationale in buildPdfReportInput — the Excel report
            // must use the same per-category targets so its column
            // labels and cell values match the UI and the PDF.
            rheologyUnits: {
                viscosity: chartSettings.rheologyUnits.viscosity,
                temperature: chartSettings.rheologyUnits.temperature,
                pressure: chartSettings.rheologyUnits.pressure,
                consistency: chartSettings.rheologyUnits.consistency,
                plasticViscosity: chartSettings.rheologyUnits.plasticViscosity,
                yieldPoint: chartSettings.rheologyUnits.yieldPoint,
                timeFormat: chartSettings.rheologyUnits.timeFormat,
            },
        },
        cycles: ctx.cycles?.map(c => ({
            type: c.type,
            steps: c.steps.map(s => ({ avgShearRate: s.avgShearRate })),
        })),
    };
}
