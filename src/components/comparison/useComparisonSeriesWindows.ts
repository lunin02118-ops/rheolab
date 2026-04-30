import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChartColumnarData, Experiment } from '@/types';
import type { ComparisonViewport } from '@/lib/store/comparison-store';
import { isTauri } from '@/lib/tauri/core';
import { series } from '@/lib/tauri/series';
import { seriesWindowToColumnarData, type SeriesWindow } from '@/lib/series/binary-series';
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
    // Allow `null` here because `seriesWindowCache.get()` returns
    // `ChartColumnarData | null` and we forward that value verbatim into the
    // line state to avoid a redundant null-to-undefined coercion at every
    // assignment site (set/setReady/setError flows in this file).
    overviewColumnarData?: ChartColumnarData | null;
    cacheKey?: string;
    fallbackViewportKey?: string;
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
    brushExperiments: Experiment[];
    lineStates: Record<string, ComparisonLineSeriesState>;
    isLoading: boolean;
    readyCount: number;
    errorCount: number;
    usedViewportFallback: boolean;
    isBrushOverviewReady: boolean;
    isViewportWindowReady: boolean;
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

function isEmptySeriesWindow(seriesWindow: SeriesWindow): boolean {
    return seriesWindow.pointCount === 0 || seriesWindow.columns.timeSec.length === 0;
}

function minFiniteSeriesTimeSec(seriesWindow: SeriesWindow): number {
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < seriesWindow.columns.timeSec.length; i++) {
        const value = seriesWindow.columns.timeSec[i];
        if (Number.isFinite(value) && value < min) min = value;
    }
    return Number.isFinite(min) ? min : 0;
}

