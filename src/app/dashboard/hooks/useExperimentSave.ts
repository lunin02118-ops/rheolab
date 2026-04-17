/**
 * useExperimentSave Hook
 * 
 * Логика сохранения эксперимента с поддержкой перезаписи и toast уведомлений
 */

import { useState, useCallback } from 'react';
import type { ExperimentSavePayload } from '@/types';
import type { ParseResult } from '@/lib/store/experiment-data-store';
import { saveExperiment } from '@/lib/experiments/client';
import { useToast } from '@/hooks/useToast';

interface UseExperimentSaveOptions {
    parseResult: ParseResult | null;
    isDemo: boolean;
    canSaveExperiment: () => { allowed: boolean; message?: string };
    refreshExperimentsCount: () => void;
    setWaterSource: (source: string) => void;
    setWaterParams: (params: Record<string, unknown>) => void;
    setRecipe: (recipe: Array<{
        abbreviation: string;
        concentration: number;
        unit: string;
        reagentId?: string;
        reagentName?: string;
        batchNumber?: string;
        productionDate?: Date;
        category?: string;
    }>) => void;
    updateMetadata: (metadata: Record<string, unknown>) => void;
}

export function useExperimentSave({
    parseResult,
    isDemo,
    canSaveExperiment,
    refreshExperimentsCount,
    setWaterSource,
    setWaterParams,
    setRecipe,
    updateMetadata
}: UseExperimentSaveOptions) {
    const [isSaving, setIsSaving] = useState(false);
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [pendingOverwritePayload, setPendingOverwritePayload] = useState<ExperimentSavePayload | null>(null);
    const [pendingNameConflictPayload, setPendingNameConflictPayload] = useState<ExperimentSavePayload | null>(null);
    const { showToast } = useToast();

    const handleSave = useCallback(async (payload: ExperimentSavePayload) => {
        // Проверить лимит Demo перед сохранением
        if (!payload.overwrite) {
            const saveCheck = canSaveExperiment();
            if (!saveCheck.allowed) {
                showToast(saveCheck.message || 'Сохранение невозможно', 'error', 5000);
                return;
            }
        }

        setIsSaving(true);
        try {
            const result = await saveExperiment(payload);

            if (!result.success) {
                if (result.code === 'DUPLICATE_ENTRY') {
                    setPendingOverwritePayload(payload);
                    return;
                }
                if (result.code === 'NAME_CONFLICT') {
                    // Close save dialog and show name-conflict resolution prompt
                    setShowSaveDialog(false);
                    setPendingNameConflictPayload(payload);
                    return;
                }
                throw new Error(result.error || 'Ошибка сохранения');
            }

            setWaterSource(payload.waterSource);
            if (payload.waterParams) setWaterParams(payload.waterParams as unknown as Record<string, unknown>);
            if (payload.reagents && payload.reagents.length > 0) {
                setRecipe(payload.reagents.map(r => ({
                    abbreviation: r.reagentName || '',
                    concentration: r.concentration,
                    unit: r.unit,
                    reagentId: r.reagentId,
                    reagentName: r.reagentName,
                    batchNumber: r.batchNumber,
                    productionDate: r.productionDate,
                    category: r.category
                })));
            }

            // Update metadata with saved values
            updateMetadata({
                filenameMetadata: {
                    ...(parseResult?.metadata?.filenameMetadata || {}),
                    fieldName: payload.fieldName,
                    wellNumber: payload.wellNumber,
                    operatorName: payload.operatorName,
                    testId: payload.testId || payload.name,
                    waterSource: payload.waterSource
                }
            });

            setShowSaveDialog(false);
            setPendingOverwritePayload(null);
            setPendingNameConflictPayload(null);

            // Обновить счётчик экспериментов
            if (!payload.overwrite && isDemo) {
                refreshExperimentsCount();
            }

            showToast(
                payload.overwrite ? 'Эксперимент обновлён' : 'Эксперимент успешно сохранён',
                'success',
            );
        } catch (err) {
            // Tauri invoke rejects with a plain string (not an Error object).
            const message = err instanceof Error
                ? err.message
                : typeof err === 'string'
                    ? err
                    : 'Ошибка при сохранении';
            showToast(message, 'error');
        } finally {
            setIsSaving(false);
        }
    }, [parseResult, isDemo, canSaveExperiment, refreshExperimentsCount, setWaterSource, setWaterParams, setRecipe, updateMetadata, showToast]);

    const confirmOverwrite = useCallback(() => {
        if (pendingOverwritePayload) {
            handleSave({ ...pendingOverwritePayload, overwrite: true });
        }
    }, [pendingOverwritePayload, handleSave]);

    const cancelOverwrite = useCallback(() => {
        setPendingOverwritePayload(null);
        setIsSaving(false);
    }, []);

    /** User chose to overwrite the name-conflicting experiment. */
    const confirmNameOverwrite = useCallback(() => {
        if (pendingNameConflictPayload) {
            handleSave({ ...pendingNameConflictPayload, overwrite: true });
        }
    }, [pendingNameConflictPayload, handleSave]);

    /** User chose to rename — re-open the save dialog with the payload pre-filled. */
    const cancelNameConflict = useCallback(() => {
        if (pendingNameConflictPayload) {
            setShowSaveDialog(true);
        }
        setPendingNameConflictPayload(null);
    }, [pendingNameConflictPayload]);

    return {
        isSaving,
        showSaveDialog,
        setShowSaveDialog,
        pendingOverwritePayload,
        pendingNameConflictPayload,
        handleSave,
        confirmOverwrite,
        cancelOverwrite,
        confirmNameOverwrite,
        cancelNameConflict,
    };
}
