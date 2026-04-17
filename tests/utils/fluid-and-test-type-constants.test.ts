/**
 * Tests for fluid-types.ts and test-types.ts constants.
 *
 * Validates structural invariants: completeness of label maps,
 * helper functions, category membership, and total counts.
 */
import { describe, it, expect } from 'vitest';
import {
    FLUID_TYPES,
    FLUID_TYPE_LABELS,
    FLUID_TYPE_SHORT,
    FLUID_TYPE_BADGE_CLASS,
    isFluidType,
} from '@/lib/constants/fluid-types';

import {
    TEST_CATEGORIES,
    TEST_CATEGORY_LABELS,
    FRACTURING_TEST_TYPES,
    DRILLING_TEST_TYPES,
    GENERAL_TEST_TYPES,
    TEST_TYPE_LABELS,
    TEST_TYPES_BY_CATEGORY,
    ALL_TEST_TYPE_OPTIONS,
    isTestCategory,
    isTestType,
    getCategoryForTestType,
} from '@/lib/constants/test-types';

// ── FLUID_TYPES ───────────────────────────────────────────────────────────────

describe('FLUID_TYPES constant', () => {
    it('contains exactly 9 values', () => {
        expect(FLUID_TYPES).toHaveLength(9);
    });

    it('includes all expected fluid types', () => {
        const expected = ['Linear', 'Crosslinked', 'Slickwater', 'VES', 'Foam', 'Emulsion', 'WBM', 'OBM', 'SBM'];
        expect([...FLUID_TYPES]).toEqual(expect.arrayContaining(expected));
        expect(FLUID_TYPES).toHaveLength(expected.length);
    });

    it('drilling muds are WBM, OBM, SBM', () => {
        expect(FLUID_TYPES).toContain('WBM');
        expect(FLUID_TYPES).toContain('OBM');
        expect(FLUID_TYPES).toContain('SBM');
    });
});

describe('FLUID_TYPE_LABELS', () => {
    it('has a label entry for every FluidType', () => {
        for (const ft of FLUID_TYPES) {
            expect(FLUID_TYPE_LABELS).toHaveProperty(ft);
            expect(FLUID_TYPE_LABELS[ft].length).toBeGreaterThan(0);
        }
    });

    it('all labels are non-empty strings', () => {
        for (const label of Object.values(FLUID_TYPE_LABELS)) {
            expect(typeof label).toBe('string');
            expect(label.length).toBeGreaterThan(0);
        }
    });
});

describe('FLUID_TYPE_SHORT', () => {
    it('has a short label for every FluidType', () => {
        for (const ft of FLUID_TYPES) {
            expect(FLUID_TYPE_SHORT).toHaveProperty(ft);
        }
    });

    it('all short labels are non-empty strings', () => {
        for (const label of Object.values(FLUID_TYPE_SHORT)) {
            expect(typeof label).toBe('string');
            expect(label.length).toBeGreaterThan(0);
        }
    });
});

describe('FLUID_TYPE_BADGE_CLASS', () => {
    it('has a badge class for every FluidType', () => {
        for (const ft of FLUID_TYPES) {
            expect(FLUID_TYPE_BADGE_CLASS).toHaveProperty(ft);
        }
    });

    it('each badge class contains bg-, text-, and border- utilities', () => {
        for (const cls of Object.values(FLUID_TYPE_BADGE_CLASS)) {
            expect(cls).toMatch(/bg-/);
            expect(cls).toMatch(/text-/);
            expect(cls).toMatch(/border-/);
        }
    });

    it('all 9 fluid types have distinct badge classes', () => {
        const classes = Object.values(FLUID_TYPE_BADGE_CLASS);
        const unique = new Set(classes);
        expect(unique.size).toBe(FLUID_TYPES.length);
    });
});

describe('isFluidType()', () => {
    it('returns true for valid fluid types', () => {
        for (const ft of FLUID_TYPES) {
            expect(isFluidType(ft)).toBe(true);
        }
    });

    it('returns false for invalid strings', () => {
        expect(isFluidType('')).toBe(false);
        expect(isFluidType('linear')).toBe(false);  // case-sensitive
        expect(isFluidType('Unknown')).toBe(false);
        expect(isFluidType('Mud')).toBe(false);
    });

    it('returns false for close but wrong values', () => {
        expect(isFluidType('Crosslink')).toBe(false);
        expect(isFluidType('SlickWater')).toBe(false);
    });
});

// ── TEST_CATEGORIES ────────────────────────────────────────────────────────────

describe('TEST_CATEGORIES constant', () => {
    it('contains exactly 3 categories', () => {
        expect(TEST_CATEGORIES).toHaveLength(3);
    });

    it('includes Fracturing, Drilling, General', () => {
        expect(TEST_CATEGORIES).toContain('Fracturing');
        expect(TEST_CATEGORIES).toContain('Drilling');
        expect(TEST_CATEGORIES).toContain('General');
    });
});

describe('TEST_CATEGORY_LABELS', () => {
    it('has a label for every category', () => {
        for (const cat of TEST_CATEGORIES) {
            expect(TEST_CATEGORY_LABELS).toHaveProperty(cat);
            expect(TEST_CATEGORY_LABELS[cat].length).toBeGreaterThan(0);
        }
    });
});

// ── Test type counts ───────────────────────────────────────────────────────────

