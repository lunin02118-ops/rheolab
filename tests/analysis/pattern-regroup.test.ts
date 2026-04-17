import { describe, test, expect } from 'vitest';
import { RheoStep, RheoCycle } from '@/lib/analysis/types';
import { createCycleFromSteps } from '@/lib/analysis/cycle-factory';

// Mock helper to simulate the worker logic for testing (EXACT SEQUENCE matching)
function simulateRegroupLogic(allSteps: RheoStep[], shearRatePattern: number[]) {
    const rateMatches = (rate: number, target: number): boolean => {
        const tolerance = target < 10 ? 0.2 : 0.1;
        return Math.abs(Math.round(rate) - target) / Math.max(target, 1) < tolerance;
    };

    const patternLength = shearRatePattern.length;
    const newCycles: RheoCycle[] = [];
    let cycleId = 1;
    let i = 0;

    // Sort steps by time
    const sortedSteps = [...allSteps].sort((a, b) => a.startTime - b.startTime);

    while (i <= sortedSteps.length - patternLength) {
        let matchFound = true;
        const candidateSteps: RheoStep[] = [];

        for (let j = 0; j < patternLength; j++) {
            const step = sortedSteps[i + j];
            const targetRate = shearRatePattern[j];

            if (!rateMatches(step.avgShearRate, targetRate)) {
                matchFound = false;
                break;
            }
            candidateSteps.push(step);
        }

        if (matchFound && candidateSteps.length === patternLength) {
            newCycles.push(createCycleFromSteps(candidateSteps, cycleId, cycleId));
            cycleId++;
            i += patternLength;
        } else {
            i++;
        }
    }

    return newCycles;
}

function createMockStep(id: number, rate: number, start: number, duration: number = 60): RheoStep {
    return {
        id,
        startTime: start,
        endTime: start + duration,
        duration,
        avgShearRate: rate,
        avgShearStress: rate * 0.1,
        avgViscosity: 100,
        avgTemperature: 25,
        avgPressure: 0,
        points: [],
        calcPointsCount: 10,
        isRamp: false,
        startIndex: 0,
        endIndex: 10
    };
}

describe('Global Pattern Regrouping Logic', () => {
    test('should group steps into cycles based on pattern and time gaps', () => {
        const allSteps = [
            createMockStep(1, 100, 0),
            createMockStep(2, 75, 60),
            createMockStep(3, 50, 120),
            createMockStep(4, 25, 180),
            // Gap
            createMockStep(5, 100, 500),
            createMockStep(6, 75, 560),
            createMockStep(7, 50, 620),
            createMockStep(8, 25, 680),
            // Noise step (should be ignored)
            createMockStep(9, 10, 740),
        ];

        const pattern = [100, 75, 50, 25];
        const cycles = simulateRegroupLogic(allSteps, pattern);

        expect(cycles).toHaveLength(2);
        expect(cycles[0].steps).toHaveLength(4);
        expect(cycles[1].steps).toHaveLength(4);
        expect(cycles[0].steps.map(s => Math.round(s.avgShearRate))).toEqual([100, 75, 50, 25]);
    });

    test('should handle steps from different original cycles', () => {
        // Scenario: User wants 50-25-5-100, where 100 was originally in the NEXT cycle
        const allSteps = [
            createMockStep(1, 50, 0),
            createMockStep(2, 25, 60),
            createMockStep(3, 5, 120),
            createMockStep(4, 100, 180), // Originally start of next cycle
            // Large Gap (300s)
            createMockStep(5, 50, 600),
            createMockStep(6, 25, 660),
            createMockStep(7, 5, 720),
            createMockStep(8, 100, 780),
        ];

        const pattern = [50, 25, 5, 100];
        const cycles = simulateRegroupLogic(allSteps, pattern);

        expect(cycles).toHaveLength(2);
        expect(cycles[0].steps).toHaveLength(4);
        expect(cycles[0].steps.map(s => Math.round(s.avgShearRate))).toEqual([50, 25, 5, 100]);
    });

    test('should ignore cycles with only 1 step', () => {
        const allSteps = [
            createMockStep(1, 100, 0),
            createMockStep(2, 10, 60), // Not in pattern
            createMockStep(3, 100, 500),
            createMockStep(4, 75, 560),
        ];

        const pattern = [100, 75];
        const cycles = simulateRegroupLogic(allSteps, pattern);

        expect(cycles).toHaveLength(1); // First 100 is isolated, second 100-75 is a cycle
        expect(cycles[0].steps).toHaveLength(2);
    });

    test('should find exact sequence with repeated rates (100→75→50→25→100)', () => {
        const allSteps = [
            // First sequence: 100→75→50→25→100
            createMockStep(1, 100, 0),
            createMockStep(2, 75, 60),
            createMockStep(3, 50, 120),
            createMockStep(4, 25, 180),
            createMockStep(5, 100, 240),
            // Second sequence: 100→75→50→25→100
            createMockStep(6, 100, 600),
            createMockStep(7, 75, 660),
            createMockStep(8, 50, 720),
            createMockStep(9, 25, 780),
            createMockStep(10, 100, 840),
        ];

        const pattern = [100, 75, 50, 25, 100];
        const cycles = simulateRegroupLogic(allSteps, pattern);

        expect(cycles).toHaveLength(2);
        expect(cycles[0].steps).toHaveLength(5);
        expect(cycles[1].steps).toHaveLength(5);
        expect(cycles[0].steps.map(s => Math.round(s.avgShearRate))).toEqual([100, 75, 50, 25, 100]);
        expect(cycles[1].steps.map(s => Math.round(s.avgShearRate))).toEqual([100, 75, 50, 25, 100]);
    });
});
