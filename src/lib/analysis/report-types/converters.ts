/**
 * @fileoverview WASM Data Converters - TypeScript <-> WASM Structure Mapping
 *
 * This module provides conversion functions between TypeScript domain objects
 * and WASM-compatible data structures. The Rust WASM engine expects specific
 * field names (snake_case) and types that differ from TypeScript conventions.
 *
 * ## C# Port Notes
 *
 * 1. **Field Naming**: WASM expects snake_case (e.g., `time_sec`, `shear_rate`).
 *    In C#, use `[JsonPropertyName("time_sec")]` attributes or a naming policy.
 *
 * 2. **Null Handling**: Many fields use `?? 0` or `?? null` fallbacks.
 *    In C#, use nullable types and similar coalescing.
 *
 * 3. **Unit Conversion**: Some converters perform unit conversion (e.g., cm→m).
 *    Pay attention to these when implementing C# equivalents.
 *
 * 4. **Report Input**: `convertReportInputToWasm()` shows the complete structure
 *    expected by the Rust PDF/Excel generators. This is critical for report porting.
 *
 * @module wasm/converters
 */

import type { RheoCycle, RheoStep, RheoPoint } from '../types';
import type { GraceCycleResult } from '../types';
import type { ExcelReportInput, PdfReportInput, WasmGraceResult, WasmStep, WasmCycle } from './types';
import { toFiniteNumber, toNullableFiniteNumber, toOptionalFiniteNumber } from '@/lib/utils/numbers';

export { ExcelReportInput, PdfReportInput };

/**
 * Convert TypeScript RheoPoint array to WASM-compatible format.
 *
 * Transforms RheoPoint objects to the format expected by WASM functions.
 * All field names use snake_case to match Rust struct definitions.
 *
 * @param points - Array of TypeScript RheoPoint objects
 * @returns Array of WASM-compatible point objects
 *
 * @example
 * ```typescript
 * const tsPoints: RheoPoint[] = [
 *   { time_sec: 0, shear_rate: 100, shear_stress: 50, viscosity_cp: 500, temperature_c: 80 }
 * ];
 * const wasmPoints = convertPointsToWasm(tsPoints);
 * // wasmPoints ready for WASM function calls
 * ```
 */
export function convertPointsToWasm(points: RheoPoint[]): unknown[] {
    return points.map(p => ({
        time_sec: toFiniteNumber(p.time_sec, 0),
        shear_rate: toNullableFiniteNumber(p.shear_rate),
        shear_stress: toNullableFiniteNumber(p.shear_stress),
        viscosity_cp: toFiniteNumber(p.viscosity_cp, 0),
        temperature_c: toFiniteNumber(p.temperature_c, 0),
        pressure_bar: toNullableFiniteNumber(p.pressure_bar),
    }));
}

/**
 * Convert TypeScript RheoStep array to WASM-compatible WasmStep format.
 *
 * Transforms step objects including all nested points. Handles optional fields
 * with default values to ensure WASM compatibility.
 *
 * @param steps - Array of TypeScript RheoStep objects
 * @returns Array of WasmStep objects ready for WASM functions
 *
 * @example
 * ```typescript
 * const steps = detectSteps(data);
 * const wasmSteps = convertStepsToWasm(steps);
 * const cycles = wasmModule.detect_sst_cycles(wasmSteps);
 * ```
 */
export function convertStepsToWasm(steps: RheoStep[]): WasmStep[] {
    return steps.map(s => ({
        id: s.id,
        startTime: toFiniteNumber(s.startTime, 0),
        endTime: toFiniteNumber(s.endTime, 0),
        duration: toFiniteNumber(s.duration, 0),
        avgShearRate: toFiniteNumber(s.avgShearRate, 0),
        avgShearStress: toFiniteNumber(s.avgShearStress, 0),
        avgViscosity: toFiniteNumber(s.avgViscosity, 0),
        avgTemperature: toFiniteNumber(s.avgTemperature, 0),
        avgPressure: toFiniteNumber(s.avgPressure, 0),
        points: s.points.map(p => ({
            time_sec: toFiniteNumber(p.time_sec, 0),
            shear_rate: toFiniteNumber(p.shear_rate, 0),
            shear_stress: toFiniteNumber(p.shear_stress, 0),
            viscosity_cp: toFiniteNumber(p.viscosity_cp, 0),
            temperature_c: toFiniteNumber(p.temperature_c, 0),
            pressure_bar: toFiniteNumber(p.pressure_bar, 0),
        })),
        calcPointsCount: Number.isFinite(s.calcPointsCount) ? s.calcPointsCount : 0,
        isRamp: s.isRamp,
        startIndex: Number.isFinite(s.startIndex) ? s.startIndex : 0,
        endIndex: Number.isFinite(s.endIndex) ? s.endIndex : 0,
        isSplitStart: s.isSplitStart || false,
    }));
}



