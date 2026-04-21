/**
 * Chart Settings Store
 * Global settings for chart visualization (Zustand with persist)
 * Each curve has individual color, width and style settings
 *
 * Types and defaults live in separate modules; re-exported here for
 * backward-compatible imports from '@/lib/store/chart-settings-store'.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { logger } from '@/lib/logger';

// Re-export types and defaults for backward compatibility
export type {
    LineWidth,
    LineStyle,
    LineAxis,
    DownsampleMode,
    ComparisonAxisMode,
    LineSettings,
    ChartLineSettings,
    ChartPrecision,
    ChartSettings,
    UnitPreset,
    RheologyUnits,
    ConsistencyUnit,
    PlasticViscosityUnit,
    YieldPointUnit,
    TimeDisplayFormat,
} from './chart-settings-types';
export {
    DEFAULT_LINE_SETTINGS,
    DEFAULT_CHART_SETTINGS,
    METRIC_UNITS,
    IMPERIAL_UNITS,
    getPresetUnits,
    formatTime,
} from './chart-settings-defaults';

import type {
    LineWidth,
    LineStyle,
    LineSettings,
    ChartLineSettings,
    ChartPrecision,
    ChartSettings,
    RheologyUnits,
    UnitPreset,
} from './chart-settings-types';
import {
    DEFAULT_LINE_SETTINGS,
    DEFAULT_CHART_SETTINGS,
    METRIC_UNITS,
    getPresetUnits,
} from './chart-settings-defaults';

// === Line Key Type ===
export type LineKey = keyof ChartLineSettings;

// === Store State Interface ===
interface ChartSettingsState {
    settings: ChartSettings;
    
    // Display settings methods (also used for PDF/Excel reports — single source of truth)
    setSettings: (settings: Partial<ChartSettings>) => void;
    setLineSettings: (lineKey: LineKey, lineSettings: Partial<LineSettings>) => void;
    setPrecision: (precision: Partial<ChartPrecision>) => void;
    /** Apply a unit preset (metric/imperial) or switch to custom. */
    applyUnitPreset: (preset: UnitPreset) => void;
    /** Change a single rheology unit (auto-switches to 'custom' preset). */
    setRheologyUnit: <K extends keyof RheologyUnits>(key: K, value: RheologyUnits[K]) => void;
    resetToDefaults: () => void;
    
    // Export/Import
    exportSettings: () => string;
    importSettings: (json: string) => boolean;
}

// === Debounced localStorage adapter ===
// Chart settings are read on every zoom/pan event; without debouncing, every
// state update would synchronously serialize and write ~5 KB to localStorage.
// 500 ms debounce coalesces rapid successive writes into a single flush.
function makeDebouncedStorage(delayMs = 500) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return {
        getItem: (name: string) => localStorage.getItem(name),
        setItem: (name: string, value: string) => {
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => localStorage.setItem(name, value), delayMs);
        },
        removeItem: (name: string) => localStorage.removeItem(name),
    };
}

/** JSON storage with a 500 ms write debounce — prevents flooding localStorage on every zoom event. */
const debouncedJsonStorage = createJSONStorage(() => makeDebouncedStorage(500));

