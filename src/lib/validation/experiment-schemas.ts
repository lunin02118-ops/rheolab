import { z } from 'zod';

// ============================================
// Zod Schemas for RheoLab Enterprise API
// ============================================

/**
 * Water composition parameters (7 components)
 */
export const WaterParamsSchema = z.object({
    ph: z.number().nullable(),
    fe: z.number().nullable(),
    ca: z.number().nullable(),
    mg: z.number().nullable(),
    cl: z.number().nullable(),
    so4: z.number().nullable(),
    hco3: z.number().nullable(),
});

/**
 * Single data point from rheometer instrument
 */
export const RheoPointSchema = z.object({
    time_sec: z.number().finite(),
    viscosity_cp: z.number().finite(),
    temperature_c: z.number().finite(),
    shear_rate_s1: z.number().finite().optional(),
    shear_rate: z.number().finite().optional(),
    shear_stress_pa: z.number().finite().optional(),
    speed_rpm: z.number().finite().optional(),
    pressure_bar: z.number().finite().optional(),
    bath_temperature_c: z.number().finite().optional(),
    ph: z.number().finite().optional(),
});

/**
 * Helper: accepts Date | ISO-string | null | undefined, always stores as
 * Date instance.  Zod v4's `z.coerce.date()` no longer coerces Date→Date,
 * so we handle both input shapes explicitly.
 * Preprocess step converts Invalid Date objects to null (safety for
 * runtime values like new Date("Неизвестно") from Chandler calibration).
 */
const zodDateOrString = z
    .preprocess(
        v => {
            if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
            return v;
        },
        z.union([z.date(), z.string()])
            .transform(v => {
                if (v instanceof Date) return v;
                const d = new Date(v as string);
                return isNaN(d.getTime()) ? null : d;
            })
            .optional()
            .nullable(),
    );

/**
 * Reagent input for experiment
 */
export const ExperimentReagentInputSchema = z.object({
    reagentId: z.string(),
    reagentName: z.string(),
    concentration: z.number(),
    unit: z.string(),
    batchNumber: z.string().optional().nullable(),
    productionDate: zodDateOrString,
});

/**
 * Hydration metrics schema
 */
export const HydrationMetricsSchema = z.object({
    maxViscosity: z.number(),
    timeToMax: z.number(),
    viscosityAt20Min: z.number(),
    avgViscosity55to60: z.number(),
    subgroup: z.enum(['cold_water_5c', 'standard_25c']),
});

/**
 * Rheology metrics schema (ISO 13503 / API 39)
 */
export const RheologyMetricsSchema = z.object({
    n_prime: z.number(),
    k_prime: z.number(),
    initialViscosity_5_10: z.number(),
    comparisonViscosity_5_30: z.number(),
    avgViscosity_10_120: z.number(),
    subgroup: z.enum(['with_stabilizer', 'without_stabilizer', 'with_proppant']),
});

/**
 * Combined metrics - allows either hydration or rheology metrics
 * Uses passthrough to allow additional fields from either type
 */
export const TestMetricsSchema = z.union([
    HydrationMetricsSchema.passthrough(),
    RheologyMetricsSchema.passthrough(),
]);

/**
 * Calibration specific schema
 */
export const CalibrationSchema = z.object({
    deviceType: z.string(),
    calibrationDate: zodDateOrString,
    rSquared: z.number().finite(),
    slope: z.number().finite(),
    intercept: z.number().finite(),
    hysteresis: z.number().finite(),
    stdev: z.number().finite(),
    status: z.enum(['PASS', 'FAIL']),
    rawData: z.array(z.any()).optional().default([]), // JSON array of points
    issues: z.array(z.string()).optional().nullable(), // JSON array of issues
});

/**
 * Experiment save payload - main API validation schema
 */
export const ExperimentSavePayloadSchema = z.object({
    // Metadata
    name: z.string().min(1, 'Experiment name is required'),
    fieldName: z.string().optional().nullable(),
    operatorName: z.string().optional().nullable(),
    wellNumber: z.string().optional().nullable(),
    testId: z.string().optional().nullable(),

    // File info
    originalFilename: z.string(),
    testDate: z.union([z.date(), z.string()]).transform(v => (v instanceof Date ? v : new Date(v))),
    instrumentType: z.string(),
    geometry: z.string().optional().nullable(),
    geometrySource: z.string().optional().nullable(),

    // Water data
    waterSource: z.string().min(1, 'Water source is required'),
    waterParams: WaterParamsSchema.optional().nullable(),

    // Classification
    fluidType: z.enum(['Linear', 'Crosslinked', 'Slickwater', 'VES', 'Foam', 'Emulsion', 'WBM', 'OBM', 'SBM']),
    testGroup: z.enum(['Hydration', 'Rheology']),
    testSubGroup: z.string().optional().nullable(),
    // New 2-level taxonomy
    testCategory: z.enum(['Fracturing', 'Drilling', 'General']).optional().nullable(),
    testType: z.string().optional().nullable(),

    // Results - using passthrough for flexibility
    metrics: z.record(z.string(), z.unknown()),
    rawPoints: z.array(RheoPointSchema),

    // Recipe
    reagents: z.array(ExperimentReagentInputSchema).default([]),

    // Calibration (Optional)
    calibration: CalibrationSchema.optional().nullable(),

    // Overwrite flag
    overwrite: z.boolean().optional(),

    // V8 metadata — optional on the app side, matched to Rust Option<T> on wire
    laboratoryId:  z.string().optional().nullable(),
    parsedBy:      z.string().optional().nullable(),
    parseSource:   z.string().optional().nullable(),
    timeRangeMin:  z.number().optional().nullable(),
    timeRangeMax:  z.number().optional().nullable(),
    viscosityMin:  z.number().optional().nullable(),
    pressureMax:   z.number().optional().nullable(),
    extraFields:   z.record(z.string(), z.unknown()).optional().nullable(),
    dominantPattern: z.string().optional().nullable(),
});

// ============================================
// Reagent Catalog Schemas
// ============================================

/**
 * Schema for creating a new reagent in catalog
 */
export const ReagentCatalogCreateSchema = z.object({
    name: z.string().min(1, 'Название реагента обязательно').trim(),
    category: z.string().min(1, 'Категория обязательна').trim(),
    manufacturer: z.string().trim().optional().nullable(),
    country: z.string().trim().optional().nullable(),
    description: z.string().trim().optional().nullable(),
    activeSubstance: z.string().trim().optional().nullable(),
    form: z.string().trim().optional().nullable(),
});

/**
 * Schema for updating a reagent in catalog
 */
export const ReagentCatalogUpdateSchema = ReagentCatalogCreateSchema.partial();

// ============================================
// Type inference from schema
export type ValidatedExperimentPayload = z.infer<typeof ExperimentSavePayloadSchema>;
export type RheoPointInput = z.infer<typeof RheoPointSchema>;
export type ReagentCatalogCreateInput = z.infer<typeof ReagentCatalogCreateSchema>;
export type ReagentCatalogUpdateInput = z.infer<typeof ReagentCatalogUpdateSchema>;
