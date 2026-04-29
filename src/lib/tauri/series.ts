import { safeInvoke as invoke } from './core';
import {
  decodeRheoSeriesV1,
  type RheoSeriesBinaryInput,
  type SeriesMetaResponse,
  type SeriesWindow,
} from '@/lib/series/binary-series';

type SeriesPerfCall = {
  command: string;
  duration_ms: number;
  byte_length: number | null;
  max_points: number | null;
  x_min_sec: number | null;
  x_max_sec: number | null;
};

type SeriesPerfHook = {
  record?: (call: SeriesPerfCall) => void;
};

function byteLengthOf(value: RheoSeriesBinaryInput): number | null {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (Array.isArray(value)) return value.length;
  return null;
}

function recordSeriesPerf(command: string, args: Record<string, unknown>, payload: RheoSeriesBinaryInput, durationMs: number): void {
  if (typeof window === 'undefined') return;
  const hook = (window as unknown as { __RHEOLAB_SERIES_PERF_HOOK__?: SeriesPerfHook }).__RHEOLAB_SERIES_PERF_HOOK__;
  if (!hook?.record) return;
  try {
    hook.record({
      command,
      duration_ms: Math.round(durationMs * 10) / 10,
      byte_length: byteLengthOf(payload),
      max_points: Number.isFinite(Number(args.maxPoints)) ? Number(args.maxPoints) : null,
      x_min_sec: Number.isFinite(Number(args.xMinSec)) ? Number(args.xMinSec) : null,
      x_max_sec: Number.isFinite(Number(args.xMaxSec)) ? Number(args.xMaxSec) : null,
    });
  } catch {
    // Test-only observer hook; never let it affect production IPC.
  }
}

async function invokeSeriesBinary(command: string, args: Record<string, unknown>): Promise<RheoSeriesBinaryInput> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const payload = await invoke<RheoSeriesBinaryInput>(command, args);
  const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
  recordSeriesPerf(command, args, payload, ended - started);
  return payload;
}

export const series = {
  meta(experimentId: string): Promise<SeriesMetaResponse> {
    return invoke<SeriesMetaResponse>('experiments_series_meta', { experimentId });
  },

  async overview(
    experimentId: string,
    metrics: string[],
    maxPoints: number,
  ): Promise<SeriesWindow> {
    const buffer = await invokeSeriesBinary('experiments_series_overview', {
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
    const buffer = await invokeSeriesBinary('experiments_series_window', {
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
