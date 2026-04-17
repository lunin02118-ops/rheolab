/**
 * Test category and test type taxonomy, derived from
 * LAB_TESTS_DRILLING_AND_FRACTURING_FLUIDS.md.
 *
 * Two-level hierarchy:
 *   TestCategory  — top-level grouping (Fracturing / Drilling / General)
 *   TestType      — specific test within a category
 */

// ── Categories ──────────────────────────────────────────────────────────────

export const TEST_CATEGORIES = ['Fracturing', 'Drilling', 'General'] as const;
export type TestCategory = (typeof TEST_CATEGORIES)[number];

export const TEST_CATEGORY_LABELS: Record<TestCategory, string> = {
    Fracturing: 'ГРП',
    Drilling:   'Бурение',
    General:    'Общее',
};

// ── Types per category ───────────────────────────────────────────────────────

export const FRACTURING_TEST_TYPES = [
    'ShearViscosity',      // 1.1  η(γ̇) flow curve
    'Hydration',           // 1.2  viscosity build-up vs time
    'CrosslinkTest',       // 1.3  crosslink time / window
    'ShearDegradation',    // 1.4  high-shear + recovery
    'ThermalStability',    // 1.5  η(T) under temperature profile
    'BreakTest',           // 1.6  breaker profile / time-to-break
    'FilterResidueTest',   // 1.7  residue & filterability after break
    'ProppantTransport',   // 1.8  settling / suspension stability
    'FrictionReduction',   // 1.9  %DR vs flow rate (slickwater)
    'FluidsCompatibility', // 1.10 compatibility with reservoir fluids
    'Biostability',        // 1.11 biocide effectiveness
] as const;

export const DRILLING_TEST_TYPES = [
    'MudWeight',           // 2.1  density
    'MudRheology',         // 2.2  Fann 35/50 PV/YP / Herschel-Bulkley
    'Thixotropy',          // 2.3  structure recovery cycles
    'Filtration',          // 2.4  API / HPHT filtrate & filter cake
    'SandContent',         // 2.5  abrasive solids
    'Retort',              // 2.6  oil/water/solids %
    'PhAlkalinity',        // 2.7  pH, alkalinity, lime
    'ChlorideHardness',    // 2.8  Cl⁻, Ca, Mg
    'MBT',                 // 2.9  Methylene Blue Test / clay activity
    'ElectricalStability', // 2.10 ES for OBM
    'EmulsionStability',   // 2.11 OBM emulsion tests
    'Lubricity',           // 2.12 lubricity / coefficient of friction
    'BariteSag',           // 2.13 static/dynamic sag test
    'ThermalAging',        // 2.14 hot rolling / aging
    'ShaleInhibition',     // 2.15 hot roll / swell / dispersion
    'ContaminationTest',   // 2.16 CaCl₂/cement/anhydrite challenge
    'LCMBridging',         // 2.17 PPA / slot test
] as const;

export const GENERAL_TEST_TYPES = [
    'WaterAnalysis',       // 0.1  ion analysis, compatibility jar test
    'Other',               //      catch-all
] as const;

// Union of all test types
export type FracturingTestType = (typeof FRACTURING_TEST_TYPES)[number];
export type DrillingTestType   = (typeof DRILLING_TEST_TYPES)[number];
export type GeneralTestType    = (typeof GENERAL_TEST_TYPES)[number];
export type TestType = FracturingTestType | DrillingTestType | GeneralTestType;

// ── Labels ───────────────────────────────────────────────────────────────────

export const TEST_TYPE_LABELS: Record<TestType, string> = {
    // Fracturing
    ShearViscosity:      'Реология η(γ̇)',
    Hydration:           'Кинетика гидратации',
    CrosslinkTest:       'Тест на сшивку',
    ShearDegradation:    'Сдвиговая деградация',
    ThermalStability:    'Температурная стабильность',
    BreakTest:           'Профиль разрушения',
    FilterResidueTest:   'Остаток и фильтруемость',
    ProppantTransport:   'Транспорт проппанта',
    FrictionReduction:   'Снижение трения (FR)',
    FluidsCompatibility: 'Совместимость с пластовыми флюидами',
    Biostability:        'Биостабильность',
    // Drilling
    MudWeight:           'Плотность бурового раствора',
    MudRheology:         'Реология (Fann PV/YP)',
    Thixotropy:          'Тиксотропия / восстановление структуры',
    Filtration:          'Фильтрация (API/HPHT)',
    SandContent:         'Содержание песка',
    Retort:              'Retort (нефть/вода/ТФ)',
    PhAlkalinity:        'pH и щёлочность',
    ChlorideHardness:    'Хлориды и жёсткость',
    MBT:                 'МБТ / активность глины',
    ElectricalStability: 'Электростабильность (ES)',
    EmulsionStability:   'Устойчивость эмульсии (OBM)',
    Lubricity:           'Смазочные свойства',
    BariteSag:           'Седиментация (bariteсаг)',
    ThermalAging:        'Термостарение / hot rolling',
    ShaleInhibition:     'Ингибирование сланцев',
    ContaminationTest:   'Совместимость с загрязнениями',
    LCMBridging:         'LCM / bridging (PPA)',
    // General
    WaterAnalysis:       'Анализ воды / совместимость',
    Other:               'Другой тест',
};

// ── Category → types map ─────────────────────────────────────────────────────

export const TEST_TYPES_BY_CATEGORY: Record<TestCategory, readonly TestType[]> = {
    Fracturing: FRACTURING_TEST_TYPES,
    Drilling:   DRILLING_TEST_TYPES,
    General:    GENERAL_TEST_TYPES,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export function isTestCategory(value: string): value is TestCategory {
    return (TEST_CATEGORIES as readonly string[]).includes(value);
}

export function isTestType(value: string): value is TestType {
    return value in TEST_TYPE_LABELS;
}

/** Return the category that owns a given TestType, or undefined. */
export function getCategoryForTestType(t: TestType): TestCategory | undefined {
    for (const [cat, types] of Object.entries(TEST_TYPES_BY_CATEGORY)) {
        if ((types as readonly string[]).includes(t)) return cat as TestCategory;
    }
    return undefined;
}

/** Flat list of { value, label, category } for select/combobox usage. */
export const ALL_TEST_TYPE_OPTIONS: Array<{ value: TestType; label: string; category: TestCategory }> =
    (Object.entries(TEST_TYPES_BY_CATEGORY) as [TestCategory, readonly TestType[]][]).flatMap(
        ([cat, types]) => types.map(t => ({ value: t, label: TEST_TYPE_LABELS[t], category: cat }))
    );
