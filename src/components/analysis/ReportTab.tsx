import { useEffect, useState } from 'react';
import { FileText, Download, Loader2, Languages } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useBrandingStore } from '@/lib/store/branding-store';
import { useChartSettingsStore } from '@/lib/store/chart-settings-store';
import { useAnalysisSettingsStore } from '@/lib/store/analysis-settings-store';
import { useUIMode } from '@/contexts/ui-mode-context';
import { useLicense } from '@/hooks/useLicense';
import { DEFAULT_VISCOSITY_SHEAR_RATES } from '@/lib/analysis/constants';
import { useReportExport } from '@/components/reports/hooks/useReportExport';
import { useReportExportById } from '@/components/reports/hooks/useReportExportById';
import type { ParseResult } from '@/lib/store/experiment-data-store';
import type { RheoCycle, GraceCycleResult } from '@/lib/analysis/types';
import type { RecipeComponent } from '@/lib/parsing/types';
import type { WaterParams } from '@/types';

interface ReportTabProps {
    parseResult: ParseResult;
    savedExperimentId?: string;
    editedRecipe: RecipeComponent[];
    editedWaterParams: Partial<WaterParams> | null;
    editedWaterSource: string;
    cycleResults: Map<number, GraceCycleResult>;
    cycles: RheoCycle[];
}

