/**
 * detectFluidType
 *
 * Determines the FluidType for an experiment from its reagent recipe.
 * Recipe-based detection is more reliable than viscosity-curve analysis
 * because the fluid type is set by the formulator's intent.
 *
 * Priority order (first match wins):
 *   1. Crosslinker present                        → Crosslinked
 *   2. Friction Reducer, no Gelling Agent/Viscosifier → Slickwater
 *   3. OBM-base or Oil present                    → OBM
 *   4. VES / Viscoelastic Surfactant in name       → VES
 *   5. Emulsifier present (no OBM base, no oil)   → Emulsion
 *   6. Foamer / foam agent present                → Foam
 *   7. Barite / Weighting Agent (no fracturing)   → WBM  (drill fluid heuristic)
 *   8. Gelling Agent or Viscosifier present        → Linear
 *   9. Default                                     → Linear
 */

import type { FluidType } from '@/lib/constants/fluid-types';
import type { ReagentRow, ReagentCatalogItem } from '@/components/experiment-form';

/** Resolve the catalog category for every reagent row. */
function resolveCategories(
    reagents: ReagentRow[],
    catalog: ReagentCatalogItem[],
): string[] {
    const catalogMap = new Map(catalog.map(c => [c.id, c]));
    return reagents.map(r => {
        const cat = catalogMap.get(r.reagentId ?? '')?.category ?? '';
        return cat.toLowerCase();
    });
}

/** Resolve reagent names (from catalog when available, else stored name). */
function resolveNames(
    reagents: ReagentRow[],
    catalog: ReagentCatalogItem[],
): string[] {
    const catalogMap = new Map(catalog.map(c => [c.id, c]));
    return reagents.map(r => {
        const entry = catalogMap.get(r.reagentId ?? '');
        const name = entry?.name ?? r.reagentName ?? '';
        return name.toLowerCase();
    });
}

function anyIncludes(arr: string[], ...needles: string[]): boolean {
    return arr.some(v => needles.some(n => v.includes(n)));
}

export function detectFluidType(
    reagents: ReagentRow[],
    catalog: ReagentCatalogItem[],
): FluidType {
    if (!reagents.length) return 'Linear';

    const categories = resolveCategories(reagents, catalog);
    const names      = resolveNames(reagents, catalog);

    // 1. Crosslinked gel (borate, Ti, Zr, Al crosslinker)
    if (anyIncludes(categories, 'crosslinker')) return 'Crosslinked';

    // 2. Slickwater / friction reducer (FR without base polymer)
    const hasFR     = anyIncludes(categories, 'friction reducer');
    const hasGelBase = anyIncludes(categories, 'gelling agent', 'viscosifier', 'polymer');
    if (hasFR && !hasGelBase) return 'Slickwater';

    // 3. Oil-based / invert emulsion mud
    if (anyIncludes(categories, 'obm', 'oil-based', 'invert emulsion base') ||
        anyIncludes(names, 'obm', 'diesel', 'internal olefin', 'synthetic oil', 'base oil')) {
        return 'OBM';
    }

    // 4. VES (viscoelastic surfactant)
    if (anyIncludes(categories, 'ves', 'viscoelastic surfactant') ||
        anyIncludes(names, 'ves', 'viscoelastic surfactant', 'betaine', 'surfactant gel')) {
        return 'VES';
    }

    // 5. Emulsion fluid (e.g. acid emulsion, frac emulsion)
    if (anyIncludes(categories, 'emulsifier', 'emulsion') ||
        anyIncludes(names, 'emulsifier', 'emulsion')) {
        return 'Emulsion';
    }

    // 6. Foam (N₂/CO₂ foam fluid)
    if (anyIncludes(categories, 'foamer', 'foam agent', 'foam stabiliser', 'foam stabilizer') ||
        anyIncludes(names, 'foamer', 'foam agent')) {
        return 'Foam';
    }

    // 7. Drilling mud heuristic — barite or weighting agent present → WBM
    if (anyIncludes(categories, 'weighting agent', 'barite') ||
        anyIncludes(names, 'barite', 'calcium carbonate', 'hematite')) {
        return 'WBM';
    }

    // 8. Linear gel (guar, HPG, CMHPG, HEC, etc.)
    if (anyIncludes(categories, 'gelling agent', 'viscosifier', 'polymer') ||
        anyIncludes(names, 'guar', 'hpg', 'hpam', 'hec', 'cmhpg', 'xanthan', 'starch')) {
        return 'Linear';
    }

    // 9. Default
    return 'Linear';
}
