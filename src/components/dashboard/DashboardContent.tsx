import { memo, useState, useMemo, useRef, useCallback, useEffect, lazy, Suspense } from 'react';
import { AlertCircle, BarChart3, ClipboardList, Table, Droplets, Save, Settings, FileText } from 'lucide-react';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { RheologyChart } from '@/components/charts/rheology-chart-uplot';
import { ChartErrorBoundary } from '@/components/shared/ChartErrorBoundary';

// Tab-level lazy chunks: these components are only rendered when the user
// switches away from the default "chart" tab.  Deferring their bundle
// load reduces initial JS parse cost and keeps the first-paint path lean.
const CalibrationPanel = lazy(() => import('@/components/calibration/CalibrationPanel').then(m => ({ default: m.CalibrationPanel })));
const RawDataTable = lazy(() => import('@/components/dashboard/raw-data-table').then(m => ({ default: m.RawDataTable })));
const RawDataTableById = lazy(() => import('@/components/dashboard/raw-data-table-by-id').then(m => ({ default: m.RawDataTableById })));
const RecipePanel = lazy(() => import('@/components/analysis/recipe-panel').then(m => ({ default: m.RecipePanel })));
const WaterAnalysisPanel = lazy(() => import('@/components/analysis/water-analysis-panel').then(m => ({ default: m.WaterAnalysisPanel })));
const ReportTab = lazy(() => import('@/components/analysis/ReportTab').then(m => ({ default: m.ReportTab })));
const CycleResultsTable = lazy(() => import('@/components/analysis/cycle-results-table').then(m => ({ default: m.CycleResultsTable })));
const CycleEditorDialog = lazy(() => import('@/components/analysis/cycle-editor-dialog').then(m => ({ default: m.CycleEditorDialog })));
import { ParsingLogs } from '@/components/dashboard/parsing-logs';
import { InstrumentSelector } from '@/components/dashboard/instrument-selector';
import { GeometrySelector } from '@/components/dashboard/geometry-selector';
import type { ParseResult } from '@/lib/store/experiment-data-store';
import { rawPointsFromParseResult } from '@/lib/utils/columnar';
import { useExperimentSeriesOverview } from '@/hooks/useExperimentSeriesOverview';
import { isTauri } from '@/lib/tauri/core';
import type { RheoCycle, GraceCycleResult } from '@/lib/analysis/types';
import { useLicense } from '@/hooks/useLicense';
import type { RheoStep } from '@/lib/analysis/types';
import type { RecipeComponent } from '@/components/analysis/recipe-panel';
import type { WaterParams } from '@/components/analysis/water-analysis-panel';
import type { RheologyParameterRow } from '@/types';
import {
    cycleTimingMinutes,
    finiteOr,
    rheologyParameterRowToGraceCycleResult,
} from '@/lib/analysis/rheology-parameter-mapping';

// Define explicit types for props
export interface DashboardContentProps {
    parseResult: ParseResult | null;
    cycles: RheoCycle[];
    cycleResults: Map<number, GraceCycleResult>;
    allSteps: RheoStep[];
    isExpert: boolean;
    editedRecipe: RecipeComponent[];
    setEditedRecipe: (recipe: RecipeComponent[]) => void;
    editedWaterSource: string;
    setEditedWaterSource: (source: string) => void;
    editedWaterParams: Partial<WaterParams> | null;
    setEditedWaterParams: (params: Partial<WaterParams>) => void;
    onSaveClick: () => void;
    onInstrumentChange: (inst: string) => void;
    onGeometryChange: (geometry: string, kFactor: number) => void;
    geometryOverride: { geometry: string; kFactor: number } | null;
    cycleOverrides: Map<number, number[]>;
    setCycleOverrides: (updater: (prev: Map<number, number[]>) => Map<number, number[]>) => void;
    patternOverride: number[] | null;
    setPatternOverride: (pattern: number[] | null) => void;
    isMetadataOnly?: boolean;
    isFullDataLoading?: boolean;
    onRequireFullData?: () => Promise<boolean>;
}

