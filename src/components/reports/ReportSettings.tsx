/**
 * Report settings sidebar panel — presentational component.
 *
 * Controls language, unit system, calibration, raw data, touch points,
 * target time, chart settings link, and export buttons.
 */

import { Link } from 'react-router-dom';
import {
    FileText,
    FileDown,
    Settings2,
    FileSpreadsheet,
    Scale,
    ExternalLink,
    Crosshair,
    Clock,
} from 'lucide-react';

export interface ReportSettingsProps {
    language: 'ru' | 'en';
    setLanguage: (v: 'ru' | 'en') => void;
    unitSystem: 'SI' | 'Imperial';
    setUnitSystem: (v: 'SI' | 'Imperial') => void;
    canUseCalibration: boolean;
    showCalibration: boolean;
    setShowCalibration: (v: boolean) => void;
    showRawData: boolean;
    setShowRawData: (v: boolean) => void;
    showTouchPoints: boolean;
    setShowTouchPoints: (v: boolean) => void;
    viscosityThreshold: number;
    setViscosityThreshold: (v: number) => void;
    showTargetTime: boolean;
    setShowTargetTime: (v: boolean) => void;
    targetTime: number;
    setTargetTime: (v: number) => void;
    isExporting: boolean;
    isExcelExporting: boolean;
    exportError: string | null;
    onClearError: () => void;
    onDownloadPdf: () => void;
    onDownloadExcel: () => void;
}

