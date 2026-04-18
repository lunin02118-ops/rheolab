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
import { Upload } from 'lucide-react';
import { ConfirmationDialogs } from './ConfirmationDialogs';
import { DemoDropdown } from './DemoDropdown';
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
                            <DemoDropdown
                                fixtures={fixtures}
                                loadingFixture={loadingFixture}
                                showDropdown={showDemoDropdown}
                                setShowDropdown={setShowDemoDropdown}
                                loadFixture={loadFixture}
                            />
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

                        <ConfirmationDialogs
                            pendingOverwritePayload={pendingOverwritePayload}
                            pendingNameConflictPayload={pendingNameConflictPayload}
                            isSaving={isSaving}
                            nameConflictFocusTrapRef={nameConflictFocusTrapRef}
                            cancelOverwrite={cancelOverwrite}
                            confirmOverwrite={confirmOverwrite}
                            cancelNameConflict={cancelNameConflict}
                            confirmNameOverwrite={confirmNameOverwrite}
                        />
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