/**
 * Convert WASM WasmStep array back to TypeScript RheoStep format.
 *
 * Inverse of `convertStepsToWasm()`. Used when receiving step data
 * from WASM functions that return modified or detected steps.
 *
 * @param wasmSteps - Array of WasmStep objects from WASM
 * @returns Array of TypeScript RheoStep objects
 *
 * @example
 * ```typescript
 * const wasmResult = wasmModule.detect_schedule(data, config);
 * const tsSteps = convertWasmStepsToTS(wasmResult);
 * // tsSteps can now be used in TypeScript business logic
 * ```
 */
export function convertWasmStepsToTS(wasmSteps: WasmStep[]): RheoStep[] {
    return wasmSteps.map(s => {
        const startTime = toFiniteNumber(s.startTime, 0);
        const endTime = toFiniteNumber(s.endTime, 0);
        const rawDuration = toFiniteNumber(s.duration, 0);
        // Fallback: if WASM returns duration=0 but times are valid, compute from times
        const duration = rawDuration > 0 ? rawDuration : Math.max(0, endTime - startTime);
        return {
        id: toFiniteNumber(s.id, 0),
        startTime,
        endTime,
        duration,
        avgShearRate: toFiniteNumber(s.avgShearRate, 0),
        avgShearStress: toFiniteNumber(s.avgShearStress, 0),
        avgViscosity: toFiniteNumber(s.avgViscosity, 0),
        avgTemperature: toFiniteNumber(s.avgTemperature, 0),
        avgPressure: toFiniteNumber(s.avgPressure, 0),
        points: s.points.map(p => ({
            time_sec: toFiniteNumber(p.time_sec, 0),
            viscosity_cp: toFiniteNumber(p.viscosity_cp, 0),
            temperature_c: toFiniteNumber(p.temperature_c, 0),
            shear_rate: toOptionalFiniteNumber(p.shear_rate),
            shear_stress: toOptionalFiniteNumber(p.shear_stress),
            pressure_bar: toOptionalFiniteNumber(p.pressure_bar)
        })),
        calcPointsCount: toFiniteNumber(s.calcPointsCount, 0),
        isRamp: Boolean(s.isRamp),
        startIndex: toFiniteNumber(s.startIndex, 0),
        endIndex: toFiniteNumber(s.endIndex, 0),
        isSplitStart: Boolean(s.isSplitStart)
    };
    });
}

/**
 * Convert WASM cycles array back to TypeScript RheoCycle format.
 *
 * Transforms cycle data returned from WASM detection functions.
 * Handles both `type` and `cycle_type` field variations from Rust.
 *
 * @param wasmCycles - Array of cycle objects from WASM
 * @returns Array of TypeScript RheoCycle objects
 *
 * @example
 * ```typescript
 * const wasmCycles = wasmModule.detect_sst_cycles(wasmSteps);
 * const cycles = convertWasmCyclesToTS(wasmCycles);
 * cycles.forEach(cycle => console.log(cycle.type, cycle.steps.length));
 * ```
 */
export function convertWasmCyclesToTS(wasmCycles: unknown[]): RheoCycle[] {
    if (!wasmCycles) return [];
    return (wasmCycles as WasmCycle[]).map(c => {
        const steps = convertWasmStepsToTS(c.steps);
        const rawDuration = toFiniteNumber(c.duration, 0);
        // Fallback: recompute cycle duration as sum of step durations (matches C# logic)
        const duration = rawDuration > 0 ? rawDuration : steps.reduce((acc, s) => acc + s.duration, 0);
        return {
        id: toFiniteNumber(c.id, 0),
        cycleIndex: toOptionalFiniteNumber(c.cycle_index),
        type: (c.type || c.cycle_type || 'Custom') as RheoCycle['type'],
        steps,
        description: typeof c.description === 'string' ? c.description : '',
        duration,
        models: undefined // Models are calculated later
    };
    });
}

