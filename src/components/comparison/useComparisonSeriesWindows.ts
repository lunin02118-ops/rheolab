import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChartColumnarData, Experiment } from '@/types';
import type { ComparisonViewport } from '@/lib/store/comparison-store';
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
const WINDOW_DEBOUNCE_MS = 100;

export type ComparisonLineSeriesStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ComparisonLineSeriesState {
    experimentId: string;
    status: ComparisonLineSeriesStatus;
    error?: string;
    columnarData?: ChartColumnarData;
    cacheKey?: string;
    lastLoadedAt?: number;
}

export interface UseComparisonSeriesWindowsParams {
    experiments: Experiment[];
    enabled?: boolean;
    sessionId?: string;
    viewport?: ComparisonViewport | null;
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

function roundedSeconds(value: number): number {
    return Math.round(value * 1000) / 1000;
}

function normalizeViewport(viewport: ComparisonViewport | null | undefined): ComparisonViewport | null {
    if (
        !viewport ||
        !Number.isFinite(viewport.xMinSec) ||
        !Number.isFinite(viewport.xMaxSec) ||
        viewport.xMaxSec <= viewport.xMinSec
    ) {
        return null;
    }
    return {
        xMinSec: roundedSeconds(viewport.xMinSec),
        xMaxSec: roundedSeconds(viewport.xMaxSec),
    };
}

function makeSeriesCacheKey(
    experimentId: string,
    metricsKey: string,
    maxPoints: number,
    viewport: ComparisonViewport | null,
    sessionId?: string,
): SeriesWindowCacheKey {
    return {
        sessionId,
        experimentId,
        metricsKey,
        maxPoints,
        kind: viewport ? 'window' : 'overview',
        ...(viewport
            ? {
                xMinSec: viewport.xMinSec,
                xMaxSec: viewport.xMaxSec,
            }
            : {}),
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
    viewport,
    maxPoints = DEFAULT_COMPARISON_SERIES_MAX_POINTS,
}: UseComparisonSeriesWindowsParams): UseComparisonSeriesWindowsResult {
    const metrics = useMemo(() => COMPARISON_SERIES_METRICS, []);
    const metricsKey = useMemo(() => metrics.join(','), [metrics]);
    const activeViewport = useMemo(
        () => normalizeViewport(viewport),
        [viewport?.xMinSec, viewport?.xMaxSec],
    );
    const activeViewportKey = activeViewport
        ? `${activeViewport.xMinSec}:${activeViewport.xMaxSec}`
        : 'overview';
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

        const timers: number[] = [];

        for (const exp of experiments) {
            if (isFileExperiment(exp)) continue;

            const cacheKey = makeSeriesCacheKey(exp.id, metricsKey, maxPoints, activeViewport, sessionId);
            const serializedKey = serializeSeriesWindowCacheKey(cacheKey);
            const cached = seriesWindowCache.get(cacheKey);
            if (cached) {
                setLineStates(prev => {
                    const existing = prev[exp.id];
                    if (existing?.status === 'ready' && existing.cacheKey === serializedKey && existing.columnarData === cached) {
                        return prev;
                    }
                    return {
                        ...prev,
                        [exp.id]: {
                            experimentId: exp.id,
                            status: 'ready',
                            columnarData: cached,
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
                    columnarData: prev[exp.id]?.columnarData,
                    cacheKey: serializedKey,
                },
            }));

            const loadSeries = () => {
                const request = activeViewport
                    ? series.window(exp.id, activeViewport.xMinSec, activeViewport.xMaxSec, metrics, maxPoints, 'minmax')
                    : series.overview(exp.id, metrics, maxPoints);

                request
                    .then(seriesWindow => {
                        if (!mountedRef.current || !activeIdsRef.current.has(exp.id)) return;
                        const columnarData = seriesWindowToColumnarData(seriesWindow);
                        seriesWindowCache.set(cacheKey, columnarData);
                        setLineStates(prev => {
                            if (prev[exp.id]?.cacheKey !== serializedKey) return prev;
                            return {
                                ...prev,
                                [exp.id]: {
                                    experimentId: exp.id,
                                    status: 'ready',
                                    columnarData,
                                    cacheKey: serializedKey,
                                    lastLoadedAt: Date.now(),
                                },
                            };
                        });
                    })
                    .catch(error => {
                        if (!mountedRef.current || !activeIdsRef.current.has(exp.id)) return;
                        setLineStates(prev => {
                            if (prev[exp.id]?.cacheKey !== serializedKey) return prev;
                            return {
                                ...prev,
                                [exp.id]: {
                                    experimentId: exp.id,
                                    status: 'error',
                                    error: error instanceof Error ? error.message : String(error),
                                    columnarData: prev[exp.id]?.columnarData,
                                    cacheKey: serializedKey,
                                },
                            };
                        });
                    });
            };

            if (activeViewport) {
                timers.push(window.setTimeout(loadSeries, WINDOW_DEBOUNCE_MS));
            } else {
                loadSeries();
            }
        }

        return () => {
            for (const timer of timers) {
                window.clearTimeout(timer);
            }
        };
    }, [activeViewport, activeViewportKey, binaryEnabled, experimentIds, experiments, maxPoints, metrics, metricsKey, sessionId]);

    const augmentedExperiments = useMemo(() => {
        if (!binaryEnabled) return experiments;
        return experiments.map(exp => {
            if (isFileExperiment(exp)) return exp;

            const columnarData = lineStates[exp.id]?.columnarData;
            if (columnarData) {
                return {
                    ...exp,
                    rawPoints: [],
                    columnarData,
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
        !lineStates[exp.id]?.columnarData &&
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
