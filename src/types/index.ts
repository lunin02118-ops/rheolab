// ============================================
// Core Data Types for RheoLab Enterprise
// ============================================

import type { FluidType } from '@/lib/constants/fluid-types';
import type { TestCategory, TestType } from '@/lib/constants/test-types';

/**
 * Experiment record (mirrors DB schema).
 */
export interface Experiment {
    id: string;
    name: string;
    testDate: Date | string;
    fluidType: string;
    fieldName?: string | null;
    operatorName?: string | null;
    instrumentType?: string | null;
    data?: string | null;
    rawData?: string | null;
    maxViscosity?: number | null;
    userId?: string | null;
    laboratoryId?: string | null;
    createdAt?: Date | string;
    updatedAt?: Date | string;
    duration?: number | null;
    avgTemp?: number | null;
    waterSource?: string | null;
    analysisContext?: string | null;
    [key: string]: unknown;
}

/**
 * Single data point from rheometer instrument
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
 * Columnar data structure for high-performance rendering (SoA)
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
 * Fluid type classification — 9 canonical values.
 * Re-exported from @/lib/constants/fluid-types for single source of truth.
 */
export type { FluidType };

/**
 * Test category (top-level) and test type (specific test within category).
 * Re-exported from @/lib/constants/test-types.
 */
export type { TestCategory, TestType };

/**
 * Test group classification (legacy — kept for backward compatibility with
 * existing stored experiments; new code should use TestCategory + TestType).
 */
export type TestGroup = 'Hydration' | 'Rheology';

/**
 * Test subgroup classification (legacy)
 */
export type TestSubGroup =
    | 'Cold Water 5°C'
    | 'Standard 25°C'
    | 'With Stabilizer'
    | 'Without Stabilizer'
    | 'With Proppant';

/**
 * Water composition parameters (7 components)
 */
export interface WaterParams {
    ph: number | null;   // pH value
    fe: number | null;   // Iron (Fe) in mg/L
    ca: number | null;   // Calcium (Ca) in mg/L
    mg: number | null;   // Magnesium (Mg) in mg/L
    cl: number | null;   // Chloride (Cl) in mg/L
    so4: number | null;  // Sulfate (SO4) in mg/L
    hco3: number | null; // Bicarbonate (HCO3) in mg/L
}

/**
 * Hydration test metrics
 */
export interface HydrationMetrics {
    maxViscosity: number;           // Maximum viscosity reached (cP)
    timeToMax: number;              // Time to reach max viscosity (seconds)
    viscosityAt20Min: number;       // Interpolated viscosity at T=20 min
    avgViscosity55to60: number;     // Average viscosity in 55-60 min interval
    subgroup: 'cold_water_5c' | 'standard_25c';
}

/**
 * Rheology test metrics (ISO 13503 / API 39)
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
 * Combined metrics type
 */
export interface DashboardMetrics {
    maxViscosity: number;
    maxTemp: number;
    duration: number;
}

/**
 * Combined metrics type
 */
export type TestMetrics = HydrationMetrics | RheologyMetrics | DashboardMetrics;

/**
 * Reagent used in experiment with batch tracking
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
 * Calibration data structure
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
    rawData: any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * Experiment save payload
 */
export interface ExperimentSavePayload {
    // Metadata
    name: string;
    fieldName?: string;
    operatorName?: string;
    wellNumber?: string;
    testId?: string;  // Test number from filename (e.g., "8958")

    // File info
    originalFilename: string;
    testDate: Date;
    instrumentType: string;
    geometry?: string;          // "R1B5", "R1B1", etc.
    geometrySource?: string;    // "context", "loose", "physics", "default"

    // Water data
    waterSource: string;            // REQUIRED
    waterParams?: WaterParams;

    // Classification
    fluidType: FluidType;
    testGroup: TestGroup;
    testSubGroup?: TestSubGroup;
    /** New 2-level taxonomy — replaces testGroup for new experiments. */
    testCategory?: TestCategory;
    testType?: TestType;

    // Results
    metrics: TestMetrics;
    rawPoints: RheoPoint[];

    // Calibration (Optional)
    calibration?: CalibrationData | null;

    // Recipe
    reagents: ExperimentReagentInput[];

    // Overwrite flag (optional)
    overwrite?: boolean;

    // Laboratory association (optional — links to Laboratory table row)
    laboratoryId?: string;

