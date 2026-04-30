import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backup } from '@/lib/tauri/backup';
import { experiments } from '@/lib/tauri/experiments';
import { syncEngine } from '@/lib/tauri/sync';
import { seriesWindowCache } from '@/lib/series/series-window-cache';
import type { ChartColumnarData } from '@/types';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('@/lib/tauri/core', () => ({
  safeInvoke: invokeMock,
}));

function makeSeriesData(): ChartColumnarData {
  return {
    timeSec: new Float64Array([0, 1, 2]),
    viscosityCp: new Float64Array([10, 11, 12]),
    temperatureC: new Float64Array([25, 25, 26]),
    shearRate: new Float64Array([40, 40, 40]),
    shearStress: new Float64Array([1, 1, 1]),
    pressureBar: new Float64Array([0, 0, 0]),
    speedRpm: new Float64Array([300, 300, 300]),
  };
}

function warmCacheFor(experimentId: string): void {
  seriesWindowCache.set({
    sessionId: 'session-1',
    experimentId,
    metricsKey: 'viscosityCp,temperatureC',
    maxPoints: 1500,
    kind: 'window',
    xMinSec: 10,
    xMaxSec: 120,
  }, makeSeriesData());
}

describe('series warm cache invalidation on experiment mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seriesWindowCache.clear();
  });

  it('invalidates only the saved experiment on successful save', async () => {
    warmCacheFor('exp_1');
    warmCacheFor('exp_2');
    invokeMock.mockResolvedValue({ success: true, experimentId: 'exp_1' });

    await experiments.save({} as never);

    expect(seriesWindowCache.stats().entries).toBe(1);
    expect(invokeMock).toHaveBeenCalledWith('experiments_save', { payload: {} });
  });

  it('keeps warm windows when save fails before mutation', async () => {
    warmCacheFor('exp_1');
    invokeMock.mockResolvedValue({ success: false, error: 'validation failed' });

    await experiments.save({} as never);

    expect(seriesWindowCache.stats().entries).toBe(1);
  });

  it('invalidates the deleted experiment on successful delete', async () => {
    warmCacheFor('exp_1');
    warmCacheFor('exp_2');
    invokeMock.mockResolvedValue({ success: true });

    await experiments.delete('exp_1');

    expect(seriesWindowCache.stats().entries).toBe(1);
    expect(invokeMock).toHaveBeenCalledWith('experiments_delete', { id: 'exp_1' });
  });

  it('clears all warm windows after broad experiment imports and restores', async () => {
    warmCacheFor('exp_1');
    warmCacheFor('exp_2');
    invokeMock.mockResolvedValueOnce({
      success: true,
      imported: 1,
      skipped: 0,
      errors: [],
      totalProcessed: 1,
    });

    await experiments.importData([{ id: 'incoming' }]);

    expect(seriesWindowCache.stats().entries).toBe(0);

    warmCacheFor('exp_1');
    invokeMock.mockResolvedValueOnce({ success: true, message: 'restore scheduled' });

    await backup.restore('backup.db');

    expect(seriesWindowCache.stats().entries).toBe(0);
  });

  it('clears warm windows after delta sync import or conflict resolution', async () => {
    warmCacheFor('exp_1');
    invokeMock.mockResolvedValueOnce({
      success: true,
      imported: 1,
      updated: 0,
      conflicts: [],
    });

    await syncEngine.importDelta('delta.json');

    expect(seriesWindowCache.stats().entries).toBe(0);

    warmCacheFor('exp_1');
    invokeMock.mockResolvedValueOnce({
      success: true,
      conflictId: 'conflict_1',
      experimentId: 'exp_1',
      resolution: 'keep_remote',
    });

    await syncEngine.resolveConflict('conflict_1', 'keep_remote');

    expect(seriesWindowCache.stats().entries).toBe(0);
  });
});
