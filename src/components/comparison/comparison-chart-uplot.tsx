import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useTheme } from '@/contexts/theme-context';
import { UPlotChart } from '../charts/uplot-chart';
import { ChartBrush } from '../charts/chart-brush';
import { tooltipPlugin } from '../charts/plugins/tooltip';
import { zoomPlugin } from '../charts/plugins/zoom';
import { touchPointsPlugin } from '../charts/plugins/touchPoints';
import { useChartSettingsStore, timeUnitLabel } from '@/lib/store/chart-settings-store';
import type { TimeDisplayFormat } from '@/lib/store/chart-settings-types';
import { useChartResize } from '@/hooks/useChartResize';
import type uPlot from 'uplot';
import { ComparisonLegend } from './ComparisonLegend';
import { type ComparisonChartProps } from './comparison-chart-constants';
import { useComparisonChartData } from './useComparisonChartData';
import { useComparisonSeriesWindows } from './useComparisonSeriesWindows';
import type { ComparisonViewport } from '@/lib/store/comparison-store';

function viewportToBrushRange(viewport: ComparisonViewport | null | undefined): [number, number] | null {
    if (
        !viewport ||
        !Number.isFinite(viewport.xMinSec) ||
        !Number.isFinite(viewport.xMaxSec) ||
        viewport.xMaxSec <= viewport.xMinSec
    ) {
        return null;
    }
    return [viewport.xMinSec / 60, viewport.xMaxSec / 60];
}

function brushRangeToViewport(min: number, max: number): ComparisonViewport | null {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
    return {
        xMinSec: Math.round(min * 60 * 1000) / 1000,
        xMaxSec: Math.round(max * 60 * 1000) / 1000,
    };
}

function brushRangesEqual(a: [number, number] | null, b: [number, number] | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001;
}

