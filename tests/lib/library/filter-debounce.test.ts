import { describe, expect, it } from 'vitest';
import {
    LIBRARY_FILTER_DEBOUNCE_MS,
    activeExperimentFilterKeys,
    changedExperimentFilterKeys,
    getLibraryFilterDebounceDecision,
} from '@/lib/library/filter-debounce';
import { EMPTY_FILTERS, type ExperimentFilters } from '@/types/experiment-filters';

function filters(patch: Partial<ExperimentFilters>): ExperimentFilters {
    return { ...EMPTY_FILTERS, ...patch };
}

describe('library filter debounce policy', () => {
    it('keeps the initial load debounce unchanged', () => {
        const decision = getLibraryFilterDebounceDecision(EMPTY_FILTERS);

        expect(decision.reason).toBe('initial');
        expect(decision.delayMs).toBe(LIBRARY_FILTER_DEBOUNCE_MS.initial);
        expect(decision.changedKeys).toEqual([]);
    });

    it('keeps text search conservative', () => {
        const decision = getLibraryFilterDebounceDecision(
            filters({ searchQuery: 'Chandler' }),
            ['searchQuery'],
        );

        expect(decision.reason).toBe('text');
        expect(decision.delayMs).toBe(LIBRARY_FILTER_DEBOUNCE_MS.text);
        expect(decision.activeKeys).toEqual(['searchQuery']);
    });

    it('uses a shorter debounce for select-style filters', () => {
        const decision = getLibraryFilterDebounceDecision(
            filters({ fluidType: 'Crosslinked Gel' }),
            ['fluidType'],
        );

        expect(decision.reason).toBe('quick');
        expect(decision.delayMs).toBe(LIBRARY_FILTER_DEBOUNCE_MS.quick);
    });

    it('uses a middle debounce for date and numeric ranges', () => {
        const decision = getLibraryFilterDebounceDecision(
            filters({ dateFrom: '2024-01-01', dateTo: '2025-12-31' }),
            ['dateFrom', 'dateTo'],
        );

        expect(decision.reason).toBe('range');
        expect(decision.delayMs).toBe(LIBRARY_FILTER_DEBOUNCE_MS.range);
    });

    it('uses a short reset debounce without treating it as an initial load', () => {
        const decision = getLibraryFilterDebounceDecision(EMPTY_FILTERS, ['searchQuery', 'fluidType']);

        expect(decision.reason).toBe('reset');
        expect(decision.delayMs).toBe(LIBRARY_FILTER_DEBOUNCE_MS.reset);
    });

    it('gives mixed text/select edits the text debounce', () => {
        const decision = getLibraryFilterDebounceDecision(
            filters({ searchQuery: 'gel', fluidType: 'Crosslinked Gel' }),
            ['fluidType', 'searchQuery'],
        );

        expect(decision.reason).toBe('text');
        expect(decision.delayMs).toBe(LIBRARY_FILTER_DEBOUNCE_MS.text);
        expect(decision.changedKeys).toEqual(['fluidType', 'searchQuery']);
    });

    it('detects active keys and changed keys with array filters', () => {
        const prev = filters({ reagentNames: ['A', 'B'], searchQuery: 'gel' });
        const next = filters({ reagentNames: ['A', 'C'], fluidType: 'Slickwater' });

        expect(activeExperimentFilterKeys(next)).toEqual(['fluidType', 'reagentNames']);
        expect(changedExperimentFilterKeys(prev, next)).toEqual([
            'fluidType',
            'reagentNames',
            'searchQuery',
        ]);
    });
});
