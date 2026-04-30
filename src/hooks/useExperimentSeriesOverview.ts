import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChartColumnarData } from '@/types';
import { isTauri } from '@/lib/tauri/core';
import { series } from '@/lib/tauri/series';
import { seriesWindowToColumnarData, type SeriesWindow } from '@/lib/series/binary-series';
import {
  seriesWindowCache,
  type SeriesWindowCacheKey,
} from '@/lib/series/series-window-cache';

const DEFAULT_SERIES_METRICS = [
  'viscosityCp',
  'temperatureC',
  'shearRate',
  'shearStressPa',
  'pressureBar',
  'speedRpm',
  'bathTemperatureC',
];

const WINDOW_DEBOUNCE_MS = 100;

interface SeriesWindowRequest {
  xMinSec: number;
  xMaxSec: number;
}

function isLegacyAosForced(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem('RHEOLAB_SERIES_LEGACY_AOS') === '1';
  } catch (_e) {
    return false;
  }
}

function roundedSeconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function makeSeriesCacheKey(
  experimentId: string,
  metrics: string[],
  maxPoints: number,
  kind: SeriesWindowCacheKey['kind'],
  range?: SeriesWindowRequest,
): SeriesWindowCacheKey {
  return {
    experimentId,
    metricsKey: metrics.join(','),
    maxPoints,
    kind,
    ...(range
      ? {
        xMinSec: roundedSeconds(range.xMinSec),
        xMaxSec: roundedSeconds(range.xMaxSec),
      }
      : {}),
  };
}

function minFiniteTimeSec(data: ChartColumnarData | null): number {
  if (!data || data.timeSec.length === 0) return 0;
  if (Number.isFinite(data.timeOriginSec)) return Number(data.timeOriginSec);
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < data.timeSec.length; i++) {
    const value = data.timeSec[i];
    if (Number.isFinite(value) && value < min) {
      min = value;
    }
  }
  return Number.isFinite(min) ? min : 0;
}

function minFiniteSeriesTimeSec(data: SeriesWindow): number {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < data.columns.timeSec.length; i++) {
    const value = data.columns.timeSec[i];
    if (Number.isFinite(value) && value < min) {
      min = value;
    }
  }
  return Number.isFinite(min) ? min : 0;
}

export interface ExperimentSeriesOverviewState {
  columnarData: ChartColumnarData | null;
  overviewColumnarData: ChartColumnarData | null;
  isLoading: boolean;
  isWindowLoading: boolean;
  error: string | null;
  hasWindow: boolean;
  timeOriginSec: number;
  requestWindow: (xMinSec: number, xMaxSec: number) => void;
  resetWindow: () => void;
}

