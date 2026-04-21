/**
 * chart-settings-defaults.ts
 * Default chart settings constants.
 */
import type {
    ChartLineSettings,
    ChartSettings,
    RheologyUnits,
    UnitPreset,
} from './chart-settings-types';

// === Default Line Settings for Display ===
export const DEFAULT_LINE_SETTINGS: ChartLineSettings = {
    viscosity: {
        color: '#3b82f6',    // Blue
        width: 2,
        style: 'solid',
        visible: true,
        axis: 'left',
        unit: 'mPa·s',
    },
    temperature: {
        color: '#f97316',    // Orange
        width: 2,
        style: 'solid',
        visible: true,
        axis: 'right',
        unit: '°C',
    },
    shearRate: {
        color: '#a855f7',    // Purple
        width: 2,
        style: 'solid',
        visible: true,
        axis: 'left',
        unit: '1/s',
    },
    pressure: {
        color: '#22c55e',    // Green
        width: 2,
        style: 'solid',
        visible: false,
        axis: 'right',
        unit: 'bar',
    },
    rpm: {
        color: '#eab308',    // Yellow
        width: 2,
        style: 'solid',
        visible: false,
        axis: 'left',
        unit: 'RPM',
    },
    bathTemperature: {
        color: '#fb923c',    // Orange-400 (dashed, same axis as temp)
        width: 2,
        style: 'dashed',
        visible: true,
        axis: 'right',
        unit: '°C',
    },
};

// === Unit presets ===
export const METRIC_UNITS: RheologyUnits = {
    viscosity: 'mPa·s',
    temperature: '°C',
    pressure: 'bar',
    consistency: 'Pa·s^n',
    plasticViscosity: 'Pa·s',
    yieldPoint: 'Pa',
};

export const IMPERIAL_UNITS: RheologyUnits = {
    viscosity: 'cP',
    temperature: '°F',
    pressure: 'psi',
    consistency: 'lbf·s^n/100ft²',
    plasticViscosity: 'cP',
    yieldPoint: 'lbf/100ft²',
};

/** Get the RheologyUnits for a given preset (custom returns current). */
export function getPresetUnits(preset: UnitPreset, current: RheologyUnits): RheologyUnits {
    switch (preset) {
        case 'metric':  return { ...METRIC_UNITS };
        case 'imperial': return { ...IMPERIAL_UNITS };
        default:         return current;
    }
}

// === Default Settings ===
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
    unitPreset: 'metric',
    rheologyUnits: { ...METRIC_UNITS },
};