// === Store Implementation ===
export const useChartSettingsStore = create<ChartSettingsState>()(
    persist(
        (set, get) => ({
            settings: { ...DEFAULT_CHART_SETTINGS },

            // === Display Settings Methods ===
            setSettings: (newSettings) =>
                set((state) => ({
                    settings: { ...state.settings, ...newSettings },
                })),

            setLineSettings: (lineKey, lineSettings) =>
                set((state) => ({
                    settings: {
                        ...state.settings,
                        lines: {
                            ...state.settings.lines,
                            [lineKey]: { ...state.settings.lines[lineKey], ...lineSettings },
                        },
                    },
                })),

            setPrecision: (precision) =>
                set((state) => ({
                    settings: {
                        ...state.settings,
                        precision: { ...state.settings.precision, ...precision },
                    },
                })),

            applyUnitPreset: (preset) =>
                set((state) => {
                    const units = getPresetUnits(preset, state.settings.rheologyUnits);
                    // Also sync line units for chart axes
                    const lines = { ...state.settings.lines };
                    lines.viscosity = { ...lines.viscosity, unit: units.viscosity };
                    lines.temperature = { ...lines.temperature, unit: units.temperature };
                    lines.bathTemperature = { ...lines.bathTemperature, unit: units.temperature };
                    lines.pressure = { ...lines.pressure, unit: units.pressure };
                    return {
                        settings: { ...state.settings, unitPreset: preset, rheologyUnits: units, lines },
                    };
                }),

            setRheologyUnit: (key, value) =>
                set((state) => {
                    const rheologyUnits = { ...state.settings.rheologyUnits, [key]: value };
                    // Sync chart line units where applicable
                    const lines = { ...state.settings.lines };
                    const lu = value as unknown as import('./chart-settings-types').LineUnit;
                    if (key === 'viscosity') lines.viscosity = { ...lines.viscosity, unit: lu };
                    if (key === 'temperature') {
                        lines.temperature = { ...lines.temperature, unit: lu };
                        lines.bathTemperature = { ...lines.bathTemperature, unit: lu };
                    }
                    if (key === 'pressure') lines.pressure = { ...lines.pressure, unit: lu };
                    return {
                        settings: { ...state.settings, unitPreset: 'custom', rheologyUnits, lines },
                    };
                }),

            resetToDefaults: () =>
                set({ settings: structuredClone(DEFAULT_CHART_SETTINGS) }),

            // === Export/Import ===
            exportSettings: () => {
                const { settings } = get();
                return JSON.stringify(settings, null, 2);
            },

            importSettings: (json: string) => {
                try {
                    const parsed = JSON.parse(json);
                    
                    // v8+ format: plain ChartSettings object
                    // v7 and earlier: { display: ..., report: ... } — extract display part only
                    const chartData = parsed.display ? parsed.display : parsed;
                    
                    if (chartData.lines && chartData.precision) {
                        set({
                            settings: {
                                ...DEFAULT_CHART_SETTINGS,
                                ...chartData,
                                lines: { ...DEFAULT_LINE_SETTINGS, ...chartData.lines },
                                precision: { ...DEFAULT_CHART_SETTINGS.precision, ...chartData.precision },
                            },
                        });
                    } else {
                        console.error('Invalid chart settings format');
                        return false;
                    }
                    
                    return true;
                } catch (e) {
                    console.error('Failed to import chart settings:', e);
                    return false;
                }
            },
        }),
        {
            name: 'rheolab-chart-settings',
            storage: debouncedJsonStorage,
            version: 10, // v10: unitPreset + rheologyUnits
            // merge is called on every hydration — guarantees all default keys
            // (e.g. bathTemperature) are present even in old persisted states.
            merge: (persisted, current) => {
                const p = (persisted ?? {}) as Record<string, unknown>;
                const pSettings = (p.settings ?? {}) as Record<string, unknown>;
                return {
                    ...current,
                    settings: {
                        ...current.settings,
                        ...pSettings,
                        lines: {
                            ...DEFAULT_LINE_SETTINGS,
                            ...((pSettings.lines ?? {}) as object),
                        },
                    },
                };
            },
            migrate: (persistedState: unknown, version: number) => {
                const state = persistedState as Record<string, unknown>;

                // Migration to v10: add unitPreset + rheologyUnits
                if (version < 10) {
                    const s = state?.settings as Record<string, unknown> | undefined;
                    if (s && !s.unitPreset) s.unitPreset = 'metric';
                    if (s && !s.rheologyUnits) s.rheologyUnits = { ...METRIC_UNITS };
                }

                // Migration to v9: ensure every line has a unit field
                if (version < 9) {
                    const s = state?.settings as Record<string, unknown> | undefined;
                    const sLines = s?.lines as Record<string, Record<string, unknown>> | undefined;
                    if (sLines) {
                        const unitDefaults: Record<string, string> = {
                            viscosity: 'mPa·s', temperature: '°C', shearRate: '1/s',
                            pressure: 'bar', rpm: 'RPM', bathTemperature: '°C',
                        };
                        for (const [key, def] of Object.entries(unitDefaults)) {
                            if (sLines[key] && !sLines[key].unit) {
                                sLines[key] = { ...sLines[key], unit: def };
                            }
                        }
                    }
                    // Also drop reportSettings if still present (v8 migration)
                    delete state.reportSettings;
                }

                // Migration to v7: set reportSettings.lines.shearRate.axis to 'right'
                // (default was 'left', but Rust PDF renderer always puts shear rate on right
                // in individual mode — preview and PDF must match)
                // NOTE: reportSettings is dropped in v8, so this only applies to <7
                if (version < 7) {
                    const r = state?.reportSettings as Record<string, unknown> | undefined;
                    const rLines = r?.lines as Record<string, unknown> | undefined;
                    const rShearRate = rLines?.shearRate as Record<string, unknown> | undefined;
                    if (rShearRate && rShearRate.axis === 'left') {
                        rShearRate.axis = 'right';
                    }
                }

                // Migration to v6: add bathTemperature to existing line settings
                if (version < 6) {
                    const s = state?.settings as Record<string, unknown> | undefined;
                    const sLines = s?.lines as Record<string, unknown> | undefined;
                    if (sLines && !('bathTemperature' in sLines)) {
                        sLines.bathTemperature = { ...DEFAULT_LINE_SETTINGS.bathTemperature };
                    }
                    // reportSettings bathTemperature handled above (dropped in v8)
                }

                // Migration to v5: reset comparisonAxisMode to 'individual' (new default) if still at v4 default
                if (version < 5) {
                    const s = state?.settings as Record<string, unknown> | undefined;
                    // Only reset if not explicitly customised (v4 set 'shared' as migration default)
                    if (s && s.comparisonAxisMode === 'shared') s.comparisonAxisMode = 'individual';
                }

                // Migration to v4: add comparisonAxisMode to existing settings
                if (version < 4) {
                    const s = state?.settings as Record<string, unknown> | undefined;
                    if (s && !('comparisonAxisMode' in s)) {
                        s.comparisonAxisMode = 'shared';
                    }
                }

                // Migration to v3: add downsampleMode to existing settings
                if (version < 3) {
                    const s = state?.settings as Record<string, unknown> | undefined;
                    if (s && !('downsampleMode' in s)) {
                        s.downsampleMode = 'smart';
                    }
                }

                // Migration from v1 (old format with colors/visibility) to v2 (lines)
                if (version < 2) {
                    logger.debug('[ChartSettings] Migrating from v1 to v2...');
                    
                    // Check if old format exists
                    const oldSettings = state?.settings as Record<string, unknown> | undefined;
                    
                    // If old format has 'colors' instead of 'lines', migrate
                    if (oldSettings && 'colors' in oldSettings && !('lines' in oldSettings)) {
                        const oldColors = oldSettings.colors as Record<string, string> | undefined;
                        const oldVisibility = oldSettings.visibility as Record<string, boolean> | undefined;
                        
                        // Create new lines structure from old format
                        const newLines: ChartLineSettings = {
                            viscosity: {
                                color: oldColors?.viscosity || DEFAULT_LINE_SETTINGS.viscosity.color,
                                width: (oldSettings.lineWidth as LineWidth) || 2,
                                style: (oldSettings.lineStyle as LineStyle) || 'solid',
                                visible: true,
                                axis: 'left',
                                unit: 'mPa·s',
                            },
                            temperature: {
                                color: oldColors?.temperature || DEFAULT_LINE_SETTINGS.temperature.color,
                                width: (oldSettings.lineWidth as LineWidth) || 2,
                                style: (oldSettings.lineStyle as LineStyle) || 'solid',
                                visible: oldVisibility?.temperature ?? true,
                                axis: 'right',
                                unit: '°C',
                            },
                            shearRate: {
                                color: oldColors?.shearRate || DEFAULT_LINE_SETTINGS.shearRate.color,
                                width: (oldSettings.lineWidth as LineWidth) || 2,
                                style: (oldSettings.lineStyle as LineStyle) || 'solid',
                                visible: oldVisibility?.shearRate ?? true,
                                axis: 'left',
                                unit: '1/s',
                            },
                            pressure: {
                                color: oldColors?.pressure || DEFAULT_LINE_SETTINGS.pressure.color,
                                width: (oldSettings.lineWidth as LineWidth) || 2,
                                style: (oldSettings.lineStyle as LineStyle) || 'solid',
                                visible: oldVisibility?.pressure ?? false,
                                axis: 'right',
                                unit: 'bar',
                            },
                            rpm: {
                                color: oldColors?.rpm || DEFAULT_LINE_SETTINGS.rpm.color,
                                width: (oldSettings.lineWidth as LineWidth) || 2,
                                style: (oldSettings.lineStyle as LineStyle) || 'solid',
                                visible: oldVisibility?.rpm ?? false,
                                axis: 'left',
                                unit: 'RPM',
                            },
                            // bathTemperature was not in v1 — use the default settings
                            bathTemperature: { ...DEFAULT_LINE_SETTINGS.bathTemperature },
                        };
                        
                        return {
                            settings: {
                                ...DEFAULT_CHART_SETTINGS,
                                lines: newLines,
                                precision: oldSettings.precision || DEFAULT_CHART_SETTINGS.precision,
                                showGridLines: oldSettings.showGridLines ?? true,
                                gridOpacity: oldSettings.gridOpacity ?? 0.5,
                                animationsEnabled: oldSettings.animationsEnabled ?? true,
                                tooltipEnabled: oldSettings.tooltipEnabled ?? true,
                            },
                        };
                    }
                    
                    // If completely broken, return defaults
                    if (!oldSettings?.lines) {
                        return {
                            settings: DEFAULT_CHART_SETTINGS,
                        };
                    }
                }
                
                return state;
            },
        }
    )
);

// === Helper: Get stroke dasharray for line style ===
export function getStrokeDasharray(style: LineStyle): string | undefined {
    switch (style) {
        case 'dashed':
            return '5 5';
        case 'dotted':
            return '2 2';
        default:
            return undefined;
    }
}

// === Helper: Format value with precision ===
export function formatWithPrecision(value: number | undefined, precision: number): string {
    if (value === undefined || value === null) return '—';
    if (value === 0) return (0).toFixed(precision);
    return value.toFixed(precision);
}