type DashboardTab = 'chart' | 'table' | 'recipe' | 'water' | 'calibration' | 'report';
export type AnalysisRheologySource = 'program' | 'instrument';
const EMPTY_RHEOLOGY_ROWS: readonly RheologyParameterRow[] = [];
const TAB_BUTTON_BASE = 'flex items-center gap-2 px-4 py-2 rounded-lg border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30';
const tabButtonClass = (isActive: boolean) => `${TAB_BUTTON_BASE} ${
    isActive
        ? 'border-border bg-card text-foreground shadow-sm'
        : 'border-transparent bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground'
}`;

interface InstrumentRheologyView {
    cycles: RheoCycle[];
    results: Map<number, GraceCycleResult>;
}

function makeSyntheticInstrumentCycle(row: RheologyParameterRow, id: number): RheoCycle {
    const startMin = finiteOr(row.timeMin, 0);
    const endMin = finiteOr(row.endTimeMin, startMin);
    const startSec = startMin * 60;
    const endSec = endMin * 60;
    const duration = Math.max(0, Math.round(endSec - startSec));

    return {
        id,
        cycleIndex: row.cycleNo,
        type: 'Custom',
        steps: [],
        description: row.sourceSheet ? `Прибор: ${row.sourceSheet}` : 'Расчёт прибора',
        duration,
        isSST: false,
    };
}

function buildInstrumentRheologyView(
    rows: readonly RheologyParameterRow[],
    cycles: readonly RheoCycle[],
): InstrumentRheologyView {
    const viewCycles: RheoCycle[] = [];
    const results = new Map<number, GraceCycleResult>();
    const usedDisplayIds = new Set<number>();
    let nextSyntheticId = -1;
    const allocateSyntheticId = () => {
        while (usedDisplayIds.has(nextSyntheticId) || cycles.some(cycle => cycle.id === nextSyntheticId)) {
            nextSyntheticId -= 1;
        }
        const id = nextSyntheticId;
        usedDisplayIds.add(id);
        nextSyntheticId -= 1;
        return id;
    };

    const sortedRows = [...rows].sort((a, b) => {
        const cycleDiff = a.cycleNo - b.cycleNo;
        if (cycleDiff !== 0) return cycleDiff;
        return (a.sourceRow ?? 0) - (b.sourceRow ?? 0);
    });

    sortedRows.forEach((row) => {
        const cycle = cycles.find(candidate =>
            !usedDisplayIds.has(candidate.id)
            && ((candidate.cycleIndex ?? candidate.id) === row.cycleNo || candidate.id === row.cycleNo),
        );
        const uniqueDisplayId = cycle?.id ?? allocateSyntheticId();
        const viewCycle = cycle ?? makeSyntheticInstrumentCycle(row, uniqueDisplayId);

        usedDisplayIds.add(uniqueDisplayId);
        viewCycles.push(viewCycle);
        results.set(uniqueDisplayId, rheologyParameterRowToGraceCycleResult(row, cycleTimingMinutes(cycle)));
    });

    return { cycles: viewCycles, results };
}

