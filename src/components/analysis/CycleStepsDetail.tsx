import React from 'react';
import type { RheoStep } from '@/lib/analysis/types';

interface CycleStepsDetailProps {
    cycleId: number;
    cycleIndex: number;
    steps: RheoStep[];
    colSpan: number;
}

export function CycleStepsDetail({ cycleId, cycleIndex, steps, colSpan }: CycleStepsDetailProps) {
    return (
        <tr className="bg-card/30">
            <td colSpan={colSpan} className="p-0">
                <div className="p-4 pl-12 border-t border-border/30">
                    <h4 className="text-sm font-medium text-foreground/80 mb-2">
                        Шаги цикла #{cycleIndex || cycleId} ({steps.length} шагов)
                    </h4>
                    <div className="overflow-x-auto">
                        <table className="max-w-3xl text-xs">
                            <thead>
                                <tr className="border-b border-border/50">
                                    <th className="text-center p-2 text-muted-foreground w-24 whitespace-nowrap">Время (с)</th>
                                    <th className="text-center p-2 text-muted-foreground w-32 whitespace-nowrap">Длительность (с)</th>
                                    <th className="text-center p-2 text-muted-foreground w-40 whitespace-nowrap">Скор. сдвига (1/с)</th>
                                    <th className="text-center p-2 text-muted-foreground w-40 whitespace-nowrap">Напряжение (Па)</th>
                                    <th className="text-center p-2 text-muted-foreground w-32 whitespace-nowrap">Вязкость (сП)</th>
                                    <th className="text-center p-2 text-muted-foreground w-40 whitespace-nowrap">Температура (°C)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {steps.map((step, idx) => {
                                    const isExcluded = 'isIncluded' in step && step.isIncluded === false;
                                    return (
                                        <tr
                                            key={idx}
                                            className={`border-b border-border/30 hover:bg-secondary/20 ${isExcluded ? 'opacity-30' : ''}`}
                                            title={isExcluded ? 'Исключен из расчета' : undefined}
                                        >
                                            <td className="p-2 text-center font-mono text-foreground/80">{step.startTime != null ? step.startTime.toFixed(0) : '—'}</td>
                                            <td className="p-2 text-center font-mono text-foreground/80">{step.duration != null ? step.duration.toFixed(0) + 's' : '—'}</td>
                                            <td className="p-2 text-center font-mono text-foreground/80">{step.avgShearRate != null ? step.avgShearRate.toFixed(1) : '—'}</td>
                                            <td className="p-2 text-center font-mono text-foreground/80">{step.avgShearStress != null ? step.avgShearStress.toFixed(2) : '—'}</td>
                                            <td className="p-2 text-center font-mono text-foreground/80">{step.avgViscosity != null ? step.avgViscosity.toFixed(1) : '—'}</td>
                                            <td className="p-2 text-center font-mono text-foreground/80">{step.avgTemperature != null ? step.avgTemperature.toFixed(1) : '—'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </td>
        </tr>
    );
}
