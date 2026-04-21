/**
 * Display Settings Store
 * Global unit-system preference (Zustand + localStorage persist).
 *
 * Single source of truth for viscosity / K' / PV / YP unit display
 * across the dashboard table, Excel export, and PDF export.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ── Types ─────────────────────────────────────────────────────────────

/** Supported unit systems. Stored in localStorage, sent to Rust as-is. */
export type UnitSystem = 'SI' | 'SI_Pas' | 'Imperial';

interface DisplaySettingsState {
    unitSystem: UnitSystem;
    setUnitSystem: (v: UnitSystem) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Viscosity unit label for display headers. */
export function getViscosityUnit(u: UnitSystem): 'mPa·s' | 'Pa·s' | 'cP' {
    switch (u) {
        case 'Imperial': return 'cP';
        case 'SI_Pas':   return 'Pa·s';
        default:         return 'mPa·s';   // 'SI'
    }
}

/**
 * Convert a viscosity value stored in mPa·s to the target unit.
 * mPa·s and cP are numerically identical (1:1).
 * Pa·s = mPa·s / 1000.
 */
export function convertViscosity(v_mPas: number, u: UnitSystem): number {
    return u === 'SI_Pas' ? v_mPas / 1000 : v_mPas;
}

/** Decimal places for UI display (adaptive per unit). */
export function getViscosityDecimals(u: UnitSystem): number {
    return u === 'SI_Pas' ? 4 : 1;
}

/**
 * Map the store's UnitSystem to the string that Rust report_generator
 * expects in `ReportSettings.unit_system`.
 *
 * - `'SI'`       → `"SI"`       (existing, η in mPa·s)
 * - `'SI_Pas'`   → `"SI_Pas"`   (new, η in Pa·s, K'/PV/YP same as SI)
 * - `'Imperial'` → `"Imperial"` (existing, K'→lbf/100ft², PV→cP, YP→lbf/100ft²)
 */
export function toRustUnitSystem(u: UnitSystem): string {
    return u;   // 1:1 mapping — names are identical
}

// ── Store ──────────────────────────────────────────────────────────────

const DEFAULT_UNIT_SYSTEM: UnitSystem = 'SI';

function sanitizeUnitSystem(v: unknown): UnitSystem {
    if (v === 'SI' || v === 'SI_Pas' || v === 'Imperial') return v;
    return DEFAULT_UNIT_SYSTEM;
}

export const useDisplaySettingsStore = create<DisplaySettingsState>()(
    persist(
        (set) => ({
            unitSystem: DEFAULT_UNIT_SYSTEM,

            setUnitSystem: (unitSystem) => set({ unitSystem }),
        }),
        {
            name: 'rheolab-display-settings',
            merge: (persistedState, currentState) => {
                const p = (persistedState ?? {}) as Partial<DisplaySettingsState>;
                return {
                    ...currentState,
                    unitSystem: sanitizeUnitSystem(p.unitSystem),
                };
            },
        }
    )
);
