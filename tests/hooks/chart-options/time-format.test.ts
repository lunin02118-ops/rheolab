import { describe, it, expect } from 'vitest';

import {
    TIME_AXIS_INCRS_MINUTES,
    TIME_AXIS_MIN_SPACE_PX,
    applyTimeAxisOptions,
    formatTimeTick,
} from '@/hooks/chart-options/time-format';

describe('formatTimeTick', () => {
    describe("'seconds' format", () => {
        it('returns rounded integer seconds', () => {
            expect(formatTimeTick(0, 'seconds')).toBe('0');
            expect(formatTimeTick(1, 'seconds')).toBe('60');
            expect(formatTimeTick(0.5, 'seconds')).toBe('30');
            expect(formatTimeTick(1.5, 'seconds')).toBe('90');
        });
    });

    describe("'hh:mm:ss' format", () => {
        it('returns HH:MM:SS with full precision when no incr is supplied', () => {
            expect(formatTimeTick(0, 'hh:mm:ss')).toBe('00:00:00');
            expect(formatTimeTick(1, 'hh:mm:ss')).toBe('00:01:00');
            expect(formatTimeTick(61, 'hh:mm:ss')).toBe('01:01:00');
            expect(formatTimeTick(0.5, 'hh:mm:ss')).toBe('00:00:30');
        });

        it('drops the seconds component when the tick step is a whole minute', () => {
            // Whole-minute steps → HH:MM (cleaner, fewer characters)
            expect(formatTimeTick(0, 'hh:mm:ss', 1)).toBe('00:00');
            expect(formatTimeTick(5, 'hh:mm:ss', 5)).toBe('00:05');
            expect(formatTimeTick(65, 'hh:mm:ss', 5)).toBe('01:05');
            expect(formatTimeTick(120, 'hh:mm:ss', 60)).toBe('02:00');
        });

        it('keeps seconds when the tick step is sub-minute', () => {
            // 30 s step → need seconds to distinguish "00:01:00" from "00:01:30"
            expect(formatTimeTick(1, 'hh:mm:ss', 0.5)).toBe('00:01:00');
            expect(formatTimeTick(1.5, 'hh:mm:ss', 0.5)).toBe('00:01:30');
            // 15 s step (1/4 min) is not a whole minute either
            expect(formatTimeTick(0.25, 'hh:mm:ss', 0.25)).toBe('00:00:15');
        });

        it('keeps seconds when the tick step is a non-integer minute (e.g. 1.5 min)', () => {
            // Non-integer step (2.5 min) → still need seconds, no rounding to HH:MM
            expect(formatTimeTick(2.5, 'hh:mm:ss', 2.5)).toBe('00:02:30');
        });
    });

    describe("'minutes' format", () => {
        it('strips trailing .0 on whole-minute ticks', () => {
            expect(formatTimeTick(0, 'minutes')).toBe('0');
            expect(formatTimeTick(5, 'minutes')).toBe('5');
            expect(formatTimeTick(30, 'minutes')).toBe('30');
        });

        it('keeps one decimal for non-integer minute values', () => {
            expect(formatTimeTick(2.5, 'minutes')).toBe('2.5');
            expect(formatTimeTick(0.3, 'minutes')).toBe('0.3');
        });
    });
});

describe('TIME_AXIS_INCRS_MINUTES', () => {
    it('is strictly increasing', () => {
        for (let i = 1; i < TIME_AXIS_INCRS_MINUTES.length; i++) {
            expect(TIME_AXIS_INCRS_MINUTES[i]).toBeGreaterThan(TIME_AXIS_INCRS_MINUTES[i - 1]);
        }
    });

    it('includes standard wall-clock steps in minutes', () => {
        // Spot-check the main reading landmarks humans expect to see.
        expect(TIME_AXIS_INCRS_MINUTES).toContain(1);   // 1 min
        expect(TIME_AXIS_INCRS_MINUTES).toContain(5);   // 5 min
        expect(TIME_AXIS_INCRS_MINUTES).toContain(10);  // 10 min
        expect(TIME_AXIS_INCRS_MINUTES).toContain(15);  // 15 min
        expect(TIME_AXIS_INCRS_MINUTES).toContain(30);  // 30 min
        expect(TIME_AXIS_INCRS_MINUTES).toContain(60);  // 1 h
    });

    it('excludes the awkward 2.5-minute step that uPlot picks by default', () => {
        // The whole point of the explicit list is to avoid fractional-minute grids.
        expect(TIME_AXIS_INCRS_MINUTES).not.toContain(2.5);
        expect(TIME_AXIS_INCRS_MINUTES).not.toContain(7.5);
    });
});

describe('applyTimeAxisOptions', () => {
    it('sets space to TIME_AXIS_MIN_SPACE_PX (≥ 80 px for HH:MM:SS labels)', () => {
        const axis = applyTimeAxisOptions({ scale: 'x' }, 'hh:mm:ss');
        expect(axis.space).toBe(TIME_AXIS_MIN_SPACE_PX);
        expect(TIME_AXIS_MIN_SPACE_PX).toBeGreaterThanOrEqual(80);
    });

    it('wires our round incrs array', () => {
        const axis = applyTimeAxisOptions({ scale: 'x' }, 'minutes');
        expect(axis.incrs).toEqual([...TIME_AXIS_INCRS_MINUTES]);
    });

    it('preserves caller-supplied axis properties', () => {
        const axis = applyTimeAxisOptions(
            { scale: 'x', label: 'T', stroke: '#fff', labelSize: 20 },
            'seconds',
        );
        expect(axis.scale).toBe('x');
        expect(axis.label).toBe('T');
        expect(axis.stroke).toBe('#fff');
        expect(axis.labelSize).toBe(20);
    });

    it('installs a values callback that routes through formatTimeTick with foundIncr', () => {
        const axis = applyTimeAxisOptions({ scale: 'x' }, 'hh:mm:ss');
        expect(typeof axis.values).toBe('function');

        const values = axis.values as (
            u: unknown,
            vals: number[],
            axisIdx: number,
            foundSpace: number,
            foundIncr: number,
        ) => string[];

        // incr = 5 min → HH:MM
        expect(values(null, [0, 5, 10], 0, 80, 5)).toEqual(['00:00', '00:05', '00:10']);
        // incr = 0.5 min → HH:MM:SS
        expect(values(null, [0, 0.5, 1], 0, 80, 0.5)).toEqual(['00:00:00', '00:00:30', '00:01:00']);
    });
});
