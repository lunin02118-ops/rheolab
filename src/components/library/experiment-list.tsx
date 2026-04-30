import { logger } from '@/lib/logger';
import { listen } from '@tauri-apps/api/event';

import { useState, useEffect, useCallback, useLayoutEffect, useRef, useMemo } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { ExperimentCard } from './experiment-card';
import { ExperimentTable } from './experiment-table';
import { DeleteExperimentDialog } from './delete-experiment-dialog';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLicense } from '@/hooks/useLicense';
import { listExperiments, deleteExperiment } from '@/lib/experiments/client';
import type { ExperimentFilters } from '@/types/experiment-filters';
import { EMPTY_FILTERS } from '@/types/experiment-filters';
import type { ExperimentCardItem } from '@/types/experiment-list-item';
import { useExperimentFilterMetadata } from '@/hooks/useExperimentFilterMetadata';
import { touchPointEmptyStateMessage } from '@/lib/library/touch-point-hints';
import { emitLibraryFilterPerfEvent } from '@/lib/perf/library-filter-spans';
import {
    changedExperimentFilterKeys,
    getLibraryFilterDebounceDecision,
} from '@/lib/library/filter-debounce';

/**
 * Touch-point RANGE filter keys (not `hasCrossing` — that's a tri-state
 * selector with explicit "no" semantics that doesn't benefit from the
 * "here's why everything disappeared" coaching message).
 *
 * Kept as a module-level tuple so both the active-filter detector and
 * the "reset touch-point filters" handler stay perfectly in sync — a
 * missing entry in one list would otherwise silently reintroduce the
 * bug we're trying to fix.
 */
const TOUCH_POINT_RANGE_KEYS = [
    'crossingTimeMin',
    'crossingTimeMax',
    'viscosityAtTargetMin',
    'viscosityAtTargetMax',
] as const satisfies readonly (keyof ExperimentFilters)[];

interface ExperimentListProps {
    filters: ExperimentFilters;
    viewMode: 'grid' | 'list';
    /**
     * Optional filter mutator — when provided, the empty-state panel can
     * offer a "Reset touch-point filters" shortcut so users aren't stuck
     * in a zero-result state they don't know how to escape.  When omitted
     * (e.g. a read-only preview), the shortcut renders as plain text
     * guidance instead of a clickable button.
     */
    onFiltersChange?: (filters: ExperimentFilters) => void;
}

