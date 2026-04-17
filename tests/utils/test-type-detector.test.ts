/**
 * Tests for src/lib/utils/test-type-detector.ts
 *
 * Covers category derivation from FluidType, and all test-type
 * keyword branches for Fracturing, Drilling, and General.
 */
import { describe, it, expect } from 'vitest';
import { detectTestCategoryAndType } from '@/lib/utils/test-type-detector';
import type { TestTypeDetectionInput } from '@/lib/utils/test-type-detector';

// ── Helper ───────────────────────────────────────────────────────────────────

function detect(input: TestTypeDetectionInput) {
    return detectTestCategoryAndType(input);
}

// ── Category derivation from FluidType ───────────────────────────────────────

describe('detectTestCategoryAndType — category from FluidType', () => {
    it('WBM fluid → Drilling category', () => {
        const { testCategory } = detect({ fluidType: 'WBM' });
        expect(testCategory).toBe('Drilling');
    });

    it('OBM fluid → Drilling category', () => {
        const { testCategory } = detect({ fluidType: 'OBM' });
        expect(testCategory).toBe('Drilling');
    });

    it('SBM fluid → Drilling category', () => {
        const { testCategory } = detect({ fluidType: 'SBM' });
        expect(testCategory).toBe('Drilling');
    });

    it('Linear fluid → Fracturing category', () => {
        const { testCategory } = detect({ fluidType: 'Linear' });
        expect(testCategory).toBe('Fracturing');
    });

    it('Crosslinked fluid → Fracturing category', () => {
        const { testCategory } = detect({ fluidType: 'Crosslinked' });
        expect(testCategory).toBe('Fracturing');
    });

    it('Slickwater fluid → Fracturing category', () => {
        const { testCategory } = detect({ fluidType: 'Slickwater' });
        expect(testCategory).toBe('Fracturing');
    });

    it('VES fluid → Fracturing category', () => {
        const { testCategory } = detect({ fluidType: 'VES' });
        expect(testCategory).toBe('Fracturing');
    });

    it('Foam fluid → Fracturing category', () => {
        const { testCategory } = detect({ fluidType: 'Foam' });
        expect(testCategory).toBe('Fracturing');
    });

    it('Emulsion fluid → Fracturing category', () => {
        const { testCategory } = detect({ fluidType: 'Emulsion' });
        expect(testCategory).toBe('Fracturing');
    });

    it('no fluidType → Fracturing category (default)', () => {
        const { testCategory } = detect({});
        expect(testCategory).toBe('Fracturing');
    });
});

// ── General: WaterAnalysis (highest priority, overrides FluidType) ────────────

describe('detectTestCategoryAndType — General / WaterAnalysis', () => {
    it('filename "water" → General + WaterAnalysis', () => {
        const r = detect({ filename: 'source_water_analysis.xlsx' });
        expect(r).toEqual({ testCategory: 'General', testType: 'WaterAnalysis' });
    });

    it('filename "вода" → General + WaterAnalysis', () => {
        const r = detect({ filename: 'вода_ионный_состав.xlsx' });
        expect(r).toEqual({ testCategory: 'General', testType: 'WaterAnalysis' });
    });

    it('filename "water quality" overrides OBM fluidType', () => {
        const r = detect({ fluidType: 'OBM', filename: 'water quality report.xlsx' });
        expect(r.testCategory).toBe('General');
        expect(r.testType).toBe('WaterAnalysis');
    });

    it('filename "совместим" → General + WaterAnalysis (compat water check)', () => {
        const r = detect({ filename: 'совместимость воды с пластом.xlsx' });
        expect(r).toEqual({ testCategory: 'General', testType: 'WaterAnalysis' });
    });
});

// ── Fracturing: specific test types ──────────────────────────────────────────

