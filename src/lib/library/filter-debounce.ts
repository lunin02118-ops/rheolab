import type { ExperimentFilters } from '@/types/experiment-filters';
import { EMPTY_FILTERS } from '@/types/experiment-filters';

export type ExperimentFilterKey = keyof ExperimentFilters;

export type LibraryFilterDebounceReason =
    | 'initial'
    | 'reset'
    | 'text'
    | 'range'
    | 'quick';

export interface LibraryFilterDebounceDecision {
    delayMs: number;
    reason: LibraryFilterDebounceReason;
    activeKeys: ExperimentFilterKey[];
    changedKeys: ExperimentFilterKey[];
}

export const LIBRARY_FILTER_DEBOUNCE_MS = {
    initial: 200,
    text: 175,
    range: 125,
    quick: 50,
    reset: 50,
} as const satisfies Record<LibraryFilterDebounceReason, number>;

const EXPERIMENT_FILTER_KEYS = Object.keys(EMPTY_FILTERS) as ExperimentFilterKey[];

const TEXT_FILTER_KEYS = new Set<ExperimentFilterKey>([
    'searchQuery',
    'testName',
    'laboratoryName',
    'fieldName',
    'operatorName',
    'wellNumber',
    'waterSource',
    'batchNumber',
]);

const RANGE_FILTER_KEYS = new Set<ExperimentFilterKey>([
    'dateFrom',
    'dateTo',
    'durationMin',
    'durationMax',
    'tempMin',
    'tempMax',
    'viscosityMin',
    'viscosityMax',
    'viscosityThreshold',
    'crossingTimeMin',
    'crossingTimeMax',
    'viscosityAtTargetMin',
    'viscosityAtTargetMax',
]);

function isEmptyFilterValue(value: ExperimentFilters[ExperimentFilterKey]): boolean {
    return Array.isArray(value) ? value.length === 0 : value === '' || value === undefined;
}

function sameFilterValue(
    prev: ExperimentFilters[ExperimentFilterKey],
    next: ExperimentFilters[ExperimentFilterKey],
): boolean {
    if (Array.isArray(prev) || Array.isArray(next)) {
        const a = Array.isArray(prev) ? prev : [];
        const b = Array.isArray(next) ? next : [];
        return a.length === b.length && a.every((value, index) => value === b[index]);
    }
    return (prev ?? '') === (next ?? '');
}

export function activeExperimentFilterKeys(filters: ExperimentFilters): ExperimentFilterKey[] {
    return EXPERIMENT_FILTER_KEYS
        .filter((key) => !isEmptyFilterValue(filters[key]))
        .sort();
}

export function changedExperimentFilterKeys(
    prev: ExperimentFilters,
    next: ExperimentFilters,
): ExperimentFilterKey[] {
    return EXPERIMENT_FILTER_KEYS
        .filter((key) => !sameFilterValue(prev[key], next[key]))
        .sort();
}

export function getLibraryFilterDebounceDecision(
    filters: ExperimentFilters,
    changedKeys: readonly ExperimentFilterKey[] = [],
): LibraryFilterDebounceDecision {
    const activeKeys = activeExperimentFilterKeys(filters);
    const normalizedChangedKeys = [...new Set(changedKeys)].sort();

    if (normalizedChangedKeys.length === 0) {
        return {
            delayMs: LIBRARY_FILTER_DEBOUNCE_MS.initial,
            reason: 'initial',
            activeKeys,
            changedKeys: [],
        };
    }

    if (activeKeys.length === 0) {
        return {
            delayMs: LIBRARY_FILTER_DEBOUNCE_MS.reset,
            reason: 'reset',
            activeKeys,
            changedKeys: normalizedChangedKeys,
        };
    }

    if (normalizedChangedKeys.some((key) => TEXT_FILTER_KEYS.has(key))) {
        return {
            delayMs: LIBRARY_FILTER_DEBOUNCE_MS.text,
            reason: 'text',
            activeKeys,
            changedKeys: normalizedChangedKeys,
        };
    }

    if (normalizedChangedKeys.some((key) => RANGE_FILTER_KEYS.has(key))) {
        return {
            delayMs: LIBRARY_FILTER_DEBOUNCE_MS.range,
            reason: 'range',
            activeKeys,
            changedKeys: normalizedChangedKeys,
        };
    }

    return {
        delayMs: LIBRARY_FILTER_DEBOUNCE_MS.quick,
        reason: 'quick',
        activeKeys,
        changedKeys: normalizedChangedKeys,
    };
}
