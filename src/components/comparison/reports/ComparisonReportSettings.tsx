/**
 * @fileoverview Sidebar panel for the Comparison → Report sub-tab.
 *
 * Presentational component — state lives in parent `ComparisonReportTab`
 * and the `useComparisonReportExport` hook.
 *
 * @module comparison/reports/ComparisonReportSettings
 */

import { useState } from 'react';
import { FileDown, FileSpreadsheet, Settings2, FileText } from 'lucide-react';
import type { RheologyParameterSource } from '@/types';
import { ProgramRheologyConfirmDialog } from '@/components/reports/ProgramRheologyConfirmDialog';

export type ComparisonReportRheologySourceMode = RheologyParameterSource;
type PendingExport = 'pdf' | 'excel' | null;

export interface ComparisonReportSettingsProps {
    language: 'ru' | 'en';
    setLanguage: (v: 'ru' | 'en') => void;

    showCalibration: boolean;
    setShowCalibration: (v: boolean) => void;
    showRawData: boolean;
    setShowRawData: (v: boolean) => void;
    showRecipe: boolean;
    setShowRecipe: (v: boolean) => void;
    showWaterAnalysis: boolean;
    setShowWaterAnalysis: (v: boolean) => void;
    showRheology: boolean;
    setShowRheology: (v: boolean) => void;
    rheologySourceMode: ComparisonReportRheologySourceMode;
    setRheologySourceMode: (v: ComparisonReportRheologySourceMode) => void;
    canUseCalibration: boolean;

    isExporting: boolean;
    isExcelExporting: boolean;
    exportError: string | null;
    onClearError: () => void;

    onDownloadPdf: () => void;
    onDownloadExcel: () => void;

    experimentCount: number;
}

