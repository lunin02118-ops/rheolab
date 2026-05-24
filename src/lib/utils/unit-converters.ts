/**
 * Unit conversion utilities for chart display.
 *
 * All raw data is stored in base units:
 *   viscosity  → mPa·s
 *   temperature → °C
 *   pressure   → bar
 *   shearRate  → 1/s
 *   rpm        → RPM
 *
 * These converters transform base-unit values to the target display unit
 * chosen in Settings → Charts → per-line unit selector.
 */

import type {
    ConsistencyUnit,
    PlasticViscosityUnit,
    ViscosityUnit,
    TemperatureUnit,
    PressureUnit,
    LineUnit,
    YieldPointUnit,
} from '@/lib/store/chart-settings-types';

// ── Viscosity (base: mPa·s) ────────────────────────────────────────────

export function convertViscosity(v: number, unit: ViscosityUnit): number {
    switch (unit) {
        case 'Pa·s':  return v / 1000;
        case 'cP':    return v;        // mPa·s ≡ cP
        case 'mPa·s': return v;
        default:       return v;
    }
}

/**
 * Inverse of {@link convertViscosity}: convert a value expressed in `unit`
 * back to the base cP / mPa·s viscosity (1 cP = 1 mPa·s).
 *
 * Used by the touch-point pipeline to recover the canonical cP value from
 * a snapped display-unit coordinate so the DB-persisted touch-points and
 * PDF / Excel text stay consistent with what the user sees on the chart.
 */
export function viscosityToCp(displayValue: number, unit: ViscosityUnit): number {
    switch (unit) {
        case 'Pa·s':  return displayValue * 1000;
        case 'cP':    return displayValue;
        case 'mPa·s': return displayValue;
        default:       return displayValue;
    }
}

export function viscosityDecimals(unit: ViscosityUnit): number {
    return unit === 'Pa·s' ? 4 : 1;
}

// ── Rheology model parameters ──────────────────────────────────────────

const PA_TO_LBF_PER_100FT2 = 2.0885;

/**
 * Convert consistency index values stored in Pa·s^n to the selected display
 * unit. K', Ks and Kp all share the same stress·time^n dimension.
 */
export function convertConsistencyIndex(valuePaSn: number, unit: ConsistencyUnit): number {
    switch (unit) {
        case 'lbf·s^n/100ft²':
            return valuePaSn * PA_TO_LBF_PER_100FT2;
        case 'Pa·s^n':
        default:
            return valuePaSn;
    }
}

export function consistencyDecimals(_unit: ConsistencyUnit): number {
    return 4;
}

/** Convert plastic viscosity stored in Pa·s to the selected display unit. */
export function convertPlasticViscosity(valuePaS: number, unit: PlasticViscosityUnit): number {
    switch (unit) {
        case 'cP':
            return valuePaS * 1000;
        case 'Pa·s':
        default:
            return valuePaS;
    }
}

export function plasticViscosityDecimals(unit: PlasticViscosityUnit): number {
    return unit === 'cP' ? 1 : 4;
}

/** Convert yield point stored in Pa to the selected display unit. */
export function convertYieldPoint(valuePa: number, unit: YieldPointUnit): number {
    switch (unit) {
        case 'lbf/100ft²':
            return valuePa * PA_TO_LBF_PER_100FT2;
        case 'Pa':
        default:
            return valuePa;
    }
}

export function yieldPointDecimals(_unit: YieldPointUnit): number {
    return 2;
}

// ── Temperature (base: °C) ──────────────────────────────────────────────

export function convertTemperature(c: number, unit: TemperatureUnit): number {
    switch (unit) {
        case '°F': return c * 9 / 5 + 32;
        case 'K':  return c + 273.15;
        case '°C': return c;
        default:   return c;
    }
}

export function temperatureDecimals(unit: TemperatureUnit): number {
    return unit === 'K' ? 1 : 1;
}

// ── Pressure (base: bar) ────────────────────────────────────────────────

export function convertPressure(bar: number, unit: PressureUnit): number {
    switch (unit) {
        case 'psi':  return bar * 14.5038;
        case 'MPa':  return bar * 0.1;
        case 'kPa':  return bar * 100;
        case 'bar':  return bar;
        default:     return bar;
    }
}

export function pressureDecimals(unit: PressureUnit): number {
    switch (unit) {
        case 'psi':  return 1;
        case 'MPa':  return 3;
        case 'kPa':  return 0;
        default:     return 2;
    }
}

// ── Generic dispatcher ──────────────────────────────────────────────────

export type SeriesKey = 'viscosity' | 'temperature' | 'shearRate' | 'pressure' | 'rpm' | 'bathTemperature';

/**
 * Convert a single value from base unit to the display unit for a given series.
 */
export function convertValue(value: number, series: SeriesKey, unit: LineUnit): number {
    switch (series) {
        case 'viscosity':
            return convertViscosity(value, unit as ViscosityUnit);
        case 'temperature':
        case 'bathTemperature':
            return convertTemperature(value, unit as TemperatureUnit);
        case 'pressure':
            return convertPressure(value, unit as PressureUnit);
        default:
            return value;
    }
}

/**
 * Build a localised axis label from the parameter name and its unit.
 */
export function axisLabel(
    paramName: string,
    unit: LineUnit,
): string {
    return `${paramName} (${unit})`;
}
