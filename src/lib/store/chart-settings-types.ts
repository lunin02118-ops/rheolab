/**
 * chart-settings-types.ts
 * Pure TypeScript type definitions for chart settings.
 * No runtime code — no imports needed.
 */

// === Line Style Types ===
export type LineWidth = 1 | 2 | 3 | 4;
export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type LineAxis = 'left' | 'right';

// === Per-parameter unit types ===
/** Viscosity unit family — drives K'/PV/YP derivation in reports. */
export type ViscosityUnit = 'mPa·s' | 'Pa·s' | 'cP';
/** Temperature unit. Bath temperature uses the same set. */
export type TemperatureUnit = '°C' | '°F' | 'K';
/** Pressure unit. */
export type PressureUnit = 'bar' | 'psi' | 'MPa' | 'kPa';
/** Shear rate unit. Single option kept as a union for forward compat. */
export type ShearRateUnit = '1/s';
/** Rotational speed unit. Single option kept as a union for forward compat. */
export type RpmUnit = 'RPM';

/** Consistency index K' / Ks / Kp unit. */
export type ConsistencyUnit = 'Pa·s^n' | 'eq.cP' | 'lbf·s^n/100ft²';
/** Plastic viscosity (PV) unit. */
export type PlasticViscosityUnit = 'Pa·s' | 'cP';
/** Yield point (YP) unit. */
export type YieldPointUnit = 'Pa' | 'lbf/100ft²';

/** Unit preset selector. */
export type UnitPreset = 'metric' | 'imperial' | 'custom';

/** Discriminated union of every allowed unit string. */
export type LineUnit =
    | ViscosityUnit
    | TemperatureUnit
    | PressureUnit
    | ShearRateUnit
    | RpmUnit;

/**
 * Downsampling mode for charts:
 *  - 'off'        — no downsampling, render every raw point
 *  - 'smart'      — only downsample steady-state plateaus (constant shear_rate);
 *                   ramp/sweep segments are kept intact
 *  - 'aggressive' — classic LTTB across the full dataset (original behaviour)
 */
export type DownsampleMode = 'off' | 'smart' | 'aggressive';

/**
 * Axis mode for comparison chart:
 *  - 'shared'     — all left-side metrics share one axis, all right-side share one axis
 *  - 'individual' — each metric gets its own independently-scaled axis
 */
export type ComparisonAxisMode = 'shared' | 'individual';

// === Individual Line Settings ===
export interface LineSettings {
    color: string;
    width: LineWidth;
    style: LineStyle;
    visible: boolean;
    axis: LineAxis;
    /**
     * Display unit for this parameter. Independent per line (e.g. viscosity in
     * Pa·s, temperature in °C, pressure in psi on the same chart).
     *
     * The migration guarantees every persisted line gets a sensible default;
     * code reading this field should treat missing values as the default unit
     * of the corresponding family.
     */
    unit: LineUnit;
}

// === All Lines Settings ===
export interface ChartLineSettings {
    viscosity: LineSettings;
    temperature: LineSettings;
    shearRate: LineSettings;
    pressure: LineSettings;
    rpm: LineSettings;
    bathTemperature: LineSettings;
}

// === Precision Settings ===
export interface ChartPrecision {
    viscosity: 0 | 1 | 2 | 3;
    temperature: 0 | 1 | 2;
    pressure: 0 | 1 | 2 | 3;
    time: 0 | 1 | 2;
    shearRate: 0 | 1 | 2;
    rpm: 0 | 1;
}

// === Rheology table unit settings ===
export interface RheologyUnits {
    viscosity: ViscosityUnit;
    temperature: TemperatureUnit;
    pressure: PressureUnit;
    consistency: ConsistencyUnit;   // K', Ks, Kp
    plasticViscosity: PlasticViscosityUnit; // PV
    yieldPoint: YieldPointUnit;     // YP
}

// === Full Chart Settings ===
export interface ChartSettings {
    lines: ChartLineSettings;
    precision: ChartPrecision;
    showGridLines: boolean;
    gridOpacity: number;
    animationsEnabled: boolean;
    tooltipEnabled: boolean;
    downsampleMode: DownsampleMode;
    /** Axis mode for the comparison chart */
    comparisonAxisMode: ComparisonAxisMode;
    /** Unit preset mode */
    unitPreset: UnitPreset;
    /** Per-parameter units for the rheology analysis table */
    rheologyUnits: RheologyUnits;
}
