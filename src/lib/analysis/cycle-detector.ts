/**
 * Cycle Detector - Anchor/Legacy Fallback Only
 * 
 * ⚠️ SECURITY: SST and Repeating Sequence detection logic is ONLY in compiled WASM.
 * This prevents reverse engineering of proprietary detection algorithms.
 * 
 * This TS fallback provides only basic anchor-based and legacy detection.
 * For full functionality, WASM must be loaded.
 */

import type { RheoStep, RheoCycle } from './types';
import {
    SHEAR_RATE_MIXING_MIN,
    DURATION_MIXING_MIN,
    DURATION_LONG_STEP_RATIO,
    DURATION_END_STEP_MIN
} from '@/lib/constants/rheology';

import type {
    CycleDetectionOptions} from './cycle-factory';
import {
    createCycleFromSteps,
    detectCyclesLegacy,
    mergeSymmetricCycles,
    filterInvalidCycles
} from './cycle-factory';

// Re-export for backward compatibility
export type { CycleDetectionOptions } from './cycle-factory';
export { reclassifyCycleType } from './cycle-factory';

/**
 * Main cycle detection function (Limited TS Fallback)
 * 
 * ⚠️ SST and Repeating Sequence detection require WASM.
 * This fallback only uses anchor-based and legacy pattern matching.
 */
export function detectCycles(steps: RheoStep[], options: CycleDetectionOptions = {}): RheoCycle[] {
    if (!steps || steps.length === 0) return [];
    if (steps.length < 3) {
        return [createCycleFromSteps(steps, 1, 1)];
    }

    // NOTE: SST and Repeating Sequence detection is in WASM only (IP protection)

    // --- Dynamic mixing detection ---
    const rates = steps.map(s => Math.round(s.avgShearRate / 5) * 5);
    let edgeRate: number | null = null;

    // Check first few steps for repeated rate
    if (steps.length >= 3) {
        const firstRate = rates[0];
        let repeatCount = 1;
        for (let i = 1; i < Math.min(4, steps.length); i++) {
            if (Math.abs(rates[i] - firstRate) < 10) {
                repeatCount++;
            } else {
                break;
            }
        }
        if (repeatCount >= 2 || steps[0].duration > 45) {
            edgeRate = firstRate;
        }
    }

    // If no edge rate from start, check if last step is mixing
    if (!edgeRate && steps.length >= 3) {
        const lastRate = rates[rates.length - 1];
        let repeatCount = 1;
        for (let i = steps.length - 2; i >= Math.max(0, steps.length - 4); i--) {
            if (Math.abs(rates[i] - lastRate) < 10) {
                repeatCount++;
            } else {
                break;
            }
        }
        if (repeatCount >= 2 || steps[steps.length - 1].duration > 45) {
            edgeRate = lastRate;
        }
    }

    const isMixingStep = (index: number): boolean => {
        const step = steps[index];

        if (step.duration < DURATION_MIXING_MIN) return false;
        if (step.avgShearRate > 400) return false;

        // Method 1: Rate matches detected edge rate
        if (edgeRate !== null && Math.abs(Math.round(step.avgShearRate / 5) * 5 - edgeRate) < 10) {
            return true;
        }

        // Method 2: Duration-based (much longer than neighbors)
        if (index > 0 && index < steps.length - 1) {
            const prevDur = steps[index - 1].duration;
            const nextDur = steps[index + 1].duration;
            const avgNeighborDur = (prevDur + nextDur) / 2;
            if (step.duration > avgNeighborDur * DURATION_LONG_STEP_RATIO) {
                return true;
            }
        }

        // Method 3: End step with long duration
        if (index === steps.length - 1) {
            return step.duration >= DURATION_END_STEP_MIN;
        }

        return false;
    };

    // --- Anchor-based detection using mixing steps ---
    const cycles: RheoCycle[] = [];
    let cycleIdCounter = 1;
    let validCycleCounter = 1;

    const mixingIndices = steps.map((_, i) => isMixingStep(i) ? i : -1).filter(i => i !== -1);

    if (mixingIndices.length > 0) {
        let currentCycleSteps: RheoStep[] = [];

        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];

            // Check for large time gap (> 5x typical duration)
            if (currentCycleSteps.length > 0) {
                const prevStep = currentCycleSteps[currentCycleSteps.length - 1];
                const timeGap = step.startTime - prevStep.endTime;
                const typicalDuration = Math.max(step.duration, prevStep.duration, 30);

                if (timeGap > typicalDuration * 5) {
                    if (currentCycleSteps.length >= 3) {
                        const hasBody = currentCycleSteps.some(s =>
                            s.avgShearRate < SHEAR_RATE_MIXING_MIN || s.duration < DURATION_MIXING_MIN
                        );
                        if (hasBody) {
                            cycles.push(createCycleFromSteps(currentCycleSteps, cycleIdCounter++, validCycleCounter++, options));
                        }
                    }
                    currentCycleSteps = [step];
                    continue;
                }
            }

            if (isMixingStep(i)) {
                const hasBody = currentCycleSteps.some(s =>
                    s.avgShearRate < SHEAR_RATE_MIXING_MIN || s.duration < DURATION_MIXING_MIN || s.avgShearRate > 400
                );

                if (currentCycleSteps.length >= 3 && hasBody) {
                    cycles.push(createCycleFromSteps(currentCycleSteps, cycleIdCounter++, validCycleCounter++, options));
                    currentCycleSteps = [step];
                } else {
                    currentCycleSteps.push(step);
                }
            } else {
                currentCycleSteps.push(step);
            }
        }

        if (currentCycleSteps.length >= 3) {
            cycles.push(createCycleFromSteps(currentCycleSteps, cycleIdCounter++, validCycleCounter++, options));
        }

        if (cycles.length > 0) {
            const mergedCycles = mergeSymmetricCycles(cycles);
            return filterInvalidCycles(mergedCycles);
        }
    }

    // --- Fallback: Pattern-based detection ---
    return filterInvalidCycles(detectCyclesLegacy(steps, options));
}
