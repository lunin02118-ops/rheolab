import React, { useState, memo } from 'react';
import { Info } from 'lucide-react';
import type { RheoCycle } from '@/lib/analysis/types';
import type { GraceCycleResult } from '@/lib/analysis/types';
import { useUIMode } from '@/contexts/ui-mode-context';
import { useAnalysisSettingsStore } from '@/lib/store/analysis-settings-store';
import { useDisplaySettingsStore, getViscosityUnit } from '@/lib/store/display-settings-store';
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
    const unitSystem = useDisplaySettingsStore(s => s.unitSystem);
    const viscUnit = getViscosityUnit(unitSystem);
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
    // Base: expand(1) + cycle(1) + type(1) + n'(1) + K'(1) + Ks(1) + Kp(1) + R²(1) + status(1) = 9
    const baseColCount = 9 + viscosityRates.length;
    // Expert adds PV(1)+YP(1)+R²Bingham(1)=+3, plus edit button only when onEditCycle is provided
    const detailColSpan = isExpert
        ? baseColCount + 3 + (onEditCycle ? 1 : 0)
        : baseColCount;

    return (
        <div className="overflow-hidden">
            <div className="overflow-x-auto max-h-[450px]">
                <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10">
                        <tr className="border-b border-border bg-card">
                            <th className="w-10 py-2 px-2"></th>
                            <th className="w-[60px] py-2 px-2 text-center text-xs font-semibold text-foreground">Цикл</th>
                            <th className="w-28 py-2 px-2 text-center text-xs font-semibold text-foreground">Паттерн</th>
                            <th className="min-w-[80px] py-2 px-3 text-center text-xs font-semibold text-foreground">
                                <span className="cursor-help" title="Индекс течения (n')">n'</span>
                            </th>
                            <th className="min-w-[80px] py-2 px-3 text-center text-xs font-semibold text-foreground whitespace-nowrap">
                                <span className="cursor-help" title="Индекс консистенции (K')">K' (Па·с^n)</span>
                            </th>
                            <th className="min-w-[80px] py-2 px-3 text-center text-xs font-semibold text-foreground whitespace-nowrap">
                                <span className="cursor-help" title="K slot — коэффициент для щели/трещины (ISO 13503-1 ф. 15)">Ks (Па·с^n)</span>
                            </th>
                            <th className="min-w-[80px] py-2 px-3 text-center text-xs font-semibold text-foreground whitespace-nowrap">
                                <span className="cursor-help" title="K pipe — коэффициент для трубы (ISO 13503-1 ф. 16)">Kp (Па·с^n)</span>
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
                            {/* Expert mode: Bingham model columns */}
                            {isExpert && (
                                <>
                                    <th className="min-w-[80px] py-2 px-3 text-center text-xs font-semibold text-foreground whitespace-nowrap">
                                        <span className="cursor-help" title="Пластическая вязкость (Па·с)">PV (Па·с)</span>
                                    </th>
                                    <th className="min-w-[80px] py-2 px-3 text-center text-xs font-semibold text-foreground whitespace-nowrap">
                                        <span className="cursor-help" title="Предел текучести (Па)">YP (Па)</span>
                                    </th>
                                    <th className="min-w-[80px] py-2 px-3 text-center text-xs font-semibold text-foreground whitespace-nowrap">
                                        <span className="cursor-help" title="Модель Бингама R²">R² Bingham</span>
                                    </th>
                                </>
                            )}
                            <th className="min-w-[90px] py-2 px-3 text-center text-xs font-semibold text-foreground">Статус</th>
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
