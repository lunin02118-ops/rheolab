import React, { useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { isFluidType, FLUID_TYPE_BADGE_CLASS, FLUID_TYPE_LABELS } from '@/lib/constants/fluid-types';
import { Eye, Layers, Trash2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { useComparisonStore } from '@/lib/store/comparison-store';
import { deleteExperiment, getExperimentById } from '@/lib/experiments/client';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/ui/button';
import { DeleteExperimentDialog } from './delete-experiment-dialog';
import { TEST_CATEGORY_LABELS, TEST_TYPE_LABELS, type TestCategory, type TestType } from '@/lib/constants/test-types';
import { CYCLE_TYPE_STYLES, DOMINANT_PATTERN_LABELS, type CycleTypeName } from '@/lib/analysis/constants';
import { ExperimentCardItem } from '@/types/experiment-list-item';
import { shortInstrumentLabel } from '@/lib/utils/instrument-labels';
import { storedToComparisonExperiment } from '@/lib/store/comparison-helpers';

const TEST_CATEGORY_BADGE: Record<TestCategory, string> = {
    Fracturing: 'bg-orange-100 dark:bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-400 dark:border-orange-500/30',
    Drilling:   'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-400 dark:border-blue-500/30',
    General:    'bg-muted/15 text-foreground/80 border-border/30',
};

interface ExperimentTableProps {
    experiments: ExperimentCardItem[];
    onDelete?: (id: string) => void;
    /** Server-side sort field — undefined until user clicks a column header */
    sortBy?: string | null;
    sortDir?: 'asc' | 'desc';
    onSortChange?: (field: string, dir: 'asc' | 'desc') => void;
}

export function ExperimentTable({ experiments, onDelete, sortBy = null, sortDir = 'desc', onSortChange }: ExperimentTableProps) {
    const [deleteTarget, setDeleteTarget] = useState<ExperimentCardItem | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const { showToast } = useToast();

    // ---- Sorting (server-side: state lives in ExperimentList, we emit callbacks) ----
    type SortField = 'name' | 'testDate' | 'instrumentType' | 'geometry' | 'fluidType' | 'durationSeconds' | 'avgTemperatureC' | 'avgViscosity' | 'testCategory' | 'testType' | 'dominantPattern';

    const handleSort = (field: SortField) => {
        const newDir: 'asc' | 'desc' = sortBy === field && sortDir === 'asc' ? 'desc' : 'asc';
        onSortChange?.(field, newDir);
    };

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortBy !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-30" />;
        return sortDir === 'asc'
            ? <ArrowUp className="w-3 h-3 ml-1 text-purple-600 dark:text-purple-400" />
            : <ArrowDown className="w-3 h-3 ml-1 text-purple-600 dark:text-purple-400" />;
    };

    const handleDelete = async () => {
        if (!deleteTarget) return;
        setIsDeleting(true);
        setDeleteError(null);
        try {
            const result = await deleteExperiment(deleteTarget.id);
            if (result.success) {
                setDeleteTarget(null);
                onDelete?.(deleteTarget.id);
            } else {
                setDeleteError(result.error || 'Ошибка удаления');
            }
        } catch (_e) {
            setDeleteError('Ошибка сети');
        } finally {
            setIsDeleting(false);
        }
    };

    const handleCompare = useCallback(async (exp: ExperimentCardItem) => {
        const store = useComparisonStore.getState();
        if (store.isInComparison(exp.id)) return;
        try {
            const response = await getExperimentById(exp.id);
            if (response.success && response.experiment) {
                store.addExperiment(storedToComparisonExperiment(response.experiment));
                showToast('Добавлено в сравнение', 'success', 2000);
            } else {
                showToast('Ошибка загрузки данных эксперимента', 'error', 3000);
            }
        } catch {
            showToast('Ошибка загрузки данных эксперимента', 'error', 3000);
        }
    }, [showToast]);

    const formatDuration = useCallback((seconds?: number | null) => {
        if (seconds == null) return '—';
        return `${Math.round(seconds / 60)} мин`;
    }, []);

    const formatTemp = useCallback((temp?: number | null) => {
        if (temp == null) return '—';
        return `${Math.round(temp)}°C`;
    }, []);

    const formatVisc = useCallback((v?: number | null): string | number => {
        if (v == null) return '—';
        return Math.round(v);
    }, []);

    /** Map verbose instrument names to compact model labels for the table. */
    const shortInstrument = useCallback((name?: string) => {
        return shortInstrumentLabel(name);
    }, []);

    // ---- Virtualisation (window-based — no inner scroll container) ----
    const tableRef = useRef<HTMLDivElement | null>(null);
    const headerRef = useRef<HTMLDivElement | null>(null);
    const scrollMirrorRef = useRef<HTMLDivElement | null>(null);
    const parentOffsetRef = useRef(0);
    const ROW_HEIGHT = 80;
    // Minimum pixel width — ensures horizontal scroll on narrow viewports.
    // On wide screens the table stretches to 100 % of its container.
    const MIN_TABLE_WIDTH = 1100;

    // Sync horizontal scroll between header, body, and mirror scrollbar
    useEffect(() => {
        const table = tableRef.current;
        const header = headerRef.current;
        const mirror = scrollMirrorRef.current;
        if (!table || !header || !mirror) return;
        let syncing = false;
        const syncFrom = (source: HTMLDivElement) => () => {
            if (syncing) return;
            syncing = true;
            if (source !== table) table.scrollLeft = source.scrollLeft;
            if (source !== header) header.scrollLeft = source.scrollLeft;
            if (source !== mirror) mirror.scrollLeft = source.scrollLeft;
            syncing = false;
        };
        const onTable = syncFrom(table);
        const onHeader = syncFrom(header);
        const onMirror = syncFrom(mirror);
        table.addEventListener('scroll', onTable);
        header.addEventListener('scroll', onHeader);
        mirror.addEventListener('scroll', onMirror);
        return () => {
            table.removeEventListener('scroll', onTable);
            header.removeEventListener('scroll', onHeader);
            mirror.removeEventListener('scroll', onMirror);
        };
    }, []);

    // Keep scrollMargin in sync with table position on every render
    useLayoutEffect(() => {
        parentOffsetRef.current = tableRef.current?.offsetTop ?? 0;
    });

    const virtualizer = useWindowVirtualizer({
        count: experiments.length,
        estimateSize: () => ROW_HEIGHT,
        overscan: 8,
        scrollMargin: parentOffsetRef.current,
    });

    return (
        <div>
            {/* Sticky header — outside overflow-x container so position:sticky works against the window */}
            <div
                ref={headerRef}
                className="sticky top-[116px] z-10 rounded-t-xl border border-b-0 border-border/50 overflow-x-auto scrollbar-none bg-card"
            >
                <table className="text-left" style={{ tableLayout: 'fixed', width: '100%', minWidth: MIN_TABLE_WIDTH }}>
                    <colgroup>
                        <col style={{ width: '17%' }} />
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '5%' }} />
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '8%' }} />
                    </colgroup>
                    <thead>
                        <tr className="border-b border-border/50">
                            <th scope="col" className="text-xs font-semibold text-foreground uppercase tracking-wider" aria-sort={sortBy === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                <button type="button" onClick={() => handleSort('name')} className="w-full px-3 py-3 flex items-center justify-center hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400 rounded select-none">Название<SortIcon field="name" /></button>
                            </th>
                            <th scope="col" className="text-xs font-semibold text-foreground uppercase tracking-wider" aria-sort={sortBy === 'testDate' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                <button type="button" onClick={() => handleSort('testDate')} className="w-full px-3 py-3 flex items-center justify-center hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400 rounded select-none">Дата<SortIcon field="testDate" /></button>
                            </th>
                            <th scope="col" className="text-xs font-semibold text-foreground uppercase tracking-wider" aria-sort={sortBy === 'instrumentType' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                <button type="button" onClick={() => handleSort('instrumentType')} className="w-full px-3 py-3 flex items-center justify-center hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400 rounded select-none">Прибор<SortIcon field="instrumentType" /></button>
                            </th>
                            <th scope="col" className="text-xs font-semibold text-foreground uppercase tracking-wider" aria-sort={sortBy === 'geometry' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                <button type="button" onClick={() => handleSort('geometry')} className="w-full px-3 py-3 flex items-center justify-center hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400 rounded select-none">Геометрия<SortIcon field="geometry" /></button>
                            </th>
                            <th scope="col" className="text-xs font-semibold text-foreground uppercase tracking-wider" aria-sort={sortBy === 'fluidType' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                <button type="button" onClick={() => handleSort('fluidType')} className="w-full px-3 py-3 flex items-center justify-center hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400 rounded select-none">Тип жидкости<SortIcon field="fluidType" /></button>
                            </th>
                            <th scope="col" className="text-xs font-semibold text-foreground uppercase tracking-wider" aria-sort={sortBy === 'testCategory' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                <button type="button" onClick={() => handleSort('testCategory')} className="w-full px-3 py-3 flex items-center justify-center hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400 rounded select-none">Тип<SortIcon field="testCategory" /></button>
                            </th>
                            <th scope="col" className="text-xs font-semibold text-foreground uppercase tracking-wider" aria-sort={sortBy === 'testType' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                <button type="button" onClick={() => handleSort('testType')} className="w-full px-3 py-3 flex items-center justify-center hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400 rounded select-none">Испытание<SortIcon field="testType" /></button>
                            </th>
                            <th scope="col" className="text-xs font-semibold text-foreground uppercase tracking-wider" aria-sort={sortBy === 'dominantPattern' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                <button type="button" onClick={() => handleSort('dominantPattern')} className="w-full px-3 py-3 flex items-center justify-center hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400 rounded select-none">Методика<SortIcon field="dominantPattern" /></button>
                            </th>
                            <th scope="col" className="text-xs font-semibold text-foreground uppercase tracking-wider" aria-sort={sortBy === 'durationSeconds' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                <button type="button" onClick={() => handleSort('durationSeconds')} className="w-full px-3 py-3 flex items-center justify-center hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400 rounded select-none">Время<SortIcon field="durationSeconds" /></button>
                            </th>
                            <th scope="col" className="text-xs font-semibold text-foreground uppercase tracking-wider" aria-sort={sortBy === 'avgTemperatureC' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                <button type="button" onClick={() => handleSort('avgTemperatureC')} className="w-full px-3 py-3 flex items-center justify-center hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400 rounded select-none">Темп.<SortIcon field="avgTemperatureC" /></button>
                            </th>
                            <th scope="col" className="text-xs font-semibold text-foreground uppercase tracking-wider" aria-sort={sortBy === 'avgViscosity' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                <button type="button" onClick={() => handleSort('avgViscosity')} className="w-full px-3 py-3 flex items-center justify-center hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-400 rounded select-none">Сред. вязк.<SortIcon field="avgViscosity" /></button>
                            </th>
                            <th scope="col" className="px-3 py-3 text-xs font-semibold text-foreground uppercase tracking-wider text-center">Действия</th>
                        </tr>
                    </thead>
                </table>
            </div>

            {/* Table body — horizontal scroll with hidden native scrollbar */}
            <div className="-mt-px rounded-b-xl border border-t-0 border-border/50 overflow-clip">
                <div className="overflow-x-auto scrollbar-none" ref={tableRef}>
                    <table className="text-left" style={{ tableLayout: 'fixed', width: '100%', minWidth: MIN_TABLE_WIDTH }}>
                        <colgroup>
                            <col style={{ width: '17%' }} />
                            <col style={{ width: '7%' }} />
                            <col style={{ width: '9%' }} />
                            <col style={{ width: '6%' }} />
                            <col style={{ width: '13%' }} />
                            <col style={{ width: '6%' }} />
                            <col style={{ width: '8%' }} />
                            <col style={{ width: '8%' }} />
                            <col style={{ width: '6%' }} />
                            <col style={{ width: '5%' }} />
                            <col style={{ width: '7%' }} />
                            <col style={{ width: '8%' }} />
                        </colgroup>
                        <tbody>
                            {/* spacer top */}
                            {virtualizer.getVirtualItems().length > 0 && (
                                <tr style={{ height: virtualizer.getVirtualItems()[0].start - virtualizer.options.scrollMargin }}>
                                    <td colSpan={12} />
                                </tr>
                            )}
                            {virtualizer.getVirtualItems().map((virtualRow) => {
                                const exp = experiments[virtualRow.index];
                                return (
                                    <ExperimentRow
                                        key={exp.id}
                                        exp={exp}
                                        rowIndex={virtualRow.index}
                                        onDelete={setDeleteTarget}
                                        onCompare={handleCompare}
                                        shortInstrument={shortInstrument}
                                        formatDuration={formatDuration}
                                        formatTemp={formatTemp}
                                        formatVisc={formatVisc}
                                    />
                                );
                            })}
                            {/* spacer bottom */}
                            {virtualizer.getVirtualItems().length > 0 && (
                                <tr style={{ height: virtualizer.getTotalSize() - (virtualizer.getVirtualItems().at(-1)?.end ?? 0) }}>
                                    <td colSpan={12} />
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Sticky horizontal scrollbar — always visible at bottom of viewport, synced with header+body */}
            <div
                ref={scrollMirrorRef}
                className="sticky bottom-0 z-20 overflow-x-auto overflow-y-hidden bg-card/95 border-t border-border/50"
                style={{ height: 14 }}
            >
                <div style={{ minWidth: MIN_TABLE_WIDTH, height: 1 }} />
            </div>

            {/* Delete Dialog */}
            <DeleteExperimentDialog
                target={deleteTarget ? { id: deleteTarget.id, name: deleteTarget.name } : null}
                isDeleting={isDeleting}
                error={deleteError}
                onConfirm={handleDelete}
                onCancel={() => {
                    setDeleteTarget(null);
                    setDeleteError(null);
                }}
            />
        </div>
    );
}

// ─── Extracted row — React.memo prevents re-render when parent scrolls ───────

interface ExperimentRowProps {
    exp: ExperimentCardItem;
    rowIndex: number;
    onDelete: (exp: ExperimentCardItem) => void;
    onCompare: (exp: ExperimentCardItem) => void;
    shortInstrument: (name?: string) => string;
    formatDuration: (s?: number | null) => string;
    formatTemp: (t?: number | null) => string;
    formatVisc: (v?: number | null) => string | number;
}

const ExperimentRow = React.memo(function ExperimentRow({
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