function viewportFallbackKey(
    experimentId: string,
    viewportKey: string,
    metricsKey: string,
    maxPoints: number,
): string {
    return `${experimentId}|${viewportKey}|${metricsKey}|${maxPoints}`;
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
        [viewport],
    );
    const activeViewportKey = activeViewport
        ? `${activeViewport.xMinSec}:${activeViewport.xMaxSec}`
        : 'overview';
    const [lineStates, setLineStates] = useState<Record<string, ComparisonLineSeriesState>>({});
    const lineStatesRef = useRef(lineStates);
    const activeIdsRef = useRef<Set<string>>(new Set());
    const mountedRef = useRef(true);
    const emptyViewportFallbacksRef = useRef<Set<string>>(new Set());
    const timeOriginsRef = useRef<Record<string, number>>({});
    const pendingOverviewLoadsRef = useRef<Set<string>>(new Set());
    const binaryEnabled = enabled && isComparisonBinarySeriesEnabled();
    const experimentIds = experiments.map(exp => exp.id).join('|');

    const updateLineStatesAsync = useCallback((
        updater: (prev: Record<string, ComparisonLineSeriesState>) => Record<string, ComparisonLineSeriesState>,
    ) => {
        void Promise.resolve().then(() => {
            if (!mountedRef.current) return;
            setLineStates(updater);
        });
    }, []);

    useEffect(() => () => {
        mountedRef.current = false;
    }, []);

    useEffect(() => {
        lineStatesRef.current = lineStates;
    }, [lineStates]);

    useEffect(() => {
        const activeIds = new Set(experiments.map(exp => exp.id));
        activeIdsRef.current = activeIds;
        for (const id of Object.keys(timeOriginsRef.current)) {
            if (!activeIds.has(id)) {
                delete timeOriginsRef.current[id];
            }
        }
        updateLineStatesAsync(prev => {
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
    }, [experimentIds, experiments, updateLineStatesAsync]);

    useEffect(() => {
        if (!binaryEnabled || experiments.length === 0) return;

        const timers: number[] = [];

        for (const exp of experiments) {
            if (isFileExperiment(exp)) continue;

            const fallbackKey = activeViewport
                ? viewportFallbackKey(exp.id, activeViewportKey, metricsKey, maxPoints)
                : null;
            const requestViewport = fallbackKey && emptyViewportFallbacksRef.current.has(fallbackKey)
                ? null
                : activeViewport;
            const overviewCacheKey = makeSeriesCacheKey(exp.id, metricsKey, maxPoints, null, sessionId);
            const overviewSerializedKey = serializeSeriesWindowCacheKey(overviewCacheKey);
            const cachedOverview = seriesWindowCache.get(overviewCacheKey);
            const cacheKey = makeSeriesCacheKey(exp.id, metricsKey, maxPoints, requestViewport, sessionId);
            const serializedKey = serializeSeriesWindowCacheKey(cacheKey);
            const cached = seriesWindowCache.get(cacheKey);
            const current = lineStatesRef.current[exp.id];

            const ensureOverviewForBrush = () => {
                if (!requestViewport) return;
                if (cachedOverview || current?.overviewColumnarData) return;
                if (pendingOverviewLoadsRef.current.has(overviewSerializedKey)) return;

                pendingOverviewLoadsRef.current.add(overviewSerializedKey);
                void series.overview(exp.id, metrics, maxPoints)
                    .then(overviewWindow => {
                        if (!mountedRef.current || !activeIdsRef.current.has(exp.id)) return;
                        if (isEmptySeriesWindow(overviewWindow)) return;

                        const overviewTimeOriginSec = minFiniteSeriesTimeSec(overviewWindow);
                        timeOriginsRef.current[exp.id] = overviewTimeOriginSec;
                        const overviewColumnarData = seriesWindowToColumnarData(overviewWindow, {
                            timeOriginSec: overviewTimeOriginSec,
                        });
                        seriesWindowCache.set(overviewCacheKey, overviewColumnarData);
                        setLineStates(prev => {
                            const previous = prev[exp.id];
                            return {
                                ...prev,
                                [exp.id]: {
                                    experimentId: exp.id,
                                    status: previous?.status ?? 'loading',
                                    error: previous?.error,
                                    columnarData: previous?.columnarData,
                                    overviewColumnarData,
                                    cacheKey: previous?.cacheKey ?? serializedKey,
                                    fallbackViewportKey: previous?.fallbackViewportKey,
                                    lastLoadedAt: previous?.lastLoadedAt,
                                },
                            };
                        });
                    })
                    .catch(() => {
                        // Non-blocking: the main window request still renders the chart.
                    })
                    .finally(() => {
                        pendingOverviewLoadsRef.current.delete(overviewSerializedKey);
                    });
            };

            ensureOverviewForBrush();

            if (cached) {
                if (Number.isFinite(cached.timeOriginSec)) {
                    timeOriginsRef.current[exp.id] = Number(cached.timeOriginSec);
                }
                const fallbackViewportKey = requestViewport === null && fallbackKey ? fallbackKey : undefined;
                updateLineStatesAsync(prev => {
                    const existing = prev[exp.id];
                    const overviewColumnarData = requestViewport
                        ? cachedOverview ?? existing?.overviewColumnarData
                        : cached;
                    if (
                        existing?.status === 'ready' &&
                        existing.cacheKey === serializedKey &&
                        existing.columnarData === cached &&
                        existing.overviewColumnarData === overviewColumnarData &&
                        existing.fallbackViewportKey === fallbackViewportKey
                    ) {
                        return prev;
                    }
                    return {
                        ...prev,
                        [exp.id]: {
                            experimentId: exp.id,
                            status: 'ready',
                            columnarData: cached,
                            overviewColumnarData,
                            cacheKey: serializedKey,
                            fallbackViewportKey,
                            lastLoadedAt: Date.now(),
                        },
                    };
                });
                continue;
            }

            if (current?.status === 'loading' && current.cacheKey === serializedKey) {
                continue;
            }
            if (current?.status === 'ready' && current.cacheKey === serializedKey) {
                if (cachedOverview && current.overviewColumnarData !== cachedOverview) {
                    updateLineStatesAsync(prev => ({
                        ...prev,
                        [exp.id]: {
                            ...prev[exp.id],
                            overviewColumnarData: cachedOverview,
                        },
                    }));
                }
                continue;
            }

            updateLineStatesAsync(prev => ({
                ...prev,
                [exp.id]: {
                    experimentId: exp.id,
                    status: 'loading',
                    columnarData: prev[exp.id]?.columnarData,
                    overviewColumnarData: prev[exp.id]?.overviewColumnarData ?? cachedOverview,
                    cacheKey: serializedKey,
                },
            }));

            const setReadyFromSeriesWindow = (
                seriesWindow: SeriesWindow,
                readyCacheKey: SeriesWindowCacheKey,
                readySerializedKey: string,
                expectedSerializedKey = readySerializedKey,
                fallbackViewportKey?: string,
                timeOriginSec?: number,
                overviewColumnarData?: ChartColumnarData | null,
                allowEmpty = false,
            ) => {
                if (isEmptySeriesWindow(seriesWindow)) {
                    if (allowEmpty) {
                        const resolvedTimeOriginSec = Number.isFinite(timeOriginSec)
                            ? Number(timeOriginSec)
                            : 0;
                        const columnarData = seriesWindowToColumnarData(seriesWindow, {
                            timeOriginSec: resolvedTimeOriginSec,
                        });
                        seriesWindowCache.set(readyCacheKey, columnarData);
                        setLineStates(prev => {
                            if (prev[exp.id]?.cacheKey !== expectedSerializedKey && prev[exp.id]?.cacheKey !== readySerializedKey) {
                                return prev;
                            }
                            return {
                                ...prev,
                                [exp.id]: {
                                    experimentId: exp.id,
                                    status: 'ready',
                                    columnarData,
                                    overviewColumnarData: overviewColumnarData ?? prev[exp.id]?.overviewColumnarData ?? cachedOverview,
                                    cacheKey: readySerializedKey,
                                    fallbackViewportKey,
                                    lastLoadedAt: Date.now(),
                                },
                            };
                        });
                        return;
                    }

                    setLineStates(prev => {
                        if (prev[exp.id]?.cacheKey !== expectedSerializedKey && prev[exp.id]?.cacheKey !== readySerializedKey) {
                            return prev;
                        }
                        return {
                            ...prev,
                            [exp.id]: {
                                experimentId: exp.id,
                                status: 'error',
                                error: 'Series contains no chart points',
                                columnarData: prev[exp.id]?.columnarData,
                                overviewColumnarData: prev[exp.id]?.overviewColumnarData ?? cachedOverview,
                                cacheKey: readySerializedKey,
                                fallbackViewportKey,
                            },
                        };
                    });
                    return;
                }

                const resolvedTimeOriginSec = Number.isFinite(timeOriginSec)
                    ? Number(timeOriginSec)
                    : minFiniteSeriesTimeSec(seriesWindow);
                timeOriginsRef.current[exp.id] = resolvedTimeOriginSec;
                const columnarData = seriesWindowToColumnarData(seriesWindow, {
                    timeOriginSec: resolvedTimeOriginSec,
                });
                seriesWindowCache.set(readyCacheKey, columnarData);
                setLineStates(prev => {
                    if (prev[exp.id]?.cacheKey !== expectedSerializedKey && prev[exp.id]?.cacheKey !== readySerializedKey) {
                        return prev;
                    }
                    const nextOverviewColumnarData = readyCacheKey.kind === 'overview'
                        ? columnarData
                        : overviewColumnarData ?? prev[exp.id]?.overviewColumnarData ?? cachedOverview;
                    return {
                        ...prev,
                        [exp.id]: {
                            experimentId: exp.id,
                            status: 'ready',
                            columnarData,
                            overviewColumnarData: nextOverviewColumnarData,
                            cacheKey: readySerializedKey,
                            fallbackViewportKey,
                            lastLoadedAt: Date.now(),
                        },
                    };
                });
            };

            const resolveWindowTimeOriginSec = async (): Promise<number> => {
                const known = timeOriginsRef.current[exp.id];
                if (Number.isFinite(known)) return known;

                try {
                    const meta = await series.meta(exp.id);
                    const origin = Number(meta.timeMinSec);
                    if (Number.isFinite(origin)) {
                        timeOriginsRef.current[exp.id] = origin;
                        return origin;
                    }
                } catch {
                    // A missing meta response should not blank the chart; raw
                    // series are normally stored from zero, so fall back there.
                }

                timeOriginsRef.current[exp.id] = 0;
                return 0;
            };

            const setLineError = (
                error: unknown,
                errorCacheKey: string,
                expectedSerializedKey = errorCacheKey,
                fallbackViewportKey?: string,
            ) => {
                setLineStates(prev => {
                    if (prev[exp.id]?.cacheKey !== expectedSerializedKey && prev[exp.id]?.cacheKey !== errorCacheKey) {
                        return prev;
                    }
                    return {
                        ...prev,
                        [exp.id]: {
                            experimentId: exp.id,
                            status: 'error',
                            error: error instanceof Error ? error.message : String(error),
                            columnarData: prev[exp.id]?.columnarData,
                            overviewColumnarData: prev[exp.id]?.overviewColumnarData ?? cachedOverview,
                            cacheKey: errorCacheKey,
                            fallbackViewportKey,
                        },
                    };
                });
            };

            const loadSeries = () => {
                const request = requestViewport
                    ? series.window(exp.id, requestViewport.xMinSec, requestViewport.xMaxSec, metrics, maxPoints, 'minmax')
                    : series.overview(exp.id, metrics, maxPoints);

                request
                    .then(seriesWindow => {
                        if (!mountedRef.current || !activeIdsRef.current.has(exp.id)) return;

                        if (requestViewport) {
                            resolveWindowTimeOriginSec()
                                .then(timeOriginSec => {
                                    if (!mountedRef.current || !activeIdsRef.current.has(exp.id)) return;
                                    setReadyFromSeriesWindow(
                                        seriesWindow,
                                        cacheKey,
                                        serializedKey,
                                        serializedKey,
                                        undefined,
                                        timeOriginSec,
                                        cachedOverview,
                                        true,
                                    );
                                })
                                .catch(error => {
                                    if (!mountedRef.current || !activeIdsRef.current.has(exp.id)) return;
                                    setLineError(error, serializedKey);
                                });
                            return;
                        }

                        setReadyFromSeriesWindow(
                            seriesWindow,
                            cacheKey,
                            serializedKey,
                            serializedKey,
                            undefined,
                            minFiniteSeriesTimeSec(seriesWindow),
                            undefined,
                        );
                    })
                    .catch(error => {
                        if (!mountedRef.current || !activeIdsRef.current.has(exp.id)) return;
                        setLineError(error, serializedKey);
                    });
            };

            if (requestViewport) {
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
    }, [activeViewport, activeViewportKey, binaryEnabled, experimentIds, experiments, maxPoints, metrics, metricsKey, sessionId, updateLineStatesAsync]);

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

    const brushExperiments = useMemo(() => {
        if (!binaryEnabled) return experiments;
        return experiments.map(exp => {
            if (isFileExperiment(exp)) return exp;

            const state = lineStates[exp.id];
            const columnarData = activeViewport
                ? state?.overviewColumnarData
                : state?.overviewColumnarData ?? state?.columnarData;
            if (columnarData) {
                return {
                    ...exp,
                    rawPoints: [],
                    columnarData,
                } as Experiment;
            }

            return exp;
        });
    }, [activeViewport, binaryEnabled, experiments, lineStates]);

    const readyCount = experiments.filter(exp => (
        isFileExperiment(exp) ||
        lineStates[exp.id]?.status === 'ready' ||
        (!binaryEnabled && hasColumnarData(exp))
    )).length;
    const errorCount = Object.values(lineStates).filter(state => state.status === 'error').length;
    const usedViewportFallback = !!activeViewport && Object.values(lineStates).some(state => (
        state.fallbackViewportKey === viewportFallbackKey(
            state.experimentId,
            activeViewportKey,
            metricsKey,
            maxPoints,
        )
    ));
    const isBrushOverviewReady = !binaryEnabled || !activeViewport || experiments.every(exp => {
        if (isFileExperiment(exp)) return true;
        const overview = lineStates[exp.id]?.overviewColumnarData;
        return !!overview?.timeSec && overview.timeSec.length > 0;
    });
    const isViewportWindowReady = !binaryEnabled || !activeViewport || experiments.every(exp => {
        if (isFileExperiment(exp)) return true;
        const state = lineStates[exp.id];
        if (state?.status !== 'ready') return false;
        const expectedKey = serializeSeriesWindowCacheKey(
            makeSeriesCacheKey(exp.id, metricsKey, maxPoints, activeViewport, sessionId),
        );
        return state.cacheKey === expectedKey;
    });
    const isLoading = binaryEnabled && experiments.some(exp => (
        !isFileExperiment(exp) &&
        lineStates[exp.id]?.status === 'loading' &&
        !lineStates[exp.id]?.columnarData &&
        !hasColumnarData(exp)
    ));

    return {
        experiments: augmentedExperiments,
        brushExperiments,
        lineStates,
        isLoading,
        readyCount,
        errorCount,
        usedViewportFallback,
        isBrushOverviewReady,
        isViewportWindowReady,
    };
}
