/**
 * Rheology Analysis Constants
 */

// Shear Rate Thresholds (1/s)
export const SHEAR_RATE_HIGH = 400;
export const SHEAR_RATE_REF = 100;
export const SHEAR_RATE_MIXING_MIN = 50;
export const SHEAR_RATE_LOW_VARIANCE = 20;

// Duration Thresholds (seconds)
export const DURATION_MIXING_MIN = 25;
export const DURATION_LONG_STEP_RATIO = 1.5;
export const DURATION_END_STEP_MIN = 120;

// API RP 39 Standard Rates
export const API_RATES = [75, 50, 25, 50, 75];

// ISO 13503-1 Standard Rates  
export const ISO_RATES = [25, 50, 75];

// Geometry Parameters for Couette systems
export interface GeometryParams {
    Rb: number; // Bob radius (cm)
    Rc: number; // Cup radius (cm)
    L: number;  // Bob length (cm)
}

export const GEOMETRY_PARAMS: Record<string, GeometryParams> = {
    R1B1: { Rb: 1.7245, Rc: 1.8415, L: 7.62 },
    R1B2: { Rb: 1.2276, Rc: 1.8415, L: 7.62 },
    R1B5: { Rb: 1.5987, Rc: 1.8415, L: 7.62 }, // Default Grace
};
