import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChartColumnarData, Experiment } from '@/types';
import { isTauri } from '@/lib/tauri/core';
import { series } from '@/lib/tauri/series';
import { seriesWindowToColumnarData } from '@/lib/series/binary-series';
import {
    serializeSeriesWindowCacheKey,
    seriesWindowCache,
    type SeriesWindowCacheKey,
} from '@/lib/series/series-window-cache';

const COMPARISON_SERIES_METRICS = [
    'viscosityCp',
    'temperatureC',
    'shearRate',
    'shearStressPa',
    'pressureBar',
    'speedRpm',
    'bathTemperatureC',
];

const DEFAULT_COMPARISON_SERIES_MAX_POINTS = 1500;

export type ComparisonLineSeriesStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ComparisonLineSeriesState {
    experimentId: string;
    status: ComparisonLineSeriesStatus;
    error?: string;
    overview?: ChartColumnarData;
    cacheKey?: string;
    lastLoadedAt?: number;
}

export interface UseComparisonSeriesWindowsParams {
    experiments: Experiment[];
    enabled?: boolean;
    sessionId?: string;
    maxPoints?: number;
}

export interface UseComparisonSeriesWindowsResult {
    experiments: Experiment[];
    lineStates: Record<string, ComparisonLineSeriesState>;
    isLoading: boolean;
    readyCount: number;
    errorCount: number;
}

function localStorageFlag(name: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage?.getItem(name) ?? null;
    } catch {
        return null;
    }
}

export function isComparisonBinarySeriesEnabled(): boolean {
    if (!isTauri()) return false;
    if (localStorageFlag('RHEOLAB_SERIES_LEGACY_AOS') === '1') return false;
    if (localStorageFlag('RHEOLAB_COMPARISON_LEGACY_EXPERIMENT_STORE') === '1') return false;
    return true;
}

function isFileExperiment(exp: Experiment): boolean {
    return exp.id.startsWith('file-');
}

function makeOverviewCacheKey(
    experimentId: string,
    metricsKey: string,
    maxPoints: number,
    sessionId?: string,
): SeriesWindowCacheKey {
    return {
        sessionId,
        experimentId,
        metricsKey,
        maxPoints,
        kind: 'overview',
    };
}

function hasColumnarData(exp: Experiment): boolean {
    const columnarData = (exp as Record<string, unknown>).columnarData as { timeSec?: ArrayLike<unknown> } | undefined;
    return !!columnarData?.timeSec && columnarData.timeSec.length > 0;
}

export function useComparisonSeriesWindows({
    experiments,
    enabled = true,
    sessionId,
    maxPoints = DEFAULT_COMPARISON_SERIES_MAX_POINTS,
}: UseComparisonSeriesWindowsParams): UseComparisonSeriesWindowsResult {
    const metrics = useMemo(() => COMPARISON_SERIES_METRICS, []);
    const metricsKey = useMemo(() => metrics.join(','), [metrics]);
    const [lineStates, setLineStates] = useState<Record<string, ComparisonLineSeriesState>>({});
    const lineStatesRef = useRef(lineStates);
    const activeIdsRef = useRef<Set<string>>(new Set());
    const mountedRef = useRef(true);
    const binaryEnabled = enabled && isComparisonBinarySeriesEnabled();
    const experimentIds = experiments.map(exp => exp.id).join('|');

    useEffect(() => () => {
        mountedRef.current = false;
    }, []);

    useEffect(() => {
        lineStatesRef.current = lineStates;
    }, [lineStates]);

    useEffect(() => {
        const activeIds = new Set(experiments.map(exp => exp.id));
        activeIdsRef.current = activeIds;
        setLineStates(prev => {
            let changed = false;
            const next: Record<string, ComparisonLineSeriesState> = {};
            for (const [id, state] of Object.entries(prev)) {
                if (activeIds.has(id)) {
                    next[id] = state;
                } else {
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
    }, [experimentIds, experiments]);

    useEffect(() => {
        if (!binaryEnabled || experiments.length === 0) return;

        for (const exp of experiments) {
            if (isFileExperiment(exp)) continue;

            const cacheKey = makeOverviewCacheKey(exp.id, metricsKey, maxPoints, sessionId);
            const serializedKey = serializeSeriesWindowCacheKey(cacheKey);
            const cached = seriesWindowCache.get(cacheKey);
            if (cached) {
                setLineStates(prev => {
                    const existing = prev[exp.id];
                    if (existing?.status === 'ready' && existing.cacheKey === serializedKey && existing.overview === cached) {
                        return prev;
                    }
                    return {
                        ...prev,
                        [exp.id]: {
                            experimentId: exp.id,
                            status: 'ready',
                            overview: cached,
                            cacheKey: serializedKey,
                            lastLoadedAt: Date.now(),
                        },
                    };
                });
                continue;
            }

            const current = lineStatesRef.current[exp.id];
            if (current?.status === 'loading' && current.cacheKey === serializedKey) {
                continue;
            }
            if (current?.status === 'ready' && current.cacheKey === serializedKey) {
                continue;
            }

            setLineStates(prev => ({
                ...prev,
                [exp.id]: {
                    experimentId: exp.id,
                    status: 'loading',
                    overview: prev[exp.id]?.overview,
                    cacheKey: serializedKey,
                },
            }));

            series.overview(exp.id, metrics, maxPoints)
                .then(seriesWindow => {
                    if (!mountedRef.current || !activeIdsRef.current.has(exp.id)) return;
                    const overview = seriesWindowToColumnarData(seriesWindow);
                    seriesWindowCache.set(cacheKey, overview);
                    setLineStates(prev => ({
                        ...prev,
                        [exp.id]: {
                            experimentId: exp.id,
                            status: 'ready',
                            overview,
                            cacheKey: serializedKey,
                            lastLoadedAt: Date.now(),
                        },
                    }));
                })
                .catch(error => {
                    if (!mountedRef.current || !activeIdsRef.current.has(exp.id)) return;
                    setLineStates(prev => ({
                        ...prev,
                        [exp.id]: {
                            experimentId: exp.id,
                            status: 'error',
                            error: error instanceof Error ? error.message : String(error),
                            overview: prev[exp.id]?.overview,
                            cacheKey: serializedKey,
                        },
                    }));
                });
        }
    }, [binaryEnabled, experimentIds, experiments, maxPoints, metrics, metricsKey, sessionId]);

    const augmentedExperiments = useMemo(() => {
        if (!binaryEnabled) return experiments;
        return experiments.map(exp => {
            if (isFileExperiment(exp)) return exp;

            const overview = lineStates[exp.id]?.overview;
            if (overview) {
                return {
                    ...exp,
                    rawPoints: [],
                    columnarData: overview,
                } as Experiment;
            }

            return exp;
        });
    }, [binaryEnabled, experiments, lineStates]);

    const readyCount = experiments.filter(exp => (
        isFileExperiment(exp) ||
        lineStates[exp.id]?.status === 'ready' ||
        (!binaryEnabled && hasColumnarData(exp))
    )).length;
    const errorCount = Object.values(lineStates).filter(state => state.status === 'error').length;
    const isLoading = binaryEnabled && experiments.some(exp => (
        !isFileExperiment(exp) &&
        lineStates[exp.id]?.status === 'loading' &&
        !lineStates[exp.id]?.overview &&
        !hasColumnarData(exp)
    ));

    return {
        experiments: augmentedExperiments,
        lineStates,
        isLoading,
        readyCount,
        errorCount,
    };
}
