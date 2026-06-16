import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Experiment, ColumnarData } from '@/types';
import { useLicenseStore } from '@/lib/store/license-store';
import { licenseEvents } from '@/lib/store/license-events';
import { getExperimentsByIds } from '@/lib/experiments/client';
import { tauriRawRecordsToColumnar } from '@/lib/utils/columnar';
import { logger } from '@/lib/logger';

/**
 * Convert a DB-loaded experiment's AoS rawPoints into SoA ColumnarData and
 * return a new experiment object with rawPoints cleared.  Reduces comparison
 * heap by ~53 % per experiment (typed arrays vs. object graph).
 */
function toColumnarExperiment(exp: Experiment): Experiment {
    const raw = (exp as Record<string, unknown>).rawPoints;
    if (!Array.isArray(raw) || raw.length === 0) return exp;
    const columnarData: ColumnarData = tauriRawRecordsToColumnar(raw as Array<Record<string, unknown>>);
    const { rawPoints: _dropped, ...rest } = exp as Experiment & { rawPoints?: unknown };
    return { ...rest, columnarData, rawPoints: [] } as Experiment;
}

/**
 * Keep only fields needed to preserve the user's comparison selection between
 * route changes. Full chart/report data is reloaded by id when the comparison
 * page mounts again.
 */
function toLightweightComparisonExperiment(exp: Experiment): Experiment {
    return {
        id: exp.id,
        name: exp.name,
        testDate: exp.testDate,
        fluidType: exp.fluidType,
        fieldName: exp.fieldName ?? null,
        operatorName: exp.operatorName ?? null,
        instrumentType: exp.instrumentType ?? null,
        waterSource: exp.waterSource ?? null,
        userId: exp.userId ?? null,
        laboratoryId: exp.laboratoryId ?? null,
        createdAt: exp.createdAt,
        updatedAt: exp.updatedAt,
        originalFilename: (exp as { originalFilename?: unknown }).originalFilename,
        rawPoints: [],
        columnarData: undefined,
    } as Experiment;
}

function isValidHashId(id: string): boolean {
    if (!id) return false;
    if (id.length < 3 || id.length > 64) return false;
    return /^[A-Za-z0-9_-]+$/.test(id);
}

export interface ComparisonDisplaySettings {
    primaryMetric: string;
    leftSecondaryMetric: string;
    secondaryMetric: string;
    tertiaryMetric: string;
    showLegend: boolean;
    showControls: boolean;
    showTouchPoints: boolean;
    viscosityThreshold: number;
    showTargetTime: boolean;
    targetTime: number;
}

export type ComparisonActiveTab = 'chart' | 'report';

export interface ComparisonViewport {
    xMinSec: number;
    xMaxSec: number;
}

export interface ComparisonDiagnosticsStats {
    experimentCount: number;
    selectedCount: number;
    rawCount: number;
    columnarCount: number;
    dbRawCount: number;
    dbColumnarCount: number;
}

export interface ComparisonSessionExperiment {
    id: string;
    name: string;
    testDate?: string;
    fluidType?: string | null;
    instrumentType?: string | null;
    fieldName?: string | null;
    operatorName?: string | null;
    waterSource?: string | null;
    originalFilename?: string;
    createdAt?: string;
    updatedAt?: string;
    color?: string;
    source: 'db' | 'file';
}

const DEFAULT_DISPLAY_SETTINGS: ComparisonDisplaySettings = {
    primaryMetric: 'viscosity_cp',
    leftSecondaryMetric: 'none',
    secondaryMetric: 'temperature_c',
    tertiaryMetric: 'none',
    showLegend: true,
    showControls: true,
    showTouchPoints: false,
    viscosityThreshold: 200,
    showTargetTime: true,
    targetTime: 10,
};

const DEFAULT_SESSION_ID = 'comparison-session-default';

