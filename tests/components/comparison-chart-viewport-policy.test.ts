import { describe, it, expect } from 'vitest';
import { shouldResetViewportOnExperimentChange } from '@/components/comparison/comparison-chart-uplot';

/**
 * Regression tests for the "replace vs add/remove" viewport reset policy.
 *
 * Background — bug observed on the Comparison tab in v0.2.2-alpha.7/.8:
 * after warm navigation persisted a viewport from a prior experiment whose
 * time range did not match the new selection, the chart would render the
 * new experiment with a misleading viewport (sparse points, brush handles
 * at off-data positions — see the 2026-04-30 bug report Image 1, where
 * `t-12.03.26-3BSL #20` (data starts at 23.0 min) inherited the [22.6, 24]
 * window from a previously-selected experiment).
 *
 * Policy decisions enforced here:
 *  - Initial mount preserves the persisted viewport (route return contract).
 *  - Adding one experiment to a non-empty selection keeps the viewport so
 *    the user does not get snapped to full range mid-comparison build.
 *  - Removing one experiment from a non-empty selection keeps the viewport
 *    for the same reason.
 *  - Replacing the selection wholesale (no shared experiment ids) resets
 *    the viewport because the previous zoom is meaningful only for the
 *    departed experiment(s).
 */

describe('shouldResetViewportOnExperimentChange', () => {
    it('returns false on initial mount (previous = null)', () => {
        expect(shouldResetViewportOnExperimentChange(null, '')).toBe(false);
        expect(shouldResetViewportOnExperimentChange(null, 'a,b,c')).toBe(false);
    });

    it('returns false when the id list is unchanged', () => {
        expect(shouldResetViewportOnExperimentChange('', '')).toBe(false);
        expect(shouldResetViewportOnExperimentChange('a,b', 'a,b')).toBe(false);
    });

    it('returns false when adding one experiment to an existing set', () => {
        // [A] -> [A, B] keeps the viewport (warm-nav add-one-more contract).
        expect(shouldResetViewportOnExperimentChange('a', 'a,b')).toBe(false);
        expect(shouldResetViewportOnExperimentChange('a,b', 'a,b,c')).toBe(false);
    });

    it('returns false when removing one experiment from an existing set', () => {
        // [A, B] -> [A] keeps the viewport so the user can continue inspecting
        // the same time window on the remaining experiments.
        expect(shouldResetViewportOnExperimentChange('a,b', 'a')).toBe(false);
        expect(shouldResetViewportOnExperimentChange('a,b,c', 'a,c')).toBe(false);
    });

    it('returns true when the entire selection is replaced (no shared ids)', () => {
        // [A] -> [B] resets the viewport — typical after the user picks a
        // different experiment from the library: the prior zoom no longer
        // applies to the new time range.
        expect(shouldResetViewportOnExperimentChange('a', 'b')).toBe(true);
        expect(shouldResetViewportOnExperimentChange('a,b', 'c,d')).toBe(true);
    });

    it('returns false when partial overlap remains (one shared id)', () => {
        // [A, B] -> [B, C] still shares B → keep viewport. Helps users who
        // swap one experiment but want to compare the same time window on
        // the other experiments they already had selected.
        expect(shouldResetViewportOnExperimentChange('a,b', 'b,c')).toBe(false);
        expect(shouldResetViewportOnExperimentChange('a,b,c', 'b,d')).toBe(false);
    });

    it('returns true when going from a non-empty selection to nothing', () => {
        // [A] -> [] is a special-case wholesale removal; the viewport from
        // the only previous experiment no longer has any data to anchor it.
        expect(shouldResetViewportOnExperimentChange('a', '')).toBe(true);
        expect(shouldResetViewportOnExperimentChange('a,b,c', '')).toBe(true);
    });

    it('returns true when going from empty to non-empty (post-clear add)', () => {
        // Going `[] -> [A]` after the user previously cleared the comparison
        // resets the viewport: a zustand-persisted viewport from before the
        // clear may still be in the store (e.g. user zoomed on X, removed X,
        // then added Y in the same session) and would otherwise carry into
        // the new selection.  The literal first-mount case is handled by the
        // `previous === null` branch above and is unaffected by this rule.
        expect(shouldResetViewportOnExperimentChange('', 'a')).toBe(true);
        expect(shouldResetViewportOnExperimentChange('', 'a,b')).toBe(true);
    });
});
