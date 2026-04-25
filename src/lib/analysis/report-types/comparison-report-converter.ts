/**
 * @fileoverview Comparison Report Converter — camelCase TS input →
 * snake_case wire format consumed by the Rust
 * `comparison::types::ComparisonReportInput` deserialiser.
 *
 * The per-experiment nested `reportInput` is delegated to the existing
 * {@link ./report-converter.ts#convertReportInputToWasm} so both single-exp
 * and comparison paths stay byte-identical for the same per-experiment
 * input.
 *
 * See `docs/adr/ADR-0010-comparison-report-generation.md` §6 for the data
 * contract decisions this implementation follows.
 *
 * @module report-types/comparison-report-converter
 */

import type {
    ComparisonReportInput,
    ComparisonExperimentEntry,
    ComparisonChartConfig,
} from './comparison-report-inputs';
import type { ReportChartLineSettings } from './report-inputs';
import { convertReportInputToWasm } from './report-converter';

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert camelCase `ReportChartLineSettings` into the snake_case shape
 * the Rust `ChartLineSettings` deserialiser expects.
 *
 * Kept in sync with the block inside
 * {@link ./report-converter.ts#convertReportInputToWasm}; if the canonical
 * implementation changes there, this function must follow.
 */
function convertLineSettings(ls: ReportChartLineSettings): Record<string, unknown> {
    const out: Record<string, unknown> = {
        viscosity: { color: ls.viscosity.color, width: ls.viscosity.width, style: ls.viscosity.style },
        temperature: { color: ls.temperature.color, width: ls.temperature.width, style: ls.temperature.style },
        shear_rate: { color: ls.shearRate.color, width: ls.shearRate.width, style: ls.shearRate.style },
        pressure: { color: ls.pressure.color, width: ls.pressure.width, style: ls.pressure.style },
        rpm: { color: ls.rpm.color, width: ls.rpm.width, style: ls.rpm.style },
    };
    if (ls.bathTemperature) {
        out.bath_temperature = {
            color: ls.bathTemperature.color,
            width: ls.bathTemperature.width,
            style: ls.bathTemperature.style,
        };
    }
    return out;
}

function convertChartConfig(cfg: ComparisonChartConfig): Record<string, unknown> {
    return {
        metrics: {
            primary: cfg.metrics.primary,
            left_secondary: cfg.metrics.leftSecondary,
            secondary: cfg.metrics.secondary,
            tertiary: cfg.metrics.tertiary,
        },
        axis_mode: cfg.axisMode,
        brush_range: cfg.brushRange ?? null,
        touch_point: {
            enabled: cfg.touchPoint.enabled,
            viscosity_threshold: cfg.touchPoint.viscosityThreshold,
            show_target_time: cfg.touchPoint.showTargetTime,
            target_time: cfg.touchPoint.targetTime,
        },
        line_settings: convertLineSettings(cfg.lineSettings),
        experiment_colors: [...cfg.experimentColors],
        time_format: cfg.timeFormat ?? 'minutes',
        downsample_mode: cfg.downsampleMode ?? 'smart',
        chart_width: cfg.chartWidth ?? 1400,
        chart_height: cfg.chartHeight ?? 700,
    };
}

function convertExperimentEntry(entry: ComparisonExperimentEntry): Record<string, unknown> {
    return {
        id: entry.id,
        display_name: entry.displayName,
        // Reuse the single-exp converter — its output matches the Rust
        // `ReportInput` struct verbatim, which is exactly what
        // `ComparisonExperimentEntry.report_input` is typed as.
        report_input: convertReportInputToWasm(entry.reportInput),
        section_toggles: {
            show_calibration: entry.sectionToggles.showCalibration,
            show_raw_data: entry.sectionToggles.showRawData,
            show_recipe: entry.sectionToggles.showRecipe,
            show_water_analysis: entry.sectionToggles.showWaterAnalysis,
            show_rheology: entry.sectionToggles.showRheology,
        },
    };
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Convert a developer-facing {@link ComparisonReportInput} (camelCase) into
 * the snake_case object shape consumed by the Rust comparison-report
 * deserialiser.  The return value is structurally typed as `unknown` to
 * match the existing single-exp converter — callers pass it straight to
 * `bridge.reports.generateComparison*` which hands it off to `serde`.
 *
 * @param input camelCase comparison report payload (already validated).
 * @returns    snake_case object ready to be serialised via Tauri IPC.
 */
export function convertComparisonReportInputToWasm(
    input: ComparisonReportInput,
): unknown {
    return {
        language: input.language,
        unit_system: input.unitSystem,
        company_name: input.companyName ?? null,
        company_logo_base64: input.companyLogoBase64 ?? null,
        generated_at: input.generatedAt,
        comparison_chart: convertChartConfig(input.comparisonChart),
        experiments: input.experiments.map(convertExperimentEntry),
    };
}
