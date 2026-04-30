import { useState, useEffect, Suspense } from 'react';
import { ExperimentFilters } from '@/components/library/experiment-filters';
import { ExperimentList } from '@/components/library/experiment-list';
import { ReagentsManager } from '@/components/library/reagents-manager';
import { Database, Beaker, Loader2 } from 'lucide-react';
import type { ExperimentFilters as FilterState} from '@/types/experiment-filters';
import { EMPTY_FILTERS } from '@/types/experiment-filters';
import { useSearchParams } from 'react-router-dom';
import { emitLibraryFilterPerfEvent } from '@/lib/perf/library-filter-spans';
import { changedExperimentFilterKeys } from '@/lib/library/filter-debounce';

// Inner component that uses useSearchParams
function LibraryContent() {
    const [searchParams] = useSearchParams();
    const initialTab = searchParams.get('tab') === 'reagents' ? 'reagents' : 'experiments';
    const [activeTab, setActiveTab] = useState<'experiments' | 'reagents'>(initialTab);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
        const saved = localStorage.getItem('rheolab-library-viewMode');
        return saved === 'list' ? 'list' : 'grid';
    });
    useEffect(() => {
        localStorage.setItem('rheolab-library-viewMode', viewMode);
    }, [viewMode]);
    const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);

    const handleFiltersChange = (next: FilterState) => {
        const filterKeys = changedExperimentFilterKeys(filters, next);
        if (filterKeys.length > 0) {
            emitLibraryFilterPerfEvent({
                name: 'filters_changed',
                filter_keys: filterKeys,
                changed_filter_keys: filterKeys,
                view_mode: viewMode,
            });
        }
        setFilters(next);
    };

    return (
        <>
            {/* Header with Tabs */}
            <div className="border-b border-border bg-background sticky top-16 z-40">
                <div className="w-full mx-auto px-6">
                    <div className="flex items-center justify-between gap-6">
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => setActiveTab('experiments')}
                                data-testid="ExperimentsTabButton"
                                className={`py-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'experiments'
                                    ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                <Database className="w-4 h-4" />
                                Эксперименты
                            </button>
                            <button
                                onClick={() => setActiveTab('reagents')}
                                data-testid="ReagentsTabButton"
                                className={`py-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'reagents'
                                    ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                <Beaker className="w-4 h-4" />
                                Реагенты
                            </button>
                        </div>

                        {activeTab === 'experiments' && (
                            <div className="ml-auto flex items-center gap-2">
                                <button
                                    type="button"
                                    data-testid="ListViewButton"
                                    onClick={() => setViewMode('list')}
                                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                                        viewMode === 'list'
                                            ? 'bg-purple-600/20 border-purple-500/40 text-purple-700 dark:text-purple-300'
                                            : 'bg-secondary border-border text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    Список
                                </button>
                                <button
                                    type="button"
                                    data-testid="GridViewButton"
                                    onClick={() => setViewMode('grid')}
                                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                                        viewMode === 'grid'
                                            ? 'bg-purple-600/20 border-purple-500/40 text-purple-700 dark:text-purple-300'
                                            : 'bg-secondary border-border text-muted-foreground hover:text-foreground'
                                    }`}
                                >
                                    Сетка
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <main className="w-full px-6 py-8">
                {activeTab === 'experiments' ? (
                    <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
                        {/* Filters Sidebar */}
                        <div>
                            <ExperimentFilters filters={filters} onChange={handleFiltersChange} />
                        </div>

                        {/* Results List */}
                        <div className="min-w-0">
                            <ExperimentList
                                filters={filters}
                                viewMode={viewMode}
                                onFiltersChange={handleFiltersChange}
                            />
                        </div>
                    </div>
                ) : (
                    <ReagentsManager />
                )}
            </main>
        </>
    );
}

// Loading fallback
function LibraryLoading() {
    return (
        <div className="flex items-center justify-center min-h-[400px]">
            <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
        </div>
    );
}

// Main component wrapped in Suspense
export default function LibraryPage() {
    return (
        <div data-testid="LibraryPageRoot" className="min-h-screen">
            <Suspense fallback={<LibraryLoading />}>
                <LibraryContent />
            </Suspense>
        </div>
    );
}
