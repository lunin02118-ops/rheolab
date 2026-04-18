/**
 * useSaveDialogInit
 *
 * Encapsulates all initialisation logic for SaveExperimentDialog:
 * form-field state, catalog fetching, smart-fill, prefill-from-dashboard,
 * filename-metadata parsing, and localStorage recent-reagents.
 *
 * Reduces the dialog component from 6 scattered useEffects to a single
 * declarative hook call, keeping the component focused on rendering.
 */
import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import type { WaterParams } from '@/types';
import { parseExperimentFilename } from '@/lib/utils/smart-fill-utils';
import { getLastExperimentContext } from '@/lib/experiments/client';
import { useCatalogStore } from '@/lib/store/catalog-store';
import type { ReagentRow, ReagentCatalogItem } from '@/components/experiment-form';
import type { FluidType } from '@/lib/constants/fluid-types';
import type { TestCategory, TestType } from '@/lib/constants/test-types';
import { detectFluidType } from '@/lib/utils/fluid-type-detector';
import { detectTestCategoryAndType } from '@/lib/utils/test-type-detector';
import { getBridge } from '@/lib/tauri/bridge';
import type { LaboratoryRecord, OperatorRecord } from '@/types/tauri';

function getInitialTestDate(analysisData: SaveDialogInitData): Date {
    return analysisData.testDate ? new Date(analysisData.testDate) : new Date();
}

/** Subset of analysisData that the hook actually needs. */
export interface SaveDialogInitData {
    filename: string;
    testDate?: Date;
    prefilledName?: string;
    prefilledFieldName?: string;
    prefilledOperatorName?: string;
    prefilledWellNumber?: string;
    prefilledWaterSource?: string;
    prefilledWaterParams?: Partial<WaterParams>;
    prefilledRecipe?: Array<{
        abbreviation: string;
        concentration: number;
        unit: string;
        reagentId?: string;
        reagentName?: string;
        batchNumber?: string;
        productionDate?: Date;
    }>;
    /** Passed from analysisData to seed initial fluid-type suggestion. */
    hintFluidType?: FluidType;
    /** Instrument type from parser — used in test-type detection heuristics. */
    hintInstrumentType?: string;
    /** Summary metrics from analysis — used in test-type detection heuristics. */
    hintMetrics?: {
        maxTemp?: number;
        duration?: number;
        maxViscosity?: number;
    };
}

export interface SaveDialogInitResult {
    // Form state
    name: string;
    setName: (v: string) => void;
    fieldName: string;
    setFieldName: (v: string) => void;
    operatorName: string;
    setOperatorName: (v: string) => void;
    wellNumber: string;
    setWellNumber: (v: string) => void;
    testDate: Date;
    setTestDate: (v: Date) => void;
    waterSource: string;
    setWaterSource: (v: string) => void;
    waterParams: WaterParams;
    setWaterParams: React.Dispatch<React.SetStateAction<WaterParams>>;
    reagents: ReagentRow[];
    setReagents: React.Dispatch<React.SetStateAction<ReagentRow[]>>;
    // Laboratory
    laboratoryId: string;
    setLaboratoryId: (v: string) => void;
    laboratoryCatalog: LaboratoryRecord[];
    operatorOptions: string[];
    // Classification (auto-detected, user-overridable)
    fluidType: FluidType;
    setFluidType: (v: FluidType) => void;
    fluidTypeUserSet: boolean;
    testCategory: TestCategory;
    setTestCategory: (v: TestCategory) => void;
    testType: TestType;
    setTestType: (v: TestType) => void;
    // UI
    isLoading: boolean;
    recentReagentIds: string[];
    // Catalog
    waterSources: string[];
    reagentCatalog: ReagentCatalogItem[];
    // Callbacks
    addToRecentReagents: (reagentId: string) => void;
    handleSmartFill: () => void;
}

