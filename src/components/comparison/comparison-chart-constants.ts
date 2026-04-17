import type uPlot from 'uplot';
import type { LineKey } from '@/lib/store/chart-settings-store';

/** Show per-series dots only when zoomed in enough (< 60 visible data points). */
export const showPointsWhenZoomed: uPlot.Series['points'] = {
    show: (_u: uPlot, _si: number, idx0: number, idx1: number) => (idx1 - idx0) < 60,
};

export interface ComparisonChartProps {
    experiments: import('@/types').Experiment[];
    primaryMetric?: string;
    leftSecondaryMetric?: string;
    secondaryMetric?: string;
    tertiaryMetric?: string;
    showLegend?: boolean;
    showTouchPoints?: boolean;
    viscosityThreshold?: number;
    showTargetTime?: boolean;
    targetTime?: number;
}

export const METRIC_COLORS: Record<string, string> = {
    viscosity_cp: '#3b82f6',
    temperature_c: '#ef4444',
    bath_temperature_c: '#f97316',
    speed_rpm: '#10b981',
    shear_rate_s1: '#a855f7',
    shear_stress_pa: '#f59e0b',
    pressure_bar: '#06b6d4',
};

export const METRIC_TO_LINE_KEY: Record<string, LineKey> = {
    viscosity_cp: 'viscosity',
    temperature_c: 'temperature',
    bath_temperature_c: 'bathTemperature',
    shear_rate_s1: 'shearRate',
    pressure_bar: 'pressure',
    speed_rpm: 'rpm',
};

export const EXPERIMENT_COLORS = [
    '#1E90FF', '#FF0000', '#008000', '#800080', '#FFA500',
    '#008080', '#FF00FF', '#A52A2A', '#6A5ACD', '#008B8B',
];

export const METRIC_LABELS: Record<string, string> = {
    viscosity_cp: 'Вязкость (сП)',
    temperature_c: 'Температура (°C)',
    bath_temperature_c: 'Темп. бани (°C)',
    speed_rpm: 'Скорость (об/мин)',
    shear_rate_s1: 'Скорость сдвига (1/с)',
    shear_stress_pa: 'Напряжение сдвига (Па)',
    pressure_bar: 'Давление (бар)',
};
