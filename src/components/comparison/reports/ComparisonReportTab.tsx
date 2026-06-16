/**
 * @fileoverview Report sub-tab for the Comparison view.
 *
 * Layout mirrors the single-exp `ReportsPanel` (1 settings column + 3
 * preview columns on `lg+`).
 *
 * @module comparison/reports/ComparisonReportTab
 */

import { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { FileText, Layers } from 'lucide-react';

import { ChartErrorBoundary } from '@/components/shared/ChartErrorBoundary';
import { ComparisonChartUPlot as ComparisonChart } from '@/components/comparison/comparison-chart-uplot';
import {
    ComparisonReportSettings,
    type ComparisonReportRheologySourceMode,
} from './ComparisonReportSettings';
import { LocalComparisonSaveConfirmDialog } from './LocalComparisonSaveConfirmDialog';
import {
    useComparisonReportExport,
    type LocalComparisonFileSaveConfirmationRequest,
} from './hooks/useComparisonReportExport';

import { useComparisonStore } from '@/lib/store/comparison-store';
import { useChartSettingsStore } from '@/lib/store/chart-settings-store';
import { useBrandingStore } from '@/lib/store/branding-store';
import { useAnalysisSettingsStore } from '@/lib/store/analysis-settings-store';
import { useUIMode } from '@/contexts/ui-mode-context';
import { DEFAULT_VISCOSITY_SHEAR_RATES } from '@/lib/analysis/constants';
import { useLicense } from '@/hooks/useLicense';

interface PendingLocalSaveConfirmation {
    request: LocalComparisonFileSaveConfirmationRequest;
    resolve: (confirmed: boolean) => void;
}

export function ComparisonReportTab() {
    const experiments = useComparisonStore(s => s.experiments);
    const displaySettings = useComparisonStore(useShallow(s => s.displaySettings));
    const chartSettings = useChartSettingsStore(s => s.settings);

    // Single-source language picker — persists in the branding store so
    // switching back to single-exp Reports keeps the same choice.
    const { language, setReportLanguage, companyName, companyLogo } = useBrandingStore(
        useShallow(s => ({
            language: s.reportLanguage,
            setReportLanguage: s.setReportLanguage,
            companyName: s.companyName,
            companyLogo: s.companyLogo,
        })),
    );

    // Local toggles for the Comparison-Report sub-tab.  These intentionally
    // shadow the single-exp equivalents — users routinely want a compact
    // comparison without cycling through all sections, so we default them
    // to the most conservative settings.
    const [showCalibration, setShowCalibration] = useState(false);
    const [showRawData, setShowRawData] = useState(false);
    const [showRecipe, setShowRecipe] = useState(true);
    const [showWaterAnalysis, setShowWaterAnalysis] = useState(false);
    const [showRheology, setShowRheology] = useState(true);
    const [rheologySourceMode, setRheologySourceMode] =
        useState<ComparisonReportRheologySourceMode>('program');
    const { isInitialized, result } = useLicense();
    const canUseCalibration = isInitialized && (result?.license?.features?.calibrationAnalysis ?? false);
    const effectiveShowCalibration = showCalibration && canUseCalibration;

    // Unit system derived the same way as in single-exp ReportsPanel.
    const unitSystem: 'SI' | 'SI_Pas' | 'Imperial' = useMemo(() => {
        const vUnit = chartSettings.lines.viscosity.unit;
        if (vUnit === 'Pa·s') return 'SI_Pas';
        if (vUnit === 'cP') return 'Imperial';
        return 'SI';
    }, [chartSettings.lines.viscosity.unit]);

    const expertSettings = useAnalysisSettingsStore(s => s.expertSettings);
    const { isExpert } = useUIMode();
    const [pendingLocalSaveConfirmation, setPendingLocalSaveConfirmation] =
        useState<PendingLocalSaveConfirmation | null>(null);
    const confirmLocalFileSave = useCallback((
        request: LocalComparisonFileSaveConfirmationRequest,
    ) => new Promise<boolean>((resolve) => {
        setPendingLocalSaveConfirmation({ request, resolve });
    }), []);
    const settleLocalSaveConfirmation = useCallback((confirmed: boolean) => {
        setPendingLocalSaveConfirmation((pending) => {
            pending?.resolve(confirmed);
            return null;
        });
    }, []);
    const reportViscosityRates = useMemo(
        () =>
            (isExpert
                ? expertSettings.viscosityShearRates || [...DEFAULT_VISCOSITY_SHEAR_RATES]
                : [...DEFAULT_VISCOSITY_SHEAR_RATES]
            ).filter((r: number) => r > 0),
        [isExpert, expertSettings.viscosityShearRates],
    );

    const {
        isExporting, isExcelExporting, exportError,
        clearError, handleDownloadPdf, handleDownloadExcel,
    } = useComparisonReportExport({
        experiments,
        displaySettings,
        chartSettings,
        language,
        unitSystem,
        companyName,
        companyLogo,
        showCalibration: effectiveShowCalibration,
        showRawData,
        showRecipe,
        showWaterAnalysis,
        showRheology,
        rheologySourceOverride: rheologySourceMode,
        reportViscosityRates,
        isExpert,
        expertSettings,
        confirmLocalFileSave,
    });

    return (
        <div
            data-testid="ComparisonReportTabRoot"
            className="grid grid-cols-1 lg:grid-cols-4 gap-8 h-full min-h-[500px]"
        >
            {/* Settings column */}
            <ComparisonReportSettings
                language={language}
                setLanguage={setReportLanguage}
                showCalibration={effectiveShowCalibration}
                setShowCalibration={setShowCalibration}
                showRawData={showRawData}
                setShowRawData={setShowRawData}
                showRecipe={showRecipe}
                setShowRecipe={setShowRecipe}
                showWaterAnalysis={showWaterAnalysis}
                setShowWaterAnalysis={setShowWaterAnalysis}
                showRheology={showRheology}
                setShowRheology={setShowRheology}
                rheologySourceMode={rheologySourceMode}
                setRheologySourceMode={setRheologySourceMode}
                canUseCalibration={canUseCalibration}
                isExporting={isExporting}
                isExcelExporting={isExcelExporting}
                exportError={exportError}
                onClearError={clearError}
                onDownloadPdf={handleDownloadPdf}
                onDownloadExcel={handleDownloadExcel}
                experimentCount={experiments.length}
            />

            {/* Preview column — fills remaining vertical space */}
            <div className="lg:col-span-3 flex flex-col min-h-0">
                <div className="flex items-center justify-between mb-4 flex-none">
                    <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                        <FileText className="w-5 h-5 text-purple-400" />
                        {language === 'ru' ? 'Предпросмотр' : 'Preview'}
                    </h3>
                </div>

                {/*
                 * Preview card:
                 *   - flex-1 + min-h-0 so it grows to fill the remaining height
                 *   - min-h-[480px] guarantees usability on short viewports
                 *   - ComparisonChart auto-resizes via ResizeObserver, so no
                 *     fixed height prop is needed here
                 */}
                <div className="relative bg-card/50 border border-border/60 rounded-2xl shadow-xl overflow-hidden p-1 flex-1 min-h-[480px]">
                    {experiments.length > 0 ? (
                        <ChartErrorBoundary>
                            <ComparisonChart
                                experiments={experiments}
                                primaryMetric={displaySettings.primaryMetric}
                                leftSecondaryMetric={displaySettings.leftSecondaryMetric}
                                secondaryMetric={displaySettings.secondaryMetric}
                                tertiaryMetric={displaySettings.tertiaryMetric}
                                showLegend={displaySettings.showLegend}
                                showTouchPoints={displaySettings.showTouchPoints}
                                viscosityThreshold={displaySettings.viscosityThreshold}
                                showTargetTime={displaySettings.showTargetTime}
                                targetTime={displaySettings.targetTime}
                            />
                        </ChartErrorBoundary>
                    ) : (
                        <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-card/20">
                            <Layers className="w-16 h-16 mb-4 opacity-20" />
                            <p className="text-base font-medium text-muted-foreground">
                                {language === 'ru'
                                    ? 'Нет экспериментов для сравнения'
                                    : 'No experiments to compare'}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                                {language === 'ru'
                                    ? 'Добавьте эксперименты на вкладке «График»'
                                    : 'Add experiments in the "Chart" tab'}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            <LocalComparisonSaveConfirmDialog
                open={pendingLocalSaveConfirmation !== null}
                language={language}
                count={pendingLocalSaveConfirmation?.request.count ?? 0}
                fileNames={pendingLocalSaveConfirmation?.request.fileNames ?? []}
                onConfirm={() => settleLocalSaveConfirmation(true)}
                onCancel={() => settleLocalSaveConfirmation(false)}
            />
        </div>
    );
}
