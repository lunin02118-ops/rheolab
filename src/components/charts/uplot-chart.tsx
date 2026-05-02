import React, { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

type UPlotLifecycleEventName =
    | 'create-start'
    | 'create-end'
    | 'set-data-start'
    | 'set-data-end'
    | 'size-start'
    | 'size-end'
    | 'redraw-start'
    | 'redraw-end'
    | 'first-paint'
    | 'destroy-start'
    | 'destroy-end';

interface UPlotLifecycleEvent {
    label: string;
    instanceId: number;
    event: UPlotLifecycleEventName;
    at: number;
    activeInstances: number;
}

interface UPlotLifecycleLabelStats {
    activeInstances: number;
    maxActiveInstances: number;
    createCount: number;
    destroyCount: number;
    setDataCount: number;
    sizeCount: number;
    redrawCount: number;
    firstPaintCount: number;
}

interface UPlotLifecycleState {
    nextInstanceId: number;
    active: Record<number, string>;
    maxActiveByLabel: Record<string, number>;
    events: UPlotLifecycleEvent[];
    stats: () => Record<string, UPlotLifecycleLabelStats>;
}

declare global {
    interface Window {
        __rheolab_uplot_lifecycle?: UPlotLifecycleState;
    }
}

const MAX_LIFECYCLE_EVENTS = 300;

function lifecycleNow(): number {
    return typeof performance !== 'undefined' ? Math.round(performance.now() * 100) / 100 : Date.now();
}

function lifecycleState(): UPlotLifecycleState | null {
    if (typeof window === 'undefined') return null;
    if (!window.__rheolab_uplot_lifecycle) {
        const state: UPlotLifecycleState = {
            nextInstanceId: 0,
            active: {},
            maxActiveByLabel: {},
            events: [],
            stats: () => {
                const out: Record<string, UPlotLifecycleLabelStats> = {};
                const ensure = (label: string): UPlotLifecycleLabelStats => {
                    out[label] ??= {
                        activeInstances: Object.values(state.active).filter(value => value === label).length,
                        maxActiveInstances: state.maxActiveByLabel[label] ?? 0,
                        createCount: 0,
                        destroyCount: 0,
                        setDataCount: 0,
                        sizeCount: 0,
                        redrawCount: 0,
                        firstPaintCount: 0,
                    };
                    return out[label];
                };

                for (const label of Object.values(state.active)) {
                    ensure(label);
                }
                for (const label of Object.keys(state.maxActiveByLabel)) {
                    ensure(label);
                }
                for (const event of state.events) {
                    const stats = ensure(event.label);
                    if (event.event === 'create-end') stats.createCount += 1;
                    if (event.event === 'destroy-end') stats.destroyCount += 1;
                    if (event.event === 'set-data-end') stats.setDataCount += 1;
                    if (event.event === 'size-end') stats.sizeCount += 1;
                    if (event.event === 'redraw-end') stats.redrawCount += 1;
                    if (event.event === 'first-paint') stats.firstPaintCount += 1;
                }
                return out;
            },
        };
        window.__rheolab_uplot_lifecycle = state;
    }
    return window.__rheolab_uplot_lifecycle;
}

function allocateLifecycleInstance(): number {
    const state = lifecycleState();
    if (!state) return 0;
    state.nextInstanceId += 1;
    return state.nextInstanceId;
}

function activeCountForLabel(state: UPlotLifecycleState, label: string): number {
    return Object.values(state.active).filter(value => value === label).length;
}

function recordLifecycleEvent(
    label: string | undefined,
    instanceId: number,
    event: UPlotLifecycleEventName,
): void {
    if (!label) return;
    const state = lifecycleState();
    if (!state) return;

    if (event === 'create-end') {
        state.active[instanceId] = label;
        const activeCount = activeCountForLabel(state, label);
        state.maxActiveByLabel[label] = Math.max(state.maxActiveByLabel[label] ?? 0, activeCount);
    }
    if (event === 'destroy-end') {
        delete state.active[instanceId];
    }

    state.events.push({
        label,
        instanceId,
        event,
        at: lifecycleNow(),
        activeInstances: activeCountForLabel(state, label),
    });
    if (state.events.length > MAX_LIFECYCLE_EVENTS) {
        state.events.splice(0, state.events.length - MAX_LIFECYCLE_EVENTS);
    }
}

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
    /** Optional read-only diagnostics label for perf smoke lifecycle counters. */
    diagnosticsLabel?: string;
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
    diagnosticsLabel,
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
        let firstPaintRaf = 0;
        let secondPaintRaf = 0;
        const lifecycleInstanceId = diagnosticsLabel ? allocateLifecycleInstance() : 0;
        // Snapshot tooltip IDs BEFORE creating the chart — they are embedded
        // in the plugins array by tooltipPlugin() and won't change later.
        const tooltipIds = collectTooltipIds(options.plugins);

        try {
            recordLifecycleEvent(diagnosticsLabel, lifecycleInstanceId, 'create-start');
            performance.mark('uplot:init:start');
            chart = new uPlot(options, dataRef.current, containerRef.current);
            performance.mark('uplot:init:end');
            try { performance.measure('uplot:init', 'uplot:init:start', 'uplot:init:end'); } catch (_e) { /* ignore */ }
            chartRef.current = chart;
            recordLifecycleEvent(diagnosticsLabel, lifecycleInstanceId, 'create-end');

            // After creation, immediately apply the correct container size.
            // The options contain dummy width/height (100×100); the real size
            // comes from the parent via props.  Without this, chart recreation
            // (e.g. when series count changes) leaves the chart at 100×100
            // because the [width, height] effect below won't re-fire if the
            // container dimensions haven't changed.
            const w = sizeRef.current.width;
            const h = sizeRef.current.height;
            if (w !== undefined && h !== undefined) {
                recordLifecycleEvent(diagnosticsLabel, lifecycleInstanceId, 'size-start');
                chart.setSize({ width: w, height: h });
                recordLifecycleEvent(diagnosticsLabel, lifecycleInstanceId, 'size-end');
            }

            // Use the ref so we always call the latest onInit even if the prop
            // changed between renders without options changing.
            onInitRef.current?.(chart);
            firstPaintRaf = requestAnimationFrame(() => {
                secondPaintRaf = requestAnimationFrame(() => {
                    recordLifecycleEvent(diagnosticsLabel, lifecycleInstanceId, 'first-paint');
                });
            });
        } catch (err) {
            console.error('[UPlotChart] Failed to create uPlot instance:', err);
            chartRef.current = null;
        }

        return () => {
            if (firstPaintRaf) cancelAnimationFrame(firstPaintRaf);
            if (secondPaintRaf) cancelAnimationFrame(secondPaintRaf);
            if (chart) {
                recordLifecycleEvent(diagnosticsLabel, lifecycleInstanceId, 'destroy-start');
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
                } finally {
                    recordLifecycleEvent(diagnosticsLabel, lifecycleInstanceId, 'destroy-end');
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
         
    }, [diagnosticsLabel, options]); // Do NOT add width/height here — handled by setSize below

    // Update data in-place without triggering chart recreation
    useEffect(() => {
        if (chartRef.current) {
            recordLifecycleEvent(diagnosticsLabel, 0, 'set-data-start');
            chartRef.current.setData(data, resetScalesOnDataChange);
            recordLifecycleEvent(diagnosticsLabel, 0, 'set-data-end');
        }
    }, [data, diagnosticsLabel, resetScalesOnDataChange]);

    // Apply size changes via setSize — much cheaper than full recreation
    useEffect(() => {
        if (chartRef.current && width !== undefined && height !== undefined) {
            recordLifecycleEvent(diagnosticsLabel, 0, 'size-start');
            chartRef.current.setSize({ width, height });
            recordLifecycleEvent(diagnosticsLabel, 0, 'size-end');
        }
    }, [diagnosticsLabel, width, height]);

    // Force plugin-overlay repaint when caller signals a change (e.g. touch-point
    // settings update) without recreating the chart or re-running setData.
    useEffect(() => {
        if (chartRef.current) {
            recordLifecycleEvent(diagnosticsLabel, 0, 'redraw-start');
            chartRef.current.redraw(false);
            recordLifecycleEvent(diagnosticsLabel, 0, 'redraw-end');
        }
     
    }, [diagnosticsLabel, redrawTrigger]);

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
