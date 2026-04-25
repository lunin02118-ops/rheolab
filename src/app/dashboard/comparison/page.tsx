import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { ComparisonSelector } from '@/components/comparison/comparison-selector';
import { ComparisonChartUPlot as ComparisonChart } from '@/components/comparison/comparison-chart-uplot';
import { ChartErrorBoundary } from '@/components/shared/ChartErrorBoundary';
import { AxisSelector, LegendToggle, ExperimentChip, ViscosityThresholdControl } from '@/components/comparison/comparison-controls';
import { Layers, Plus, AlertCircle, BarChart3, FileText } from 'lucide-react';
import type { Experiment } from '@/types';
import { useComparisonStore } from '@/lib/store/comparison-store';
import { checkExperimentsExist } from '@/lib/experiments/client';
import { useShallow } from 'zustand/react/shallow';

// Lazy-loaded: report tab is only rendered on explicit tab switch
const ComparisonReportTab = lazy(() => import('@/components/comparison/reports/ComparisonReportTab').then(m => ({ default: m.ComparisonReportTab })));

const METRICS = [
    { value: 'viscosity_cp', label: 'Вязкость' },
    { value: 'temperature_c', label: 'Температура' },
    { value: 'bath_temperature_c', label: 'Темп. бани' },
    { value: 'speed_rpm', label: 'Скорость' },
    { value: 'shear_rate_s1', label: 'Скор. сдвига' },
    { value: 'shear_stress_pa', label: 'Напр. сдвига' },
    { value: 'pressure_bar', label: 'Давление' },
];

