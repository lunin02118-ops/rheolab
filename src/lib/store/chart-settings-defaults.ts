/**
 * chart-settings-defaults.ts
 * Default chart settings constants.
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
};

