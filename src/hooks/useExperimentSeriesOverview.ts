import { useEffect, useMemo, useState } from 'react';
import type { ChartColumnarData } from '@/types';
import { isTauri } from '@/lib/tauri/core';
import { series } from '@/lib/tauri/series';
import { seriesWindowToColumnarData } from '@/lib/series/binary-series';

const DEFAULT_SERIES_METRICS = [
  'viscosityCp',
  'temperatureC',
  'shearRate',
  'shearStressPa',
  'pressureBar',
  'speedRpm',
  'bathTemperatureC',
];

function isLegacyAosForced(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem('RHEOLAB_SERIES_LEGACY_AOS') === '1';
  } catch (_e) {
    return false;
  }
}

export interface ExperimentSeriesOverviewState {
  columnarData: ChartColumnarData | null;
  isLoading: boolean;
  error: string | null;
}

export function useExperimentSeriesOverview(
  experimentId: string | undefined,
  enabled: boolean,
  maxPoints = 1500,
): ExperimentSeriesOverviewState {
  const metrics = useMemo(() => DEFAULT_SERIES_METRICS, []);
  const [state, setState] = useState<ExperimentSeriesOverviewState>({
    columnarData: null,
    isLoading: false,
    error: null,
  });

  useEffect(() => {
    if (!enabled || !experimentId || !isTauri() || isLegacyAosForced()) {
      setState(prev => prev.columnarData || prev.isLoading || prev.error
        ? { columnarData: null, isLoading: false, error: null }
        : prev);
      return;
    }

    let cancelled = false;
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    series.overview(experimentId, metrics, maxPoints)
      .then(window => {
        if (cancelled) return;
        setState({
          columnarData: seriesWindowToColumnarData(window),
          isLoading: false,
          error: null,
        });
      })
      .catch(error => {
        if (cancelled) return;
        setState({
          columnarData: null,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, experimentId, maxPoints, metrics]);

  return state;
}
