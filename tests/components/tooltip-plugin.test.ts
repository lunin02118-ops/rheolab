// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type uPlot from 'uplot';
import { tooltipPlugin } from '@/components/charts/plugins/tooltip';

function createFakePlot() {
    const root = document.createElement('div');
    root.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 320,
        bottom: 180,
        width: 320,
        height: 180,
        toJSON: () => ({}),
    });

    document.body.appendChild(root);

    return {
        root,
        cursor: { left: 24, top: 18, idx: 0 },
        data: [[1], [42]],
        series: [
            { label: 'Time' },
            { label: 'Viscosity', stroke: '#60a5fa', show: true },
        ],
    } as unknown as uPlot;
}

describe('tooltipPlugin', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        delete (window as Window & { __tooltipXss?: boolean }).__tooltipXss;
    });

    it('treats custom string content as text instead of raw HTML', () => {
        const plugin = tooltipPlugin({
            renderTooltip: () => '<img src=x onerror="window.__tooltipXss = true">unsafe',
        });
        const plot = createFakePlot();

        (plugin.hooks?.init as ((u: uPlot) => void) | undefined)?.(plot);
        (plugin.hooks?.setCursor as ((u: uPlot) => void) | undefined)?.(plot);

        const tooltip = document.querySelector('[data-uplot-tooltip-id]') as HTMLDivElement | null;
        expect(tooltip?.textContent).toContain('<img src=x onerror="window.__tooltipXss = true">unsafe');
        expect(tooltip?.querySelector('img')).toBeNull();
        expect((window as Window & { __tooltipXss?: boolean }).__tooltipXss).toBeUndefined();

        (plugin.hooks?.destroy as (() => void) | undefined)?.();
    });

    it('allows callers to provide DOM nodes for rich tooltip content', () => {
        const plugin = tooltipPlugin({
            renderTooltip: () => {
                const badge = document.createElement('strong');
                badge.textContent = 'Safe node';
                return badge;
            },
        });
        const plot = createFakePlot();

        (plugin.hooks?.init as ((u: uPlot) => void) | undefined)?.(plot);
        (plugin.hooks?.setCursor as ((u: uPlot) => void) | undefined)?.(plot);

        const tooltip = document.querySelector('[data-uplot-tooltip-id]') as HTMLDivElement | null;
        expect(tooltip?.querySelector('strong')?.textContent).toBe('Safe node');

        (plugin.hooks?.destroy as (() => void) | undefined)?.();
    });
});
