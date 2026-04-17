/**
 * Tests for src/lib/utils/fluid-type-detector.ts
 *
 * Covers all 9 FluidType detection paths and priority ordering.
 */
import { describe, it, expect } from 'vitest';
import { detectFluidType } from '@/lib/utils/fluid-type-detector';
import type { ReagentRow } from '@/components/experiment-form';
import type { ReagentCatalogItem } from '@/components/experiment-form';

// ── Fixture helpers ──────────────────────────────────────────────────────────

function makeRow(id: string, overrides: Partial<ReagentRow> = {}): ReagentRow {
    return {
        key: id,
        reagentId: id,
        reagentName: 'Unknown',
        concentration: 5,
        unit: 'kg/m3',
        ...overrides,
    };
}

function makeCatalogItem(id: string, name: string, category: string): ReagentCatalogItem {
    return { id, name, category };
}

// ── Constants ────────────────────────────────────────────────────────────────

const EMPTY_CATALOG: ReagentCatalogItem[] = [];

// ── Empty recipe ─────────────────────────────────────────────────────────────

describe('detectFluidType — empty recipe', () => {
    it('returns Linear when reagents array is empty', () => {
        expect(detectFluidType([], EMPTY_CATALOG)).toBe('Linear');
    });

    it('returns Linear when all reagentIds are falsy', () => {
        const rows = [makeRow('', { reagentId: '' })];
        expect(detectFluidType(rows, EMPTY_CATALOG)).toBe('Linear');
    });
});

// ── Priority 1: Crosslinked ───────────────────────────────────────────────────

describe('detectFluidType — Crosslinked (priority 1)', () => {
    it('detects Crosslinked when catalog category is "Crosslinker"', () => {
        const rows = [makeRow('r1'), makeRow('r2')];
        const catalog = [
            makeCatalogItem('r1', 'HPG', 'Gelling Agent'),
            makeCatalogItem('r2', 'Borate XL', 'Crosslinker'),
        ];
        expect(detectFluidType(rows, catalog)).toBe('Crosslinked');
    });

    it('Crosslinked beats Slickwater — crosslinker wins over friction reducer', () => {
        const rows = [makeRow('r1'), makeRow('r2'), makeRow('r3')];
        const catalog = [
            makeCatalogItem('r1', 'FR-1', 'Friction Reducer'),
            makeCatalogItem('r2', 'Borate', 'Crosslinker'),
            makeCatalogItem('r3', 'HPG', 'Gelling Agent'),
        ];
        expect(detectFluidType(rows, catalog)).toBe('Crosslinked');
    });
});

// ── Priority 2: Slickwater ───────────────────────────────────────────────────

describe('detectFluidType — Slickwater (priority 2)', () => {
    it('detects Slickwater for friction reducer without gelling agent', () => {
        const rows = [makeRow('r1'), makeRow('r2')];
        const catalog = [
            makeCatalogItem('r1', 'FR-125', 'Friction Reducer'),
            makeCatalogItem('r2', 'KCl', 'Clay Control'),
        ];
        expect(detectFluidType(rows, catalog)).toBe('Slickwater');
    });

    it('does NOT detect Slickwater when gelling agent is also present', () => {
        const rows = [makeRow('r1'), makeRow('r2')];
        const catalog = [
            makeCatalogItem('r1', 'FR-125', 'Friction Reducer'),
            makeCatalogItem('r2', 'Guar', 'Gelling Agent'),
        ];
        // Falls through to Linear (gelling agent present)
        expect(detectFluidType(rows, catalog)).toBe('Linear');
    });

    it('does NOT detect Slickwater when polymer is present alongside FR', () => {
        const rows = [makeRow('r1'), makeRow('r2')];
        const catalog = [
            makeCatalogItem('r1', 'FR-125', 'Friction Reducer'),
            makeCatalogItem('r2', 'CMHPG', 'Polymer'),
        ];
        expect(detectFluidType(rows, catalog)).toBe('Linear');
    });
});

// ── Priority 3: OBM ──────────────────────────────────────────────────────────

describe('detectFluidType — OBM (priority 3)', () => {
    it('detects OBM when category contains "obm"', () => {
        const rows = [makeRow('r1')];
        const catalog = [makeCatalogItem('r1', 'Diesel base', 'OBM Base')];
        expect(detectFluidType(rows, catalog)).toBe('OBM');
    });

    it('detects OBM from reagent name "diesel"', () => {
        const rows = [makeRow('r1', { reagentName: 'Diesel #2' })];
        // No match in catalog — name fallback used
        expect(detectFluidType(rows, [])).toBe('OBM');
    });

    it('detects OBM from name "base oil"', () => {
        const rows = [makeRow('r1', { reagentName: 'Synthetic Base Oil' })];
        expect(detectFluidType(rows, [])).toBe('OBM');
    });

    it('detects OBM from category "invert emulsion base"', () => {
        const rows = [makeRow('r1')];
        const catalog = [makeCatalogItem('r1', 'IE Base', 'Invert Emulsion Base')];
        expect(detectFluidType(rows, catalog)).toBe('OBM');
    });
});

// ── Priority 4: VES ──────────────────────────────────────────────────────────