function DashboardContentInner({
    parseResult,
    cycles,
    cycleResults,
    allSteps,
    isExpert,
    editedRecipe,
    setEditedRecipe,
    editedWaterSource,
    setEditedWaterSource,
    editedWaterParams,
    setEditedWaterParams,
    onSaveClick,
    onInstrumentChange,
    onGeometryChange,
    geometryOverride,
    cycleOverrides,
    setCycleOverrides,
    patternOverride,
    setPatternOverride,
    isMetadataOnly = false,
    isFullDataLoading = false,
    onRequireFullData
}: DashboardContentProps) {
    const [activeTab, setActiveTab] = useState<DashboardTab>('chart');
    const [editingCycleId, setEditingCycleId] = useState<number | null>(null);
    const [rheologySourceSelection, setRheologySourceSelection] = useState<{
        key: string;
        source: AnalysisRheologySource;
    }>({ key: '', source: 'program' });

    useEffect(() => {
        return () => {
            if (!isTauri()) return;
            import('@/lib/tauri/reports').then(({ parsing }) => {
                void parsing.releaseCache().catch(() => {
                    // Best-effort memory hint after leaving the detail view.
                });
            }).catch(() => {
                // Older desktop binaries may not expose the cache-release command.
            });
        };
    }, []);

    // Ref for the tab bar — used to scroll it into view on tab switch.
    const tabsRef = useRef<HTMLDivElement>(null);

    const switchTab = useCallback((tab: DashboardTab) => {
        setActiveTab(tab);
        requestAnimationFrame(() => {
            if (tabsRef.current) {
                const top = tabsRef.current.getBoundingClientRect().top + window.scrollY - 72;
                window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
            }
        });
    }, []);

    // Get license info from context (reactive)
    const { result, isInitialized } = useLicense();

    // Check if calibration is available (developer license only + data present)
    const hasCalibrationData = !!parseResult?.metadata?.calibration;
    const canUseCalibration = isInitialized && (result?.license?.features?.calibrationAnalysis ?? false) && hasCalibrationData;
    const effectiveActiveTab: DashboardTab = activeTab === 'calibration' && !canUseCalibration ? 'chart' : activeTab;

    // Keep source points as-is to avoid an extra full-array remap before chart processing.
    const binarySeries = useExperimentSeriesOverview(
        parseResult?.metadata?.experimentId,
        effectiveActiveTab === 'chart',
    );
    const { requestWindow, resetWindow } = binarySeries;
    const handleChartViewportRangeChange = useCallback((range: { xMinSec: number; xMaxSec: number }) => {
        requestWindow(range.xMinSec, range.xMaxSec);
    }, [requestWindow]);

    const handleChartViewportReset = useCallback(() => {
        resetWindow();
    }, [resetWindow]);

    const chartData = useMemo(() => {
        if (!parseResult) return [];
        if (effectiveActiveTab === 'chart' && (binarySeries.columnarData || parseResult.columnarData)) {
            return [];
        }
        return rawPointsFromParseResult(parseResult);
    }, [effectiveActiveTab, binarySeries.columnarData, parseResult]);

    const instrumentRheologyRows = parseResult?.instrumentRheology ?? EMPTY_RHEOLOGY_ROWS;
    const instrumentRheologyView = useMemo(
        () => buildInstrumentRheologyView(instrumentRheologyRows, cycles),
        [cycles, instrumentRheologyRows],
    );
    const parseResultKey = `${parseResult?.metadata?.experimentId ?? ''}|${parseResult?.metadata?.filename ?? ''}`;
    const savedRheologySource = parseResult?.metadata?.rheologySource;
    const defaultRheologySource: AnalysisRheologySource =
        savedRheologySource === 'instrument' || savedRheologySource === 'program'
            ? savedRheologySource
            : 'program';
    const rheologySource: AnalysisRheologySource =
        rheologySourceSelection.key === parseResultKey ? rheologySourceSelection.source : defaultRheologySource;
    const setRheologySource = useCallback((source: AnalysisRheologySource) => {
        setRheologySourceSelection({ key: parseResultKey, source });
    }, [parseResultKey]);
    const handleEditCycle = useCallback(async (cycleId: number) => {
        if (isFullDataLoading) return;
        if (isMetadataOnly) {
            const loaded = await onRequireFullData?.();
            if (!loaded) return;
        }
        setEditingCycleId(cycleId);
    }, [isFullDataLoading, isMetadataOnly, onRequireFullData]);

    if (!parseResult) {
        return null;
    }

    const currentGeometry = geometryOverride?.geometry || parseResult.metadata?.geometry || 'Unknown';
    const chartColumnarData = binarySeries.columnarData ?? parseResult.columnarData ?? null;
    const currentGeometrySource = geometryOverride ? 'manual' : parseResult.metadata?.geometrySource || 'unknown';
    const experimentId = parseResult.metadata?.experimentId;
    const hasInstrumentRheology = instrumentRheologyRows.length > 0;
    const displayedCycleResults = rheologySource === 'instrument' ? instrumentRheologyView.results : cycleResults;
    const displayedCycles = rheologySource === 'instrument' ? instrumentRheologyView.cycles : cycles;
    const displayedCycleCount = displayedCycles.length;

    return (
        <div className="space-y-6">
            {/* Warnings Section */}
            <section>
                <div className="space-y-4">
                    {/* Instrument Warning */}
                    {!parseResult.metadata?.instrumentType && (
                        <div className="flex items-center justify-between flex-wrap gap-4 border-b border-amber-500/20 pb-4 last:border-0 last:pb-0">
                            <div>
                                <h3 className="text-amber-700 dark:text-amber-400 font-semibold flex items-center gap-2">
                                    ⚠️ Прибор не определён
                                </h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    Выберите тип вискозиметра вручную для корректной обработки данных
                                </p>
                            </div>
                            <InstrumentSelector
                                currentInstrument={parseResult.metadata?.instrumentType}
                                onInstrumentChange={onInstrumentChange}
                            />
                        </div>
                    )}

                    {/* Geometry Warning */}
                    {!geometryOverride && (parseResult.metadata?.geometrySource === 'default' || parseResult.metadata?.hasShearRateIssue) && (
                        <div className="flex items-center justify-between flex-wrap gap-4">
                            <div>
                                <h3 className="text-amber-700 dark:text-amber-400 font-semibold flex items-center gap-2">
                                    ⚠️ {parseResult.metadata?.hasShearRateIssue
                                        ? 'Ошибка: скорость сдвига не соответствует η = τ/γ̇'
                                        : 'Геометрия не определена автоматически'}
                                </h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    {parseResult.metadata?.hasShearRateIssue
                                        ? 'Подтвердите геометрию для пересчёта скорости сдвига с правильным K-фактором'
                                        : 'Выберите геометрию вручную для корректного расчёта скорости сдвига'}
                                </p>
                            </div>
                            <GeometrySelector
                                currentGeometry={currentGeometry}
                                geometrySource={currentGeometrySource}
                                onGeometryChange={onGeometryChange}
                            />
                        </div>
                    )}
                </div>
            </section>

            {/* Parsing Logs — expert mode only */}
            {isExpert && (
                <section>
                    <ParsingLogs
                        metadata={parseResult.metadata}
                        summary={parseResult.summary}
                        source={parseResult.source}
                        parsedBy={parseResult.parsedBy}
                    />
                </section>
            )}

            {/* Tab switcher */}
            <div ref={tabsRef} className="flex gap-2 flex-wrap items-center" role="tablist" aria-label="Режим отображения">
                <button
                    onClick={() => switchTab('chart')}
                    data-testid="ChartTabButton"
                    role="tab"
                    aria-selected={effectiveActiveTab === 'chart'}
                    className={tabButtonClass(effectiveActiveTab === 'chart')}
                >
                    <BarChart3 className="w-4 h-4" />
                    График
                </button>
                <button
                    onClick={() => switchTab('table')}
                    data-testid="TableTabButton"
                    role="tab"
                    aria-selected={effectiveActiveTab === 'table'}
                    className={tabButtonClass(effectiveActiveTab === 'table')}
                >
                    <Table className="w-4 h-4" />
                    Таблица данных
                </button>

                <button
                    onClick={() => switchTab('recipe')}
                    data-testid="RecipeTabButton"
                    role="tab"
                    aria-selected={effectiveActiveTab === 'recipe'}
                    className={tabButtonClass(effectiveActiveTab === 'recipe')}
                >
                    <ClipboardList className="w-4 h-4" />
                    Рецептура
                </button>

                <button
                    onClick={() => switchTab('water')}
                    data-testid="WaterTabButton"
                    role="tab"
                    aria-selected={effectiveActiveTab === 'water'}
                    className={tabButtonClass(effectiveActiveTab === 'water')}
                >
                    <Droplets className="w-4 h-4" />
                    Анализ воды
                </button>

                {canUseCalibration && (
                    <button
                        onClick={() => switchTab('calibration')}
                        data-testid="CalibrationTabButton"
                        role="tab"
                        aria-selected={effectiveActiveTab === 'calibration'}
                        className={tabButtonClass(effectiveActiveTab === 'calibration')}
                    >
                        <Settings className="w-4 h-4" />
                        Калибровка
                    </button>
                )}

                <button
                    onClick={() => switchTab('report')}
                    data-testid="ReportTabButton"
                    role="tab"
                    aria-selected={effectiveActiveTab === 'report'}
                    className={tabButtonClass(effectiveActiveTab === 'report')}
                >
                    <FileText className="w-4 h-4" />
                    Отчёт
                </button>

                <button
                    onClick={onSaveClick}
                    data-testid="SaveExperimentButton"
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-foreground rounded-lg font-medium transition-colors ml-auto shadow-lg shadow-green-900/20"
                    disabled={isFullDataLoading}
                >
                    <Save className="w-4 h-4" />
                    {isFullDataLoading ? 'Загрузка...' : 'Сохранить'}
                </button>
            </div>

            {/* Content Area */}
            <section className="bg-card rounded-xl border border-border overflow-hidden">
                {effectiveActiveTab === 'chart' && (
                    <div data-testid="DashboardChartContainer">
                        <ChartErrorBoundary height={600}>
                            <RheologyChart
                                data={chartData}
                                columnarData={chartColumnarData}
                                viewportTimeOriginSec={binarySeries.timeOriginSec}
                                onViewportRangeChange={handleChartViewportRangeChange}
                                onViewportReset={handleChartViewportReset}
                                title="График реологических данных"
                                height={600}
                                instrumentInfo={{
                                    geometry: parseResult.metadata.geometry,
                                    geometrySource: parseResult.metadata.geometrySource,
                                    instrumentType: parseResult.metadata.instrumentType,
                                    sheetName: parseResult.metadata.sheetName,
                                    fluidType: undefined
                                }}
                            />
                        </ChartErrorBoundary>
                    </div>
                )}

                {effectiveActiveTab !== 'chart' && (
                    <Suspense fallback={<div className="flex h-48 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" /></div>}>
                        {effectiveActiveTab === 'table' && isMetadataOnly && experimentId && (
                            <RawDataTableById experimentId={experimentId} pageSize={25} />
                        )}

                        {effectiveActiveTab === 'table' && isMetadataOnly && !experimentId && (
                            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                                Не удалось открыть таблицу: отсутствует id эксперимента
                            </div>
                        )}

                        {effectiveActiveTab === 'table' && !isMetadataOnly && (
                            <RawDataTable data={chartData} pageSize={25} />
                        )}

                        {effectiveActiveTab === 'recipe' && (
                            <div className="w-full">
                                <RecipePanel
                                    recipe={editedRecipe}
                                    onRecipeChange={setEditedRecipe}
                                />
                            </div>
                        )}

                        {effectiveActiveTab === 'water' && (
                            <div className="w-full">
                                <WaterAnalysisPanel
                                    waterSource={editedWaterSource}
                                    waterParams={editedWaterParams || undefined}
                                    onWaterSourceChange={setEditedWaterSource}
                                    onParamsChange={setEditedWaterParams}
                                />
                            </div>
                        )}

                        {effectiveActiveTab === 'calibration' && canUseCalibration && (
                            <div className="w-full">
                                <CalibrationPanel calibration={parseResult.metadata?.calibration} />
                            </div>
                        )}

                        {effectiveActiveTab === 'report' && (!isMetadataOnly || experimentId) && (
                            <div className="w-full">
                                <ReportTab
                                    parseResult={parseResult}
                                    savedExperimentId={isMetadataOnly ? experimentId : undefined}
                                    editedRecipe={editedRecipe}
                                    editedWaterParams={editedWaterParams}
                                    editedWaterSource={editedWaterSource}
                                    cycleResults={cycleResults}
                                    cycles={cycles}
                                />
                            </div>
                        )}

                        {effectiveActiveTab === 'report' && isMetadataOnly && !experimentId && (
                            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                                Не удалось открыть отчёт: отсутствует id эксперимента
                            </div>
                        )}
                    </Suspense>
                )}
            </section>

            {/* Rheology Results (only visible on chart tab) */}
            {effectiveActiveTab === 'chart' && (
                <section className="cv-auto">
                    <CollapsibleCard
                        title={
                            <span className="flex items-center gap-2">
                                Реологический анализ
                                {patternOverride && rheologySource === 'program' && <span className="ml-2 text-purple-700 dark:text-purple-400">(Применён паттерн)</span>}
                                <span className="text-xs text-muted-foreground font-normal">({displayedCycleCount} циклов)</span>
                            </span>
                        }
                        headerActions={
                            <>
                                <div className="inline-flex overflow-hidden rounded-lg border border-border bg-background">
                                    <button
                                        type="button"
                                        onClick={() => setRheologySource('program')}
                                        data-testid="AnalysisRheologySourceProgram"
                                        className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                                            rheologySource === 'program'
                                                ? 'bg-cyan-500 text-white'
                                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                        }`}
                                    >
                                        Расчёт
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setRheologySource('instrument')}
                                        data-testid="AnalysisRheologySourceInstrument"
                                        title={hasInstrumentRheology
                                            ? 'Показать реологические параметры, распарсенные из отчёта прибора'
                                            : 'Таблица реологических расчётов не найдена при парсинге'}
                                        className={`px-3 py-1.5 text-xs font-medium border-l border-border transition-colors ${
                                            rheologySource === 'instrument'
                                                ? hasInstrumentRheology
                                                    ? 'bg-cyan-500 text-white'
                                                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                        }`}
                                    >
                                        Прибор
                                    </button>
                                </div>
                                {patternOverride && rheologySource === 'program' && (
                                    <button
                                        onClick={() => setPatternOverride(null)}
                                        className="text-xs px-2 py-1 bg-secondary hover:bg-secondary text-foreground/80 rounded border border-border transition-colors"
                                    >
                                        Сбросить к стандартным
                                    </button>
                                )}
                            </>
                        }
                        defaultOpen={true}
                    >
                        <Suspense fallback={null}>
                            {rheologySource === 'instrument' && !hasInstrumentRheology ? (
                                <div
                                    data-testid="InstrumentRheologyUnavailable"
                                    className="m-4 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
                                >
                                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                                    <div>
                                        <p className="font-semibold text-amber-800 dark:text-amber-300">
                                            Таблица реологических расчётов не найдена
                                        </p>
                                        <p className="mt-1 text-muted-foreground">
                                            В файле не найдена таблица реологических расчётов прибора. Используйте режим «Расчёт», чтобы посмотреть значения, рассчитанные RheoLab.
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <CycleResultsTable
                                    key={`${rheologySource}:${isExpert ? 'expert' : 'basic'}`}
                                    cycles={displayedCycles}
                                    results={displayedCycleResults}
                                    preferResultTiming={rheologySource === 'instrument'}
                                    onEditCycle={isExpert && rheologySource === 'program' ? handleEditCycle : undefined}
                                />
                            )}
                        </Suspense>
                    </CollapsibleCard>
                </section>
            )}

            {/* Cycle Editor Dialog (Expert mode) */}
            {isExpert && editingCycleId !== null && (
                <Suspense fallback={null}>
                <CycleEditorDialog
                    isOpen={true}
                    onClose={() => setEditingCycleId(null)}
                    cycle={cycles.find(c => c.id === editingCycleId) || null}
                    allSteps={allSteps}
                    currentResult={cycleResults.get(editingCycleId) || null}
                    overriddenStepIds={cycleOverrides.get(editingCycleId) || null}
                    onApply={(cycleId, selectedStepIds) => {
                        setCycleOverrides(prev => {
                            const next = new Map(prev);
                            next.set(cycleId, selectedStepIds);
                            return next;
                        });
                        setEditingCycleId(null);
                    }}
                    onApplyPatternToAll={(shearRatePattern) => {
                        // Apply global pattern override
                        setPatternOverride(shearRatePattern);
                        setEditingCycleId(null);
                    }}
                />
                </Suspense>
            )}
        </div>
    );
}

/**
 * Memoised export — skips render when parent's unrelated state updates
 * (SaveDialog open, isLoading, overwrite/name-conflict confirmations, …)
 * leave every prop referentially equal. Inner callbacks in `dashboard/page.tsx`
 * are wrapped in `useCallback`, and state slices come through Zustand+useShallow
 * so the equality check actually holds in practice.
 */
export const DashboardContent = memo(DashboardContentInner);