function ComparisonChartUPlotInner({
    experiments,
    sessionId,
    primaryMetric = 'viscosity_cp',
    leftSecondaryMetric = 'none',
    secondaryMetric = 'none',
    tertiaryMetric = 'none',
    showLegend = true,
    showTouchPoints = false,
    viscosityThreshold = 200,
    showTargetTime = true,
    targetTime = 10,
    viewport,
    onViewportChange,
}: ComparisonChartProps) {
    const chartContainerRef = useRef<HTMLDivElement | null>(null);
    const chartSize = useChartResize(chartContainerRef);
    // Fallback `'individual'` mirrors the store default
    // (`chart-settings-defaults.ts`: `comparisonAxisMode: 'individual'`) and
    // matches the report-export fallback in `useComparisonReportExport.ts`.
    // Using `'shared'` here silently collapses extra metrics (e.g. a
    // shear-rate left-secondary) onto the viscosity scale whenever the
    // persisted store is missing this key.
    const comparisonAxisMode = useChartSettingsStore(s => s.settings.comparisonAxisMode ?? 'individual');
    const chartSettings = useChartSettingsStore(s => s.settings);
    const timeFormat = chartSettings.rheologyUnits?.timeFormat ?? 'seconds';
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const uPlotRef = useRef<uPlot | null>(null);

    // Debounce rapid experiment additions/removals (e.g. user adds 4 experiments
    // in quick succession).  Without this, each addition triggers a full uPlot
    // destroy+create cycle — leaving N lazy-GC GPU textures (~70 MB each) alive
    // simultaneously.  150 ms covers typical click-through speed; the list
    // re-renders instantly, only chart GPU recreation is deferred.
    const binarySeries = useComparisonSeriesWindows({ experiments, sessionId, viewport });
    const chartViewport = binarySeries.usedViewportFallback ? null : viewport;
    const chartExperiments = binarySeries.experiments;
    const debouncedExperiments = useDebouncedValue(chartExperiments, 150);

    /**
     * Brush range is stored in BOTH a mutable ref and React state:
     * - `brushRangeRef` — read synchronously by the x-scale `auto()` function
     *   inside uPlot's redraw pipeline, and by event handlers before any React
     *   re-render occurs. This is the source of truth for uPlot.
     * - `brushRange` state — drives only the ChartBrush component's UI
     *   (handle positions, range labels). It NEVER feeds back into setScale
     *   via a useEffect, avoiding the async batching / effect-chain races.
     */
    const initialBrushRange = viewportToBrushRange(chartViewport);
    const brushRangeRef = useRef<[number, number] | null>(initialBrushRange);
    const [brushRange, setBrushRange] = useState<[number, number] | null>(initialBrushRange);
    const [hiddenSeries, setHiddenSeries] = useState<Set<number>>(new Set());
    // Use ref instead of state for hovered legend item to avoid React re-renders
    // on every mouse-enter/leave event. Opacity is set directly on DOM elements.

    const [plotBbox, setPlotBbox] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

    const isChartContainerReady = chartSize.width > 8 && chartSize.height > 8;

    useEffect(() => {
        if (binarySeries.usedViewportFallback && viewport) {
            onViewportChange?.(null);
        }
    }, [binarySeries.usedViewportFallback, onViewportChange, viewport]);

    /** Restore the full data range on the x-axis and clear the brush. */
    const resetZoom = useCallback((u: uPlot) => {
        brushRangeRef.current = null;
        const times = u.data[0] as number[] | undefined;
        if (times && times.length > 0) {
            u.setScale('x', { min: times[0], max: times[times.length - 1] });
        }
        setBrushRange(null);
        onViewportChange?.(null);
    }, [onViewportChange]);

    /** Read the plot-area bounding box from the live uPlot instance. */
    const readPlotBbox = useCallback((u: uPlot) => {
        if (!u.bbox) return;
        const dpr = window.devicePixelRatio || 1;
        const left = u.bbox.left / dpr;
        const width = u.bbox.width / dpr;
        setPlotBbox(prev =>
            prev.left === left && prev.width === width ? prev : { left, width },
        );
    }, []);

    const handleChartInit = useCallback((u: uPlot) => {
        uPlotRef.current = u;
        readPlotBbox(u);
        // Two-frame deferred re-read: the first RAF is consumed by React's commit;
        // the second frame captures the final axis layout (y-axis label widths are
        // only known after the first paint, so u.bbox.left may be wrong on frame 0).
        // Store RAF IDs so they can be cancelled if the component unmounts between frames.
        const rafId1 = requestAnimationFrame(() => {
            const rafId2 = requestAnimationFrame(() => {
                if (uPlotRef.current === u) readPlotBbox(u);
            });
            pendingRafs.current.push(rafId2);
        });
        pendingRafs.current.push(rafId1);
        if (brushRangeRef.current) {
            u.setScale('x', { min: brushRangeRef.current[0], max: brushRangeRef.current[1] });
        }
    }, [readPlotBbox]);

    // Track pending RAF IDs for cleanup on unmount
    const pendingRafs = useRef<number[]>([]);

    // Clear the uPlot ref on unmount so stale callbacks (toggleSeries, brush)
    // never call methods on a destroyed instance after navigation.
    // Also cancel any pending RAFs to prevent closures from holding references
    // to destroyed uPlot instances.
    useEffect(() => {
        return () => {
            uPlotRef.current = null;
            pendingRafs.current.forEach(id => cancelAnimationFrame(id));
            pendingRafs.current = [];
        };
    }, []);

    // Re-read plot bbox after container resize
    useEffect(() => {
        const raf = requestAnimationFrame(() => {
            if (uPlotRef.current) readPlotBbox(uPlotRef.current);
        });
        return () => cancelAnimationFrame(raf);
    }, [chartSize.width, chartSize.height, readPlotBbox]);

    /**
     * Called by ChartBrush on every pointer-move during drag.
     * Directly calls setScale — no React state update in the hot path,
     * so uPlot's microtask commit fires without any React re-render racing.
     * `brushRange` state is updated separately only to drive the brush UI.
     */
    const handleBrushChange = useCallback((min: number, max: number) => {
        brushRangeRef.current = [min, max];
        const u = uPlotRef.current;
        if (u) {
            u.batch(() => {
                u.setScale('x', { min, max });
            });
        }
        setBrushRange([min, max]);
        onViewportChange?.(brushRangeToViewport(min, max));
    }, [onViewportChange]);

    const handleBrushReset = useCallback(() => {
        const u = uPlotRef.current;
        if (u) resetZoom(u);
        else {
            brushRangeRef.current = null;
            setBrushRange(null);
            onViewportChange?.(null);
        }
    }, [onViewportChange, resetZoom]);

    // Reset hidden series when experiments change (add/remove). The viewport
    // intentionally stays intact so route return and add-one-more flows do not
    // snap the user's comparison window back to the full range.
    const expIds = experiments.map(e => e.id).join(',');
    useEffect(() => {
        void Promise.resolve().then(() => {
            setHiddenSeries(new Set());
        });
    }, [expIds]);

    const toggleSeries = useCallback((legendIndex: number) => {
        const uPlotSeriesIndex = legendIndex + 1; // uPlot index 0 = time axis
        setHiddenSeries(prev => {
            const next = new Set(prev);
            const nowHidden = !next.has(legendIndex);
            if (nowHidden) next.add(legendIndex); else next.delete(legendIndex);
            uPlotRef.current?.setSeries(uPlotSeriesIndex, { show: !nowHidden });
            return next;
        });
    }, []);

    // The four uPlot callbacks below all read/write brushRangeRef.current.
    // Hoisting them to useCallback (event-handler context) keeps the
    // react-hooks/refs rule happy — accessing refs inside the uPlotOptions
    // useMemo factory itself is forbidden as it counts as render context.
    const xScaleAuto = useCallback(
        (_u: uPlot) => brushRangeRef.current === null,
        [],
    );
    const xScaleRange = useCallback(
        (_u: uPlot, dataMin: number, dataMax: number): [number, number] => {
            const br = brushRangeRef.current;
            return br ?? [dataMin, dataMax];
        },
        [],
    );
    const handleZoom = useCallback((min: number, max: number) => {
        brushRangeRef.current = [min, max];
        setBrushRange([min, max]);
        onViewportChange?.(brushRangeToViewport(min, max));
    }, [onViewportChange]);
    const handleZoomReset = useCallback(() => {
        const u = uPlotRef.current;
        if (u) {
            resetZoom(u);
            return;
        }

        brushRangeRef.current = null;
        setBrushRange(null);
        onViewportChange?.(null);
    }, [onViewportChange, resetZoom]);

    const viewportXMinSec = chartViewport?.xMinSec;
    const viewportXMaxSec = chartViewport?.xMaxSec;
    useEffect(() => {
        const nextRange = viewportToBrushRange(
            viewportXMinSec == null || viewportXMaxSec == null
                ? null
                : { xMinSec: viewportXMinSec, xMaxSec: viewportXMaxSec },
        );
        if (!brushRangesEqual(brushRangeRef.current, nextRange)) {
            brushRangeRef.current = nextRange;
            setBrushRange(nextRange);
        }

        const u = uPlotRef.current;
        if (!u) return;
        if (nextRange) {
            u.setScale('x', { min: nextRange[0], max: nextRange[1] });
            return;
        }

        const times = u.data[0] as number[] | undefined;
        if (times && times.length > 0) {
            u.setScale('x', { min: times[0], max: times[times.length - 1] });
        }
    }, [viewportXMinSec, viewportXMaxSec]);

    const { uPlotData, seriesConfig, axesConfig, touchPoints } = useComparisonChartData({
        debouncedExperiments,
        primaryMetric,
        leftSecondaryMetric,
        secondaryMetric,
        tertiaryMetric,
        showTouchPoints,
        viscosityThreshold,
        showTargetTime,
        targetTime,
        comparisonAxisMode,
    });

    // Brush width = plot-area width as reported by uPlot bbox.
    // Fall back to (container - leftAxis - 20px default right padding) only when
    // bbox isn't populated yet (first render before drawAxes fires).
    const brushWidth = plotBbox.width > 0
        ? plotBbox.width
        : Math.max(0, chartSize.width - plotBbox.left - 20);
    // Right margin = space occupied by right-side axes (Temperature axis etc.)
    const brushPaddingRight = plotBbox.width > 0
        ? Math.max(0, chartSize.width - plotBbox.left - plotBbox.width)
        : 20;

    // The two react-hooks/refs disables inside this useMemo (below) are for
    // false positives: the rule cannot prove that the closures captured
    // into uPlot's scales/plugins are invoked asynchronously by uPlot's
    // event loop (drawAxes hook, scale auto/range, zoom-plugin events) and
    // never during React render.  All ref reads happen at uPlot-callback
    // time, which is event-handler context per React semantics.
    const uPlotOptions = useMemo<uPlot.Options>(() => {
        // x-scale: allow auto-ranging only when no brush is active.
        // When brush is active `auto()` returns false, so uPlot's internal
        // setData(data, true) calls `_setScale('x', currentMin, currentMax)`
        // instead of `autoScaleX()` — preserving the zoomed window.
        // `range` simply passes through whatever min/max are given so explicit
        // setScale calls from handleBrushChange are respected verbatim.
        const scales: Record<string, uPlot.Scale> = {
            x: {
                time: false,
                auto: xScaleAuto,
                range: xScaleRange,
            },
        };
        // Register y-scales from axes config
        axesConfig.forEach(a => {
            if (a.scale && a.scale !== 'x') {
                scales[a.scale] = { auto: true };
            }
        });

        // In individual mode, the viscosity scale auto-ranges to actual data values
        // (e.g. 500–1400 cP), which may exclude the threshold (e.g. 200 cP).
        // Expand the scale range to always include the threshold so the reference
        // line is visible regardless of the data range.
        if (showTouchPoints && viscosityThreshold !== undefined && comparisonAxisMode !== 'shared') {
            const viscSN = primaryMetric; // scale name = metric key in individual mode
            // eslint-disable-next-line react-hooks/refs
            if (scales[viscSN]) {
                scales[viscSN] = {
                    auto: true,
                    range: (_u: uPlot, dataMin: number, dataMax: number) => {
                        const mn = Math.min(dataMin, viscosityThreshold);
                        const mx = Math.max(dataMax, viscosityThreshold);
                        const pad = (mx - mn) * 0.06 || 1;
                        return [mn - pad, mx + pad];
                    }
                };
            }
        }

        return {
            width: 100,
            height: 100,
            // Cap device pixel ratio at 1.5 — avoids 4× GPU texture scaling on HiDPI
            // displays (DPR=2 → 2560×1400 backing store) while keeping text crisp.
            pxRatio: Math.min(window.devicePixelRatio || 1, 1.5),
            padding: [10, 20, 10, 10],
            legend: { show: false },
            cursor: {
                points: { size: 8, width: 2, stroke: '#fff' }
            },
            plugins: [
                {
                    // Keep plotBbox in sync whenever uPlot redraws axes (resize, first paint).
                    // readPlotBbox only calls setPlotBbox when values actually change, so
                    // this never triggers spurious React re-renders.
                    hooks: {
                        drawAxes: [(u: uPlot) => { readPlotBbox(u); }],
                    },
                },
                tooltipPlugin({
                    titleFormatter: (val: number) => {
                        const timeFmt: TimeDisplayFormat = timeFormat;
                        let formatted: string;
                        switch (timeFmt) {
                            case 'seconds': formatted = String(Math.round(val * 60)); break;
                            case 'hh:mm:ss': {
                                const ts = Math.round(val * 60);
                                const h = Math.floor(ts / 3600);
                                const m = Math.floor((ts % 3600) / 60);
                                const s = ts % 60;
                                formatted = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
                                break;
                            }
                            default: formatted = String(Math.round(val * 10) / 10);
                        }
                        return `Время: ${formatted} ${timeUnitLabel(timeFmt)}`;
                    },
                    isDark,
                }),
                // The plugins below capture handleZoom/handleZoomReset which
                // touch brushRangeRef.current.  uPlot calls those at runtime
                // (event-handler context) — the rule's static analysis cannot
                // prove this and produces a false positive.
                // eslint-disable-next-line react-hooks/refs
                zoomPlugin({
                    // zoomPlugin already called setScale internally; we only
                    // need to sync brushRangeRef and refresh the brush UI —
                    // see handleZoom / handleZoomReset above.
                    onZoom: handleZoom,
                    onReset: handleZoomReset,
                }),
                touchPointsPlugin({
                    touchPoints,
                    viscosityThreshold,
                    // Comparison chart Y-scale for viscosity is always cP
                    // (primary metric is `viscosity_cp`), so the plugin's
                    // threshold conversion is an identity here.  Stating
                    // it explicitly keeps the contract clear and future-
                    // proof if per-experiment unit selectors are added.
                    displayUnit: 'cP',
                    showTouchPoints,
                    targetTime,
                    isDark,
                    scaleName: comparisonAxisMode === 'shared' ? 'left' : primaryMetric,
                })
            ],
            scales,
            axes: axesConfig,
            series: seriesConfig
        };
    }, [axesConfig, seriesConfig, touchPoints, viscosityThreshold, showTouchPoints, targetTime, primaryMetric, comparisonAxisMode, readPlotBbox, isDark, timeFormat, xScaleAuto, xScaleRange, handleZoom, handleZoomReset]);

    return (
        <div className="flex flex-col h-full w-full">
            <div ref={chartContainerRef} className="flex-1 min-h-0 relative overflow-hidden" data-testid="ComparisonChart" role="img" aria-label="График сравнения экспериментов">
                {isChartContainerReady && uPlotData[0].length > 0 ? (
                    <div className="absolute inset-0">
                        <UPlotChart 
                            options={uPlotOptions} 
                            data={uPlotData}
                            resetScalesOnDataChange={false}
                            width={chartSize.width} 
                            height={chartSize.height}
                            onInit={handleChartInit}
                        />
                    </div>
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                        {experiments.length === 0
                            ? 'Добавьте эксперименты для сравнения'
                            : binarySeries.errorCount > 0 && binarySeries.readyCount === 0
                                ? 'Не удалось загрузить данные'
                                : 'Загрузка данных...'}
                    </div>
                )}
            </div>

            {/* Brush / range selector – aligned with the plot area */}
            {experiments.length > 0 && uPlotData[0].length > 0 && brushWidth > 0 && (
                <div className="flex-none py-1" style={{ paddingLeft: plotBbox.left, paddingRight: brushPaddingRight }}>
                    <ChartBrush
                        times={uPlotData[0] as number[]}
                        values={uPlotData[1] as (number | null)[]}
                        range={brushRange}
                        onChange={handleBrushChange}
                        onReset={handleBrushReset}
                        width={brushWidth}
                        height={36}
                    />
                </div>
            )}

            {/* Custom Legend */}
            {showLegend && experiments.length > 0 && (
                <ComparisonLegend
                    seriesConfig={seriesConfig}
                    hiddenSeries={hiddenSeries}
                    toggleSeries={toggleSeries}
                />
            )}
        </div>
    );
}

/**
 * Memoised export — prevents full chart rebuild when parent re-renders due to
 * displaySettings changes (axis picks, legend toggle). The inner debounce
 * (150 ms) handles rapid experiment additions; memo handles everything else.
 */
export const ComparisonChartUPlot = React.memo(ComparisonChartUPlotInner);
