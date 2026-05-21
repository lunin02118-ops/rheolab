import { memo, useState, useMemo, useRef, useCallback, useEffect, lazy, Suspense } from 'react';
import { BarChart3, Table, Droplets, Save, Settings, FileText } from 'lucide-react';
import { Logo } from '@/components/ui/logo';
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
    isFullDataLoading = false
}: DashboardContentProps) {
    const [activeTab, setActiveTab] = useState<'chart' | 'table' | 'recipe' | 'water' | 'calibration' | 'report'>('chart');
    const [editingCycleId, setEditingCycleId] = useState<number | null>(null);

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

    const switchTab = useCallback((tab: typeof activeTab) => {
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

    useEffect(() => {
        if (activeTab === 'calibration' && !canUseCalibration) {
            setActiveTab('chart');
        }
    }, [activeTab, canUseCalibration]);

    // Keep source points as-is to avoid an extra full-array remap before chart processing.
    const binarySeries = useExperimentSeriesOverview(
        parseResult?.metadata?.experimentId,
        activeTab === 'chart',
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
        if (activeTab === 'chart' && (binarySeries.columnarData || parseResult.columnarData)) {
            return [];
        }
        return rawPointsFromParseResult(parseResult);
    }, [activeTab, binarySeries.columnarData, parseResult]);

    if (!parseResult) {
        return null;
    }

    const currentGeometry = geometryOverride?.geometry || parseResult.metadata?.geometry || 'Unknown';
    const chartColumnarData = binarySeries.columnarData ?? parseResult.columnarData ?? null;
    const currentGeometrySource = geometryOverride ? 'manual' : parseResult.metadata?.geometrySource || 'unknown';
    const experimentId = parseResult.metadata?.experimentId;

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
                    aria-selected={activeTab === 'chart'}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === 'chart'
                        ? 'bg-blue-600 text-foreground'
                        : 'bg-secondary text-muted-foreground hover:text-foreground'
                        }`}
                >
                    <BarChart3 className="w-4 h-4" />
                    График
                </button>
                <button
                    onClick={() => switchTab('table')}
                    data-testid="TableTabButton"
                    role="tab"
                    aria-selected={activeTab === 'table'}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === 'table'
                        ? 'bg-blue-600 text-foreground'
                        : 'bg-secondary text-muted-foreground hover:text-foreground'
                        }`}
                >
                    <Table className="w-4 h-4" />
                    Таблица данных
                </button>

                <button
                    onClick={() => switchTab('recipe')}
                    data-testid="RecipeTabButton"
                    role="tab"
                    aria-selected={activeTab === 'recipe'}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === 'recipe'
                        ? 'bg-purple-600 text-foreground'
                        : 'bg-secondary text-muted-foreground hover:text-foreground'
                        }`}
                >
                    <Logo className="w-4 h-4" />
                    Рецептура
                </button>

                <button
                    onClick={() => switchTab('water')}
                    data-testid="WaterTabButton"
                    role="tab"
                    aria-selected={activeTab === 'water'}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === 'water'
                        ? 'bg-cyan-600 text-foreground'
                        : 'bg-secondary text-muted-foreground hover:text-foreground'
                        }`}
                >
                    <Droplets className="w-4 h-4" />
                    Анализ воды
                </button>

                {canUseCalibration && (
                    <button
                        onClick={() => switchTab('calibration')}
                        data-testid="CalibrationTabButton"
                        role="tab"
                        aria-selected={activeTab === 'calibration'}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === 'calibration'
                            ? 'bg-amber-600 text-foreground'
                            : 'bg-secondary text-muted-foreground hover:text-foreground'
                            }`}
                    >
                        <Settings className="w-4 h-4" />
                        Калибровка
                    </button>
                )}

                <button
                    onClick={() => switchTab('report')}
                    data-testid="ReportTabButton"
                    role="tab"
                    aria-selected={activeTab === 'report'}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === 'report'
                        ? 'bg-purple-600 text-foreground'
                        : 'bg-secondary text-muted-foreground hover:text-foreground'
                        }`}
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
                {activeTab === 'chart' && (
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

                {activeTab !== 'chart' && (
                    <Suspense fallback={<div className="flex h-48 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" /></div>}>
                        {activeTab === 'table' && isMetadataOnly && experimentId && (
                            <RawDataTableById experimentId={experimentId} pageSize={25} />
                        )}

                        {activeTab === 'table' && isMetadataOnly && !experimentId && (
                            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                                Не удалось открыть таблицу: отсутствует id эксперимента
                            </div>
                        )}

                        {activeTab === 'table' && !isMetadataOnly && (
                            <RawDataTable data={chartData} pageSize={25} />
                        )}

                        {activeTab === 'recipe' && (
                            <div className="w-full">
                                <RecipePanel
                                    recipe={editedRecipe}
                                    onRecipeChange={setEditedRecipe}
                                />
                            </div>
                        )}

                        {activeTab === 'water' && (
                            <div className="w-full">
                                <WaterAnalysisPanel
                                    waterSource={editedWaterSource}
                                    waterParams={editedWaterParams || undefined}
                                    onWaterSourceChange={setEditedWaterSource}
                                    onParamsChange={setEditedWaterParams}
                                />
                            </div>
                        )}

                        {activeTab === 'calibration' && canUseCalibration && (
                            <div className="w-full">
                                <CalibrationPanel calibration={parseResult.metadata?.calibration} />
                            </div>
                        )}

                        {activeTab === 'report' && (!isMetadataOnly || experimentId) && (
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

                        {activeTab === 'report' && isMetadataOnly && !experimentId && (
                            <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                                Не удалось открыть отчёт: отсутствует id эксперимента
                            </div>
                        )}
                    </Suspense>
                )}
            </section>

            {/* Rheology Results (only visible on chart tab) */}
            {activeTab === 'chart' && (
                <section className="cv-auto">
                    <CollapsibleCard
                        title={
                            <span className="flex items-center gap-2">
                                Реологический анализ
                                {patternOverride && <span className="ml-2 text-purple-700 dark:text-purple-400">(Применён паттерн)</span>}
                                <span className="text-xs text-muted-foreground font-normal">({cycles.length} циклов)</span>
                            </span>
                        }
                        headerActions={
                            patternOverride ? (
                                <button
                                    onClick={() => setPatternOverride(null)}
                                    className="text-xs px-2 py-1 bg-secondary hover:bg-secondary text-foreground/80 rounded border border-border transition-colors"
                                >
                                    Сбросить к стандартным
                                </button>
                            ) : undefined
                        }
                        defaultOpen={true}
                    >
                        <Suspense fallback={null}>
                            <CycleResultsTable
                                cycles={cycles}
                                results={cycleResults}
                                onEditCycle={isExpert ? (cycleId) => setEditingCycleId(cycleId) : undefined}
                            />
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
