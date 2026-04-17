import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { toFiniteNumber } from '@/lib/utils/numbers';
import type { RheoDataPoint, ParsingMetadata, RecipeComponent } from '@/lib/parsing/types';
import type { ParseResult, ParseSummary, WaterParams } from '@/types';
import { clearAnalysisCache } from '@/hooks/useAnalysisPipeline';
import { isTauri } from '@/lib/tauri/core';

/**
 * Fire-and-forget: release the Rust-side file parse cache and shrink SQLite
 * page cache. Called when the user closes/resets an experiment.
 */
function releaseRustMemory(): void {
    if (!isTauri()) return;
    // Dynamic import to avoid circular dependency at module load time
    import('@/lib/tauri/reports').then(({ parsing }) => {
        parsing.releaseCache().catch(() => {
            // Non-critical — Rust cache eviction is best-effort
        });
    }).catch(() => {});
}
// Re-export for backward compatibility
export type { ParseResult, ParseSummary };

type NumericValue = number | string | null | undefined;
type UnknownRecord = Record<string, unknown>;

interface ExperimentDataState {
    parseResult: ParseResult | null;
    isLoading: boolean;
    error: string | null;

    // Editable Data
    recipe: RecipeComponent[];
    waterSource: string;
    waterParams: Partial<WaterParams>;

    // Expert cycle overrides (shared between Dashboard and Reports pages)
    cycleOverrides: Map<number, number[]>;
    patternOverride: number[] | null;

    // Actions
    setParseResult: (result: ParseResult | null) => void;
    setIsLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    setRecipe: (recipe: RecipeComponent[]) => void;
    setWaterSource: (source: string) => void;
    setWaterParams: (params: Partial<WaterParams>) => void;
    setCycleOverrides: (updater: Map<number, number[]> | ((prev: Map<number, number[]>) => Map<number, number[]>)) => void;
    setPatternOverride: (pattern: number[] | null) => void;

    // Granular Updates
    updateMetadata: (metadata: Partial<ParsingMetadata>) => void;
    updateData: (data: RheoDataPoint[]) => void;

    // Complex Actions
    updateGeometry: (geometry: string, kFactor: number) => void;

    reset: () => void;
}

function asRecord(value: unknown): UnknownRecord | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    return value as UnknownRecord;
}

function readNumber(record: UnknownRecord, keys: string[], fallback = 0): number {
    for (const key of keys) {
        if (key in record) {
            return toFiniteNumber(record[key] as NumericValue, fallback);
        }
    }
    return fallback;
}

/** Returns a finite number if the key is present in the record, or `undefined` if absent. */
function readOptionalNumber(record: UnknownRecord, keys: string[]): number | undefined {
    for (const key of keys) {
        if (key in record) {
            const val = toFiniteNumber(record[key] as NumericValue, NaN);
            return Number.isFinite(val) ? val : undefined;
        }
    }
    return undefined;
}

function normalizePoint(point: unknown): RheoDataPoint {
    const record = asRecord(point) ?? {};
    return {
        time_sec: readNumber(record, ['time_sec', 'timeSec', 'time'], 0),
        viscosity_cp: readNumber(record, ['viscosity_cp', 'viscosityCp', 'viscosity'], 0),
        temperature_c: readNumber(record, ['temperature_c', 'temperatureC', 'temperature'], 0),
        speed_rpm: readNumber(record, ['speed_rpm', 'speedRpm', 'rpm'], 0),
        shear_rate_s1: readNumber(record, ['shear_rate_s1', 'shearRateS1', 'shear_rate', 'shearRate'], 0),
        shear_stress_pa: readNumber(record, ['shear_stress_pa', 'shearStressPa', 'shear_stress', 'shearStress'], 0),
        pressure_bar: readNumber(record, ['pressure_bar', 'pressureBar', 'pressure'], 0),
        bath_temperature_c: readOptionalNumber(record, ['bath_temperature_c', 'bathTemperatureC']),
    };
}

function normalizeData(data: unknown): RheoDataPoint[] {
    if (!Array.isArray(data)) {
        return [];
    }

    return data.map((point) => normalizePoint(point));
}

