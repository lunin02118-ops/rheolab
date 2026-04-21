/**
 * uPlot axes and series builders for the rheology chart.
 *
 * Receives pre-computed scale names, colors, and translations.
 * Returns plain `uPlot.Axis[]` / `uPlot.Series[]` arrays — no hooks, no DOM.
 */
import type uPlot from 'uplot';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import { getStrokeDasharray } from '@/lib/store/chart-settings-store';
import type { TimeDisplayFormat } from '@/lib/store/chart-settings-types';
import type { ChartTranslations } from './translations';
import { applyOpacity, applyTimeAxisOptions, parseDash } from './time-format';

// Show per-series dots only when zoomed in enough (< 60 visible data points).
const showPointsWhenZoomed: uPlot.Series['points'] = {
    show: (_u: uPlot, _si: number, idx0: number, idx1: number) => idx1 - idx0 < 60,
};

export interface BuildAxesParams {
    activeSettings: ChartSettings;
    t: ChartTranslations;
    isDark: boolean;
    isShared: boolean;
    showTemperature: boolean;
    showShearRate: boolean;
    showPressure: boolean;
    showRpm: boolean;
    showBathTemperature: boolean;
    effectiveShearRateAxis: 'left' | 'right';
    effectivePressureAxis: 'left' | 'right';
    timeFmt: TimeDisplayFormat;
}

/**
 * Build uPlot axes array honouring the axis-sharing mode (shared vs individual).
 */
export function buildAxes({
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
}: BuildAxesParams): uPlot.Axis[] {
    const textColor = isDark ? '#94a3b8' : '#334155';
    const gridColor = isDark ? '#334155' : '#94a3b8';
    const axisColor = isDark ? '#475569' : '#cbd5e1';
    const gridColorOpa = applyOpacity(gridColor, activeSettings.gridOpacity ?? 1);

    const xAxis: uPlot.Axis = applyTimeAxisOptions(
        {
            scale: 'x',
            label: t.timeAxis,
            labelSize: 20,
            labelFont: '12px sans-serif',
            font: '12px sans-serif',
            stroke: textColor,
            grid: {
                show: activeSettings.showGridLines !== false,
                stroke: gridColorOpa,
                width: 1,
                dash: [3, 3],
            },
            ticks: { stroke: axisColor, width: 1 },
        },
        timeFmt,
    );

    if (isShared) {
        const leftLabels = [t.viscosityAxis];
        if (showShearRate && effectiveShearRateAxis !== 'right') leftLabels.push(t.shearRateAxis);
        if (showPressure && effectivePressureAxis !== 'right') leftLabels.push(t.pressureAxis);
        if (showRpm && activeSettings.lines.rpm.axis !== 'right') leftLabels.push(t.rpmAxis);
        const rightLabels: string[] = [];
        if (showTemperature) rightLabels.push(t.temperatureAxis);
        if (showShearRate && effectiveShearRateAxis === 'right') rightLabels.push(t.shearRateAxis);
        if (showPressure && effectivePressureAxis === 'right') rightLabels.push(t.pressureAxis);
        if (showRpm && activeSettings.lines.rpm.axis === 'right') rightLabels.push(t.rpmAxis);
        return [
            xAxis,
            {
                scale: 'left',
                label: leftLabels.join(' / '),
                labelSize: 20,
                labelFont: '11px sans-serif',
                font: '12px sans-serif',
                // Pin gutter width so shared-axes charts always have consistent
                // horizontal margins regardless of tick-label auto-sizing.
                size: 70,
                stroke: activeSettings.lines.viscosity.color,
                grid: { show: activeSettings.showGridLines !== false, stroke: gridColorOpa, width: 1, dash: [3, 3] },
                ticks: { stroke: activeSettings.lines.viscosity.color, width: 1 },
            },
            {
                scale: 'right',
                side: 1,
                show: rightLabels.length > 0,
                label: rightLabels.join(' / '),
                labelSize: 20,
                labelFont: '11px sans-serif',
                font: '12px sans-serif',
                size: 65,
                stroke: activeSettings.lines.temperature.color,
                grid: { show: false },
                ticks: { stroke: activeSettings.lines.temperature.color, width: 1 },
            },
        ];
    }

    return [
        xAxis,
        {
            scale: 'viscosity',
            label: t.viscosityAxis,
            labelSize: 20,
            labelFont: '11px sans-serif',
            font: '12px sans-serif',
            // Pin size so the left-side gutter width is stable — matches
            // shared-mode left axis size (70px).
            size: 70,
            stroke: activeSettings.lines.viscosity.color,
            grid: { show: activeSettings.showGridLines !== false, stroke: gridColorOpa, width: 1, dash: [3, 3] },
            ticks: { stroke: activeSettings.lines.viscosity.color, width: 1 },
        },
        {
            scale: 'temperature',
            side: 1,
            // Bath temperature shares the temperature scale — show the axis
            // whenever either metric is visible (not just when temperature itself is on).
            show: showTemperature || showBathTemperature,
            label:
                showTemperature && showBathTemperature
                    ? t.tempBathCombinedAxis
                    : showBathTemperature
                        ? t.bathTempAxis
                        : t.temperatureAxis,
            labelSize: 20,
            labelFont: '11px sans-serif',
            font: '12px sans-serif',
            // Pin size so the right-side gutter width is stable regardless
            // of label length — matches shared-mode right axis size.
            size: 65,
            stroke: activeSettings.lines.temperature.color,
            grid: { show: false },
            ticks: { stroke: activeSettings.lines.temperature.color, width: 1 },
        },
        {
            scale: 'shearRate',
            side: effectiveShearRateAxis === 'right' ? 1 : 3,
            show: showShearRate,
            label: t.shearRateAxis,
            labelSize: 20,
            labelFont: '11px sans-serif',
            font: '12px sans-serif',
            size: 65,
            stroke: activeSettings.lines.shearRate.color,
            grid: { show: false },
            ticks: { stroke: activeSettings.lines.shearRate.color, width: 1 },
        },
        {
            scale: 'pressure',
            side: effectivePressureAxis === 'right' ? 1 : 3,
            show: showPressure,
            label: t.pressureAxis,
            labelSize: 20,
            labelFont: '11px sans-serif',
            font: '12px sans-serif',
            size: 65,
            stroke: activeSettings.lines.pressure.color,
            grid: { show: false },
            ticks: { stroke: activeSettings.lines.pressure.color, width: 1 },
        },
        {
            scale: 'rpm',
            side: 3,
            show: showRpm,
            label: t.rpmAxis,
            labelSize: 20,
            labelFont: '11px sans-serif',
            font: '12px sans-serif',
            size: 65,
            stroke: activeSettings.lines.rpm.color,
            grid: { show: false },
            ticks: { stroke: activeSettings.lines.rpm.color, width: 1 },
        },
        // Bath temperature shares the temperature scale — no separate axis needed
    ];
}

