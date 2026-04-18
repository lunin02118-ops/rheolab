import React from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { isFluidType, FLUID_TYPE_BADGE_CLASS, FLUID_TYPE_LABELS } from '@/lib/constants/fluid-types';
import { Eye, Layers, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TEST_CATEGORY_LABELS, TEST_TYPE_LABELS, type TestCategory, type TestType } from '@/lib/constants/test-types';
import { CYCLE_TYPE_STYLES, DOMINANT_PATTERN_LABELS, type CycleTypeName } from '@/lib/analysis/constants';
import { ExperimentCardItem } from '@/types/experiment-list-item';

export const TEST_CATEGORY_BADGE: Record<TestCategory, string> = {
    Fracturing: 'bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-400 dark:border-orange-500/30',
    Drilling:   'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-400 dark:border-blue-500/30',
    General:    'bg-muted/15 text-foreground/80 border-border/30',
};

export interface ExperimentRowProps {
    exp: ExperimentCardItem;
    rowIndex: number;
    onDelete: (exp: ExperimentCardItem) => void;
    onCompare: (exp: ExperimentCardItem) => void;
    shortInstrument: (name?: string) => string;
    formatDuration: (s?: number | null) => string;
    formatTemp: (t?: number | null) => string;
    formatVisc: (v?: number | null) => string | number;
}

export const ExperimentRow = React.memo(function ExperimentRow({
    exp,
    rowIndex,
    onDelete,
    onCompare,
    shortInstrument,
    formatDuration,
    formatTemp,
    formatVisc,
}: ExperimentRowProps) {
    const fluidBadgeClass = isFluidType(exp.fluidType)
        ? FLUID_TYPE_BADGE_CLASS[exp.fluidType]
        : 'bg-muted/20 text-foreground/80 border-border/30';
    const fluidLabel = isFluidType(exp.fluidType)
        ? FLUID_TYPE_LABELS[exp.fluidType]
        : exp.fluidType;
    const date = new Date(exp.testDate);
    const reagentName = exp.reagents?.[0]?.reagentName ?? '';

    // testCategory badge
    const catLabel = exp.testCategory && exp.testCategory in TEST_CATEGORY_LABELS
        ? TEST_CATEGORY_LABELS[exp.testCategory as TestCategory]
        : exp.testCategory ?? null;
    const catBadge = exp.testCategory && exp.testCategory in TEST_CATEGORY_BADGE
        ? TEST_CATEGORY_BADGE[exp.testCategory as TestCategory]
        : 'bg-muted/15 text-foreground/80 border-border/30';

    // testType short label
    const typeLabel = exp.testType && exp.testType in TEST_TYPE_LABELS
        ? TEST_TYPE_LABELS[exp.testType as TestType]
        : exp.testType ?? null;

    // dominantPattern badge
    const patternStyle = exp.dominantPattern && exp.dominantPattern in CYCLE_TYPE_STYLES
        ? CYCLE_TYPE_STYLES[exp.dominantPattern as CycleTypeName]
        : null;

    return (
        <tr
            data-testid={`ExperimentRow_${exp.id}`}
            className={`border-b border-border/50 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors group ${rowIndex % 2 === 0 ? 'bg-white dark:bg-transparent' : 'bg-slate-100 dark:bg-white/[0.04]'}`}
        >
            {/* Название + Месторождение */}
            <td className="px-3 py-3 text-center max-w-[200px]">
                <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground group-hover:text-blue-400 transition-colors truncate" title={exp.name}>
                        {exp.name}
                    </div>
                    {exp.fieldName && (
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                            <span className="text-muted-foreground">Месторождение: </span>{exp.fieldName}
                        </div>
                    )}
                </div>
            </td>

            {/* Дата */}
            <td className="px-3 py-3 text-center">
                <div className="text-sm text-foreground">
                    {format(date, 'dd.MM.yy', { locale: ru })}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                    {format(date, 'HH:mm')}
                </div>
            </td>

            {/* Прибор */}
            <td className="px-3 py-3 text-center">
                <span className="text-xs text-foreground/80 truncate block" title={exp.instrumentType ?? undefined}>
                    {shortInstrument(exp.instrumentType ?? undefined)}
                </span>
            </td>

            {/* Геометрия */}
            <td className="px-3 py-3 text-center">
                <span className="text-sm text-foreground truncate block">
                    {exp.geometry || '—'}
                </span>
            </td>

            {/* Жидкость */}
            <td className="px-3 py-3 text-center">
                <span className={`inline-block px-1.5 py-0.5 rounded border text-xs font-medium mb-1 ${fluidBadgeClass}`}>
                    {fluidLabel}
                </span>
                {reagentName && (
                    <div className="text-xs text-muted-foreground truncate">
                        {reagentName}
                    </div>
                )}
            </td>

            {/* Тип эксперимента */}
            <td className="px-2 py-3 text-center">
                {catLabel
                    ? <span className={`inline-block px-1.5 py-0.5 rounded border text-xs font-medium ${catBadge}`}>{catLabel}</span>
                    : <span className="text-xs text-muted-foreground">—</span>
                }
            </td>

            {/* Метод/тест */}
            <td className="px-2 py-3 text-center">
                {typeLabel
                    ? <span className="text-xs text-foreground/80 leading-tight block truncate" title={typeLabel}>{typeLabel}</span>
                    : <span className="text-xs text-muted-foreground">—</span>
                }
            </td>

            {/* Методика (dominantPattern) */}
            <td className="px-2 py-3 text-center">
                {patternStyle
                    ? <span
                        className={`inline-block px-1.5 py-0.5 rounded text-xs font-bold ${patternStyle.bg} ${patternStyle.text}`}
                      >{DOMINANT_PATTERN_LABELS[exp.dominantPattern as CycleTypeName] ?? exp.dominantPattern}</span>
                    : <span className="text-xs text-muted-foreground">—</span>
                }
            </td>

            {/* Время */}
            <td className="px-3 py-3 text-center">
                <span className="text-sm text-foreground">
                    {formatDuration(exp.durationSeconds)}
                </span>
            </td>

            {/* Температура */}
            <td className="px-3 py-3 text-center">
                <span className="text-sm text-foreground">
                    {formatTemp(exp.avgTemperatureC)}
                </span>
            </td>

            {/* Сред. вязк. */}
            <td className="px-3 py-3 text-center">
                <span className="text-sm font-bold text-orange-600 dark:text-orange-400">
                    {formatVisc(exp.avgViscosity)}
                </span>
                {exp.avgViscosity != null && (
                    <span className="text-xs text-orange-600/70 dark:text-orange-400/70 ml-1">сП</span>
                )}
            </td>

            {/* Действия */}
            <td className="px-3 py-3">
                <div className="flex items-center justify-center gap-1">
                    <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-500/10"
                        title="Открыть"
                        aria-label="Открыть эксперимент"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Link to={`/dashboard?loadExperimentId=${exp.id}`}>
                            <Eye className="w-4 h-4" />
                        </Link>
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 hover:bg-orange-500/10"
                        title="Сравнить"
                        aria-label="Добавить в сравнение"
                        onClick={(e) => {
                            e.stopPropagation();
                            onCompare(exp);
                        }}
                    >
                        <Layers className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                        title="Удалить"
                        aria-label="Удалить эксперимент"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(exp);
                        }}
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                </div>
            </td>
        </tr>
    );
});
