import { useState, useEffect, useRef, useMemo } from 'react';
import type { RheoCycle, RheoStep, GraceCycleResult } from '@/lib/analysis/types';
import { analyzeData, detectSteps, regroupByPattern } from '@/lib/analysis/client';
import type { RheoPointsColumnar } from '@/lib/tauri';
import { toFiniteNumber, toOptionalFiniteNumber } from '@/lib/utils/numbers';
import { PerfMon } from '@/lib/perf-monitor';

import { useAnalysisSettingsStore } from '@/lib/store/analysis-settings-store';
import type { ParseResult } from '@/lib/store/experiment-data-store';
import { DEFAULT_VISCOSITY_SHEAR_RATES } from '@/lib/analysis/constants';
import { getAnalysisCache, setAnalysisCache } from '@/hooks/analysisCache';

// The module-level cache lives in `./analysisCache.ts` so lightweight
// consumers (layouts, stores) can clear it without pulling the analysis
// client + Tauri bridge into the main bundle. Re-exports preserve the
// historical import paths for callers that still reach through this hook.
export { clearAnalysisCache, __resetAnalysisCache } from '@/hooks/analysisCache';

interface UseAnalysisPipelineProps {
    parseResult: ParseResult | null;
    isExpert: boolean;
    cycleOverrides: Map<number, number[]>;
    patternOverride?: number[] | null;
    setError: (error: string | null) => void;
}

