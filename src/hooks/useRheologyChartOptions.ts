/**
 * useRheologyChartOptions
 *
 * Builds the uPlot.Options object for the RheologyChart component.
 * Extracted so the main component stays readable and the axes/series
 * configuration is isolated and independently testable.
 */
import { useMemo, useRef } from 'react';
import type uPlot from 'uplot';
import { tooltipPlugin } from '@/components/charts/plugins/tooltip';
import { zoomPlugin } from '@/components/charts/plugins/zoom';
import { touchPointsPlugin, type TouchPointsPluginOptions } from '@/components/charts/plugins/touchPoints';
import { getStrokeDasharray } from '@/lib/store/chart-settings-store';
import type { ChartSettings } from '@/lib/store/chart-settings-store';
import type { PressureUnit, TimeDisplayFormat } from '@/lib/store/chart-settings-types';
import type { TouchPointMarker } from './useRheologyData';
import { useTheme } from '@/contexts/theme-context';

// Show per-series dots only when zoomed in enough (< 60 visible data points).
const showPointsWhenZoomed: uPlot.Series['points'] = {
    show: (_u: uPlot, _si: number, idx0: number, idx1: number) => (idx1 - idx0) < 60,
};

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
    viscosityThreshold: number;
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
        const textColor = isDark ? '#94a3b8' : '#334155';
        const gridColor = isDark ? '#334155' : '#94a3b8';

        // ── Per-line units from settings ─────────────────────────────────────
        const uVisc = activeSettings.lines.viscosity.unit ?? 'mPa·s';
        const uTemp = activeSettings.lines.temperature.unit ?? '°C';
        const uBath = activeSettings.lines.bathTemperature?.unit ?? uTemp;
        const uShear = activeSettings.lines.shearRate.unit ?? '1/s';
        const uPress = activeSettings.lines.pressure.unit ?? 'bar';
        const uRpm = activeSettings.lines.rpm.unit ?? 'RPM';
        const timeFmt: TimeDisplayFormat = chartSettings.rheologyUnits?.timeFormat ?? 'seconds';

        // Helpers to format X-axis ticks & tooltips (data is always in minutes)
        const fmtTimeTick = (minVal: number): string => {
            switch (timeFmt) {
                case 'seconds': return String(Math.round(minVal * 60));
                case 'hh:mm:ss': {
                    const totalSec = Math.round(minVal * 60);
                    const h = Math.floor(totalSec / 3600);
                    const m = Math.floor((totalSec % 3600) / 60);
                    const s = totalSec % 60;
                    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
                }
                default: return String(Math.round(minVal * 10) / 10);
            }
        };
        const timeAxisUnit = (lang: string) => {
            switch (timeFmt) {
                case 'seconds':  return lang === 'en' ? 'sec' : 'с';
                case 'hh:mm:ss': return lang === 'en' ? 'hh:mm:ss' : 'чч:мм:сс';
                default:         return lang === 'en' ? 'min' : 'мин';
            }
        };

        // Localised pressure label (bar → бар in Russian)
        const pressLabel = (unit: PressureUnit, lang: string) => {
            if (lang !== 'ru') return unit;
            switch (unit) {
                case 'bar': return 'бар';
                default: return unit;
            }
        };

        // ── Translations (unit-aware) ────────────────────────────────────────
        const t = language === 'en' ? {
            timeAxis: `Time (${timeAxisUnit('en')})`,
            viscosityAxis: `Viscosity (${uVisc})`,
            temperatureAxis: `Temperature (${uTemp})`,
            bathTempAxis: `Bath Temp. (${uBath})`,
            tempBathCombinedAxis: `Temp. / Bath Temp. (${uTemp})`,
            shearRateAxis: `Shear Rate (${uShear})`,
            pressureAxis: `Pressure (${uPress})`,
            rpmAxis: uRpm,
            seriesTime: 'Time',
            seriesViscosity: 'Viscosity',
            seriesTemperature: 'Temperature',
            seriesShearRate: 'Shear Rate',
            seriesPressure: 'Pressure',
            seriesRpm: 'RPM',
            seriesBathTemp: 'Bath Temp.',
            tooltipUnits: ['', uVisc, uTemp, uShear, uPress, uRpm, uBath] as string[],
            tooltipTimeLabel: (v: number) => `Time: ${fmtTimeTick(v)} ${timeAxisUnit('en')}`,
        } : {
            timeAxis: `Время (${timeAxisUnit('ru')})`,
            viscosityAxis: `Вязкость (${uVisc === 'cP' ? 'сП' : uVisc})`,
            temperatureAxis: `Температура (${uTemp})`,
            bathTempAxis: `Темп. бани (${uBath})`,
            tempBathCombinedAxis: `Температура / Темп. бани (${uTemp})`,
            shearRateAxis: `Скор. сдвига (${uShear === '1/s' ? '1/с' : uShear})`,
            pressureAxis: `Давление (${pressLabel(uPress as PressureUnit, 'ru')})`,
            rpmAxis: `Обороты (${uRpm === 'RPM' ? 'об/мин' : uRpm})`,
            seriesTime: 'Время',
            seriesViscosity: 'Вязкость',
            seriesTemperature: 'Температура',
            seriesShearRate: 'Скор. сдвига',
            seriesPressure: 'Давление',
            seriesRpm: 'Обороты',
            seriesBathTemp: 'Темп. бани',
            tooltipUnits: ['', uVisc === 'cP' ? 'сП' : uVisc, uTemp, uShear === '1/s' ? '1/с' : uShear, pressLabel(uPress as PressureUnit, 'ru'), uRpm === 'RPM' ? 'об/мин' : uRpm, uBath] as string[],
            tooltipTimeLabel: (v: number) => `Время: ${fmtTimeTick(v)} ${timeAxisUnit('ru')}`,
        };
        const axisColor = isDark ? '#475569' : '#cbd5e1';
        // Apply gridOpacity to grid stroke color
        const gridColorOpa = (() => {
            const op = activeSettings.gridOpacity ?? 1;
            if (op >= 1) return gridColor;
            const hex = gridColor.replace('#', '');
            return `rgba(${parseInt(hex.slice(0,2),16)},${parseInt(hex.slice(2,4),16)},${parseInt(hex.slice(4,6),16)},${op})`;
        })();

        // Helper to convert dasharray string to array of numbers
        const parseDash = (dashStr?: string) => {
            if (!dashStr) return [];
            return dashStr.split(' ').map(Number);
        };

        const isShared = axisMode === 'shared';
        // Compute per-metric uPlot scale names
        const sViscosity   = isShared ? 'left' : 'viscosity';
        const sTemperature = isShared ? 'right' : 'temperature';
        const sShearRate   = isShared ? (effectiveShearRateAxis === 'right' ? 'right' : 'left') : 'shearRate';
        const sPressure    = isShared ? (effectivePressureAxis   === 'right' ? 'right' : 'left') : 'pressure';
        const sRpm         = isShared ? (activeSettings.lines.rpm.axis === 'right' ? 'right' : 'left') : 'rpm';
        // Bath temperature shares the same Y scale as sample temperature (same °C units)
        const sBathTemperature = sTemperature;

        // Update the scaleName in the ref so the draw-hook reads it.
        touchPointsRef.current = { ...touchPointsRef.current, scaleName: sViscosity };

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
                }
            },
            plugins: [
                ...(!captureMode && !pdfMode && chartSettings.tooltipEnabled !== false ? [tooltipPlugin({
                    formatter: (idx: number, val: number) => {
                        const units = t.tooltipUnits;
                        return `${val} ${units[idx] ?? ''}`;
                    },
                    titleFormatter: (val: number) => t.tooltipTimeLabel(val),
                    isDark,
                })] : []),
                zoomPlugin(),
                touchPointsPlugin(touchPointsRef),
            ],
            scales: {
                x: { time: false },
                ...(isShared ? {
                    left:  { auto: true },
                    right: { auto: true },
                } : {
                    viscosity:   { auto: true },
                    temperature: { auto: true },
                    shearRate:   { auto: true },
                    pressure:    { auto: true },
                    rpm:         { auto: true },
                }),
            },
            axes: (() => {
                const xAxis: uPlot.Axis = {
                    scale: 'x',
                    label: t.timeAxis,
                    labelSize: 20,
                    labelFont: '12px sans-serif',
                    font: '12px sans-serif',
                    stroke: textColor,
                    grid: { show: activeSettings.showGridLines !== false, stroke: gridColorOpa, width: 1, dash: [3, 3] },
                    ticks: { stroke: axisColor, width: 1 },
                    ...(timeFmt !== 'minutes' ? { values: (_u: uPlot, vals: number[]) => vals.map(v => fmtTimeTick(v)) } : {}),
                };
                if (isShared) {
                    const leftLabels = [t.viscosityAxis];
                    if (showShearRate && effectiveShearRateAxis !== 'right') leftLabels.push(t.shearRateAxis);
                    if (showPressure && effectivePressureAxis !== 'right')   leftLabels.push(t.pressureAxis);
                    if (showRpm     && activeSettings.lines.rpm.axis !== 'right') leftLabels.push(t.rpmAxis);
                    const rightLabels: string[] = [];
                    if (showTemperature) rightLabels.push(t.temperatureAxis);
                    if (showShearRate && effectiveShearRateAxis === 'right') rightLabels.push(t.shearRateAxis);
                    if (showPressure && effectivePressureAxis   === 'right') rightLabels.push(t.pressureAxis);
                    if (showRpm     && activeSettings.lines.rpm.axis === 'right') rightLabels.push(t.rpmAxis);
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
                        label: showTemperature && showBathTemperature
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
            })(),
            series: [
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
            ],
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- touchPoints/showTouchPoints/targetTime/viscosityThreshold/tooltipEnabled are read from a ref inside the draw hook (no chart recreation needed)
    }, [activeSettings, showTemperature, showShearRate, showPressure, showRpm, showBathTemperature, pdfMode, captureMode, effectiveShearRateAxis, effectivePressureAxis, axisMode, resolvedTheme, language]);
}
