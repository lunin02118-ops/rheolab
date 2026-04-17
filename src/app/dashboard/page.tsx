import { logger as clientLogger } from '@/lib/client-logger';

import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { FileUpload } from '@/components/dashboard/file-upload';
import { SaveExperimentDialog } from '@/components/dashboard/save-experiment-dialog';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useUIMode } from '@/contexts/ui-mode-context';
import { useAnalysisSettingsStore } from '@/lib/store/analysis-settings-store';
import { useExperimentDataStore, ParseResult } from '@/lib/store/experiment-data-store';
import { useShallow } from 'zustand/react/shallow';
import { useAnalysisPipeline } from '@/hooks/useAnalysisPipeline';
const DashboardContent = lazy(() =>
    import('@/components/dashboard/DashboardContent').then(m => ({ default: m.DashboardContent })));
import { Upload, Beaker, ChevronDown, AlertTriangle, Save } from 'lucide-react';
import { useLicense } from '@/hooks/useLicense';
import { getExperimentById } from '@/lib/experiments/client';
import { mapExperimentToParseResult, mapReagentsToRecipe } from '@/lib/experiments/mappers';
import type { WaterParams } from '@/types';

// Custom hooks
import { useFixtureLoader, useExperimentSave } from './hooks';

export default function Dashboard() {
    const { isExpert } = useUIMode();
    const expertSettings = useAnalysisSettingsStore(s => s.expertSettings);
    const { refreshExperimentsCount, canSaveExperiment, isDemo } = useLicense();

    // State fields — re-renders when data changes
    const {
        parseResult,
        error,
        isLoading,
        recipe,
        waterSource,
        waterParams,
        cycleOverrides,
        patternOverride,
    } = useExperimentDataStore(useShallow(s => ({
        parseResult: s.parseResult,
        error: s.error,
        isLoading: s.isLoading,
        recipe: s.recipe,
        waterSource: s.waterSource,
        waterParams: s.waterParams,
        cycleOverrides: s.cycleOverrides,
        patternOverride: s.patternOverride,
    })));

    // Action references — stable Zustand refs, extracted separately to avoid
    // bundling them with state fields that cause re-renders
    const {
        setParseResult,
        setError,
        setIsLoading,
        setRecipe,
        setWaterSource,
        setWaterParams,
        setCycleOverrides,
        setPatternOverride,
        updateMetadata,
        updateGeometry,
    } = useExperimentDataStore(useShallow(s => ({
        setParseResult: s.setParseResult,
        setError: s.setError,
        setIsLoading: s.setIsLoading,
        setRecipe: s.setRecipe,
        setWaterSource: s.setWaterSource,
        setWaterParams: s.setWaterParams,
        setCycleOverrides: s.setCycleOverrides,
        setPatternOverride: s.setPatternOverride,
        updateMetadata: s.updateMetadata,
        updateGeometry: s.updateGeometry,
    })));

    // Ref for auto-scroll to chart after parsing
    const chartSectionRef = useRef<HTMLDivElement>(null);
    const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    // Clean up pending scroll timer on unmount
    useEffect(() => () => clearTimeout(scrollTimerRef.current), []);

    // Reset expert overrides when switching between beginner/expert mode
    const prevIsExpertRef = useRef(isExpert);
    useEffect(() => {
        if (prevIsExpertRef.current !== isExpert) {
            prevIsExpertRef.current = isExpert;
            setCycleOverrides(new Map());
            setPatternOverride(null);
        }
    }, [isExpert, setCycleOverrides, setPatternOverride]);

    const [geometryOverride, setGeometryOverride] = useState<{ geometry: string; kFactor: number } | null>(null);

    // Analysis pipeline
    const { cycles, cycleResults, allSteps, isAnalyzing } = useAnalysisPipeline({
        parseResult,
        isExpert,
        cycleOverrides,
        patternOverride,
        setError
    });

    // Fixture loader hook
    const {
        fixtures,
        loadingFixture,
        showDropdown: showDemoDropdown,
        setShowDropdown: setShowDemoDropdown,
        loadFixture
    } = useFixtureLoader({
        aiModel: expertSettings.aiModel,
        forceAI: expertSettings.forceAiParsing,
        onLoad: (result) => {
            setParseResult(result);
            setError(null);
            setRecipe(result.metadata.filenameMetadata?.recipe || []);
            setWaterSource(result.metadata.filenameMetadata?.waterSource || '');
            setWaterParams({});
            clearTimeout(scrollTimerRef.current);
            scrollTimerRef.current = setTimeout(() => {
                if (chartSectionRef.current) {
                    const top = chartSectionRef.current.getBoundingClientRect().top + window.scrollY - 72;
                    window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
                }
            }, 200);
        },
        onError: setError
    });

    // Experiment save hook
    const {
        isSaving,
        showSaveDialog,
        setShowSaveDialog,
        pendingOverwritePayload,
        pendingNameConflictPayload,
        handleSave,
        confirmOverwrite,
        cancelOverwrite,
        confirmNameOverwrite,
        cancelNameConflict,
    } = useExperimentSave({
        parseResult,
        isDemo,
        canSaveExperiment,
        refreshExperimentsCount,
        setWaterSource,
        setWaterParams,
        setRecipe,
        updateMetadata
    });

    const _overwriteFocusTrapRef = useFocusTrap<HTMLDivElement>(!!pendingOverwritePayload);
    const nameConflictFocusTrapRef = useFocusTrap<HTMLDivElement>(!!pendingNameConflictPayload);

    // Load experiment from URL if present
    useEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        const loadExperimentId = searchParams.get('loadExperimentId');
        let cancelled = false;

        if (loadExperimentId) {
            setIsLoading(true);
            setError(null);

            getExperimentById(loadExperimentId)
                .then(data => {
                    if (cancelled) return;
                    if (data.success && data.experiment) {
                        const exp = data.experiment;
                        const result = mapExperimentToParseResult(exp);
                        setParseResult(result);

                        // Auto-scroll to chart after loading experiment
                        clearTimeout(scrollTimerRef.current);
                        scrollTimerRef.current = setTimeout(() => {
                            if (chartSectionRef.current) {
                                const top = chartSectionRef.current.getBoundingClientRect().top + window.scrollY - 72;
                                window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
                            }
                        }, 200);

                        if (exp.reagents && exp.reagents.length > 0) {
                            setRecipe(mapReagentsToRecipe(exp.reagents));
                        } else {
                            setRecipe([]);
                        }
                        setWaterSource(exp.waterSource || '');
                        setWaterParams((exp.waterParams as Partial<WaterParams>) || {});

                        if (exp.geometry) {
                            setGeometryOverride({
                                geometry: exp.geometry,
                                kFactor: 1
                            });
                        }

                        window.history.replaceState({}, '', '/dashboard');
                    } else {
                        setError(data.error || 'Failed to load experiment');
                    }
                })
                .catch(err => {
                    if (cancelled) return;
                    clientLogger.error('Failed to load experiment:', err);
                    setError('Failed to load experiment from library');
                })
                .finally(() => {
                    if (!cancelled) setIsLoading(false);
                });
        }
        return () => { cancelled = true; };
    }, [setIsLoading, setError, setParseResult, setRecipe, setWaterSource, setWaterParams]);

    const handleFileProcessed = useCallback((result: ParseResult) => {
        setParseResult(result);
        setError(null);
        setIsLoading(false);
        setGeometryOverride(null);
        setRecipe(result.metadata.filenameMetadata?.recipe || []);
        setWaterSource(result.metadata.filenameMetadata?.waterSource || '');
        setWaterParams({});
        // Auto-scroll to chart after parsing
        clearTimeout(scrollTimerRef.current);
        scrollTimerRef.current = setTimeout(() => {
            if (chartSectionRef.current) {
                const top = chartSectionRef.current.getBoundingClientRect().top + window.scrollY - 72;
                window.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
            }
        }, 200);
    }, [setParseResult, setError, setIsLoading, setRecipe, setWaterSource, setWaterParams]);

    const handleGeometryChange = useCallback((geometry: string, kFactor: number) => {
        setGeometryOverride({ geometry, kFactor });
        updateGeometry(geometry, kFactor);
    }, [updateGeometry]);

    const handleError = useCallback((errorMessage: string) => {
        setError(errorMessage);
        setIsLoading(false);
    }, [setError, setIsLoading]);

    // Memoised analysis data for SaveExperimentDialog — avoids recreating the
    // 30+ field object literal on every render of the dashboard page.
    const analysisData = useMemo(() => {
        if (!parseResult) return undefined;
        const cal = parseResult.metadata?.calibration;
        return {
            filename: parseResult.metadata?.filename || 'experiment',
            instrumentType: parseResult.metadata?.instrumentType || '',
            testDate: parseResult.metadata?.testDate || new Date(),
            // Seed hint only — actual fluidType is auto-detected from reagent recipe
            // in the save dialog (useSaveDialogInit Effect 7). User can also override it.
            fluidType: 'Linear' as const,
            testGroup: 'Rheology' as const,
            metrics: {
                maxViscosity: parseResult.summary?.viscosityRange?.max || 0,
                maxTemp: parseResult.summary?.temperatureRange?.max || 0,
                duration: parseResult.summary?.timeRange?.durationMinutes || 0,
            },
            rawPoints: parseResult.data?.length ? parseResult.data : undefined,
            columnarData: parseResult.columnarData,
            parsedBy: parseResult.metadata?.parsedBy,
            parseSource: parseResult.metadata?.parseSource,
            timeRangeMin: parseResult.summary?.timeRange?.start,
            timeRangeMax: parseResult.summary?.timeRange?.end,
            viscosityMin: parseResult.summary?.viscosityRange?.min,
            pressureMax: parseResult.summary?.pressureRange?.max,
            calibration: cal ? {
                deviceType: cal.deviceType,
                rSquared: cal.rSquared,
                slope: cal.slope,
                intercept: cal.intercept,
                hysteresis: cal.hysteresis,
                stdev: cal.stdev,
                status: cal.status,
                issues: cal.issues,
                calibrationDate: (() => {
                        const raw = cal.lastCalDate ?? cal.calibrationDate;
                        if (!raw) return null;
                        const d = new Date(raw as string);
                        return isNaN(d.getTime()) ? null : d;
                    })(),
                rawData: (() => {
                    try {
                        return typeof cal.rawData === 'string'
                            ? JSON.parse(cal.rawData)
                            : cal.rawData;
                    } catch (_e) { return []; }
                })(),
            } : null,
            geometry: geometryOverride?.geometry || parseResult.metadata?.geometry,
            geometrySource: geometryOverride
                ? 'manual'
                : (parseResult.metadata?.geometrySource || (parseResult.metadata?.geometry ? 'context' : 'default')),
            testId: parseResult.metadata?.filenameMetadata?.testId,
            prefilledName: parseResult.metadata?.filenameMetadata?.savedExperimentName,
            prefilledFieldName: parseResult.metadata?.filenameMetadata?.fieldName,
            prefilledOperatorName: parseResult.metadata?.filenameMetadata?.operatorName,
            prefilledWellNumber: parseResult.metadata?.filenameMetadata?.wellNumber,
            prefilledWaterSource: waterSource,
            prefilledWaterParams: waterParams,
            prefilledRecipe: recipe,
        };
    }, [parseResult, geometryOverride, waterSource, waterParams, recipe]);

    return (
        <div className="min-h-screen">
            <main className="w-full px-6 py-8">
                <div className="grid gap-8">
                    {/* Upload section */}
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Upload className="w-5 h-5 text-blue-400" />
                                <h2 className="text-lg font-semibold text-foreground">Загрузка данных</h2>
                            </div>

                            {/* Demo Mode Button */}
                            {fixtures.length > 0 && (
                                <div className="relative">
                                    <button
                                        onClick={() => setShowDemoDropdown(!showDemoDropdown)}
                                        data-testid="DemoFilesButton"
                                        className="flex items-center gap-2 px-4 py-2 bg-purple-100 dark:bg-purple-600/20 border border-purple-400 dark:border-purple-500/30 rounded-lg text-purple-700 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-600/30 transition-colors"
                                    >
                                        <Beaker className="w-4 h-4" />
                                        <span>Demo Файлы</span>
                                        <ChevronDown className={`w-4 h-4 transition-transform ${showDemoDropdown ? 'rotate-180' : ''}`} />
                                    </button>

                                    {showDemoDropdown && (
                                        <div
                                            data-testid="DemoFilesDropdown"
                                            className="absolute right-0 mt-2 w-72 bg-card border border-border rounded-xl shadow-xl overflow-hidden z-50"
                                        >
                                            <div className="p-2 border-b border-border">
                                                <p className="text-xs text-muted-foreground px-2">Тестовые файлы ({fixtures.length})</p>
                                            </div>
                                            <div className="max-h-64 overflow-y-auto">
                                                {fixtures.map((fixture) => (
                                                    <button
                                                        key={fixture.name}
                                                        onClick={() => loadFixture(fixture.name)}
                                                        disabled={loadingFixture === fixture.name}
                                                        data-testid={`DemoFileItem-${fixture.name}`}
                                                        className="w-full px-4 py-2.5 text-left text-sm text-foreground hover:bg-secondary/70 transition-colors flex items-center justify-between disabled:opacity-50"
                                                    >
                                                        <span className="truncate">{fixture.displayName}</span>
                                                        {loadingFixture === fixture.name && (
                                                            <span className="text-xs text-purple-400 animate-pulse">Loading...</span>
                                                        )}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <FileUpload
                            onFileProcessed={handleFileProcessed}
                            onError={handleError}
                            isLoading={isLoading || isAnalyzing}
                            loadedFileName={loadingFixture || parseResult?.metadata?.filename || null}
                            externalLoading={!!loadingFixture || isLoading}
                            onReset={() => {
                                setParseResult(null);
                                setError(null);
                            }}
                        />

                        {/* Error display */}
                        {error && (
                            <div className="mt-4 p-4 bg-red-500/20 border border-red-500/30 rounded-xl">
                                <p className="text-red-600 dark:text-red-400">{error}</p>
                            </div>
                        )}

                        {/* Overwrite Confirmation Dialog */}
                        {pendingOverwritePayload && (
                            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
                            <div
                                aria-labelledby="overwrite-dialog-title"
                                className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scale-in">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-3 bg-amber-500/20 rounded-full">
                                        <AlertTriangle className="w-6 h-6 text-amber-500" />
                                    </div>
                                    <h3 id="overwrite-dialog-title" className="text-xl font-semibold text-foreground">Эксперимент уже существует</h3>
                                </div>

                                    <p className="text-muted-foreground mb-6">
                                        Отчёт с именем <span className="text-foreground font-medium">&quot;{pendingOverwritePayload.name}&quot;</span> от <span className="text-foreground font-medium">{new Date(pendingOverwritePayload.testDate).toLocaleDateString()}</span> уже сохранён в базе данных.
                                        <br /><br />
                                        Вы хотите <strong>перезаписать</strong> его текущими данными? Это действие нельзя отменить.
                                    </p>

                                    <div className="flex justify-end gap-3">
                                        <button
                                            onClick={cancelOverwrite}
                                            className="px-4 py-2 rounded-lg text-muted-foreground hover:bg-secondary transition-colors"
                                        >
                                            Отмена
                                        </button>
                                        <button
                                            onClick={confirmOverwrite}
                                            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium shadow-lg shadow-amber-900/20 transition-colors flex items-center gap-2"
                                        >
                                            {isSaving ? <span className="animate-spin">⏳</span> : <Save className="w-4 h-4" />}
                                            Перезаписать
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Name Conflict Dialog */}
                        {pendingNameConflictPayload && (
                            <div ref={nameConflictFocusTrapRef} role="dialog" aria-modal="true" className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
                                <div
                                    aria-labelledby="name-conflict-dialog-title"
                                    className="bg-card border border-border rounded-2xl shadow-2xl max-w-md w-full p-6 animate-scale-in">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="p-3 bg-amber-500/20 rounded-full">
                                            <AlertTriangle className="w-6 h-6 text-amber-500" />
                                        </div>
                                        <h3 id="name-conflict-dialog-title" className="text-xl font-semibold text-foreground">Совпадение названия</h3>
                                    </div>
                                    <p className="text-muted-foreground mb-6">
                                        Тест «<span className="text-foreground font-medium">{pendingNameConflictPayload.name}</span>» уже существует в базе данных.
                                        <br /><br />
                                        Перезапишите существующий тест или вернитесь назад, чтобы ввести другое название.
                                    </p>
                                    <div className="flex justify-end gap-3">
                                        <button
                                            data-testid="NameConflictRenameButton"
                                            onClick={cancelNameConflict}
                                            className="px-4 py-2 rounded-lg text-muted-foreground hover:bg-secondary transition-colors"
                                        >
                                            Переименовать
                                        </button>
                                        <button
                                            data-testid="NameConflictOverwriteButton"
                                            onClick={confirmNameOverwrite}
                                            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium shadow-lg shadow-amber-900/20 transition-colors flex items-center gap-2"
                                        >
                                            {isSaving ? <span className="animate-spin">⏳</span> : <Save className="w-4 h-4" />}
                                            Перезаписать
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* Dashboard Content */}
                    <div ref={chartSectionRef}>
                    <Suspense fallback={<div className="flex h-48 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" /></div>}>
                    <DashboardContent
                        parseResult={parseResult}
                        cycles={cycles}
                        cycleResults={cycleResults}
                        allSteps={allSteps}
                        isExpert={isExpert}
                        editedRecipe={recipe}
                        setEditedRecipe={setRecipe}
                        editedWaterSource={waterSource}
                        setEditedWaterSource={setWaterSource}
                        editedWaterParams={waterParams}
                        setEditedWaterParams={setWaterParams}
                        onSaveClick={() => setShowSaveDialog(true)}
                        onInstrumentChange={(inst) => updateMetadata({ instrumentType: inst })}
                        onGeometryChange={handleGeometryChange}
                        geometryOverride={geometryOverride}
                        cycleOverrides={cycleOverrides}
                        setCycleOverrides={setCycleOverrides}
                        patternOverride={patternOverride}
                        setPatternOverride={setPatternOverride}
                    />
                    </Suspense>
                    </div>
                </div>
            </main>

            {/* Save Dialog */}
            {analysisData && (
                <SaveExperimentDialog
                    isOpen={showSaveDialog}
                    onClose={() => setShowSaveDialog(false)}
                    onSave={handleSave}
                    analysisData={analysisData}
                />
            )}
        </div>
    );
}
