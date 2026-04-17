/**
 * Numeric utilities — single source of truth.
 *
 * @module numbers
 *
 * These helpers safely convert arbitrary values (string | number | null | undefined)
 * to finite numbers, returning a fallback when the conversion fails.
 */

export type NumericInput = number | string | null | undefined;

/**
 * Convert any value to a finite number.
 * Returns `fallback` (default 0) if the result is NaN or ±Infinity.
 */
export function toFiniteNumber(value: unknown, fallback = 0): number {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Convert any value to a finite number or `null`.
 * Returns `null` for null / undefined / empty string / NaN / ±Infinity.
 */
export function toNullableFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Convert any value to a finite number or `undefined`.
 * Returns `undefined` for null / undefined / empty string / NaN / ±Infinity.
 */
export function toOptionalFiniteNumber(value: unknown): number | undefined {
    const normalized = toNullableFiniteNumber(value);
    return normalized === null ? undefined : normalized;
}
