import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Activity, BarChart3 } from 'lucide-react';
import { useTheme } from '@/contexts/theme-context';
import type { CalibrationDataPoint } from '@/types/calibration';
import { domainOf, mkScale, axisTicks, fmt, smoothPath, PAD, MONO } from './chart-utils';
import { HysteresisTooltip, LinearityTooltip, type TooltipPos } from './calibration-tooltips';

const BSL_R1_GEOMETRY = { FACTOR_1: 1.0678 };
function calculateStressAtViscosity(v: number, rpm: number, f: number) { return (v * rpm * f) / 100; }

interface CalibrationChartsProps { data: CalibrationDataPoint[]; }

// ── Resize hook ─────────────────────────────────────────────────────────────
function useContainerSize(ref: React.RefObject<HTMLDivElement | null>) {
    const [size, setSize] = useState({ width: 0, height: 0 });
    useEffect(() => {
        const el = ref.current; if (!el) return;
        const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
        update();
        const ro = new ResizeObserver(update); ro.observe(el);
        return () => ro.disconnect();
    }, [ref]);
    return size;
}

// ══════════════════════════════════════════════════════════════════════════════
// ACCURACY CHART
// ══════════════════════════════════════════════════════════════════════════════
interface AccuracyChartProps { data: CalibrationDataPoint[]; width: number; height: number; stressAt100cP: number; isDark?: boolean; }

