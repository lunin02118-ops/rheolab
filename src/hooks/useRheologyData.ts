/**
 * useRheologyData
 *
 * Computes downsample-filtered uPlot series data, experiment statistics, and
 * touch-point markers from raw rheology measurements.
 * Extracted from RheologyChart to keep the component readable.
 */
import { useMemo } from 'react';
import type uPlot from 'uplot';
import { downsampleRheoPointsSmart, downsampleRheoPointsMultiChannel } from '@/lib/utils/downsample';
import { calculateSmartTouchPoints, type TouchPointInput } from '@/lib/utils/touch-point';
import { columnarToRawPoints } from '@/lib/utils/columnar';
import type { ColumnarData } from '@/types';

/** Single raw measurement point from the Rust parser / DB. */
export interface RheoPoint {
    time_sec: number;
    viscosity_cp: number;
    temperature_c: number;
    shear_rate?: number;
    shear_rate_s1?: number;
    pressure_bar?: number;
    speed_rpm?: number;
    rpm?: number;
    bath_temperature_c?: number;
}

export interface RheoStats {
    maxVisc: number;
    minVisc: number;
    avgVisc: number;
    maxTemp: number;
    minTemp: number;
    avgTemp: number;
    avgShearRate: number | null;
    maxPressure: number | null;
    duration: number;
}

export interface TouchPointMarker {
    time: number;
    viscosity: number;
    type: 'threshold' | 'target';
    color: string;
}

interface UseRheologyDataParams {
    data: RheoPoint[];
    columnarData?: ColumnarData | null;
    timeShiftEnabled: boolean;
    downsampleMode: string;
    captureMode: boolean;
    pdfMode: boolean;
    showTouchPoints: boolean;
    viscosityThreshold: number;
    showTargetTime: boolean;
    targetTime: number;
}

interface UseRheologyDataResult {
    uPlotData: uPlot.AlignedData;
    stats: RheoStats | null;
    touchPoints: TouchPointMarker[];
}

type AoSComputeResult = {
    uPlotData: uPlot.AlignedData;
    stats: RheoStats;
    _times: Float64Array;
    _viscosities: Float64Array;
    _shearRates: Float64Array;
};

function computeFromAoS(
    data: RheoPoint[],
    THRESHOLD: number,
    downsampleMode: string,
    timeShiftEnabled: boolean,
): AoSComputeResult {
    let sampledData: RheoPoint[];
    if (downsampleMode === 'off') {
        sampledData = data;
    } else if (downsampleMode === 'smart') {
        sampledData = downsampleRheoPointsSmart(data, THRESHOLD);
    } else {
        sampledData = downsampleRheoPointsMultiChannel(data, THRESHOLD);
    }

    let minTime = 0;
    if (timeShiftEnabled && sampledData.length > 0) {
        minTime = sampledData[0].time_sec;
        for (let i = 1; i < sampledData.length; i++) {
            if (sampledData[i].time_sec < minTime) minTime = sampledData[i].time_sec;
        }
    }

    const times = new Float64Array(sampledData.length);
    const viscosities = new Float64Array(sampledData.length);
    const temperatures = new Float64Array(sampledData.length);
    const shearRates = new Float64Array(sampledData.length);
    const pressures = new Float64Array(sampledData.length);
    const rpms = new Float64Array(sampledData.length);
    const bathTemperatures = new Float64Array(sampledData.length);

    for (let i = 0; i < sampledData.length; i++) {
        const p = sampledData[i];
        times[i] = Math.round(((p.time_sec - minTime) / 60) * 100) / 100;
        viscosities[i] = Math.round(p.viscosity_cp * 10) / 10;
        temperatures[i] = Math.round(p.temperature_c * 10) / 10;
        const shearRate = p.shear_rate ?? p.shear_rate_s1 ?? 0;
        shearRates[i] = shearRate ? Math.round(shearRate * 10) / 10 : 0;
        pressures[i] = p.pressure_bar ? Math.round(p.pressure_bar * 100) / 100 : 0;
        rpms[i] = (p.speed_rpm ?? p.rpm) || 0;
        bathTemperatures[i] = p.bath_temperature_c ? Math.round(p.bath_temperature_c * 10) / 10 : 0;
    }

    let maxVisc = -Infinity, minVisc = Infinity, sumVisc = 0;
    let maxTemp = -Infinity, minTemp = Infinity, sumTemp = 0;
    let sumShearRate = 0, shearRateCount = 0;
    let maxPressure = -Infinity, hasPressure = false;

    for (const p of data) {
        if (p.viscosity_cp > maxVisc) maxVisc = p.viscosity_cp;
        if (p.viscosity_cp < minVisc) minVisc = p.viscosity_cp;
        sumVisc += p.viscosity_cp;
        if (p.temperature_c > maxTemp) maxTemp = p.temperature_c;
        if (p.temperature_c < minTemp) minTemp = p.temperature_c;
        sumTemp += p.temperature_c;
        const shearRate = p.shear_rate ?? p.shear_rate_s1;
        if (shearRate && shearRate > 0) { sumShearRate += shearRate; shearRateCount++; }
        if (p.pressure_bar !== undefined) {
            hasPressure = true;
            if (p.pressure_bar > maxPressure) maxPressure = p.pressure_bar;
        }
    }

    const stats: RheoStats = {
        maxVisc, minVisc, avgVisc: sumVisc / data.length,
        maxTemp, minTemp, avgTemp: sumTemp / data.length,
        avgShearRate: shearRateCount > 0 ? Math.round(sumShearRate / shearRateCount) : null,
        maxPressure: hasPressure ? maxPressure : null,
        duration: (data[data.length - 1].time_sec - data[0].time_sec) / 60,
    };

    return {
        uPlotData: [times, viscosities, temperatures, shearRates, pressures, rpms, bathTemperatures] as uPlot.AlignedData,
        stats,
        _times: times,
        _viscosities: viscosities,
        _shearRates: shearRates,
    };
}