function sanitizeViscosityRates(value: unknown): number[] {
    if (!Array.isArray(value)) {
        return [...DEFAULT_VISCOSITY_SHEAR_RATES];
    }

    const normalized = value
        .map((rate) => toFiniteNumber(rate, NaN))
        .filter((rate) => Number.isFinite(rate) && rate > 0);

    return normalized.length > 0 ? normalized : [...DEFAULT_VISCOSITY_SHEAR_RATES];
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

function serializeCycleOverrides(cycleOverrides: Map<number, number[]>): string {
    let key = '';
    for (const [cycleIndex, override] of cycleOverrides) {
        key += `${cycleIndex}:${override.join(',')};`;
    }
    return key;
}

export function useAnalysisPipeline({
    parseResult,
    isExpert,
    cycleOverrides,
    patternOverride,
    setError
}: UseAnalysisPipelineProps) {
    const expertSettings = useAnalysisSettingsStore(s => s.expertSettings);

    const [analysisState, setAnalysisState] = useState<{
        cycles: RheoCycle[];
        cycleResults: Map<number, GraceCycleResult>;
        allSteps: RheoStep[];
    }>({ cycles: [], cycleResults: new Map(), allSteps: [] });

    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // Stabilise setError ref — always up-to-date without being in dep array.
    const setErrorRef = useRef(setError);
    setErrorRef.current = setError;

    // Serialise cycleOverrides Map so the effect fires only on content change,
    // not on new Map-object reference (prevents runaway re-analysis on every render).
    const cycleOverridesKey = useMemo(
        () => (isExpert ? serializeCycleOverrides(cycleOverrides) : ''),
        [cycleOverrides, isExpert],
    );
    const cycleOverridesRef = useRef(cycleOverrides);
    cycleOverridesRef.current = cycleOverrides;

    // Serialise viscosityShearRates array so reference identity changes don't
    // cause spurious full-pipeline reruns when the values haven't changed.
    const viscosityShearRatesKey = useMemo(
        () => JSON.stringify(expertSettings.viscosityShearRates),
        [expertSettings.viscosityShearRates],
    );

    // Tracks the AbortController for the most recent analysis run.
    // Aborting it suppresses state updates from any in-flight analysis.
    const abortControllerRef = useRef<AbortController | null>(null);

    // Build a lightweight cache key from the analysis inputs.  Avoids
    // hashing raw data — uses array length + filename as a proxy for data identity.
    const cacheKey = useMemo(() => {
        if (!parseResult) return '';
        const dataLen = parseResult.data?.length
            ?? parseResult.columnarData?.timeSec?.length
            ?? 0;
        return [
            parseResult.metadata?.filename ?? '',
            dataLen,
            parseResult.metadata?.geometry ?? '',
            isExpert ? 1 : 0,
            cycleOverridesKey,
            patternOverride ? JSON.stringify(patternOverride) : '',
            viscosityShearRatesKey,
            expertSettings.stepSplitting,
            expertSettings.splitStartDuration,
            expertSettings.splitEndDuration,
            expertSettings.minDurationForSplit,
            expertSettings.pointsToAverage,
        ].join('|');
    }, [
        parseResult,
        isExpert,
        cycleOverridesKey,
        patternOverride,
        viscosityShearRatesKey,
        expertSettings.stepSplitting,
        expertSettings.splitStartDuration,
        expertSettings.splitEndDuration,
        expertSettings.minDurationForSplit,
        expertSettings.pointsToAverage,
    ]);

    useEffect(() => {
        // ── Cache hit — skip redundant Rust IPC ──────────────────────────
        const cached = getAnalysisCache();
        if (cacheKey && cached?.key === cacheKey) {
            // Use functional updater — return `prev` when already set to
            // avoid creating a new object that would trigger an infinite
            // re-render ↔ useEffect loop.
            setAnalysisState(prev => {
                if (prev.cycles === cached.cycles) return prev;
                return {
                    cycles: cached.cycles,
                    cycleResults: cached.cycleResults,
                    allSteps: cached.allSteps,
                };
            });
            return;
        }

        // Cancel any previous in-flight analysis before starting a new one.
        abortControllerRef.current?.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const { signal } = controller;

        // Support both AoS (data[]) and SoA (columnarData) paths.
        // When columnarData is present the store sets data[] to [] to save memory.
        const hasData = (parseResult?.data?.length ?? 0) > 0 ||
            (parseResult?.columnarData?.timeSec?.length ?? 0) > 0;

        if (!parseResult || !hasData) {
            setAnalysisState(prev => {
                if (prev.cycles.length === 0 && prev.cycleResults.size === 0 && prev.allSteps.length === 0) {
                    return prev;
                }
                return { cycles: [], cycleResults: new Map(), allSteps: [] };
            });
            return () => controller.abort();
        }

        const runAnalysis = async () => {
            if (signal.aborted) return;
            setIsAnalyzing(true);
            try {
                // Build SoA rheoPoints for IPC.
                // AoS path (data[]): single-pass loop — avoids N JS object allocations.
                // SoA path (columnarData): pass arrays directly — zero extra allocations.
                let rheoPoints: RheoPointsColumnar;
                if (parseResult.data.length > 0) {
                    const len = parseResult.data.length;
                    const timeSec      = new Array<number>(len);
                    const viscosityCp  = new Array<number>(len);
                    const temperatureC = new Array<number>(len);
                    const shearRate    = new Array<number | null>(len);
                    const shearStress  = new Array<number | null>(len);
                    const pressureBar  = new Array<number | null>(len);
                    const rpm          = new Array<number | null>(len);
                    for (let i = 0; i < len; i++) {
                        const d = parseResult.data[i];
                        timeSec[i]      = toFiniteNumber(d.time_sec, 0);
                        viscosityCp[i]  = toFiniteNumber(d.viscosity_cp, 0);
                        temperatureC[i] = toFiniteNumber(d.temperature_c, 0);
                        shearRate[i]    = toOptionalFiniteNumber(d.shear_rate_s1) ?? null;
                        shearStress[i]  = toOptionalFiniteNumber(d.shear_stress_pa) ?? null;
                        pressureBar[i]  = toOptionalFiniteNumber(d.pressure_bar) ?? null;
                        rpm[i]          = toOptionalFiniteNumber(d.speed_rpm) ?? null;
                    }
                    rheoPoints = { timeSec, viscosityCp, temperatureC, shearRate, shearStress, pressureBar, rpm };
                } else {
                    // SoA path: columnarData arrays are already the right types — pass through directly.
                    const col = parseResult.columnarData!;
                    rheoPoints = {
                        timeSec:      col.timeSec,
                        viscosityCp:  col.viscosityCp,
                        temperatureC: col.temperatureC,
                        shearRate:    col.shearRate,
                        shearStress:  col.shearStress,
                        pressureBar:  col.pressureBar,
                        rpm:          col.speedRpm,  // rename: ColumnarData.speedRpm → RheoPointsColumnar.rpm
                    };
                }

                // In beginner mode, force ALL settings to defaults (like C# WPF creates a fresh ExpertSettingsDto)
                // Expert overrides (patternOverride, cycleOverrides) are ignored in beginner mode
                const detectionSettings = {
                    stepSplitting: isExpert ? Boolean(expertSettings.stepSplitting) : true,
                    splitStartDuration: Math.max(0, toFiniteNumber(isExpert ? expertSettings.splitStartDuration : 30, 30)),
                    splitEndDuration: Math.max(0, toFiniteNumber(isExpert ? expertSettings.splitEndDuration : 30, 30)),
                    minDurationForSplit: Math.max(0, toFiniteNumber(isExpert ? expertSettings.minDurationForSplit : 90, 90))
                };

                const settings = {
                    pointsToAverage: Math.max(0, Math.round(toFiniteNumber(isExpert ? expertSettings.pointsToAverage : 1, 1))),
                    viscosityShearRates: sanitizeViscosityRates(isExpert ? expertSettings.viscosityShearRates : DEFAULT_VISCOSITY_SHEAR_RATES),
                    kIndexType: 'K_ind' as const,
                    stepSplitting: detectionSettings.stepSplitting,
                    splitStartDuration: detectionSettings.splitStartDuration,
                    splitEndDuration: detectionSettings.splitEndDuration,
                    minDurationForSplit: detectionSettings.minDurationForSplit
                };

                // In beginner mode, ignore expert overrides — always use standard analysis
                const effectivePatternOverride = isExpert ? patternOverride : null;
                const effectiveCycleOverrides = isExpert ? cycleOverridesRef.current : undefined;

                const geometry = parseResult?.metadata?.geometry || 'R1B5';

                // If patternOverride is set (expert only), use regroupByPattern instead of standard analysis
                if (effectivePatternOverride && effectivePatternOverride.length > 0) {
                    const filteredSteps = await detectSteps(rheoPoints, detectionSettings);
                    if (signal.aborted) return;
                    const result = await regroupByPattern(
                        filteredSteps,
                        effectivePatternOverride,
                        geometry,
                        settings
                    );
                    if (!signal.aborted) {
                        const state = {
                            cycles: result.cycles,
                            cycleResults: result.results,
                            allSteps: result.allSteps
                        };
                        setAnalysisState(state);
                        setAnalysisCache({ key: cacheKey, ...state });
                    }
                    return;
                }

                PerfMon.mark('analysis:start');
                const result = await analyzeData(
                    rheoPoints,
                    geometry,
                    settings,
                    detectionSettings,
                    effectiveCycleOverrides
                );
                PerfMon.end('analysis');

                if (!signal.aborted) {
                    const state = {
                        cycles: result.cycles,
                        cycleResults: result.results,
                        allSteps: result.allSteps
                    };
                    setAnalysisState(state);
                    setAnalysisCache({ key: cacheKey, ...state });
                }
            } catch (err) {
                if (signal.aborted) return; // ignore errors from a cancelled analysis
                console.error('Analysis failed:', err);
                const details = getErrorMessage(err).trim();
                const shortDetails = details.length > 180 ? `${details.slice(0, 177)}...` : details;
                setErrorRef.current(shortDetails ? `Ошибка анализа данных: ${shortDetails}` : 'Ошибка анализа данных');
            } finally {
                if (!signal.aborted) {
                    setIsAnalyzing(false);
                }
            }
        };

        const timer = setTimeout(runAnalysis, 100);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- using specific sub-fields to avoid re-analysis on unrelated changes
    }, [
        cacheKey,
        parseResult?.data,
        parseResult?.columnarData?.timeSec?.length,
        expertSettings.stepSplitting,
        expertSettings.splitStartDuration,
        expertSettings.splitEndDuration,
        expertSettings.minDurationForSplit,
        expertSettings.pointsToAverage,
        viscosityShearRatesKey,
        parseResult?.metadata?.geometry,
        cycleOverridesKey,
        patternOverride,
        isExpert,
    ]);

    return {
        ...analysisState,
        isAnalyzing
    };
}
