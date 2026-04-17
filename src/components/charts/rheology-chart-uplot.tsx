import React, { useRef, memo, forwardRef } from 'react';
import { UPlotChart } from './uplot-chart';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { StatCard } from '@/components/ui/stat-card';
import { InstrumentBadges, type InstrumentInfo } from '@/components/ui/instrument-badges';
import { useChartResize } from '@/hooks/useChartResize';
import { useRheologyVisibility } from '@/hooks/useRheologyVisibility';
import { useRheologyData, type RheoPoint } from '@/hooks/useRheologyData';
import type { ColumnarData } from '@/types';
import { useRheologyChartOptions } from '@/hooks/useRheologyChartOptions';

// Re-export for callers who import RheoPoint from this module.
export type { RheoPoint };

interface RheologyChartProps {
    data: RheoPoint[];
    columnarData?: ColumnarData | null;
    showTemperature?: boolean;
    showShearRate?: boolean;
    showPressure?: boolean;
    showRpm?: boolean;
    showBathTemperature?: boolean;
    shearRateAxis?: 'left' | 'right';
    pressureAxis?: 'left' | 'right';
    title?: string;
    height?: number | `${number}%`;
    instrumentInfo?: InstrumentInfo;
    captureMode?: boolean;
    pdfMode?: boolean;
    previewMode?: boolean;
    disableAnimations?: boolean;
    showTouchPoints?: boolean;
    viscosityThreshold?: number;
    showTargetTime?: boolean;
    targetTime?: number;
    language?: 'ru' | 'en';
}

