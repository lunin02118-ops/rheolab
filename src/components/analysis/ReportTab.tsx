import { useState } from 'react';
import { FileText, Download, Loader2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useBrandingStore } from '@/lib/store/branding-store';
import { useChartSettingsStore } from '@/lib/store/chart-settings-store';
import { useAnalysisSettingsStore } from '@/lib/store/analysis-settings-store';
import { useUIMode } from '@/contexts/ui-mode-context';
import { useLicense } from '@/hooks/useLicense';
import { DEFAULT_VISCOSITY_SHEAR_RATES } from '@/lib/analysis/constants';
import { useReportExport } from '@/components/reports/hooks/useReportExport';
import type { ParseResult } from '@/lib/store/experiment-data-store';
import type { RheoCycle, GraceCycleResult } from '@/lib/analysis/types';
import type { RecipeComponent } from '@/lib/parsing/types';
import type { WaterParams } from '@/types';

interface ReportTabProps {
    parseResult: ParseResult;
    editedRecipe: RecipeComponent[];
    editedWaterParams: Partial<WaterParams> | null;
    editedWaterSource: string;
    cycleResults: Map<number, GraceCycleResult>;
    cycles: RheoCycle[];
}

export function ReportTab({
    parseResult,
    editedRecipe,
    editedWaterParams,
    editedWaterSource,
    cycleResults,
    cycles,
}: ReportTabProps) {
    // Defaults from global store — useShallow is MANDATORY for object selectors
    // to prevent React #185 (maximum update depth exceeded).
    const { reportLanguage, showCalibration, showRawData, showRecipe, showWaterAnalysis } = useBrandingStore(
        useShallow(s => ({
            reportLanguage: s.reportLanguage,
            showCalibration: s.showCalibration,
            showRawData: s.showRawData,
            showRecipe: s.showRecipe,
            showWaterAnalysis: s.showWaterAnalysis,
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
    const {
        isExporting, isExcelExporting,
        exportError, clearError,
        handleDownload, handleExcelDownload,
    } = useReportExport({
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

    const isGenerating = isExporting || isExcelExporting;
    const canDownload = formatPdf || formatExcel;

    const handleDownloadAll = async () => {
        if (formatPdf) {
            await handleDownload();
        }
        if (formatExcel) {
            await handleExcelDownload();
        }
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

            {/* Sections */}
            <div className="bg-card/50 border border-border rounded-xl p-4 space-y-3">
                <h3 className="text-sm font-semibold text-foreground mb-2">
                    {reportLanguage === 'en' ? 'Report sections' : 'Секции отчёта'}
                </h3>
                <label className="flex items-center gap-3 cursor-pointer group">
                    <input
                        type="checkbox"
                        checked={includeCalibration}
                        onChange={(e) => setIncludeCalibration(e.target.checked)}
                        disabled={!canUseCalibration}
                        data-testid="ReportCalibrationToggle"
                        className="w-4 h-4 rounded border-border text-purple-600 focus:ring-purple-500 disabled:opacity-40"
                    />
                    <span className={`text-sm ${canUseCalibration ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {reportLanguage === 'en' ? 'Calibration data' : 'Калибровка'}
                    </span>
                </label>
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
