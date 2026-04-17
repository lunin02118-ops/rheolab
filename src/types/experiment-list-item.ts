/**
 * Shared view types for the experiment library (card + table + list).
 *
 * Single source of truth — replaces the three independent ExperimentData /
 * Experiment interfaces that previously lived in:
 *   - experiment-card.tsx
 *   - experiment-table.tsx
 *   - experiment-list.tsx (Experiment)
 */

/** Typed reagent as returned by the list/detail endpoints. */
export interface ExperimentReagentItem {
    reagentName?: string | null;
    concentration?: number | null;
    unit?: string | null;
    category?: string | null;
    batchNumber?: string | null;
    productionDate?: string | null;
}

/** Water chemistry parameters — JSON blob stored in waterParams column. */
export interface WaterParams {
    // lowercase (current canonical form)
    ph?: number | null;
    fe?: number | null;
    ca?: number | null;
    mg?: number | null;
    cl?: number | null;
    so4?: number | null;
    hco3?: number | null;
    tds?: number | null;
    // legacy uppercase aliases (older saved records)
    pH?: number | null;
    Fe?: number | null;
    Ca?: number | null;
    Mg?: number | null;
    Cl?: number | null;
    SO4?: number | null;
    HCO3?: number | null;
    TDS?: number | null;
}

/**
 * Unified lightweight experiment shape for card, table and list views.
 *
 * Based on `ExperimentListItem` from generated.d.ts, plus the legacy `metrics`
 * field that some views fall back to when the DB aggregate columns are null.
 */
export interface ExperimentCardItem {
    id: string;
    name: string;
    /** ISO string or Date — the form/dashboard may pass a Date object. */
    testDate: string | Date;
    fluidType: string;
    fieldName?: string | null;
    operatorName?: string | null;
    waterSource?: string | null;
    instrumentType?: string | null;
    geometry?: string | null;
    maxViscosity?: number | null;
    avgViscosity?: number | null;
    avgTemperatureC?: number | null;
    maxTemperatureC?: number | null;
    durationSeconds?: number | null;
    testCategory?: string | null;
    testType?: string | null;
    dominantPattern?: string | null;
    /** Structured reagent list — prefer over the loose Record variant. */
    reagents?: ExperimentReagentItem[] | null;
    /** Raw JSON blob — cast to WaterParams at point of use. */
    waterParams?: unknown;
    /** Legacy metrics object — fallback when DB aggregate columns are null. */
    metrics?: {
        maxViscosity?: number;
        initialViscosity_5_10?: number;
    } | null;
    user?: { name: string } | null;
    laboratory?: { name: string } | null;
}
