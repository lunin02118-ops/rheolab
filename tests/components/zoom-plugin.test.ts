// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type uPlot from 'uplot';
import { zoomPlugin } from '@/components/charts/plugins/zoom';

type UPlotLike = uPlot & {
    root: HTMLElement;
    data: [number[]];
    scales: { x: { min?: number; max?: number } };
    setScale: ReturnType<typeof vi.fn>;
    setSelect: ReturnType<typeof vi.fn>;
    select: { left: number; top: number; width: number; height: number };
    posToVal: (pos: number, scale: string) => number;
};

function makeUPlotLike(): UPlotLike {
    const u = {
        root: document.createElement('div'),
        data: [[0, 1, 2]],
        scales: { x: { min: 0.5, max: 1.5 } },
        select: { left: 0, top: 0, width: 0, height: 0 },
        setSelect: vi.fn(),
        setScale: vi.fn((_scale: string, range: { min: number; max: number }) => {
            u.scales.x.min = range.min;
            u.scales.x.max = range.max;
        }),
        posToVal: (pos: number) => pos / 100,
    };
    return u as unknown as UPlotLike;
}

function callHook(plugin: uPlot.Plugin, name: 'init' | 'setSelect' | 'destroy', u: uPlot): void {
    const hook = plugin.hooks?.[name] as ((plot: uPlot) => void) | Array<(plot: uPlot) => void> | undefined;
    if (Array.isArray(hook)) {
        hook.forEach(fn => fn(u));
    } else {
        hook?.(u);
    }
}

describe('zoomPlugin', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('resets external viewport zoom on double click even without plugin-owned zoom state', () => {
        const onReset = vi.fn();
        const plugin = zoomPlugin({ onReset });
        const u = makeUPlotLike();

        callHook(plugin, 'init', u);
        u.root.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

        expect(u.setScale).toHaveBeenCalledWith('x', { min: 0, max: 2 });
        expect(onReset).toHaveBeenCalledTimes(1);
    });

    it('still resets to the pre-selection bounds after plugin-owned zoom', () => {
        const onZoom = vi.fn();
        const onReset = vi.fn();
        const plugin = zoomPlugin({ onZoom, onReset });
        const u = makeUPlotLike();

        callHook(plugin, 'init', u);
        u.select = { left: 60, top: 0, width: 60, height: 0 };
        callHook(plugin, 'setSelect', u);
        u.root.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

        expect(onZoom).toHaveBeenCalledWith(0.6, 1.2);
        expect(u.setScale).toHaveBeenLastCalledWith('x', { min: 0.5, max: 1.5 });
        expect(onReset).toHaveBeenCalledTimes(1);
    });
});
