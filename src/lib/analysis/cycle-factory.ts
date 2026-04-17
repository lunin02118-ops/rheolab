/**
 * Cycle Factory - Creation, merging, filtering and reclassification of cycles
 * Extracted from cycle-detector.ts
 */

import type { RheoStep, RheoCycle } from './types';
import { hasRate, isSymmetricPattern, getMonotonicDirection } from './rate-utils';
import {
    DURATION_MIXING_MIN,
    DURATION_LONG_STEP_RATIO
} from '@/lib/constants/rheology';

export interface CycleDetectionOptions {
    smartSlicing?: boolean;
}

/**
 * Create a cycle from a set of steps, determining its type (API/ISO/Custom)
 */
export function createCycleFromSteps(
    steps: RheoStep[],
    id: number,
    cycleIndex: number,
     
    _options: CycleDetectionOptions = {}
): RheoCycle {
    const rates = steps.map(s => s.avgShearRate);

    let type: RheoCycle['type'] = 'Custom';
    let description = `Cycle ${cycleIndex}`;

    const hasR = (r: number, tol: number = 5) => hasRate(rates, r, tol);

    // Extract the BODY rates (exclude mixing at start/end)
    const maxRate = Math.max(...rates);
    const mixingRateTol = 5;
    const isMixingRate = (r: number) => Math.abs(r - maxRate) < mixingRateTol;

    let bodyStartIdx = 0;
    while (bodyStartIdx < rates.length && isMixingRate(rates[bodyStartIdx])) {
        bodyStartIdx++;
    }
    let bodyEndIdx = rates.length - 1;
    while (bodyEndIdx > bodyStartIdx && isMixingRate(rates[bodyEndIdx])) {
        bodyEndIdx--;
    }

    const bodyRates = rates.slice(bodyStartIdx, bodyEndIdx + 1);
    const hasBodyWithMixingTail = bodyStartIdx > 0 || bodyEndIdx < rates.length - 1;

    // Check for SYMMETRY (API pattern)
    const isSymmetric = isSymmetricPattern(rates);

    // Check for MONOTONICITY (ISO pattern)
    const ratesToCheck = hasBodyWithMixingTail && bodyRates.length >= 3 ? bodyRates : rates;
    const monotonicDir = getMonotonicDirection(ratesToCheck);
    const isMonotonic = monotonicDir !== null;

    // API RP 39 Validation
    const hasAPIRates = hasR(75) && hasR(50) && hasR(25);
    const hasLowRates = hasR(10) || hasR(5) || hasR(3);
    const isAPIPattern = isSymmetric && hasAPIRates && !hasLowRates;

    // ISO 13503-1 Validation
    const stepsToCheck = hasBodyWithMixingTail ? bodyRates.length + 1 : steps.length;
    const uniqueRates = new Set(ratesToCheck.map(r => Math.round(r / 10) * 10));
    const hasEnoughLevels = uniqueRates.size >= 3;
    const hasAnomalousRates = ratesToCheck.some(r => r > 200 && r < 400);

    // ISO 13503-1 Standard: Must contain rates from [100, 75, 50, 25]
    // At minimum, should have 2+ of these standard rates  
    const isoStandardRates = [100, 75, 50, 25];
    const isoRateCount = isoStandardRates.filter(target => hasR(target, 12)).length;
    const hasISOStandardRates = isoRateCount >= 2;

    const isISOPattern = isMonotonic && stepsToCheck >= 3 && hasEnoughLevels && !hasAnomalousRates && hasISOStandardRates;

    // Classify
    if (isAPIPattern) {
        type = 'API';
        description = `API RP 39 Cycle`;
    } else if (isISOPattern) {
        type = 'ISO';
        description = `ISO 13503-1 Cycle (${monotonicDir === 'down' ? 'Ramp ↓' : 'Ramp ↑'})`;
    } else {
        const firstStep = steps[0];
        const isLongStart = steps.length > 1
            ? (firstStep.duration > steps[1].duration * DURATION_LONG_STEP_RATIO)
            : (firstStep.duration >= DURATION_MIXING_MIN);

        if (isLongStart) {
            description = `Mixing Cycle`;
        } else {
            description = `Custom Sequence`;
        }
    }

    return {
        id,
        cycleIndex: (type === 'API' || type === 'ISO') ? cycleIndex : undefined,
        type,
        steps,
        description,
        duration: steps.reduce((acc, s) => acc + s.duration, 0)
    };
}

/**
 * Legacy fallback detection when no pattern matches
 */
export function detectCyclesLegacy(steps: RheoStep[], options: CycleDetectionOptions = {}): RheoCycle[] {
    const cycles: RheoCycle[] = [];
    const rates = steps.map(s => s.avgShearRate);

    const maxRate = Math.max(...rates);
    const highRateThreshold = maxRate * 0.85;

    let currentCycleSteps: RheoStep[] = [];
    let wasHighRate = true;

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const isHighRate = step.avgShearRate >= highRateThreshold;

        if (isHighRate && !wasHighRate && currentCycleSteps.length >= 3) {
            cycles.push(createCycleFromSteps([...currentCycleSteps], cycles.length + 1, cycles.length + 1, options));
            currentCycleSteps = [step];
        } else {
            currentCycleSteps.push(step);
        }

        wasHighRate = isHighRate;
    }

    if (currentCycleSteps.length >= 3) {
        const hasLowRates = currentCycleSteps.some(s => s.avgShearRate < highRateThreshold);
        if (hasLowRates) {
            cycles.push(createCycleFromSteps(currentCycleSteps, cycles.length + 1, cycles.length + 1, options));
        }
    }

    if (cycles.length > 0) {
        return cycles;
    }

    return [createCycleFromSteps(steps, 1, 1, options)];
}

