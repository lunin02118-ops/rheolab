/**
 * Derived test metrics and rheological model outputs.
 */

/**
 * Hydration test metrics.
 */
export interface HydrationMetrics {
    maxViscosity: number;           // Maximum viscosity reached (cP)
    timeToMax: number;              // Time to reach max viscosity (seconds)
    viscosityAt20Min: number;       // Interpolated viscosity at T=20 min
    avgViscosity55to60: number;     // Average viscosity in 55-60 min interval
    subgroup: 'cold_water_5c' | 'standard_25c';
}

/**
 * Rheology test metrics (ISO 13503 / API 39).
 */
export interface RheologyMetrics {
    n_prime: number;                // Power Law exponent n'
    k_prime: number;                // Consistency index K'
    initialViscosity_5_10: number;  // Initial viscosity (5-10 min interval)
    comparisonViscosity_5_30: number; // Comparison viscosity (5-30 min)
    avgViscosity_10_120: number;    // Average viscosity (10-120 min)
    subgroup: 'with_stabilizer' | 'without_stabilizer' | 'with_proppant';
}

/**
 * Dashboard-level summary metrics.
 */
export interface DashboardMetrics {
    maxViscosity: number;
    maxTemp: number;
    duration: number;
}

/**
 * Combined discriminated-union of test-level metric results.
 */
export type TestMetrics = HydrationMetrics | RheologyMetrics | DashboardMetrics;

/**
 * Rheology model result (Power Law, Bingham, Herschel-Bulkley, Casson).
 */
export interface ModelResult {
    modelName: string;
    parameters: Record<string, number>;
    r2: number;
    predict: (shearRate: number) => number;
}

/**
 * All calculated rheology models bundled together.
 */
export interface PhysicsEngineResult {
    bingham: ModelResult;
    powerLaw: ModelResult;
    herschelBulkley: ModelResult;
    casson: ModelResult;
}

/**
 * Reagent used in an experiment with batch tracking.
 */
export interface ExperimentReagentInput {
    reagentId: string;
    reagentName: string;
    concentration: number;
    unit: string;                   // "kg/m3", "gpt", "L/m3", "%"
    batchNumber?: string;
    productionDate?: Date;
    category?: string;
}

/**
 * Calibration data structure.
 */
export interface CalibrationData {
    deviceType: string;
    rSquared: number;
    slope: number;
    intercept: number;
    hysteresis: number;
    stdev: number;
    status: 'PASS' | 'FAIL';
    calibrationDate?: Date | string | null;
    issues: string[];
    rawData: unknown[];
}
