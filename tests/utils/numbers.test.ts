import { describe, it, expect } from 'vitest';
import { toFiniteNumber, toNullableFiniteNumber, toOptionalFiniteNumber } from '@/lib/utils/numbers';

describe('toFiniteNumber', () => {
    it('returns numeric value as-is', () => {
        expect(toFiniteNumber(42)).toBe(42);
        expect(toFiniteNumber(0)).toBe(0);
        expect(toFiniteNumber(-3.14)).toBe(-3.14);
    });

    it('parses numeric strings', () => {
        expect(toFiniteNumber('42')).toBe(42);
        expect(toFiniteNumber('3.14')).toBe(3.14);
        expect(toFiniteNumber('-100')).toBe(-100);
    });

    it('returns fallback for non-finite values', () => {
        expect(toFiniteNumber(NaN)).toBe(0);
        expect(toFiniteNumber(Infinity)).toBe(0);
        expect(toFiniteNumber(-Infinity)).toBe(0);
    });

    it('returns fallback for null / undefined / empty string', () => {
        expect(toFiniteNumber(null)).toBe(0);
        expect(toFiniteNumber(undefined)).toBe(0);
        expect(toFiniteNumber('')).toBe(0);
        // Number(null) === 0 which is finite, but we treat null as "no value"
        expect(toFiniteNumber(null, -1)).toBe(-1);
    });

    it('uses custom fallback', () => {
        expect(toFiniteNumber('abc', 99)).toBe(99);
        expect(toFiniteNumber(undefined, 5)).toBe(5);
    });

    it('returns 0 for objects and arrays', () => {
        expect(toFiniteNumber({} as unknown)).toBe(0);
        expect(toFiniteNumber([] as unknown)).toBe(0);
    });
});

describe('toNullableFiniteNumber', () => {
    it('returns finite number as-is', () => {
        expect(toNullableFiniteNumber(42)).toBe(42);
        expect(toNullableFiniteNumber(0)).toBe(0);
    });

    it('parses numeric strings', () => {
        expect(toNullableFiniteNumber('3.14')).toBe(3.14);
    });

    it('returns null for null / undefined / empty string', () => {
        expect(toNullableFiniteNumber(null)).toBeNull();
        expect(toNullableFiniteNumber(undefined)).toBeNull();
        expect(toNullableFiniteNumber('')).toBeNull();
    });

    it('returns null for NaN and Infinity', () => {
        expect(toNullableFiniteNumber(NaN)).toBeNull();
        expect(toNullableFiniteNumber(Infinity)).toBeNull();
        expect(toNullableFiniteNumber(-Infinity)).toBeNull();
    });
});

describe('toOptionalFiniteNumber', () => {
    it('returns finite number as-is', () => {
        expect(toOptionalFiniteNumber(42)).toBe(42);
    });

    it('returns undefined for null / undefined / empty string', () => {
        expect(toOptionalFiniteNumber(null)).toBeUndefined();
        expect(toOptionalFiniteNumber(undefined)).toBeUndefined();
        expect(toOptionalFiniteNumber('')).toBeUndefined();
    });

    it('returns undefined for NaN', () => {
        expect(toOptionalFiniteNumber(NaN)).toBeUndefined();
    });
});