/**
 * Merges adjacent cycles that form a symmetric pattern (e.g. Ramp Down + Ramp Up)
 */
export function mergeSymmetricCycles(cycles: RheoCycle[]): RheoCycle[] {
    if (cycles.length < 2) return cycles;

    const result: RheoCycle[] = [];
    let i = 0;

    while (i < cycles.length) {
        const current = cycles[i];
        const next = cycles[i + 1];

        if (!next) {
            result.push(current);
            break;
        }

        const currRates = current.steps.map(s => s.avgShearRate);
        const nextRates = next.steps.map(s => s.avgShearRate);

        const isRampDown = currRates[0] > currRates[currRates.length - 1];
        const isRampUp = nextRates[0] < nextRates[nextRates.length - 1];

        if (isRampDown && isRampUp) {
            const endRate = currRates[currRates.length - 1];
            const startRate = nextRates[0];

            const isContinuous =
                Math.abs(endRate - startRate) < 10 ||
                (endRate > startRate && nextRates[1] > startRate);

            if (isContinuous) {
                const mergedSteps = [...current.steps, ...next.steps];
                const mergedCycle: RheoCycle = {
                    ...current,
                    steps: mergedSteps,
                    duration: current.duration + next.duration,
                    type: 'API',
                    description: 'Симметричный API-цикл (объединённый)'
                };

                result.push(mergedCycle);
                i += 2;
                continue;
            }
        }

        result.push(current);
        i++;
    }

    return result;
}

/**
 * Filter out cycles with invalid data (NaN, Infinity, etc.)
 */
export function filterInvalidCycles(cycles: RheoCycle[]): RheoCycle[] {
    return cycles.filter(cycle => {
        const hasInvalidData = cycle.steps.some(s =>
            !isFinite(s.avgShearRate) ||
            !isFinite(s.avgViscosity) ||
            !isFinite(s.avgShearStress)
        );
        return !hasInvalidData && cycle.steps.length > 0;
    });
}

/**
 * Reclassifies a cycle type based on its current steps.
 * Used after manual editing to update ISO/API/Custom type.
 */
export function reclassifyCycleType(cycle: RheoCycle): RheoCycle {
    const rates = cycle.steps.map(s => s.avgShearRate);
    if (rates.length < 2) return cycle;

    const hasR = (r: number, tol: number = 5) => hasRate(rates, r, tol);

    // Use absolute threshold for mixing detection
    const MIXING_RATE_THRESHOLD = 80;
    const isMixingRate = (r: number) => r > MIXING_RATE_THRESHOLD;

    let bodyStartIdx = 0;
    let bodyEndIdx = rates.length - 1;

    const hasMixingSteps = rates.some(r => r > MIXING_RATE_THRESHOLD);
    if (hasMixingSteps) {
        while (bodyStartIdx < rates.length && isMixingRate(rates[bodyStartIdx])) {
            bodyStartIdx++;
        }
        while (bodyEndIdx > bodyStartIdx && isMixingRate(rates[bodyEndIdx])) {
            bodyEndIdx--;
        }
    }

    const bodyRates = rates.slice(bodyStartIdx, bodyEndIdx + 1);
    const ratesToCheck = bodyRates.length >= 2 ? bodyRates : rates;

    // Check patterns
    const isSymmetric = isSymmetricPattern(rates);
    const monotonicDir = getMonotonicDirection(ratesToCheck);
    const isMonotonic = monotonicDir !== null;

    const hasAPIRates = hasR(75) && hasR(50) && hasR(25);
    const hasLowRates = hasR(10) || hasR(5) || hasR(3);
    const isAPIPattern = isSymmetric && hasAPIRates && !hasLowRates;

    const uniqueRates = new Set(ratesToCheck.map(r => Math.round(r / 10) * 10));
    const hasEnoughLevels = uniqueRates.size >= 3;
    const hasAnomalousRates = ratesToCheck.some(r => r > 200 && r < 400);

    // ISO 13503-1 Standard: Must contain rates from [100, 75, 50, 25]
    const isoStandardRates = [100, 75, 50, 25];
    const isoRateCount = isoStandardRates.filter(target => hasR(target, 12)).length;
    const hasISOStandardRates = isoRateCount >= 2;

    const hasMixingAtStart = bodyStartIdx > 0;
    const hasMixingAtEnd = bodyEndIdx < rates.length - 1;
    const isMixingPositionCorrect = monotonicDir === 'down'
        ? !hasMixingAtEnd || hasMixingAtStart
        : !hasMixingAtStart || hasMixingAtEnd;

    const isISOPattern = isMonotonic && rates.length >= 3 && hasEnoughLevels && !hasAnomalousRates && hasISOStandardRates && isMixingPositionCorrect;

    let newType: RheoCycle['type'] = 'Custom';
    let description = 'Custom Sequence';

    if (isAPIPattern) {
        newType = 'API';
        description = 'API RP 39 Cycle';
    } else if (isISOPattern) {
        newType = 'ISO';
        description = `ISO 13503-1 Cycle (${monotonicDir === 'down' ? 'Ramp ↓' : 'Ramp ↑'})`;
    }

    return {
        ...cycle,
        type: newType,
        description
    };
}
