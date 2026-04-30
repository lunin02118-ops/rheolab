import { describe, expect, it } from 'vitest';
import type { ChartColumnarData } from '@/types';
import {
  SeriesWindowCache,
  estimateChartColumnarDataBytes,
  serializeSeriesWindowCacheKey,
} from '@/lib/series/series-window-cache';

function makeData(length = 2): ChartColumnarData {
  const values = Array.from({ length }, (_, index) => index);
  return {
    timeSec: new Float64Array(values),
    viscosityCp: new Float64Array(values),
    temperatureC: new Float64Array(values),
    shearRate: new Float64Array(values),
    shearStress: new Float64Array(values),
    pressureBar: new Float64Array(values),
    speedRpm: new Float64Array(values),
  };
}

function makeKey(id: string, kind: 'overview' | 'window' = 'overview') {
  return {
    experimentId: id,
    metricsKey: 'viscosityCp,temperatureC',
    maxPoints: 1500,
    kind,
    ...(kind === 'window' ? { xMinSec: 10, xMaxSec: 20 } : {}),
  };
}

describe('SeriesWindowCache', () => {
  it('returns cache hits and reports bounded byte stats', () => {
    const now = 0;
    const cache = new SeriesWindowCache({ now: () => now });
    const data = makeData(3);

    cache.set(makeKey('exp-1'), data);

    expect(cache.get(makeKey('exp-1'))).toBe(data);
    expect(cache.stats()).toMatchObject({
      entries: 1,
      byteSize: estimateChartColumnarDataBytes(data),
    });
  });

  it('expires entries by TTL', () => {
    let now = 0;
    const cache = new SeriesWindowCache({ ttlMs: 100, now: () => now });

    cache.set(makeKey('exp-1'), makeData());
    expect(cache.get(makeKey('exp-1'))).not.toBeNull();

    now = 101;

    expect(cache.get(makeKey('exp-1'))).toBeNull();
    expect(cache.stats().entries).toBe(0);
  });

  it('evicts least-recently-used entries when max entries is exceeded', () => {
    let now = 1;
    const cache = new SeriesWindowCache({ maxEntries: 2, now: () => now });

    cache.set(makeKey('exp-1'), makeData());
    now = 2;
    cache.set(makeKey('exp-2'), makeData());
    now = 3;
    expect(cache.get(makeKey('exp-1'))).not.toBeNull();
    now = 4;
    cache.set(makeKey('exp-3'), makeData());

    expect(cache.get(makeKey('exp-1'))).not.toBeNull();
    expect(cache.get(makeKey('exp-2'))).toBeNull();
    expect(cache.get(makeKey('exp-3'))).not.toBeNull();
  });

  it('evicts by byte budget', () => {
    let now = 0;
    const oneEntryBytes = estimateChartColumnarDataBytes(makeData(2));
    const cache = new SeriesWindowCache({
      maxBytes: oneEntryBytes,
      now: () => now,
    });

    cache.set(makeKey('exp-1'), makeData(2));
    now = 1;
    cache.set(makeKey('exp-2'), makeData(2));

    expect(cache.get(makeKey('exp-1'))).toBeNull();
    expect(cache.get(makeKey('exp-2'))).not.toBeNull();
    expect(cache.stats().entries).toBe(1);
  });

  it('deletes entries by experiment and session', () => {
    const cache = new SeriesWindowCache();
    cache.set({ ...makeKey('exp-1'), sessionId: 'cmp-1' }, makeData());
    cache.set({ ...makeKey('exp-2'), sessionId: 'cmp-1' }, makeData());
    cache.set({ ...makeKey('exp-3'), sessionId: 'cmp-2' }, makeData());

    cache.deleteByExperiment('exp-2');
    expect(cache.get({ ...makeKey('exp-2'), sessionId: 'cmp-1' })).toBeNull();
    expect(cache.get({ ...makeKey('exp-1'), sessionId: 'cmp-1' })).not.toBeNull();

    cache.deleteBySession('cmp-1');
    expect(cache.get({ ...makeKey('exp-1'), sessionId: 'cmp-1' })).toBeNull();
    expect(cache.get({ ...makeKey('exp-3'), sessionId: 'cmp-2' })).not.toBeNull();
  });

  it('rounds window ranges in cache keys to avoid jitter misses', () => {
    const a = serializeSeriesWindowCacheKey({
      ...makeKey('exp-1', 'window'),
      xMinSec: 10.0004,
      xMaxSec: 20.0004,
    });
    const b = serializeSeriesWindowCacheKey({
      ...makeKey('exp-1', 'window'),
      xMinSec: 10,
      xMaxSec: 20,
    });

    expect(a).toBe(b);
  });
});
