/**
 * chart-settings-defaults.ts
 * Default chart settings constants.
 */
import type {
    ChartLineSettings,
    ChartSettings,
    RheologyUnits,
    UnitPreset,
    TimeDisplayFormat,
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
    timeFormat: 'seconds',
};

export const IMPERIAL_UNITS: RheologyUnits = {
    viscosity: 'cP',
    temperature: '°F',
    pressure: 'psi',
    consistency: 'lbf·s^n/100ft²',
    plasticViscosity: 'cP',
    yieldPoint: 'lbf/100ft²',
    timeFormat: 'minutes',
};

/** Get the RheologyUnits for a given preset (custom returns current). */
export function getPresetUnits(preset: UnitPreset, current: RheologyUnits): RheologyUnits {
    switch (preset) {
        case 'metric':  return { ...METRIC_UNITS };
        case 'imperial': return { ...IMPERIAL_UNITS };
        default:         return current;
    }
}

/**
 * Format a time value (in seconds) according to the selected display format.
 * Returns only the numeric part — use `timeUnitLabel()` for the unit suffix.
 * - 'seconds'  → "1201"
 * - 'minutes'  → "20.0"
 * - 'hh:mm:ss' → "00:20:01"
 */
export function formatTime(seconds: number, fmt: TimeDisplayFormat): string {
    switch (fmt) {
        case 'minutes':
            return (seconds / 60).toFixed(1);
        case 'hh:mm:ss': {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = Math.floor(seconds % 60);
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        default:
            return String(Math.round(seconds));
    }
}

/** Short unit label for the time column header, e.g. "с", "мин". Empty for hh:mm:ss (self-explanatory). */
export function timeUnitLabel(fmt: TimeDisplayFormat): string {
    switch (fmt) {
        case 'minutes':  return 'мин';
        case 'hh:mm:ss': return '';
        default:         return 'с';
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

