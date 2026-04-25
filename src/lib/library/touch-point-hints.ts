import type { TouchPointLibraryStats } from '@/types/tauri';

/**
 * Touch-point hint text generator for the library filter sidebar.
 *
 * The `SELECT MIN/MAX` aggregate on the Rust side produces `null` when
 * no row has a value for the column (e.g. no experiment has crossed the
 * library threshold yet).  The UI surfaces this explicitly so users
 * understand why a "50..500 сП" filter is quietly hiding everything.
 *
 * Kept as pure functions (no React, no hooks) so they're trivial to
 * unit-test in Vitest without a DOM.
 */

/** Format a cP value to at most one decimal — trims trailing zeros. */
function formatCp(value: number): string {
    return value.toFixed(1).replace(/\.0$/, '');
}

/** Format a minutes value — 2 decimals when <10 min, 1 decimal otherwise. */
function formatMinutes(value: number): string {
    const digits = value < 10 ? 2 : 1;
    return value.toFixed(digits).replace(/\.?0+$/, '');
}

/**
 * Produce the caption under the `hasCrossing` selector:
 * `"1 из 220 эксп. достигли порога"` / `"Пока нет данных"`.
 * Returns `null` when the library is empty so the label is suppressed.
 */
export function crossingCoverageHint(
    stats: TouchPointLibraryStats | null,
): string | null {
    if (!stats || stats.totalExperiments === 0) {
        return null;
    }
    return `${stats.withCrossingCount} из ${stats.totalExperiments} эксп. достигли порога`;
}

/**
 * Caption for the `crossingTime` range filter.  Returns
 *   * `"в БД: 0.02..9.4 мин"` when at least one row has a crossing
 *   * `"в БД: нет данных"` when every row is above the threshold
 *   * `null` on an empty library
 */
export function crossingTimeHint(
    stats: TouchPointLibraryStats | null,
): string | null {
    if (!stats || stats.totalExperiments === 0) return null;

    if (
        stats.crossingTimeMinMinutes == null ||
        stats.crossingTimeMaxMinutes == null
    ) {
        return 'в БД: нет данных';
    }

    const lo = formatMinutes(stats.crossingTimeMinMinutes);
    const hi = formatMinutes(stats.crossingTimeMaxMinutes);
    return lo === hi
        ? `в БД: ${lo} мин`
        : `в БД: ${lo}..${hi} мин`;
}

/** Caption for the `crossingViscosity` range filter. */
export function crossingViscosityHint(
    stats: TouchPointLibraryStats | null,
): string | null {
    if (!stats || stats.totalExperiments === 0) return null;

    if (
        stats.crossingViscosityMinCp == null ||
        stats.crossingViscosityMaxCp == null
    ) {
        return 'в БД: нет данных';
    }

    const lo = formatCp(stats.crossingViscosityMinCp);
    const hi = formatCp(stats.crossingViscosityMaxCp);
    return lo === hi
        ? `в БД: ${lo} сП`
        : `в БД: ${lo}..${hi} сП`;
}

/** Caption for the `viscosityAtTarget` range filter. */
export function viscosityAtTargetHint(
    stats: TouchPointLibraryStats | null,
): string | null {
    if (!stats || stats.totalExperiments === 0) return null;

    if (
        stats.viscosityAtTargetMinCp == null ||
        stats.viscosityAtTargetMaxCp == null
    ) {
        return 'в БД: нет данных';
    }

    const lo = formatCp(stats.viscosityAtTargetMinCp);
    const hi = formatCp(stats.viscosityAtTargetMaxCp);
    return lo === hi
        ? `в БД: ${lo} сП`
        : `в БД: ${lo}..${hi} сП`;
}

/**
 * Long-form empty-state message for when a touch-point RANGE filter is
 * active and the result set is empty.
 *
 * Example output (for a 220-row library with 1 crossing):
 * > Из 220 эксп. только 1 достиг порога 50 сП. Остальные исключаются
 * > диапазонными фильтрами точки касания. Доступный диапазон — время:
 * > 9.4 мин, вязкость: 37.8 сП. Снимите или расширьте touch-point фильтры.
 *
 * Returns `null` when the library is empty — nothing useful to say
 * beyond the generic "ничего не найдено" above it.
 */
export function touchPointEmptyStateMessage(
    stats: TouchPointLibraryStats | null,
): string | null {
    if (!stats || stats.totalExperiments === 0) return null;

    const total = stats.totalExperiments;
    const withCrossing = stats.withCrossingCount;

    const parts: string[] = [];
    parts.push(
        `Из ${total} эксп. только ${withCrossing} достигли порога 50 сП.`,
    );
    parts.push('Остальные исключаются диапазонными фильтрами точки касания.');

    const range = (hint: string | null, label: string): string | null => {
        if (!hint || hint === 'в БД: нет данных') return null;
        return `${label}: ${hint.replace(/^в БД:\s*/, '')}`;
    };

    const ranges = [
        range(crossingTimeHint(stats), 'время'),
        range(crossingViscosityHint(stats), 'вязкость'),
    ].filter((v): v is string => v !== null);

    if (ranges.length > 0) {
        parts.push(`Доступный диапазон — ${ranges.join(', ')}.`);
    }

    parts.push('Снимите или расширьте touch-point фильтры.');

    return parts.join(' ');
}