export function ReportSettings({
    language, setLanguage,
    unitSystem, setUnitSystem,
    canUseCalibration,
    showCalibration, setShowCalibration,
    showRawData, setShowRawData,
    showTouchPoints, setShowTouchPoints,
    viscosityThreshold, setViscosityThreshold,
    showTargetTime, setShowTargetTime,
    targetTime, setTargetTime,
    isExporting, isExcelExporting,
    exportError, onClearError,
    onDownloadPdf, onDownloadExcel,
}: ReportSettingsProps) {
    return (
        <div className="flex flex-col h-full">
            <div className="bg-card/50 border border-border rounded-xl p-6 flex-1 flex flex-col">
                <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                    <Settings2 className="w-5 h-5 text-blue-400" />
                    Настройки отчёта
                </h3>

                <div className="space-y-6 flex-1 flex flex-col">
                    {/* Language */}
                    <div>
                        <label className="text-sm font-semibold text-foreground mb-2 block">Язык</label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setLanguage('ru')}
                                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${language === 'ru'
                                    ? 'bg-secondary border-blue-500 text-foreground font-semibold'
                                    : 'bg-background border-border text-foreground hover:border-blue-400'
                                    }`}
                            >
                                Русский
                            </button>
                            <button
                                onClick={() => setLanguage('en')}
                                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${language === 'en'
                                    ? 'bg-secondary border-blue-500 text-foreground font-semibold'
                                    : 'bg-background border-border text-foreground hover:border-blue-400'
                                    }`}
                            >
                                English
                            </button>
                        </div>
                    </div>

                    {/* Unit System */}
                    <div>
                        <label className="text-sm font-semibold text-foreground mb-2 block">{language === 'ru' ? "Система единиц (K')" : "Unit System (K')"}</label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setUnitSystem('SI')}
                                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${unitSystem === 'SI'
                                    ? 'bg-secondary border-green-500 text-foreground font-semibold'
                                    : 'bg-background border-border text-foreground hover:border-green-400'
                                    }`}
                            >
                                SI (Pa·sⁿ)
                            </button>
                            <button
                                onClick={() => setUnitSystem('Imperial')}
                                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${unitSystem === 'Imperial'
                                    ? 'bg-secondary border-green-500 text-foreground font-semibold'
                                    : 'bg-background border-border text-foreground hover:border-green-400'
                                    }`}
                            >
                                Imperial
                            </button>
                        </div>
                    </div>

                    {/* Calibration Setting - Only for Developer license */}
                    {canUseCalibration && (
                        <div className="pt-4 border-t border-border">
                            <label className="text-sm font-semibold text-foreground mb-3 block flex items-center gap-2">
                                <Scale className="w-4 h-4" />
                                Содержание
                            </label>
                            <button
                                onClick={() => setShowCalibration(!showCalibration)}
                                data-testid="ReportCalibrationToggle"
                                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${showCalibration ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-500/50 text-blue-700 dark:text-blue-400' : 'bg-background border-border text-foreground'}`}
                            >
                                <span className="flex items-center gap-2">
                                    <Scale className="w-4 h-4" />
                                    Данные калибровки
                                </span>
                                <div className={`w-8 h-4 rounded-full relative transition-colors ${showCalibration ? 'bg-blue-500' : 'bg-secondary'}`}>
                                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-[left,right] duration-150 ${showCalibration ? 'right-0.5' : 'left-0.5'}`} />
                                </div>
                            </button>
                        </div>
                    )}

                    {/* Raw Data Toggle */}
                    <div className={canUseCalibration ? '' : 'pt-4 border-t border-border'}>
                        {!canUseCalibration && (
                            <label className="text-sm font-semibold text-foreground mb-3 block flex items-center gap-2">
                                <Scale className="w-4 h-4" />
                                Содержание
                            </label>
                        )}
                        <button
                            onClick={() => setShowRawData(!showRawData)}
                            data-testid="ReportRawDataToggle"
                            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm font-medium transition-colors mt-2 ${showRawData ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-500/50 text-blue-700 dark:text-blue-400' : 'bg-background border-border text-foreground'}`}
                        >
                            <span className="flex items-center gap-2">
                                <FileText className="w-4 h-4" />
                                Сырые данные
                            </span>
                            <div className={`w-8 h-4 rounded-full relative transition-colors ${showRawData ? 'bg-blue-500' : 'bg-secondary'}`}>
                                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-[left,right] duration-150 ${showRawData ? 'right-0.5' : 'left-0.5'}`} />
                            </div>
                        </button>
                    </div>

                    {/* Touch Points Settings */}
                    <div className="pt-4 border-t border-border">
                        <label className="text-sm font-semibold text-foreground mb-3 block flex items-center gap-2">
                            <Crosshair className="w-4 h-4" />
                            Контрольные точки
                        </label>
                        <button
                            onClick={() => setShowTouchPoints(!showTouchPoints)}
                            data-testid="ReportTouchPointsToggle"
                            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${showTouchPoints ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-500/50 text-blue-700 dark:text-blue-400' : 'bg-background border-border text-foreground'}`}
                        >
                            <span className="flex items-center gap-2">
                                <Crosshair className="w-4 h-4" />
                                Показать контрольные точки
                            </span>
                            <div className={`w-8 h-4 rounded-full relative transition-colors ${showTouchPoints ? 'bg-blue-500' : 'bg-secondary'}`}>
                                <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-[left,right] duration-150 ${showTouchPoints ? 'right-0.5' : 'left-0.5'}`} />
                            </div>
                        </button>

                        {showTouchPoints && (
                            <div className="mt-3 space-y-3">
                                {/* Viscosity Threshold */}
                                <div>
                                    <label className="text-xs font-semibold text-foreground mb-1 block">Порог вязкости (сП)</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={10000}
                                        value={viscosityThreshold}
                                        onChange={e => setViscosityThreshold(Math.max(1, Number(e.target.value)))}
                                        data-testid="ReportViscosityThreshold"
                                        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:border-blue-500 focus:outline-none"
                                    />
                                </div>

                                {/* Target Time Toggle */}
                                <button
                                    onClick={() => setShowTargetTime(!showTargetTime)}
                                    data-testid="ReportTargetTimeToggle"
                                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${showTargetTime ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-500/50 text-blue-700 dark:text-blue-400' : 'bg-background border-border text-foreground'}`}
                                >
                                    <span className="flex items-center gap-2">
                                        <Clock className="w-4 h-4" />
                                        Целевое время
                                    </span>
                                    <div className={`w-8 h-4 rounded-full relative transition-colors ${showTargetTime ? 'bg-blue-500' : 'bg-secondary'}`}>
                                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-[left,right] duration-150 ${showTargetTime ? 'right-0.5' : 'left-0.5'}`} />
                                    </div>
                                </button>

                                {/* Target Time Input */}
                                {showTargetTime && (
                                    <div>
                                        <label className="text-xs font-semibold text-foreground mb-1 block">Целевое время (мин)</label>
                                        <input
                                            type="number"
                                            min={1}
                                            max={120}
                                            value={targetTime}
                                            onChange={e => setTargetTime(Math.max(1, Number(e.target.value)))}
                                            data-testid="ReportTargetTime"
                                            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:border-blue-500 focus:outline-none"
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Chart Settings Link */}
                    <div className="pt-4 border-t border-border">
                        <Link
                            to="/dashboard/settings?tab=reports"
                            data-testid="ReportsSettingsLink"
                            className="flex items-center justify-between px-4 py-3 rounded-lg border border-amber-500/60 bg-amber-50 dark:bg-amber-600/10 text-sm text-amber-700 dark:text-amber-300 hover:text-amber-800 dark:hover:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-600/20 hover:border-amber-500 dark:hover:border-amber-500/50 transition-colors group"
                        >
                            <div className="flex items-center gap-2">
                                <Settings2 className="w-4 h-4 text-amber-600 dark:text-amber-400 group-hover:rotate-90 transition-transform duration-300" />
                                <span className="font-medium">Настройки графика для отчётов</span>
                            </div>
                            <ExternalLink className="w-4 h-4 opacity-60 group-hover:opacity-100 transition-opacity" />
                        </Link>
                    </div>

                    {/* Export Buttons */}
                    <div className="grid grid-cols-2 gap-3 pt-4 mt-auto">
                        <button
                            onClick={onDownloadPdf}
                            disabled={isExporting}
                            data-testid="ReportsPdfButton"
                            className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-semibold shadow-lg shadow-blue-900/20 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isExporting ? (
                                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <FileDown className="w-5 h-5" />
                            )}
                            PDF Отчёт
                        </button>

                        <button
                            onClick={onDownloadExcel}
                            disabled={isExcelExporting}
                            data-testid="ReportsExcelButton"
                            className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-foreground rounded-xl font-semibold shadow-lg shadow-emerald-900/20 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isExcelExporting ? (
                                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            ) : (
                                <FileSpreadsheet className="w-5 h-5" />
                            )}
                            Excel Данные
                        </button>
                    </div>

                    {/* Export Error Alert */}
                    {exportError && (
                        <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
                            <span className="text-red-400 text-sm flex-1">{exportError}</span>
                            <button
                                onClick={onClearError}
                                className="text-red-400 hover:text-red-300 text-sm font-bold"
                            >
                                ✕
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