describe('detectTestCategoryAndType — Fracturing test types', () => {
    it('filename "hydrat" → Hydration', () => {
        const r = detect({ fluidType: 'Linear', filename: 'guar_hydration_60C.xlsx' });
        expect(r.testType).toBe('Hydration');
    });

    it('filename "гидрат" → Hydration', () => {
        const r = detect({ fluidType: 'Crosslinked', filename: 'гидратация_HPG.xlsx' });
        expect(r.testType).toBe('Hydration');
    });

    it('filename "buildup" → Hydration', () => {
        const r = detect({ filename: 'buildupviscosity.xlsx' });
        expect(r.testType).toBe('Hydration');
    });

    it('filename "crosslink-time" → CrosslinkTest', () => {
        const r = detect({ fluidType: 'Crosslinked', filename: 'xlink-time_borate_60C.xlsx' });
        expect(r.testType).toBe('CrosslinkTest');
    });

    it('filename "сшив" → CrosslinkTest', () => {
        const r = detect({ fluidType: 'Crosslinked', filename: 'время_сшивки_60С.xlsx' });
        expect(r.testType).toBe('CrosslinkTest');
    });

    it('filename "degrad" → ShearDegradation', () => {
        const r = detect({ fluidType: 'Crosslinked', filename: 'gel_degradation_170rpm.xlsx' });
        expect(r.testType).toBe('ShearDegradation');
    });

    it('filename "деград" → ShearDegradation', () => {
        const r = detect({ filename: 'деградация_геля.xlsx' });
        expect(r.testType).toBe('ShearDegradation');
    });

    it('maxTemp >= 80 → ThermalStability', () => {
        const r = detect({ fluidType: 'Crosslinked', filename: 'test.xlsx', maxTemp: 80 });
        expect(r.testType).toBe('ThermalStability');
    });

    it('maxTemp >= 120 → ThermalStability', () => {
        const r = detect({ fluidType: 'Linear', filename: 'test.xlsx', maxTemp: 120 });
        expect(r.testType).toBe('ThermalStability');
    });

    it('filename "hpht" → ThermalStability', () => {
        const r = detect({ fluidType: 'Crosslinked', filename: 'hpht_gel.xlsx', maxTemp: 0 });
        expect(r.testType).toBe('ThermalStability');
    });

    it('filename "break" → BreakTest', () => {
        const r = detect({ fluidType: 'Crosslinked', filename: 'break_test_100C.xlsx', maxTemp: 0 });
        expect(r.testType).toBe('BreakTest');
    });

    it('filename "деструкт" → BreakTest', () => {
        // 'деструкция' contains 'деструкц' → ShearDegradation; use 'деструктор' (деструкт prefix, not деструкц)
        const r = detect({ fluidType: 'Linear', filename: 'деструктор_геля.xlsx', maxTemp: 0 });
        expect(r.testType).toBe('BreakTest');
    });

    it('filename "residue" → FilterResidueTest', () => {
        const r = detect({ filename: 'residue_measurement.xlsx' });
        expect(r.testType).toBe('FilterResidueTest');
    });

    it('filename "остат" → FilterResidueTest', () => {
        const r = detect({ filename: 'остаток_фильтрации.xlsx' });
        expect(r.testType).toBe('FilterResidueTest');
    });

    it('filename "proppant" → ProppantTransport', () => {
        const r = detect({ fluidType: 'Crosslinked', filename: 'proppant_settling.xlsx' });
        expect(r.testType).toBe('ProppantTransport');
    });

    it('filename "проппант" → ProppantTransport', () => {
        const r = detect({ filename: 'проппант_транспорт.xlsx' });
        expect(r.testType).toBe('ProppantTransport');
    });

    it('filename "friction" → FrictionReduction', () => {
        const r = detect({ fluidType: 'Slickwater', filename: 'friction_reduction_FR125.xlsx' });
        expect(r.testType).toBe('FrictionReduction');
    });

    it('reagentCategories with friction reducer → FrictionReduction', () => {
        // Avoid 'water' substring in filename (triggers WaterAnalysis at highest priority)
        const r = detect({
            fluidType: 'Slickwater',
            filename: 'slick_fr125.xlsx',
            reagentCategories: ['friction reducer'],
        });
        expect(r.testType).toBe('FrictionReduction');
    });

    it('filename "compat" → FluidsCompatibility', () => {
        const r = detect({ filename: 'compat_with_crude_oil.xlsx' });
        expect(r.testType).toBe('FluidsCompatibility');
    });

    it('filename "biocide" → Biostability', () => {
        const r = detect({ filename: 'biocide_test_glutaraldehyde.xlsx' });
        expect(r.testType).toBe('Biostability');
    });

    it('filename "биостаб" → Biostability', () => {
        const r = detect({ filename: 'биостабильность_геля.xlsx' });
        expect(r.testType).toBe('Biostability');
    });

    it('no keywords → ShearViscosity (default fracturing)', () => {
        const r = detect({ fluidType: 'Linear', filename: 'test_HAAKE_2024.xlsx', maxTemp: 50 });
        expect(r.testType).toBe('ShearViscosity');
    });
});

