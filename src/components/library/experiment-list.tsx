import { logger as clientLogger } from '@/lib/client-logger';

import { useState, useEffect, useCallback, useLayoutEffect, useRef, useMemo } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { ExperimentCard } from './experiment-card';
import { ExperimentTable } from './experiment-table';
import { DeleteExperimentDialog } from './delete-experiment-dialog';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLicense } from '@/hooks/useLicense';
import { listExperiments, deleteExperiment } from '@/lib/experiments/client';
import { ExperimentFilters } from '@/types/experiment-filters';
import { ExperimentCardItem } from '@/types/experiment-list-item';

interface ExperimentListProps {
    filters: ExperimentFilters;
    viewMode: 'grid' | 'list';
}

export function ExperimentList({ filters, viewMode }: ExperimentListProps) {
    const [experiments, setExperiments] = useState<ExperimentCardItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [totalCount, setTotalCount] = useState<number | null>(null);
    const [sortBy, setSortBy] = useState<string | null>(null);
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const { refreshExperimentsCount, isDemo } = useLicense();

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
        scrollMargin: parentOffsetRef.current,
    });

    // Shared delete dialog state — one Dialog for all cards
    const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    // Which card has the reagent list expanded (only one at a time)
    const [expandedCardId, setExpandedCardId] = useState<string | null>(null);

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
                if (isDemo) refreshExperimentsCount();
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

    const fetchExperiments = useCallback(async (pageNum: number, reset: boolean = false) => {
        setIsLoading(true);
        try {
            const data = await listExperiments({
                page: pageNum,
                limit: 12,
                ...filters,
                ...(sortBy ? { sortBy, sortDir } : {}),
            });

            if (data.experiments) {
                setExperiments(prev => reset ? data.experiments : [...prev, ...data.experiments]);
                setHasMore(data.pagination.page < data.pagination.totalPages);
                if (reset) setTotalCount(data.pagination.total);
            }
        } catch (err) {
            clientLogger.error('Failed to fetch experiments:', err);
            setFetchError('Ошибка загрузки списка. Повторите позже.');
        } finally {
            setIsLoading(false);
        }
    }, [filters, sortBy, sortDir]);

    // Debounce filters — abort stale responses so a slow query
    // doesn't overwrite results from a newer filter change.
    useEffect(() => {
        let aborted = false;
        const timer = setTimeout(() => {
            setPage(1);
            setIsLoading(true);
            listExperiments({ page: 1, limit: 12, ...filters, ...(sortBy ? { sortBy, sortDir } : {}) })
                .then((data) => {
                    if (aborted) return;
                    setFetchError(null);
                    if (data.experiments) {
                        setExperiments(data.experiments);
                        setHasMore(data.pagination.page < data.pagination.totalPages);
                        setTotalCount(data.pagination.total);
                    }
                })
                .catch((err) => {
                    if (aborted) return;
                    clientLogger.error('Failed to fetch experiments:', err);
                    setFetchError('Ошибка загрузки списка. Повторите позже.');
                })
                .finally(() => {
                    if (!aborted) setIsLoading(false);
                });
        }, 200);
        return () => { aborted = true; clearTimeout(timer); };
    }, [filters, sortBy, sortDir]);

    const loadMore = () => {
        const nextPage = page + 1;
        setPage(nextPage);
        fetchExperiments(nextPage);
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
        return (
            <div className="text-center py-20 bg-secondary/30 rounded-xl border border-border">
                <p className="text-muted-foreground">Эксперименты не найдены</p>
                <p className="text-xs text-muted-foreground mt-2">Попробуйте изменить параметры фильтрации</p>
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
                        if (isDemo) refreshExperimentsCount();
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
