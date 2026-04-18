import type { RheoPoint } from '@/types';

// ─── Public types ────────────────────────────────────────────────────────────

export type DownsampleMode = 'smart' | 'lttb' | 'off';

/** A single experiment's points after sanitisation, downsampling and
 *  time-normalisation (time_min = minutes since first point of THIS experiment). */
export interface ProcessedExperiment {
    /** Points sorted chronologically, time_min: minutes from experiment start. */
    points: (RheoPoint & { time_min: number })[];
}

/**
 * One series data array aligned to `sortedTimes`.
 * `null` means "no data for this experiment at this time slot".
 */
export type AlignedSeries = (number | null)[];

/** Complete SoA data package ready to pass to `new uPlot()`. */
export interface ComparisonUPlotData {
    /** `uPlot.AlignedData[0]` — the shared X-axis (minutes). */
    times: number[];
    /**
     * One entry per (experiment × metric) combination, in the same order they
     * were requested.  Maps directly to `uPlot.AlignedData[1..n]`.
     */
    series: AlignedSeries[];
}

/**
 * Post-downsample columnar structure for the comparison pipeline.
 * Float64Arrays allow faster iteration and lower per-element GC pressure than
 * boxed `number[]` objects.
 */
export interface ProcessedColumnar {
    timeMins: Float64Array;
    viscosityCp: Float64Array;
    temperatureC: Float64Array;
    shearRate: Float64Array;       // keyed as 'shear_rate_s1' in metrics
    shearStress: Float64Array;     // keyed as 'shear_stress_pa'
    pressureBar: Float64Array;
    speedRpm: Float64Array;
    bathTemperatureC: Float64Array;
}
