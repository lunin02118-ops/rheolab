/**
 * useComparisonChartData
 *
 * Encapsulates the data-preparation pipeline for ComparisonChartUPlot:
 *   - per-experiment sanitise / downsample / time-normalise
 *   - shared time axis construction
 *   - uPlot series + axes config
 *   - smart touch-point calculation
 *
 * Pure helpers (getScaleName, getIsRight, getAxisLabel) live inline as
 * file-private functions; the matching unit tests in
 * tests/components/comparison-chart-scales.test.ts mirror them locally
 * (see the comment there) because they need an injectable label table.
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type uPlot from 'uplot';
import { useTheme } from '@/contexts/theme-context';
import { useChartSettingsStore, getStrokeDasharray, timeUnitLabel } from '@/lib/store/chart-settings-store';
import type { TimeDisplayFormat } from '@/lib/store/chart-settings-types';
import { applyTimeAxisOptions } from '@/hooks/chart-options/time-format';
import {
    sanitiseAndNormalisePoints,
    sanitiseAndNormaliseColumnarDirect,
    alignSeriesLinear,
    alignSeriesFromColumnarLinear,
    type ProcessedColumnar,
    type DownsampleMode,
} from '@/lib/utils/comparison-data';
import { calculateSmartTouchPoints } from '@/lib/utils/touch-point';
import type { ColumnarData } from '@/types';
import type { RheoPoint } from '@/types';
import type { TouchPoint } from '../charts/plugins/touchPoints';
import {
    showPointsWhenZoomed,
    METRIC_COLORS,
    METRIC_TO_LINE_KEY,
    EXPERIMENT_COLORS,
    METRIC_LABELS,
} from './comparison-chart-constants';
import type { ComparisonChartProps } from './comparison-chart-constants';

// ── File-private pure helpers ───────────────────────────────────────────

/** Returns the uPlot scale name for a given metric in the current axis mode. */
function getScaleName(
    metric: string,
    isShared: boolean,
    leftMetrics: string[],
): string {
    const canonical = metric === 'bath_temperature_c' ? 'temperature_c' : metric;
    if (isShared) return leftMetrics.includes(metric) ? 'left' : 'right';
    return canonical;
}

/**
 * Returns true when the axis for `metric` should be placed on the right side.
 * Works for both shared and individual axis modes.
 */
function getIsRight(
    metric: string,
    activeMetrics: string[],
    rightMetrics: string[],
    isShared: boolean,
    leftMetrics: string[],
): boolean {
    const sn = getScaleName(metric, isShared, leftMetrics);
    return activeMetrics.some(m => getScaleName(m, isShared, leftMetrics) === sn && rightMetrics.includes(m));
}

/** Builds the combined axis label for all metrics sharing the same scale. */
function getAxisLabel(
    metric: string,
    activeMetrics: string[],
    isShared: boolean,
    leftMetrics: string[],
): string {
    const sn = getScaleName(metric, isShared, leftMetrics);
    const metricsOnScale = activeMetrics.filter(m => getScaleName(m, isShared, leftMetrics) === sn);
    return metricsOnScale.map(m => METRIC_LABELS[m] || m).join(' / ');
}

