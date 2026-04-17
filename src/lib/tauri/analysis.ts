/**
 * Tauri analysis pipeline commands.
 *
 * Wraps analysis_* Tauri commands: full analysis, step detection, and
 * pattern-based regrouping.  Includes snake_case ↔ camelCase mapping
 * functions for GraceCycleResult serialised by Rust serde.
 */

import { safeInvoke as invoke } from './core';
import type { RheoStep, RheoCycle, ExpertSettings, GraceCycleResult, DetectionSettingsInput } from '@/lib/analysis/types';
import type { RheoPointsColumnar } from '@/types/tauri';

// ── Raw Rust serialisation types ─────────────────────────────────────────────

// Raw snake_case shape of GraceCycleResult as serialised by Rust serde
interface RawGraceCycleResult {
  cycle_no: number;
  time_min: number;
  end_time_min: number;
  temp_c: number;
  pressure_bar: number;
  n_prime: number;
  kv_pasn: number;
  r2: number;
  k_prime_pasn: number;
  k_prime_slot_pasn: number;
  k_prime_pipe_pasn: number;
  viscosities: Record<string, number>;
  bingham_pv_pas: number;
  bingham_yp_pa: number;
  bingham_r2: number;
  calc_points: number;
}

interface RawAnalysisOutput {
  cycles: RheoCycle[];
  results: [number, RawGraceCycleResult][];
  allSteps: RheoStep[];
}

// ── Mapping helpers ───────────────────────────────────────────────────────────

/** Maps a snake_case Rust GraceCycleResult → TS camelCase GraceCycleResult */
function mapGraceResult(raw: RawGraceCycleResult): GraceCycleResult {
  const viscosities: { [rate: number]: number } = {};
  for (const [key, value] of Object.entries(raw.viscosities)) {
    viscosities[parseFloat(key)] = value;
  }
  return {
    cycleNo: raw.cycle_no,
    timeMin: raw.time_min,
    endTimeMin: raw.end_time_min,
    timeSec: raw.time_min * 60,
    tempC: raw.temp_c,
    pressure_bar: raw.pressure_bar,
    n_prime: raw.n_prime,
    Kv_PaSn: raw.kv_pasn,
    r2: raw.r2,
    K_prime_PaSn: raw.k_prime_pasn,
    K_prime_slot_PaSn: raw.k_prime_slot_pasn,
    K_pipe_PaSn: raw.k_prime_pipe_pasn,
    viscosities,
    viscAt40: viscosities[40],
    viscAt100: viscosities[100],
    viscAt170: viscosities[170],
    bingham_PV_PaS: raw.bingham_pv_pas,
    bingham_YP_Pa: raw.bingham_yp_pa,
    bingham_r2: raw.bingham_r2,
    calcPoints: raw.calc_points,
  };
}

function mapAnalysisOutput(raw: RawAnalysisOutput): {
  cycles: RheoCycle[];
  results: Map<number, GraceCycleResult>;
  allSteps: RheoStep[];
} {
  const results = new Map<number, GraceCycleResult>();
  for (const [id, rawResult] of raw.results) {
    results.set(id, mapGraceResult(rawResult));
  }
  return { cycles: raw.cycles, results, allSteps: raw.allSteps };
}

/** Converts TS camelCase ExpertSettings → snake_case for Rust serde deserialization */
function prepareSettings(settings: ExpertSettings): Record<string, unknown> {
  return {
    points_to_average: settings.pointsToAverage,
    k_index_type: settings.kIndexType,
    viscosity_shear_rates: settings.viscosityShearRates,
  };
}

function prepareDetectionSettings(ds: DetectionSettingsInput): Record<string, unknown> {
  return {
    shearRateTolerance: ds.shearRateTolerance ?? 2.0,
    shearRateRelTolerance: ds.shearRateRelTolerance ?? 5.0,
    minStepDuration: ds.minStepDuration ?? 5.0,
    stepSplitting: ds.stepSplitting,
    splitStartDuration: ds.splitStartDuration,
    splitEndDuration: ds.splitEndDuration,
    minDurationForSplit: ds.minDurationForSplit,
  };
}

// ── Analysis IPC namespace ────────────────────────────────────────────────────

export const analysis = {
  /**
   * Full analysis pipeline: detect steps → filter → detect cycles → calculate Grace.
   * Native Tauri equivalent of the `ANALYZE_FULL` worker message.
   */
  async analyzeData(
    rheoPoints: RheoPointsColumnar,
    geometryKey: string,
    settings: ExpertSettings,
    detectionSettings: DetectionSettingsInput,
    cycleOverrides?: Map<number, number[]>,
  ): Promise<{ cycles: RheoCycle[]; results: Map<number, GraceCycleResult>; allSteps: RheoStep[] }> {
    const raw = await invoke<RawAnalysisOutput>('analysis_analyze_full', {
      input: {
        rheoPoints,
        geometryKey,
        settings: prepareSettings(settings),
        detectionSettings: prepareDetectionSettings(detectionSettings),
        cycleOverrides: cycleOverrides ? Array.from(cycleOverrides.entries()) : [],
      },
    });
    return mapAnalysisOutput(raw);
  },

  /**
   * Detect schedule steps only (no cycle grouping, no Grace calculation).
   * Native Tauri equivalent of the `DETECT_STEPS` worker message.
   */
  async detectSteps(
    rheoPoints: RheoPointsColumnar,
    detectionSettings: DetectionSettingsInput,
  ): Promise<RheoStep[]> {
    const { steps } = await invoke<{ steps: RheoStep[] }>('analysis_detect_steps', {
      input: {
        rheoPoints,
        detectionSettings: prepareDetectionSettings(detectionSettings),
      },
    });
    return steps;
  },

  /**
   * Regroup existing steps by a shear-rate pattern, then calculate Grace.
   * Native Tauri equivalent of the `REGROUP_BY_PATTERN` worker message.
   */
  async regroupByPattern(
    allSteps: RheoStep[],
    shearRatePattern: number[],
    geometryKey: string,
    settings: ExpertSettings,
  ): Promise<{ cycles: RheoCycle[]; results: Map<number, GraceCycleResult>; allSteps: RheoStep[] }> {
    const raw = await invoke<RawAnalysisOutput>('analysis_regroup_by_pattern', {
      input: {
        allSteps,
        shearRatePattern,
        geometryKey,
        settings: prepareSettings(settings),
      },
    });
    return mapAnalysisOutput(raw);
  },
};
