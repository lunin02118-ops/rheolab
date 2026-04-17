import React, { memo } from 'react';
import { CheckCircle2, AlertCircle, Pencil } from 'lucide-react';
import type { RheoCycle } from '@/lib/analysis/types';
import type { GraceCycleResult } from '@/lib/analysis/types';
import { CYCLE_TYPE_STYLES, type CycleTypeName } from '@/lib/analysis/constants';

interface CycleRowProps {
    cycle: RheoCycle;
    result: GraceCycleResult | undefined;
    isExpanded: boolean;
    isExpert: boolean;
    viscosityRates: number[];
    onToggle: () => void;
    onEdit?: () => void;
}

export const CycleRow = memo(function CycleRow({
    cycle,
    result,
    isExpanded,
    isExpert,
    viscosityRates,
    onToggle,
    onEdit
}: CycleRowProps) {
    const hasResult = !!result;
    const isGoodFit = hasResult && result.r2 > 0.9;
    const rowIndex = cycle.cycleIndex || cycle.id;
    const typeStyle = CYCLE_TYPE_STYLES[cycle.type as CycleTypeName] ?? CYCLE_TYPE_STYLES.Custom;

    return (
        <tr
            className="border-b border-border hover:bg-muted/10 cursor-pointer transition-colors"
            onClick={onToggle}
        >
            {/* Expand arrow — rotates 90° when expanded */}
            <td className="py-3 px-2 text-center">
                <span
                    className="inline-block text-base leading-none transition-transform duration-150 text-muted-foreground"
                    style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                >›</span>
            </td>
            {/* Cycle number with green dot */}
            <td className="py-3 px-2 text-center">
                <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                    <span className="font-semibold text-[13px] text-foreground">{rowIndex}</span>
                </span>
            </td>
            {/* Pattern type badge + description */}
            <td className="py-3 px-2 text-center">
                <span
                    className={`inline-block px-2 py-1 rounded text-[11px] font-semibold leading-tight ${typeStyle.bg} ${typeStyle.text}`}
                    title={cycle.description || cycle.type}
                >
                    {cycle.type}
                </span>
                {cycle.description && (
                    <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight max-w-[96px] mx-auto truncate" title={cycle.description}>
                        {cycle.description}
                    </div>
                )}
            </td>
            {hasResult ? (
                <>
                    <td className="py-3 px-3 text-center font-data text-slate-700 dark:text-slate-200">
                        {result.n_prime != null ? result.n_prime.toFixed(4) : '—'}
                    </td>
                    <td className="py-3 px-3 text-center font-data text-slate-700 dark:text-slate-200">
                        {result.K_prime_PaSn != null ? result.K_prime_PaSn.toFixed(4) : '—'}
                    </td>
                    <td className="py-3 px-3 text-center font-data text-slate-700 dark:text-slate-200">
                        {result.K_prime_slot_PaSn != null && isFinite(result.K_prime_slot_PaSn) ? result.K_prime_slot_PaSn.toFixed(4) : '—'}
                    </td>
                    <td className="py-3 px-3 text-center font-data text-slate-700 dark:text-slate-200">
                        {result.K_pipe_PaSn != null && isFinite(result.K_pipe_PaSn) ? result.K_pipe_PaSn.toFixed(4) : '—'}
                    </td>
                    <td className="py-3 px-3 text-center">
                        <span className={`font-data ${isGoodFit ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
                            {result.r2 != null ? result.r2.toFixed(4) : '—'}
                        </span>
                    </td>
                    {/* Dynamic viscosity columns */}
                    {viscosityRates.map(rate => {
                        const val = result.viscosities?.[rate]
                            ?? (rate === 40 ? result.viscAt40 : rate === 100 ? result.viscAt100 : rate === 170 ? result.viscAt170 : undefined);
                        return (
                            <td key={rate} className="py-3 px-3 text-center font-data text-cyan-700 dark:text-cyan-400">
                                {val != null && isFinite(val) ? val.toFixed(1) : '—'}
                            </td>
                        );
                    })}
                    {/* Expert mode: Bingham model columns */}
                    {isExpert && (
                        <>
                            <td className="py-3 px-3 text-center font-data text-slate-700 dark:text-slate-200">
                                {result.bingham_PV_PaS != null ? result.bingham_PV_PaS.toFixed(4) : '—'}
                            </td>
                            <td className="py-3 px-3 text-center font-data text-slate-700 dark:text-slate-200">
                                {result.bingham_YP_Pa != null ? result.bingham_YP_Pa.toFixed(2) : '—'}
                            </td>
                            <td className="py-3 px-3 text-center">
                                <span className={`font-data ${(result.bingham_r2 ?? 0) > 0.9 ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
                                    {result.bingham_r2 != null ? result.bingham_r2.toFixed(4) : '—'}
                                </span>
                            </td>
                        </>
                    )}
                    {/* Status */}
                    <td className="py-3 px-3">
                        <div className="flex items-center justify-center gap-1.5">
                            {isGoodFit ? (
                                <>
                                    <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
                                    <span className="text-xs font-semibold text-green-600 dark:text-green-400">ОК</span>
                                </>
                            ) : (
                                <>
                                    <AlertCircle className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                                    <span className="text-xs font-semibold whitespace-nowrap text-orange-600 dark:text-orange-400">Низкий R²</span>
                                </>
                            )}
                        </div>
                    </td>
                    {/* Edit button (Expert mode) */}
                    {isExpert && onEdit && (
                        <td className="py-3 px-2 text-center">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onEdit();
                                }}
                                className="p-1 hover:bg-secondary/50 rounded transition-colors"
                                title="Редактировать шаги цикла"
                                aria-label="Редактировать шаги цикла"
                            >
                                <Pencil className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                            </button>
                        </td>
                    )}
                </>
            ) : (
                <>
                    {/* Spans: n'(1)+K'(1)+Ks(1)+Kp(1)+R²(1)+viscosities+bingham?+edit? */}
                    <td className="py-3 px-2 text-center text-muted-foreground"
                        colSpan={viscosityRates.length + 5 + (isExpert ? 3 : 0) + (isExpert && !!onEdit ? 1 : 0)}>
                        Недостаточно данных
                    </td>
                    <td className="py-3 px-2">
                        <div className="flex items-center justify-center gap-1.5 text-red-600 dark:text-red-400">
                            <AlertCircle className="w-4 h-4" />
                            <span className="text-xs font-medium">Ошибка</span>
                        </div>
                    </td>
                </>
            )}
        </tr>
    );
});