export interface BuildSeriesParams {
    activeSettings: ChartSettings;
    t: ChartTranslations;
    showTemperature: boolean;
    showShearRate: boolean;
    showPressure: boolean;
    showRpm: boolean;
    showBathTemperature: boolean;
    sViscosity: string;
    sTemperature: string;
    sShearRate: string;
    sPressure: string;
    sRpm: string;
    sBathTemperature: string;
}

/**
 * Build uPlot series array — one entry per metric plus the X-axis.
 */
export function buildSeries({
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
}: BuildSeriesParams): uPlot.Series[] {
    return [
        { label: t.seriesTime }, // X-axis
        {
            label: t.seriesViscosity,
            scale: sViscosity,
            stroke: activeSettings.lines.viscosity.color,
            width: activeSettings.lines.viscosity.width,
            dash: parseDash(getStrokeDasharray(activeSettings.lines.viscosity.style)),
            show: true,
            points: showPointsWhenZoomed,
        },
        {
            label: t.seriesTemperature,
            scale: sTemperature,
            stroke: activeSettings.lines.temperature.color,
            width: activeSettings.lines.temperature.width,
            dash: parseDash(getStrokeDasharray(activeSettings.lines.temperature.style)),
            show: showTemperature,
            points: showPointsWhenZoomed,
        },
        {
            label: t.seriesShearRate,
            scale: sShearRate,
            stroke: activeSettings.lines.shearRate.color,
            width: activeSettings.lines.shearRate.width,
            dash: parseDash(getStrokeDasharray(activeSettings.lines.shearRate.style)),
            show: showShearRate,
            points: showPointsWhenZoomed,
        },
        {
            label: t.seriesPressure,
            scale: sPressure,
            stroke: activeSettings.lines.pressure.color,
            width: activeSettings.lines.pressure.width,
            dash: parseDash(getStrokeDasharray(activeSettings.lines.pressure.style)),
            show: showPressure,
            points: showPointsWhenZoomed,
        },
        {
            label: t.seriesRpm,
            scale: sRpm,
            stroke: activeSettings.lines.rpm.color,
            width: activeSettings.lines.rpm.width,
            dash: parseDash(getStrokeDasharray(activeSettings.lines.rpm.style)),
            show: showRpm,
            points: showPointsWhenZoomed,
        },
        {
            label: t.seriesBathTemp,
            scale: sBathTemperature,
            stroke: activeSettings.lines.bathTemperature?.color ?? '#fb923c',
            width: activeSettings.lines.bathTemperature?.width ?? 2,
            dash: parseDash(getStrokeDasharray(activeSettings.lines.bathTemperature?.style ?? 'dashed')),
            show: showBathTemperature,
            points: showPointsWhenZoomed,
        },
    ];
}