describe('detectFluidType — VES (priority 4)', () => {
    it('detects VES from catalog category "VES"', () => {
        const rows = [makeRow('r1')];
        const catalog = [makeCatalogItem('r1', 'ClearFRAC VES', 'VES')];
        expect(detectFluidType(rows, catalog)).toBe('VES');
    });

    it('detects VES from category "viscoelastic surfactant"', () => {
        const rows = [makeRow('r1')];
        const catalog = [makeCatalogItem('r1', 'VE-Surf', 'Viscoelastic Surfactant')];
        expect(detectFluidType(rows, catalog)).toBe('VES');
    });

    it('detects VES from name containing "betaine"', () => {
        const rows = [makeRow('r1', { reagentName: 'Erucic Acid Betaine' })];
        expect(detectFluidType(rows, [])).toBe('VES');
    });
});

// ── Priority 5: Emulsion ─────────────────────────────────────────────────────

describe('detectFluidType — Emulsion (priority 5)', () => {
    it('detects Emulsion from category "emulsifier"', () => {
        const rows = [makeRow('r1')];
        const catalog = [makeCatalogItem('r1', 'EM-101', 'Emulsifier')];
        expect(detectFluidType(rows, catalog)).toBe('Emulsion');
    });

    it('detects Emulsion from name containing "emulsifier"', () => {
        const rows = [makeRow('r1', { reagentName: 'Primary Emulsifier EZ-MUL' })];
        expect(detectFluidType(rows, [])).toBe('Emulsion');
    });
});

// ── Priority 6: Foam ─────────────────────────────────────────────────────────

describe('detectFluidType — Foam (priority 6)', () => {
    it('detects Foam from category "foamer"', () => {
        const rows = [makeRow('r1')];
        const catalog = [makeCatalogItem('r1', 'FOME-AD', 'Foamer')];
        expect(detectFluidType(rows, catalog)).toBe('Foam');
    });

    it('detects Foam from category "foam stabiliser"', () => {
        const rows = [makeRow('r1')];
        const catalog = [makeCatalogItem('r1', 'FoamStab', 'Foam Stabiliser')];
        expect(detectFluidType(rows, catalog)).toBe('Foam');
    });

    it('detects Foam from name "foamer"', () => {
        const rows = [makeRow('r1', { reagentName: 'Alpha-Foamer 100' })];
        expect(detectFluidType(rows, [])).toBe('Foam');
    });
});

// ── Priority 7: WBM ──────────────────────────────────────────────────────────

describe('detectFluidType — WBM (priority 7)', () => {
    it('detects WBM from category "weighting agent"', () => {
        const rows = [makeRow('r1')];
        const catalog = [makeCatalogItem('r1', 'Barite API', 'Weighting Agent')];
        expect(detectFluidType(rows, catalog)).toBe('WBM');
    });

    it('detects WBM from category "barite"', () => {
        const rows = [makeRow('r1')];
        const catalog = [makeCatalogItem('r1', 'BaSO4', 'Barite')];
        expect(detectFluidType(rows, catalog)).toBe('WBM');
    });

    it('detects WBM from name "barite"', () => {
        const rows = [makeRow('r1', { reagentName: 'Barite 4.2 SG' })];
        expect(detectFluidType(rows, [])).toBe('WBM');
    });

    it('detects WBM from name "calcium carbonate"', () => {
        const rows = [makeRow('r1', { reagentName: 'Calcium Carbonate' })];
        expect(detectFluidType(rows, [])).toBe('WBM');
    });
});

// ── Priority 8: Linear ───────────────────────────────────────────────────────

describe('detectFluidType — Linear (priority 8 & default)', () => {
    it('detects Linear from category "gelling agent"', () => {
        const rows = [makeRow('r1')];
        const catalog = [makeCatalogItem('r1', 'Guar Gum', 'Gelling Agent')];
        expect(detectFluidType(rows, catalog)).toBe('Linear');
    });

    it('detects Linear from category "viscosifier"', () => {
        const rows = [makeRow('r1')];
        const catalog = [makeCatalogItem('r1', 'HEC', 'Viscosifier')];
        expect(detectFluidType(rows, catalog)).toBe('Linear');
    });

    it('detects Linear as default when no triggering category found', () => {
        const rows = [makeRow('r1')];
        const catalog = [makeCatalogItem('r1', 'Misc Additive', 'Buffer')];
        expect(detectFluidType(rows, catalog)).toBe('Linear');
    });

    it('detects Linear when reagentId does not match any catalog entry', () => {
        const rows = [makeRow('unknown-id')];
        const catalog = [makeCatalogItem('other-id', 'Something', 'Crosslinker')];
        // No catalog match → no category resolved → Linear
        expect(detectFluidType(rows, catalog)).toBe('Linear');
    });
});

// ── Catalog lookup vs. stored name fallback ───────────────────────────────────

describe('detectFluidType — catalog lookup vs stored name', () => {
    it('prefers catalog category over stored reagentName', () => {
        // Stored name says "foamer" but catalog says Crosslinker → Crosslinked wins (higher priority)
        const rows = [makeRow('r1', { reagentName: 'Foamer XYZ' })];
        const catalog = [makeCatalogItem('r1', 'Borate XL', 'Crosslinker')];
        expect(detectFluidType(rows, catalog)).toBe('Crosslinked');
    });

    it('uses stored reagentName when reagentId is not in catalog', () => {
        const rows = [makeRow('r1', { reagentName: 'Base Oil Premium' })];
        expect(detectFluidType(rows, [])).toBe('OBM');
    });
});
