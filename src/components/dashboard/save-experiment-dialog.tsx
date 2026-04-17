import { logger as clientLogger } from '@/lib/client-logger';

import React, { useState } from 'react';
import { useSaveDialogInit } from '@/hooks/useSaveDialogInit';
import type { ExperimentSavePayload, RheoPoint, WaterParams, FluidType, TestGroup, TestMetrics, CalibrationData, ColumnarData } from '@/types';
import { columnarToRawPoints } from '@/lib/utils/columnar';
import {
    ExperimentMetadataForm,
    WaterSourceSection,
    ReagentListEditor,
} from '../experiment-form';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter
} from '@/components/ui/dialog';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { FLUID_TYPES, FLUID_TYPE_LABELS } from '@/lib/constants/fluid-types';
import {
    TEST_CATEGORIES, TEST_CATEGORY_LABELS,
    TEST_TYPES_BY_CATEGORY, TEST_TYPE_LABELS,
} from '@/lib/constants/test-types';
import { ExperimentSavePayloadSchema } from '@/lib/validation/experiment-schemas';

interface SaveExperimentDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (payload: ExperimentSavePayload) => Promise<void>;
    analysisData: {
        filename: string;
        instrumentType: string;
        testDate: Date;
        fluidType: FluidType;
        testGroup: TestGroup;
        metrics: TestMetrics;
        /** Pre-expanded AoS — pass when already in memory. */
        rawPoints?: RheoPoint[];
        /** SoA alternative — converted lazily on submit to avoid holding two copies. */
        columnarData?: ColumnarData;
        calibration?: CalibrationData | null; // Added field
        geometry?: string;
        geometrySource?: string;
        testId?: string;
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
            category?: string;
            reagentId?: string;
            reagentName?: string;
            batchNumber?: string;
            productionDate?: Date;
        }>;
        // V8 metadata round-trip
        parsedBy?: string;
        parseSource?: string;
        timeRangeMin?: number;
        timeRangeMax?: number;
        viscosityMin?: number;
        pressureMax?: number;
        extraFields?: Record<string, unknown>;
    };
}

