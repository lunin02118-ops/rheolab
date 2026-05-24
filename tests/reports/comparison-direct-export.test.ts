import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Experiment } from '@/types';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import type { ComparisonChartConfig } from '@/lib/analysis/report-types/comparison-report-inputs';

vi.mock('@/lib/experiments/client', () => ({
  getExperimentsByIds: vi.fn(),
}));

vi.mock('@/lib/analysis/client', () => ({
  analyzeData: vi.fn(),
}));

import { getExperimentsByIds } from '@/lib/experiments/client';
import { analyzeData } from '@/lib/analysis/client';
import {
  buildComparisonDirectReportInput,
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

function chartSettings(): ChartSettings {
  return {
    lines: {
      viscosity: { color: '#3b82f6', width: 2, style: 'solid', unit: 'cP', visible: true, axis: 'left' },
      temperature: { color: '#ef4444', width: 2, style: 'solid', unit: '°C', visible: true, axis: 'right' },
      shearRate: { color: '#a855f7', width: 2, style: 'solid', unit: '1/s', visible: true, axis: 'right' },
      pressure: { color: '#06b6d4', width: 2, style: 'solid', unit: 'bar', visible: true, axis: 'right' },
      rpm: { color: '#10b981', width: 2, style: 'solid', unit: 'rpm', visible: false, axis: 'right' },
      bathTemperature: { color: '#f97316', width: 1, style: 'dashed', unit: '°C', visible: false, axis: 'right' },
    },
    rheologyUnits: {
      viscosity: 'cP',
      temperature: '°C',
      pressure: 'bar',
      consistency: 'Pa·s^n',
      plasticViscosity: 'Pa·s',
      yieldPoint: 'Pa',
      timeFormat: 'minutes',
    },
  } as unknown as ChartSettings;
}

function comparisonChartConfig(): ComparisonChartConfig {
  const lineSettings = {
    viscosity: { color: '#3b82f6', width: 2, style: 'solid' as const },
    temperature: { color: '#ef4444', width: 2, style: 'solid' as const },
    shearRate: { color: '#a855f7', width: 2, style: 'solid' as const },
    pressure: { color: '#06b6d4', width: 2, style: 'solid' as const },
    rpm: { color: '#10b981', width: 2, style: 'solid' as const },
    bathTemperature: { color: '#f97316', width: 1, style: 'dashed' as const },
  };

  return {
    metrics: {
      primary: 'viscosity_cp',
      leftSecondary: 'none',
      secondary: 'temperature_c',
      tertiary: 'none',
    },
    axisMode: 'shared',
    touchPoint: {
      enabled: false,
      viscosityThreshold: 50,
      showTargetTime: false,
      targetTime: 0,
    },
    lineSettings,
    experimentColors: ['#3b82f6'],
    timeFormat: 'minutes',
  };
}

describe('comparison direct report export helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(analyzeData).mockResolvedValue({
      cycles: [],
      results: new Map(),
    } as any);
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

  it('uses parsed instrument rheology rows for local-file direct reports when requested', async () => {
    const experiment = {
      ...localFileExperiment(),
      instrumentRheology: [{
        source: 'instrument',
        cycleNo: 1,
        timeMin: 10,
        tempC: 77,
        pressureBar: 12,
        nPrime: 0.41,
        kPrimePaSn: 0.333,
        r2: 0.997,
        viscosities: { '40': 1401 },
        binghamPvPaS: 0.12,
        binghamYpPa: 4.2,
        binghamR2: 0.981,
      }],
    } as unknown as Experiment;

    const input = await buildComparisonDirectReportInput({
      experiments: [experiment],
      comparisonChartConfig: comparisonChartConfig(),
      chartSettings: chartSettings(),
      language: 'ru',
      unitSystem: 'SI',
      companyName: '',
      companyLogo: null,
      showCalibration: false,
      showRawData: false,
      showRecipe: false,
      showWaterAnalysis: false,
      showRheology: true,
      rheologySourceOverride: 'instrument',
      showTouchPoints: false,
      viscosityThreshold: 50,
      showTargetTime: false,
      targetTime: 0,
      reportViscosityRates: [40, 100],
      isExpert: false,
    }, 'pdf');

    const cycle = input.experiments[0].reportInput.cycleResults[0];
    expect(cycle.nPrime).toBe(0.41);
    expect(cycle.kPrime).toBe(0.333);
    expect(cycle.binghamPv).toBe(0.12);
    expect(cycle.viscAt40).toBe(1401);
  });
});
