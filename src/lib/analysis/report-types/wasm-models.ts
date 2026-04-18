/**
 * @fileoverview WASM Engine Types — interfaces that mirror Rust/WASM data structures.
 *
 * All types here are shaped by the WASM module's public API.
 * Converters in `converters.ts` handle camelCase ↔ snake_case mapping.
 *
 * @module report-types/wasm-models
 */

/**
 * Result from Bingham plastic model calculation.
 *
 * The Bingham model: τ = τ₀ + μₚ·γ̇
 * Where τ₀ is Yield Point (YP) and μₚ is Plastic Viscosity (PV).
 */
export interface WasmBinghamResult {
    /** Model identifier string */
    modelName: string;
    /** Model parameters */
    parameters: {
        /** Plastic Viscosity in Pa·s */
        pv: number;
        /** Yield Point in Pa */
        yp: number;
    };
    /** Coefficient of determination (fit quality, 0-1) */
    r2: number;
}

/**
 * Result from Power Law model calculation.
 *
 * The Power Law model: τ = K·γ̇ⁿ
 * Where K is Consistency Index and n is Flow Behavior Index.
 */
export interface WasmPowerLawResult {
    /** Model identifier string */
    modelName: string;
    /** Model parameters */
    parameters: {
        /** Consistency Index in Pa·sⁿ */
        k: number;
        /** Flow Behavior Index (dimensionless) */
        n: number;
        /** Geometry-independent K value */
        k_ind: number;
        /** Slot flow K value for hydraulics */
        k_slot: number;
    };
    /** Coefficient of determination (fit quality, 0-1) */
    r2: number;
}

/**
 * Combined result from calculating both Bingham and Power Law models.
 */
export interface WasmAllModelsResult {
    /** Bingham model result */
    bingham: WasmBinghamResult;
    /** Power Law model result */
    powerLaw: WasmPowerLawResult;
}

/**
 * Geometry dimensions for rheometer calculations.
 *
 * Represents the bob and cup dimensions in a concentric cylinder viscometer.
 * All dimensions are in METERS (converted from cm in TypeScript).
 */
export interface WasmGeometry {
    /** Bob radius in meters */
    rb: number;
    /** Cup radius in meters */
    rc: number;
    /** Bob length in meters */
    l: number;
}

/**
 * Result from Grace/API RP 13D parameter calculation.
 *
 * Contains comprehensive rheological parameters per API RP 13D methodology
 * for drilling fluid analysis.
 */
export interface WasmGraceResult {
    /** Cycle number */
    cycle_no: number;
    /** Start time in minutes */
    time_min: number;
    /** End time in minutes */
    end_time_min: number;
    /** Time in seconds */
    time_sec: number;
    /** Temperature in Celsius */
    temp_c: number;
    /** Pressure in bar */
    pressure_bar: number;
    /** Flow behavior index (n') */
    n_prime: number;
    /** Consistency index Kv in Pa·sⁿ */
    kv_pasn: number;
    /** Coefficient of determination */
    r2: number;
    /** K' in Pa·sⁿ */
    k_prime_pasn: number;
    /** K' slot in Pa·sⁿ */
    k_prime_slot_pasn: number;
    /** K' pipe in Pa·sⁿ (ISO 13503-1 formula 16) */
    k_prime_pipe_pasn: number;
    /** Viscosities at various shear rates (key: shear rate as string) */
    viscosities: Record<string, number>;
    /** Viscosity at 40 1/s in cP */
    visc_at_40?: number;
    /** Viscosity at 100 1/s in cP */
    visc_at_100?: number;
    /** Viscosity at 170 1/s in cP */
    visc_at_170?: number;
    /** Bingham Plastic Viscosity in Pa·s */
    bingham_pv_pas: number;
    /** Bingham Yield Point in Pa */
    bingham_yp_pa: number;
    /** Bingham model R² */
    bingham_r2: number;
    /** Number of calculation points used */
    calc_points: number;
}

/**
 * Configuration for schedule detection algorithm.
 */
export interface WasmScheduleConfig {
    /** Absolute tolerance for shear rate change detection (1/s) */
    shearRateTolerance: number;
    /** Relative tolerance for shear rate change detection (%) */
    shearRateRelTolerance: number;
    /** Minimum step duration in seconds */
    minStepDuration: number;
    /** Enable step splitting for long steps */
    stepSplitting: boolean;
    /** Duration of split start segment (seconds) */
    splitStartDuration: number;
    /** Duration of split end segment (seconds) */
    splitEndDuration: number;
    /** Minimum step duration to enable splitting (seconds) */
    minDurationForSplit: number;
}

/**
 * Step data structure for WASM communication.
 *
 * Represents a continuous measurement period at approximately constant conditions.
 */
export interface WasmStep {
    /** Step identifier */
    id: number;
    /** Start time in seconds */
    startTime: number;
    /** End time in seconds */
    endTime: number;
    /** Duration in seconds */
    duration: number;
    /** Average shear rate in 1/s */
    avgShearRate: number;
    /** Average shear stress in Pa */
    avgShearStress: number;
    /** Average viscosity in cP */
    avgViscosity: number;
    /** Average temperature in °C */
    avgTemperature: number;
    /** Average pressure in bar */
    avgPressure: number;
    /** Raw measurement points in this step */
    points: Array<{
        time_sec: number;
        viscosity_cp: number;
        temperature_c: number;
        shear_rate: number;
        shear_stress: number;
        pressure_bar: number;
    }>;
    /** Number of points used for calculations */
    calcPointsCount: number;
    /** Whether this is a ramp step (changing shear rate) */
    isRamp: boolean;
    /** Start index in original data array */
    startIndex: number;
    /** End index in original data array */
    endIndex: number;
    /** Whether this is the start portion of a split step */
    isSplitStart: boolean;
}

