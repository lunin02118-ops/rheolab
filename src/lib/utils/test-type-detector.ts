/**
 * detectTestCategoryAndType
 *
 * Heuristic determination of TestCategory + TestType from available metadata.
 * Used to pre-populate the save dialog; the user can always override the result.
 *
 * Inputs (all optional):
 *   fluidType      — already-determined FluidType (used to pick the category)
 *   filename       — original data file name; parsed for test-type keywords
 *   instrumentType — from parser metadata
 *   maxTemp        — maximum temperature recorded (°C)
 *   durationMin    — total duration (minutes)
 *   reagentCategories — resolved catalog categories of the reagent recipe
 */

import type { FluidType } from '@/lib/constants/fluid-types';
import type { TestCategory, TestType } from '@/lib/constants/test-types';

export interface TestTypeDetectionInput {
    fluidType?: FluidType;
    filename?: string;
    instrumentType?: string;
    maxTemp?: number;
    durationMin?: number;
    reagentCategories?: string[];
}

export interface TestTypeDetectionResult {
    testCategory: TestCategory;
    testType: TestType;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function matches(text: string, ...patterns: string[]): boolean {
    const lower = text.toLowerCase();
    return patterns.some(p => lower.includes(p.toLowerCase()));
}

// ── Category from FluidType ───────────────────────────────────────────────────

function categoryFromFluidType(ft?: FluidType): TestCategory {
    if (!ft) return 'Fracturing';
    if (ft === 'WBM' || ft === 'OBM' || ft === 'SBM') return 'Drilling';
    return 'Fracturing';
}

// ── Fracturing test-type heuristics ──────────────────────────────────────────

function detectFracturingType(
    filename: string,
    instrumentType: string,
    maxTemp: number,
    durationMin: number,
    cats: string[],
): TestType {
    const fn = filename;

    // Hydration — slow build-up protocol, filename keyword
    if (matches(fn, 'hydrat', 'гидрат', 'build-up', 'buildup', 'buildupviscosity')) {
        return 'Hydration';
    }

    // Crosslink time / window
    if (matches(fn, 'crosslink', 'xlink', 'сшив', 'сшитый', 'cross-link') ||
        cats.some(c => c.includes('crosslinker'))) {
        // Only classify as CrosslinkTest if the filename explicitly says so
        if (matches(fn, 'crosslink', 'xlink', 'сшив') || matches(fn, 'crosslink-time', 'xlink-time')) {
            return 'CrosslinkTest';
        }
        // Otherwise it's likely shear viscosity with crosslinker
    }

    // Shear degradation — high+low shear protocol
    if (matches(fn, 'degrad', 'destr', 'degradation', 'деград', 'деструкц')) {
        return 'ShearDegradation';
    }

    // Thermal stability — temperature ramp, hot test
    if (maxTemp >= 80 || matches(fn, 'thermal', 'temperature', 'heat', 'hot', 'темп', 'нагрев', 'hpht')) {
        return 'ThermalStability';
    }

    // Break test
    if (matches(fn, 'break', 'брейк', 'деструкт', 'destroy', 'destruct') ||
        cats.some(c => c.includes('breaker'))) {
        if (matches(fn, 'break', 'брейк', 'деструкт')) return 'BreakTest';
    }

    // Residue / filterability
    if (matches(fn, 'residue', 'остат', 'filter', 'фильтр')) {
        return 'FilterResidueTest';
    }

    // Proppant transport
    if (matches(fn, 'proppant', 'проппант', 'transport', 'settling', 'sett', 'седим')) {
        return 'ProppantTransport';
    }

    // Friction reduction (slickwater typical)
    if (matches(fn, 'friction', 'fr-test', 'drag', 'снижение трения', 'понижение трения') ||
        cats.some(c => c.includes('friction reducer'))) {
        return 'FrictionReduction';
    }

    // Compatibility with reservoir fluids
    if (matches(fn, 'compat', 'совмест', 'emulsion', 'эмульс')) {
        return 'FluidsCompatibility';
    }

    // Biostability
    if (matches(fn, 'biocide', 'биоцид', 'biostab', 'биостаб', 'bacteria', 'бактер')) {
        return 'Biostability';
    }

    // Long test without special keywords → could be shear viscosity flow curve
    // Short test (<30 min) with no high temp → shear viscosity default
    return 'ShearViscosity';
}

// ── Drilling test-type heuristics ─────────────────────────────────────────────

function detectDrillingType(
    filename: string,
    _maxTemp: number,
    _durationMin: number,
    _cats: string[],
): TestType {
    const fn = filename;

    if (matches(fn, 'filtration', 'фильтр', 'filtrate', 'api', 'hpht')) return 'Filtration';
    if (matches(fn, 'sag', 'settling', 'sedim', 'седим', 'барит')) return 'BariteSag';
    if (matches(fn, 'thixo', 'gel', 'гель', 'тиксо', 'recovery')) return 'Thixotropy';
    if (matches(fn, 'aging', 'hot roll', 'hotroll', 'термостар', 'старен')) return 'ThermalAging';
    if (matches(fn, 'shale', 'inhibit', 'ингиб', 'сланц')) return 'ShaleInhibition';
    if (matches(fn, 'lcm', 'bridg', 'ppa', 'поглощен')) return 'LCMBridging';
    if (matches(fn, 'contamination', 'загрязн', 'цемент', 'ангидрит')) return 'ContaminationTest';
    if (matches(fn, 'es', 'electrical', 'stability', 'электростаб')) return 'ElectricalStability';
    if (matches(fn, 'emulsion', 'эмульс', 'obm emul')) return 'EmulsionStability';
    if (matches(fn, 'lubric', 'смазк', 'cof', 'coeff friction')) return 'Lubricity';
    if (matches(fn, 'retort', 'oil/water', 'o/w/s', 'ретор')) return 'Retort';
    if (matches(fn, 'sand', 'песок', 'solids')) return 'SandContent';
    if (matches(fn, 'pH', 'alkalin', 'щелочн', 'известь')) return 'PhAlkalinity';
    if (matches(fn, 'chloride', 'хлорид', 'hardness', 'жёсткость')) return 'ChlorideHardness';
    if (matches(fn, 'mbt', 'methylene', 'clay activity', 'мбт', 'мет.синий')) return 'MBT';
    if (matches(fn, 'density', 'weight', 'плотность', 'mud weight')) return 'MudWeight';

    return 'MudRheology';
}

// ── Public API ────────────────────────────────────────────────────────────────

export function detectTestCategoryAndType(
    input: TestTypeDetectionInput,
): TestTypeDetectionResult {
    const {
        fluidType,
        filename = '',
        instrumentType = '',
        maxTemp = 0,
        durationMin = 0,
        reagentCategories = [],
    } = input;

    const cats = reagentCategories.map(c => c.toLowerCase());

    // Water analysis — filename keyword takes highest priority
    if (matches(filename, 'water', 'вода', 'ионн', 'mineral', 'water-quality', 'water quality', 'совместим')) {
        return { testCategory: 'General', testType: 'WaterAnalysis' };
    }

    const testCategory = categoryFromFluidType(fluidType);

    if (testCategory === 'Drilling') {
        return {
            testCategory,
            testType: detectDrillingType(filename, maxTemp, durationMin, cats),
        };
    }

    // Fracturing (default branch)
    return {
        testCategory,
        testType: detectFracturingType(filename, instrumentType, maxTemp, durationMin, cats),
    };
}