function stringValue(value: unknown): string | undefined {
    if (value instanceof Date) return value.toISOString();
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nullableStringValue(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function comparisonSourceForId(id: string): ComparisonSessionExperiment['source'] {
    return id.startsWith('file-') ? 'file' : 'db';
}

export function toComparisonSessionExperiment(
    exp: Experiment,
    existing?: ComparisonSessionExperiment,
): ComparisonSessionExperiment {
    return {
        id: exp.id,
        name: stringValue(exp.name) ?? existing?.name ?? exp.id,
        testDate: stringValue(exp.testDate) ?? existing?.testDate,
        fluidType: nullableStringValue(exp.fluidType ?? existing?.fluidType),
        instrumentType: nullableStringValue(exp.instrumentType ?? existing?.instrumentType),
        fieldName: nullableStringValue(exp.fieldName ?? existing?.fieldName),
        operatorName: nullableStringValue(exp.operatorName ?? existing?.operatorName),
        waterSource: nullableStringValue(exp.waterSource ?? existing?.waterSource),
        originalFilename: stringValue((exp as Record<string, unknown>).originalFilename) ?? existing?.originalFilename,
        createdAt: stringValue(exp.createdAt) ?? existing?.createdAt,
        updatedAt: stringValue(exp.updatedAt) ?? existing?.updatedAt,
        color: existing?.color,
        source: existing?.source ?? comparisonSourceForId(exp.id),
    };
}

export function deriveComparisonSessionFromExperiments(
    experiments: Experiment[],
    existingById: Record<string, ComparisonSessionExperiment> = {},
): Pick<ComparisonState, 'experimentIds' | 'experimentsById'> {
    const experimentIds: string[] = [];
    const experimentsById: Record<string, ComparisonSessionExperiment> = {};

    for (const exp of experiments) {
        if (!exp?.id || experimentIds.includes(exp.id)) continue;
        experimentIds.push(exp.id);
        experimentsById[exp.id] = toComparisonSessionExperiment(exp, existingById[exp.id]);
    }

    return { experimentIds, experimentsById };
}

interface ComparisonState {
    experiments: Experiment[];
    sessionId: string;
    experimentIds: string[];
    experimentsById: Record<string, ComparisonSessionExperiment>;
    viewport: ComparisonViewport | null;
    activeTab: ComparisonActiveTab;
    displaySettings: ComparisonDisplaySettings;
    /** True once zustand/persist has finished loading from localStorage */
    _hasHydrated: boolean;
    _isRehydrating: boolean;
    _setHasHydrated: (v: boolean) => void;
    addExperiment: (experiment: Experiment) => boolean; // returns false if limit reached
    replaceExperiment: (oldId: string, experiment: Experiment) => void;
    removeExperiment: (id: string) => void;
    clear: () => void;
    isInComparison: (id: string) => boolean;
    getMaxExperiments: () => number;
    updateDisplaySettings: (patch: Partial<ComparisonDisplaySettings>) => void;
    setViewport: (viewport: ComparisonViewport | null) => void;
    setActiveTab: (tab: ComparisonActiveTab) => void;
    /** Re-hydrate experiments that are missing rawPoints (stale localStorage) */
    rehydrateIfNeeded: () => Promise<void>;
    /**
     * Release heavy data (columnarData / rawPoints) from all DB-backed experiments
     * in-memory when the comparison page unmounts. Lightweight metadata is kept so
     * the list of experiment IDs is preserved. Data is reloaded via rehydrateIfNeeded()
     * on the next page mount.
     */
    releaseHeavyData: () => void;
}

export const useComparisonStore = create<ComparisonState>()(
    persist(
        (set, get) => ({
            experiments: [],
            sessionId: DEFAULT_SESSION_ID,
            experimentIds: [],
            experimentsById: {},
            viewport: null,
            activeTab: 'chart',
            displaySettings: { ...DEFAULT_DISPLAY_SETTINGS },
            _hasHydrated: false,
            _isRehydrating: false,
            _setHasHydrated: (v) => set({ _hasHydrated: v }),
            addExperiment: (experiment) => {
                const state = get();
                // Get limit from license features
                const { result } = useLicenseStore.getState();
                const maxExperiments = result?.license?.features?.maxComparisonExperiments ?? 3;

                const selectedIds = new Set([
                    ...state.experimentIds,
                    ...state.experiments.map(e => e.id),
                ]);

                // Check limit
                if (selectedIds.size >= maxExperiments) {
                    return false; // Limit reached
                }
                // Avoid duplicates
                if (selectedIds.has(experiment.id)) {
                    return false;
                }
                // Convert AoS → SoA on ingest to reduce heap footprint.
                const compacted = toColumnarExperiment(experiment);
                const experiments = [...state.experiments, compacted];
                set({
                    experiments,
                    ...deriveComparisonSessionFromExperiments(experiments, state.experimentsById),
                });
                return true;
            },
            replaceExperiment: (oldId, experiment) =>
                set((state) => {
                    const compacted = toColumnarExperiment(experiment);
                    const experiments = state.experiments.reduce<Experiment[]>((acc, existing) => {
                        if (existing.id === oldId) {
                            if (!acc.some((item) => item.id === compacted.id)) acc.push(compacted);
                            return acc;
                        }
                        if (existing.id === compacted.id) return acc;
                        acc.push(existing);
                        return acc;
                    }, []);
                    if (!experiments.some((existing) => existing.id === compacted.id)) {
                        experiments.push(compacted);
                    }
                    const existingById = {
                        ...state.experimentsById,
                        [compacted.id]: state.experimentsById[oldId]
                            ? { ...state.experimentsById[oldId], id: compacted.id, source: 'db' as const }
                            : state.experimentsById[compacted.id],
                    };
                    return {
                        experiments,
                        ...deriveComparisonSessionFromExperiments(
                            experiments,
                            existingById,
                        ),
                    };
                }),
            removeExperiment: (id) => set((state) => {
                const experiments = state.experiments.filter(e => e.id !== id);
                return {
                    experiments,
                    ...deriveComparisonSessionFromExperiments(experiments, state.experimentsById),
                };
            }),
            clear: () => set({
                experiments: [],
                experimentIds: [],
                experimentsById: {},
                viewport: null,
                activeTab: 'chart',
            }),
            isInComparison: (id) => {
                const state = get();
                return state.experimentIds.includes(id) || state.experiments.some(e => e.id === id);
            },
            getMaxExperiments: () => {
                const { result } = useLicenseStore.getState();
                return result?.license?.features?.maxComparisonExperiments ?? 3;
            },
            rehydrateIfNeeded: async () => {
                const state = get();
                if (state.experiments.length === 0) return;
                if (state._isRehydrating) return; // prevent concurrent calls
                set({ _isRehydrating: true });
                const baseExperiments = state.experiments;

                // Phase 1: fast local resolution — no IPC
                const resolved: (Experiment | null)[] = [];
                const needsDb: { index: number; id: string }[] = [];

                for (let i = 0; i < baseExperiments.length; i++) {
                    const exp = baseExperiments[i];

                    // File-based experiments have no DB backing
                    if (exp.id.startsWith('file-')) {
                        const hasPoints = Array.isArray(exp.rawPoints) && exp.rawPoints.length > 0;
                        resolved[i] = hasPoints ? exp : null;
                        continue;
                    }

                    // Already has usable chart data (columnarData) — no DB fetch needed
                    const hasColumnar = !!(exp as Record<string, unknown>).columnarData;
                    if (hasColumnar) { resolved[i] = exp; continue; }

                    // rawPoints present but not yet converted — convert without DB round-trip
                    const hasRawPoints = Array.isArray(exp.rawPoints) && exp.rawPoints.length > 0;
                    if (hasRawPoints) { resolved[i] = toColumnarExperiment(exp); continue; }

                    // No data — schedule for batch DB fetch
                    resolved[i] = null; // placeholder
                    if (isValidHashId(exp.id)) {
                        needsDb.push({ index: i, id: exp.id });
                    }
                }

                // Phase 2: single batch IPC instead of N individual calls
                if (needsDb.length > 0) {
                    try {
                        const res = await getExperimentsByIds(needsDb.map(d => d.id));
                        if (res.success) {
                            const byId = new Map(
                                res.experiments.map(e => [e.id, e])
                            );
                            for (const { index, id } of needsDb) {
                                const fetched = byId.get(id);
                                // Not found → experiment was deleted; leave null
                                if (fetched) {
                                    resolved[index] = toColumnarExperiment(
                                        fetched as unknown as Experiment,
                                    );
                                }
                            }
                        }
                    } catch (_e) {
                        // Transient error — keep experiments with stale metadata
                        logger.warn('comparison-store: rehydrate batch fetch failed', _e);
                        for (const { index } of needsDb) {
                            resolved[index] = baseExperiments[index];
                        }
                    }
                }

                set((currentState) => {
                    const resolvedById = new Map(
                        resolved
                            .filter((experiment): experiment is Experiment => experiment !== null)
                            .map((experiment) => [experiment.id, experiment]),
                    );

                    const invalidIds = new Set(
                        baseExperiments
                            .filter((e) => !e.id.startsWith('file-') && !isValidHashId(e.id))
                            .map((e) => e.id),
                    );

                    const experiments = currentState.experiments
                            .filter((experiment) => !invalidIds.has(experiment.id))
                            .map((experiment) => resolvedById.get(experiment.id) ?? experiment);

                    return {
                        experiments,
                        ...deriveComparisonSessionFromExperiments(
                            experiments,
                            currentState.experimentsById,
                        ),
                        _isRehydrating: false,
                    };
                });
            },
            updateDisplaySettings: (patch) =>
                set((state) => ({
                    displaySettings: { ...state.displaySettings, ...patch },
                })),
            setViewport: (viewport) => set({ viewport }),
            setActiveTab: (activeTab) => set({ activeTab }),
            releaseHeavyData: () =>
                set((state) => {
                    const experiments = state.experiments.map(exp => {
                        // File experiments have no DB — keep their data intact
                        if (exp.id.startsWith('file-')) return exp;
                        // Strip DB-backed experiments down to selection metadata;
                        // rehydrateIfNeeded() reloads chart data by id on the next mount.
                        return toLightweightComparisonExperiment(exp);
                    });
                    return {
                        experiments,
                        ...deriveComparisonSessionFromExperiments(
                            experiments,
                            state.experimentsById,
                        ),
                    };
                }),
        }),
        {
            name: 'comparison-storage', // unique name for localStorage
            onRehydrateStorage: () => (state) => {
                state?._setHasHydrated(true);
            },
            // Strip rawPoints from experiments before persisting to localStorage.
            // rawPoints are the heaviest field (thousands of objects per experiment).
            // DB-backed experiments will be lazily reloaded via rehydrateIfNeeded().
            // File-sourced experiments (id: "file-...") have no DB — keep their rawPoints
            // so they survive tab navigation (max 4 experiments, overhead is acceptable).
            partialize: (state) => ({
                experiments: state.experiments.map(exp => {
                    // Keep file experiments intact — they cannot be reloaded from DB
                    if (exp.id.startsWith('file-')) return exp;
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { rawPoints, data, rawData, columnarData, ...lightweight } = exp as Experiment & { rawPoints?: unknown; data?: unknown; rawData?: unknown; columnarData?: unknown };
                    return lightweight;
                }),
                sessionId: state.sessionId,
                ...deriveComparisonSessionFromExperiments(
                    state.experiments,
                    state.experimentsById,
                ),
                viewport: state.viewport,
                activeTab: state.activeTab,
                displaySettings: state.displaySettings,
                // _hasHydrated is runtime-only — never persist it
            }),
            merge: (persistedState, currentState) => {
                const persisted = (persistedState ?? {}) as Partial<ComparisonState>;
                const experiments = Array.isArray(persisted.experiments)
                    ? persisted.experiments
                    : currentState.experiments;
                const derivedSession = deriveComparisonSessionFromExperiments(
                    experiments,
                    persisted.experimentsById ?? currentState.experimentsById,
                );
                const persistedIds = Array.isArray(persisted.experimentIds)
                    ? persisted.experimentIds.filter(id => !!derivedSession.experimentsById[id])
                    : [];

                return {
                    ...currentState,
                    ...persisted,
                    // Persisted experiments lack rawPoints — they'll be rehydrated on first use
                    experiments,
                    sessionId: stringValue(persisted.sessionId) ?? currentState.sessionId,
                    experimentIds: persistedIds.length > 0
                        ? persistedIds
                        : derivedSession.experimentIds,
                    experimentsById: derivedSession.experimentsById,
                    viewport: persisted.viewport ?? null,
                    activeTab: persisted.activeTab === 'report' ? 'report' : 'chart',
                    displaySettings: {
                        ...DEFAULT_DISPLAY_SETTINGS,
                        ...(persisted.displaySettings ?? {}),
                    },
                };
            },
        }
    )
);

function columnarLength(value: unknown): number {
    if (!value || typeof value !== 'object') return 0;
    const timeSec = (value as { timeSec?: { length?: unknown } }).timeSec;
    const length = Number(timeSec?.length);
    return Number.isFinite(length) ? length : 0;
}

export function getComparisonDiagnosticsStats(): ComparisonDiagnosticsStats {
    const state = useComparisonStore.getState();
    let rawCount = 0;
    let columnarCount = 0;
    let dbRawCount = 0;
    let dbColumnarCount = 0;

    for (const exp of state.experiments) {
        const id = typeof exp.id === 'string' ? exp.id : '';
        const isDb = !id.startsWith('file-');
        const hasRaw = Array.isArray(exp.rawPoints) && exp.rawPoints.length > 0;
        const hasColumnar = columnarLength((exp as Record<string, unknown>).columnarData) > 0;
        if (hasRaw) rawCount += 1;
        if (hasColumnar) columnarCount += 1;
        if (isDb && hasRaw) dbRawCount += 1;
        if (isDb && hasColumnar) dbColumnarCount += 1;
    }

    return {
        experimentCount: state.experiments.length,
        selectedCount: state.experimentIds.length,
        rawCount,
        columnarCount,
        dbRawCount,
        dbColumnarCount,
    };
}

// Expose read-only diagnostics globally; E2E still uses the legacy store hook
// for controlled setup/teardown until those tests move to purpose-built helpers.
if (typeof window !== 'undefined') {
    (window as unknown as {
        __rheolab_comparison_stats?: () => ComparisonDiagnosticsStats;
        __rheolab_comparison_store?: typeof useComparisonStore;
    }).__rheolab_comparison_stats = getComparisonDiagnosticsStats;
    (window as unknown as {
        __rheolab_comparison_store?: typeof useComparisonStore;
    }).__rheolab_comparison_store = useComparisonStore;
}

// Subscribe to license deactivation — clear comparison on license change.
// This replaces the former circular dynamic import from license-store.
licenseEvents.on('license-deactivated', () => useComparisonStore.getState().clear());
