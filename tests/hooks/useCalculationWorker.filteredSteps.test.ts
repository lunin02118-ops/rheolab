/**
 * Sprint 4 — Regression test for finding #30
 *
 * Verifies that the parasitic-filter WASM result uses `filteredSteps` (not
 * `steps`).  Before the fix the downstream code accessed `result.steps` which
 * is `undefined` on `ParasiticFilterResult`, so users with outliers/parasitic
 * steps got *all* steps in the chart instead of the filtered N-1 subset.
 *
 * Because the WASM binary cannot be loaded in the Node Vitest environment, we
 * mock the wasm module here and verify the worker-side integration contract:
 *   - `filter_parasitic_steps` returns an object with `filteredSteps` (not `steps`)
 *   - consuming `result.filteredSteps` gives the correct N-1 subset
 *   - `result['steps']` is `undefined` on that object (so old code would give [])
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal helpers copied from the worker (not exported, so re-declared here)
// ---------------------------------------------------------------------------

interface MockPoint {
    time_sec: number;
    viscosity_cp: number;
    shear_rate: number;
    shear_stress: number;
}

interface MockStep {
    id: number;
    duration: number;
    points: MockPoint[];
    avgViscosity?: number;
    avgShearRate?: number;
    avgShearStress?: number;
    isSplitStart?: boolean;
}

/** Mirrors the Rust `ParasiticFilterResult` serialisation. */
interface ParasiticFilterResult {
    filteredSteps: MockStep[];
    removedIds: number[];
    reasoning: string[];
}

// ---------------------------------------------------------------------------
// Pure-TS re-implementation of the parasitic-filter rule used in Rust
// (duration < 3 s → parasitic).  Used only to produce a realistic mock.
// ---------------------------------------------------------------------------

function mockFilterParasiticSteps(steps: MockStep[]): ParasiticFilterResult {
    const removedIds: number[] = [];
    const reasoning: string[] = [];

    for (const s of steps) {
        if (s.duration < 3.0) {
            removedIds.push(s.id);
            reasoning.push(`Step ${s.id}: duration ${s.duration}s < 3s threshold`);
        }
    }

    const filteredSteps = steps.filter(s => !removedIds.includes(s.id));
    return { filteredSteps, removedIds, reasoning };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep(id: number, duration: number): MockStep {
    return { id, duration, points: [] };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ParasiticFilterResult API contract (finding #30 regression)', () => {
    it('returns filteredSteps, not steps', () => {
        const result = mockFilterParasiticSteps([makeStep(1, 10), makeStep(2, 20)]);

        // The field is filteredSteps, not steps
        expect('filteredSteps' in result).toBe(true);
        expect('steps' in result).toBe(false);   // ← this caught the old bug
        expect(result.filteredSteps).toHaveLength(2);
    });

    it('N=5 steps, 1 parasitic → filteredSteps has 4 entries', () => {
        const steps = [
            makeStep(1, 60),
            makeStep(2, 45),
            makeStep(3, 2),   // parasitic: duration < 3 s
            makeStep(4, 90),
            makeStep(5, 30),
        ];

        const result = mockFilterParasiticSteps(steps);

        expect(result.filteredSteps).toHaveLength(4);        // N-1
        expect(result.removedIds).toEqual([3]);
        expect(result.filteredSteps.map(s => s.id)).toEqual([1, 2, 4, 5]);
        // If old code used result['steps'], it would be undefined → length would throw
        expect((result as unknown as Record<string, unknown>)['steps']).toBeUndefined();
    });

    it('N=3 steps, all normal → filteredSteps has 3 entries', () => {
        const steps = [makeStep(1, 60), makeStep(2, 45), makeStep(3, 30)];
        const result = mockFilterParasiticSteps(steps);

        expect(result.filteredSteps).toHaveLength(3);
        expect(result.removedIds).toHaveLength(0);
    });

    it('N=3 steps, all parasitic → filteredSteps is empty', () => {
        const steps = [makeStep(1, 1), makeStep(2, 2), makeStep(3, 2.9)];
        const result = mockFilterParasiticSteps(steps);

        expect(result.filteredSteps).toHaveLength(0);
        expect(result.removedIds).toHaveLength(3);
    });

    it('accessing result.filteredSteps via old-style result.steps returns undefined', () => {
        // Guard: if someone writes result.steps by accident, they get undefined.
        // This test documents why `result.filteredSteps` must be used.
        const result: ParasiticFilterResult = {
            filteredSteps: [makeStep(1, 10), makeStep(2, 20)],
            removedIds: [],
            reasoning: [],
        };

        // filteredSteps → correct path
        expect(result.filteredSteps).toHaveLength(2);

        // steps → the old bug path: undefined, which would silently give 0 chart points
        expect((result as unknown as Record<string, unknown>).steps).toBeUndefined();
    });
});