export function useRheologyData({
    data,
    columnarData,
    timeShiftEnabled,
    downsampleMode,
    captureMode,
    pdfMode,
    showTouchPoints,
    viscosityThreshold,
    showTargetTime,
    targetTime,
}: UseRheologyDataParams): UseRheologyDataResult {
    // Memo 1 — heavy: downsample + typed-array conversion + statistics.
    // Only recomputes when the raw data or display-mode changes.
    const { uPlotData, stats, _times, _viscosities, _shearRates } = useMemo(() => {
        const THRESHOLD = (captureMode || pdfMode) ? 600 : 1500;

        // ── Columnar path (preferred: avoids full AoS materialisation) ──────
        if (columnarData && columnarData.timeSec.length > 0) {
            const col = columnarData;
            const n = col.timeSec.length;
            if (n <= THRESHOLD || downsampleMode === 'off') {
                // Direct SoA → Float64Array: zero intermediate RheoPoint[] allocation
                let minTime = 0;
                if (timeShiftEnabled && n > 0) {
                    minTime = col.timeSec[0];
                    for (let i = 1; i < n; i++) if (col.timeSec[i] < minTime) minTime = col.timeSec[i];
                }
                const times = new Float64Array(n);
                const viscosities = new Float64Array(n);
                const temperatures = new Float64Array(n);
                const shearRates = new Float64Array(n);
                const pressures = new Float64Array(n);
                const rpms = new Float64Array(n);
                const bathTemperatures = new Float64Array(n);
                let maxVisc = -Infinity, minVisc = Infinity, sumVisc = 0;
                let maxTemp = -Infinity, minTemp = Infinity, sumTemp = 0;
                let sumShearRate = 0, shearRateCount = 0;
                let maxPressure = -Infinity, hasPressure = false;
                for (let i = 0; i < n; i++) {
                    times[i] = Math.round(((col.timeSec[i] - minTime) / 60) * 100) / 100;
                    viscosities[i] = Math.round(col.viscosityCp[i] * 10) / 10;
                    temperatures[i] = Math.round(col.temperatureC[i] * 10) / 10;
                    const sr = col.shearRate[i] ?? 0;
                    shearRates[i] = sr ? Math.round(sr * 10) / 10 : 0;
                    const pb = col.pressureBar[i];
                    pressures[i] = pb != null ? Math.round(pb * 100) / 100 : 0;
                    rpms[i] = col.speedRpm[i] ?? 0;
                    const bath = col.bathTemperatureC?.[i];
                    bathTemperatures[i] = bath != null ? Math.round(bath * 10) / 10 : 0;
                    if (col.viscosityCp[i] > maxVisc) maxVisc = col.viscosityCp[i];
                    if (col.viscosityCp[i] < minVisc) minVisc = col.viscosityCp[i];
                    sumVisc += col.viscosityCp[i];
                    if (col.temperatureC[i] > maxTemp) maxTemp = col.temperatureC[i];
                    if (col.temperatureC[i] < minTemp) minTemp = col.temperatureC[i];
                    sumTemp += col.temperatureC[i];
                    if (sr > 0) { sumShearRate += sr; shearRateCount++; }
                    if (pb != null) { hasPressure = true; if (pb > maxPressure) maxPressure = pb; }
                }
                const stats: RheoStats = {
                    maxVisc, minVisc, avgVisc: sumVisc / n,
                    maxTemp, minTemp, avgTemp: sumTemp / n,
                    avgShearRate: shearRateCount > 0 ? Math.round(sumShearRate / shearRateCount) : null,
                    maxPressure: hasPressure ? maxPressure : null,
                    duration: n > 1 ? (col.timeSec[n - 1] - col.timeSec[0]) / 60 : 0,
                };
                return {
                    uPlotData: [times, viscosities, temperatures, shearRates, pressures, rpms, bathTemperatures] as uPlot.AlignedData,
                    stats,
                    _times: times,
                    _viscosities: viscosities,
                    _shearRates: shearRates,
                };
            }
            // n > THRESHOLD and downsampling needed: convert to AoS for LTTB
            return computeFromAoS(columnarToRawPoints(col), THRESHOLD, downsampleMode, timeShiftEnabled);
        }

        // ── AoS fallback path (legacy callers without columnarData) ──────────
        if (!data?.length) {
            return {
                uPlotData: [[], [], [], [], [], [], []] as uPlot.AlignedData,
                stats: null,
                _times: new Float64Array(0),
                _viscosities: new Float64Array(0),
                _shearRates: new Float64Array(0),
            };
        }
        return computeFromAoS(data, THRESHOLD, downsampleMode, timeShiftEnabled);
    }, [data, columnarData, timeShiftEnabled, downsampleMode, captureMode, pdfMode]);

    // Memo 2 — light: touch-point markers.
    // Recomputes only when touch-point settings change (threshold slider, target
    // time toggle) without re-running the expensive downsample / stats above.
    // Uses RAW (non-downsampled) data so that the crossing-area density is
    // preserved — downsampled data may drop critical oscillating points near
    // the threshold, causing detection hundreds of minutes late.
    const touchPoints = useMemo<TouchPointMarker[]>(() => {
        if (!showTouchPoints) return [];

        let tpInputs: TouchPointInput[];
        // Columnar path: iterate SoA arrays directly (no AoS intermediate)
        if (columnarData && columnarData.timeSec.length > 0) {
            const col = columnarData;
            const n = col.timeSec.length;
            let minTime = 0;
            if (timeShiftEnabled && n > 0) {
                minTime = col.timeSec[0];
                for (let i = 1; i < n; i++) if (col.timeSec[i] < minTime) minTime = col.timeSec[i];
            }
            tpInputs = new Array(n);
            for (let i = 0; i < n; i++) {
                tpInputs[i] = {
                    time_min: (col.timeSec[i] - minTime) / 60,
                    viscosity_cp: col.viscosityCp[i],
                    shear_rate: col.shearRate[i] ?? 0,
                };
            }
        } else {
            // AoS fallback
            if (!data?.length) return [];
            let minTime = 0;
            if (timeShiftEnabled && data.length > 0) {
                minTime = data[0].time_sec;
                for (let i = 1; i < data.length; i++) {
                    if (data[i].time_sec < minTime) minTime = data[i].time_sec;
                }
            }
            tpInputs = [];
            for (let i = 0; i < data.length; i++) {
                const p = data[i];
                tpInputs.push({
                    time_min: (p.time_sec - minTime) / 60,
                    viscosity_cp: p.viscosity_cp,
                    shear_rate: p.shear_rate ?? p.shear_rate_s1 ?? 0,
                });
            }
        }

        const smartResults = calculateSmartTouchPoints(tpInputs, {
            viscosityThreshold,
            showTargetTime,
            targetTime,
        });

        return smartResults.map(r => ({
            time: r.time,
            viscosity: r.viscosity,
            type: r.type,
            color: r.type === 'threshold' ? '#ef4444' : '#f59e0b',
        } as TouchPointMarker));
    }, [data, columnarData, timeShiftEnabled, showTouchPoints, viscosityThreshold, showTargetTime, targetTime]);

    return { uPlotData, stats, touchPoints };
}
