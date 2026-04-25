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
    // ── Touch-point filters ─────────────────────────────────────────────────
    // Under the **default library contract** (50 cP threshold, 10-min
    // target) these use precomputed columns for instant queries.  When
    // `viscosityThreshold` is set the backend switches to the slow path
    // and recomputes crossings per-experiment against the user's threshold
    // — this unlocks lab workflows where gel break-points vary by fluid
    // type (e.g. crosslinked gels break near 500 cP, not 50).
    //
    // Filter string values are user input; empty string means "no filter".

    /**
     * Viscosity threshold (cP) for the touch-point algorithm.
     *
     * - `''` (empty) → fast path, fixed library threshold (50 cP).
     * - Any positive number → slow on-the-fly path against that threshold.
     *
     * The sidebar offers presets 10, 50, 100, 200, 300, 500 plus a manual
     * input for custom lab values.
     */
    viscosityThreshold: string;
    /** Minimum time (min) at which viscosity first crossed below the threshold. */
    crossingTimeMin: string;
    /** Maximum time (min) at which viscosity first crossed below the threshold. */
    crossingTimeMax: string;
    /** Minimum viscosity (cP) at target time (10 min). */
    viscosityAtTargetMin: string;
    /** Maximum viscosity (cP) at target time (10 min). */
    viscosityAtTargetMax: string;
    /**
     * Tri-state selector over the `has_crossing` flag (precomputed or
     * dynamic, depending on whether `viscosityThreshold` is set):
     *   - ''     → filter not applied
     *   - 'yes'  → only experiments that crossed the threshold
     *   - 'no'   → only experiments that did NOT cross the threshold
     */
    hasCrossing: '' | 'yes' | 'no';
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
    // Touch-point filters — `viscosityThreshold` drives the algorithm,
    // other fields filter the result.  Empty string → fast precomputed
    // path at the fixed library threshold (50 cP).
    viscosityThreshold: '',
    crossingTimeMin: '',
    crossingTimeMax: '',
    viscosityAtTargetMin: '',
    viscosityAtTargetMax: '',
    hasCrossing: '',
};
