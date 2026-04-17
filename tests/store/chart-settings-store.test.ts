import { describe, test, expect, beforeEach } from 'vitest';
import { 
    useChartSettingsStore, 
    DEFAULT_CHART_SETTINGS, 
    DEFAULT_REPORT_SETTINGS,
    DEFAULT_LINE_SETTINGS,
    DEFAULT_REPORT_LINE_SETTINGS,
    getStrokeDasharray,
    formatWithPrecision
} from '@/lib/store/chart-settings-store';

describe('ChartSettingsStore', () => {
    beforeEach(() => {
        // Reset store to defaults before each test
        useChartSettingsStore.getState().resetToDefaults();
        useChartSettingsStore.getState().resetReportToDefaults();
    });

    // ============================
    // Display Settings Tests
    // ============================
    
    describe('Display Settings', () => {
        test('should have correct default line settings', () => {
            const { settings } = useChartSettingsStore.getState();
            
            expect(settings.lines.viscosity.color).toBe('#3b82f6');
            expect(settings.lines.viscosity.width).toBe(2);
            expect(settings.lines.viscosity.style).toBe('solid');
            expect(settings.lines.viscosity.visible).toBe(true);
            
            expect(settings.lines.temperature.color).toBe('#f97316');
            expect(settings.animationsEnabled).toBe(true);
        });

        test('setLineSettings should update individual line', () => {
            useChartSettingsStore.getState().setLineSettings('viscosity', { 
                color: '#ff0000',
                width: 4 
            });
            
            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.viscosity.color).toBe('#ff0000');
            expect(settings.lines.viscosity.width).toBe(4);
            expect(settings.lines.viscosity.style).toBe('solid'); // unchanged
            expect(settings.lines.temperature.color).toBe('#f97316'); // other line unchanged
        });

        test('setLineSettings should update style independently', () => {
            useChartSettingsStore.getState().setLineSettings('shearRate', { style: 'dashed' });
            useChartSettingsStore.getState().setLineSettings('pressure', { style: 'dotted' });
            
            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.shearRate.style).toBe('dashed');
            expect(settings.lines.pressure.style).toBe('dotted');
            expect(settings.lines.viscosity.style).toBe('solid'); // unchanged
        });

        test('setLineSettings should toggle visibility', () => {
            useChartSettingsStore.getState().setLineSettings('temperature', { visible: false });
            
            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.temperature.visible).toBe(false);
            expect(settings.lines.shearRate.visible).toBe(true); // unchanged
        });

        test('setPrecision should update precision values', () => {
            useChartSettingsStore.getState().setPrecision({ viscosity: 3 });
            
            const { settings } = useChartSettingsStore.getState();
            expect(settings.precision.viscosity).toBe(3);
            expect(settings.precision.temperature).toBe(1); // unchanged
        });

        test('resetToDefaults should reset all display settings', () => {
            // Modify settings
            useChartSettingsStore.getState().setLineSettings('viscosity', { 
                color: '#000000',
                width: 4,
                style: 'dashed'
            });
            useChartSettingsStore.getState().setSettings({ animationsEnabled: false });
            
            // Reset
            useChartSettingsStore.getState().resetToDefaults();
            
            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.viscosity.color).toBe('#3b82f6');
            expect(settings.lines.viscosity.width).toBe(2);
            expect(settings.lines.viscosity.style).toBe('solid');
            expect(settings.animationsEnabled).toBe(true);
        });
    });

    // ============================
    // Report Settings Tests
    // ============================
    
    describe('Report Settings', () => {
        test('should have correct default report line settings', () => {
            const { reportSettings } = useChartSettingsStore.getState();
            
            // Report colors are darker for print
            expect(reportSettings.lines.viscosity.color).toBe('#1e40af');
            expect(reportSettings.lines.temperature.color).toBe('#c2410c');
            expect(reportSettings.animationsEnabled).toBe(false);
            expect(reportSettings.tooltipEnabled).toBe(false);
            expect(reportSettings.gridOpacity).toBe(0.3);
        });

        test('setReportLineSettings should update report line', () => {
            useChartSettingsStore.getState().setReportLineSettings('viscosity', { 
                color: '#123456',
                width: 3 
            });
            
            const { reportSettings, settings } = useChartSettingsStore.getState();
            expect(reportSettings.lines.viscosity.color).toBe('#123456');
            expect(reportSettings.lines.viscosity.width).toBe(3);
            expect(settings.lines.viscosity.color).toBe('#3b82f6'); // display unchanged
        });

        test('setReportPrecision should update report precision', () => {
            useChartSettingsStore.getState().setReportPrecision({ viscosity: 2 });
            
            const { reportSettings } = useChartSettingsStore.getState();
            expect(reportSettings.precision.viscosity).toBe(2);
        });

        test('resetReportToDefaults should reset only report settings', () => {
            // Modify both settings
            useChartSettingsStore.getState().setLineSettings('viscosity', { width: 4 });
            useChartSettingsStore.getState().setReportLineSettings('viscosity', { width: 3 });
            
            // Reset only report
            useChartSettingsStore.getState().resetReportToDefaults();
            
            const { settings, reportSettings } = useChartSettingsStore.getState();
            expect(reportSettings.lines.viscosity.width).toBe(2); // reset to default
            expect(settings.lines.viscosity.width).toBe(4); // display unchanged
        });

        test('copyDisplayToReport should copy line settings but disable animations', () => {
            // Set custom display settings
            useChartSettingsStore.getState().setSettings({ animationsEnabled: true });
            useChartSettingsStore.getState().setLineSettings('viscosity', { 
                color: '#abcdef',
                width: 4,
                style: 'dashed'
            });
            
            // Copy to report
            useChartSettingsStore.getState().copyDisplayToReport();
            
            const { reportSettings } = useChartSettingsStore.getState();
            expect(reportSettings.lines.viscosity.color).toBe('#abcdef');
            expect(reportSettings.lines.viscosity.width).toBe(4);
            expect(reportSettings.lines.viscosity.style).toBe('dashed');
            expect(reportSettings.animationsEnabled).toBe(false); // forced false
            expect(reportSettings.tooltipEnabled).toBe(false); // forced false
        });
    });

    // ============================
    // Export/Import Tests
    // ============================
    
    describe('Export/Import', () => {
        test('exportSettings should return JSON with display and report', () => {
            const json = useChartSettingsStore.getState().exportSettings();
            const parsed = JSON.parse(json);
            
            expect(parsed).toHaveProperty('display');
            expect(parsed).toHaveProperty('report');
            expect(parsed.display.lines.viscosity.color).toBe('#3b82f6');
            expect(parsed.report.lines.viscosity.color).toBe('#1e40af');
        });

        test('importSettings with new format should apply both', () => {
            const importData = {
                display: { 
                    ...DEFAULT_CHART_SETTINGS, 
                    lines: {
                        ...DEFAULT_LINE_SETTINGS,
                        viscosity: { ...DEFAULT_LINE_SETTINGS.viscosity, width: 4 }
                    }
                },
                report: { 
                    ...DEFAULT_REPORT_SETTINGS, 
                    lines: {
                        ...DEFAULT_REPORT_LINE_SETTINGS,
                        viscosity: { ...DEFAULT_REPORT_LINE_SETTINGS.viscosity, width: 3 }
                    }
                }
            };
            
            const result = useChartSettingsStore.getState().importSettings(
                JSON.stringify(importData)
            );
            
            expect(result).toBe(true);
            
            const { settings, reportSettings } = useChartSettingsStore.getState();
            expect(settings.lines.viscosity.width).toBe(4);
            expect(reportSettings.lines.viscosity.width).toBe(3);
        });

        test('importSettings with invalid JSON should return false', () => {
            const result = useChartSettingsStore.getState().importSettings('not valid json');
            expect(result).toBe(false);
        });

        test('importSettings with invalid structure should return false', () => {
            const result = useChartSettingsStore.getState().importSettings(
                JSON.stringify({ foo: 'bar' })
            );
            expect(result).toBe(false);
        });
    });

    // ============================
    // Helper Functions Tests
    // ============================
    
    describe('Helper Functions', () => {
        test('getStrokeDasharray should return correct values', () => {
            expect(getStrokeDasharray('solid')).toBeUndefined();
            expect(getStrokeDasharray('dashed')).toBe('5 5');
            expect(getStrokeDasharray('dotted')).toBe('2 2');
        });

        test('formatWithPrecision should format values correctly', () => {
            expect(formatWithPrecision(123.4567, 2)).toBe('123.46');
            expect(formatWithPrecision(100, 0)).toBe('100');
            expect(formatWithPrecision(0, 2)).toBe('0.00');
            expect(formatWithPrecision(undefined, 2)).toBe('—');
            expect(formatWithPrecision(null as unknown as number, 2)).toBe('—');
        });
    });

    // ============================
    // Independence Tests
    // ============================
    
    describe('Settings Independence', () => {
        test('display and report line settings should be independent', () => {
            useChartSettingsStore.getState().setLineSettings('viscosity', { color: '#111111' });
            useChartSettingsStore.getState().setReportLineSettings('viscosity', { color: '#222222' });
            
            const { settings, reportSettings } = useChartSettingsStore.getState();
            
            expect(settings.lines.viscosity.color).toBe('#111111');
            expect(reportSettings.lines.viscosity.color).toBe('#222222');
        });

        test('each line should have independent settings', () => {
            useChartSettingsStore.getState().setLineSettings('viscosity', { width: 1 });
            useChartSettingsStore.getState().setLineSettings('temperature', { width: 2 });
            useChartSettingsStore.getState().setLineSettings('shearRate', { width: 3 });
            useChartSettingsStore.getState().setLineSettings('pressure', { width: 4 });
            
            const { settings } = useChartSettingsStore.getState();
            
            expect(settings.lines.viscosity.width).toBe(1);
            expect(settings.lines.temperature.width).toBe(2);
            expect(settings.lines.shearRate.width).toBe(3);
            expect(settings.lines.pressure.width).toBe(4);
        });

        test('resetting display should not affect report', () => {
            useChartSettingsStore.getState().setReportLineSettings('viscosity', { color: '#333333' });
            useChartSettingsStore.getState().resetToDefaults();
            
            const { reportSettings } = useChartSettingsStore.getState();
            expect(reportSettings.lines.viscosity.color).toBe('#333333');
        });
    });

    // ============================
    // Bath Temperature Visibility Tests
    // ============================

    describe('Bath Temperature Visibility', () => {
        test('bathTemperature is on by default in display settings', () => {
            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.bathTemperature.visible).toBe(true);
        });

        test('bathTemperature is on by default in report settings', () => {
            const { reportSettings } = useChartSettingsStore.getState();
            expect(reportSettings.lines.bathTemperature.visible).toBe(true);
        });

        test('enabling bathTemperature in display does not affect report', () => {
            useChartSettingsStore.getState().setLineSettings('bathTemperature', { visible: false });

            const { settings, reportSettings } = useChartSettingsStore.getState();
            expect(settings.lines.bathTemperature.visible).toBe(false);
            expect(reportSettings.lines.bathTemperature.visible).toBe(true);
        });

        test('enabling bathTemperature in report does not affect display', () => {
            useChartSettingsStore.getState().setReportLineSettings('bathTemperature', { visible: false });

            const { settings, reportSettings } = useChartSettingsStore.getState();
            expect(reportSettings.lines.bathTemperature.visible).toBe(false);
            expect(settings.lines.bathTemperature.visible).toBe(true);
        });

        test('disabling bathTemperature in report works independently', () => {
            useChartSettingsStore.getState().setReportLineSettings('bathTemperature', { visible: false });

            const { reportSettings } = useChartSettingsStore.getState();
            expect(reportSettings.lines.bathTemperature.visible).toBe(false);
        });

        test('resetting report settings turns on bathTemperature', () => {
            useChartSettingsStore.getState().setReportLineSettings('bathTemperature', { visible: false });
            useChartSettingsStore.getState().resetReportToDefaults();

            const { reportSettings } = useChartSettingsStore.getState();
            expect(reportSettings.lines.bathTemperature.visible).toBe(true);
        });

        test('bathTemperature visibility does not interfere with temperature visibility', () => {
            useChartSettingsStore.getState().setReportLineSettings('bathTemperature', { visible: true });
            useChartSettingsStore.getState().setReportLineSettings('temperature', { visible: false });

            const { reportSettings } = useChartSettingsStore.getState();
            expect(reportSettings.lines.bathTemperature.visible).toBe(true);
            expect(reportSettings.lines.temperature.visible).toBe(false);
        });
    });

    // ============================
    // All Checkbox Toggles — Series Visibility
    // ============================

    describe('Series Visibility Toggles (analysis chart)', () => {
        const lines = ['viscosity', 'temperature', 'shearRate', 'pressure', 'rpm', 'bathTemperature'] as const;

        for (const line of lines) {
            test(`toggling ${line} visible:true → visible:false works`, () => {
                useChartSettingsStore.getState().setLineSettings(line, { visible: true });
                useChartSettingsStore.getState().setLineSettings(line, { visible: false });

                const { settings } = useChartSettingsStore.getState();
                expect(settings.lines[line].visible).toBe(false);
            });

            test(`toggling ${line} visible:false → visible:true works`, () => {
                useChartSettingsStore.getState().setLineSettings(line, { visible: false });
                useChartSettingsStore.getState().setLineSettings(line, { visible: true });

                const { settings } = useChartSettingsStore.getState();
                expect(settings.lines[line].visible).toBe(true);
            });
        }

        test('each line toggle is independent — enabling one does not enable others', () => {
            // Start fresh
            useChartSettingsStore.getState().resetToDefaults();
            // Only enable bathTemperature
            useChartSettingsStore.getState().setLineSettings('bathTemperature', { visible: true });

            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.bathTemperature.visible).toBe(true);
            // Others remain at their defaults (temperature=true, viscosity=true, rest=false)
            expect(settings.lines.shearRate.visible).toBe(true);
            expect(settings.lines.pressure.visible).toBe(false);
            expect(settings.lines.rpm.visible).toBe(false);
        });
    });

    describe('Series Visibility Toggles (report chart)', () => {
        const lines = ['viscosity', 'temperature', 'shearRate', 'pressure', 'rpm', 'bathTemperature'] as const;

        for (const line of lines) {
            test(`report: toggling ${line} off then on restores state`, () => {
                useChartSettingsStore.getState().resetReportToDefaults();
                const before = useChartSettingsStore.getState().reportSettings.lines[line].visible;

                useChartSettingsStore.getState().setReportLineSettings(line, { visible: !before });
                expect(useChartSettingsStore.getState().reportSettings.lines[line].visible).toBe(!before);

                useChartSettingsStore.getState().setReportLineSettings(line, { visible: before });
                expect(useChartSettingsStore.getState().reportSettings.lines[line].visible).toBe(before);
            });
        }

        test('report checkbox changes are reflected in reportSettings object', () => {
            useChartSettingsStore.getState().setReportLineSettings('temperature', { visible: false });
            useChartSettingsStore.getState().setReportLineSettings('shearRate', { visible: true });
            useChartSettingsStore.getState().setReportLineSettings('bathTemperature', { visible: true });

            const { reportSettings } = useChartSettingsStore.getState();
            expect(reportSettings.lines.temperature.visible).toBe(false);
            expect(reportSettings.lines.shearRate.visible).toBe(true);
            expect(reportSettings.lines.bathTemperature.visible).toBe(true);
        });

        test('display settings unchanged when only report settings toggled', () => {
            useChartSettingsStore.getState().resetToDefaults();
            const displayBeforeTemperature = useChartSettingsStore.getState().settings.lines.temperature.visible;

            useChartSettingsStore.getState().setReportLineSettings('temperature', { visible: !displayBeforeTemperature });
            useChartSettingsStore.getState().setReportLineSettings('bathTemperature', { visible: true });

            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.temperature.visible).toBe(displayBeforeTemperature);
            expect(settings.lines.bathTemperature.visible).toBe(true);
        });
    });

    // ============================
    // Comparison Chart — Line Width & Style
    // ============================

    describe('Comparison Chart Line Settings', () => {
        test('changing viscosity width is reflected in settings used by comparison chart', () => {
            useChartSettingsStore.getState().setLineSettings('viscosity', { width: 4 });
            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.viscosity.width).toBe(4);
        });

        test('changing temperature style to dashed is reflected in settings', () => {
            useChartSettingsStore.getState().setLineSettings('temperature', { style: 'dashed' });
            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.temperature.style).toBe('dashed');
            expect(getStrokeDasharray('dashed')).toBe('5 5');
        });

        test('changing bathTemperature style to solid is reflected in settings', () => {
            useChartSettingsStore.getState().setLineSettings('bathTemperature', { style: 'solid' });
            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.bathTemperature.style).toBe('solid');
            expect(getStrokeDasharray('solid')).toBeUndefined();
        });

        test('changing shearRate style to dotted gives correct dasharray', () => {
            useChartSettingsStore.getState().setLineSettings('shearRate', { style: 'dotted' });
            const { settings } = useChartSettingsStore.getState();
            expect(getStrokeDasharray(settings.lines.shearRate.style)).toBe('2 2');
        });

        test('all six metrics have independent widths', () => {
            const metrics = ['viscosity', 'temperature', 'shearRate', 'pressure', 'rpm', 'bathTemperature'] as const;
            metrics.forEach((m, i) => {
                useChartSettingsStore.getState().setLineSettings(m, { width: (i + 1) as 1 | 2 | 3 | 4 });
            });
            const { settings } = useChartSettingsStore.getState();
            metrics.forEach((m, i) => {
                expect(settings.lines[m].width).toBe(i + 1);
            });
        });

        test('comparisonAxisMode defaults to individual', () => {
            const { settings } = useChartSettingsStore.getState();
            expect(settings.comparisonAxisMode).toBe('individual');
        });

        test('comparisonAxisMode can be set to shared', () => {
            useChartSettingsStore.getState().setSettings({ comparisonAxisMode: 'shared' });
            const { settings } = useChartSettingsStore.getState();
            expect(settings.comparisonAxisMode).toBe('shared');
        });

        test('comparisonAxisMode shared → individual round-trip', () => {
            useChartSettingsStore.getState().setSettings({ comparisonAxisMode: 'shared' });
            useChartSettingsStore.getState().setSettings({ comparisonAxisMode: 'individual' });
            const { settings } = useChartSettingsStore.getState();
            expect(settings.comparisonAxisMode).toBe('individual');
        });

        test('comparisonAxisMode change does not affect line settings', () => {
            useChartSettingsStore.getState().setLineSettings('viscosity', { width: 3, color: '#aabbcc' });
            useChartSettingsStore.getState().setSettings({ comparisonAxisMode: 'shared' });
            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.viscosity.width).toBe(3);
            expect(settings.lines.viscosity.color).toBe('#aabbcc');
            expect(settings.comparisonAxisMode).toBe('shared');
        });

        test('resetToDefaults restores comparisonAxisMode to individual', () => {
            useChartSettingsStore.getState().setSettings({ comparisonAxisMode: 'shared' });
            useChartSettingsStore.getState().resetToDefaults();
            const { settings } = useChartSettingsStore.getState();
            expect(settings.comparisonAxisMode).toBe('individual');
        });
    });
});