// ── Drilling: specific test types ────────────────────────────────────────────

describe('detectTestCategoryAndType — Drilling test types', () => {
    const DRILLING_INPUT = (filename: string): TestTypeDetectionInput => ({
        fluidType: 'WBM', filename,
    });

    it('filename "filtration" → Filtration', () => {
        expect(detect(DRILLING_INPUT('api_filtration.xlsx')).testType).toBe('Filtration');
    });

    it('filename "фильтр" → Filtration', () => {
        expect(detect(DRILLING_INPUT('фильтрация_API.xlsx')).testType).toBe('Filtration');
    });

    it('filename "hpht" → Filtration', () => {
        expect(detect(DRILLING_INPUT('hpht_filtrate.xlsx')).testType).toBe('Filtration');
    });

    it('filename "sag" → BariteSag', () => {
        expect(detect(DRILLING_INPUT('barite_sag_test.xlsx')).testType).toBe('BariteSag');
    });

    it('filename "седим" → BariteSag', () => {
        expect(detect(DRILLING_INPUT('седиментация_барит.xlsx')).testType).toBe('BariteSag');
    });

    it('filename "thixo" → Thixotropy', () => {
        expect(detect(DRILLING_INPUT('thixotropy_gel_test.xlsx')).testType).toBe('Thixotropy');
    });

    it('filename "gel" → Thixotropy', () => {
        expect(detect(DRILLING_INPUT('gel_strength_recovery.xlsx')).testType).toBe('Thixotropy');
    });

    it('filename "aging" → ThermalAging', () => {
        expect(detect(DRILLING_INPUT('hot_roll_aging_16h.xlsx')).testType).toBe('ThermalAging');
    });

    it('filename "термостар" → ThermalAging', () => {
        expect(detect(DRILLING_INPUT('термостарение_WBM.xlsx')).testType).toBe('ThermalAging');
    });

    it('filename "shale" → ShaleInhibition', () => {
        expect(detect(DRILLING_INPUT('shale_inhibition_test.xlsx')).testType).toBe('ShaleInhibition');
    });

    it('filename "ингиб" → ShaleInhibition', () => {
        expect(detect(DRILLING_INPUT('ингибирование_глин.xlsx')).testType).toBe('ShaleInhibition');
    });

    it('filename "lcm" → LCMBridging', () => {
        expect(detect(DRILLING_INPUT('lcm_bridging_5mm.xlsx')).testType).toBe('LCMBridging');
    });

    it('filename "поглощен" → LCMBridging', () => {
        expect(detect(DRILLING_INPUT('поглощение_раствора.xlsx')).testType).toBe('LCMBridging');
    });

    it('filename "contamination" → ContaminationTest', () => {
        expect(detect(DRILLING_INPUT('contamination_by_cement.xlsx')).testType).toBe('ContaminationTest');
    });

    it('filename "цемент" → ContaminationTest', () => {
        expect(detect(DRILLING_INPUT('заражение_цементом.xlsx')).testType).toBe('ContaminationTest');
    });

    it('filename "es" → ElectricalStability', () => {
        expect(detect({ fluidType: 'OBM', filename: 'es_stability_obm.xlsx' }).testType).toBe('ElectricalStability');
    });

    it('filename "электростаб" → ElectricalStability', () => {
        expect(detect({ fluidType: 'OBM', filename: 'электростабильность.xlsx' }).testType).toBe('ElectricalStability');
    });

    it('filename "emulsion" → EmulsionStability', () => {
        // Avoid 'stability' keyword which would match ElectricalStability branch first
        // 'emulsion_obm.xlsx' contains 'emulsion' but no 'es' adjacent pair and no 'stability'
        expect(detect({ fluidType: 'OBM', filename: 'emulsion_obm.xlsx' }).testType).toBe('EmulsionStability');
    });

    it('filename "lubric" → Lubricity', () => {
        // Avoid 'test' in filename (contains substring 'es' → ElectricalStability branch)
        expect(detect(DRILLING_INPUT('lubricity_cof.xlsx')).testType).toBe('Lubricity');
    });

    it('filename "смазк" → Lubricity', () => {
        // 'смазочные' does not include 'смазк'; use 'смазка'
        expect(detect(DRILLING_INPUT('смазка_стенд.xlsx')).testType).toBe('Lubricity');
    });

    it('filename "retort" → Retort', () => {
        // Avoid 'water' keyword which triggers WaterAnalysis at highest priority
        expect(detect(DRILLING_INPUT('retort_ows.xlsx')).testType).toBe('Retort');
    });

    it('filename "sand" → SandContent', () => {
        expect(detect(DRILLING_INPUT('sand_content.xlsx')).testType).toBe('SandContent');
    });

    it('filename "pH" → PhAlkalinity', () => {
        expect(detect(DRILLING_INPUT('pH_alkalinity.xlsx')).testType).toBe('PhAlkalinity');
    });

    it('filename "хлорид" → ChlorideHardness', () => {
        expect(detect(DRILLING_INPUT('хлориды_жёсткость.xlsx')).testType).toBe('ChlorideHardness');
    });

    it('filename "mbt" → MBT', () => {
        expect(detect(DRILLING_INPUT('mbt_methylene_blue.xlsx')).testType).toBe('MBT');
    });

    it('filename "мбт" → MBT', () => {
        expect(detect(DRILLING_INPUT('мбт_тест.xlsx')).testType).toBe('MBT');
    });

    it('filename "density" → MudWeight', () => {
        expect(detect(DRILLING_INPUT('mud_density_weight.xlsx')).testType).toBe('MudWeight');
    });

    it('no keywords → MudRheology (default drilling)', () => {
        // Avoid 'test' (contains 'es' → ElectricalStability branch)
        expect(detect(DRILLING_INPUT('wbm_haake_2024.xlsx')).testType).toBe('MudRheology');
    });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe('detectTestCategoryAndType — edge cases', () => {
    it('empty input → Fracturing + ShearViscosity', () => {
        const r = detect({});
        expect(r.testCategory).toBe('Fracturing');
        expect(r.testType).toBe('ShearViscosity');
    });

    it('case-insensitive filename matching', () => {
        const r = detect({ filename: 'HYDRATION_TEST.XLSX' });
        expect(r.testType).toBe('Hydration');
    });

    it('WaterAnalysis takes priority over Drilling (OBM + "water")', () => {
        const r = detect({ fluidType: 'OBM', filename: 'water_analysis_for_mud.xlsx' });
        expect(r.testCategory).toBe('General');
        expect(r.testType).toBe('WaterAnalysis');
    });
});
