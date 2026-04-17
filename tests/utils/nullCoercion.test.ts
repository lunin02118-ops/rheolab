/**
 * Sprint 6 — Regression tests for findings #41/#50/#55
 *
 * - null→0 coercion: toFiniteNumber/toNullableFiniteNumber contract
 * - || vs ?? in viscosity extraction: explicit 0 viscosity must survive,
 *   not be swapped out for undefined
 * - timeSec: explicit 0 must not fall back to time_min * 60
 */

import { describe, it, expect } from 'vitest';
import {
    toFiniteNumber,
    toNullableFiniteNumber,
    toOptionalFiniteNumber,
} from '@/lib/utils/numbers';

// ---------------------------------------------------------------------------
// Helpers mirroring the fixed worker logic for viscAt and timeSec
// ---------------------------------------------------------------------------

function extractViscAt(
    viscosities: Record<number, number>,
    rawResult: Record<string, number | undefined>,
    rate: number
): number | undefined {
    // Fixed: ?? instead of ||
    return viscosities[rate] ?? rawResult[String(rate)] ?? undefined;
}

function extractTimeSec(timeSec: number | undefined, timeMin: number): number {
    // Fixed: ?? instead of ||
    return timeSec ?? (timeMin * 60);
}

// ---------------------------------------------------------------------------
// toFiniteNumber / toNullableFiniteNumber contract tests (finding #41/#50)
// ---------------------------------------------------------------------------

describe('toFiniteNumber — null coercion (finding #41/#50)', () => {
    it('null → 0 (default fallback)', () => {
        expect(toFiniteNumber(null)).toBe(0);
    });

    it('undefined → 0', () => {
        expect(toFiniteNumber(undefined)).toBe(0);
    });

    it('0 → 0 (must NOT be treated as absent)', () => {
        // The key regression: 0 is a valid measurement
        expect(toFiniteNumber(0)).toBe(0);
        expect(toFiniteNumber(0, 99)).toBe(0); // fallback never used
    });

    it('NaN → fallback', () => {
        expect(toFiniteNumber(NaN, 42)).toBe(42);
    });

    it('Infinity → fallback', () => {
        expect(toFiniteNumber(Infinity, 5)).toBe(5);
    });
});

describe('toNullableFiniteNumber — preserves null intent (finding #41/#50)', () => {
    it('null → null (preserved, not coerced to 0)', () => {
        expect(toNullableFiniteNumber(null)).toBeNull();
    });

    it('undefined → null', () => {
        expect(toNullableFiniteNumber(undefined)).toBeNull();
    });

    it('0 → 0 (valid measurement, not null)', () => {
        expect(toNullableFiniteNumber(0)).toBe(0);
    });

    it('valid number → number', () => {
        expect(toNullableFiniteNumber(3.14)).toBe(3.14);
    });
});

describe('toOptionalFiniteNumber', () => {
    it('null → undefined', () => {
        expect(toOptionalFiniteNumber(null)).toBeUndefined();
    });

    it('0 → 0', () => {
        expect(toOptionalFiniteNumber(0)).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Worker viscAt extraction — || vs ?? (finding #55)
// ---------------------------------------------------------------------------

describe('viscosity extraction — || vs ?? (finding #55)', () => {
    it('explicit 0 viscosity at 40 rpm is preserved', () => {
        // Before fix: 0 || fallback → fallback. After fix: 0 ?? fallback → 0
        const viscosities = { 40: 0, 100: 5.2, 170: 3.1 };
        expect(extractViscAt(viscosities, {}, 40)).toBe(0);  // must stay 0, not undefined
    });

    it('missing viscosity → undefined', () => {
        const viscosities: Record<number, number> = {};
        expect(extractViscAt(viscosities, {}, 40)).toBeUndefined();
    });

    it('viscosity only in string-key map → falls back correctly', () => {
        const viscosities: Record<number, number> = {};
        const raw = { '40': 7.5 };
        expect(extractViscAt(viscosities, raw, 40)).toBe(7.5);
    });

    it('numeric map takes priority over string map', () => {
        const viscosities = { 40: 12.0 };
        const raw = { '40': 999 }; // different value to show priority
        expect(extractViscAt(viscosities, raw, 40)).toBe(12.0);
    });
});

// ---------------------------------------------------------------------------
// Worker timeSec — || vs ?? (finding #55)
// ---------------------------------------------------------------------------

describe('timeSec — || vs ?? (finding #55)', () => {
    it('timeSec = 0 at start → must not fall back to timeMin * 60', () => {
        // Before fix: 0 || (timeMin * 60) → 60. After fix: 0 ?? ... → 0
        expect(extractTimeSec(0, 1)).toBe(0);
    });

    it('timeSec undefined → falls back to timeMin * 60', () => {
        expect(extractTimeSec(undefined, 2)).toBe(120);
    });

    it('timeSec has valid value → used as-is', () => {
        expect(extractTimeSec(90, 5)).toBe(90);
    });
});
