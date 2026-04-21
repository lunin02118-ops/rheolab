import { useState, useMemo, useRef, useCallback } from 'react';
import { BarChart3, Table, Droplets, Save, Settings, FileText } from 'lucide-react';
import { Logo } from '@/components/ui/logo';
import { CollapsibleCard } from '@/components/ui/collapsible-card';
import { CalibrationPanel } from '@/components/calibration/CalibrationPanel';
import { RheologyChart } from '@/components/charts/rheology-chart-uplot';
import { ChartErrorBoundary } from '@/components/shared/ChartErrorBoundary';
import { RawDataTable } from '@/components/dashboard/raw-data-table';
import { RecipePanel } from '@/components/analysis/recipe-panel';
import { WaterAnalysisPanel } from '@/components/analysis/water-analysis-panel';
import { ReportTab } from '@/components/analysis/ReportTab';
import { CycleResultsTable } from '@/components/analysis/cycle-results-table';
import { CycleEditorDialog } from '@/components/analysis/cycle-editor-dialog';
import { ParsingLogs } from '@/components/dashboard/parsing-logs';
import { InstrumentSelector } from '@/components/dashboard/instrument-selector';
import { GeometrySelector } from '@/components/dashboard/geometry-selector';
import type { ParseResult } from '@/lib/store/experiment-data-store';
import { rawPointsFromParseResult } from '@/lib/utils/columnar';
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
}

export function DashboardContent({
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
    setPatternOverride
}: DashboardContentProps) {
    const [activeTab, setActiveTab] = useState<'chart' | 'table' | 'recipe' | 'water' | 'calibration' | 'report'>('chart');
    const [editingCycleId, setEditingCycleId] = useState<number | null>(null);

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

    // Check if calibration is available (developer license only)
    const canUseCalibration = isInitialized && (result?.license?.features?.calibrationAnalysis ?? false);

    // Keep source points as-is to avoid an extra full-array remap before chart processing.
    const chartData = useMemo(() => {
        if (!parseResult) return [];
        return rawPointsFromParseResult(parseResult);
    }, [parseResult]);

    if (!parseResult) {
        return null;
    }

    const currentGeometry = geometryOverride?.geometry || parseResult.metadata?.geometry || 'Unknown';
    const chartColumnarData = parseResult.columnarData ?? null;
    const currentGeometrySource = geometryOverride ? 'manual' : parseResult.metadata?.geometrySource || 'unknown';

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

                <button
                    onClick={() => switchTab('calibration')}
                    data-testid="CalibrationTabButton"
                    role="tab"
                    aria-selected={activeTab === 'calibration'}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${activeTab === 'calibration'
                        ? 'bg-amber-600 text-foreground'
                        : 'bg-secondary text-muted-foreground hover:text-foreground'
                        } ${!canUseCalibration ? 'hidden' : ''}`}
                    disabled={!canUseCalibration}
                >
                    <Settings className="w-4 h-4" />
                    Калибровка
                </button>

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
                >
                    <Save className="w-4 h-4" />
                    Сохранить
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

                {activeTab === 'table' && (
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

                {activeTab === 'calibration' && (
                    <div className="w-full">
                        <CalibrationPanel calibration={parseResult.metadata?.calibration} />
                    </div>
                )}

                {activeTab === 'report' && (
                    <div className="w-full">
                        <ReportTab
                            parseResult={parseResult}
                            editedRecipe={editedRecipe}
                            editedWaterParams={editedWaterParams}
                            editedWaterSource={editedWaterSource}
                            cycleResults={cycleResults}
                            cycles={cycles}
                        />
                    </div>
                )}
            </section>

            {/* Rheology Results (only visible on chart tab) */}
            {activeTab === 'chart' && (
                <section className="cv-auto">
                    <CollapsibleCard
                        title={
                            <span className="flex items-center gap-2">
                                <Logo className="w-5 h-5 text-orange-400" />
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
                        <CycleResultsTable
                            cycles={cycles}
                            results={cycleResults}
                            onEditCycle={isExpert ? (cycleId) => setEditingCycleId(cycleId) : undefined}
                        />
                    </CollapsibleCard>
                </section>
            )}

            {/* Cycle Editor Dialog (Expert mode) */}
            {isExpert && editingCycleId !== null && (
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
            )}
        </div>
    );
}
