/**
 * chart-settings-types.ts
 * Pure TypeScript type definitions for chart settings.
 * No runtime code — no imports needed.
 */

// === Line Style Types ===
export type LineWidth = 1 | 2 | 3 | 4;
export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type LineAxis = 'left' | 'right';

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
}
