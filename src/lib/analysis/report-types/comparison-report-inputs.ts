/**
 * @fileoverview Comparison Report Input Types.
 *
 * camelCase TypeScript mirror of the Rust `ComparisonReportInput` in
 * `src/rust/rheolab-core/src/report_generator/comparison/types.rs`.
 *
 * The camelCase shape is the developer-facing form used by UI code and
 * builders.  The camelCase → snake_case translation happens in
 * {@link ./comparison-report-converter.ts} and produces exactly the wire
 * format the Rust deserialiser expects.
 *
 * See `docs/adr/ADR-0010-comparison-report-generation.md` for the data
 * contract this file implements.
 *
 * @module report-types/comparison-report-inputs
 */

import type { PdfReportInput, ExcelReportInput, ReportChartLineSettings } from './report-inputs';

export type ReportLanguage = 'ru' | 'en';
export type ReportUnitSystem = 'SI' | 'SI_Pas' | 'Imperial';

export type AxisMode = 'individual' | 'shared';
export type DownsampleMode = 'off' | 'smart' | 'fast';
export type TimeFormat = 'seconds' | 'minutes' | 'hh:mm:ss';

// ── Chart config ───────────────────────────────────────────────────────────

/**
 * Which metrics are visible on the comparison chart.  Mirrors the four
 * `*Metric` props on `ComparisonChartUPlot`.
 */
export interface ComparisonMetrics {
    /** Always a real metric key such as `'viscosity_cp'`. */
    primary: string;
    /** Metric key or the literal `'none'`. */
    leftSecondary: string;
    /** Metric key or the literal `'none'`. */
    secondary: string;
    /** Metric key or the literal `'none'`. */
    tertiary: string;
}

/** Touch-point overlay configuration for the comparison chart. */
export interface ComparisonTouchPointConfig {
    enabled: boolean;
    /** Viscosity cut-off used to detect touch points, in cP. */
    viscosityThreshold: number;
    showTargetTime: boolean;
    /** Target time (minutes) marked on the chart when `showTargetTime`. */
    targetTime: number;
}

/**
 * All information needed to render the sheet/page 1 chart **and** echo the
 * user's exact visual settings onto the summary section.
 */
export interface ComparisonChartConfig {
    metrics: ComparisonMetrics;
    axisMode: AxisMode;
    /**
     * `[min, max]` in minutes, captured from the chart brush at generate-time.
     * `undefined` means "use the full data range".
     */
    brushRange?: [number, number];
    touchPoint: ComparisonTouchPointConfig;
    /** Same `ReportChartLineSettings` the single-exp path consumes. */
    lineSettings: ReportChartLineSettings;
    /**
     * Per-experiment colour palette (hex strings such as `'#1E90FF'`).
     * Sourced from `EXPERIMENT_COLORS` in
     * `components/comparison/comparison-chart-constants.ts`.  The renderer
     * cycles through the list using `index % len`.
     */
    experimentColors: string[];
    timeFormat?: TimeFormat;
    downsampleMode?: DownsampleMode;
    /** Target SVG chart width in pixels.  Default: `1400`. */
    chartWidth?: number;
    /** Target SVG chart height in pixels.  Default: `700`. */
    chartHeight?: number;
}

// ── Per-experiment entry ───────────────────────────────────────────────────

/**
 * Per-experiment section visibility.  Overrides `ReportSettings.show*`
 * inside `reportInput`, giving the UI per-experiment granularity while
 * keeping the single-exp payload intact.
 */
export interface ComparisonSectionToggles {
    showCalibration: boolean;
    showRawData: boolean;
    showRecipe: boolean;
    showWaterAnalysis: boolean;
    showRheology: boolean;
}

/**
 * One entry per experiment the user selected on the comparison view.
 *
 * `reportInput` contains exactly the payload the single-exp pipeline
 * already accepts (camelCase TS form).  The converter will run it through
 * {@link ./report-converter.ts} before embedding into the comparison wire
 * payload, so both the Rust single-exp and comparison code paths see the
 * identical `ReportInput` struct.
 */
export interface ComparisonExperimentEntry {
    /** Stable identifier from the TS experiment store. */
    id: string;
    /**
     * Proposed sheet/page name.  Rust's `sanitize_sheet_name()` will strip
     * forbidden chars and apply the 31-char Excel limit on the backend.
     */
    displayName: string;
    /** Pre-assembled per-experiment payload (camelCase TS form). */
    reportInput: PdfReportInput | ExcelReportInput;
    sectionToggles: ComparisonSectionToggles;
}

// ── Main input ─────────────────────────────────────────────────────────────

/**
 * Full payload for one comparison-report generation call.
 *
 * Sheet/page 1 is the **comparison chart + summary table**, rendered from
 * {@link comparisonChart} and a roll-up across every entry in
 * {@link experiments}.
 *
 * Sheets/pages 2..N+1 are **one compact per-experiment report** each,
 * assembled from each entry's {@link ComparisonExperimentEntry.reportInput}
 * in the same shape the single-exp pipeline consumes.
 */
export interface ComparisonReportInput {
    language: ReportLanguage;
    unitSystem: ReportUnitSystem;
    /** Overrides the `companyName` taken from the anchor experiment. */
    companyName?: string;
    /**
     * Base-64 encoded PNG/JPEG of the company logo.  This is the **only**
     * non-vector asset in the whole document.
     */
    companyLogoBase64?: string;
    /** ISO-8601 timestamp captured client-side when the user pressed Generate. */
    generatedAt: string;
    comparisonChart: ComparisonChartConfig;
    /** Rendered on sheets/pages 2..N+1 in the given order. */
    experiments: ComparisonExperimentEntry[];
}
