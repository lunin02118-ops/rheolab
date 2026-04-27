/**
 * useRheologyChartOptions
 *
 * Builds the uPlot.Options object for the RheologyChart component.
 * Thin orchestrator — delegates translations, axes, and series assembly
 * to dedicated modules in `./chart-options/`.
 */
import { useMemo, useRef } from 'react';
import type uPlot from 'uplot';
import { tooltipPlugin } from '@/components/charts/plugins/tooltip';
import { zoomPlugin } from '@/components/charts/plugins/zoom';
import { touchPointsPlugin, type TouchPointsPluginOptions } from '@/components/charts/plugins/touchPoints';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import type { TimeDisplayFormat, ViscosityUnit } from '@/lib/store/chart-settings-types';
import type { TouchPointMarker } from './useRheologyData';
import { useTheme } from '@/contexts/theme-context';
import { buildAxes, buildChartTranslations, buildSeries } from './chart-options';

interface UseRheologyChartOptionsParams {
    activeSettings: ChartSettings;
    chartSettings: ChartSettings;
    showTemperature: boolean;
    showShearRate: boolean;
    showPressure: boolean;
    showRpm: boolean;
    showBathTemperature: boolean;
    pdfMode: boolean;
    captureMode: boolean;
    touchPoints: TouchPointMarker[];
    effectiveShearRateAxis: 'left' | 'right';
    effectivePressureAxis: 'left' | 'right';
    axisMode: 'shared' | 'individual';
    /**
     * Viscosity threshold in **cP** (algorithm canonical unit).  The
     * touch-points plugin converts this to the chart's current display
     * unit before calling `valToPos`, so the horizontal guide always
     * lines up with the correct pixel regardless of the Y-scale unit.
     */
    viscosityThreshold: number;
    /** Chart display unit of the viscosity Y axis. */
    viscosityDisplayUnit: ViscosityUnit;
    showTouchPoints: boolean;
    targetTime: number;
    language?: 'ru' | 'en';
}

export function useRheologyChartOptions({
    activeSettings,
    chartSettings,
    showTemperature,
    showShearRate,
    showPressure,
    showRpm,
    showBathTemperature,
    pdfMode,
    captureMode,
    touchPoints,
    effectiveShearRateAxis,
    effectivePressureAxis,
    axisMode,
    viscosityThreshold,
    viscosityDisplayUnit,
    showTouchPoints,
    targetTime,
    language = 'ru',
}: UseRheologyChartOptionsParams): uPlot.Options {
    const { resolvedTheme } = useTheme();

    // ── Touch-points ref ──────────────────────────────────────────────────
    // Touch-point overlay data changes on every analysis run (new array ref).
    // Putting it directly in the useMemo deps would trigger a full chart
    // destroy → recreate cycle, leaking DOM nodes and causing a visible flash.
    // Instead, keep the volatile values in a ref that the draw-hook reads
    // on every uPlot repaint. The chart still repaints (via setData) so the
    // overlay always reflects the latest data — without recreation.
    const touchPointsRef = useRef<TouchPointsPluginOptions>({
        touchPoints,
        viscosityThreshold,
        displayUnit: viscosityDisplayUnit,
        showTouchPoints,
        targetTime,
        pdfMode,
        captureMode,
        scaleName: undefined, // will be set inside the memo
    });
    // Sync on every render — cheap object assignment.
    touchPointsRef.current = {
        touchPoints,
        viscosityThreshold,
        displayUnit: viscosityDisplayUnit,
        showTouchPoints,
        targetTime,
        pdfMode,
        captureMode,
        isDark: resolvedTheme === 'dark',
        language,
        scaleName: touchPointsRef.current.scaleName, // preserve computed scale name
    };

    return useMemo<uPlot.Options>(() => {
        const isDark = !pdfMode && !captureMode && resolvedTheme === 'dark';
        const isShared = axisMode === 'shared';
        const timeFmt: TimeDisplayFormat = chartSettings.rheologyUnits?.timeFormat ?? 'seconds';

        // ── Per-metric uPlot scale names ─────────────────────────────────────
        const sViscosity = isShared ? 'left' : 'viscosity';
        const sTemperature = isShared ? 'right' : 'temperature';
        const sShearRate = isShared ? (effectiveShearRateAxis === 'right' ? 'right' : 'left') : 'shearRate';
        const sPressure = isShared ? (effectivePressureAxis === 'right' ? 'right' : 'left') : 'pressure';
        const sRpm = isShared ? (activeSettings.lines.rpm.axis === 'right' ? 'right' : 'left') : 'rpm';
        // Bath temperature shares the same Y scale as sample temperature (same °C units)
        const sBathTemperature = sTemperature;

        // Update the scaleName in the ref so the draw-hook reads it.
        touchPointsRef.current = { ...touchPointsRef.current, scaleName: sViscosity };

        const t = buildChartTranslations({ activeSettings, chartSettings, language });

        return {
            width: 100, // Initial dummy size, will be overridden by UPlotChart props
            height: 100,
            // Cap device pixel ratio at 1.5 — avoids 4× GPU texture scaling on HiDPI
            // displays (DPR=2 → 2560×1400 backing store) while keeping text crisp.
            pxRatio: Math.min(window.devicePixelRatio || 1, 1.5),
            padding: [10, 20, 10, 10], // [top, right, bottom, left]
            legend: { show: false },
            cursor: {
                points: {
                    size: 8,
                    width: 2,
                    // Use each series' own colour for cursor dot (per-series color)
                    fill: (u: uPlot, si: number) => {
                        const s = u.series[si]?.stroke;
                        return typeof s === 'string' ? s : (isDark ? '#1e293b' : '#fff');
                    },
                    stroke: (u: uPlot, si: number) => {
                        const s = u.series[si]?.stroke;
                        return typeof s === 'string' ? s : (isDark ? '#fff' : '#000');
                    },
                },
            },
            plugins: [
                ...(!captureMode && !pdfMode && chartSettings.tooltipEnabled !== false
                    ? [
                        tooltipPlugin({
                            formatter: (idx: number, val: number) => `${val} ${t.tooltipUnits[idx] ?? ''}`,
                            titleFormatter: (val: number) => t.tooltipTimeLabel(val),
                            isDark,
                        }),
                    ]
                    : []),
                zoomPlugin(),
                touchPointsPlugin(touchPointsRef),
            ],
            scales: {
                x: { time: false },
                ...(isShared
                    ? {
                        left: { auto: true },
                        right: { auto: true },
                    }
                    : {
                        viscosity: { auto: true },
                        temperature: { auto: true },
                        shearRate: { auto: true },
                        pressure: { auto: true },
                        rpm: { auto: true },
                    }),
            },
            axes: buildAxes({
                activeSettings,
                t,
                isDark,
                isShared,
                showTemperature,
                showShearRate,
                showPressure,
                showRpm,
                showBathTemperature,
                effectiveShearRateAxis,
                effectivePressureAxis,
                timeFmt,
            }),
            series: buildSeries({
                activeSettings,
                t,
                showTemperature,
                showShearRate,
                showPressure,
                showRpm,
                showBathTemperature,
                sViscosity,
                sTemperature,
                sShearRate,
                sPressure,
                sRpm,
                sBathTemperature,
            }),
        };
    }, [activeSettings, chartSettings, showTemperature, showShearRate, showPressure, showRpm, showBathTemperature, pdfMode, captureMode, effectiveShearRateAxis, effectivePressureAxis, axisMode, resolvedTheme, language]);
}
