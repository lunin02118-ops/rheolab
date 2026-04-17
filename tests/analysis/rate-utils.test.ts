/**
 * Tests for src/lib/analysis/rate-utils.ts
 * Pure helper functions for shear rate operations.
 */
import { describe, it, expect } from 'vitest';
import { hasRate, isSymmetricPattern, getMonotonicDirection } from '@/lib/analysis/rate-utils';

// ── hasRate ────────────────────────────────────────────────────────────────

describe('hasRate', () => {
    it('returns true when exact match present', () => {
        expect(hasRate([25, 50, 75], 50)).toBe(true);
    });

    it('returns true within default tolerance', () => {
        expect(hasRate([24.8, 50, 75], 25)).toBe(true);
    });

    it('returns false when target not present', () => {
        expect(hasRate([25, 50, 75], 100)).toBe(false);
    });

    it('returns false for empty array', () => {
        expect(hasRate([], 50)).toBe(false);
    });

    it('respects custom tolerance=0', () => {
        expect(hasRate([25, 50, 75], 26, 0)).toBe(false);
    });

    it('respects custom tolerance=12 (|50-61|=11 < 12)', () => {
        expect(hasRate([25, 50, 75], 61, 12)).toBe(true);
    });

    it('returns false when value outside large tolerance still not there', () => {
        expect(hasRate([25, 50, 75], 200, 5)).toBe(false);
    });
});

// ── isSymmetricPattern ──────────────────────────────────────────────────────

describe('isSymmetricPattern', () => {
    it('returns false for fewer than 5 rates', () => {
        expect(isSymmetricPattern([25, 50, 25])).toBe(false);
        expect(isSymmetricPattern([25, 50, 75, 50])).toBe(false);
    });

    it('returns true for perfect triangle [25, 50, 75, 50, 25]', () => {
        expect(isSymmetricPattern([25, 50, 75, 50, 25])).toBe(true);
    });

    it('returns true for pattern with mixing at max — body is [75,50,25,50,75]', () => {
        // max=100; strip leading/trailing 100s → body [75,50,25,50,75] has length=5 ✓
        expect(isSymmetricPattern([100, 75, 50, 25, 50, 75, 100])).toBe(true);
    });

    it('returns false for monotonic ramp (not symmetric)', () => {
        expect(isSymmetricPattern([25, 50, 75, 100, 125])).toBe(false);
    });

    it('returns false for asymmetric pattern [25, 50, 75, 25, 50]', () => {
        expect(isSymmetricPattern([25, 50, 75, 25, 50])).toBe(false);
    });

    it('returns true when symmetric within default tolerance', () => {
        // slight floating point variation
        expect(isSymmetricPattern([24.9, 49.8, 75.1, 50.2, 25.1])).toBe(true);
    });
});

// ── getMonotonicDirection ──────────────────────────────────────────────────

describe('getMonotonicDirection', () => {
    it('returns null for fewer than 3 values', () => {
        expect(getMonotonicDirection([10])).toBeNull();
        expect(getMonotonicDirection([10, 20])).toBeNull();
    });

    it('returns down for strictly decreasing', () => {
        expect(getMonotonicDirection([100, 75, 50, 25])).toBe('down');
    });

    it('returns up for strictly increasing', () => {
        expect(getMonotonicDirection([25, 50, 75, 100])).toBe('up');
    });

    it('returns null for non-monotonic (zigzag)', () => {
        expect(getMonotonicDirection([25, 50, 25, 50])).toBeNull();
    });

    it('returns null for symmetric triangle', () => {
        expect(getMonotonicDirection([25, 50, 75, 50, 25])).toBeNull();
    });

    it('returns down within default tolerance (small bumps)', () => {
        // each step is roughly -10, within tolerance
        expect(getMonotonicDirection([100, 90, 80, 70])).toBe('down');
    });

    it('returns null when both up and down within tolerance', () => {
        // flat — neither strictly up nor down
        expect(getMonotonicDirection([50, 50, 50, 50])).toBeNull();
    });

    it('returns up for two-step ramp from low to high', () => {
        expect(getMonotonicDirection([10, 50, 100])).toBe('up');
    });

    it('returns up for 5-step increasing sequence skipping gaps', () => {
        expect(getMonotonicDirection([10, 25, 50, 75, 100])).toBe('up');
    });

    it('does not confuse single spike as monotonic', () => {
        // [25, 100, 25] → goes up then down → not monotonic
        expect(getMonotonicDirection([25, 100, 25])).toBeNull();
    });
});
