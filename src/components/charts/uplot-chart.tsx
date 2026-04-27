import React, { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

/**
 * Collect tooltip instance IDs from the plugins array so the cleanup
 * effect can do a targeted safety-net removal of body-appended tooltips
 * even if `chart.destroy()` partially fails or a plugin hook throws.
 */
function collectTooltipIds(plugins: uPlot.Plugin[] | undefined): string[] {
    if (!plugins) return [];
    const ids: string[] = [];
    for (const p of plugins) {
        const id = (p as { tooltipInstanceId?: string }).tooltipInstanceId;
        if (id) ids.push(id);
    }
    return ids;
}

export interface UPlotChartProps {
    options: uPlot.Options;
    data: uPlot.AlignedData;
    /**
     * Forwarded to uPlot#setData(data, resetScales). Keep `true` by default
     * so charts auto-range naturally; callers with external zoom state can set
     * `false` while zoom is active to prevent x-range snapback.
     */
    resetScalesOnDataChange?: boolean;
    width?: number;
    height?: number;
    className?: string;
    /** Accessible label for the chart region. Shown to screen readers. */
    ariaLabel?: string;
    /** Called after every uPlot instance creation with the live instance.
     *  Useful for imperative access (e.g. ChartBrush calling setScale).
     *  Always receives the freshest instance even if options change. */
    onInit?: (u: uPlot) => void;
    /**
     * When this value changes identity (reference or primitive), calls
     * `u.redraw(false)` on the existing chart without recreating it.
     * Use this to force plugin-only overlay repaints (e.g. touch-point markers)
     * when the underlying series data hasn't changed.
     */
    redrawTrigger?: unknown;
}

export const UPlotChart: React.FC<UPlotChartProps> = ({
    options,
    data,
    resetScalesOnDataChange = true,
    width,
    height,
    className,
    ariaLabel,
    onInit,
    redrawTrigger,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<uPlot | null>(null);
    // Refs to the latest data, size, and onInit callback so the chart-
    // creation effect always reads fresh values without needing them as
    // deps (which would cause unnecessary chart recreation on every render).
    const dataRef = useRef<uPlot.AlignedData>(data);
    const sizeRef = useRef<{ width?: number; height?: number }>({ width, height });
    const onInitRef = useRef<((u: uPlot) => void) | undefined>(onInit);

    // Flush the latest values into the refs after every render.  Effects
    // run in declaration order, so this flush completes before the
    // structural chart-creation effect below executes (when its `options`
    // dep changes), preserving the original "always fresh values" guarantee
    // without writing to refs during render (which the new react-hooks/refs
    // rule flags as a side effect).
    useEffect(() => {
        dataRef.current = data;
        sizeRef.current = { width, height };
        onInitRef.current = onInit;
    });

    // Initialize and destroy chart when structural options change.
    // Size changes are handled separately via setSize to avoid full recreation.
    useEffect(() => {
        if (!containerRef.current) return;

        let chart: uPlot | null = null;
        // Snapshot tooltip IDs BEFORE creating the chart — they are embedded
        // in the plugins array by tooltipPlugin() and won't change later.
        const tooltipIds = collectTooltipIds(options.plugins);

        try {
            performance.mark('uplot:init:start');
            chart = new uPlot(options, dataRef.current, containerRef.current);
            performance.mark('uplot:init:end');
            try { performance.measure('uplot:init', 'uplot:init:start', 'uplot:init:end'); } catch (_e) { /* ignore */ }
            chartRef.current = chart;

            // After creation, immediately apply the correct container size.
            // The options contain dummy width/height (100×100); the real size
            // comes from the parent via props.  Without this, chart recreation
            // (e.g. when series count changes) leaves the chart at 100×100
            // because the [width, height] effect below won't re-fire if the
            // container dimensions haven't changed.
            const w = sizeRef.current.width;
            const h = sizeRef.current.height;
            if (w !== undefined && h !== undefined) {
                chart.setSize({ width: w, height: h });
            }

            // Use the ref so we always call the latest onInit even if the prop
            // changed between renders without options changing.
            onInitRef.current?.(chart);
        } catch (err) {
            console.error('[UPlotChart] Failed to create uPlot instance:', err);
            chartRef.current = null;
        }

        return () => {
            if (chart) {
                try {
                    // Zero out canvas dimensions before destroy() to immediately
                    // release the GPU texture backing store. Without this, the GPU
                    // process holds the texture allocation until the next GC cycle.
                    const canvas = chart.ctx?.canvas;
                    if (canvas) {
                        canvas.width = 0;
                        canvas.height = 0;
                    }
                    chart.destroy();
                } catch (err) {
                    console.warn('[UPlotChart] chart.destroy() error:', err);
                }
                // Break the closure reference so the uPlot instance (and all
                // its internal DOM nodes) can be GC'd even if React's fiber
                // alternate tree retains this cleanup function.
                chart = null;
            }
            chartRef.current = null;

            // Prevent PerformanceEntry accumulation across chart recreations.
            try {
                performance.clearMarks('uplot:init:start');
                performance.clearMarks('uplot:init:end');
                performance.clearMeasures('uplot:init');
            } catch { /* ignore in non-browser */ }

            // Safety-net: remove any orphaned tooltips that survived destroy().
            // This handles edge cases where a plugin destroy hook throws, the
            // chart was mid-initialisation, or React unmounts during animation.
            for (const id of tooltipIds) {
                const orphan = document.querySelector(`.uplot-tooltip[data-uplot-tooltip-id="${id}"]`);
                if (orphan) {
                    orphan.remove();
                }
            }
        };
         
    }, [options]); // Do NOT add width/height here — handled by setSize below

    // Update data in-place without triggering chart recreation
    useEffect(() => {
        if (chartRef.current) {
            chartRef.current.setData(data, resetScalesOnDataChange);
        }
    }, [data, resetScalesOnDataChange]);

    // Apply size changes via setSize — much cheaper than full recreation
    useEffect(() => {
        if (chartRef.current && width !== undefined && height !== undefined) {
            chartRef.current.setSize({ width, height });
        }
    }, [width, height]);

    // Force plugin-overlay repaint when caller signals a change (e.g. touch-point
    // settings update) without recreating the chart or re-running setData.
    useEffect(() => {
        if (chartRef.current) {
            chartRef.current.redraw(false);
        }
     
    }, [redrawTrigger]);

    return (
        <div
            ref={containerRef}
            className={`uplot-container ${className || ''}`}
            style={{ width: '100%', height: '100%' }}
            role="img"
            aria-label={ariaLabel ?? 'Rheology chart'}
            tabIndex={0}
        />
    );
};
