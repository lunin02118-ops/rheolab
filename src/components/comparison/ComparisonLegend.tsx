import React, { useRef } from 'react';
import type uPlot from 'uplot';

interface ComparisonLegendProps {
    seriesConfig: uPlot.Series[];
    hiddenSeries: Set<number>;
    toggleSeries: (legendIndex: number) => void;
}

export function ComparisonLegend({ seriesConfig, hiddenSeries, toggleSeries }: ComparisonLegendProps) {
    const legendContainerRef = useRef<HTMLDivElement>(null);

    return (
        <div ref={legendContainerRef} className="h-[60px] flex flex-wrap justify-center gap-4 pt-4 overflow-y-auto">
            {seriesConfig.slice(1).map((s, i) => {
                const isHidden = hiddenSeries.has(i);
                return (
                    <div
                        key={i}
                        data-testid="ComparisonLegendItem"
                        data-legend-idx={i}
                        className="flex items-center gap-2 text-xs cursor-pointer select-none transition-opacity duration-200"
                        style={{
                            opacity: isHidden ? 0.35 : 1
                        }}
                        onClick={() => toggleSeries(i)}
                        onMouseEnter={() => {
                            const container = legendContainerRef.current;
                            if (!container) return;
                            const items = container.querySelectorAll<HTMLElement>('[data-legend-idx]');
                            items.forEach(el => {
                                const idx = Number(el.dataset.legendIdx);
                                if (idx !== i && !hiddenSeries.has(idx)) {
                                    el.style.opacity = '0.3';
                                }
                            });
                        }}
                        onMouseLeave={() => {
                            const container = legendContainerRef.current;
                            if (!container) return;
                            const items = container.querySelectorAll<HTMLElement>('[data-legend-idx]');
                            items.forEach(el => {
                                const idx = Number(el.dataset.legendIdx);
                                el.style.opacity = hiddenSeries.has(idx) ? '0.35' : '1';
                            });
                        }}
                        title={isHidden ? 'Нажмите, чтобы показать' : 'Нажмите, чтобы скрыть'}
                    >
                        <svg width="16" height="4" style={{ flexShrink: 0 }} className="mt-px">
                            <line
                                x1="0" y1="2" x2="16" y2="2"
                                stroke={s.stroke as string}
                                strokeWidth="2"
                                strokeDasharray={s.dash ? (s.dash as number[]).join(',') : undefined}
                            />
                        </svg>
                        <span
                            className="transition-colors duration-200 text-foreground"
                            style={{ textDecoration: isHidden ? 'line-through' : 'none' }}
                        >{String(s.label)}</span>
                    </div>
                );
            })}
        </div>
    );
}

