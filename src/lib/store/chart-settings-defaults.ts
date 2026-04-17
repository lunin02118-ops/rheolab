/**
 * chart-settings-defaults.ts
 * Default display and report chart settings constants.
 */
import type {
    ChartLineSettings,
    ChartSettings,
} from './chart-settings-types';

// === Default Line Settings for Display ===
export const DEFAULT_LINE_SETTINGS: ChartLineSettings = {
    viscosity: {
        color: '#3b82f6',    // Blue
        width: 2,
        style: 'solid',
        visible: true,
        axis: 'left',
    },
    temperature: {
        color: '#f97316',    // Orange
        width: 2,
        style: 'solid',
        visible: true,
        axis: 'right',
    },
    shearRate: {
        color: '#a855f7',    // Purple
        width: 2,
        style: 'solid',
        visible: true,
        axis: 'left',
    },
    pressure: {
        color: '#22c55e',    // Green
        width: 2,
        style: 'solid',
        visible: false,
        axis: 'right',
    },
    rpm: {
        color: '#eab308',    // Yellow
        width: 2,
        style: 'solid',
        visible: false,
        axis: 'left',
    },
    bathTemperature: {
        color: '#fb923c',    // Orange-400 (dashed, same axis as temp)
        width: 2,
        style: 'dashed',
        visible: true,
        axis: 'right',
    },
};

// === Default Line Settings for Reports (darker colors for print) ===
export const DEFAULT_REPORT_LINE_SETTINGS: ChartLineSettings = {
    viscosity: {
        color: '#1e40af',    // Darker Blue
        width: 2,
        style: 'solid',
        visible: true,
        axis: 'left',
    },
    temperature: {
        color: '#c2410c',    // Darker Orange
        width: 2,
        style: 'solid',
        visible: true,
        axis: 'right',
    },
    shearRate: {
        color: '#7e22ce',    // Darker Purple
        width: 2,
        style: 'dashed',
        visible: false,
        axis: 'right',       // Right axis — matches Rust PDF renderer in individual mode
    },
    pressure: {
        color: '#15803d',    // Darker Green
        width: 2,
        style: 'dotted',
        visible: false,
        axis: 'right',
    },
    rpm: {
        color: '#a16207',    // Darker Amber
        width: 2,
        style: 'dashed',
        visible: false,
        axis: 'left',
    },
    bathTemperature: {
        color: '#ea580c',    // Darker Orange (same axis as temp)
        width: 2,
        style: 'dashed',
        visible: true,
        axis: 'right',
    },
};

// === Default Settings for Display ===
export const DEFAULT_CHART_SETTINGS: ChartSettings = {
    lines: DEFAULT_LINE_SETTINGS,
    precision: {
        viscosity: 1,
        temperature: 1,
        pressure: 2,
        time: 2,
        shearRate: 1,
        rpm: 0,
    },
    showGridLines: true,
    gridOpacity: 0.5,
    animationsEnabled: true,
    tooltipEnabled: true,
    downsampleMode: 'smart',
    comparisonAxisMode: 'individual',
};

// === Default Settings for Reports (PDF/Excel) ===
export const DEFAULT_REPORT_SETTINGS: ChartSettings = {
    lines: DEFAULT_REPORT_LINE_SETTINGS,
    precision: {
        viscosity: 1,
        temperature: 1,
        pressure: 2,
        time: 2,
        shearRate: 1,
        rpm: 0,
    },
    showGridLines: true,
    gridOpacity: 0.3,
    animationsEnabled: false,
    tooltipEnabled: false,
    downsampleMode: 'off',
    comparisonAxisMode: 'individual',
};
