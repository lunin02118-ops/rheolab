/**
 * Analysis Client
 *
 * Thin facade over the PlatformBridge analysis namespace.
 * All analysis IPC goes through the bridge singleton;
 * consumers should use this module instead of importing from `@/lib/tauri` directly.
 */
import { getBridge } from '@/lib/tauri/bridge';
import type {
    RheoStep,
    ExpertSettings,
    DetectionSettingsInput,
    AnalysisResult,
} from './types';
import type { RheoPointsColumnar } from '@/lib/tauri';

/**
 * Full analysis pipeline: detect steps → filter → detect cycles → calculate Grace.
 */
export async function analyzeData(
    rheoPoints: RheoPointsColumnar,
    geometryKey: string,
    settings: ExpertSettings,
    detectionSettings: DetectionSettingsInput,
    cycleOverrides?: Map<number, number[]>,
): Promise<AnalysisResult> {
    return getBridge().analysis.analyzeData(rheoPoints, geometryKey, settings, detectionSettings, cycleOverrides);
}

/**
 * Full analysis for a saved experiment. The backend loads persisted
 * ExperimentData by id, avoiding full rawPoints IPC in the renderer.
 */
export async function analyzeExperimentById(
    experimentId: string,
    geometryKey: string,
    settings: ExpertSettings,
    detectionSettings: DetectionSettingsInput,
    cycleOverrides?: Map<number, number[]>,
): Promise<AnalysisResult> {
    return getBridge().analysis.analyzeExperimentById(
        experimentId,
        geometryKey,
        settings,
        detectionSettings,
        cycleOverrides,
    );
}

/**
 * Detect schedule steps only (no cycle grouping, no Grace calculation).
 */
export async function detectSteps(
    rheoPoints: RheoPointsColumnar,
    detectionSettings: DetectionSettingsInput,
): Promise<RheoStep[]> {
    return getBridge().analysis.detectSteps(rheoPoints, detectionSettings);
}

/**
 * Regroup existing steps by a shear-rate pattern, then calculate Grace.
 */
export async function regroupByPattern(
    allSteps: RheoStep[],
    shearRatePattern: number[],
    geometryKey: string,
    settings: ExpertSettings,
): Promise<AnalysisResult> {
    return getBridge().analysis.regroupByPattern(allSteps, shearRatePattern, geometryKey, settings);
}
