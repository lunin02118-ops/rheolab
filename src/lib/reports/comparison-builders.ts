/**
 * @fileoverview Pure UI-side builder for {@link ComparisonReportInput}.
 *
 * This module assembles the camelCase `ComparisonReportInput` payload used by
 * renderer/unit tests and legacy fixture tooling. Production comparison
 * exports use bounded by-IDs IPC and assemble this shape inside Rust.
 *
 * It is intentionally minimal: per-experiment `reportInput` objects are
 * expected to already be built via the existing
 * {@link ./report-builders.ts#buildPdfReportInput} /
 * {@link ./report-builders.ts#buildExcelReportInput} helpers, and passed in
 * as-is.
 *
 * See `docs/adr/ADR-0010-comparison-report-generation.md` §2 for the
 * higher-level architecture.
 */

import type {
    ComparisonReportInput,
    ComparisonChartConfig,
    ComparisonExperimentEntry,
    ComparisonSectionToggles,
    ReportLanguage,
    ReportUnitSystem,
} from '@/lib/analysis/report-types/comparison-report-inputs';
import type {
    PdfReportInput,
    ExcelReportInput,
} from '@/lib/analysis/report-types/report-inputs';

// ── Input shape ────────────────────────────────────────────────────────────

/**
 * Source shape for one per-experiment entry — the UI supplies this per
 * selected experiment on the Comparison view.
 */
export interface ComparisonReportEntrySource {
    id: string;
    displayName: string;
    /**
     * Pre-assembled per-experiment payload.  The comparison pipeline
     * treats it opaquely, so the UI may pass either the PDF or Excel
     * flavour — the shape is identical.
     */
    reportInput: PdfReportInput | ExcelReportInput;
    sectionToggles: ComparisonSectionToggles;
}

/**
 * High-level context the UI collects before calling the builder.
 *
 * `generatedAt` defaults to `new Date().toISOString()` when omitted; tests
 * that need deterministic output should pass an explicit timestamp.
 */
export interface ComparisonReportBuildContext {
    language: ReportLanguage;
    unitSystem: ReportUnitSystem;
    companyName?: string;
    companyLogoBase64?: string;
    /** ISO-8601 timestamp.  Defaults to the current wall clock when absent. */
    generatedAt?: string;
    comparisonChart: ComparisonChartConfig;
    entries: ComparisonReportEntrySource[];
}

// ── Public builder ─────────────────────────────────────────────────────────

/**
 * Assemble a {@link ComparisonReportInput} payload from the UI-side build
 * context.
 *
 * The builder is pure and deterministic with respect to `ctx`, aside from
 * the default value for `generatedAt` (`new Date().toISOString()`).  Pass
 * an explicit `generatedAt` to obtain byte-stable output.
 *
 * @throws if {@link ComparisonReportBuildContext.entries} is empty — the
 *         Rust renderer requires at least one experiment to render.
 */
export function buildComparisonReportInput(
    ctx: ComparisonReportBuildContext,
): ComparisonReportInput {
    if (ctx.entries.length === 0) {
        throw new Error(
            'buildComparisonReportInput: entries must contain at least one experiment',
        );
    }

    const generatedAt = ctx.generatedAt ?? new Date().toISOString();

    const experiments: ComparisonExperimentEntry[] = ctx.entries.map((entry) => ({
        id: entry.id,
        displayName: entry.displayName,
        reportInput: entry.reportInput,
        sectionToggles: { ...entry.sectionToggles },
    }));

    return {
        language: ctx.language,
        unitSystem: ctx.unitSystem,
        companyName: ctx.companyName,
        companyLogoBase64: ctx.companyLogoBase64,
        generatedAt,
        comparisonChart: ctx.comparisonChart,
        experiments,
    };
}