function columnarTimeOriginSec(columnarData: ColumnarData, fallback: number): number {
    return Number.isFinite(columnarData.timeOriginSec)
        ? Number(columnarData.timeOriginSec)
        : fallback;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export interface UseComparisonChartDataResult {
    uPlotData: uPlot.AlignedData;
    seriesConfig: uPlot.Series[];
    axesConfig: uPlot.Axis[];
    touchPoints: TouchPoint[];
}

const EMPTY_RESULT: UseComparisonChartDataResult = {
    uPlotData: [[]] as uPlot.AlignedData,
    seriesConfig: [],
    axesConfig: [],
    touchPoints: [],
};

export interface UseComparisonChartDataParams {
    debouncedExperiments: ComparisonChartProps['experiments'];
    primaryMetric: string;
    leftSecondaryMetric: string;
    secondaryMetric: string;
    tertiaryMetric: string;
    showTouchPoints: boolean;
    viscosityThreshold: number;
    showTargetTime: boolean;
    targetTime: number;
    comparisonAxisMode: string;
}

export function useComparisonChartData(params: UseComparisonChartDataParams): UseComparisonChartDataResult {
    const {
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
    } = params;

    const { lines, downsampleMode, timeFormat } = useChartSettingsStore(
        useShallow(s => ({
            lines: s.settings.lines,
            downsampleMode: s.settings.downsampleMode ?? 'smart',
            timeFormat: s.settings.rheologyUnits?.timeFormat ?? 'seconds',
        })),
    );
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';

    return useMemo((): UseComparisonChartDataResult => {
        if (!debouncedExperiments.length) return EMPTY_RESULT;

        const mode = downsampleMode;
        const baseThreshold = 800;
        const threshold = Math.max(400, Math.floor(baseThreshold / Math.max(1, debouncedExperiments.length / 2)));

        const tps: TouchPoint[] = [];

        // 1. Sanitise, downsample and time-normalise each experiment.
        const processedExps = debouncedExperiments.map((exp, expIdx) => {
            const columnarData = (exp as Record<string, unknown>).columnarData as ColumnarData | undefined;

            // Columnar-native path: index-selection LTTB on raw arrays → materialise
            // only ~threshold points. Falls back to AoS path when no columnarData.
            const pc: ProcessedColumnar | null = columnarData && columnarData.timeSec.length > 0
                ? sanitiseAndNormaliseColumnarDirect(columnarData, mode as DownsampleMode, threshold)
                : null;
            const mapped = pc === null
                ? sanitiseAndNormalisePoints(
                    (exp as Record<string, unknown>).rawPoints as RheoPoint[] | string | undefined,
                    mode as DownsampleMode,
                    threshold,
                )
                : [];

            const sampleLen = pc ? pc.timeMins.length : mapped.length;
            if (showTouchPoints && sampleLen > 0) {
                // Compute touch points from RAW (non-downsampled) data for accuracy.
                // Downsampled comparison data (400-800 pts) drops critical oscillation
                // points near the threshold, causing late detection.
                const expColor = EXPERIMENT_COLORS[expIdx % EXPERIMENT_COLORS.length];
                let tpInputs: { time_min: number; viscosity_cp: number; shear_rate: number }[];
                if (columnarData && columnarData.timeSec.length > 0) {
                    // Direct columnar path: avoids a second full AoS materialisation
                    const col = columnarData;
                    const n = col.timeSec.length;
                    const validIdx: number[] = [];
                    for (let i = 0; i < n; i++) {
                        const t = col.timeSec[i];
                        if (t != null && !isNaN(t)) validIdx.push(i);
                    }
                    validIdx.sort((a, b) => col.timeSec[a] - col.timeSec[b]);
                    const t0 = validIdx.length > 0
                        ? columnarTimeOriginSec(col, col.timeSec[validIdx[0]])
                        : 0;
                    tpInputs = validIdx.map(i => ({
                        time_min: Math.round(((col.timeSec[i] - t0) / 60) * 100) / 100,
                        viscosity_cp: col.viscosityCp[i] ?? 0,
                        shear_rate: col.shearRate[i] ?? 0,
                    }));
                } else {
                    const rawMapped = sanitiseAndNormalisePoints(
                        (exp as Record<string, unknown>).rawPoints as RheoPoint[] | string | undefined,
                        'off' as DownsampleMode,
                        threshold,
                    );
                    tpInputs = rawMapped.map(p => ({
                        time_min: p.time_min,
                        viscosity_cp: p.viscosity_cp,
                        shear_rate: p.shear_rate_s1 ?? (p as unknown as { shear_rate?: number }).shear_rate ?? 0,
                    }));
                }

                const smartResults = calculateSmartTouchPoints(tpInputs, {
                    viscosityThreshold,
                    showTargetTime,
                    targetTime,
                });

                // Comparison chart Y-scale is always cP (primary metric =
                // `viscosity_cp`), so the algorithm output can flow through
                // unchanged.  Populate the display-unit aliases so the
                // touch-points plugin can render labels correctly without
                // assuming legacy field semantics.
                for (const r of smartResults) {
                    tps.push({
                        time: r.time,
                        viscosity: r.viscosity,
                        viscosityCp: r.viscosity,
                        viscosityDisplay: r.viscosity,
                        displayUnit: 'cP',
                        type: r.type,
                        color: expColor,
                        snappedToSeries: false,
                        anomaly: r.anomaly,
                    });
                }
            }

            return { exp, pc, points: mapped };
        });

        // 2. Build shared time axis — merge from columnar timeMins or AoS time_min
        const sortedTimes: number[] = (() => {
            const set = new Set<number>();
            for (const { pc: ePc, points } of processedExps) {
                if (ePc) {
                    for (let i = 0; i < ePc.timeMins.length; i++) set.add(ePc.timeMins[i]);
                } else {
                    // AoS fallback — delegates to existing logic
                    for (const p of points) if (!isNaN(p.time_min)) set.add(p.time_min);
                }
            }
            return Array.from(set).sort((a, b) => a - b);
        })();

        // 3. Determine active metrics
        const activeMetrics = [primaryMetric];
        if (leftSecondaryMetric !== 'none') activeMetrics.push(leftSecondaryMetric);
        if (secondaryMetric !== 'none') activeMetrics.push(secondaryMetric);
        if (tertiaryMetric !== 'none') activeMetrics.push(tertiaryMetric);

        // 4. Prepare uPlot data structure
        const axisStroke = isDark ? '#94a3b8' : '#475569';
        const gridStroke = isDark ? '#334155' : '#e2e8f0';
        const tickStroke = isDark ? '#475569' : '#94a3b8';
        const timeFmt: TimeDisplayFormat = timeFormat;
        const uData: (number | null | undefined)[][] = [sortedTimes];
        const sConfig: uPlot.Series[] = [{ label: 'Время' }];
        const aConfig: uPlot.Axis[] = [
            applyTimeAxisOptions(
                {
                    scale: 'x',
                    label: `Время (${timeUnitLabel(timeFmt)})`,
                    stroke: axisStroke,
                    grid: { stroke: gridStroke, width: 1, dash: [3, 3] },
                    ticks: { stroke: tickStroke, width: 1 },
                },
                timeFmt,
            ),
        ];

        const isShared = comparisonAxisMode === 'shared';

        const leftMetrics = [primaryMetric, ...(leftSecondaryMetric !== 'none' ? [leftSecondaryMetric] : [])];
        const rightMetrics = [
            ...(secondaryMetric !== 'none' ? [secondaryMetric] : []),
            ...(tertiaryMetric !== 'none' ? [tertiaryMetric] : []),
        ];

        const scaleName = (metric: string) => getScaleName(metric, isShared, leftMetrics);
        const isRight = (metric: string) => getIsRight(metric, activeMetrics, rightMetrics, isShared, leftMetrics);
        const axisLabel = (metric: string) => getAxisLabel(metric, activeMetrics, isShared, leftMetrics);

        const addedAxes = new Set<string>();

        processedExps.forEach((processed, expIdx) => {
            const isSingleExp = debouncedExperiments.length === 1;
            const expColor = EXPERIMENT_COLORS[expIdx % EXPERIMENT_COLORS.length];

            activeMetrics.forEach(metric => {
                const seriesData = processed.pc
                    ? alignSeriesFromColumnarLinear(processed.pc, sortedTimes, metric)
                    : alignSeriesLinear(processed.points, sortedTimes, metric);
                uData.push(seriesData);

                const lineKey = METRIC_TO_LINE_KEY[metric];
                const lineSettings = lineKey ? lines[lineKey] : null;

                const color: string = isSingleExp
                    ? (lineSettings?.color ?? METRIC_COLORS[metric] ?? expColor)
                    : expColor;

                const width = lineSettings?.width ?? 2;
                const dashStr = lineSettings ? getStrokeDasharray(lineSettings.style) : undefined;
                const dash = dashStr ? dashStr.split(' ').map(Number) : [];

                const sn = scaleName(metric);

                sConfig.push({
                    label: `${processed.exp.name} - ${METRIC_LABELS[metric] || metric}`,
                    scale: sn,
                    stroke: color,
                    width,
                    dash: dash.length > 0 ? dash : undefined,
                    show: true,
                    points: showPointsWhenZoomed,
                });

                if (!addedAxes.has(sn)) {
                    const onRight = isRight(metric);

                    if (isShared) {
                        const sideMetrics = onRight ? rightMetrics : leftMetrics;
                        const axisColor = sideMetrics.length > 1 ? axisStroke : (METRIC_COLORS[sideMetrics[0]] || axisStroke);
                        const label = sideMetrics.map(m => METRIC_LABELS[m] || m).join(' / ');
                        const showGrid = !onRight;
                        aConfig.push({
                            scale: sn,
                            label,
                            side: onRight ? 1 : 3,
                            stroke: axisColor,
                            grid: { show: showGrid, stroke: gridStroke, width: 1, dash: [3, 3] },
                            ticks: { stroke: axisColor, width: 1 }
                        });
                    } else {
                        const label = axisLabel(metric);
                        const axisColor = lineSettings?.color ?? METRIC_COLORS[metric] ?? axisStroke;
                        const showGrid = sn === primaryMetric || sn === scaleName(primaryMetric);
                        aConfig.push({
                            scale: sn,
                            label,
                            side: onRight ? 1 : 3,
                            stroke: axisColor,
                            grid: { show: showGrid, stroke: gridStroke, width: 1, dash: [3, 3] },
                            ticks: { stroke: axisColor, width: 1 }
                        });
                    }
                    addedAxes.add(sn);
                }
            });
        });

        return { uPlotData: uData as uPlot.AlignedData, seriesConfig: sConfig, axesConfig: aConfig, touchPoints: tps };
    }, [
        debouncedExperiments, lines, downsampleMode, timeFormat,
        primaryMetric, leftSecondaryMetric, secondaryMetric, tertiaryMetric,
        showTouchPoints, viscosityThreshold, showTargetTime, targetTime, comparisonAxisMode,
        isDark,
    ]);
}
