/**
 * Shared analysis constants — single source of truth.
 *
 * Used by: cycle-results-table, useAnalysisPipeline, calculation.worker,
 * analysis-settings-store, Rust WASM report generator.
 */

/** Default viscosity shear rates for basic (non-expert) mode (s⁻¹) */
export const DEFAULT_VISCOSITY_SHEAR_RATES = [40, 100, 170] as const;

/** Cycle type badge colors — Tailwind classes (theme-aware via dark: variant) */
export const CYCLE_TYPE_STYLES = {
  ISO:     { bg: 'bg-blue-100 dark:bg-[#0a1628]',    text: 'text-blue-700    dark:text-blue-400'    },
  API:     { bg: 'bg-green-100 dark:bg-[#14532d]',   text: 'text-green-700   dark:text-green-400'   },
  SST:     { bg: 'bg-purple-100 dark:bg-[#3b0764]',  text: 'text-purple-700  dark:text-purple-400'  },
  Custom:  { bg: 'bg-slate-200 dark:bg-slate-800',   text: 'text-foreground'                        },
} as const;

export type CycleTypeName = keyof typeof CYCLE_TYPE_STYLES;

/**
 * Human-readable labels for dominantPattern (methodology derived from shear-rate schedule).
 * ISO  → ISO 13503-1 (monotonic ramp-down)
 * API  → API RP 39 (symmetric 75-50-25-50-75-100 s⁻¹ ramp)
 * SST  → SST (steady-state at single shear rate)
 */
export const DOMINANT_PATTERN_LABELS: Record<CycleTypeName, string> = {
  ISO:    'ISO 13503',
  API:    'API RP 39',
  SST:    'SST',
  Custom: 'Нестандартная',
};

/** Colors for rheological data values */
export const DATA_COLORS = {
  /** Default data cell text */
  default: '#e2e8f0',
  /** R² ≥ 0.9 — good fit */
  r2Good: '#4ade80',
  /** R² < 0.9 — poor fit */
  r2Bad: '#fb923c',
  /** Viscosity values */
  viscosity: '#22d3ee',
  /** Muted / expand arrow */
  muted: '#64748b',
} as const;
