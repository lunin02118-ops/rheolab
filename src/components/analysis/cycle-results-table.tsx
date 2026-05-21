import React, { useState, memo } from 'react';
import { Info } from 'lucide-react';
import type { RheoCycle } from '@/lib/analysis/types';
import type { GraceCycleResult } from '@/lib/analysis/types';
import { useUIMode } from '@/contexts/ui-mode-context';
import { useAnalysisSettingsStore } from '@/lib/store/analysis-settings-store';
import { useChartSettingsStore, timeUnitLabel } from '@/lib/store/chart-settings-store';
import type { UnitSystem } from '@/lib/store/display-settings-store';
import { DEFAULT_VISCOSITY_SHEAR_RATES } from '@/lib/analysis/constants';
import { CycleRow } from './CycleRow';
import { CycleStepsDetail } from './CycleStepsDetail';

interface CycleResultsTableProps {
    cycles: RheoCycle[];
    results: Map<number, GraceCycleResult>;
    onEditCycle?: (cycleId: number) => void;
}

export const CycleResultsTable = memo(function CycleResultsTable({ cycles, results, onEditCycle }: CycleResultsTableProps) {
    const { isExpert } = useUIMode();
    const expertSettings = useAnalysisSettingsStore(s => s.expertSettings);
    const rUnits = useChartSettingsStore(s => s.settings.rheologyUnits);
    const viscUnit = rUnits.viscosity;
    const unitSystem: UnitSystem = viscUnit === 'Pa·s' ? 'SI_Pas' : viscUnit === 'cP' ? 'Imperial' : 'SI';
    const [expandedCycles, setExpandedCycles] = useState<Set<number>>(new Set());

    // In basic mode, force default shear rates [40, 100, 170] like C# WPF version
    const viscosityRates = (isExpert
        ? (expertSettings.viscosityShearRates || [...DEFAULT_VISCOSITY_SHEAR_RATES])
        : [...DEFAULT_VISCOSITY_SHEAR_RATES]
    ).filter(r => r > 0);

    const toggleCycle = (cycleId: number) => {
        setExpandedCycles(prev => {
            const next = new Set(prev);
            if (next.has(cycleId)) next.delete(cycleId);
            else next.add(cycleId);
            return next;
        });
    };

    if (cycles.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <Info className="w-8 h-8 mb-2 opacity-50" />
                <p>Нет циклов для отображения</p>
                {!isExpert && <p className="text-sm">Попробуйте режим Эксперт</p>}
            </div>
        );
    }

    // Calculate colspan for expanded details
    // Base includes PV/YP/R² Bingham in every UI mode; edit stays expert-only.
    const baseColCount = 13 + viscosityRates.length;
    const detailColSpan = baseColCount + (isExpert && onEditCycle ? 1 : 0);

    return (
        <div className="overflow-hidden">
            <div className="overflow-x-auto max-h-[450px]">
                <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10">
                        <tr className="border-b border-border bg-card">
                            <th className="w-10 py-2 px-2"></th>
                            <th className="w-[60px] py-2 px-2 text-center text-xs font-semibold text-foreground">Цикл</th>
                            <th className="w-28 py-2 px-2 text-center text-xs font-semibold text-foreground">Паттерн</th>
                            <th className="min-w-[80px] py-2 px-2 text-center text-xs font-semibold text-foreground whitespace-nowrap">{(() => { const u = timeUnitLabel(rUnits.timeFormat); return u ? `Время (${u})` : 'Время'; })()}</th>
                            <th className="min-w-[60px] py-2 px-2 text-center text-xs font-semibold text-foreground whitespace-nowrap">Длит. (с)</th>
                            <th className="min-w-[80px] py-2 px-3 text-center text-xs font-semibold text-foreground">
                                <span className="cursor-help" title="Индекс течения (n')">n'</span>
                            </th>
                            <th className="min-w-[80px] py-2 px-3 text-center text-xs font-semibold text-foreground whitespace-nowrap">
                                <span className="cursor-help" title="Индекс консистенции (K')">K' ({rUnits.consistency})</span>
                            </th>
                            <th className="min-w-[80px] py-2 px-3 text-center text-xs font-semibold text-foreground whitespace-nowrap">
                                <span className="cursor-help" title="K slot — коэффициент для щели/трещины (ISO 13503-1 ф. 15)">Ks ({rUnits.consistency})</span>
                            </th>
                            <th className="min-w-[80px] py-2 px-3 text-center text-xs font-semibold text-foreground whitespace-nowrap">
                                <span className="cursor-help" title="K pipe — коэффициент для трубы (ISO 13503-1 ф. 16)">Kp ({rUnits.consistency})</span>
                            </th>
                            <th className="min-w-[80px] py-2 px-3 text-center text-xs font-semibold text-foreground">
                                <span className="cursor-help" title="Коэффициент детерминации">R²</span>
                            </th>
                            {/* Dynamic viscosity columns */}
                            {viscosityRates.map(rate => (
                                <th key={rate} className="min-w-[80px] py-2 px-3 text-center text-xs font-semibold text-cyan-700 dark:text-cyan-400 whitespace-nowrap">
                                    <span className="cursor-help" title={`Вязкость при ${rate} с⁻¹`}>η@{rate} ({viscUnit})</span>
                                </th>
                            ))}
                            <th className="min-w-[80px] py-2 px-3 text-center text-xs font-semibold text-foreground whitespace-nowrap">
                                <span className="cursor-help" title="Пластическая вязкость">PV ({rUnits.plasticViscosity})</span>
                            </th>
                            <th className="min-w-[80px] py-2 px-3 text-center text-xs font-semibold text-foreground whitespace-nowrap">
                                <span className="cursor-help" title="Предел текучести">YP ({rUnits.yieldPoint})</span>
                            </th>
                            <th className="min-w-[80px] py-2 px-3 text-center text-xs font-semibold text-foreground whitespace-nowrap">
                                <span className="cursor-help" title="Модель Бингама R²">R² Bingham</span>
                            </th>
                            {isExpert && onEditCycle && (
                                <th className="w-10 py-2 px-2"></th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {cycles.map((cycle) => {
                            const result = results.get(cycle.id);
                            const isExpanded = expandedCycles.has(cycle.id);

                            return (
                                <React.Fragment key={cycle.id}>
                                    <CycleRow
                                        cycle={cycle}
                                        result={result}
                                        isExpanded={isExpanded}
                                        isExpert={isExpert}
                                        viscosityRates={viscosityRates}
                                        unitSystem={unitSystem}
                                        timeFormat={rUnits.timeFormat}
                                        onToggle={() => toggleCycle(cycle.id)}
                                        onEdit={onEditCycle ? () => onEditCycle(cycle.id) : undefined}
                                    />
                                    {isExpanded && (
                                        <CycleStepsDetail
                                            cycleId={cycle.id}
                                            cycleIndex={cycle.cycleIndex || cycle.id}
                                            steps={cycle.steps}
                                            colSpan={detailColSpan}
                                        />
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
});