function AccuracyChart({ data, width, height, stressAt100cP, isDark = true }: AccuracyChartProps) {
    const C_GRID = isDark ? '#334155' : '#e2e8f0';
    const C_AXIS = isDark ? '#64748b' : '#475569';
    const C_TICK = isDark ? '#94a3b8' : '#334155';
    const pw = Math.max(width - PAD.l - PAD.r, 10);
    const ph = Math.max(height - PAD.t - PAD.b, 10);
    const clipId = `acc-clip-${width}-${height}`;

    const mid = Math.floor(data.length / 2);
    const upCycle = data.slice(0, mid);
    const downCycle = data.slice(mid);

    const allX = data.map(d => d.shearStress).filter(isFinite);
    const allY = data.map(d => d.error).filter(isFinite);
    const xDom = domainOf(allX);
    const yRaw = domainOf(allY);
    const yDom: [number, number] = [Math.min(yRaw[0], -0.5), Math.max(yRaw[1], 0.5)];
    const sx = mkScale(xDom, pw);
    const sy = mkScale(yDom, ph, true);
    const xTicks = axisTicks(xDom);
    const yTicks = axisTicks(yDom);

    const upPath = smoothPath(upCycle.filter(d => isFinite(d.shearStress) && isFinite(d.error)).map(d => [sx(d.shearStress), sy(d.error)]));
    const downPath = smoothPath(downCycle.filter(d => isFinite(d.shearStress) && isFinite(d.error)).map(d => [sx(d.shearStress), sy(d.error)]));

    // Precompute pixel positions for all points for nearest-point lookup.
    // No useMemo here: sx/sy are recreated by mkScale() on every render so
    // the deps would change every render anyway, defeating memoization.
    // The point set is small (≤ 100 calibration points) so inline is fine.
    const upPts = upCycle.filter(d => isFinite(d.shearStress) && isFinite(d.error))
        .map(d => ({ d, px: sx(d.shearStress), py: sy(d.error), isUp: true }));
    const downPts = downCycle.filter(d => isFinite(d.shearStress) && isFinite(d.error))
        .map(d => ({ d, px: sx(d.shearStress), py: sy(d.error), isUp: false }));
    const allPts = [...upPts, ...downPts];

    const [active, setActive] = useState<{ d: CalibrationDataPoint; px: number; py: number; isUp: boolean } | null>(null);

    // No useCallback: allPts is recreated every render (sx/sy aren't
    // stable), so memoization can't help.  The handler is small.
    const handleMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const mx = e.clientX - rect.left; // relative to SVG origin (already offset by PAD in the g transform)
        const my = e.clientY - rect.top;
        // Find nearest point by 2D pixel distance
        let best: (typeof allPts)[0] | null = null;
        let bestDist = Infinity;
        for (const pt of allPts) {
            const dx = pt.px - mx, dy = pt.py - my;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bestDist) { bestDist = dist; best = pt; }
        }
        if (best && bestDist < 60) setActive(best);
        else setActive(null);
    };

    const tooltipPos: TooltipPos | null = active
        ? { left: active.px + PAD.l, top: active.py + PAD.t }
        : null;

    return (
        <div style={{ position: 'relative', width, height }}>
            <svg width={width} height={height} style={{ display: 'block' }} role="img" aria-label="Диаграмма точности калибровки">
                <defs>
                    <clipPath id={clipId}><rect x={0} y={0} width={pw} height={ph} /></clipPath>
                </defs>
                <g transform={`translate(${PAD.l},${PAD.t})`}>
                    {xTicks.map((v, i) => <line key={`gx${i}`} x1={sx(v)} y1={0} x2={sx(v)} y2={ph} stroke={C_GRID} strokeWidth={1} strokeDasharray="3,3" />)}
                    {yTicks.map((v, i) => <line key={`gy${i}`} x1={0} y1={sy(v)} x2={pw} y2={sy(v)} stroke={C_GRID} strokeWidth={1} strokeDasharray="3,3" />)}
                    <line x1={0} y1={sy(0)} x2={pw} y2={sy(0)} stroke={C_AXIS} strokeWidth={1} strokeDasharray="4,3" />

                    <g clipPath={`url(#${clipId})`}>
                        <path d={upPath} fill="none" stroke="#f59e0b" strokeWidth={2} />
                        <path d={downPath} fill="none" stroke="#22d3ee" strokeWidth={2} />
                        {/* Regular dots */}
                        {upPts.map((pt, i) => (
                            <circle key={`u${i}`} cx={pt.px} cy={pt.py}
                                r={active?.d === pt.d ? 6 : 3}
                                fill="#f59e0b"
                                stroke={active?.d === pt.d ? 'rgba(245,158,11,0.4)' : 'none'}
                                strokeWidth={active?.d === pt.d ? 5 : 0} />
                        ))}
                        {downPts.map((pt, i) => (
                            <circle key={`d${i}`} cx={pt.px} cy={pt.py}
                                r={active?.d === pt.d ? 6 : 3}
                                fill="#22d3ee"
                                stroke={active?.d === pt.d ? 'rgba(34,211,238,0.4)' : 'none'}
                                strokeWidth={active?.d === pt.d ? 5 : 0} />
                        ))}
                        {/* Vertical crosshair at active point */}
                        {active && (
                            <line x1={active.px} y1={0} x2={active.px} y2={ph}
                                stroke={C_AXIS} strokeWidth={1} strokeDasharray="3,2" strokeOpacity={0.6} />
                        )}
                        {/* Transparent overlay for mouse tracking — must be on top */}
                        <rect x={0} y={0} width={pw} height={ph} fill="transparent"
                            onMouseMove={handleMouseMove}
                            onMouseLeave={() => setActive(null)}
                            style={{ cursor: 'crosshair' }} />
                    </g>

                    <rect x={0} y={0} width={pw} height={ph} fill="none" stroke={C_GRID} strokeWidth={1} />

                    {xTicks.map((v, i) => (
                        <g key={`xt${i}`} transform={`translate(${sx(v)},${ph})`}>
                            <line y2={4} stroke={C_AXIS} strokeWidth={1} />
                            <text y={15} textAnchor="middle" fill={C_TICK} fontSize={9} fontFamily={MONO}>{fmt(v, 0)}</text>
                        </g>
                    ))}
                    {yTicks.map((v, i) => (
                        <g key={`yt${i}`} transform={`translate(0,${sy(v)})`}>
                            <line x2={-4} stroke={C_AXIS} strokeWidth={1} />
                            <text x={-7} textAnchor="end" dominantBaseline="middle" fill={C_TICK} fontSize={9} fontFamily={MONO}>{fmt(v, 2)}</text>
                        </g>
                    ))}
                    <text x={pw / 2} y={ph + 38} textAnchor="middle" fill={C_AXIS} fontSize={10} fontFamily="sans-serif">Напряжение сдвига (дин/см²)</text>
                    <text transform={`rotate(-90) translate(${-ph / 2},${-50})`} textAnchor="middle" fill={C_AXIS} fontSize={10} fontFamily="sans-serif">Ошибка (дин/см²)</text>
                </g>
            </svg>
            {active && tooltipPos && (
                <HysteresisTooltip pos={tooltipPos} d={active.d} isUp={active.isUp} stressAt100cP={stressAt100cP} width={width} />
            )}
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// LINEARITY CHART
// ══════════════════════════════════════════════════════════════════════════════
interface LinearityChartProps { data: CalibrationDataPoint[]; width: number; height: number; stressAt100cP: number; isDark?: boolean; }

function LinearityChart({ data, width, height, stressAt100cP, isDark = true }: LinearityChartProps) {
    const C_GRID = isDark ? '#334155' : '#e2e8f0';
    const C_AXIS = isDark ? '#64748b' : '#475569';
    const C_TICK = isDark ? '#94a3b8' : '#334155';
    const pw = Math.max(width - PAD.l - PAD.r, 10);
    const ph = Math.max(height - PAD.t - PAD.b, 10);
    const clipId = `lin-clip-${width}-${height}`;

    const withSignal = useMemo(() => data.filter(d => d.signal != null && isFinite(d.signal!)), [data]);
    const sortedBySignal = useMemo(() => [...withSignal].sort((a, b) => a.signal! - b.signal!), [withSignal]);

    const allX = withSignal.map(d => d.signal!);
    const allYL = withSignal.flatMap(d => [d.shearStress, d.calculatedStress]).filter(isFinite);
    const allYR = withSignal.map(d => d.error).filter(isFinite);

    const xDom = domainOf(allX);
    const yLDom = domainOf(allYL, 0.05);
    const yRRaw = domainOf(allYR, 0.1);
    const yRDom: [number, number] = [Math.min(yRRaw[0], 0), Math.max(yRRaw[1], 0)];

    const sx = mkScale(xDom, pw);
    const syL = mkScale(yLDom, ph, true);
    const syR = mkScale(yRDom, ph, true);
    const xTicks = axisTicks(xDom);
    const yLTicks = axisTicks(yLDom);
    const yRTicks = axisTicks(yRDom);

    const idealPath = smoothPath(sortedBySignal.filter(d => isFinite(d.calculatedStress)).map(d => [sx(d.signal!), syL(d.calculatedStress)]));

    const errPts = withSignal.filter(d => isFinite(d.error));
    const errorLinePath = errPts.length > 1 ? smoothPath(errPts.map(d => [sx(d.signal!), syR(d.error)])) : '';
    // Smooth area: forward smooth path + straight line back along baseline
    const errorAreaPath = errPts.length > 1 ? (() => {
        const fwd = smoothPath(errPts.map(d => [sx(d.signal!), syR(d.error)]));
        const bwd = [...errPts].reverse().map(d => `L ${sx(d.signal!).toFixed(1)},${syR(0).toFixed(1)}`).join(' ');
        return `${fwd} ${bwd} Z`;
    })() : '';

    // Pixel positions for scatter dots.  See note above: sx/syL are not
    // stable, so useMemo would not help.
    const scatterPts = withSignal.filter(d => isFinite(d.shearStress))
        .map(d => ({ d, px: sx(d.signal!), py: syL(d.shearStress) }));

    const [active, setActive] = useState<{ d: CalibrationDataPoint; px: number; py: number } | null>(null);

    // No useCallback: scatterPts is recreated every render (sx/syL aren't
    // stable), so memoization can't help.
    const handleMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        // Find nearest by X distance only (Recharts-style)
        let best: (typeof scatterPts)[0] | null = null;
        let bestDist = Infinity;
        for (const pt of scatterPts) {
            const dx = Math.abs(pt.px - mx);
            if (dx < bestDist) { bestDist = dx; best = pt; }
        }
        if (best && bestDist < 40) setActive(best);
        else setActive(null);
    };

    const tooltipPos: TooltipPos | null = active
        ? { left: active.px + PAD.l, top: active.py + PAD.t }
        : null;

    return (
        <div style={{ position: 'relative', width, height }}>
            <svg width={width} height={height} style={{ display: 'block' }} role="img" aria-label="График линейности калибровки">
                <defs>
                    <clipPath id={clipId}><rect x={0} y={0} width={pw} height={ph} /></clipPath>
                </defs>
                <g transform={`translate(${PAD.l},${PAD.t})`}>
                    {xTicks.map((v, i) => <line key={`gx${i}`} x1={sx(v)} y1={0} x2={sx(v)} y2={ph} stroke={C_GRID} strokeWidth={1} strokeDasharray="3,3" />)}
                    {yLTicks.map((v, i) => <line key={`gy${i}`} x1={0} y1={syL(v)} x2={pw} y2={syL(v)} stroke={C_GRID} strokeWidth={1} strokeDasharray="3,3" />)}

                    <g clipPath={`url(#${clipId})`}>
                        {errorAreaPath && <path d={errorAreaPath} fill="#f43f5e" fillOpacity={0.12} stroke="none" />}
                        {errorLinePath && <path d={errorLinePath} fill="none" stroke="#f43f5e" strokeWidth={1} strokeOpacity={0.5} />}
                        <path d={idealPath} fill="none" stroke="#64748b" strokeWidth={1.5} strokeDasharray="5,4" />
                        {/* Error dots on the cloud (right Y axis) */}
                        {errPts.map((d, i) => (
                            <circle key={`err${i}`}
                                cx={sx(d.signal!)} cy={syR(d.error)}
                                r={active?.d === d ? 6 : 3}
                                fill="#f43f5e" fillOpacity={active?.d === d ? 1 : 0.7}
                                stroke={active?.d === d ? 'rgba(244,63,94,0.35)' : 'none'}
                                strokeWidth={active?.d === d ? 5 : 0} />
                        ))}
                        {/* Scatter dots (left Y axis) */}
                        {scatterPts.map((pt, i) => (
                            <circle key={i} cx={pt.px} cy={pt.py}
                                r={active?.d === pt.d ? 6 : 4}
                                fill="#22d3ee" fillOpacity={0.9}
                                stroke={active?.d === pt.d ? 'rgba(34,211,238,0.4)' : 'none'}
                                strokeWidth={active?.d === pt.d ? 5 : 0} />
                        ))}
                        {/* Vertical crosshair at active point */}
                        {active && (
                            <line x1={active.px} y1={0} x2={active.px} y2={ph}
                                stroke={C_AXIS} strokeWidth={1} strokeDasharray="3,2" strokeOpacity={0.6} />
                        )}
                        {/* Transparent overlay for mouse tracking */}
                        <rect x={0} y={0} width={pw} height={ph} fill="transparent"
                            onMouseMove={handleMouseMove}
                            onMouseLeave={() => setActive(null)}
                            style={{ cursor: 'crosshair' }} />
                    </g>

                    <rect x={0} y={0} width={pw} height={ph} fill="none" stroke={C_GRID} strokeWidth={1} />

                    {xTicks.map((v, i) => (
                        <g key={`xt${i}`} transform={`translate(${sx(v)},${ph})`}>
                            <line y2={4} stroke={C_AXIS} strokeWidth={1} />
                            <text y={15} textAnchor="middle" fill={C_TICK} fontSize={9} fontFamily={MONO}>{fmt(v, 1)}</text>
                        </g>
                    ))}
                    {yLTicks.map((v, i) => (
                        <g key={`yt${i}`} transform={`translate(0,${syL(v)})`}>
                            <line x2={-4} stroke={C_AXIS} strokeWidth={1} />
                            <text x={-7} textAnchor="end" dominantBaseline="middle" fill={C_TICK} fontSize={9} fontFamily={MONO}>{fmt(v, 0)}</text>
                        </g>
                    ))}
                    {yRTicks.map((v, i) => (
                        <g key={`yr${i}`} transform={`translate(${pw},${syR(v)})`}>
                            <line x2={4} stroke={C_AXIS} strokeWidth={1} />
                            <text x={8} textAnchor="start" dominantBaseline="middle" fill={C_TICK} fontSize={9} fontFamily={MONO}>{fmt(v, 1)}</text>
                        </g>
                    ))}
                    <text x={pw / 2} y={ph + 38} textAnchor="middle" fill={C_AXIS} fontSize={10} fontFamily="sans-serif">Сигнал (град)</text>
                    <text transform={`rotate(-90) translate(${-ph / 2},${-50})`} textAnchor="middle" fill={C_AXIS} fontSize={10} fontFamily="sans-serif">Напряжение сдвига (дин/см²)</text>
                </g>
            </svg>
            {active && tooltipPos && (
                <LinearityTooltip pos={tooltipPos} d={active.d} stressAt100cP={stressAt100cP} width={width} />
            )}
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT
// ══════════════════════════════════════════════════════════════════════════════
export function CalibrationCharts({ data }: CalibrationChartsProps) {
    const stressAt100cP = calculateStressAtViscosity(100, 300, BSL_R1_GEOMETRY.FACTOR_1);
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const accRef = useRef<HTMLDivElement>(null);
    const linRef = useRef<HTMLDivElement>(null);
    const accSize = useContainerSize(accRef);
    const linSize = useContainerSize(linRef);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="p-5 rounded-xl bg-card/50 border border-border/50">
                <div className="flex items-center gap-2 mb-3">
                    <Activity className="w-5 h-5 text-cyan-400" />
                    <h3 className="font-semibold text-foreground">Диаграмма Точности</h3>
                    <div className="flex gap-3 ml-auto">
                        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <svg width="14" height="6"><line x1="0" y1="3" x2="14" y2="3" stroke="#f59e0b" strokeWidth="2"/></svg>
                            Разгон ↑
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <svg width="14" height="6"><line x1="0" y1="3" x2="14" y2="3" stroke="#22d3ee" strokeWidth="2"/></svg>
                            Торможение ↓
                        </span>
                    </div>
                </div>
                <div ref={accRef} className="h-[340px] w-full" style={{ position: 'relative' }}>
                    {accSize.width > 10 && accSize.height > 10 && (
                        <AccuracyChart data={data} width={accSize.width} height={accSize.height} stressAt100cP={stressAt100cP} isDark={isDark} />
                    )}
                </div>
                <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                    Показывает отклонение (ошибку) измеренного значения от идеального при разгоне и торможении.
                    Большая петля указывает на механическое трение (гистерезис).
                </p>
            </div>

            <div className="p-5 rounded-xl bg-card/50 border border-border/50">
                <div className="flex items-center gap-2 mb-3">
                    <BarChart3 className="w-5 h-5 text-cyan-400" />
                    <h3 className="font-semibold text-foreground">Линейность</h3>
                    <div className="flex gap-3 ml-auto flex-wrap">
                        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <svg width="14" height="6"><line x1="0" y1="3" x2="14" y2="3" stroke="#64748b" strokeWidth="1.5" strokeDasharray="4,3"/></svg>
                            Расчётное
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <svg width="8" height="8"><circle cx="4" cy="4" r="3.5" fill="#22d3ee" fillOpacity="0.9"/></svg>
                            Измеренное
                        </span>
                        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                            <svg width="10" height="8"><rect width="10" height="8" fill="#f43f5e" fillOpacity="0.3"/></svg>
                            Ошибка →
                        </span>
                    </div>
                </div>
                <div ref={linRef} className="h-[340px] w-full" style={{ position: 'relative' }}>
                    {linSize.width > 10 && linSize.height > 10 && (
                        <LinearityChart data={data} width={linSize.width} height={linSize.height} stressAt100cP={stressAt100cP} isDark={isDark} />
                    )}
                </div>
                <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                    Сравнение измеренного напряжения (точки) с идеальной прямой (линия). Отклонения указывают на
                    нелинейность пружины или проблемы с электроникой.
                </p>
            </div>
        </div>
    );
}
