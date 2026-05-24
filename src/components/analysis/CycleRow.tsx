import React, { memo } from 'react';
import { AlertCircle, Pencil } from 'lucide-react';
import type { RheoCycle } from '@/lib/analysis/types';
import type { GraceCycleResult } from '@/lib/analysis/types';
import { CYCLE_TYPE_STYLES, type CycleTypeName } from '@/lib/analysis/constants';
import type { RheologyUnits, TimeDisplayFormat } from '@/lib/store/chart-settings-types';
import { formatTime } from '@/lib/store/chart-settings-defaults';
import {
    consistencyDecimals,
    convertConsistencyIndex,
    convertPlasticViscosity,
    convertViscosity,
    convertYieldPoint,
    plasticViscosityDecimals,
    viscosityDecimals,
    yieldPointDecimals,
} from '@/lib/utils/unit-converters';

interface CycleRowProps {
    cycle: RheoCycle;
    result: GraceCycleResult | undefined;
    isExpanded: boolean;
    isExpert: boolean;
    viscosityRates: number[];
    rheologyUnits: RheologyUnits;
    timeFormat: TimeDisplayFormat;
    preferResultTiming?: boolean;
    onToggle: () => void;
    onEdit?: () => void;
}

export const CycleRow = memo(function CycleRow({
    cycle,
    result,
    isExpanded,
    isExpert,
    viscosityRates,
    rheologyUnits,
    timeFormat,
    preferResultTiming = false,
    onToggle,
    onEdit
}: CycleRowProps) {
    const hasResult = !!result;
    const rowIndex = cycle.cycleIndex || cycle.id;
    const typeStyle = CYCLE_TYPE_STYLES[cycle.type as CycleTypeName] ?? CYCLE_TYPE_STYLES.Custom;
    const resultDurationSec = result && Number.isFinite(result.endTimeMin - result.timeMin)
        ? Math.max(0, Math.round((result.endTimeMin - result.timeMin) * 60))
        : null;
    const displayStartTime = preferResultTiming && result
        ? formatTime(result.timeMin * 60, timeFormat)
        : (cycle.steps.length > 0 ? formatTime(cycle.steps[0].startTime, timeFormat) : '—');
    const displayDurationSec = preferResultTiming && resultDurationSec !== null
        ? resultDurationSec
        : Math.round(cycle.duration);
    const formatConsistency = (value: number | null | undefined) =>
        value != null && Number.isFinite(value)
            ? convertConsistencyIndex(value, rheologyUnits.consistency)
                .toFixed(consistencyDecimals(rheologyUnits.consistency))
            : '—';
    const formatPlasticViscosity = (value: number | null | undefined) =>
        value != null && Number.isFinite(value)
            ? convertPlasticViscosity(value, rheologyUnits.plasticViscosity)
                .toFixed(plasticViscosityDecimals(rheologyUnits.plasticViscosity))
            : '—';
    const formatYieldPoint = (value: number | null | undefined) =>
        value != null && Number.isFinite(value)
            ? convertYieldPoint(value, rheologyUnits.yieldPoint)
                .toFixed(yieldPointDecimals(rheologyUnits.yieldPoint))
            : '—';

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
            {/* Start time (formatted per settings) */}
            <td className="py-3 px-2 text-center font-data text-slate-700 dark:text-slate-200 whitespace-nowrap">
                {displayStartTime}
            </td>
            {/* Duration (always seconds) */}
            <td className="py-3 px-2 text-center font-data text-slate-700 dark:text-slate-200 whitespace-nowrap">
                {displayDurationSec}
            </td>
            {hasResult ? (
                <>
                    <td className="py-3 px-3 text-center font-data text-slate-700 dark:text-slate-200">
                        {Number.isFinite(result.n_prime) ? result.n_prime.toFixed(4) : '—'}
                    </td>
                    <td className="py-3 px-3 text-center font-data text-slate-700 dark:text-slate-200">
                        {formatConsistency(result.K_prime_PaSn)}
                    </td>
                    <td className="py-3 px-3 text-center font-data text-slate-700 dark:text-slate-200">
                        {formatConsistency(result.K_prime_slot_PaSn)}
                    </td>
                    <td className="py-3 px-3 text-center font-data text-slate-700 dark:text-slate-200">
                        {formatConsistency(result.K_pipe_PaSn)}
                    </td>
                    <td className="py-3 px-3 text-center">
                        <span className={`font-data ${Number.isFinite(result.r2) && result.r2 > 0.9 ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
                            {Number.isFinite(result.r2) ? result.r2.toFixed(4) : '—'}
                        </span>
                    </td>
                    {/* Dynamic viscosity columns */}
                    {viscosityRates.map(rate => {
                        const raw = result.viscosities?.[rate]
                            ?? (rate === 40 ? result.viscAt40 : rate === 100 ? result.viscAt100 : rate === 170 ? result.viscAt170 : undefined);
                        const val = raw != null && isFinite(raw) ? convertViscosity(raw, rheologyUnits.viscosity) : null;
                        const dec = viscosityDecimals(rheologyUnits.viscosity);
                        return (
                            <td key={rate} className="py-3 px-3 text-center font-data text-cyan-700 dark:text-cyan-400">
                                {val != null ? val.toFixed(dec) : '—'}
                            </td>
                        );
                    })}
                    <td className="py-3 px-3 text-center font-data text-slate-700 dark:text-slate-200">
                        {formatPlasticViscosity(result.bingham_PV_PaS)}
                    </td>
                    <td className="py-3 px-3 text-center font-data text-slate-700 dark:text-slate-200">
                        {formatYieldPoint(result.bingham_YP_Pa)}
                    </td>
                    <td className="py-3 px-3 text-center">
                        <span className={`font-data ${Number.isFinite(result.bingham_r2) && result.bingham_r2 > 0.9 ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}`}>
                            {Number.isFinite(result.bingham_r2) ? result.bingham_r2.toFixed(4) : '—'}
                        </span>
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
                    {/* Spans: n'(1)+K'(1)+Ks(1)+Kp(1)+R²(1)+viscosities+Bingham(3)+edit? */}
                    <td className="py-3 px-2 text-center text-muted-foreground"
                        colSpan={viscosityRates.length + 8 + (isExpert && !!onEdit ? 1 : 0)}>
                        <div className="flex items-center justify-center gap-1.5 text-red-600 dark:text-red-400">
                            <AlertCircle className="w-4 h-4" />
                            <span className="text-xs font-medium">Недостаточно данных</span>
                        </div>
                    </td>
                </>
            )}
        </tr>
    );
});