/**
 * Convert TypeScript RheoCycle to WASM-compatible cycle format.
 *
 * Prepares a cycle for WASM functions like `calculate_grace_parameters`.
 * Converts nested steps and uses WASM field naming conventions.
 *
 * @param cycle - TypeScript RheoCycle object
 * @returns WASM-compatible cycle object
 *
 * @example
 * ```typescript
 * const wasmCycle = convertCycleToWasm(cycle);
 * const result = wasmModule.calculate_grace_parameters(wasmCycle, 'R1B5', settings);
 * ```
 */
export function convertCycleToWasm(cycle: RheoCycle): unknown {
    return {
        id: toFiniteNumber(cycle.id, 0),
        cycle_index: toFiniteNumber(cycle.cycleIndex, 0),
        steps: convertStepsToWasm(cycle.steps),
        cycle_type: cycle.type, // Add cycle type
        description: typeof cycle.description === 'string' ? cycle.description : '',
        duration: toFiniteNumber(cycle.duration, 0)
    };
}

/**
 * Convert WASM Grace result to TypeScript GraceCycleResult format.
 *
 * Transforms the snake_case WASM result to camelCase TypeScript conventions.
 * Also converts the viscosities object keys from strings to numbers.
 *
 * @param result - WasmGraceResult from WASM calculation
 * @returns TypeScript GraceCycleResult object
 *
 * @example
 * ```typescript
 * const wasmResult = wasmModule.calculate_grace_from_data(data, geometry, settings, info);
 * if (wasmResult) {
 *   const graceResult = convertWasmResultToGrace(wasmResult);
 *   console.log('n\':', graceResult.n_prime, 'K\':', graceResult.K_prime_PaSn);
 * }
 * ```
 */
export function convertWasmResultToGrace(result: WasmGraceResult): GraceCycleResult {
    const viscosities: { [rate: number]: number } = {};
    for (const [key, value] of Object.entries(result.viscosities)) {
        viscosities[parseFloat(key)] = value;
    }

    return {
        cycleNo: result.cycle_no,
        timeMin: result.time_min,
        endTimeMin: result.end_time_min,
        timeSec: result.time_sec,
        tempC: result.temp_c,
        pressure_bar: result.pressure_bar,
        n_prime: result.n_prime,
        Kv_PaSn: result.kv_pasn,
        r2: result.r2,
        K_prime_PaSn: result.k_prime_pasn,
        K_prime_slot_PaSn: result.k_prime_slot_pasn,
        K_pipe_PaSn: result.k_prime_pipe_pasn,
        viscosities,
        viscAt40: result.visc_at_40,
        viscAt100: result.visc_at_100,
        viscAt170: result.visc_at_170,
        bingham_PV_PaS: result.bingham_pv_pas,
        bingham_YP_Pa: result.bingham_yp_pa,
        bingham_r2: result.bingham_r2,
        calcPoints: result.calc_points,
    };
}

/**
 * Convert PDF/Excel report input to WASM-compatible format.
 *
 * This is a comprehensive converter that transforms the entire report input
 * structure for the Rust PDF/Excel generators. It handles:
 * - Axis value calculation from raw data
 * - Metadata field mapping (camelCase → snake_case)
 * - Cycle results conversion
 * - Recipe and water parameters
 * - Chart settings including line styles
 *
 * ## C# Port Notes
 *
 * This function shows the EXACT structure expected by Rust report generators.
 * When porting, ensure all field names match exactly (snake_case).
 *
 * @param input - TypeScript PdfReportInput or ExcelReportInput
 * @returns WASM-compatible report input object
 *
 * @example
 * ```typescript
 * const input: PdfReportInput = {
 *   metadata: { filename: 'test.xlsx', testId: '123' },
 *   cycleResults: [...],
 *   recipe: [...],
 *   settings: { language: 'en', unitSystem: 'SI', ... }
 * };
 * const wasmInput = convertReportInputToWasm(input);
 * const jsonStr = JSON.stringify(wasmInput);
 * const pdfBytes = wasmModule.generate_pdf_report(jsonStr);
 * ```
 */
