import { logger as clientLogger } from '@/lib/client-logger';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, Loader2, FolderOpen, Upload } from 'lucide-react';
import { format } from 'date-fns';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { ru } from 'date-fns/locale';
import type { Experiment } from '@/types';
import { listExperiments, getExperimentById } from '@/lib/experiments/client';
import { parseRheologyFile } from '@/lib/parsing/client';

interface ComparisonSelectorProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (experiment: Experiment) => void;
}

// Module-level cache — survives component unmount/remount when isOpen toggles.
// The selector returns `null` when closed, destroying all useRef/useState.
// Without this, the experiment-list IPC fires on every open (~300-500 ms).
const PAGE_LIMIT = 50;

let _listCache: { search: string; ts: number; experiments: Experiment[]; total: number } = {
    search: '', ts: 0, experiments: [], total: 0,
};
const CACHE_TTL_MS = 5_000;

export function ComparisonSelector({ isOpen, onClose, onSelect }: ComparisonSelectorProps) {
    const focusTrapRef = useFocusTrap<HTMLDivElement>(isOpen);
    const [activeTab, setActiveTab] = useState<'library' | 'file'>('library');
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [experiments, setExperiments] = useState<Experiment[]>(() =>
        // Seed from module cache to avoid blank list on re-open
        _listCache.search === '' && _listCache.experiments.length > 0
            ? _listCache.experiments
            : []
    );
    const [total, setTotal] = useState<number>(() => _listCache.total);
    const [page, setPage] = useState(1);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingId, setLoadingId] = useState<string | null>(null);
    const [isParsing, setIsParsing] = useState(false);
    const [parseError, setParseError] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    const fetchExperiments = useCallback(async (cancelled: { current: boolean }) => {
        setIsLoading(true);
        setPage(1);
        try {
            const data = await listExperiments({
                limit: PAGE_LIMIT,
                page: 1,
                ...(debouncedSearch ? { searchQuery: debouncedSearch } : {}),
                sortBy: 'testDate',
                sortDir: 'desc',
            });
            if (!cancelled.current && data.experiments) {
                const exps = data.experiments as unknown as Experiment[];
                const tot = (data as unknown as { pagination?: { total?: number } }).pagination?.total ?? exps.length;
                setExperiments(exps);
                setTotal(tot);
                _listCache = { search: debouncedSearch, ts: Date.now(), experiments: exps, total: tot };
            }
        } catch (err) {
            if (!cancelled.current) clientLogger.error('Failed to fetch experiments:', err);
        } finally {
            if (!cancelled.current) setIsLoading(false);
        }
    }, [debouncedSearch]);

    const fetchMore = useCallback(async () => {
        const nextPage = page + 1;
        setIsLoadingMore(true);
        try {
            const data = await listExperiments({
                limit: PAGE_LIMIT,
                page: nextPage,
                ...(debouncedSearch ? { searchQuery: debouncedSearch } : {}),
                sortBy: 'testDate',
                sortDir: 'desc',
            });
            if (data.experiments) {
                const exps = data.experiments as unknown as Experiment[];
                setExperiments(prev => {
                    const merged = [...prev, ...exps.filter(e => !prev.some(p => p.id === e.id))];
                    _listCache = { search: debouncedSearch, ts: Date.now(), experiments: merged, total };
                    return merged;
                });
                setPage(nextPage);
            }
        } catch (err) {
            clientLogger.error('Failed to load more experiments:', err);
        } finally {
            setIsLoadingMore(false);
        }
    }, [page, debouncedSearch, total]);

    useEffect(() => {
        if (!isOpen) return;
        // Skip IPC round-trip when re-opening quickly with the same search query.
        // The module-level _listCache survives unmount so repeated opens in the
        // same 5-second window are instant.
        const cache = _listCache;
        if (
            cache.search === debouncedSearch &&
            Date.now() - cache.ts < CACHE_TTL_MS &&
            cache.experiments.length > 0
        ) {
            setExperiments(cache.experiments);
            setTotal(cache.total);
            return;
        }
        const cancelled = { current: false };
        fetchExperiments(cancelled);
        return () => { cancelled.current = true; };
    }, [isOpen, fetchExperiments, debouncedSearch]);

    // Load full experiment (with rawPoints) before adding to comparison
    const handleSelect = useCallback(async (exp: Experiment) => {
        setLoadingId(exp.id);
        try {
            const response = await getExperimentById(exp.id);
            if (response.success && response.experiment) {
                onSelect(response.experiment as unknown as Experiment);
            } else {
                clientLogger.error('Failed to load full experiment:', response.error);
            }
        } catch (err) {
            clientLogger.error('Failed to fetch experiment for comparison:', err);
        } finally {
            setLoadingId(null);
        }
    }, [onSelect]);

    const handleFileSelect = useCallback(async (file: File) => {
        setIsParsing(true);
        setParseError(null);
        try {
            const parseResult = await parseRheologyFile(file);
            const syntheticExp: Experiment = {
                id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                name: file.name.replace(/\.[^/.]+$/, ''),
                testDate: new Date(),
                fluidType: 'Linear',
                instrumentType: 'Unknown',
                // Prefer columnarData so the comparison pipeline stays on the SoA path.
                // Keep rawPoints only as fallback for experiments without columnarData.
                ...(parseResult.columnarData
                    ? { columnarData: parseResult.columnarData }
                    : { rawPoints: parseResult.data ?? [] }),
            } as unknown as Experiment;
            onSelect(syntheticExp);
        } catch (err) {
            clientLogger.error('Failed to parse file for comparison:', err);
            setParseError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsParsing(false);
        }
    }, [onSelect]);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFileSelect(file);
        // Reset so the same file can be re-selected
        e.target.value = '';
    }, [handleFileSelect]);

    const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFileSelect(file);
    }, [handleFileSelect]);

    // Close on Escape key
    useEffect(() => {
        if (!isOpen) return;
        const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handleKey);
        return () => document.removeEventListener('keydown', handleKey);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div ref={focusTrapRef} data-testid="ComparisonSelectorOverlay" role="dialog" aria-modal="true" className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div
                data-testid="ComparisonSelectorDialog"
                aria-labelledby="comparison-selector-title"
                className="bg-secondary rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col"
            >
                <div className="p-4 border-b border-border flex items-center justify-between">
                    <h3 id="comparison-selector-title" className="text-lg font-medium text-foreground">Выберите тест для сравнения</h3>
                    <button data-testid="ComparisonSelectorCloseButton" onClick={onClose} aria-label="Закрыть" className="text-muted-foreground hover:text-foreground">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Tab switcher */}
                <div className="flex border-b border-border">
                    <button
                        onClick={() => setActiveTab('library')}
                        className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                            activeTab === 'library'
                                ? 'text-blue-400 border-b-2 border-blue-400'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        Из библиотеки
                    </button>
                    <button
                        onClick={() => { setActiveTab('file'); setParseError(null); }}
                        className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                            activeTab === 'file'
                                ? 'text-blue-400 border-b-2 border-blue-400'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        Из файла
                    </button>
                </div>

                {activeTab === 'library' && (
                <div className="p-4 border-b border-border">
                    <div className="relative">
                        <input
                            type="text"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            data-testid="ComparisonSelectorSearchInput"
                            className="w-full bg-card border border-border rounded-lg py-2 pl-10 pr-4 text-foreground focus:outline-none focus:border-blue-500"
                            placeholder="Поиск по названию, месторождению, оператору..."
                        />
                        <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-3" />
                    </div>
                </div>
                )}

                <div className="flex-1 overflow-y-auto p-2">
                    {activeTab === 'file' ? (
                        <div className="p-4 flex flex-col items-center gap-4">
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".xlsx,.xls,.csv,.txt"
                                className="hidden"
                                onChange={handleInputChange}
                            />
                            <div
                                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                                onDragLeave={() => setIsDragging(false)}
                                onDrop={handleDrop}
                                onClick={() => !isParsing && fileInputRef.current?.click()}
                                className={`w-full border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                                    isDragging
                                        ? 'border-blue-400 bg-blue-500/10'
                                        : 'border-border hover:border-muted-foreground/40 hover:bg-muted/30'
                                }`}
                            >
                                {isParsing ? (
                                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                                        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                                        <span>Обработка файла...</span>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center gap-3 text-muted-foreground">
                                        <Upload className="w-8 h-8" />
                                        <span className="text-sm">Перетащите файл сюда или нажмите для выбора</span>
                                        <span className="text-xs text-muted-foreground">Поддерживаемые форматы: xlsx, xls, csv, txt</span>
                                    </div>
                                )}
                            </div>
                            <button
                                onClick={() => !isParsing && fileInputRef.current?.click()}
                                disabled={isParsing}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-muted text-sm text-foreground disabled:opacity-50 transition-colors"
                            >
                                <FolderOpen className="w-4 h-4" />
                                Выбрать файл
                            </button>
                            {parseError && (
                                <div className="w-full rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-sm text-red-400">
                                    {parseError}
                                </div>
                            )}
                        </div>
                    ) : isLoading ? (
                        <div className="flex justify-center py-10">
                            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                        </div>
                    ) : experiments.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                            <Search className="w-8 h-8 opacity-40" />
                            <span className="text-sm">
                                {debouncedSearch ? 'Ничего не найдено' : 'База данных пуста'}
                            </span>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {total > 0 && (
                                <div className="px-3 py-1 text-xs text-muted-foreground">
                                    Показано {experiments.length} из {total}
                                </div>
                            )}
                            {experiments.map(exp => (
                                <div key={exp.id} data-testid="AddExperimentToComparison">
                                    <button
                                        onClick={() => handleSelect(exp)}
                                        disabled={loadingId === exp.id}
                                        data-testid="ComparisonSelectorExperimentButton"
                                        className="w-full text-left p-3 rounded-lg hover:bg-secondary/50 transition-colors border border-transparent hover:border-border group disabled:opacity-50"
                                    >
                                        <div className="flex justify-between items-start">
                                            <span className="font-medium text-foreground group-hover:text-blue-400 transition-colors">
                                                {exp.name}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {format(new Date(exp.testDate), 'dd MMM yyyy', { locale: ru })}
                                            </span>
                                        </div>
                                        <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                                            <span>{exp.fluidType === 'Crosslinked' ? 'Сшитый' : exp.fluidType === 'Linear' ? 'Линейный' : exp.fluidType}</span>
                                            <span>•</span>
                                            <span>{exp.instrumentType}</span>
                                            {exp.fieldName && (
                                                <>
                                                    <span>•</span>
                                                    <span>{exp.fieldName}</span>
                                                </>
                                            )}
                                        </div>
                                    </button>
                                </div>
                            ))}
                            {experiments.length < total && (
                                <div className="pt-2 pb-1 flex justify-center">
                                    <button
                                        onClick={fetchMore}
                                        disabled={isLoadingMore}
                                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-secondary hover:bg-muted text-sm text-foreground/80 disabled:opacity-50 transition-colors"
                                    >
                                        {isLoadingMore
                                            ? <><Loader2 className="w-4 h-4 animate-spin" /> Загрузка...</>
                                            : `Загрузить ещё (ещё ${total - experiments.length})`
                                        }
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