export function useSaveDialogInit(
    isOpen: boolean,
    analysisData: SaveDialogInitData,
): SaveDialogInitResult {
    // ── Form state ──────────────────────────────────────────────────────────
    const [name, setName] = useState('');
    const [fieldName, setFieldName] = useState('');
    const [operatorName, setOperatorName] = useState('');
    const [wellNumber, setWellNumber] = useState('');
    const [testDate, setTestDate] = useState<Date>(() => getInitialTestDate(analysisData));
    const [waterSource, setWaterSource] = useState('');
    const [waterParams, setWaterParams] = useState<WaterParams>({
        ph: null, fe: null, ca: null, mg: null, cl: null, so4: null, hco3: null,
    });
    const [reagents, setReagents] = useState<ReagentRow[]>([]);
    // ── Laboratory / Operator state ───────────────────────────────────────
    const [laboratoryId, setLaboratoryId] = useState('');
    const [laboratoryCatalog, setLaboratoryCatalog] = useState<LaboratoryRecord[]>([]);
    const [operatorOptions, setOperatorOptions] = useState<string[]>([]);
    // ── Classification state ──────────────────────────────────────────────
    const [fluidType, setFluidTypeInner] = useState<FluidType>(analysisData.hintFluidType ?? 'Linear');
    const [fluidTypeUserSet, setFluidTypeUserSet] = useState(false);
    const [testCategory, setTestCategoryInner] = useState<TestCategory>('Fracturing');
    const [testType, setTestTypeInner] = useState<TestType>('ShearViscosity');

    const setFluidType = useCallback((v: FluidType) => {
        setFluidTypeInner(v);
        setFluidTypeUserSet(true);
    }, []);

    const setTestCategory = useCallback((v: TestCategory) => {
        setTestCategoryInner(v);
    }, []);

    const setTestType = useCallback((v: TestType) => {
        setTestTypeInner(v);
    }, []);
    // ── UI state ─────────────────────────────────────────────────────────────
    const [isLoading, setIsLoading] = useState(false);
    const [smartFillApplied, setSmartFillApplied] = useState(false);
    const [recentReagentIds, setRecentReagentIds] = useState<string[]>([]);

    // ── Catalog ───────────────────────────────────────────────────────────────
    const reagentCatalog = useCatalogStore(s => s.reagents) as ReagentCatalogItem[];
    const waterSources = useCatalogStore(s => s.waterSources);
    const fetchCatalogReagents = useCatalogStore(s => s.fetchReagents);
    const fetchCatalogWaterSources = useCatalogStore(s => s.fetchWaterSources);

    // ── Effect 0: Load operators and laboratories from bridge ──────────────────
    useEffect(() => {
        if (!isOpen) return;
        const bridge = getBridge();
        void Promise.all([
            bridge.operators.list().catch(() => [] as OperatorRecord[]),
            bridge.laboratories.list().catch(() => [] as LaboratoryRecord[]),
        ]).then(([ops, labs]) => {
            setOperatorOptions(ops.map((o: OperatorRecord) => o.name));
            setLaboratoryCatalog(labs);
        });
    }, [isOpen]);

    // ── Effect 1: Load recent reagents from localStorage ──────────────────────
    useEffect(() => {
        try {
            const stored = localStorage.getItem('rheolab-recent-reagents');
            if (stored) setRecentReagentIds(JSON.parse(stored));
        } catch (_e) { /* localStorage unavailable — start with empty recent list */ }
    }, []);

    // ── Effect 2: Load catalog (shared store deduplicates) ────────────────────
    useEffect(() => {
        void fetchCatalogReagents();
        void fetchCatalogWaterSources();
    }, [fetchCatalogReagents, fetchCatalogWaterSources]);

    // ── Effect 3: Smart Fill from last context ────────────────────────────────
    // Only carries over contextual metadata (field, operator) — NOT recipe or
    // waterSource, which are experiment-specific and must start fresh each time.
    useEffect(() => {
        if (!isOpen || smartFillApplied) return;
        setIsLoading(true);
        void getLastExperimentContext()
            .then((context) => {
                if (!context) return;
                // Carry over general context (does not depend on specific experiment)
                if (context.fieldName && !analysisData.prefilledFieldName)
                    setFieldName(context.fieldName);
                if (context.operatorName && !analysisData.prefilledOperatorName)
                    setOperatorName(context.operatorName);
                // NOTE: waterSource and reagents are intentionally NOT carried over.
                // Each new experiment must start with an empty recipe and water source.
                setSmartFillApplied(true);
            })
            .finally(() => setIsLoading(false));
    }, [isOpen, smartFillApplied, analysisData.prefilledFieldName, analysisData.prefilledOperatorName]);

    // ── Effect 4: Set default name/metadata from filename ─────────────────────
    useEffect(() => {
        if (!isOpen) return;
        setName(analysisData.filename.replace(/\.[^/.]+$/, ''));
        if (!fieldName && !wellNumber) {
            const meta = parseExperimentFilename(analysisData.filename);
            if (meta.fieldName) setFieldName(meta.fieldName);
            if (meta.wellNumber) setWellNumber(meta.wellNumber);
            if (meta.operatorName) setOperatorName(meta.operatorName);
            if (meta.testDate) setTestDate(meta.testDate);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only parse filename metadata on open, not when field values change
    }, [isOpen, analysisData.filename]);

    // ── Effect 5: Prefill from dashboard ──────────────────────────────────────
    useEffect(() => {
        if (!isOpen) return;
        if (analysisData.prefilledName) setName(analysisData.prefilledName);
        if (analysisData.prefilledFieldName) setFieldName(analysisData.prefilledFieldName);
        if (analysisData.prefilledOperatorName) setOperatorName(analysisData.prefilledOperatorName);
        if (analysisData.prefilledWellNumber) setWellNumber(analysisData.prefilledWellNumber);
        if (analysisData.prefilledWaterSource) setWaterSource(analysisData.prefilledWaterSource);
        if (analysisData.prefilledWaterParams)
            setWaterParams(prev => ({ ...prev, ...analysisData.prefilledWaterParams }));
        if (analysisData.prefilledRecipe?.length) {
            setReagents(analysisData.prefilledRecipe.map((r, i) => ({
                key: `prefill-${i}`,
                reagentId: r.reagentId || '',
                reagentName: r.reagentName || r.abbreviation,
                concentration: r.concentration,
                unit: r.unit as 'kg/m3' | 'gpt' | 'L/m3' | '%',
                batchNumber: r.batchNumber,
                productionDate: r.productionDate ? new Date(r.productionDate) : undefined,
            })));
        }
    }, [
        isOpen,
        analysisData.prefilledName,
        analysisData.prefilledFieldName,
        analysisData.prefilledOperatorName,
        analysisData.prefilledWellNumber,
        analysisData.prefilledWaterSource,
        analysisData.prefilledWaterParams,
        analysisData.prefilledRecipe,
    ]);

    // ── Effect 6: Reset all state on close ───────────────────────────────────
    // Clears every form field so the next dialog open starts completely fresh.
    // Effects 3-5 and 7-8 will re-populate from context / analysisData on open.
    useEffect(() => {
        if (!isOpen) {
            setSmartFillApplied(false);
            setFluidTypeUserSet(false);
            // Re-seed fluidType from hint when dialog re-opens
            setFluidTypeInner(analysisData.hintFluidType ?? 'Linear');
            // Reset all form fields so no data bleeds into the next session
            setName('');
            setFieldName('');
            setOperatorName('');
            setWellNumber('');
            setWaterSource('');
            setWaterParams({ ph: null, fe: null, ca: null, mg: null, cl: null, so4: null, hco3: null });
            setReagents([]);
            setTestDate(getInitialTestDate(analysisData));
            setTestCategoryInner('Fracturing');
            setTestTypeInner('ShearViscosity');
            setLaboratoryId('');
        }
    }, [isOpen, analysisData]);

    // ── Effect 7: Auto-detect FluidType from reagents ───────────────────────────
    // Runs whenever reagents change; skips if user has manually chosen a value.
    useEffect(() => {
        if (fluidTypeUserSet) return;
        if (!reagentCatalog.length) return;
        const detected = detectFluidType(reagents, reagentCatalog);
        setFluidTypeInner(detected);
    }, [reagents, reagentCatalog, fluidTypeUserSet]);

    // ── Effect 8: Derive TestCategory+TestType from FluidType + filename ───────────
    useEffect(() => {
        if (!isOpen) return;
        const cats = reagents
            .map(r => reagentCatalog.find(c => c.id === r.reagentId)?.category ?? '')
            .filter(Boolean);
        const result = detectTestCategoryAndType({
            fluidType,
            filename: analysisData.filename,
            instrumentType: analysisData.hintInstrumentType,
            maxTemp: analysisData.hintMetrics?.maxTemp,
            durationMin: analysisData.hintMetrics?.duration,
            reagentCategories: cats,
        });
        setTestCategoryInner(result.testCategory);
        setTestTypeInner(result.testType);
    }, [
        isOpen,
        fluidType,
        reagents,
        reagentCatalog,
        analysisData.filename,
        analysisData.hintInstrumentType,
        analysisData.hintMetrics?.duration,
        analysisData.hintMetrics?.maxTemp,
    ]);

    // ── Callbacks ─────────────────────────────────────────────────────────────
    const addToRecentReagents = useCallback((reagentId: string) => {
        if (!reagentId) return;
        setRecentReagentIds(prev => {
            const filtered = prev.filter(id => id !== reagentId);
            const updated = [reagentId, ...filtered].slice(0, 3);
            try {
                localStorage.setItem('rheolab-recent-reagents', JSON.stringify(updated));
            } catch (_e) { /* ignore */ }
            return updated;
        });
    }, []);

    const handleSmartFill = useCallback(() => {

        const meta = parseExperimentFilename(analysisData.filename);
        if (meta.fieldName) setFieldName(meta.fieldName);
        if (meta.wellNumber) setWellNumber(meta.wellNumber);
        if (meta.operatorName) setOperatorName(meta.operatorName);
        if (meta.testDate) setTestDate(meta.testDate);
    }, [analysisData.filename]);

    return {
        name, setName,
        fieldName, setFieldName,
        operatorName, setOperatorName,
        wellNumber, setWellNumber,
        testDate, setTestDate,
        waterSource, setWaterSource,
        waterParams, setWaterParams,
        reagents, setReagents,
        laboratoryId, setLaboratoryId,
        laboratoryCatalog,
        operatorOptions,
        fluidType, setFluidType, fluidTypeUserSet,
        testCategory, setTestCategory,
        testType, setTestType,
        isLoading,
        recentReagentIds,
        waterSources,
        reagentCatalog,
        addToRecentReagents,
        handleSmartFill,
    };
}