export function ExperimentList({ filters, viewMode, onFiltersChange }: ExperimentListProps) {
    const [experiments, setExperiments] = useState<ExperimentCardItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [sortBy, setSortBy] = useState<string | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const { refreshExperimentsCount, isDemo } = useLicense();
    // Shared metadata cache — powers the "here's why you got zero results"
    // empty-state explanation below.  Returns null while the first fetch is
    // in flight; we just fall back to the generic "не найдено" text in that
    // window so the message never flashes stale numbers.
    const { metadata } = useExperimentFilterMetadata();

    const hasActiveTouchPointRangeFilter = useMemo(
        () => TOUCH_POINT_RANGE_KEYS.some((k) => filters[k] !== ''),
        [filters],
    );

    const clearTouchPointFilters = useCallback(() => {
        if (!onFiltersChange) return;
        const cleared: ExperimentFilters = { ...filters };
        for (const k of TOUCH_POINT_RANGE_KEYS) {
            cleared[k] = EMPTY_FILTERS[k];
        }
        // Reset the hasCrossing selector and the custom threshold too —
        // otherwise a stale "Да" / "Нет" or a non-default threshold
        // could keep the list empty even after ranges are cleared.
        cleared.hasCrossing = EMPTY_FILTERS.hasCrossing;
        cleared.viscosityThreshold = EMPTY_FILTERS.viscosityThreshold;
        onFiltersChange(cleared);
    }, [filters, onFiltersChange]);

    const handleSortChange = useCallback((field: string, dir: 'asc' | 'desc') => {
        setSortBy(field);
        setSortDir(dir);
        setPage(1);
        setExperiments([]);
    }, []);

    // Grid virtualization: track column count via ResizeObserver so row grouping stays in sync
    const gridRef = useRef<HTMLDivElement>(null);
    const parentOffsetRef = useRef(0);
    const [columns, setColumns] = useState(() =>
        typeof window !== 'undefined'
            ? window.innerWidth >= 1280 ? 3 : window.innerWidth >= 768 ? 2 : 1
            : 3
    );

    useEffect(() => {
        if (!gridRef.current) return;
        const observer = new ResizeObserver(([entry]) => {
            const w = entry.contentRect.width;
            setColumns(w >= 1280 ? 3 : w >= 768 ? 2 : 1);
        });
        observer.observe(gridRef.current);
        return () => observer.disconnect();
    }, []);

    // Group flat experiments array into rows of `columns` items
    const rows = useMemo(() => {
        const result: ExperimentCardItem[][] = [];
        for (let i = 0; i < experiments.length; i += columns) {
            result.push(experiments.slice(i, i + columns));
        }
        return result;
    }, [experiments, columns]);

    // Keep scrollMargin up-to-date every render so virtualizer positions items correctly
    useLayoutEffect(() => {
        parentOffsetRef.current = gridRef.current?.offsetTop ?? 0;
    });

    const rowVirtualizer = useWindowVirtualizer({
        count: viewMode === 'grid' ? rows.length : 0,
        estimateSize: () => 400, // ExperimentCard ~380px + 20px gap
        overscan: 2,
        // TanStack's useWindowVirtualizer API requires a synchronous read
        // of the scroll margin during render; the rule cannot reason about
        // the library's internal scheduling.
        // eslint-disable-next-line react-hooks/refs
        scrollMargin: parentOffsetRef.current,
    });

    // Shared delete dialog state — one Dialog for all cards
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    // Which card has the reagent list expanded (only one at a time)
    const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
    const requestSeqRef = useRef(0);
    const previousFiltersRef = useRef<ExperimentFilters>(filters);
    const completedRequestRef = useRef<{
        requestId: number;
        resultCount: number;
        totalCount: number | null;
    } | null>(null);
    const emittedRenderCommitsRef = useRef<Set<number>>(new Set());

    const handleExpandToggle = useCallback((id: string) => {
        setExpandedCardId(prev => prev === id ? null : id);
    }, []);

    // Stable reference — prevents React.memo on ExperimentCard from busting
    const handleDeleteRequest = useCallback((id: string, name: string) => {
        setDeleteTarget({ id, name });
    }, []);

    const closeDeleteDialog = () => {
        setDeleteTarget(null);
        setDeleteError(null);
    };

    const handleDeleteConfirm = async () => {
        if (!deleteTarget) return;
        setIsDeleting(true);
        setDeleteError(null);
        try {
            const result = await deleteExperiment(deleteTarget.id);
            if (result.success) {
                setExperiments(prev => prev.filter(e => e.id !== deleteTarget.id));
                if (isDemo) void refreshExperimentsCount();
                closeDeleteDialog();
            } else {
                setDeleteError(result.error || 'Ошибка удаления');
            }
        } catch (_e) {
            setDeleteError('Ошибка сети');
        } finally {
            setIsDeleting(false);
        }
    };

    const pageLimit = viewMode === 'list' ? 30 : 12;

    const fetchExperiments = useCallback(async (pageNum: number, reset: boolean = false) => {
        setIsLoading(true);
        try {
            const data = await listExperiments({
                page: pageNum,
                limit: pageLimit,
                ...filters,
                ...(sortBy ? { sortBy, sortDir } : {}),
            });

            if (data.experiments) {
                setExperiments(prev => reset ? data.experiments : [...prev, ...data.experiments]);
                setHasMore(data.pagination.page < data.pagination.totalPages);
                if (reset) setTotalCount(data.pagination.total);
            }
        } catch (err) {
            logger.error('Failed to fetch experiments:', err);
            setFetchError('Ошибка загрузки списка. Повторите позже.');
        } finally {
            setIsLoading(false);
        }
    }, [filters, sortBy, sortDir, pageLimit]);

    // Debounce filters — abort stale responses so a slow query
    // doesn't overwrite results from a newer filter change.
    useEffect(() => {
        let aborted = false;
        const requestId = ++requestSeqRef.current;
        const changedFilterKeys = changedExperimentFilterKeys(previousFiltersRef.current, filters);
        previousFiltersRef.current = filters;
        const debounce = getLibraryFilterDebounceDecision(filters, changedFilterKeys);
        const filterKeys = debounce.activeKeys;
        emitLibraryFilterPerfEvent({
            name: 'debounce_scheduled',
            request_id: requestId,
            filter_keys: filterKeys,
            changed_filter_keys: debounce.changedKeys,
            debounce_ms: debounce.delayMs,
            debounce_reason: debounce.reason,
            page: 1,
            limit: pageLimit,
            view_mode: viewMode,
        });
        const timer = setTimeout(() => {
            const ipcStartedAt = performance.now();
            emitLibraryFilterPerfEvent({
                name: 'debounce_fired',
                request_id: requestId,
                filter_keys: filterKeys,
                changed_filter_keys: debounce.changedKeys,
                debounce_ms: debounce.delayMs,
                debounce_reason: debounce.reason,
                page: 1,
                limit: pageLimit,
                view_mode: viewMode,
            });
            setPage(1);
            setIsLoading(true);
            emitLibraryFilterPerfEvent({
                name: 'ipc_start',
                request_id: requestId,
                filter_keys: filterKeys,
                changed_filter_keys: debounce.changedKeys,
                debounce_ms: debounce.delayMs,
                debounce_reason: debounce.reason,
                page: 1,
                limit: pageLimit,
                view_mode: viewMode,
            });
            listExperiments({ page: 1, limit: pageLimit, ...filters, ...(sortBy ? { sortBy, sortDir } : {}) })
                .then((data) => {
                    if (aborted) return;
                    const resultCount = data.experiments?.length ?? 0;
                    const total = data.pagination?.total ?? null;
                    emitLibraryFilterPerfEvent({
                        name: 'ipc_end',
                        request_id: requestId,
                        filter_keys: filterKeys,
                        changed_filter_keys: debounce.changedKeys,
                        debounce_ms: debounce.delayMs,
                        debounce_reason: debounce.reason,
                        page: 1,
                        limit: pageLimit,
                        view_mode: viewMode,
                        result_count: resultCount,
                        total_count: total,
                        duration_ms: Math.round((performance.now() - ipcStartedAt) * 10) / 10,
                    });
                    setFetchError(null);
                    if (data.experiments) {
                        setExperiments(data.experiments);
                        setHasMore(data.pagination.page < data.pagination.totalPages);
                        setTotalCount(data.pagination.total);
                        completedRequestRef.current = {
                            requestId,
                            resultCount,
                            totalCount: total,
                        };
                    }
                })
                .catch((err) => {
                    if (aborted) return;
                    logger.error('Failed to fetch experiments:', err);
                    setFetchError('Ошибка загрузки списка. Повторите позже.');
                })
                .finally(() => {
                    if (!aborted) setIsLoading(false);
                });
        }, debounce.delayMs);
        return () => { aborted = true; clearTimeout(timer); };
    }, [filters, sortBy, sortDir, pageLimit, viewMode]);

    useLayoutEffect(() => {
        const completed = completedRequestRef.current;
        if (!completed || isLoading || emittedRenderCommitsRef.current.has(completed.requestId)) {
            return;
        }
        emittedRenderCommitsRef.current.add(completed.requestId);
        emitLibraryFilterPerfEvent({
            name: 'render_commit',
            request_id: completed.requestId,
            result_count: completed.resultCount,
            total_count: completed.totalCount,
            page: 1,
            limit: pageLimit,
            view_mode: viewMode,
        });
    }, [experiments, isLoading, pageLimit, totalCount, viewMode]);

    // When the backend's startup backfill finishes precomputing missing
    // touch-point values, refresh the list so the user sees accurate
    // filtering data without a manual reload.
    useEffect(() => {
        let cancelled = false;
        const unlisten = listen('touch_point_backfill_complete', () => {
            if (!cancelled) {
                logger.info('Touch-point backfill complete — refreshing library');
                void fetchExperiments(1, true);
            }
        });
        return () => {
            cancelled = true;
            void unlisten.then((fn) => fn());
        };
    }, [fetchExperiments]);

    const loadMore = () => {
        const nextPage = page + 1;
        setPage(nextPage);
        void fetchExperiments(nextPage);
    };

    if (isLoading && page === 1) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }

    if (fetchError) {
        return (
            <div className="text-center py-20 bg-red-900/20 rounded-xl border border-red-800/50">
                <p className="text-red-400">{fetchError}</p>
            </div>
        );
    }

    if (experiments.length === 0) {
        // When the user is stuck in a 0-result state because of an active
        // touch-point RANGE filter, swap the generic message for a focused
        // explanation plus a one-click escape hatch.  The stats come from
        // the shared metadata cache so this runs against the WHOLE library
        // — not the current filter's pre-applied subset — which is exactly
        // what the user needs to know ("from N total, only M crossed").
        const touchPointMessage =
            hasActiveTouchPointRangeFilter && metadata
                ? touchPointEmptyStateMessage(metadata.touchPointStats)
                : null;
        return (
            <div
                data-testid="ExperimentListEmptyState"
                className="text-center py-20 bg-secondary/30 rounded-xl border border-border px-6"
            >
                <p className="text-muted-foreground">Эксперименты не найдены</p>
                {touchPointMessage ? (
                    <>
                        <p
                            data-testid="TouchPointEmptyStateHint"
                            className="text-xs text-muted-foreground mt-2 max-w-xl mx-auto leading-snug"
                        >
                            {touchPointMessage}
                        </p>
                        {onFiltersChange && (
                            <div className="mt-4">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={clearTouchPointFilters}
                                    data-testid="ClearTouchPointFiltersButton"
                                >
                                    Сбросить фильтры точки касания
                                </Button>
                            </div>
                        )}
                    </>
                ) : (
                    <p className="text-xs text-muted-foreground mt-2">
                        Попробуйте изменить параметры фильтрации
                    </p>
                )}
            </div>
        );
    }

    const hasActiveFilters = Object.values(filters).some(v => Array.isArray(v) ? v.length > 0 : (v !== '' && v !== undefined));

    return (
        <div className="space-y-6">
            {totalCount !== null && (
                <p className="text-xs text-muted-foreground">
                    {hasActiveFilters ? 'Найдено:' : 'Всего в базе:'}{' '}
                    <span className="text-foreground/80 font-medium">{totalCount.toLocaleString('ru-RU')}</span>
                </p>
            )}
            {viewMode === 'list' ? (
                <ExperimentTable
                    experiments={experiments}
                    onDelete={(id) => {
                        setExperiments(prev => prev.filter(e => e.id !== id));
                        if (isDemo) void refreshExperimentsCount();
                    }}
                    sortBy={sortBy}
                    sortDir={sortDir}
                    onSortChange={handleSortChange}
                />
            ) : (
                // Virtualized grid — only DOM-mounts visible rows + overscan
                <div
                    ref={gridRef}
                    data-testid="ExperimentListContainer"
                    style={{ position: 'relative', height: `${rowVirtualizer.getTotalSize()}px` }}
                >
                    {rowVirtualizer.getVirtualItems().map(virtualRow => (
                        <div
                            key={virtualRow.key}
                            data-index={virtualRow.index}
                            ref={rowVirtualizer.measureElement}
                            style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
                            }}
                        >
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                                    gap: '1rem',
                                    paddingBottom: '1rem',
                                }}
                            >
                                {rows[virtualRow.index].map(exp => (
                                    <ExperimentCard
                                        key={exp.id}
                                        experiment={exp}
                                        onDeleteRequest={handleDeleteRequest}
                                        isExpanded={expandedCardId === exp.id}
                                        onExpandToggle={handleExpandToggle}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {hasMore && (
                <div className="sticky bottom-4 z-10 flex justify-center pt-4 pointer-events-none">
                    <Button
                        onClick={loadMore}
                        disabled={isLoading}
                        className="pointer-events-auto bg-secondary hover:bg-secondary text-foreground/80 shadow-lg shadow-slate-900/50"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Загрузка...
                            </>
                        ) : (
                            'Загрузить еще'
                        )}
                    </Button>
                </div>
            )}

            {/* Shared delete confirmation dialog --- renders once for all cards */}
            <DeleteExperimentDialog
                target={deleteTarget}
                isDeleting={isDeleting}
                error={deleteError}
                onConfirm={handleDeleteConfirm}
                onCancel={closeDeleteDialog}
            />
        </div>
    );
}