function normalizeParseResult(result: ParseResult | null): ParseResult | null {
    if (!result) {
        return null;
    }

    // If we already have columnarData (from WASM), we don't need to normalize the AoS data array
    if (result.columnarData) {
        const pointCount = result.columnarData.timeSec.length;
        return {
            ...result,
            data: [], // Keep empty to save memory
            summary: {
                ...(result.summary ?? { pointCount }),
                pointCount,
            },
        };
    }

    // Fallback for legacy parsers that still return AoS data
    const data = normalizeData((result as { data?: unknown }).data);
    const summaryPointCount = toFiniteNumber(
        (result.summary as { pointCount?: NumericValue } | undefined)?.pointCount,
        data.length,
    );

    return {
        ...result,
        data,
        summary: {
            ...(result.summary ?? { pointCount: data.length }),
            pointCount: Math.max(0, Math.round(summaryPointCount)),
        },
    };
}

export const useExperimentDataStore = create<ExperimentDataState>()(
    persist(
        (set, get) => ({
            parseResult: null,
            isLoading: false,
            error: null,
            recipe: [],
            waterSource: '',
            waterParams: {},
            cycleOverrides: new Map(),
            patternOverride: null,

            setParseResult: (result) => {
                // When clearing (null) or replacing experiment, release the
                // module-level analysis cache so the old experiment's cycles,
                // steps, and GraceCycleResult maps become eligible for GC.
                if (!result || get().parseResult) {
                    clearAnalysisCache();
                    // Also hint Rust to release its parse cache + SQLite pages
                    releaseRustMemory();
                }
                set({
                    parseResult: normalizeParseResult(result),
                    // Reset expert overrides when a new experiment is loaded
                    cycleOverrides: new Map(),
                    patternOverride: null,
                });
            },
            setIsLoading: (loading) => set({ isLoading: loading }),
            setError: (error) => set({ error }),
            setRecipe: (recipe) => set({ recipe }),
            setWaterSource: (waterSource) => set({ waterSource }),
            setWaterParams: (waterParams) => set({ waterParams }),
            setCycleOverrides: (updater) => set((state) => ({
                cycleOverrides: typeof updater === 'function' ? updater(state.cycleOverrides) : updater,
            })),
            setPatternOverride: (pattern) => set({ patternOverride: pattern }),

            updateMetadata: (partialMetadata) => {
                const current = get().parseResult;
                if (!current) return;
                set({
                    parseResult: {
                        ...current,
                        metadata: { ...current.metadata, ...partialMetadata }
                    }
                });
            },

            updateData: (data) => {
                const current = get().parseResult;
                if (!current) return;
                set({
                    parseResult: {
                        ...current,
                        data: normalizeData(data)
                    }
                });
            },

            updateGeometry: (geometry, kFactor) => {
                const current = get().parseResult;
                if (!current) return;

                // Skip full remap if kFactor hasn't actually changed
                if (current.metadata?.geometry === geometry && (current.metadata as Record<string, unknown>)?.kFactor === kFactor) return;

                // Handle SoA (ColumnarData)
                if (current.columnarData) {
                    const len = current.columnarData.timeSec.length;
                    const newSpeedRpm = new Array(len).fill(null);
                    const newShearRate = new Array(len).fill(null);
                    const newViscosity = new Array(len).fill(0);

                    for (let i = 0; i < len; i++) {
                        const viscosity_cp = current.columnarData.viscosityCp[i];
                        const shear_stress_pa = current.columnarData.shearStress[i] ?? 0;
                        const shear_rate_s1 = current.columnarData.shearRate[i] ?? 0;
                        const speed_rpm = current.columnarData.speedRpm[i] ?? 0;

                        const hasPhysics = viscosity_cp > 0 && shear_stress_pa > 0;
                        const expectedSR = hasPhysics ? (shear_stress_pa * 1000) / viscosity_cp : 0;
                        const isSRConsistent = hasPhysics && shear_rate_s1 > 0 &&
                            Math.abs((shear_rate_s1 - expectedSR) / expectedSR) < 0.05;

                        if (isSRConsistent) {
                            newSpeedRpm[i] = shear_rate_s1 / kFactor;
                            newShearRate[i] = shear_rate_s1;
                            newViscosity[i] = viscosity_cp;
                        } else if (speed_rpm > 0) {
                            const newSR = speed_rpm * kFactor;
                            const newVisc = (newSR > 0 && shear_stress_pa > 0)
                                ? (shear_stress_pa * 1000) / newSR
                                : viscosity_cp;
                            
                            newSpeedRpm[i] = speed_rpm;
                            newShearRate[i] = newSR;
                            newViscosity[i] = newVisc;
                        } else {
                            newSpeedRpm[i] = speed_rpm;
                            newShearRate[i] = shear_rate_s1;
                            newViscosity[i] = viscosity_cp;
                        }
                    }

                    set({
                        parseResult: {
                            ...current,
                            columnarData: {
                                ...current.columnarData,
                                speedRpm: newSpeedRpm,
                                shearRate: newShearRate,
                                viscosityCp: newViscosity
                            },
                            metadata: {
                                ...current.metadata,
                                geometry,
                                geometrySource: 'context'
                            }
                        }
                    });
                    return;
                }

                // Fallback for AoS (Legacy)
                if (!current.data) return;
                const updatedData = current.data.map(point => {
                    const { viscosity_cp, shear_stress_pa, shear_rate_s1, speed_rpm } = point;

                    // Calculate expected Shear Rate from Physics: γ̇ = τ / η
                    const hasPhysics = viscosity_cp > 0 && shear_stress_pa > 0;
                    const expectedSR = hasPhysics ? (shear_stress_pa * 1000) / viscosity_cp : 0;

                    // Check if current Shear Rate is consistent with Physics (within 5%)
                    const isSRConsistent = hasPhysics && shear_rate_s1 > 0 &&
                        Math.abs((shear_rate_s1 - expectedSR) / expectedSR) < 0.05;

                    // SCENARIO 1: Physics is valid. Keep Visc/Stress/SR, update RPM.
                    if (isSRConsistent) {
                        return {
                            ...point,
                            speed_rpm: shear_rate_s1 / kFactor
                        };
                    }

                    // SCENARIO 2: SR inconsistent. Recalculate SR and Viscosity from RPM.
                    if (speed_rpm > 0) {
                        const newSR = speed_rpm * kFactor;
                        const newVisc = (newSR > 0 && shear_stress_pa > 0)
                            ? (shear_stress_pa * 1000) / newSR
                            : viscosity_cp;

                        return {
                            ...point,
                            shear_rate_s1: newSR,
                            viscosity_cp: newVisc
                        };
                    }

                    return point;
                });

                set({
                    parseResult: {
                        ...current,
                        data: updatedData,
                        metadata: {
                            ...current.metadata,
                            geometry,
                            geometrySource: 'context'
                        }
                    }
                });
            },

            reset: () => {
                // Release module-level analysis cache alongside store state
                clearAnalysisCache();
                // Hint Rust to release its parse cache + SQLite pages
                releaseRustMemory();
                set({
                    parseResult: null,
                    isLoading: false,
                    error: null,
                    recipe: [],
                    waterSource: '',
                    waterParams: {},
                    cycleOverrides: new Map(),
                    patternOverride: null,
                });
            },
        }),
        {
            name: 'rheolab-experiment-data',
            // Use sessionStorage to persist full data during session
            // This allows navigation between pages while keeping raw points
            // Data is automatically cleared when browser tab closes
            storage: createJSONStorage(() => sessionStorage),
            // Persist only metadata — raw data points are NOT stored in sessionStorage
            // (avoids 3× copies of potentially large arrays; user re-uploads if they reload)
            partialize: (state) => ({
                parseResult: state.parseResult
                    ? { ...state.parseResult, data: [], columnarData: undefined }
                    : null,
                recipe: state.recipe,
                waterSource: state.waterSource,
                waterParams: state.waterParams
            }),
            merge: (persistedState, currentState) => {
                const persisted = (persistedState as Partial<ExperimentDataState>) ?? {};

                return {
                    ...currentState,
                    ...persisted,
                    parseResult: normalizeParseResult(persisted.parseResult ?? currentState.parseResult),
                    recipe: Array.isArray(persisted.recipe) ? persisted.recipe : currentState.recipe,
                    waterSource: typeof persisted.waterSource === 'string'
                        ? persisted.waterSource
                        : currentState.waterSource,
                    waterParams:
                        persisted.waterParams && typeof persisted.waterParams === 'object'
                            ? persisted.waterParams
                            : currentState.waterParams,
                };
            },
        }
    )
);