export function ReportTab({
    parseResult,
    savedExperimentId,
    editedRecipe,
    editedWaterParams,
    editedWaterSource,
    cycleResults,
    cycles,
}: ReportTabProps) {
    // Defaults from global store — useShallow is MANDATORY for object selectors
    // to prevent React #185 (maximum update depth exceeded).
    const {
        reportLanguage, setReportLanguage,
        showCalibration, setShowCalibration,
        showRawData, setShowRawData,
        showRecipe, setShowRecipe,
        showWaterAnalysis, setShowWaterAnalysis,
    } = useBrandingStore(
        useShallow(s => ({
            reportLanguage: s.reportLanguage,
            setReportLanguage: s.setReportLanguage,
            showCalibration: s.showCalibration,
            setShowCalibration: s.setShowCalibration,
            showRawData: s.showRawData,
            setShowRawData: s.setShowRawData,
            showRecipe: s.showRecipe,
            setShowRecipe: s.setShowRecipe,
            showWaterAnalysis: s.showWaterAnalysis,
            setShowWaterAnalysis: s.setShowWaterAnalysis,
        }))
    );
    const chartSettings = useChartSettingsStore(s => s.settings);
    // Derive unitSystem from per-line viscosity unit for Rust report backend
    const unitSystem = ((): 'SI' | 'SI_Pas' | 'Imperial' => {
        const vUnit = chartSettings.lines.viscosity.unit;
        if (vUnit === 'Pa·s') return 'SI_Pas';
        if (vUnit === 'cP') return 'Imperial';
        return 'SI';
    })();
    const { companyName, companyLogo } = useBrandingStore(
        useShallow(s => ({
            companyName: s.companyName,
            companyLogo: s.companyLogo,
        }))
    );
    const expertSettings = useAnalysisSettingsStore(s => s.expertSettings);
    const { isExpert } = useUIMode();
    const { isInitialized, result } = useLicense();
    const canUseCalibration = isInitialized && (result?.license?.features?.calibrationAnalysis ?? false);

    const reportViscosityRates = (isExpert
        ? expertSettings.viscosityShearRates || [...DEFAULT_VISCOSITY_SHEAR_RATES]
        : [...DEFAULT_VISCOSITY_SHEAR_RATES]
    ).filter((r: number) => r > 0);

    // Local overrides for this session
    const [formatPdf, setFormatPdf] = useState(true);
    const [formatExcel, setFormatExcel] = useState(true);
    const [includeCalibration, setIncludeCalibration] = useState(showCalibration);
    const [includeRawData, setIncludeRawData] = useState(showRawData);
    const [includeRecipe, setIncludeRecipe] = useState(showRecipe);
    const [includeWaterAnalysis, setIncludeWaterAnalysis] = useState(showWaterAnalysis);

    // Export hook — hardcode touchPoints/targetTime/threshold per TZ
    const legacyExport = useReportExport({
        parseResult, editedRecipe, editedWaterParams, editedWaterSource,
        cycleResults, cycles,
        language: reportLanguage, unitSystem,
        showTouchPoints: false,
        viscosityThreshold: 0,
        showTargetTime: false,
        targetTime: 0,
        showCalibration: includeCalibration && canUseCalibration,
        showRawData: includeRawData,
        showRecipe: includeRecipe,
        showWaterAnalysis: includeWaterAnalysis,
        reportViscosityRates, isExpert,
        companyName, companyLogo, chartSettings,
    });

    const byIdExport = useReportExportById({
        experimentId: savedExperimentId || parseResult.metadata.experimentId || '',
        filename: parseResult.metadata.filename || 'report',
        editedRecipe,
        editedWaterParams,
        editedWaterSource,
        language: reportLanguage,
        unitSystem,
        showTouchPoints: false,
        viscosityThreshold: 0,
        showTargetTime: false,
        targetTime: 0,
        showCalibration: includeCalibration && canUseCalibration,
        showRawData: includeRawData,
        showRecipe: includeRecipe,
        showWaterAnalysis: includeWaterAnalysis,
        reportViscosityRates,
        isExpert,
        companyName,
        companyLogo,
        chartSettings,
        expertSettings,
    });

    const {
        isExporting, isExcelExporting,
        exportError, clearError,
        handleDownloadAll: downloadAll,
    } = savedExperimentId ? byIdExport : legacyExport;

    const isGenerating = isExporting || isExcelExporting;
    const canDownload = formatPdf || formatExcel;

    useEffect(() => {
        if (!canUseCalibration && includeCalibration) {
            setIncludeCalibration(false);
        }
    }, [canUseCalibration, includeCalibration]);

    // Show the "Save as default" affordance only when the visible selection
    // no longer matches the stored defaults — otherwise the click would be
    // a no-op and add visual noise to the form.
    const isDefaultDirty =
        (canUseCalibration && includeCalibration !== showCalibration) ||
        includeRawData     !== showRawData ||
        includeRecipe      !== showRecipe ||
        includeWaterAnalysis !== showWaterAnalysis;

    const saveSectionsAsDefault = () => {
        setShowCalibration(canUseCalibration ? includeCalibration : false);
        setShowRawData(includeRawData);
        setShowRecipe(includeRecipe);
        setShowWaterAnalysis(includeWaterAnalysis);
    };

    const handleDownloadAll = async () => {
        await downloadAll(formatPdf, formatExcel);
    };

    return (
        <div className="w-full max-w-lg mx-auto py-8 space-y-6">
            <div className="text-center mb-6">
                <div className="w-16 h-16 bg-card rounded-full flex items-center justify-center mx-auto mb-4 border border-border">
                    <FileText className="w-8 h-8 text-purple-400" />
                </div>
                <h2 className="text-xl font-bold text-foreground">
                    {reportLanguage === 'en' ? 'Generate Report' : 'Генерация отчёта'}
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                    {parseResult.metadata.filename}
                </p>
            </div>

            {/* Report defaults */}
            <div className="bg-card/50 border border-border rounded-xl p-4 space-y-4">
                <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                    <Languages className="w-4 h-4 text-purple-400" />
                    {reportLanguage === 'en' ? 'Report settings' : 'Настройки отчёта'}
                </h3>

                {/* Language */}
                <div>
                    <label className="text-xs font-semibold text-foreground mb-1.5 block">
                        {reportLanguage === 'en' ? 'Report language' : 'Язык отчёта'}
                    </label>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setReportLanguage('ru')}
                            data-testid="ReportLanguageRu"
                            className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                                reportLanguage === 'ru'
                                    ? 'bg-secondary border-purple-500 text-foreground font-semibold'
                                    : 'bg-background border-border text-muted-foreground hover:border-purple-400'
                            }`}
                        >
                            Русский
                        </button>
                        <button
                            onClick={() => setReportLanguage('en')}
                            data-testid="ReportLanguageEn"
                            className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                                reportLanguage === 'en'
                                    ? 'bg-secondary border-purple-500 text-foreground font-semibold'
                                    : 'bg-background border-border text-muted-foreground hover:border-purple-400'
                            }`}
                        >
                            English
                        </button>
                    </div>
                </div>

                {/* Section toggles — visible selection is what goes into THIS export.
                    The "Save as default" link promotes the current selection to the
                    global branding store so it becomes the pre-selected state for the
                    next experiment. The two separate checkbox blocks we used to ship
                    here (Default sections + This report) were a UX footgun: the same
                    four labels appeared twice with no indication of which one won. */}
                <div className="space-y-2 pt-2 border-t border-border">
                    <div className="flex items-baseline justify-between gap-2 mb-1">
                        <label className="text-xs font-semibold text-foreground block">
                            {reportLanguage === 'en' ? 'Report sections' : 'Разделы отчёта'}
                        </label>
                        {isDefaultDirty && (
                            <button
                                type="button"
                                onClick={saveSectionsAsDefault}
                                data-testid="ReportSaveDefaultsButton"
                                className="text-[11px] font-medium text-purple-400 hover:text-purple-300 underline-offset-2 hover:underline transition-colors"
                                title={reportLanguage === 'en'
                                    ? 'Remember this selection for future reports'
                                    : 'Запомнить этот набор для следующих отчётов'}
                            >
                                {reportLanguage === 'en' ? 'Save as default' : 'Сохранить как умолчание'}
                            </button>
                        )}
                    </div>
                    {canUseCalibration && (
                        <label className="flex items-center gap-3 cursor-pointer group">
                            <input
                                type="checkbox"
                                checked={includeCalibration}
                                onChange={(e) => setIncludeCalibration(e.target.checked)}
                                data-testid="ReportCalibrationToggle"
                                className="w-4 h-4 rounded border-border text-purple-600 focus:ring-purple-500"
                            />
                            <span className="text-sm text-foreground">
                                {reportLanguage === 'en' ? 'Calibration data' : 'Калибровка'}
                            </span>
                        </label>
                    )}
                    <label className="flex items-center gap-3 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={includeRawData}
                            onChange={(e) => setIncludeRawData(e.target.checked)}
                            data-testid="ReportRawDataToggle"
                            className="w-4 h-4 rounded border-border text-purple-600 focus:ring-purple-500"
                        />
                        <span className="text-sm text-foreground">
                            {reportLanguage === 'en' ? 'Raw data' : 'Сырые данные'}
                        </span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={includeRecipe}
                            onChange={(e) => setIncludeRecipe(e.target.checked)}
                            data-testid="ReportRecipeToggle"
                            className="w-4 h-4 rounded border-border text-purple-600 focus:ring-purple-500"
                        />
                        <span className="text-sm text-foreground">
                            {reportLanguage === 'en' ? 'Recipe' : 'Рецептура'}
                        </span>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer group">
                        <input
                            type="checkbox"
                            checked={includeWaterAnalysis}
                            onChange={(e) => setIncludeWaterAnalysis(e.target.checked)}
                            data-testid="ReportWaterAnalysisToggle"
                            className="w-4 h-4 rounded border-border text-purple-600 focus:ring-purple-500"
                        />
                        <span className="text-sm text-foreground">
                            {reportLanguage === 'en' ? 'Water analysis' : 'Анализ воды'}
                        </span>
                    </label>
                </div>
            </div>

            {/* Format */}
            <div className="bg-card/50 border border-border rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-foreground mb-2">
                    {reportLanguage === 'en' ? 'Format' : 'Формат'}
                </h3>
                <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                        type="checkbox"
                        checked={formatPdf}
                        onChange={(e) => setFormatPdf(e.target.checked)}
                        data-testid="ReportFormatPdf"
                        className="w-4 h-4 rounded border-border text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-sm text-foreground">PDF</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                        type="checkbox"
                        checked={formatExcel}
                        onChange={(e) => setFormatExcel(e.target.checked)}
                        data-testid="ReportFormatExcel"
                        className="w-4 h-4 rounded border-border text-purple-600 focus:ring-purple-500"
                    />
                    <span className="text-sm text-foreground">Excel</span>
                </label>
            </div>

            {/* Error */}
            {exportError && (
                <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-xl">
                    <div className="flex items-center justify-between">
                        <p className="text-red-600 dark:text-red-400 text-sm">{exportError}</p>
                        <button onClick={clearError} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                    </div>
                </div>
            )}

            {/* Download button */}
            <button
                onClick={handleDownloadAll}
                disabled={!canDownload || isGenerating}
                data-testid="ReportDownloadButton"
                className={`w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-medium text-sm transition-colors ${
                    canDownload && !isGenerating
                        ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/20'
                        : 'bg-muted text-muted-foreground cursor-not-allowed'
                }`}
            >
                {isGenerating ? (
                    <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {reportLanguage === 'en' ? 'Generating...' : 'Генерация...'}
                    </>
                ) : (
                    <>
                        <Download className="w-4 h-4" />
                        {reportLanguage === 'en' ? 'Download report' : 'Скачать отчёт'}
                    </>
                )}
            </button>
        </div>
    );
}
