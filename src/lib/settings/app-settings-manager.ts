/**
 * App Settings Manager
 * Central module for exporting/importing all application settings
 */

import { useChartSettingsStore } from '@/lib/store/chart-settings-store';
import { useBrandingStore } from '@/lib/store/branding-store';
import type { ExpertSettings } from '@/lib/store/analysis-settings-store';
import { useAnalysisSettingsStore } from '@/lib/store/analysis-settings-store';
import { APP_VERSION } from '@/lib/version';

// === Types ===

export interface AppSettingsExport {
    version: number;
    exportDate: string;
    appVersion: string;
    chart: {
        display: Record<string, unknown>;
        report: Record<string, unknown>;
    };
    branding: {
        companyName: string;
        companyLogo: string | null;
        showCalibration: boolean;
    };
    analysis: ExpertSettings;
}

const CURRENT_VERSION = 1;

// === Default Settings ===

const DEFAULT_BRANDING = {
    companyName: 'RheoLab Enterprise',
    companyLogo: null,
    showCalibration: false,
};

// === Export Function ===

export function exportAllSettings(): AppSettingsExport {
    // Get current state from all stores
    const chartStore = useChartSettingsStore.getState();
    const brandingStore = useBrandingStore.getState();
    const analysisStore = useAnalysisSettingsStore.getState();

    return {
        version: CURRENT_VERSION,
        exportDate: new Date().toISOString(),
        appVersion: APP_VERSION,
        chart: {
            display: chartStore.settings as unknown as Record<string, unknown>,
            report: chartStore.reportSettings as unknown as Record<string, unknown>,
        },
        branding: {
            companyName: brandingStore.companyName,
            companyLogo: brandingStore.companyLogo,
            showCalibration: brandingStore.showCalibration,
        },
        analysis: analysisStore.expertSettings,
    };
}

// === Export to JSON String ===

export function exportSettingsToJson(): string {
    const settings = exportAllSettings();
    return JSON.stringify(settings, null, 2);
}

// === Download Settings as File ===

export function downloadSettingsFile(): void {
    const json = exportSettingsToJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `rheolab-settings-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// === Validation ===

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export function validateSettings(data: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!data || typeof data !== 'object') {
        errors.push('Неверный формат файла: ожидается JSON объект');
        return { valid: false, errors, warnings };
    }

    const settings = data as Record<string, unknown>;

    // Check version
    if (typeof settings.version !== 'number') {
        errors.push('Отсутствует версия настроек');
    } else if (settings.version > CURRENT_VERSION) {
        warnings.push(`Файл создан в более новой версии приложения (v${settings.version})`);
    }

    // Check required sections
    if (!settings.chart) {
        errors.push('Отсутствует раздел настроек графиков (chart)');
    }

    if (!settings.branding) {
        warnings.push('Отсутствует раздел брендинга');
    }

    if (!settings.analysis) {
        warnings.push('Отсутствует раздел настроек анализа');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

// === Import Function ===

export interface ImportResult {
    success: boolean;
    errors: string[];
    warnings: string[];
    imported: {
        chart: boolean;
        branding: boolean;
        analysis: boolean;
    };
}

export function importAllSettings(data: unknown): ImportResult {
    const validation = validateSettings(data);
    
    if (!validation.valid) {
        return {
            success: false,
            errors: validation.errors,
            warnings: validation.warnings,
            imported: { chart: false, branding: false, analysis: false },
        };
    }

    const settings = data as AppSettingsExport;
    const imported = { chart: false, branding: false, analysis: false };
    const warnings = [...validation.warnings];

    try {
        // Import chart settings
        if (settings.chart) {
            const chartStore = useChartSettingsStore.getState();
            
            if (settings.chart.display) {
                chartStore.setSettings(settings.chart.display);
            }
            if (settings.chart.report) {
                chartStore.setReportSettings(settings.chart.report);
            }
            imported.chart = true;
        }

        // Import branding
        if (settings.branding) {
            const brandingStore = useBrandingStore.getState();
            
            if (settings.branding.companyName) {
                brandingStore.setCompanyName(settings.branding.companyName);
            }
            if (settings.branding.companyLogo !== undefined) {
                brandingStore.setCompanyLogo(settings.branding.companyLogo);
            }
            if (settings.branding.showCalibration !== undefined) {
                brandingStore.setShowCalibration(settings.branding.showCalibration);
            }
            imported.branding = true;
        }

        // Import analysis settings
        if (settings.analysis) {
            const analysisStore = useAnalysisSettingsStore.getState();
            analysisStore.setExpertSettings(settings.analysis);
            imported.analysis = true;
        }

        return {
            success: true,
            errors: [],
            warnings,
            imported,
        };
    } catch (e) {
        return {
            success: false,
            errors: [`Ошибка при импорте: ${e instanceof Error ? e.message : String(e)}`],
            warnings,
            imported,
        };
    }
}

// === Import from JSON String ===

export function importSettingsFromJson(json: string): ImportResult {
    try {
        const data = JSON.parse(json);
        return importAllSettings(data);
    } catch (_e) {
        return {
            success: false,
            errors: ['Неверный формат JSON файла'],
            warnings: [],
            imported: { chart: false, branding: false, analysis: false },
        };
    }
}

// === Reset All Settings ===

export function resetAllSettings(): void {
    // Reset chart settings
    const chartStore = useChartSettingsStore.getState();
    chartStore.resetToDefaults();
    chartStore.resetReportToDefaults();

    // Reset branding
    const brandingStore = useBrandingStore.getState();
    brandingStore.setCompanyName(DEFAULT_BRANDING.companyName);
    brandingStore.setCompanyLogo(DEFAULT_BRANDING.companyLogo);
    brandingStore.setShowCalibration(DEFAULT_BRANDING.showCalibration);

    // Reset analysis settings
    const analysisStore = useAnalysisSettingsStore.getState();
    analysisStore.resetToDefaults();
}

// === Get Settings Summary ===

export interface SettingsSummary {
    chart: {
        displayLinesCount: number;
        reportLinesCount: number;
    };
    branding: {
        hasLogo: boolean;
        companyName: string;
    };
    analysis: {
        shearRatesCount: number;
    };
}

export function getSettingsSummary(): SettingsSummary {
    const chartStore = useChartSettingsStore.getState();
    const brandingStore = useBrandingStore.getState();
    const analysisStore = useAnalysisSettingsStore.getState();

    const countVisibleLines = (lines: Record<string, { visible: boolean }>) => 
        Object.values(lines).filter(l => l.visible).length;

    return {
        chart: {
            displayLinesCount: countVisibleLines(chartStore.settings.lines as unknown as Record<string, { visible: boolean }>),
            reportLinesCount: countVisibleLines(chartStore.reportSettings.lines as unknown as Record<string, { visible: boolean }>),
        },
        branding: {
            hasLogo: brandingStore.companyLogo !== null,
            companyName: brandingStore.companyName,
        },
        analysis: {
            shearRatesCount: analysisStore.expertSettings.viscosityShearRates.length,
        },
    };
}