export function ComparisonReportSettings({
    language, setLanguage,
    showCalibration, setShowCalibration,
    showRawData, setShowRawData,
    showRecipe, setShowRecipe,
    showWaterAnalysis, setShowWaterAnalysis,
    showRheology, setShowRheology,
    rheologySourceMode, setRheologySourceMode,
    canUseCalibration,
    isExporting, isExcelExporting,
    exportError, onClearError,
    onDownloadPdf, onDownloadExcel,
    experimentCount,
}: ComparisonReportSettingsProps) {
    const disabled = experimentCount === 0;
    const [pendingExport, setPendingExport] = useState<PendingExport>(null);
    const needsProgramRheologyConfirmation = showRheology && rheologySourceMode === 'program';

    const requestPdfExport = () => {
        if (needsProgramRheologyConfirmation) {
            setPendingExport('pdf');
            return;
        }
        onDownloadPdf();
    };

    const requestExcelExport = () => {
        if (needsProgramRheologyConfirmation) {
            setPendingExport('excel');
            return;
        }
        onDownloadExcel();
    };

    const confirmPendingExport = () => {
        const kind = pendingExport;
        setPendingExport(null);
        if (kind === 'pdf') {
            onDownloadPdf();
        } else if (kind === 'excel') {
            onDownloadExcel();
        }
    };

    return (
        <div className="flex flex-col h-full">
            <div className="bg-card/50 border border-border rounded-xl p-6 flex-1 flex flex-col">
                <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Settings2 className="w-5 h-5 text-blue-400" />
                    {language === 'ru' ? 'Настройки сравнительного отчёта' : 'Comparison report settings'}
                </h3>

                <div className="space-y-6 flex-1 flex flex-col">
                    {/* Language */}
                    <div>
                        <label className="text-sm font-semibold text-foreground mb-2 block">
                            {language === 'ru' ? 'Язык' : 'Language'}
                        </label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setLanguage('ru')}
                                data-testid="ComparisonReportLanguageRu"
                                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                                    language === 'ru'
                                        ? 'bg-secondary border-blue-500 text-foreground font-semibold'
                                        : 'bg-background border-border text-foreground hover:border-blue-400'
                                }`}
                            >
                                Русский
                            </button>
                            <button
                                onClick={() => setLanguage('en')}
                                data-testid="ComparisonReportLanguageEn"
                                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                                    language === 'en'
                                        ? 'bg-secondary border-blue-500 text-foreground font-semibold'
                                        : 'bg-background border-border text-foreground hover:border-blue-400'
                                }`}
                            >
                                English
                            </button>
                        </div>
                    </div>

                    {/* Section toggles */}
                    <div className="pt-4 border-t border-border space-y-2">
                        <label className="text-sm font-semibold text-foreground mb-3 block flex items-center gap-2">
                            <FileText className="w-4 h-4" />
                            {language === 'ru' ? 'Разделы отчёта' : 'Report sections'}
                        </label>

                        {canUseCalibration && (
                            <ToggleRow
                                label={language === 'ru' ? 'Данные калибровки' : 'Calibration data'}
                                value={showCalibration}
                                onChange={setShowCalibration}
                                testId="ComparisonReportCalibrationToggle"
                            />
                        )}
                        <ToggleRow
                            label={language === 'ru' ? 'Сырые данные' : 'Raw data'}
                            value={showRawData}
                            onChange={setShowRawData}
                            testId="ComparisonReportRawDataToggle"
                        />
                        <ToggleRow
                            label={language === 'ru' ? 'Рецептура' : 'Recipe'}
                            value={showRecipe}
                            onChange={setShowRecipe}
                            testId="ComparisonReportRecipeToggle"
                        />
                        <ToggleRow
                            label={language === 'ru' ? 'Анализ воды' : 'Water analysis'}
                            value={showWaterAnalysis}
                            onChange={setShowWaterAnalysis}
                            testId="ComparisonReportWaterAnalysisToggle"
                        />
                        <ToggleRow
                            label={language === 'ru' ? 'Реология' : 'Rheology'}
                            value={showRheology}
                            onChange={setShowRheology}
                            testId="ComparisonReportRheologyToggle"
                        />
                        {showRheology && (
                            <div className="pt-2">
                                <label className="text-xs font-semibold text-foreground mb-2 block">
                                    {language === 'ru' ? 'Таблица реологии в отчёте' : 'Rheology table in report'}
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    <SourceButton
                                        label={language === 'ru' ? 'Прибор' : 'Instrument table'}
                                        value="instrument"
                                        selected={rheologySourceMode === 'instrument'}
                                        onSelect={setRheologySourceMode}
                                        testId="ComparisonReportRheologySourceInstrument"
                                    />
                                    <SourceButton
                                        label={language === 'ru' ? 'Расчёт' : 'Calculation'}
                                        value="program"
                                        selected={rheologySourceMode === 'program'}
                                        onSelect={setRheologySourceMode}
                                        testId="ComparisonReportRheologySourceProgram"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Counter */}
                    <div className="text-xs text-muted-foreground italic">
                        {language === 'ru'
                            ? `В отчёт войдёт экспериментов: ${experimentCount}`
                            : `Experiments to include: ${experimentCount}`}
                    </div>

                    {/* Export buttons */}
                    <div className="grid grid-cols-2 gap-3 pt-4 mt-auto">
                        <button
                            onClick={requestPdfExport}
                            disabled={isExporting || disabled}
                            data-testid="ComparisonReportPdfButton"
                            className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold shadow-lg shadow-blue-900/20 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isExporting ? (
                                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <FileDown className="w-5 h-5" />
                            )}
                            {language === 'ru' ? 'PDF Отчёт' : 'PDF Report'}
                        </button>

                        <button
                            onClick={requestExcelExport}
                            disabled={isExcelExporting || disabled}
                            data-testid="ComparisonReportExcelButton"
                            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-semibold shadow-lg shadow-emerald-900/20 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isExcelExporting ? (
                                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <FileSpreadsheet className="w-5 h-5" />
                            )}
                            Excel
                        </button>
                    </div>

                    {/* Error */}
                    {exportError && (
                        <div
                            className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2"
                            data-testid="ComparisonReportError"
                        >
                            <span className="text-red-400 text-sm flex-1">{exportError}</span>
                            <button
                                onClick={onClearError}
                                className="text-red-400 hover:text-red-300 text-sm font-bold"
                                aria-label={language === 'ru' ? 'Закрыть' : 'Dismiss'}
                            >
                                ×
                            </button>
                        </div>
                    )}
                </div>
            </div>
            <ProgramRheologyConfirmDialog
                open={pendingExport !== null}
                language={language}
                onConfirm={confirmPendingExport}
                onCancel={() => setPendingExport(null)}
            />
        </div>
    );
}

// ── Sub-components ─────────────────────────────────────────────────────────

interface SourceButtonProps {
    label: string;
    value: ComparisonReportRheologySourceMode;
    selected: boolean;
    onSelect: (v: ComparisonReportRheologySourceMode) => void;
    testId: string;
}

function SourceButton({ label, value, selected, onSelect, testId }: SourceButtonProps) {
    return (
        <button
            type="button"
            onClick={() => onSelect(value)}
            data-testid={testId}
            className={`px-2 py-2 rounded-lg border text-xs font-medium transition-colors ${
                selected
                    ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-500/60 text-blue-700 dark:text-blue-400'
                    : 'bg-background border-border text-foreground hover:border-blue-400'
            }`}
        >
            {label}
        </button>
    );
}

interface ToggleRowProps {
    label: string;
    value: boolean;
    onChange: (v: boolean) => void;
    testId: string;
}

function ToggleRow({ label, value, onChange, testId }: ToggleRowProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={value}
            aria-label={label}
            onClick={() => onChange(!value)}
            data-testid={testId}
            data-state={value ? 'on' : 'off'}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                value
                    ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-500/50 text-blue-700 dark:text-blue-400'
                    : 'bg-background border-border text-foreground'
            }`}
        >
            <span>{label}</span>
            <div
                className={`w-8 h-4 rounded-full relative transition-colors ${
                    value ? 'bg-blue-500' : 'bg-secondary'
                }`}
            >
                <div
                    className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-[left,right] duration-150 ${
                        value ? 'right-0.5' : 'left-0.5'
                    }`}
                />
            </div>
        </button>
    );
}