export const RheologyChart = memo(forwardRef<HTMLDivElement, RheologyChartProps>(function RheologyChart({
    data,
    columnarData,
    showTemperature: showTemperatureProp,
    showShearRate: showShearRateProp,
    showPressure: showPressureProp,
    showRpm: showRpmProp,
    showBathTemperature: showBathTemperatureProp,
    shearRateAxis = 'left',
    pressureAxis = 'right',
    title,
    height = 400,
    instrumentInfo,
    captureMode = false,
    pdfMode = false,
    previewMode = false,
    disableAnimations: _disableAnimations = false,
    showTouchPoints = false,
    viscosityThreshold = 200,
    showTargetTime = true,
    targetTime = 10,
    language = 'ru',
}: RheologyChartProps, ref) {
    // ── Derived visibility flags & active settings ───────────────────────────
    const {
        activeSettings, chartSettings,
        timeShiftEnabled, downsampleMode,
        showTemperature, showShearRate, showPressure, showRpm, showBathTemperature,
        effectiveShearRateAxis, effectivePressureAxis, axisMode,
    } = useRheologyVisibility({
        previewMode, captureMode,
        showTemperatureProp, showShearRateProp, showPressureProp, showRpmProp, showBathTemperatureProp,
        shearRateAxis, pressureAxis,
    });

    // ── Data processing (downsample, stats, touch points) ──────────────────
    const { uPlotData, stats, touchPoints } = useRheologyData({
        data, columnarData, timeShiftEnabled, downsampleMode,
        captureMode, pdfMode,
        showTouchPoints, viscosityThreshold, showTargetTime, targetTime,
    });

    // ── Chart sizing ────────────────────────────────────────────────────────
    const chartContainerRef = useRef<HTMLDivElement | null>(null);
    const chartHeightNum = typeof height === 'number' ? height : 400;
    const actualChartHeight = pdfMode ? 680 : chartHeightNum;
    const hasData = uPlotData[0].length > 0;
    const chartSize = useChartResize(chartContainerRef, { enabled: !pdfMode && hasData });
    const shouldRenderChart = pdfMode || (chartSize.width > 8 && chartSize.height > 8);
    const chartRenderWidth = pdfMode ? (chartSize.width > 8 ? chartSize.width : 1080) : chartSize.width;
    const chartRenderHeight = pdfMode ? 680 : chartSize.height;

    // ── uPlot options (axes, series, plugins) ──────────────────────────────
    const uPlotOptions = useRheologyChartOptions({
        activeSettings, chartSettings,
        showTemperature, showShearRate, showPressure, showRpm, showBathTemperature,
        pdfMode, captureMode,
        touchPoints, effectiveShearRateAxis, effectivePressureAxis, axisMode,
        viscosityThreshold, showTouchPoints, targetTime,
        language,
    });

    if (!hasData) {
        return (
            <div ref={ref} className="flex items-center justify-center h-[400px] bg-card/50 rounded-xl border border-border">
                <p className="text-muted-foreground">{language === 'en' ? 'No data to display' : 'Нет данных для отображения'}</p>
            </div>
        );
    }

    const content = (
        <div
            ref={!previewMode ? ref : undefined}
            className={`${pdfMode ? 'bg-white' : captureMode ? 'p-0 bg-white' : 'p-6 bg-card border-t border-border'}`}
            style={pdfMode ? { width: 1100, height: 710, padding: 10 } : undefined}
            role="img"
            aria-label="График реологических данных"
        >
            {stats && !captureMode && !pdfMode && !previewMode && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                    <StatCard label="Макс. вязкость" value={`${Math.round(stats.maxVisc)} сП`} color="blue" />
                    <StatCard label="Ср. вязкость" value={`${Math.round(stats.avgVisc)} сП`} color="purple" />
                    <StatCard label="Ср. температура" value={`${Math.round(stats.avgTemp)}°C`} color="orange" />
                    {stats.maxPressure !== null && (
                        <StatCard label="Макс. давление" value={`${Math.round(stats.maxPressure * 10) / 10} бар`} color="green" />
                    )}
                    <StatCard label="Длительность" value={`${Math.round(stats.duration)} мин`} color="green" />
                </div>
            )}

            {/* Touch Points Info Panel */}
            {showTouchPoints && touchPoints.length > 0 && (
                <div className={`${pdfMode || captureMode ? 'mb-8 px-0 py-0' : 'mb-4 flex flex-wrap gap-4 px-4 py-2 bg-secondary/50 rounded-lg border border-border/50'}`}>
                    {(pdfMode || captureMode) ? (
                        <div className="text-sm text-slate-900 font-medium">
                            {(() => {
                                const targetPoint = touchPoints.find(tp => tp.type === 'target');
                                const thresholdPoint = touchPoints.find(tp => tp.type === 'threshold');
                                return (
                                    <>
                                        {targetPoint && (
                                            language === 'en'
                                                ? <span>At minute <b>{targetTime}</b>, viscosity was <b>{Math.round(targetPoint.viscosity)}</b> cP. </span>
                                                : <span>На <b>{targetTime}</b> минуте вязкость составила <b>{Math.round(targetPoint.viscosity)}</b> сП. </span>
                                        )}
                                        {thresholdPoint && (
                                            language === 'en'
                                                ? <span>Viscosity dropped to <b>{viscosityThreshold}</b> cP at minute <b>{thresholdPoint.time}</b>.</span>
                                                : <span>Вязкость упала до <b>{viscosityThreshold}</b> сП на <b>{thresholdPoint.time}</b> минуте.</span>
                                        )}
                                    </>
                                );
                            })()}
                        </div>
                    ) : (
                        touchPoints.map((tp, i) => (
                            <div key={i} className="flex items-center gap-2 text-sm">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tp.color }} />
                                <span className="text-foreground/80">
                                    {tp.type === 'threshold' ? (
                                        language === 'en'
                                            ? <>Threshold {viscosityThreshold}cP: <b>{tp.time.toFixed(1)} min</b></>
                                            : <>Порог {viscosityThreshold}cP: <b>{tp.time.toFixed(1)} мин</b></>
                                    ) : (
                                        language === 'en'
                                            ? <>@{targetTime}min: <b>{tp.viscosity.toFixed(1)} cP</b></>
                                            : <>@{targetTime}мин: <b>{tp.viscosity.toFixed(1)} cP</b></>
                                    )}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            )}

            <div ref={chartContainerRef} className="w-full" style={{ height: actualChartHeight }}>
                {shouldRenderChart && (
                    <UPlotChart 
                        options={uPlotOptions} 
                        data={uPlotData} 
                        width={chartRenderWidth} 
                        height={chartRenderHeight} 
                        redrawTrigger={touchPoints}
                    />
                )}
            </div>

            {/* Custom Legend */}
            {shouldRenderChart && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', flexWrap: 'wrap', paddingTop: '10px', paddingBottom: pdfMode ? '40px' : '0' }}>
                    {uPlotOptions.series.slice(1).map((s, index) => {
                        if (s.show === false) return null;
                        return (
                            <span key={`legend-${index}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                <svg width="24" height="10" style={{ display: 'block' }}>
                                    <line
                                        x1="0" y1="5" x2="24" y2="5"
                                        stroke={s.stroke as string}
                                        strokeWidth={s.width ?? 2}
                                        strokeDasharray={s.dash ? s.dash.join(' ') : undefined}
                                    />
                                </svg>
                                <span className="text-foreground" style={{ fontSize: 12 }}>{String(s.label)}</span>
                            </span>
                        );
                    })}
                </div>
            )}
        </div>
    );

    if (captureMode) {
        return <div ref={ref} className="w-full h-full bg-white">{content}</div>;
    }

    if (previewMode) {
        return (
            <div ref={ref} className="bg-card rounded-lg border border-border">
                <div className="flex items-center justify-between p-4 border-b border-border">
                    <span className="text-foreground font-medium">{title || (language === 'en' ? 'Rheology Chart' : 'График реологии')}</span>
                    <InstrumentBadges instrumentInfo={instrumentInfo} />
                </div>
                <div className="p-4">{content}</div>
            </div>
        );
    }

    return (
        <CollapsibleCard
            title={title || (language === 'en' ? 'Rheology Chart' : 'График реологии')}
            headerActions={<InstrumentBadges instrumentInfo={instrumentInfo} />}
            defaultOpen={true}
        >
            {content}
        </CollapsibleCard>
    );
}));
