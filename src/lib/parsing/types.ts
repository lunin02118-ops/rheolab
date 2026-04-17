/**
 * @fileoverview Type definitions for the Rheometer Data Parser module.
 * 
 * This file contains all TypeScript interfaces used throughout the parser,
 * including data point structures, metadata, and validation types.
 * 
 * ## Core Types
 * - {@link RheoDataPoint} - Single rheological measurement data point
 * - {@link ParsingMetadata} - Metadata about the parsing process
 * - {@link ProcessedFile} - Complete parsed file result
 * 
 * @module parser/types
 */

/**
 * Represents a single rheological measurement data point.
 * 
 * All values are normalized to SI-based units:
 * - Viscosity: centipoise (cP) = mPaВ·s
 * - Temperature: Celsius (В°C)
 * - Shear stress: Pascals (Pa)
 * - Shear rate: reciprocal seconds (sвЃ»В№)
 * - Pressure: bar
 * 
 * @example
 * ```typescript
 * const point: RheoDataPoint = {
 *   time_sec: 120,
 *   viscosity_cp: 45.3,
 *   temperature_c: 85.0,
 *   speed_rpm: 100,
 *   shear_rate_s1: 170.3,
 *   shear_stress_pa: 7.7,
 *   pressure_bar: 0
 * };
 * ```
 */
export interface RheoDataPoint {
    /** Time elapsed since test start in seconds */
    time_sec: number;
    /** Dynamic viscosity in centipoise (cP = mPaВ·s) */
    viscosity_cp: number;
    /** Sample/fluid temperature in degrees Celsius */
    temperature_c: number;
    /** Rotor speed in revolutions per minute */
    speed_rpm: number;
    /** Shear rate in reciprocal seconds (sвЃ»В№) */
    shear_rate_s1: number;
    /** Shear stress in Pascals (Pa) */
    shear_stress_pa: number;
    /** Cell pressure in bar (0 for ambient pressure tests) */
    pressure_bar: number;
    /** Bath/heater temperature in °C — present only when the instrument has a bath sensor */
    bath_temperature_c?: number;
}

/**
 * Validation log entry for parsing warnings and errors.
 * Used to track issues during the parsing process.
 */
export interface ValidationLog {
    /** Severity level of the log entry */
    level: 'INFO' | 'WARNING' | 'ERROR';
    /** Human-readable message describing the issue */
    message: string;
}

/**
 * Represents a chemical component in a fluid recipe.
 * Extracted from filenames or file metadata.
 */
export interface RecipeComponent {
    /** Short abbreviation (e.g., "XC" for Xanthan Gum) */
    abbreviation: string;
    /** Concentration value */
    concentration: number;
    /** Unit of measurement (e.g., "ppg", "lb/bbl", "%") */
    unit: string;
    /** Optional category (e.g., "polymer", "crosslinker") */
    category?: string;
    /** Reference to reagent database ID */
    reagentId?: string;
    /** Full reagent name */
    reagentName?: string;
}

/**
 * Metadata extracted from the filename using naming conventions.
 * 
 * Common filename patterns:
 * - `{TestID}_{TestType}_{Field}_{Well}_{Operator}_{Date}.xlsx`
 * - `{Field}-{Well}-{TestType}-{Temperature}F.xlsx`
 */
export interface FilenameMetadata {
    /** Unique test identifier */
    testId?: string;
    /** Short test type code (e.g., "FS" for frac simulation) */
    testType?: string;
    /** Full test type name */
    testTypeFull?: string;
    /** Oil/gas field name */
    fieldName?: string;
    /** Well number or identifier */
    wellNumber?: string;
    /** Operator/technician name */
    operatorName?: string;
    /** @deprecated Use destination instead */
    waterSource?: string;
    /** Pad/injection destination */
    destination?: string;
    /** Test temperature (if in filename) */
    temperature?: number;
    /** Test date string (if in filename) */
    testDate?: string;
    /** Extracted recipe components */
    recipe?: Array<RecipeComponent>;
    /** Original filename before parsing */
    rawFilename?: string;
}

