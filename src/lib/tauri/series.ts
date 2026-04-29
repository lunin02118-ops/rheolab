import { safeInvoke as invoke } from './core';
import {
  decodeRheoSeriesV1,
  type SeriesMetaResponse,
  type SeriesWindow,
} from '@/lib/series/binary-series';

export const series = {
  meta(experimentId: string): Promise<SeriesMetaResponse> {
    return invoke<SeriesMetaResponse>('experiments_series_meta', { experimentId });
  },

  async overview(
    experimentId: string,
    metrics: string[],
    maxPoints: number,
  ): Promise<SeriesWindow> {
    const buffer = await invoke<ArrayBuffer>('experiments_series_overview', {
      experimentId,
      metrics,
      maxPoints,
    });
    return decodeRheoSeriesV1(buffer);
  },

  async window(
    experimentId: string,
    xMinSec: number,
    xMaxSec: number,
    metrics: string[],
    maxPoints: number,
    downsampleMode = 'minmax',
  ): Promise<SeriesWindow> {
    const buffer = await invoke<ArrayBuffer>('experiments_series_window', {
      experimentId,
      xMinSec,
      xMaxSec,
      metrics,
      maxPoints,
      downsampleMode,
    });
    return decodeRheoSeriesV1(buffer);
  },
};
