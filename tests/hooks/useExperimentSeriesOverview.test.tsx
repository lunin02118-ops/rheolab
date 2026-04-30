// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useExperimentSeriesOverview } from '@/hooks/useExperimentSeriesOverview';
import { series } from '@/lib/tauri/series';
import { seriesWindowCache } from '@/lib/series/series-window-cache';
import type { SeriesWindow } from '@/lib/series/binary-series';

vi.mock('@/lib/tauri/core', () => ({
  isTauri: () => true,
}));

vi.mock('@/lib/tauri/series', () => ({
  series: {
    overview: vi.fn(),
    window: vi.fn(),
  },
}));

function makeSeriesWindow(times: number[], viscosities: number[]): SeriesWindow {
  return {
    version: 1,
    pointCount: times.length,
    descriptors: [],
    columns: {
      timeSec: new Float64Array(times),
      viscosityCp: new Float64Array(viscosities),
      temperatureC: new Float64Array(times.map(() => 25)),
      shearRate: new Float64Array(times.map(() => 511)),
      shearStress: new Float64Array(times.map(() => 50)),
      pressureBar: new Float64Array(times.map(() => Number.NaN)),
      speedRpm: new Float64Array(times.map(() => 300)),
    },
  };
}

describe('useExperimentSeriesOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seriesWindowCache.clear();
    vi.mocked(series.overview).mockResolvedValue(makeSeriesWindow([0, 60, 120], [100, 110, 120]));
    vi.mocked(series.window).mockResolvedValue(makeSeriesWindow([60, 90], [110, 115]));
  });

  it('loads overview data and then replaces it with a debounced window request', async () => {
    const { result } = renderHook(() =>
      useExperimentSeriesOverview('exp_1', true, 1500),
    );

    await waitFor(() => {
      expect(result.current.overviewColumnarData?.timeSec.length).toBe(3);
    });
    expect(result.current.hasWindow).toBe(false);
    expect(result.current.timeOriginSec).toBe(0);

    act(() => {
      result.current.requestWindow(60, 120);
    });

    await waitFor(() => {
      expect(series.window).toHaveBeenCalledWith(
        'exp_1',
        60,
        120,
        expect.any(Array),
        1500,
        'minmax',
      );
    });
    await waitFor(() => {
      expect(result.current.hasWindow).toBe(true);
    });
    expect(result.current.columnarData?.timeSec[0]).toBe(60);
    expect(result.current.timeOriginSec).toBe(60);

    act(() => {
      result.current.resetWindow();
    });

    expect(result.current.hasWindow).toBe(false);
    expect(result.current.columnarData?.timeSec.length).toBe(3);
    expect(result.current.timeOriginSec).toBe(0);
  });

  it('ignores invalid window ranges', async () => {
    const { result } = renderHook(() =>
      useExperimentSeriesOverview('exp_1', true, 1500),
    );

    await waitFor(() => {
      expect(result.current.overviewColumnarData).not.toBeNull();
    });

    act(() => {
      result.current.requestWindow(120, 60);
    });

    await new Promise(resolve => window.setTimeout(resolve, 130));
    expect(series.window).not.toHaveBeenCalled();
  });

  it('reuses overview data from shared cache after unmount', async () => {
    const first = renderHook(() =>
      useExperimentSeriesOverview('exp_1', true, 1500),
    );

    await waitFor(() => {
      expect(first.result.current.overviewColumnarData?.timeSec.length).toBe(3);
    });
    first.unmount();

    const second = renderHook(() =>
      useExperimentSeriesOverview('exp_1', true, 1500),
    );

    await waitFor(() => {
      expect(second.result.current.overviewColumnarData?.timeSec.length).toBe(3);
    });

    expect(series.overview).toHaveBeenCalledTimes(1);
  });

  it('reuses window data from shared cache after unmount', async () => {
    const first = renderHook(() =>
      useExperimentSeriesOverview('exp_1', true, 1500),
    );

    await waitFor(() => {
      expect(first.result.current.overviewColumnarData).not.toBeNull();
    });

    act(() => {
      first.result.current.requestWindow(60, 120);
    });

    await waitFor(() => {
      expect(first.result.current.hasWindow).toBe(true);
    });
    expect(series.window).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = renderHook(() =>
      useExperimentSeriesOverview('exp_1', true, 1500),
    );

    await waitFor(() => {
      expect(second.result.current.overviewColumnarData).not.toBeNull();
    });

    act(() => {
      second.result.current.requestWindow(60, 120);
    });

    await waitFor(() => {
      expect(second.result.current.hasWindow).toBe(true);
    });
    await new Promise(resolve => window.setTimeout(resolve, 130));

    expect(series.window).toHaveBeenCalledTimes(1);
  });
});