/**
 * Comprehensive metadata about the parsing process and results.
 * 
 * This interface captures all information about how a file was parsed,
 * what instrument and geometry were detected, and any special handling
 * that was applied.
 */
export interface ParsingMetadata {
    /** 
     * Source of geometry detection:
     * - 'context': Found in file metadata/headers
     * - 'loose': Inferred from patterns
     * - 'physics': Calculated from data (K-factor)
     * - 'default': Used default (R1B5)
     */
    geometrySource?: 'context' | 'loose' | 'physics' | 'default';
    /** Detected rotor/bob geometry (e.g., "R1B1", "R1B5") */
    geometry?: string;
    /** Detected instrument type (e.g., "Chandler Engineering Model 5550") */
    instrumentType?: string;
    /** Original filename */
    filename: string;
    /** True if shear rate was recovered from other fields */
    shearRateRecovered?: boolean;
    /** Name of the Excel sheet that was parsed */
    sheetName?: string;
    /** True if AI was used for column mapping */
    usedAI?: boolean;
    /** True if О· в‰  П„/ОіМ‡, needs geometry confirmation */
    hasShearRateIssue?: boolean;
    /** True if speed (RPM) was recovered from shear rate */
    speedRecovered?: boolean;
    /** Detected test date from file content */
    testDate?: Date;
    /** Metadata extracted from filename */
    filenameMetadata?: FilenameMetadata;
    /** Details about AI-assisted parsing */
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
    /** Legacy AI details emitted by older parser paths */
    aiDetails?: {
        /** Masked API key identifier */
        keyUsed?: string;
        /** Token usage for the AI request */
        tokenUsage?: {
            prompt: number;
            completion: number;
            total: number;
        };
        /** AI model used */
        model?: string;
        /** Error message if AI failed */
        error?: string;
        /** True if response was cached */
        cached?: boolean;
    };
    /** Calibration data extracted from the same file */
    calibration?: {
        /** Device type (e.g., "Viscometer", "Temperature") */
        deviceType: string;
        /** RВІ correlation coefficient */
        rSquared: number;
        /** Calibration curve slope */
        slope: number;
        /** Calibration curve intercept */
        intercept: number;
        /** Hysteresis value */
        hysteresis: number;
        /** Standard deviation */
        stdev: number;
        /** Calibration status */
        status: 'PASS' | 'FAIL';
        /** Last calibration date string */
        lastCalDate?: string;
        /** Parsed calibration date */
        calibrationDate?: Date | null;
        /** List of calibration issues */
        issues: string[];
        /** JSON string of raw calibration data points */
        rawData: string;
    };
    /** Parser engine that produced this result (e.g. 'native', 'wasm', 'legacy-api') — V8 round-trip field */
    parsedBy?: string;
    /** Source file/path used during parsing — V8 round-trip field */
    parseSource?: string;
}

/**
 * Complete result of parsing a rheometer data file.
 * 
 * This is the primary return type when processing files through
 * the upload/import pipeline.
 */
export interface ProcessedFile {
    /** Unique identifier for this processed file */
    id: string;
    /** Original filename */
    fileName: string;
    /** Array of parsed data points */
    data: RheoDataPoint[];
    /** Quality score (0-100) based on data completeness */
    qualityScore: number;
    /** Detected rotor/bob geometry */
    detectedGeometry: string;
    /** Validation logs with warnings and errors */
    logs: ValidationLog[];
    /** Overall parsing status */
    status: 'SUCCESS' | 'WARNING' | 'ERROR';
    /** Full parsing metadata */
    metadata?: ParsingMetadata;
}

/**
 * Represents Excel workbook data in a generic format.
 * 
 * This interface abstracts the workbook structure to allow
 * different Excel parsing libraries (xlsx, exceljs, etc.) to
 * be used interchangeably.
 */
export interface WorkbookData {
    /** Array of sheet names in order */
    sheetNames: string[];
    /** Map of sheet name to 2D array of cell values */
    sheets: { [sheetName: string]: unknown[][] };
}

