/**
 * @fileoverview Report Input Types — data structures for Excel and PDF report generation.
 *
 * These types represent the fully assembled input payload passed to the Rust
 * report-generation commands.  Chart-rendering settings are also defined here
 * because they are part of the report input contract.
 *
 * @module report-types/report-inputs
 */

/** Individual line settings for chart rendering in reports. */
export interface ReportLineSettings {
    /** Line color (CSS color string) */
    color: string;
    /** Line width in pixels */
    width: number;
    /** Line style */
    style: 'solid' | 'dashed' | 'dotted';
}

/** Chart line settings for all data series in reports. */
export interface ReportChartLineSettings {
    /** Viscosity line settings */
    viscosity: ReportLineSettings;
    /** Temperature line settings */
    temperature: ReportLineSettings;
    /** Shear rate line settings */
    shearRate: ReportLineSettings;
    /** Pressure line settings */
    pressure: ReportLineSettings;
    /** RPM line settings */
    rpm: ReportLineSettings;
    /** Bath/heater temperature line settings */
    bathTemperature?: ReportLineSettings;
}

// ── Shared inline types ────────────────────────────────────────────────────────

/** Raw measurement rows used in both Excel and PDF reports. */
type RawDataRow = {
    time_sec: number;
    viscosity_cp: number;
    temperature_c?: number;
    shear_rate?: number;
    shear_stress_pa?: number;
    speed_rpm?: number;
    pressure_bar?: number;
    bath_temperature_c?: number;
};

/** Cycle result row used in both Excel and PDF reports. */
type CycleResult = {
    cycleNo: number;
    timeMin: number;
    tempC: number;
    pressure_bar?: number;
    nPrime: number;
    kPrime: number;
    kSlot?: number;
    kPipe?: number;
    r2: number;
    viscAt40?: number;
    viscAt100?: number;
    viscAt170?: number;
    viscosities?: Record<string, number>;
    binghamPv?: number;
    binghamYp?: number;
    binghamR2?: number;
};

/** Report metadata (operator, instrument, well, etc.) */
type ReportMetadata = {
    filename: string;
    testId?: string;
    testDate?: string;
    operatorName?: string;
    laboratoryName?: string;
    fieldName?: string;
    wellNumber?: string;
    instrumentType?: string;
    geometry?: string;
    companyName?: string;
    companyLogoBase64?: string;
    calibration?: {
        deviceType?: string;
        calibrationDate?: string;
        rSquared?: number;
        slope?: number;
        intercept?: number;
        hysteresis?: number;
        stdev?: number;
        status?: string;
    };
};

/** Report display settings shared between Excel and PDF outputs. */
type ReportSettings = {
    language: string;
    unitSystem: string;
    showTouchPoints: boolean;
    showCalibration: boolean;
    showRawData?: boolean;
    viscosityShearRates?: number[];
    showTemperature: boolean;
    showShearRate: boolean;
    showPressure: boolean;
    showBathTemperature?: boolean;
    shearRateAxis?: string;
    pressureAxis?: string;
    viscosityThreshold?: number;
    showTargetTime?: boolean;
    targetTime?: number;
    /**
     * Which rheology parameter table is rendered in the report.
     * `instrument` means parsed calculations from the device report;
     * `program` means values calculated by RheoLab.
     */
    rheologySource?: 'instrument' | 'program';
    /**
     * Axis layout mode for the chart.
     * - 'individual' (Раздельные): viscosity on its own left scale; other metrics on right
     * - 'shared' (Общие): metrics share a unified left/right scale based on their axis setting
     */
    axisMode?: 'individual' | 'shared';
    /**
     * When false (Beginner mode), omit PV / YP / R²B columns from the stats table.
     * Defaults to true for backward compatibility.
     */
    showAdvancedStats?: boolean;
    /** Line settings for chart (colors, widths, styles) */
    lineSettings?: ReportChartLineSettings;
    /**
     * Per-category display unit overrides mirrored from
     * `chartSettings.rheologyUnits` in the UI store.  When present, the
     * Rust side's stats table uses THESE target strings for both labels
     * and numeric conversions — so the report walks away with exactly
     * what the UI's `CycleResultsTable` shows, even for mixed presets
     * like `{ viscosity: 'cP', consistency: 'Pa·s^n' }`.
     *
     * Absent → legacy behaviour (all conversions driven by `unitSystem`).
     * See Rust `ReportSettings.rheology_units` + `formatters::render_*_with`.
     */
    rheologyUnits?: ReportRheologyUnits;
};

/** Per-category target units for report generation. */
export type ReportRheologyUnits = {
    /** Viscosity target unit: `'mPa·s' | 'Pa·s' | 'cP'`. */
    viscosity: string;
    /** Temperature target unit: `'°C' | '°F'`. */
    temperature: string;
    /** Pressure target unit: `'bar' | 'psi'`. */
    pressure: string;
    /** K' target unit: `'Pa·s^n' | 'lbf·s^n/100ft²'`. */
    consistency: string;
    /** PV target unit: `'Pa·s' | 'cP'`. */
    plasticViscosity: string;
    /** YP target unit: `'Pa' | 'lbf/100ft²'`. */
    yieldPoint: string;
    /** Time display format: `'seconds' | 'minutes' | 'hh:mm:ss'`. */
    timeFormat: string;
};

/** Recipe row used in both Excel and PDF reports. */
type RecipeRow = {
    name: string;
    concentration: number;
    unit: string;
    category?: string;
    batchNumber?: string;
};

/** Water source parameters used in both report types. */
type WaterParams = {
    source?: string;
    salinity?: number;
    ph?: number;
    hardness?: number;
};

/** Minimal cycle summary used for chart annotation in both report types. */
type CycleSummary = Array<{
    type: string;
    steps: Array<{ avgShearRate: number }>;
}>;

// ── Public report input types ──────────────────────────────────────────────────

/**
 * Input structure for Excel report generation.
 *
 * Contains all data needed to generate a comprehensive Excel report
 * including metadata, cycle results, recipe, and settings.
 */
export interface ExcelReportInput {
    metadata: ReportMetadata;
    rawData: RawDataRow[];
    cycleResults: CycleResult[];
    settings: ReportSettings;
    recipe: RecipeRow[];
    waterParams?: WaterParams;
    chartImageBase64?: string;
    cycles?: CycleSummary;
}

/**
 * Input structure for PDF report generation.
 *
 * Similar to ExcelReportInput but may include additional PDF-specific
 * options like chart embedding.
 */
export interface PdfReportInput {
    rawData: RawDataRow[];
    metadata: ReportMetadata;
    cycleResults: CycleResult[];
    recipe: RecipeRow[];
    waterParams?: WaterParams;
    chartImageBase64?: string;
    cycles?: CycleSummary;
    settings: ReportSettings;
}
