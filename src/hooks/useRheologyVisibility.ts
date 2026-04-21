/**
 * useRheologyVisibility
 *
 * Derives chart visibility flags and active settings from stores and props.
 * Extracted from RheologyChart to keep the component readable.
 */
import { useAnalysisSettingsStore } from '@/lib/store/analysis-settings-store';
import { useChartSettingsStore } from '@/lib/store/chart-settings-store';
import type { ChartSettings } from '@/lib/store/chart-settings-store';

interface UseRheologyVisibilityParams {
    previewMode: boolean;
    captureMode: boolean;
    showTemperatureProp?: boolean;
    showShearRateProp?: boolean;
    showPressureProp?: boolean;
    showRpmProp?: boolean;
    showBathTemperatureProp?: boolean;
    shearRateAxis: 'left' | 'right';
    pressureAxis: 'left' | 'right';
}

export interface RheologyVisibility {
    activeSettings: ChartSettings;
    chartSettings: ChartSettings;
    timeShiftEnabled: boolean;
    showTemperature: boolean;
    showShearRate: boolean;
    showPressure: boolean;
    showRpm: boolean;
    showBathTemperature: boolean;
    effectiveShearRateAxis: 'left' | 'right';
    effectivePressureAxis: 'left' | 'right';
    axisMode: 'shared' | 'individual';
    downsampleMode: string;
}

export function useRheologyVisibility({
    previewMode,
    captureMode,
    showTemperatureProp,
    showShearRateProp,
    showPressureProp,
    showRpmProp,
    showBathTemperatureProp,
    shearRateAxis,
    pressureAxis,
}: UseRheologyVisibilityParams): RheologyVisibility {
    const expertSettings = useAnalysisSettingsStore(s => s.expertSettings);
    const { timeShiftEnabled } = expertSettings;
    const chartSettings = useChartSettingsStore(s => s.settings);

    // Single source of truth: same settings for dashboard and reports
    const activeSettings = chartSettings;

    const showTemperature = showTemperatureProp ?? activeSettings.lines.temperature.visible;
    const showShearRate = showShearRateProp ?? activeSettings.lines.shearRate.visible;
    const showPressure = showPressureProp ?? activeSettings.lines.pressure.visible;
    const showRpm = showRpmProp ?? activeSettings.lines.rpm.visible;
    const showBathTemperature = showBathTemperatureProp ?? (activeSettings.lines.bathTemperature?.visible ?? false);

    const effectiveShearRateAxis = shearRateAxis;
    const effectivePressureAxis = pressureAxis;

    const axisMode = (activeSettings.comparisonAxisMode ?? 'individual') as 'shared' | 'individual';
    const downsampleMode = activeSettings.downsampleMode ?? 'smart';

    return {
        activeSettings,
        chartSettings,
        timeShiftEnabled,
        showTemperature,
        showShearRate,
        showPressure,
        showRpm,
        showBathTemperature,
        effectiveShearRateAxis,
        effectivePressureAxis,
        axisMode,
        downsampleMode,
    };
}
