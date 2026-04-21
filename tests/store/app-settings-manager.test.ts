/**
 * Tests for App Settings Manager
 * Verifies export, import, validation and reset functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock functions need to be defined before vi.mock
const mockSetSettings = vi.fn();
const mockResetToDefaults = vi.fn();
const mockSetCompanyName = vi.fn();
const mockSetCompanyLogo = vi.fn();
const mockSetShowCalibration = vi.fn();
const mockSetShowRawData = vi.fn();
const mockSetReportLanguage = vi.fn();
const mockSetExpertSettings = vi.fn();
const mockResetAnalysisToDefaults = vi.fn();

vi.mock('@/lib/store/chart-settings-store', () => ({
    useChartSettingsStore: {
        getState: () => ({
            settings: {
                lines: {
                    viscosity: { color: '#3b82f6', width: 2, style: 'solid', visible: true, axis: 'left' },
                    temperature: { color: '#f97316', width: 2, style: 'solid', visible: true, axis: 'right' },
                    shearRate: { color: '#a855f7', width: 2, style: 'solid', visible: true, axis: 'left' },
                    pressure: { color: '#22c55e', width: 2, style: 'solid', visible: false, axis: 'right' },
                    rpm: { color: '#eab308', width: 2, style: 'solid', visible: false, axis: 'left' },
                },
                precision: { viscosity: 1, temperature: 1, pressure: 2, time: 2, shearRate: 1, rpm: 0 },
                showGridLines: true,
                gridOpacity: 0.5,
                animationsEnabled: true,
                tooltipEnabled: true,
            },
            setSettings: mockSetSettings,
            resetToDefaults: mockResetToDefaults,
        }),
    },
    DEFAULT_CHART_SETTINGS: {},
}));

vi.mock('@/lib/store/branding-store', () => ({
    useBrandingStore: {
        getState: () => ({
            companyName: 'Test Company',
            companyLogo: 'data:image/png;base64,abc123',
            showCalibration: true,
            showRawData: false,
            reportLanguage: 'ru',
            setCompanyName: mockSetCompanyName,
            setCompanyLogo: mockSetCompanyLogo,
            setShowCalibration: mockSetShowCalibration,
            setShowRawData: mockSetShowRawData,
            setReportLanguage: mockSetReportLanguage,
        }),
    },
}));

vi.mock('@/lib/store/analysis-settings-store', () => ({
    useAnalysisSettingsStore: {
        getState: () => ({
            expertSettings: {
                pointsToAverage: 0,
                viscosityShearRates: [40, 100, 170],
                stepSplitting: true,
                splitStartDuration: 30,
                splitEndDuration: 30,
                minDurationForSplit: 90,
                aiModel: 'llama-3.3-70b-versatile',
                timeShiftEnabled: false,
            },
            setExpertSettings: mockSetExpertSettings,
            resetToDefaults: mockResetAnalysisToDefaults,
        }),
    },
}));

vi.mock('@/lib/version', () => ({
    APP_VERSION: '0.1.134',
}));

// Import after mocks
import {
    exportAllSettings,
    exportSettingsToJson,
    validateSettings,
    importAllSettings,
    importSettingsFromJson,
    resetAllSettings,
    getSettingsSummary,
} from '@/lib/settings/app-settings-manager';

describe('App Settings Manager', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('exportAllSettings', () => {
        it('should export all settings from stores', () => {
            const exported = exportAllSettings();

            expect(exported.version).toBe(1);
            expect(exported.appVersion).toBe('0.1.134');
            expect(exported.exportDate).toBeDefined();
            expect(exported.chart).toBeDefined();
            expect(exported.chart.lines).toBeDefined();
            expect(exported.branding.companyName).toBe('Test Company');
            expect(exported.branding.companyLogo).toBe('data:image/png;base64,abc123');
        });

        it('should include ISO date format', () => {
            const exported = exportAllSettings();
            expect(exported.exportDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        });
    });

    describe('exportSettingsToJson', () => {
        it('should return valid JSON string', () => {
            const json = exportSettingsToJson();
            expect(() => JSON.parse(json)).not.toThrow();
        });

        it('should be pretty-printed', () => {
            const json = exportSettingsToJson();
            expect(json).toContain('\n');
            expect(json).toContain('  ');
        });
    });

    describe('validateSettings', () => {
        it('should reject non-object input', () => {
            const result = validateSettings('invalid');
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Неверный формат файла: ожидается JSON объект');
        });

        it('should reject null input', () => {
            const result = validateSettings(null);
            expect(result.valid).toBe(false);
        });

        it('should require version number', () => {
            const result = validateSettings({ chart: {} });
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Отсутствует версия настроек');
        });

        it('should require chart section', () => {
            const result = validateSettings({ version: 1 });
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Отсутствует раздел настроек графиков (chart)');
        });

        it('should warn about missing branding', () => {
            const result = validateSettings({ version: 1, chart: {} });
            expect(result.valid).toBe(true);
            expect(result.warnings).toContain('Отсутствует раздел брендинга');
        });

        it('should warn about newer version', () => {
            const result = validateSettings({ version: 99, chart: {} });
            expect(result.valid).toBe(true);
            expect(result.warnings.some(w => w.includes('более новой версии'))).toBe(true);
        });

        it('should accept valid settings', () => {
            const validSettings = {
                version: 1,
                chart: { lines: {}, precision: {} },
                branding: { companyName: 'Test' },
                analysis: { viscosityShearRates: [40, 100, 170] },
            };
            const result = validateSettings(validSettings);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });
    });

    describe('importAllSettings', () => {
        it('should reject invalid settings', () => {
            const result = importAllSettings({ invalid: true });
            expect(result.success).toBe(false);
            expect(result.imported.chart).toBe(false);
            expect(result.imported.branding).toBe(false);
            expect(result.imported.analysis).toBe(false);
        });

        it('should import chart settings', () => {
            const settings = {
                version: 1,
                chart: { showGridLines: false, lines: {}, precision: {} },
            };
            const result = importAllSettings(settings);
            expect(result.success).toBe(true);
            expect(result.imported.chart).toBe(true);
            expect(mockSetSettings).toHaveBeenCalled();
        });

        it('should import branding settings', () => {
            const settings = {
                version: 1,
                chart: {},
                branding: {
                    companyName: 'New Company',
                    companyLogo: null,
                    showCalibration: false,
                    showRawData: true,
                    reportLanguage: 'en',
                },
            };
            const result = importAllSettings(settings);
            expect(result.success).toBe(true);
            expect(result.imported.branding).toBe(true);
            expect(mockSetCompanyName).toHaveBeenCalledWith('New Company');
            expect(mockSetCompanyLogo).toHaveBeenCalledWith(null);
            expect(mockSetShowCalibration).toHaveBeenCalledWith(false);
        });

        it('should import analysis settings', () => {
            const settings = {
                version: 1,
                chart: {},
                analysis: {
                    viscosityShearRates: [50, 150],
                },
            };
            const result = importAllSettings(settings);
            expect(result.success).toBe(true);
            expect(result.imported.analysis).toBe(true);
            expect(mockSetExpertSettings).toHaveBeenCalled();
        });
    });

    describe('importSettingsFromJson', () => {
        it('should parse JSON and import', () => {
            const json = JSON.stringify({
                version: 1,
                chart: { lines: {}, precision: {} },
            });
            const result = importSettingsFromJson(json);
            expect(result.success).toBe(true);
        });

        it('should reject invalid JSON', () => {
            const result = importSettingsFromJson('not json');
            expect(result.success).toBe(false);
            expect(result.errors).toContain('Неверный формат JSON файла');
        });
    });

    describe('resetAllSettings', () => {
        it('should reset all stores to defaults', () => {
            resetAllSettings();
            
            expect(mockResetToDefaults).toHaveBeenCalled();
            expect(mockSetCompanyName).toHaveBeenCalledWith('RheoLab Enterprise');
            expect(mockSetCompanyLogo).toHaveBeenCalledWith(null);
            expect(mockSetShowCalibration).toHaveBeenCalledWith(false);
            expect(mockSetShowRawData).toHaveBeenCalledWith(false);
            expect(mockSetReportLanguage).toHaveBeenCalledWith('ru');
            expect(mockResetAnalysisToDefaults).toHaveBeenCalled();
        });
    });

    describe('getSettingsSummary', () => {
        it('should return current settings summary', () => {
            const summary = getSettingsSummary();

            expect(summary.chart.visibleLinesCount).toBe(3); // viscosity, temperature, shearRate
            expect(summary.branding.companyName).toBe('Test Company');
            expect(summary.branding.hasLogo).toBe(true);
            expect(summary.analysis.shearRatesCount).toBe(3);
        });
    });
});
