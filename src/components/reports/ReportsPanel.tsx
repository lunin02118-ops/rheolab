import { useState, useRef } from 'react';
import { FileText } from 'lucide-react';
import { RheologyChart } from '@/components/charts/rheology-chart-uplot';
import { ReportSettings } from './ReportSettings';
import { useReportExport } from './hooks/useReportExport';

import type { ParseResult } from '@/lib/store/experiment-data-store';
import { useBrandingStore } from '@/lib/store/branding-store';
import { useShallow } from 'zustand/react/shallow';
import { useChartSettingsStore } from '@/lib/store/chart-settings-store';
import type { RheoCycle, GraceCycleResult } from '@/lib/analysis/types';
import { useLicense } from '@/hooks/useLicense';
import { useAnalysisSettingsStore } from '@/lib/store/analysis-settings-store';
import { useUIMode } from '@/contexts/ui-mode-context';
import { DEFAULT_VISCOSITY_SHEAR_RATES } from '@/lib/analysis/constants';
import type { RecipeComponent } from '@/lib/parsing/types';
import type { WaterParams } from '@/types';

export interface ReportsPanelProps {
    parseResult: ParseResult;
    editedRecipe: RecipeComponent[];
    editedWaterParams: Partial<WaterParams> | null;
    editedWaterSource: string;
    cycleResults: Map<number, GraceCycleResult>;
    cycles: RheoCycle[];
}

export function ReportsPanel({
    parseResult,
    editedRecipe,
    editedWaterParams,
    editedWaterSource,
    cycleResults,
    cycles
}: ReportsPanelProps) {
    // в”Ђв”Ђ Local settings state в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
    const language = useBrandingStore(s => s.reportLanguage);
    const [showTouchPoints, setShowTouchPoints] = useState(true);
    const [viscosityThreshold, setViscosityThreshold] = useState(500);
    const [showTargetTime, setShowTargetTime] = useState(true);
    const [targetTime, setTargetTime] = useState(10);

    // в”Ђв”Ђ Global store subscriptions в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
    const chartSettings = useChartSettingsStore(s => s.settings);
    // Derive unitSystem from per-line viscosity unit for Rust report backend
    const unitSystem: 'SI' | 'SI_Pas' | 'Imperial' = (() => {
        const vUnit = chartSettings.lines.viscosity.unit;
        if (vUnit === 'Pa·s') return 'SI_Pas';
        if (vUnit === 'cP') return 'Imperial';
        return 'SI';
    })();
    const { companyName, companyLogo, showCalibration, setShowCalibration, showRawData, setShowRawData, showRecipe, showWaterAnalysis, setReportLanguage } = useBrandingStore(
        useShallow(s => ({ companyName: s.companyName, companyLogo: s.companyLogo, showCalibration: s.showCalibration, setShowCalibration: s.setShowCalibration, showRawData: s.showRawData, setShowRawData: s.setShowRawData, showRecipe: s.showRecipe, showWaterAnalysis: s.showWaterAnalysis, setReportLanguage: s.setReportLanguage }))
    );
    const { result, isInitialized } = useLicense();
    const canUseCalibration = isInitialized && (result?.license?.features?.calibrationAnalysis ?? false);
    const expertSettings = useAnalysisSettingsStore(s => s.expertSettings);
    const { isExpert } = useUIMode();
    const reportViscosityRates = (isExpert
        ? expertSettings.viscosityShearRates || [...DEFAULT_VISCOSITY_SHEAR_RATES]
        : [...DEFAULT_VISCOSITY_SHEAR_RATES]
    ).filter((r: number) => r > 0);

    // в”Ђв”Ђ Export hook в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
    const {
        isExporting, isExcelExporting, isCapturing,
        exportError, clearError,
        handleDownload, handleExcelDownload,
        chartData,
    } = useReportExport({
        parseResult, editedRecipe, editedWaterParams, editedWaterSource,
        cycleResults, cycles,
        language, unitSystem,
        showTouchPoints, viscosityThreshold, showTargetTime, targetTime,
        showCalibration, showRawData, showRecipe, showWaterAnalysis,
        reportViscosityRates, isExpert,
        companyName, companyLogo, chartSettings,
    });

    const chartRef = useRef<HTMLDivElement>(null);

    // в”Ђв”Ђ Render в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
    return (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Settings Column */}
            <ReportSettings
                language={language} setLanguage={setReportLanguage}
                canUseCalibration={canUseCalibration}
                showCalibration={showCalibration} setShowCalibration={setShowCalibration}
                showRawData={showRawData} setShowRawData={setShowRawData}
                showTouchPoints={showTouchPoints} setShowTouchPoints={setShowTouchPoints}
                viscosityThreshold={viscosityThreshold} setViscosityThreshold={setViscosityThreshold}
                showTargetTime={showTargetTime} setShowTargetTime={setShowTargetTime}
                targetTime={targetTime} setTargetTime={setTargetTime}
                isExporting={isExporting} isExcelExporting={isExcelExporting}
                exportError={exportError} onClearError={clearError}
                onDownloadPdf={handleDownload} onDownloadExcel={handleExcelDownload}
            />

            {/* Preview Column */}
            <div className="lg:col-span-3 space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
                        <FileText className="w-5 h-5 text-purple-400" />
                        {language === 'en' ? 'Preview' : 'Предпросмотр'}
                    </h3>
                </div>

                <div className="relative">
                    {isCapturing && (
                        <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/90 rounded-xl">
                            <div className="flex flex-col items-center gap-4">
                                <div className="w-12 h-12 border-4 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                                <span className="text-foreground font-medium">Создание PDF...</span>
                            </div>
                        </div>
                    )}
                    <RheologyChart
                        ref={chartRef}
                        data={chartData}
                        captureMode={isCapturing}
                        pdfMode={isCapturing}
                        previewMode={!isCapturing}
                        disableAnimations={true}
                        showTouchPoints={showTouchPoints}
                        viscosityThreshold={viscosityThreshold}
                        showTargetTime={showTargetTime}
                        targetTime={targetTime}
                        title={language === 'en' ? 'Rheology Chart' : 'График реологии'}
                        language={language}
                        height={600}
                        instrumentInfo={{
                            geometry: parseResult.metadata.geometry,
                            geometrySource: parseResult.metadata.geometrySource,
                            instrumentType: parseResult.metadata.instrumentType,
                            sheetName: parseResult.metadata.sheetName,
                        }}
                    />
                </div>
            </div>
        </div>
    );
}

