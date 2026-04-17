/**
 * Shared filter interface for the experiment library.
 *
 * Single source of truth — replaces the three divergent local `Filters`
 * interfaces that previously lived in:
 *   - experiment-filters.tsx  (24 fields, all required strings)
 *   - experiment-list.tsx     (20 fields, missing laboratoryName / geometry)
 *   - page.tsx                (inline initialisation state)
 *
 * All string fields are required (use '' as the empty/unset value) so that
 * consumers can safely spread the object into API calls without silent drops.
 */
export interface ExperimentFilters {
    // ── Text search ─────────────────────────────────────────────────────────
    searchQuery: string;
    testName: string;
    laboratoryName: string;
    fieldName: string;
    operatorName: string;
    wellNumber: string;
    waterSource: string;
    // ── Select filters ───────────────────────────────────────────────────────
    fluidType: string;
    instrumentType: string;
    geometry: string;
    testCategory: string;
    testType: string;
    // ── QA filters ───────────────────────────────────────────────────────────
    batchNumber: string;
    reagentNames: string[];
    // ── Range filters ────────────────────────────────────────────────────────
    dateFrom: string;
    dateTo: string;
    durationMin: string;
    durationMax: string;
    tempMin: string;
    tempMax: string;
    viscosityMin: string;
    viscosityMax: string;
}

/** Default/empty state for ExperimentFilters — use as useState initial value. */
export const EMPTY_FILTERS: ExperimentFilters = {
    searchQuery: '',
    testName: '',
    laboratoryName: '',
    fieldName: '',
    operatorName: '',
    wellNumber: '',
    waterSource: '',
    fluidType: '',
    instrumentType: '',
    geometry: '',
    testCategory: '',
    testType: '',
    batchNumber: '',
    reagentNames: [],
    dateFrom: '',
    dateTo: '',
    durationMin: '',
    durationMax: '',
    tempMin: '',
    tempMax: '',
    viscosityMin: '',
    viscosityMax: '',
};