export default function ComparisonPage() {
    // Fine-grained selectors: each subscription only re-renders when its own
    // slice changes, preventing displaySettings changes from re-rendering the
    // chart and vice-versa.
    const experiments = useComparisonStore(s => s.experiments);
    const displaySettings = useComparisonStore(useShallow(s => s.displaySettings));
    const addExperiment = useComparisonStore(s => s.addExperiment);
    const removeExperiment = useComparisonStore(s => s.removeExperiment);
    const updateDisplaySettings = useComparisonStore(s => s.updateDisplaySettings);
    const getMaxExperiments = useComparisonStore(s => s.getMaxExperiments);
    const isInComparison = useComparisonStore(s => s.isInComparison);
    const rehydrateIfNeeded = useComparisonStore(s => s.rehydrateIfNeeded);
    const releaseHeavyData = useComparisonStore(s => s.releaseHeavyData);
    const _hasHydrated = useComparisonStore(s => s._hasHydrated);
    const maxExperiments = getMaxExperiments();

    // Track whether a rehydration IPC call is in flight (shows spinner in chart area)
    const [isRehydrating, setIsRehydrating] = useState(false);
    const [rehydrationFailed, setRehydrationFailed] = useState(false);

    // Re-hydrate stale experiments only after zustand/persist has finished loading
    // from localStorage. Without this guard, rehydrateIfNeeded() sees experiments=[]
    // (the initial store state) and returns early — leaving the page blank when the
    // user navigates away and back before the async hydration completes.
    useEffect(() => {
        if (!_hasHydrated) return;
        // Check if any experiment is already missing columnarData (stale from localStorage)
        const needsRehydration = useComparisonStore.getState().experiments.some(e => {
            const c = (e as Record<string, unknown>).columnarData as { timeSec?: ArrayLike<unknown> } | undefined;
            return !c || !c.timeSec || c.timeSec.length === 0;
        });
        if (!needsRehydration) return;
        setIsRehydrating(true);
        setRehydrationFailed(false);
        rehydrateIfNeeded()
            .then(() => {
                // If still no data after rehydration — mark as failed so UI can offer retry
                const hasData = useComparisonStore.getState().experiments.some(e => {
                    const c = (e as Record<string, unknown>).columnarData as { timeSec?: ArrayLike<unknown> } | undefined;
                    return c && c.timeSec && c.timeSec.length > 0;
                });
                if (!hasData && useComparisonStore.getState().experiments.length > 0) {
                    setRehydrationFailed(true);
                }
            })
            .catch(() => setRehydrationFailed(true))
            .finally(() => setIsRehydrating(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once after hydration
    }, [_hasHydrated]);

    // Deferred existence check: 2 s after mount, verify that DB-backed experiments
    // still exist.  If the user deleted an experiment from the library while it was
    // cached in comparison (with columnarData retained), this removes the stale entry.
    // Uses a lightweight SELECT id … WHERE id IN (…) — no heavy data loading.
    useEffect(() => {
        if (!_hasHydrated) return;
        const timer = setTimeout(async () => {
            const state = useComparisonStore.getState();
            const dbIds = state.experiments
                .filter(e => !e.id.startsWith('file-'))
                .map(e => e.id);
            if (dbIds.length === 0) return;
            try {
                const res = await checkExperimentsExist(dbIds);
                const existing = new Set(res.existingIds);
                const before = useComparisonStore.getState().experiments;
                const after = before.filter(
                    e => e.id.startsWith('file-') || existing.has(e.id),
                );
                if (after.length < before.length) {
                    useComparisonStore.setState({ experiments: after });
                }
            } catch {
                // Non-critical — existence check is best-effort
            }
        }, 2_000);
        return () => clearTimeout(timer);
     
    }, [_hasHydrated]);

    // Release heavy in-memory arrays when the comparison page unmounts.
    // Keep only lightweight metadata/IDs in the store so the next mount can
    // rehydrate from SQLite without retaining hidden experiments indefinitely.
    useEffect(() => () => {
        releaseHeavyData();
    }, [releaseHeavyData]);

    // Persisted display settings from store
    const {
        primaryMetric,
        leftSecondaryMetric,
        secondaryMetric,
        tertiaryMetric,
        showLegend,
        showTouchPoints,
        viscosityThreshold,
        showTargetTime,
        targetTime,
    } = displaySettings;

    const update = useCallback((patch: Partial<typeof displaySettings>) => updateDisplaySettings(patch), [updateDisplaySettings]);

    // Local state for ephemeral UI only
    const [isSelectorOpen, setIsSelectorOpen] = useState(false);
    const [limitWarning, setLimitWarning] = useState(false);
    const [duplicateWarning, setDuplicateWarning] = useState(false);
    const [activeTab, setActiveTab] = useState<'chart' | 'report'>('chart');
    const warningTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    // Clean up warning timer on unmount
    useEffect(() => () => clearTimeout(warningTimerRef.current), []);

    const handleAddExperiment = (experiment: Experiment) => {
        if (isInComparison(experiment.id)) {
            setDuplicateWarning(true);
            clearTimeout(warningTimerRef.current);
            warningTimerRef.current = setTimeout(() => setDuplicateWarning(false), 3000);
            return;
        }

        const added = addExperiment(experiment);
        if (!added) {
            // Show limit warning
            setLimitWarning(true);
            clearTimeout(warningTimerRef.current);
            warningTimerRef.current = setTimeout(() => setLimitWarning(false), 3000);
        } else {
            setIsSelectorOpen(false);
        }
    };

    const isAtLimit = experiments.length >= maxExperiments;

    return (
        <div data-testid="ComparisonPageRoot" className="flex flex-col h-[calc(100vh-6rem)] bg-transparent text-foreground">
            {/* Sticky header bar — mirrors library page style */}
            <div className="border-b border-border bg-background sticky top-16 z-40">
                <div className="w-full mx-auto px-6">
                    <div className="flex items-center justify-between gap-6">
                        {/* Tab buttons */}
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => setActiveTab('chart')}
                                data-testid="ComparisonChartTabTrigger"
                                className={`py-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'chart'
                                    ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                <BarChart3 className="w-4 h-4" />
                                График
                            </button>
                            <button
                                onClick={() => setActiveTab('report')}
                                data-testid="ComparisonReportTabTrigger"
                                className={`py-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'report'
                                    ? 'border-purple-500 text-purple-600 dark:text-purple-400'
                                    : 'border-transparent text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                <FileText className="w-4 h-4" />
                                Отчёт
                            </button>
                        </div>

                        {/* Experiment Chips */}
                        <div data-testid="SelectedExperimentsChips" className="flex flex-wrap items-center gap-2 justify-end">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${isAtLimit ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-secondary text-muted-foreground'}`}>
                                {experiments.length}/{maxExperiments}
                            </span>

                            {experiments.map(exp => (
                                <ExperimentChip key={exp.id} name={exp.name} onRemove={() => removeExperiment(exp.id)} />
                            ))}

                            {limitWarning && (
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/20 text-amber-400 rounded-full text-xs font-medium border border-amber-500/30 animate-pulse">
                                    <AlertCircle className="w-3.5 h-3.5" />
                                    Достигнут лимит ({maxExperiments} графиков)
                                </div>
                            )}

                            {duplicateWarning && (
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/20 text-blue-400 rounded-full text-xs font-medium border border-blue-500/30 animate-pulse">
                                    <AlertCircle className="w-3.5 h-3.5" />
                                    Уже добавлено
                                </div>
                            )}

                            <button
                                onClick={() => setIsSelectorOpen(true)}
                                disabled={isAtLimit}
                                data-testid="OpenExperimentSelectorButton"
                                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors border ${isAtLimit
                                    ? 'bg-secondary/50 text-muted-foreground border-border cursor-not-allowed'
                                    : 'bg-blue-600/10 text-blue-400 hover:bg-blue-600/20 border-blue-500/20 hover:border-blue-500/30'
                                }`}
                                title={isAtLimit ? `Лимит: ${maxExperiments} графиков` : 'Добавить тест'}
                            >
                                <Plus className="w-3.5 h-3.5" />
                                {isAtLimit ? 'Лимит' : 'Добавить тест'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <main className="flex-1 min-h-0 w-full mx-auto px-2 py-2 flex flex-col gap-2">
                {/* Chart tab */}
                {activeTab === 'chart' && (
                    <div className="flex-1 min-h-0 flex flex-col gap-2">
                        <div className="flex-none px-5">
                            <div className="border-b border-border/50 pb-2">
                                <div className="flex items-center gap-6 overflow-x-auto py-1">
                                    <AxisSelector
                                        label="Слева 1"
                                        value={primaryMetric}
                                        onChange={(val) => {
                                            const patch: Record<string, string> = { primaryMetric: val };
                                            if (leftSecondaryMetric === val) patch.leftSecondaryMetric = 'none';
                                            if (secondaryMetric === val) patch.secondaryMetric = 'none';
                                            if (tertiaryMetric === val) patch.tertiaryMetric = 'none';
                                            update(patch);
                                        }}
                                        options={METRICS}
                                        color="blue"
                                    />
                                    <AxisSelector
                                        label="Слева 2"
                                        value={leftSecondaryMetric}
                                        onChange={(val) => {
                                            const patch: Record<string, string> = { leftSecondaryMetric: val };
                                            if (secondaryMetric === val) patch.secondaryMetric = 'none';
                                            if (tertiaryMetric === val) patch.tertiaryMetric = 'none';
                                            update(patch);
                                        }}
                                        options={METRICS}
                                        excludeValues={[primaryMetric]}
                                        color="purple"
                                        allowNone
                                    />

                                    <div className="h-8 w-px bg-secondary mx-2" />

                                    <AxisSelector
                                        label="Справа 1"
                                        value={secondaryMetric}
                                        onChange={(val) => {
                                            const patch: Record<string, string> = { secondaryMetric: val };
                                            if (leftSecondaryMetric === val) patch.leftSecondaryMetric = 'none';
                                            if (tertiaryMetric === val) patch.tertiaryMetric = 'none';
                                            update(patch);
                                        }}
                                        options={METRICS}
                                        excludeValues={[primaryMetric, leftSecondaryMetric]}
                                        color="slate"
                                        allowNone
                                    />
                                    <AxisSelector
                                        label="Справа 2"
                                        value={tertiaryMetric}
                                        onChange={(val) => {
                                            const patch: Record<string, string> = { tertiaryMetric: val };
                                            if (leftSecondaryMetric === val) patch.leftSecondaryMetric = 'none';
                                            if (secondaryMetric === val) patch.secondaryMetric = 'none';
                                            update(patch);
                                        }}
                                        options={METRICS}
                                        excludeValues={[primaryMetric, leftSecondaryMetric, secondaryMetric]}
                                        color="amber"
                                        allowNone
                                    />

                                    <div className="h-8 w-px bg-secondary mx-2" />

                                    <ViscosityThresholdControl
                                        enabled={showTouchPoints}
                                        onEnabledChange={(v) => update({ showTouchPoints: v })}
                                        threshold={viscosityThreshold}
                                        onThresholdChange={(v) => update({ viscosityThreshold: v })}
                                        showTargetTime={showTargetTime}
                                        onShowTargetTimeChange={(v) => update({ showTargetTime: v })}
                                        targetTime={targetTime}
                                        onTargetTimeChange={(v) => update({ targetTime: v })}
                                    />

                                    <div className="flex-1" />

                                    <LegendToggle checked={showLegend} onChange={(v) => update({ showLegend: v })} />
                                </div>
                            </div>
                        </div>

                        {/* Chart Area */}
                        <div data-testid="ComparisonChartContainer" className="flex-1 relative bg-card/50 border border-border/60 rounded-2xl shadow-xl overflow-hidden p-1">
                            {experiments.length > 0 && isRehydrating ? (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-3">
                                    <svg className="w-8 h-8 animate-spin text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                                    </svg>
                                    <span className="text-sm">Загрузка данных экспериментов…</span>
                                </div>
                            ) : experiments.length > 0 && rehydrationFailed ? (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-3">
                                    <AlertCircle className="w-10 h-10 text-amber-400" />
                                    <p className="text-sm text-foreground/80">Не удалось загрузить данные</p>
                                    <button
                                        onClick={() => {
                                            setRehydrationFailed(false);
                                            setIsRehydrating(true);
                                            rehydrateIfNeeded()
                                                .then(() => {
                                                    const hasData = useComparisonStore.getState().experiments.some(e => {
                                                        const c = (e as Record<string, unknown>).columnarData as { timeSec?: ArrayLike<unknown> } | undefined;
                                                        return c && c.timeSec && c.timeSec.length > 0;
                                                    });
                                                    if (!hasData && useComparisonStore.getState().experiments.length > 0) setRehydrationFailed(true);
                                                })
                                                .catch(() => setRehydrationFailed(true))
                                                .finally(() => setIsRehydrating(false));
                                        }}
                                        className="px-3 py-1.5 text-xs bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg hover:bg-blue-600/30 transition-colors"
                                    >
                                        Повторить
                                    </button>
                                </div>
                            ) : experiments.length > 0 ? (
                                <div className="w-full h-full">
                                    <ChartErrorBoundary height={500}>
                                        <ComparisonChart
                                            experiments={experiments}
                                            primaryMetric={primaryMetric}
                                            leftSecondaryMetric={leftSecondaryMetric}
                                            secondaryMetric={secondaryMetric}
                                            tertiaryMetric={tertiaryMetric}
                                            showLegend={showLegend}
                                            showTouchPoints={showTouchPoints}
                                            viscosityThreshold={viscosityThreshold}
                                            showTargetTime={showTargetTime}
                                            targetTime={targetTime}
                                        />
                                    </ChartErrorBoundary>
                                </div>
                            ) : (
                                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-card/20">
                                    <Layers className="w-16 h-16 mb-4 opacity-20" />
                                    <p className="text-base font-medium text-muted-foreground">Выберите тесты для сравнения</p>
                                    <p className="text-sm text-muted-foreground mt-1">Добавьте хотя бы один эксперимент</p>
                                    <button
                                        onClick={() => setIsSelectorOpen(true)}
                                        data-testid="OpenExperimentSelectorButtonEmpty"
                                        className="mt-6 px-4 py-2 bg-blue-600 text-foreground rounded-lg hover:bg-blue-500 transition-colors shadow-lg shadow-blue-500/20"
                                    >
                                        Открыть библиотеку
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Report tab */}
                {activeTab === 'report' && (
                    <Suspense fallback={<div className="flex h-48 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" /></div>}>
                        {/*
                         * NOTE: no `overflow-auto` here — it breaks `h-full`
                         * height resolution on the tab's grid root.  The tab
                         * manages its own overflow internally.
                         */}
                        <div className="flex-1 min-h-0 px-5 pb-5">
                            <ComparisonReportTab />
                        </div>
                    </Suspense>
                )}
            </main>

            <ComparisonSelector isOpen={isSelectorOpen} onClose={() => setIsSelectorOpen(false)} onSelect={handleAddExperiment} />
        </div>
    );
}
