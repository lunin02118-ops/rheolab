/**
 * Fluid type constants + human-readable Russian labels.
 *
 * Canonical order: fracturing fluids first (most common in RealLab),
 * then drilling muds.
 */

export const FLUID_TYPES = [
    'Linear',
    'Crosslinked',
    'Slickwater',
    'VES',
    'Foam',
    'Emulsion',
    'WBM',
    'OBM',
    'SBM',
] as const;

export type FluidType = (typeof FLUID_TYPES)[number];

/** Russian labels shown in UI dropdowns and badges. */
export const FLUID_TYPE_LABELS: Record<FluidType, string> = {
    Linear:      'Линейный гель',
    Crosslinked: 'Сшитый гель',
    Slickwater:  'Слик-вотер',
    VES:         'VES-гель',
    Foam:        'Пена',
    Emulsion:    'Эмульсия',
    WBM:         'Буровой (WBM)',
    OBM:         'Буровой (OBM)',
    SBM:         'Буровой (SBM)',
};

/**
 * Short labels for compact UI elements (badges, table cells).
 * Fall back to the full label when no short form is needed.
 */
export const FLUID_TYPE_SHORT: Record<FluidType, string> = {
    Linear:      'Линейный',
    Crosslinked: 'Сшитый',
    Slickwater:  'Слик-вотер',
    VES:         'VES',
    Foam:        'Пена',
    Emulsion:    'Эмульсия',
    WBM:         'WBM',
    OBM:         'OBM',
    SBM:         'SBM',
};

/** Tailwind colour classes for each fluid type badge. */
export const FLUID_TYPE_BADGE_CLASS: Record<FluidType, string> = {
    Linear:      'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-400 dark:border-blue-500/30',
    Crosslinked: 'bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 border-green-400 dark:border-green-500/30',
    Slickwater:  'bg-cyan-100 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-400 dark:border-cyan-500/30',
    VES:         'bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-400 dark:border-purple-500/30',
    Foam:        'bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 border-yellow-400 dark:border-yellow-500/30',
    Emulsion:    'bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-400 dark:border-orange-500/30',
    WBM:         'bg-teal-100 dark:bg-teal-500/20 text-teal-700 dark:text-teal-300 border-teal-400 dark:border-teal-500/30',
    OBM:         'bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-400 dark:border-amber-500/30',
    SBM:         'bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-400 dark:border-rose-500/30',
};

/** Returns true when the string is a valid FluidType. */
export function isFluidType(value: string): value is FluidType {
    return (FLUID_TYPES as readonly string[]).includes(value);
}
