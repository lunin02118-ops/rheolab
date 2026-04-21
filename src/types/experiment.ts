/**
 * Experiment-level types: DB record shape, save payload, water parameters,
 * and Smart-Fill context.
 */
import type { RheoPoint } from './rheology';
import type { CalibrationData, ExperimentReagentInput, TestMetrics } from './metrics';
import type { FluidType, TestCategory, TestGroup, TestSubGroup, TestType } from './taxonomy';

/**
 * Experiment record — mirrors the DB schema.
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
 * Water composition parameters (7 components).
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
 * Experiment save payload — full DTO sent from the UI to the backend.
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
    waterSource: string;        // REQUIRED
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

/**
 * Last context for Smart Fill — remembers the most recent experiment's
 * metadata so the user can one-click reapply it to a fresh import.
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