describe('test type arrays', () => {
    it('has 11 fracturing test types', () => {
        expect(FRACTURING_TEST_TYPES).toHaveLength(11);
    });

    it('has 17 drilling test types', () => {
        expect(DRILLING_TEST_TYPES).toHaveLength(17);
    });

    it('has 2 general test types', () => {
        expect(GENERAL_TEST_TYPES).toHaveLength(2);
    });

    it('total is 30 test types', () => {
        const total = FRACTURING_TEST_TYPES.length + DRILLING_TEST_TYPES.length + GENERAL_TEST_TYPES.length;
        expect(total).toBe(30);
    });

    it('no test type appears in more than one category', () => {
        const all = [...FRACTURING_TEST_TYPES, ...DRILLING_TEST_TYPES, ...GENERAL_TEST_TYPES];
        const unique = new Set(all);
        expect(unique.size).toBe(all.length);
    });
});

// ── TEST_TYPE_LABELS completeness ─────────────────────────────────────────────

describe('TEST_TYPE_LABELS', () => {
    it('has a Russian label for every test type', () => {
        const all = [...FRACTURING_TEST_TYPES, ...DRILLING_TEST_TYPES, ...GENERAL_TEST_TYPES];
        for (const t of all) {
            expect(TEST_TYPE_LABELS).toHaveProperty(t);
            expect(TEST_TYPE_LABELS[t].length).toBeGreaterThan(0);
        }
    });

    it('has exactly 30 entries', () => {
        expect(Object.keys(TEST_TYPE_LABELS)).toHaveLength(30);
    });
});

// ── TEST_TYPES_BY_CATEGORY ────────────────────────────────────────────────────

describe('TEST_TYPES_BY_CATEGORY', () => {
    it('maps Fracturing to FRACTURING_TEST_TYPES', () => {
        expect(TEST_TYPES_BY_CATEGORY['Fracturing']).toEqual(FRACTURING_TEST_TYPES);
    });

    it('maps Drilling to DRILLING_TEST_TYPES', () => {
        expect(TEST_TYPES_BY_CATEGORY['Drilling']).toEqual(DRILLING_TEST_TYPES);
    });

    it('maps General to GENERAL_TEST_TYPES', () => {
        expect(TEST_TYPES_BY_CATEGORY['General']).toEqual(GENERAL_TEST_TYPES);
    });
});

// ── isTestCategory() and isTestType() ─────────────────────────────────────────

describe('isTestCategory()', () => {
    it('returns true for valid categories', () => {
        for (const cat of TEST_CATEGORIES) {
            expect(isTestCategory(cat)).toBe(true);
        }
    });

    it('returns false for invalid strings', () => {
        expect(isTestCategory('')).toBe(false);
        expect(isTestCategory('fracturing')).toBe(false);  // case-sensitive
        expect(isTestCategory('Other')).toBe(false);
    });
});

describe('isTestType()', () => {
    it('returns true for all known test types', () => {
        const all = [...FRACTURING_TEST_TYPES, ...DRILLING_TEST_TYPES, ...GENERAL_TEST_TYPES];
        for (const t of all) {
            expect(isTestType(t)).toBe(true);
        }
    });

    it('returns false for unknown strings', () => {
        expect(isTestType('')).toBe(false);
        expect(isTestType('shearViscosity')).toBe(false);  // case-sensitive
        expect(isTestType('Flow Curve')).toBe(false);
    });
});

// ── getCategoryForTestType() ──────────────────────────────────────────────────

describe('getCategoryForTestType()', () => {
    it('returns Fracturing for fracturing types', () => {
        expect(getCategoryForTestType('ShearViscosity')).toBe('Fracturing');
        expect(getCategoryForTestType('Hydration')).toBe('Fracturing');
        expect(getCategoryForTestType('CrosslinkTest')).toBe('Fracturing');
        expect(getCategoryForTestType('ThermalStability')).toBe('Fracturing');
        expect(getCategoryForTestType('Biostability')).toBe('Fracturing');
    });

    it('returns Drilling for drilling types', () => {
        expect(getCategoryForTestType('MudRheology')).toBe('Drilling');
        expect(getCategoryForTestType('Filtration')).toBe('Drilling');
        expect(getCategoryForTestType('BariteSag')).toBe('Drilling');
        expect(getCategoryForTestType('ElectricalStability')).toBe('Drilling');
        expect(getCategoryForTestType('MBT')).toBe('Drilling');
    });

    it('returns General for general types', () => {
        expect(getCategoryForTestType('WaterAnalysis')).toBe('General');
        expect(getCategoryForTestType('Other')).toBe('General');
    });
});

// ── ALL_TEST_TYPE_OPTIONS ─────────────────────────────────────────────────────

describe('ALL_TEST_TYPE_OPTIONS', () => {
    it('contains 30 entries', () => {
        expect(ALL_TEST_TYPE_OPTIONS).toHaveLength(30);
    });

    it('each entry has value, label, and category fields', () => {
        for (const opt of ALL_TEST_TYPE_OPTIONS) {
            expect(opt).toHaveProperty('value');
            expect(opt).toHaveProperty('label');
            expect(opt).toHaveProperty('category');
        }
    });

    it('labels match TEST_TYPE_LABELS', () => {
        for (const opt of ALL_TEST_TYPE_OPTIONS) {
            expect(opt.label).toBe(TEST_TYPE_LABELS[opt.value]);
        }
    });

    it('categories are consistent with getCategoryForTestType', () => {
        for (const opt of ALL_TEST_TYPE_OPTIONS) {
            expect(opt.category).toBe(getCategoryForTestType(opt.value));
        }
    });

    it('no duplicate test type values', () => {
        const values = ALL_TEST_TYPE_OPTIONS.map(o => o.value);
        expect(new Set(values).size).toBe(values.length);
    });
});
