/**
 * Time and unit formatters for rheology charts.
 *
 * Pure functions — no DOM, no state, no i18n lookup here.
 * All input times are in minutes (internal chart unit).
 */
import type { PressureUnit, TimeDisplayFormat } from '@/lib/store/chart-settings-types';

/**
 * Format a time value (minutes) into a tick label according to the
 * configured display format.
 */
export function formatTimeTick(minVal: number, timeFmt: TimeDisplayFormat): string {
    switch (timeFmt) {
        case 'seconds':
            return String(Math.round(minVal * 60));
        case 'hh:mm:ss': {
            const totalSec = Math.round(minVal * 60);
            const h = Math.floor(totalSec / 3600);
            const m = Math.floor((totalSec % 3600) / 60);
            const s = totalSec % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        default:
            return String(Math.round(minVal * 10) / 10);
    }
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
