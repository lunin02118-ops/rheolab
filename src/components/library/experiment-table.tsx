import { useState, useCallback, useRef, useLayoutEffect, useEffect } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { useComparisonStore } from '@/lib/store/comparison-store';
import { deleteExperiment, getExperimentById } from '@/lib/experiments/client';
import { useToast } from '@/hooks/useToast';
import { DeleteExperimentDialog } from './delete-experiment-dialog';
import type { ExperimentCardItem } from '@/types/experiment-list-item';
import { shortInstrumentLabel } from '@/lib/utils/instrument-labels';
import { storedToComparisonExperiment } from '@/lib/store/comparison-helpers';
import { ExperimentRow } from './experiment-table/row';

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

