/**
 * Time and unit formatters for rheology charts.
 *
 * Pure functions — no DOM, no state, no i18n lookup here.
 * All input times are in minutes (internal chart unit).
 */
import type uPlot from 'uplot';
import type { PressureUnit, TimeDisplayFormat } from '@/lib/store/chart-settings-types';

/**
 * Round time-step candidates (in minutes) that uPlot is allowed to
 * pick from when it places X-axis ticks.
 *
 * uPlot's default numeric heuristic only offers powers of 10 scaled by
 * 1/2/2.5/5, which produces ticks at awkward 2.5 / 7.5 minute marks
 * for rheology experiments. By supplying an explicit `incrs` list we
 * constrain ticks to wall-clock-friendly steps (1s, 5s, 10s, 15s, 30s,
 * 1min, 2min, 5min, 10min, 15min, 30min, 1h, …).
 *
 * uPlot automatically selects the *largest* step whose rendered label
 * pitch is still ≥ the axis `space` (see TIME_AXIS_MIN_SPACE_PX).
 */
export const TIME_AXIS_INCRS_MINUTES: readonly number[] = Object.freeze([
    // Sub-minute (short experiments or dense sampling)
    1 / 60,   // 1 s
    5 / 60,   // 5 s
    10 / 60,  // 10 s
    15 / 60,  // 15 s
    30 / 60,  // 30 s
    // Minute-scale
    1,
    2,
    5,
    10,
    15,
    20,
    30,
    // Hour-scale
    60,       // 1 h
    120,      // 2 h
    180,      // 3 h
    360,      // 6 h
    720,      // 12 h
    1440,     // 1 d
]);

/**
 * Minimum pixel pitch between two adjacent ticks on the time axis.
 *
 * uPlot's default is 50 px, which visibly overlaps `HH:MM:SS` labels
 * (≈ 58 px wide at 12 px sans-serif). 80 px leaves comfortable room
 * plus a small gutter.
 */
export const TIME_AXIS_MIN_SPACE_PX = 80;

/**
 * Format a time value (minutes) into a tick label according to the
 * configured display format.
 *
 * When `incrMinutes` is supplied (uPlot provides it as the 5th arg of
 * the `values` callback), the formatter adapts:
 *   - `hh:mm:ss` with a whole-minute step → `HH:MM` (drops seconds),
 *   - `hh:mm:ss` with a sub-minute step   → `HH:MM:SS` (full),
 *   - `seconds` stays integer seconds,
 *   - `minutes` keeps at most one decimal and strips trailing `.0`.
 */
export function formatTimeTick(
    minVal: number,
    timeFmt: TimeDisplayFormat,
    incrMinutes?: number,
): string {
    switch (timeFmt) {
        case 'seconds':
            return String(Math.round(minVal * 60));
        case 'hh:mm:ss': {
            const totalSec = Math.round(minVal * 60);
            const h = Math.floor(totalSec / 3600);
            const m = Math.floor((totalSec % 3600) / 60);
            const s = totalSec % 60;
            const hh = String(h).padStart(2, '0');
            const mm = String(m).padStart(2, '0');
            // Drop seconds when the tick step is a whole minute — cleaner,
            // fewer characters, and the information is trivially recoverable.
            const stepIsWholeMinute =
                incrMinutes !== undefined && incrMinutes >= 1 && Number.isInteger(incrMinutes);
            if (stepIsWholeMinute) {
                return `${hh}:${mm}`;
            }
            return `${hh}:${mm}:${String(s).padStart(2, '0')}`;
        }
        default: {
            // 'minutes' — strip trailing .0 so integer minutes read as "5" not "5.0".
            const rounded = Math.round(minVal * 10) / 10;
            return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
        }
    }
}

/**
 * Merge time-axis spacing + incrs + an adaptive value formatter into an
 * existing uPlot axis config. Intended for the `x` axis only; other
 * axes use their own scales and should not call this helper.
 *
 * Always sets `space` and `incrs` so that even the 'minutes' display
 * format picks integer-minute ticks instead of uPlot's default 2.5-minute
 * grid.
 */
export function applyTimeAxisOptions(
    axis: uPlot.Axis,
    timeFmt: TimeDisplayFormat,
): uPlot.Axis {
    return {
        ...axis,
        space: TIME_AXIS_MIN_SPACE_PX,
        incrs: TIME_AXIS_INCRS_MINUTES as number[],
        values: (
            _u: uPlot,
            vals: number[],
            _axisIdx: number,
            _foundSpace: number,
            foundIncr: number,
        ) => vals.map((v) => formatTimeTick(v, timeFmt, foundIncr)),
    };
}

/**
 * Localised time-axis unit (e.g. "min", "мин", "hh:mm:ss").
 */
export function timeAxisUnit(timeFmt: TimeDisplayFormat, lang: string): string {
    switch (timeFmt) {
        case 'seconds':
            return lang === 'en' ? 'sec' : 'с';
        case 'hh:mm:ss':
            return lang === 'en' ? 'hh:mm:ss' : 'чч:мм:сс';
        default:
            return lang === 'en' ? 'min' : 'мин';
    }
}

/**
 * Localised pressure-unit label (e.g. bar → бар in Russian).
 */
export function pressureLabel(unit: PressureUnit, lang: string): string {
    if (lang !== 'ru') return unit;
    switch (unit) {
        case 'bar':
            return 'бар';
        default:
            return unit;
    }
}

/**
 * Parse a CSS `stroke-dasharray` string ("5 3") to an array of numbers.
 */
export function parseDash(dashStr?: string): number[] {
    if (!dashStr) return [];
    return dashStr.split(' ').map(Number);
}

/**
 * Apply opacity to a hex color, producing an `rgba(…)` string when op < 1.
 * Returns the original hex when op >= 1 (uPlot is happy with either).
 */
export function applyOpacity(hex: string, op: number): string {
    if (op >= 1) return hex;
    const h = hex.replace('#', '');
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${op})`;
}
