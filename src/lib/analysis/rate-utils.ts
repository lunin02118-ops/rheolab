/**
 * Rate Utilities - Common helpers for shear rate operations
 * Extracted from cycle-detector.ts for modularity
 */

/**
 * Check if any rate in the array matches target within tolerance
 */
export function hasRate(rates: number[], target: number, tolerance: number = 5): boolean {
    return rates.some(r => Math.abs(r - target) < tolerance);
}

/**
 * Check if rates form a symmetric pattern (e.g., 75-50-25-50-75)
 */
export function isSymmetricPattern(rates: number[], tolerance: number = 5): boolean {
    if (rates.length < 5) return false;

    const maxRate = Math.max(...rates);

    let startIdx = 0;
    while (startIdx < rates.length && Math.abs(rates[startIdx] - maxRate) < tolerance) {
        startIdx++;
    }

    let endIdx = rates.length - 1;
    while (endIdx > startIdx && Math.abs(rates[endIdx] - maxRate) < tolerance) {
        endIdx--;
    }

    const rampRates = rates.slice(startIdx, endIdx + 1);
    if (rampRates.length < 5) return false;

    const n = rampRates.length;
    const mid = Math.floor(n / 2);

    for (let i = 0; i < mid; i++) {
        const left = rampRates[i];
        const right = rampRates[n - 1 - i];
        if (Math.abs(left - right) > tolerance) {
            return false;
        }
    }

    return true;
}

/**
 * Determine if rates form a monotonic pattern (all increasing or decreasing)
 */
export function getMonotonicDirection(rates: number[], tolerance: number = 5): 'down' | 'up' | null {
    if (rates.length < 3) return null;

    let isDown = true;
    let isUp = true;

    for (let i = 1; i < rates.length; i++) {
        const diff = rates[i] - rates[i - 1];
        if (diff > tolerance) isDown = false;
        if (diff < -tolerance) isUp = false;
    }

    if (isDown && !isUp) return 'down';
    if (isUp && !isDown) return 'up';
    return null;
}
