import { describe, it, expect } from 'vitest';
import type { TouchPointLibraryStats } from '@/types/tauri';
import {
    crossingCoverageHint,
    crossingTimeHint,
    crossingViscosityHint,
    viscosityAtTargetHint,
    touchPointEmptyStateMessage,
} from '@/lib/library/touch-point-hints';

/**
 * These formatters feed the library-filter sidebar and the 0-result
 * empty state.  They're pure (no React, no IO) so the coverage here is
 * narrow but exhaustive — every branch of "library empty / no crossings
 * / actual range" is pinned down to avoid silent copy changes that would
 * reintroduce the "why is my filter broken?" UX bug.
 */

const EMPTY_STATS: TouchPointLibraryStats = {
    totalExperiments: 0,
    withCrossingCount: 0,
    withTargetViscosityCount: 0,
    crossingTimeMinMinutes: null,
    crossingTimeMaxMinutes: null,
    crossingViscosityMinCp: null,
    crossingViscosityMaxCp: null,
    viscosityAtTargetMinCp: null,
    viscosityAtTargetMaxCp: null,
};

const LIBRARY_NO_CROSSINGS: TouchPointLibraryStats = {
    ...EMPTY_STATS,
    totalExperiments: 50,
    withCrossingCount: 0,
    withTargetViscosityCount: 48,
    viscosityAtTargetMinCp: 120.0,
    viscosityAtTargetMaxCp: 980.5,
};

const LIBRARY_ONE_CROSSING: TouchPointLibraryStats = {
    totalExperiments: 220,
    withCrossingCount: 1,
    withTargetViscosityCount: 217,
    crossingTimeMinMinutes: 0.016,
    crossingTimeMaxMinutes: 0.016,
    crossingViscosityMinCp: 37.77,
    crossingViscosityMaxCp: 37.77,
    viscosityAtTargetMinCp: 44.17,
    viscosityAtTargetMaxCp: 1386.19,
};

const LIBRARY_MANY_CROSSINGS: TouchPointLibraryStats = {
    totalExperiments: 30,
    withCrossingCount: 12,
    withTargetViscosityCount: 30,
    crossingTimeMinMinutes: 2.5,
    crossingTimeMaxMinutes: 9.4,
    crossingViscosityMinCp: 48.2,
    crossingViscosityMaxCp: 49.9,
    viscosityAtTargetMinCp: 20.0,
    viscosityAtTargetMaxCp: 150.0,
};

describe('crossingCoverageHint', () => {
    it('returns null when stats are missing', () => {
        expect(crossingCoverageHint(null)).toBeNull();
    });

    it('returns null when the library is empty', () => {
        expect(crossingCoverageHint(EMPTY_STATS)).toBeNull();
    });

    it('reports crossing count versus total', () => {
        expect(crossingCoverageHint(LIBRARY_ONE_CROSSING)).toBe(
            '1 из 220 эксп. достигли порога',
        );
        expect(crossingCoverageHint(LIBRARY_MANY_CROSSINGS)).toBe(
            '12 из 30 эксп. достигли порога',
        );
    });

    it('reports zero-of-N when no crossing exists', () => {
        expect(crossingCoverageHint(LIBRARY_NO_CROSSINGS)).toBe(
            '0 из 50 эксп. достигли порога',
        );
    });
});

describe('crossingTimeHint', () => {
    it('returns null on empty library', () => {
        expect(crossingTimeHint(null)).toBeNull();
        expect(crossingTimeHint(EMPTY_STATS)).toBeNull();
    });

    it('reports "нет данных" when no row has a crossing', () => {
        expect(crossingTimeHint(LIBRARY_NO_CROSSINGS)).toBe('в БД: нет данных');
    });

    it('collapses min == max to a single value', () => {
        expect(crossingTimeHint(LIBRARY_ONE_CROSSING)).toBe('в БД: 0.02 мин');
    });

    it('formats a real range with one decimal when values exceed 10', () => {
        expect(crossingTimeHint(LIBRARY_MANY_CROSSINGS)).toBe(
            'в БД: 2.5..9.4 мин',
        );
    });
});

describe('crossingViscosityHint', () => {
    it('returns null on empty library', () => {
        expect(crossingViscosityHint(null)).toBeNull();
        expect(crossingViscosityHint(EMPTY_STATS)).toBeNull();
    });

    it('reports "нет данных" when no crossing exists', () => {
        expect(crossingViscosityHint(LIBRARY_NO_CROSSINGS)).toBe(
            'в БД: нет данных',
        );
    });

    it('collapses min == max to a single value', () => {
        expect(crossingViscosityHint(LIBRARY_ONE_CROSSING)).toBe(
            'в БД: 37.8 сП',
        );
    });

    it('formats a real range with one decimal', () => {
        expect(crossingViscosityHint(LIBRARY_MANY_CROSSINGS)).toBe(
            'в БД: 48.2..49.9 сП',
        );
    });
});

describe('viscosityAtTargetHint', () => {
    it('returns null on empty library', () => {
        expect(viscosityAtTargetHint(EMPTY_STATS)).toBeNull();
    });

    it('reports the target-time range even when no row has a crossing', () => {
        // target-time viscosity is independent of the crossing — it's always
        // populated whenever the experiment extends past 10 min.
        expect(viscosityAtTargetHint(LIBRARY_NO_CROSSINGS)).toBe(
            'в БД: 120..980.5 сП',
        );
    });
});

describe('touchPointEmptyStateMessage', () => {
    it('returns null on empty library', () => {
        expect(touchPointEmptyStateMessage(null)).toBeNull();
        expect(touchPointEmptyStateMessage(EMPTY_STATS)).toBeNull();
    });

    it('leads with the total / with-crossing ratio', () => {
        const msg = touchPointEmptyStateMessage(LIBRARY_ONE_CROSSING) ?? '';
        expect(msg).toContain('Из 220 эксп.');
        expect(msg).toContain('только 1 достигли порога 50 сП');
    });

    it('includes the observed time and viscosity ranges when available', () => {
        const msg = touchPointEmptyStateMessage(LIBRARY_MANY_CROSSINGS) ?? '';
        expect(msg).toContain('время: 2.5..9.4 мин');
        expect(msg).toContain('вязкость: 48.2..49.9 сП');
    });

    it('omits the range sentence when no crossings exist', () => {
        const msg = touchPointEmptyStateMessage(LIBRARY_NO_CROSSINGS) ?? '';
        // Leading / trailing parts must still render.
        expect(msg).toContain('Из 50 эксп.');
        expect(msg).toContain('Снимите или расширьте touch-point фильтры.');
        // No crossing range → the "доступный диапазон" sentence is dropped.
        expect(msg).not.toContain('Доступный диапазон');
    });

    it('closes with actionable guidance', () => {
        const msg = touchPointEmptyStateMessage(LIBRARY_ONE_CROSSING) ?? '';
        expect(msg.endsWith('Снимите или расширьте touch-point фильтры.')).toBe(
            true,
        );
    });
});
