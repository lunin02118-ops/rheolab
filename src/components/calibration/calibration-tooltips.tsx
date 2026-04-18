import React from 'react';
import type { CalibrationDataPoint } from '@/types/calibration';

export interface TooltipPos { left: number; top: number; }

interface HysteresisTooltipProps { pos: TooltipPos; d: CalibrationDataPoint; isUp: boolean; stressAt100cP: number; width: number; }
export function HysteresisTooltip({ pos, d, isUp, stressAt100cP, width }: HysteresisTooltipProps) {
    const relErr = d.shearStress !== 0 ? (d.error / d.shearStress) * 100 : 0;
    const redErr = stressAt100cP ? (d.error / stressAt100cP) * 100 : 0;
    const left = pos.left + 12 + 220 > width ? pos.left - 228 : pos.left + 12;
    const top = Math.max(0, pos.top - 55);
    return (
        <div style={{ position: 'absolute', left, top, pointerEvents: 'none', zIndex: 50 }}
            className="p-3 rounded-lg border shadow-xl bg-card/95 border-border/50 min-w-[200px]">
            <p className="text-[10px] uppercase tracking-widest mb-2 font-bold" style={{ color: isUp ? '#f59e0b' : '#22d3ee' }}>
                {isUp ? '↑ Разгон' : '↓ Торможение'}
            </p>
            <div className="space-y-1 font-mono text-xs">
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Напряжение:</span><span className="text-cyan-400 font-bold">{d.shearStress.toFixed(2)} dyne/cm²</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Ошибка:</span><span className="text-rose-400 font-bold">{d.error.toFixed(3)}</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Относит. ошибка:</span><span className="text-rose-400 font-bold">{Math.abs(relErr).toFixed(2)}%</span></div>
                <div className="flex justify-between gap-4 border-t border-border/50 pt-1 mt-1"><span className="text-muted-foreground">Привед. (100cP):</span><span className="text-foreground font-bold">{redErr.toFixed(2)}%</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Скорость сдвига:</span><span className="text-foreground/80">{d.shearRate.toFixed(2)} 1/s</span></div>
            </div>
        </div>
    );
}

interface LinearityTooltipProps { pos: TooltipPos; d: CalibrationDataPoint; stressAt100cP: number; width: number; }
export function LinearityTooltip({ pos, d, stressAt100cP, width }: LinearityTooltipProps) {
    const relErr = d.shearStress !== 0 ? (d.error / d.shearStress) * 100 : 0;
    const redErr = stressAt100cP ? (d.error / stressAt100cP) * 100 : 0;
    const left = pos.left + 12 + 230 > width ? pos.left - 238 : pos.left + 12;
    const top = Math.max(0, pos.top - 70);
    return (
        <div style={{ position: 'absolute', left, top, pointerEvents: 'none', zIndex: 50 }}
            className="p-3 rounded-lg border shadow-xl bg-card/95 border-border/50 min-w-[210px]">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 font-bold">Линейность</p>
            <div className="space-y-1 font-mono text-xs">
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Сигнал:</span><span className="text-foreground font-bold">{d.signal != null ? d.signal.toFixed(2) : '-'}°</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Измерено:</span><span className="text-cyan-400 font-bold">{d.shearStress.toFixed(2)} dyne/cm²</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Расчётное:</span><span className="text-muted-foreground">{d.calculatedStress.toFixed(2)} dyne/cm²</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Ошибка:</span><span className="text-rose-400 font-bold">{d.error.toFixed(3)}</span></div>
                <div className="flex justify-between gap-4"><span className="text-muted-foreground">Относит. ошибка:</span><span className="text-rose-400 font-bold">{Math.abs(relErr).toFixed(2)}%</span></div>
                <div className="flex justify-between gap-4 border-t border-border/50 pt-1 mt-1"><span className="text-muted-foreground">Привед. (100cP):</span><span className="text-foreground font-bold">{redErr.toFixed(2)}%</span></div>
            </div>
        </div>
    );
}
