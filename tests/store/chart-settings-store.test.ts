import { describe, test, expect, beforeEach } from 'vitest';
import { 
    useChartSettingsStore, 
    DEFAULT_CHART_SETTINGS, 
    DEFAULT_LINE_SETTINGS,
    METRIC_UNITS,
    getStrokeDasharray,
    formatWithPrecision
} from '@/lib/store/chart-settings-store';

describe('ChartSettingsStore', () => {
    beforeEach(() => {
        // Reset store to defaults before each test
        useChartSettingsStore.getState().resetToDefaults();
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
    // Export/Import Tests
    // ============================
    
    describe('Export/Import', () => {
        test('exportSettings should return JSON with chart settings', () => {
            const json = useChartSettingsStore.getState().exportSettings();
            const parsed = JSON.parse(json);
            
            expect(parsed).toHaveProperty('lines');
            expect(parsed).toHaveProperty('precision');
            expect(parsed.lines.viscosity.color).toBe('#3b82f6');
        });

        test('importSettings with v8 format (plain ChartSettings) should apply', () => {
            const importData = {
                ...DEFAULT_CHART_SETTINGS, 
                lines: {
                    ...DEFAULT_LINE_SETTINGS,
                    viscosity: { ...DEFAULT_LINE_SETTINGS.viscosity, width: 4 }
                }
            };
            
            const result = useChartSettingsStore.getState().importSettings(
                JSON.stringify(importData)
            );
            
            expect(result).toBe(true);
            
            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.viscosity.width).toBe(4);
        });

        test('importSettings with v7 format (display+report) should extract display only', () => {
            const importData = {
                display: { 
                    ...DEFAULT_CHART_SETTINGS, 
                    lines: {
                        ...DEFAULT_LINE_SETTINGS,
                        viscosity: { ...DEFAULT_LINE_SETTINGS.viscosity, width: 4 }
                    }
                },
                report: { ...DEFAULT_CHART_SETTINGS }
            };
            
            const result = useChartSettingsStore.getState().importSettings(
                JSON.stringify(importData)
            );
            
            expect(result).toBe(true);
            
            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.viscosity.width).toBe(4);
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

        test('importSettings sanitizes unsupported rheology units', () => {
            const importData = {
                ...DEFAULT_CHART_SETTINGS,
                rheologyUnits: {
                    ...DEFAULT_CHART_SETTINGS.rheologyUnits,
                    consistency: 'eq.cP',
                },
            };

            const result = useChartSettingsStore.getState().importSettings(
                JSON.stringify(importData),
            );

            expect(result).toBe(true);
            expect(useChartSettingsStore.getState().settings.rheologyUnits.consistency)
                .toBe(METRIC_UNITS.consistency);
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
    });

    // ============================
    // Bath Temperature Visibility Tests
    // ============================

    describe('Bath Temperature Visibility', () => {
        test('bathTemperature is on by default', () => {
            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.bathTemperature.visible).toBe(true);
        });

        test('toggling bathTemperature visibility works', () => {
            useChartSettingsStore.getState().setLineSettings('bathTemperature', { visible: false });

            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.bathTemperature.visible).toBe(false);
        });

        test('resetting settings turns on bathTemperature', () => {
            useChartSettingsStore.getState().setLineSettings('bathTemperature', { visible: false });
            useChartSettingsStore.getState().resetToDefaults();

            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.bathTemperature.visible).toBe(true);
        });

        test('bathTemperature visibility does not interfere with temperature visibility', () => {
            useChartSettingsStore.getState().setLineSettings('bathTemperature', { visible: true });
            useChartSettingsStore.getState().setLineSettings('temperature', { visible: false });

            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.bathTemperature.visible).toBe(true);
            expect(settings.lines.temperature.visible).toBe(false);
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

    // ============================
    // UI-018 — Per-line Unit Settings
    // ============================

    describe('Per-line Unit Settings (UI-018)', () => {
        test('defaults: viscosity=mPa·s, temperature=°C, bathTemperature=°C', () => {
            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.viscosity.unit).toBe('mPa·s');
            expect(settings.lines.temperature.unit).toBe('°C');
            expect(settings.lines.bathTemperature.unit).toBe('°C');
        });

        test('defaults: shearRate=1/s, pressure=bar, rpm=RPM', () => {
            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.shearRate.unit).toBe('1/s');
            expect(settings.lines.pressure.unit).toBe('bar');
            expect(settings.lines.rpm.unit).toBe('RPM');
        });

        test('setLineSettings can change viscosity unit to Pa·s', () => {
            useChartSettingsStore.getState().setLineSettings('viscosity', { unit: 'Pa·s' });
            expect(useChartSettingsStore.getState().settings.lines.viscosity.unit).toBe('Pa·s');
        });

        test('setLineSettings can change viscosity unit to cP (Imperial)', () => {
            useChartSettingsStore.getState().setLineSettings('viscosity', { unit: 'cP' });
            expect(useChartSettingsStore.getState().settings.lines.viscosity.unit).toBe('cP');
        });

        test('changing viscosity unit does not affect temperature unit', () => {
            useChartSettingsStore.getState().setLineSettings('viscosity', { unit: 'Pa·s' });
            expect(useChartSettingsStore.getState().settings.lines.temperature.unit).toBe('°C');
        });

        test('resetToDefaults restores all units', () => {
            useChartSettingsStore.getState().setLineSettings('viscosity', { unit: 'cP' });
            useChartSettingsStore.getState().setLineSettings('temperature', { unit: 'K' });
            useChartSettingsStore.getState().resetToDefaults();
            const { settings } = useChartSettingsStore.getState();
            expect(settings.lines.viscosity.unit).toBe('mPa·s');
            expect(settings.lines.temperature.unit).toBe('°C');
        });

        test('exportSettings includes unit field', () => {
            useChartSettingsStore.getState().setLineSettings('viscosity', { unit: 'Pa·s' });
            const json = useChartSettingsStore.getState().exportSettings();
            const parsed = JSON.parse(json);
            expect(parsed.lines.viscosity.unit).toBe('Pa·s');
        });

        test('importSettings preserves unit field', () => {
            const importData = {
                ...DEFAULT_CHART_SETTINGS,
                lines: {
                    ...DEFAULT_LINE_SETTINGS,
                    viscosity: { ...DEFAULT_LINE_SETTINGS.viscosity, unit: 'cP' as const }
                }
            };
            const result = useChartSettingsStore.getState().importSettings(JSON.stringify(importData));
            expect(result).toBe(true);
            expect(useChartSettingsStore.getState().settings.lines.viscosity.unit).toBe('cP');
        });
    });
});
