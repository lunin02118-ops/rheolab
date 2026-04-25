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

export { convertReportInputToWasm } from './report-converter';
export { convertComparisonReportInputToWasm } from './comparison-report-converter';
