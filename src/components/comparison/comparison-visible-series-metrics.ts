export type ComparisonSeriesRequestMetric =
    | 'viscosityCp'
    | 'temperatureC'
    | 'shearRate'
    | 'shearStressPa'
    | 'pressureBar'
    | 'speedRpm'
    | 'bathTemperatureC';

export const DEFAULT_COMPARISON_SERIES_METRICS: ComparisonSeriesRequestMetric[] = [
    'viscosityCp',
    'temperatureC',
    'shearRate',
    'shearStressPa',
    'pressureBar',
    'speedRpm',
    'bathTemperatureC',
];

export interface ComparisonVisibleSeriesMetricSettings {
    primaryMetric?: string;
    leftSecondaryMetric?: string;
    secondaryMetric?: string;
    tertiaryMetric?: string;
}

export interface ComparisonVisibleSeriesMetricOptions {
    includeSmartDownsampleSupport?: boolean;
    includeTouchPointSupport?: boolean;
}

const METRIC_ALIASES: Record<string, ComparisonSeriesRequestMetric> = {
    viscosity: 'viscosityCp',
    viscositycp: 'viscosityCp',
    temperature: 'temperatureC',
    temperaturec: 'temperatureC',
    shearrate: 'shearRate',
    shearrates1: 'shearRate',
    shearstress: 'shearStressPa',
    shearstresspa: 'shearStressPa',
    pressure: 'pressureBar',
    pressurebar: 'pressureBar',
    speed: 'speedRpm',
    rpm: 'speedRpm',
    speedrpm: 'speedRpm',
    bathtemperature: 'bathTemperatureC',
    bathtemperaturec: 'bathTemperatureC',
};

function aliasKey(value: string): string {
    return value.trim().replace(/[_\s-]/g, '').toLowerCase();
}

function addMetric(out: ComparisonSeriesRequestMetric[], value: string | null | undefined): void {
    if (!value || value === 'none') return;
    const metric = METRIC_ALIASES[aliasKey(value)];
    if (metric && !out.includes(metric)) {
        out.push(metric);
    }
}

export function normalizeComparisonSeriesMetrics(
    metrics: readonly string[] | null | undefined,
    fallbackMetrics: readonly string[] = ['viscosityCp'],
): ComparisonSeriesRequestMetric[] {
    const out: ComparisonSeriesRequestMetric[] = [];

    for (const metric of metrics ?? []) {
        addMetric(out, metric);
    }

    if (out.length === 0) {
        for (const metric of fallbackMetrics) {
            addMetric(out, metric);
        }
    }

    if (out.length === 0) {
        out.push('viscosityCp');
    }

    return out;
}

export function comparisonVisibleSeriesMetrics(
    settings: ComparisonVisibleSeriesMetricSettings,
    options: ComparisonVisibleSeriesMetricOptions = {},
): ComparisonSeriesRequestMetric[] {
    const requested = [
        settings.primaryMetric ?? 'viscosity_cp',
        settings.leftSecondaryMetric ?? 'none',
        settings.secondaryMetric ?? 'none',
        settings.tertiaryMetric ?? 'none',
        // The current binary chart path uses viscosity as the stable selection
        // channel for server/window and client-side downsampling. Keep it as a
        // minimal support column even when the visible chart slots do not show it.
        'viscosity_cp',
    ];

    if (options.includeSmartDownsampleSupport || options.includeTouchPointSupport) {
        requested.push('shear_rate_s1');
    }

    return normalizeComparisonSeriesMetrics(requested);
}