    // V8 metadata round-trip (persisted to DB, survives export/import)
    parsedBy?: string;
    parseSource?: string;
    timeRangeMin?: number;
    timeRangeMax?: number;
    viscosityMin?: number;
    pressureMax?: number;
    extraFields?: Record<string, unknown>;
}

// Re-export from parser types for convenience
export type { RheoDataPoint, ParsingMetadata } from '@/lib/parsing/types';

/**
 * Summary statistics for parsed data
 */
export interface ParseSummary {
    pointCount: number;
    timeRange?: { start: number; end: number; durationMinutes: number };
    viscosityRange?: { min: number; max: number; avg?: number };
    temperatureRange?: { min: number; max: number; avg?: number };
    pressureRange?: { min: number; max: number };
}

/** Which parser backend produced the result */
export type ParsedBy = 'native' | 'wasm' | 'legacy-api';

/**
 * Parse result from Smart Ingestion (unified type)
 * Uses RheoDataPoint (all required fields) for API compatibility
 */
export interface ParseResult {
    success: boolean;
    source: 'regex' | 'ai';
    /** Which parser backend produced the result */
    parsedBy?: ParsedBy;
    /** Non-fatal warnings accumulated during parsing (e.g. fallback transitions) */
    warnings?: string[];
    data: import('@/lib/parsing/types').RheoDataPoint[];
    columnarData?: ColumnarData;
    metadata: {
        filename: string;
        sheetName?: string;
        instrumentType?: string;
        geometry?: string;
        geometrySource?: 'context' | 'loose' | 'physics' | 'default';
        shearRateRecovered?: boolean;
        speedRecovered?: boolean;
        usedAI?: boolean;
        aiDiagnostics?: {
            attempted: boolean;
            provider: string;
            model: string;
            promptVersion: string;
            candidateCount: number;
            selectedCandidate?: number;
            status: 'accepted' | 'failed' | 'rejected';
            failureReason?: string;
            appliedMapping?: Array<{
                field: string;
                index: number;
                confidence?: number;
            }>;
        };
        aiDetails?: {
            keyUsed?: string;
            tokenUsage?: {
                prompt: number;
                completion: number;
                total: number;
            };
            model?: string;
            error?: string;
            cached?: boolean;
        };
        hasShearRateIssue?: boolean;
        testDate?: Date;
        filenameMetadata?: {
            testId?: string;
            testType?: string;
            testTypeFull?: string;
            fieldName?: string;
            wellNumber?: string;
            operatorName?: string;
            waterSource?: string;
            savedExperimentName?: string;
            destination?: string;
            temperature?: number;
            laboratoryName?: string;
            recipe?: Array<{
                abbreviation: string;
                concentration: number;
                unit: string;
                category?: string;
                reagentId?: string;
                reagentName?: string;
            }>;
        };
        calibration?: {
            deviceType: string;
            rSquared: number;
            slope: number;
            intercept: number;
            hysteresis: number;
            stdev: number;
            status: 'PASS' | 'FAIL';
            lastCalDate?: string;
            calibrationDate?: Date | null;
            issues: string[];
            rawData: string;
        };
        /** Parser engine that produced this result — V8 round-trip field */
        parsedBy?: string;
        /** Source file/path used during parsing — V8 round-trip field */
        parseSource?: string;
    };
    summary: ParseSummary;
}

/**
 * Last context for Smart Fill
 */
export interface LastContext {
    fieldName: string | null;
    operatorName: string | null;
    waterSource: string | null;
    reagents: Array<{
        reagentId: string;
        reagentName: string;
        concentration: number;
        unit: string;
        batchNumber: string | null;
        productionDate: string | null;
    }>;
}

/**
 * Step in rheological test schedule
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
 * Rheology model result
 */
export interface ModelResult {
    modelName: string;
    parameters: Record<string, number>;
    r2: number;
    predict: (shearRate: number) => number;
}

/**
 * All calculated rheology models
 */
export interface PhysicsEngineResult {
    bingham: ModelResult;
    powerLaw: ModelResult;
    herschelBulkley: ModelResult;
    casson: ModelResult;
}

/**
 * Geometry parameters for rheometer
 */
export interface GeometryParams {
    name: string;
    type: 'bob' | 'vane' | 'parallel_plate';
    r1: number;        // Inner radius (mm)
    r2: number;        // Outer radius (mm)
    L: number;         // Length/Height (mm)
    gap: number;       // Gap (mm)
}