export function useExperimentSeriesOverview(
  experimentId: string | undefined,
  enabled: boolean,
  maxPoints = 1500,
): ExperimentSeriesOverviewState {
  const metrics = useMemo(() => DEFAULT_SERIES_METRICS, []);
  const canUseBinary = enabled && !!experimentId && isTauri() && !isLegacyAosForced();
  const windowRequestSeqRef = useRef(0);
  const timeOriginSecRef = useRef<number | null>(null);
  const lastExperimentIdRef = useRef<string | undefined>(undefined);
  const [overviewState, setOverviewState] = useState<{
    columnarData: ChartColumnarData | null;
    isLoading: boolean;
    error: string | null;
  }>({
    columnarData: null,
    isLoading: false,
    error: null,
  });
  const [windowState, setWindowState] = useState<{
    range: SeriesWindowRequest | null;
    columnarData: ChartColumnarData | null;
    isLoading: boolean;
    error: string | null;
  }>({
    range: null,
    columnarData: null,
    isLoading: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    if (!canUseBinary || !experimentId) {
      timeOriginSecRef.current = null;
      lastExperimentIdRef.current = undefined;
      void Promise.resolve().then(() => {
        if (cancelled) return;
        setOverviewState(prev => prev.columnarData || prev.isLoading || prev.error
          ? { columnarData: null, isLoading: false, error: null }
          : prev);
        setWindowState(prev => prev.range || prev.columnarData || prev.isLoading || prev.error
          ? { range: null, columnarData: null, isLoading: false, error: null }
          : prev);
      });
      return () => {
        cancelled = true;
      };
    }

    const previousExperimentId = lastExperimentIdRef.current;
    const experimentChanged = previousExperimentId !== undefined && previousExperimentId !== experimentId;
    lastExperimentIdRef.current = experimentId;

    void Promise.resolve().then(() => {
      if (!cancelled) {
        setWindowState(prev => {
          if (!experimentChanged && prev.range) return prev;
          return { range: null, columnarData: null, isLoading: false, error: null };
        });
      }
    });

    const overviewCacheKey = makeSeriesCacheKey(experimentId, metrics, maxPoints, 'overview');
    const cachedOverview = seriesWindowCache.get(overviewCacheKey);
    if (cachedOverview) {
      timeOriginSecRef.current = minFiniteTimeSec(cachedOverview);
      void Promise.resolve().then(() => {
        if (!cancelled) {
          setOverviewState({
            columnarData: cachedOverview,
            isLoading: false,
            error: null,
          });
        }
      });
      return () => {
        cancelled = true;
      };
    }

    void Promise.resolve().then(() => {
      if (!cancelled) {
        setOverviewState(prev => ({ ...prev, isLoading: true, error: null }));
      }
    });

    series.overview(experimentId, metrics, maxPoints)
      .then(window => {
        if (cancelled) return;
        const columnarData = seriesWindowToColumnarData(window);
        timeOriginSecRef.current = minFiniteTimeSec(columnarData);
        seriesWindowCache.set(overviewCacheKey, columnarData);
        setOverviewState({
          columnarData,
          isLoading: false,
          error: null,
        });
      })
      .catch(error => {
        if (cancelled) return;
        setOverviewState({
          columnarData: null,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [canUseBinary, experimentId, maxPoints, metrics]);

  useEffect(() => {
    if (!canUseBinary || !experimentId || !windowState.range) {
      return;
    }

    let active = true;
    const range = windowState.range;
    const cacheKey = makeSeriesCacheKey(experimentId, metrics, maxPoints, 'window', range);
    const cached = seriesWindowCache.get(cacheKey);
    if (cached) {
      timeOriginSecRef.current = minFiniteTimeSec(cached);
      void Promise.resolve().then(() => {
        if (active) {
          setWindowState(prev => ({
            ...prev,
            columnarData: cached,
            isLoading: false,
            error: null,
          }));
        }
      });
      return () => {
        active = false;
      };
    }

    const seq = windowRequestSeqRef.current + 1;
    windowRequestSeqRef.current = seq;
    void Promise.resolve().then(() => {
      if (active) {
        setWindowState(prev => ({ ...prev, isLoading: true, error: null }));
      }
    });

    const resolveWindowTimeOriginSec = async (seriesWindow: SeriesWindow): Promise<number> => {
      const known = timeOriginSecRef.current;
      if (Number.isFinite(known)) return Number(known);

      try {
        const meta = await series.meta(experimentId);
        const origin = Number(meta.timeMinSec);
        if (Number.isFinite(origin)) {
          timeOriginSecRef.current = origin;
          return origin;
        }
      } catch {
        // A failed metadata read should not blank the chart. Fall back to
        // the series-local minimum, which matches the legacy behavior.
      }

      const fallback = minFiniteSeriesTimeSec(seriesWindow);
      timeOriginSecRef.current = fallback;
      return fallback;
    };

    const timer = window.setTimeout(() => {
      series.window(
        experimentId,
        range.xMinSec,
        range.xMaxSec,
        metrics,
        maxPoints,
        'minmax',
      )
        .then(seriesWindow => {
          if (!active || windowRequestSeqRef.current !== seq) return;
          return resolveWindowTimeOriginSec(seriesWindow).then(timeOriginSec => {
            if (!active || windowRequestSeqRef.current !== seq) return;
            const columnarData = seriesWindowToColumnarData(seriesWindow, { timeOriginSec });
            seriesWindowCache.set(cacheKey, columnarData);
            setWindowState(prev => ({
              ...prev,
              columnarData,
              isLoading: false,
              error: null,
            }));
          });
        })
        .catch(error => {
          if (!active || windowRequestSeqRef.current !== seq) return;
          setWindowState(prev => ({
            ...prev,
            isLoading: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        });
    }, WINDOW_DEBOUNCE_MS);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [canUseBinary, experimentId, maxPoints, metrics, windowState.range]);

  const requestWindow = useCallback((xMinSec: number, xMaxSec: number) => {
    if (!Number.isFinite(xMinSec) || !Number.isFinite(xMaxSec) || xMaxSec <= xMinSec) {
      return;
    }
    setWindowState(prev => ({
      ...prev,
      range: {
        xMinSec: roundedSeconds(xMinSec),
        xMaxSec: roundedSeconds(xMaxSec),
      },
    }));
  }, []);

  const resetWindow = useCallback(() => {
    windowRequestSeqRef.current += 1;
    setWindowState(prev => prev.range || prev.columnarData || prev.isLoading || prev.error
      ? { range: null, columnarData: null, isLoading: false, error: null }
      : prev);
  }, []);

  const activeColumnarData = windowState.columnarData ?? overviewState.columnarData;

  return {
    columnarData: activeColumnarData,
    overviewColumnarData: overviewState.columnarData,
    isLoading: overviewState.isLoading,
    isWindowLoading: windowState.isLoading,
    error: windowState.error ?? overviewState.error,
    hasWindow: !!windowState.columnarData,
    timeOriginSec: minFiniteTimeSec(activeColumnarData),
    requestWindow,
    resetWindow,
  };
}
