/**
 * @fileoverview Utilities for converting between SoA (ColumnarData) and AoS (RheoDataPoint[]).
 *
 * The primary data path for freshly-parsed experiments uses SoA (`ColumnarData`) to
 * keep memory usage low. These helpers are used only in places that must materialize
 * AoS — currently just the save dialog payload — and in mappers that build `columnarData`
 * from AoS for loaded (DB-sourced) experiments.
 */

import type { ColumnarData } from '@/types';
import type { RheoDataPoint } from '@/lib/parsing/types';

/**
 * Convert SoA `ColumnarData` to AoS `RheoDataPoint[]`.
 *
 * Fields that can be `null` in `ColumnarData` (shearRate, shearStress, pressureBar, speedRpm)
 * are coerced to `0` since `RheoDataPoint` uses plain `number`.
 */
export function columnarToRawPoints(col: ColumnarData): RheoDataPoint[] {
    const n = col.timeSec.length;
    const result: RheoDataPoint[] = new Array(n);
    for (let i = 0; i < n; i++) {
        const bathTemp = col.bathTemperatureC ? (col.bathTemperatureC[i] ?? undefined) : undefined;
        result[i] = {
            time_sec:       col.timeSec[i] ?? 0,
            viscosity_cp:   col.viscosityCp[i] ?? 0,
            temperature_c:  col.temperatureC[i] ?? 0,
            speed_rpm:      col.speedRpm[i] ?? 0,
            shear_rate_s1:  col.shearRate[i] ?? 0,
            shear_stress_pa: col.shearStress[i] ?? 0,
            pressure_bar:   col.pressureBar[i] ?? 0,
            ...(bathTemp != null ? { bath_temperature_c: bathTemp } : {}),
        };
    }
    return result;
}

/**
 * Convert AoS `RheoDataPoint[]` to SoA `ColumnarData`.
 *
 * Used in mappers to populate `columnarData` for DB-loaded experiments so they
 * use the same high-performance rendering path as freshly-parsed experiments.
 */
export function rawPointsToColumnar(points: RheoDataPoint[]): ColumnarData {
    const n = points.length;
    const timeSec: number[] = new Array(n);
    const viscosityCp: number[] = new Array(n);
    const temperatureC: number[] = new Array(n);
    const shearRate: (number | null)[] = new Array(n);
    const shearStress: (number | null)[] = new Array(n);
    const pressureBar: (number | null)[] = new Array(n);
    const speedRpm: (number | null)[] = new Array(n);
    const hasBath = points.some(p => p.bath_temperature_c !== undefined && p.bath_temperature_c !== null);
    const bathTemperatureC: (number | null)[] | undefined = hasBath ? new Array(n) : undefined;
    for (let i = 0; i < n; i++) {
        const p = points[i];
        timeSec[i] = p.time_sec;
        viscosityCp[i] = p.viscosity_cp;
        temperatureC[i] = p.temperature_c;
        shearRate[i] = p.shear_rate_s1;
        shearStress[i] = p.shear_stress_pa;
        pressureBar[i] = p.pressure_bar;
        speedRpm[i] = p.speed_rpm;
        if (bathTemperatureC) bathTemperatureC[i] = p.bath_temperature_c ?? null;
    }
    return { timeSec, viscosityCp, temperatureC, shearRate, shearStress, pressureBar, speedRpm, ...(bathTemperatureC ? { bathTemperatureC } : {}) };
}

/**
 * Convert an untyped `Array<Record<string, unknown>>` returned by Tauri's
 * `experiments_get` command into a typed `ColumnarData` (SoA).
 *
 * This is the comparison-store counterpart to `rawPointsToColumnar`; it handles
 * the Tauri wire format where speed is stored as `rpm` OR `speed_rpm`, and shear
 * fields use historic aliases (`shear_rate` / `shear_rate_s1`).
 *
 * After conversion the caller should discard the source array so V8 can GC the
 * ~N × 8-property object graph and leave only the efficient typed arrays.
 */
export function tauriRawRecordsToColumnar(records: Array<Record<string, unknown>>): ColumnarData {
    const n = records.length;
    const timeSec: number[] = new Array(n);
    const viscosityCp: number[] = new Array(n);
    const temperatureC: number[] = new Array(n);
    const shearRate: (number | null)[] = new Array(n);
    const shearStress: (number | null)[] = new Array(n);
    const pressureBar: (number | null)[] = new Array(n);
    const speedRpm: (number | null)[] = new Array(n);
    const bathTempRaw: (number | null)[] = new Array(n);
    let hasBath = false;

    for (let i = 0; i < n; i++) {
        const p = records[i];
        timeSec[i] = Number(p.time_sec ?? 0);
        viscosityCp[i] = Number(p.viscosity_cp ?? 0);
        temperatureC[i] = Number(p.temperature_c ?? 0);

        const sr = p.shear_rate_s1 ?? p.shear_rate;
        shearRate[i] = sr != null ? Number(sr) : null;

        const ss = p.shear_stress_pa ?? p.shear_stress;
        shearStress[i] = ss != null ? Number(ss) : null;

        const pb = p.pressure_bar;
        pressureBar[i] = pb != null ? Number(pb) : null;

        const rpm = p.speed_rpm ?? p.rpm;
        speedRpm[i] = rpm != null ? Number(rpm) : null;

        const bt = p.bath_temperature_c;
        if (bt != null) { hasBath = true; bathTempRaw[i] = Number(bt); }
        else { bathTempRaw[i] = null; }
    }

    return {
        timeSec, viscosityCp, temperatureC,
        shearRate, shearStress, pressureBar, speedRpm,
        ...(hasBath ? { bathTemperatureC: bathTempRaw } : {}),
    };
}

/**
 * Extract raw points from a ParseResult, preferring the in-memory `data` array
 * and falling back to a just-in-time conversion from `columnarData`.
 * Returns `[]` when neither source is available.
 *
 * @deprecated Prefer passing `columnarData` (SoA) directly to consumers.
 * This function still exists for callers that legitimately need AoS (e.g.
 * `RawDataTable`). Do not add new callers.
 */
export function rawPointsFromParseResult(parseResult: {
    data?: RheoDataPoint[];
    columnarData?: ColumnarData;
} | null | undefined): RheoDataPoint[] {
    if (!parseResult) return [];
    if (parseResult.data && parseResult.data.length > 0) return parseResult.data;
    if (parseResult.columnarData && parseResult.columnarData.timeSec.length > 0) {
        return columnarToRawPoints(parseResult.columnarData);
    }
    return [];
}