export function convertReportInputToWasm(input: PdfReportInput | ExcelReportInput): unknown {
    // Calculate axis ranges if not provided
    let axis_values = null;

    if (input.rawData && input.rawData.length > 0) {
        // Use loop-based min/max instead of Math.min(...arr) to avoid
        // stack overflow on large arrays (>10k points).
        let timeMin = Infinity, timeMax = -Infinity;
        let viscMin = Infinity, viscMax = -Infinity;
        let tempMin = Infinity, tempMax = -Infinity;
        let rateMin = Infinity, rateMax = -Infinity;
        let pressMin = Infinity, pressMax = -Infinity;

        for (const p of input.rawData) {
            const t = p.time_sec || 0;
            const v = p.viscosity_cp || 0;
            const tc = p.temperature_c || 0;
            const r = p.shear_rate || 0;
            const pr = p.pressure_bar || 0;
            if (t < timeMin) timeMin = t;
            if (t > timeMax) timeMax = t;
            if (v < viscMin) viscMin = v;
            if (v > viscMax) viscMax = v;
            if (tc < tempMin) tempMin = tc;
            if (tc > tempMax) tempMax = tc;
            if (r < rateMin) rateMin = r;
            if (r > rateMax) rateMax = r;
            if (pr < pressMin) pressMin = pr;
            if (pr > pressMax) pressMax = pr;
        }

        axis_values = {
            time_min: timeMin === Infinity ? 0 : timeMin / 60,
            time_max: timeMax === -Infinity ? 0 : timeMax / 60,
            viscosity_min: viscMin === Infinity ? 0 : viscMin,
            viscosity_max: viscMax === -Infinity ? 0 : viscMax,
            temperature_min: tempMin === Infinity ? 0 : tempMin,
            temperature_max: tempMax === -Infinity ? 0 : tempMax,
            shear_rate_min: rateMin === Infinity ? 0 : rateMin,
            shear_rate_max: rateMax === -Infinity ? 0 : rateMax,
            pressure_min: pressMin === Infinity ? 0 : pressMin,
            pressure_max: pressMax === -Infinity ? 0 : pressMax,
        };
    }

    // Convert to snake_case for Rust
    return {
        axis_values,
        metadata: {
            filename: input.metadata.filename,
            test_id: input.metadata.testId ?? null,
            test_date: input.metadata.testDate ?? null,
            operator_name: input.metadata.operatorName ?? null,
            laboratory_name: input.metadata.laboratoryName ?? null,
            field_name: input.metadata.fieldName ?? null,
            well_number: input.metadata.wellNumber ?? null,
            instrument_type: input.metadata.instrumentType ?? null,
            geometry: input.metadata.geometry ?? null,
            company_name: input.metadata.companyName ?? null,
            company_logo_base64: input.metadata.companyLogoBase64 ?? null,
            calibration: input.metadata.calibration ? {
                device_type: input.metadata.calibration.deviceType ?? null,
                calibration_date: input.metadata.calibration.calibrationDate ?? null,
                r_squared: input.metadata.calibration.rSquared ?? null,
                slope: input.metadata.calibration.slope ?? null,
                intercept: input.metadata.calibration.intercept ?? null,
                hysteresis: input.metadata.calibration.hysteresis ?? null,
                stdev: input.metadata.calibration.stdev ?? null,
                status: input.metadata.calibration.status ?? null,
            } : null,
        },
        cycle_results: input.cycleResults.map(c => ({
            cycle_no: c.cycleNo,
            time_min: c.timeMin ?? 0,
            temp_c: c.tempC ?? 0,
            pressure_bar: c.pressure_bar ?? null,
            n_prime: c.nPrime,
            k_prime: c.kPrime,
            k_slot: c.kSlot != null && isFinite(c.kSlot) ? c.kSlot : null,
            k_pipe: c.kPipe != null && isFinite(c.kPipe) ? c.kPipe : null,
            r2: c.r2,
            visc_at_40: c.viscAt40 ?? null,
            visc_at_100: c.viscAt100 ?? null,
            visc_at_170: c.viscAt170 ?? null,
            viscosities: c.viscosities ?? {},
            bingham_pv: c.binghamPv ?? null,
            bingham_yp: c.binghamYp ?? null,
            bingham_r2: c.binghamR2 ?? null,
        })),
        recipe: input.recipe.map(r => ({
            name: r.name,
            concentration: r.concentration,
            unit: r.unit,
            category: r.category ?? null,
            batch_number: r.batchNumber ?? null,
        })),
        water_params: input.waterParams ? {
            source: input.waterParams.source ?? null,
            salinity: input.waterParams.salinity ?? null,
            ph: input.waterParams.ph ?? null,
            hardness: input.waterParams.hardness ?? null,
        } : null,
        chart_image_base64: input.chartImageBase64 ?? null,
        cycles: (input.cycles ?? []).map(c => ({
            type: c.type,
            steps: c.steps.map(s => ({ avg_shear_rate: s.avgShearRate })),
        })),
        raw_data: (input.rawData ?? []).map(p => ({
            time_sec: p.time_sec,
            viscosity_cp: p.viscosity_cp,
            temperature_c: p.temperature_c ?? null,
            shear_rate: p.shear_rate ?? null,
            shear_stress_pa: p.shear_stress_pa ?? null,
            speed_rpm: p.speed_rpm ?? null,
            pressure_bar: p.pressure_bar ?? null,
            bath_temperature_c: p.bath_temperature_c ?? null,
        })),
        settings: {
            language: input.settings.language,
            unit_system: input.settings.unitSystem,
            show_touch_points: input.settings.showTouchPoints,
            viscosity_threshold: input.settings.viscosityThreshold ?? 500,
            show_target_time: input.settings.showTargetTime ?? false,
            target_time: input.settings.targetTime ?? 10,
            show_calibration: input.settings.showCalibration,
            show_raw_data: input.settings.showRawData ?? false,
            viscosity_shear_rates: input.settings.viscosityShearRates ?? [40, 100, 170],
            show_temperature: input.settings.showTemperature,
            show_shear_rate: input.settings.showShearRate,
            show_pressure: input.settings.showPressure,
            show_bath_temperature: input.settings.showBathTemperature ?? false,
            shear_rate_axis: input.settings.shearRateAxis ?? 'left',
            pressure_axis: input.settings.pressureAxis ?? 'right',
            // Axis layout mode: 'individual' = viscosity on its own left scale,
            // 'shared' = all left-side metrics share one scale.
            axis_mode: input.settings.axisMode ?? 'individual',
            show_advanced_stats: input.settings.showAdvancedStats ?? true,
            // Line settings for chart rendering (colors, widths, styles)
            line_settings: input.settings.lineSettings ? {
                viscosity: {
                    color: input.settings.lineSettings.viscosity.color,
                    width: input.settings.lineSettings.viscosity.width,
                    style: input.settings.lineSettings.viscosity.style,
                },
                temperature: {
                    color: input.settings.lineSettings.temperature.color,
                    width: input.settings.lineSettings.temperature.width,
                    style: input.settings.lineSettings.temperature.style,
                },
                shear_rate: {
                    color: input.settings.lineSettings.shearRate.color,
                    width: input.settings.lineSettings.shearRate.width,
                    style: input.settings.lineSettings.shearRate.style,
                },
                pressure: {
                    color: input.settings.lineSettings.pressure.color,
                    width: input.settings.lineSettings.pressure.width,
                    style: input.settings.lineSettings.pressure.style,
                },
                rpm: {
                    color: input.settings.lineSettings.rpm.color,
                    width: input.settings.lineSettings.rpm.width,
                    style: input.settings.lineSettings.rpm.style,
                },
                ...(input.settings.lineSettings.bathTemperature ? {
                    bath_temperature: {
                        color: input.settings.lineSettings.bathTemperature.color,
                        width: input.settings.lineSettings.bathTemperature.width,
                        style: input.settings.lineSettings.bathTemperature.style,
                    },
                } : {}),
            } : null,
        },
    };
}
