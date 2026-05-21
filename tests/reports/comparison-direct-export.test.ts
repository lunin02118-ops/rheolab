import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Experiment } from '@/types';

vi.mock('@/lib/experiments/client', () => ({
  getExperimentsByIds: vi.fn(),
}));

import { getExperimentsByIds } from '@/lib/experiments/client';
import {
  hasFileBackedComparisonExperiment,
  resolveComparisonExperimentsForDirectReport,
} from '@/lib/reports/comparison-direct-export';

function localFileExperiment(): Experiment {
  return {
    id: 'file-1',
    name: 'local.dat',
    testDate: new Date(),
    fluidType: 'Linear',
    columnarData: {
      timeSec: [0, 1],
      viscosityCp: [100, 110],
      temperatureC: [25, 25],
      shearRate: [null, null],
      shearStress: [null, null],
      pressureBar: [null, null],
      speedRpm: [null, null],
    },
  } as unknown as Experiment;
}

describe('comparison direct report export helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects file-backed comparison experiments', () => {
    expect(hasFileBackedComparisonExperiment([localFileExperiment()])).toBe(true);
    expect(hasFileBackedComparisonExperiment([{ id: 'db-1', name: 'saved' } as Experiment])).toBe(false);
  });

  it('keeps local file experiments in memory without fetching them from DB', async () => {
    const experiment = localFileExperiment();
    const resolved = await resolveComparisonExperimentsForDirectReport([experiment]);

    expect(resolved).toEqual([experiment]);
    expect(getExperimentsByIds).not.toHaveBeenCalled();
  });

  it('fetches DB experiments that only have lightweight selection metadata', async () => {
    vi.mocked(getExperimentsByIds).mockResolvedValue({
      success: true,
      experiments: [{
        id: 'db-1',
        name: 'saved',
        rawPoints: [{
          time_sec: 0,
          viscosity_cp: 100,
          temperature_c: 25,
          shear_rate_s1: 10,
          shear_stress_pa: 5,
          pressure_bar: 1,
          speed_rpm: 60,
        }],
      }],
    } as any);

    const resolved = await resolveComparisonExperimentsForDirectReport([
      { id: 'db-1', name: 'saved' } as Experiment,
    ]);

    expect(getExperimentsByIds).toHaveBeenCalledWith(['db-1']);
    expect((resolved[0] as any).columnarData.timeSec).toEqual([0]);
    expect((resolved[0] as any).rawPoints).toEqual([]);
  });

  it('reports a clear error when a persisted local file lost its in-memory data', async () => {
    await expect(
      resolveComparisonExperimentsForDirectReport([
        { id: 'file-lost', name: 'lost.dat' } as Experiment,
      ]),
    ).rejects.toThrow('Добавьте файл в сравнение заново');
  });
});
