/**
 * Raw rheology primitives: individual data points, columnar arrays, step
 * detections, and rheometer geometry parameters.
 */

/**
 * Single data point from a rheometer instrument.
 */
export interface RheoPoint {
    time_sec: number;           // Time in seconds
    viscosity_cp: number;       // Viscosity in centipoise
    temperature_c: number;      // Temperature in Celsius
    shear_rate_s1?: number;     // Shear rate in 1/s (optional)
    shear_rate?: number;        // Alias for shear_rate_s1 (for compatibility)
    shear_stress_pa?: number;   // Shear stress in Pa (optional)
    speed_rpm?: number;         // Speed in RPM (optional)
    pressure_bar?: number;      // Pressure in bar (optional)
    ph?: number;                // pH value (optional)
}

/**
 * Columnar data structure (SoA) for high-performance rendering.
 */
export interface ColumnarData {
    timeSec: number[];
    viscosityCp: number[];
    temperatureC: number[];
    shearRate: (number | null)[];
    shearStress: (number | null)[];
    pressureBar: (number | null)[];
    speedRpm: (number | null)[];
    /** Bath/heater temperature in °C — absent when file has no such sensor */
    bathTemperatureC?: (number | null)[];
}

/**
 * Step in a rheological test schedule (result of schedule detection).
 */
export interface RheoStep {
    id: number;
    startTime: number;
    endTime: number;
    duration: number;
    shearRate: number;
    avgViscosity: number;
    avgTemperature: number;
    avgShearStress?: number;
    startViscosity: number;
    endViscosity: number;
    viscositySlope: number;
    sampledPoints: Array<{ t: number; v: number; T: number }>;
}

/**
 * Geometry parameters for the rheometer bob/cup.
 */
export interface GeometryParams {
    name: string;
    type: 'bob' | 'vane' | 'parallel_plate';
    r1: number;        // Inner radius (mm)
    r2: number;        // Outer radius (mm)
    L: number;         // Length/Height (mm)
    gap: number;       // Gap (mm)
}