export function SaveExperimentDialog({
    isOpen,
    onClose,
    onSave,
    analysisData
}: SaveExperimentDialogProps) {
    // ── Initialisation: form state, catalogs, smart-fill, prefill ────────────
    const {
        name, setName,
        fieldName, setFieldName,
        operatorName, setOperatorName,
        wellNumber, setWellNumber,
        testDate, setTestDate,
        waterSource, setWaterSource,
        waterParams, setWaterParams,
        reagents, setReagents,
        isLoading,
        recentReagentIds,
        waterSources,
        reagentCatalog,
        addToRecentReagents,
        handleSmartFill,
        fluidType, setFluidType,
        fluidTypeUserSet,
        testCategory, setTestCategory,
        testType, setTestType,
        laboratoryId, setLaboratoryId,
        laboratoryCatalog,
        operatorOptions,
    } = useSaveDialogInit(isOpen, analysisData);

    // ── Submit state ──────────────────────────────────────────────────────────
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /** Drop or zero-out non-finite values so Zod schema passes. */
    const sanitizeRawPoints = (pts: RheoPoint[]): RheoPoint[] =>
        pts
            .filter(p => isFinite(p.time_sec) && isFinite(p.viscosity_cp) && isFinite(p.temperature_c))
            .map(p => ({
                ...p,
                shear_rate_s1: p.shear_rate_s1 !== undefined && isFinite(p.shear_rate_s1) ? p.shear_rate_s1 : undefined,
                shear_rate:    p.shear_rate    !== undefined && isFinite(p.shear_rate)    ? p.shear_rate    : undefined,
                shear_stress_pa: p.shear_stress_pa !== undefined && isFinite(p.shear_stress_pa) ? p.shear_stress_pa : undefined,
                speed_rpm:     p.speed_rpm     !== undefined && isFinite(p.speed_rpm)     ? p.speed_rpm     : undefined,
                pressure_bar:  p.pressure_bar  !== undefined && isFinite(p.pressure_bar)  ? p.pressure_bar  : undefined,
                ph:            p.ph            !== undefined && isFinite(p.ph)            ? p.ph            : undefined,
            }));

    // Handle save
    const handleSave = async () => {
        if (!name.trim()) { setError('Название теста обязательно'); return; }
        if (!waterSource.trim()) { setError('Источник воды обязателен'); return; }

        setError(null);
        setIsSaving(true);

        // Debug: log geometry data being saved
        clientLogger.info('[SaveDialog] Saving with geometry:', {
            geometry: analysisData.geometry,
            geometrySource: analysisData.geometrySource
        });

        try {
            const payload = {
                name: name.trim(),
                fieldName: fieldName.trim(),
                operatorName: operatorName.trim(),
                wellNumber: wellNumber.trim(),
                testId: analysisData.testId,
                originalFilename: analysisData.filename,
                testDate,
                instrumentType: analysisData.instrumentType,
                geometry: analysisData.geometry,
                geometrySource: analysisData.geometrySource,
                waterSource: waterSource.trim(),
                waterParams,
                fluidType: fluidType,
                // Derive legacy testGroup from testType for backward compat
                testGroup: (testType === 'Hydration' ? 'Hydration' : 'Rheology') as TestGroup,
                testCategory,
                testType,
                metrics: analysisData.metrics,
                laboratoryId: laboratoryId || undefined,
                // Lazy AoS conversion: if only SoA columnarData was passed (no pre-expanded
                // rawPoints), convert here — inside the save handler — so the intermediate
                // AoS array is never held in memory during normal rendering.
                // Sanitize: drop NaN/Infinite points so Zod finite() checks pass.
                rawPoints: sanitizeRawPoints(
                    analysisData.rawPoints
                    ?? (analysisData.columnarData ? columnarToRawPoints(analysisData.columnarData) : [])
                ),
                calibration: analysisData.calibration, // Pass calibration data
                // V8 metadata round-trip
                parsedBy: analysisData.parsedBy,
                parseSource: analysisData.parseSource,
                timeRangeMin: analysisData.timeRangeMin,
                timeRangeMax: analysisData.timeRangeMax,
                viscosityMin: analysisData.viscosityMin,
                pressureMax: analysisData.pressureMax,
                extraFields: analysisData.extraFields,
                reagents: reagents.filter(r => r.reagentId).map(r => ({
                    reagentId: r.reagentId,
                    reagentName: r.reagentName,
                    concentration: r.concentration,
                    unit: r.unit,
                    batchNumber: r.batchNumber,
                    productionDate: r.productionDate
                }))
            };

            // Zod schema validation — catches enum mismatches, structural
            // issues, and empty required fields before hitting the Rust backend.
            // .passthrough() preserves extra metadata fields not in schema.
            const validation = ExperimentSavePayloadSchema.passthrough().safeParse(payload);
            if (!validation.success) {
                const issue = validation.error.issues[0];
                const path = issue?.path?.join('.') ?? '';
                const base = issue?.message ?? 'Ошибка валидации';
                const msg = path ? `${base} (поле: ${path})` : base;
                clientLogger.warn('[SaveDialog] Payload failed Zod validation', validation.error.issues);
                setError(msg);
                setIsSaving(false);
                return;
            }

            await onSave(payload as ExperimentSavePayload);
            onClose();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Ошибка сохранения');
        } finally {
            setIsSaving(false);
        }
    };

    const isFormIncomplete = !name.trim() || !operatorName.trim() || !waterSource.trim();

    if (!isOpen) return null;

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent
                data-testid="SaveExperimentDialogWindow"
                className="max-w-3xl w-full max-h-[92vh] p-0 gap-0 bg-background border border-border text-foreground sm:rounded-2xl overflow-hidden flex flex-col shadow-2xl"
            >
                {/* ── Header ─────────────────────────────────────────── */}
                <DialogHeader className="flex-shrink-0 bg-card dark:bg-card border-b border-border">
                    <div className="flex items-center gap-3 px-6 py-5">
                        <div className="w-1 h-6 bg-cyan-500 rounded-full flex-shrink-0" />
                        <DialogTitle className="text-lg font-semibold text-foreground">
                            Сохранить эксперимент
                        </DialogTitle>
                    </div>
                </DialogHeader>

                {/* ── Scrollable body ─────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 bg-background">
                    {isLoading && (
                        <div className="text-center py-6">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500 mx-auto" />
                            <p className="text-muted-foreground mt-2 text-sm">Загрузка последнего контекста...</p>
                        </div>
                    )}

                    {error && (
                        <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/40 rounded-xl px-4 py-3 text-sm text-destructive">
                            <span className="mt-0.5 flex-shrink-0">⚠</span>
                            <span>{error}</span>
                        </div>
                    )}

                    <ExperimentMetadataForm
                        name={name} setName={setName}
                        fieldName={fieldName} setFieldName={setFieldName}
                        operatorName={operatorName} setOperatorName={setOperatorName}
                        operatorOptions={operatorOptions}
                        wellNumber={wellNumber} setWellNumber={setWellNumber}
                        testDate={testDate} setTestDate={setTestDate}
                        onSmartFill={handleSmartFill}
                        laboratoryId={laboratoryId}
                        setLaboratoryId={setLaboratoryId}
                        laboratoryOptions={laboratoryCatalog.map(l => ({ id: l.id, name: l.name }))}
                    />

                    <WaterSourceSection
                        waterSource={waterSource} setWaterSource={setWaterSource}
                        waterParams={waterParams} setWaterParams={setWaterParams}
                        waterSources={waterSources}
                    />

                    <ReagentListEditor
                        reagents={reagents} setReagents={setReagents}
                        reagentCatalog={reagentCatalog}
                        recentReagentIds={recentReagentIds}
                        onReagentSelect={addToRecentReagents}
                    />

                    {/* ── Analysis Info ─── */}
                    <div className="bg-card dark:bg-card rounded-xl border border-border overflow-hidden">
                        <div className="px-5 py-2.5 border-b border-border/50 bg-muted/30 dark:bg-secondary/40">
                            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                Информация об анализе
                            </h3>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                                <div className="flex gap-2">
                                    <span className="text-muted-foreground text-xs font-medium min-w-[40px]">Файл</span>
                                    <span className="text-foreground font-medium text-xs truncate">{analysisData.filename}</span>
                                </div>
                                <div className="flex gap-2">
                                    <span className="text-muted-foreground text-xs font-medium min-w-[44px]">Прибор</span>
                                    <span className="text-foreground font-medium text-xs truncate">{analysisData.instrumentType}</span>
                                </div>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                {/* Fluid type */}
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                                        Тип жидкости
                                        {!fluidTypeUserSet && <span className="text-[10px] opacity-60">(авто)</span>}
                                    </label>
                                    <Select value={fluidType} onValueChange={v => setFluidType(v as typeof FLUID_TYPES[number])}>
                                        <SelectTrigger data-testid="SaveDialogFluidTypeSelect" className="bg-background dark:bg-secondary/30 border-border text-foreground h-8 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {FLUID_TYPES.map(ft => (
                                                <SelectItem key={ft} value={ft} className="text-xs">
                                                    {FLUID_TYPE_LABELS[ft]}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                {/* Test category */}
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">Категория теста</label>
                                    <Select value={testCategory} onValueChange={v => setTestCategory(v as typeof TEST_CATEGORIES[number])}>
                                        <SelectTrigger data-testid="SaveDialogTestCategorySelect" className="bg-background dark:bg-secondary/30 border-border text-foreground h-8 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {TEST_CATEGORIES.map(cat => (
                                                <SelectItem key={cat} value={cat} className="text-xs">
                                                    {TEST_CATEGORY_LABELS[cat]}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                {/* Test type */}
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs font-medium text-muted-foreground">Тип испытания</label>
                                    <Select value={testType} onValueChange={v => setTestType(v as typeof testType)}>
                                        <SelectTrigger data-testid="SaveDialogTestTypeSelect" className="bg-background dark:bg-secondary/30 border-border text-foreground h-8 text-xs">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent className="max-h-56">
                                            {TEST_TYPES_BY_CATEGORY[testCategory].map(tt => (
                                                <SelectItem key={tt} value={tt} className="text-xs">
                                                    {TEST_TYPE_LABELS[tt]}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Footer ─────────────────────────────────────────── */}
                <DialogFooter className="flex-shrink-0 px-6 py-4 border-t border-border bg-card dark:bg-card sm:justify-between items-center gap-3">
                    {isFormIncomplete && !isSaving && (
                        <p className="text-xs text-muted-foreground hidden sm:block">
                            Заполните все обязательные поля <span className="text-destructive">*</span>
                        </p>
                    )}
                    {!isFormIncomplete && !isSaving && <span />}
                    <div className="flex gap-2 ml-auto">
                        <Button
                            variant="ghost"
                            onClick={onClose}
                            data-testid="SaveDialogCancelButton"
                            className="text-muted-foreground hover:text-foreground"
                        >
                            Отмена
                        </Button>
                        <Button
                            onClick={handleSave}
                            data-testid="SaveDialogSaveButton"
                            disabled={isSaving || isFormIncomplete}
                            className={isSaving || isFormIncomplete
                                ? 'bg-muted text-muted-foreground cursor-not-allowed hover:bg-muted'
                                : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                            }
                        >
                            {isSaving ? 'Сохранение...' : 'Сохранить'}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