/**
 * Result from parasitic step filtering.
 */
export interface WasmParasiticResult {
    /** Filtered steps (parasitic steps removed) */
    steps: WasmStep[];
    /** Reasoning for each removed step */
    reasoning: string[];
}

/**
 * Cycle data structure for WASM communication.
 */
export interface WasmCycle {
    /** Cycle identifier */
    id: number;
    /** Cycle index (1-based) */
    cycle_index: number;
    /** Cycle type string */
    type?: string;
    /** Alternative cycle type field */
    cycle_type?: string;
    /** Steps in this cycle */
    steps: WasmStep[];
    /** Human-readable description */
    description: string;
    /** Total duration in seconds */
    duration: number;
}

/**
 * Result from physics enforcement.
 */
export interface WasmPhysicsResult {
    /** Whether shear rate was recovered from stress/viscosity */
    srRecovered: boolean;
    /** Whether RPM was corrected based on geometry */
    rpmCorrected: boolean;
}

/**
 * WASM RheoPoint structure from Rust parser.
 *
 * Represents a single measurement point with possible field variations
 * from different parser implementations.
 */
export interface WasmRheoPoint {
    /** Time in seconds */
    time_sec: number;
    /** Viscosity in centipoise */
    viscosity_cp: number;
    /** Temperature in Celsius */
    temperature_c: number;
    /** RPM (rotations per minute) */
    rpm?: number;
    /** Alternative RPM field name */
    speed_rpm?: number;
    /** Shear rate in 1/s */
    shear_rate?: number;
    /** Alternative shear rate field name */
    shear_rate_s1?: number;
    /** Shear stress in Pa */
    shear_stress?: number;
    /** Alternative shear stress field name */
    shear_stress_pa?: number;
    /** Pressure in bar */
    pressure_bar?: number;
    /** Bath/heater temperature in °C (optional) */
    bath_temperature_c?: number;
}

/**
 * WASM Parse Metadata from Rust parser.
 *
 * Contains metadata extracted during file parsing.
 */
export interface WasmParseMetadata {
    /** Instrument type (snake_case from Rust) */
    instrument_type?: string;
    /** Instrument type (camelCase variant) */
    instrumentType?: string;
    /** Test date as ISO string */
    test_date?: string;
    /** Geometry identifier */
    geometry?: string;
    /** Excel sheet name parsed from */
    sheetName?: string;
    /** How geometry was determined */
    geometrySource?: string;
    /** Whether shear rate was recovered during parsing */
    shearRateRecovered?: boolean;
    /** Whether speed/RPM was recovered during parsing */
    speedRecovered?: boolean;
    /** Whether AI was used for column mapping */
    used_ai?: boolean;
    /** Whether AI was used for column mapping (camelCase variant) */
    usedAI?: boolean;
    /** Calibration data if found in file */
    calibration?: unknown;
}

/**
 * Output from WASM enforce_physics function.
 */
export interface WasmEnforcePhysicsOutput {
    /** Corrected data points */
    data: WasmRheoPoint[];
    /** Result flags */
    result: {
        /** Whether shear rate was recovered */
        srRecovered: boolean;
        /** Whether RPM was corrected */
        rpmCorrected: boolean;
    };
}

/**
 * Result from calibration file parsing.
 *
 * Contains calibration metadata, quality metrics, pass/fail status,
 * any identified issues, and raw calibration data.
 */
export interface WasmCalibrationResult {
    /** Calibration metadata */
    meta: {
        /** Device type identifier */
        deviceType: string;
        /** Coefficient of determination (fit quality) */
        rSquared: number;
        /** Calibration curve slope */
        slope: number;
        /** Calibration curve intercept */
        intercept: number;
        /** Hysteresis measurement */
        hysteresis: number;
        /** Standard deviation */
        stdev: number;
        /** Last calibration date as ISO string */
        lastCalDate?: string;
    };
    /** Overall calibration status */
    status: 'PASS' | 'FAIL';
    /** Array of identified issues */
    issues: string[];
    /** Raw calibration point data */
    data: unknown[];
}

/**
 * Recipe component from WASM filename parsing.
 *
 * Represents a single reagent component extracted from a filename.
 */
export interface WasmRecipeComponent {
    /** Reagent abbreviation (e.g., 'XC', 'PAC', 'CMC') */
    abbreviation: string;
    /** Concentration value */
    concentration: number;
    /** Unit of measurement (e.g., 'ppb', 'kg/m3') */
    unit: string;
    /** Reagent category */
    category?: string;
    /** Matched reagent ID from catalog */
    reagent_id?: string;
    /** Matched reagent name from catalog */
    reagent_name?: string;
}

/**
 * Metadata extracted from filename parsing.
 *
 * Contains structured data parsed from standardized filenames
 * including test information and recipe.
 */
export interface WasmFilenameMetadata {
    /** Test identifier */
    testId?: string;
    /** Test type abbreviation (e.g., 'SST', 'SWB') */
    testType?: string;
    /** Full test type name */
    testTypeFull?: string;
    /** Field or location name */
    fieldName?: string;
    /** Destination/customer information */
    destination?: string;
    /** Array of recipe components */
    recipe: WasmRecipeComponent[];
    /** Test temperature in Celsius */
    temperature?: number;
    /** Test date as string */
    testDate?: string;
    /** Original filename */
    rawFilename: string;
}
