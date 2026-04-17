/**
 * useReagentActions
 *
 * Manages all CRUD state and handlers for the reagents catalog:
 *   - modal open/close + which reagent is being edited
 *   - delete confirmation dialog
 *   - detail drawer
 *   - create / update / delete async operations
 *
 * Extracted from ReagentsManager to keep the component focused on rendering.
 */

import { useState } from 'react';
import {
    createReagent,
    deleteReagent,
    updateReagent,
} from '@/lib/reagents/client';
import type { Reagent } from './reagent-detail-drawer';

export interface UseReagentActionsParams {
    invalidateReagents: () => void;
    fetchReagents: () => Promise<void> | void;
}

export interface UseReagentActionsResult {
    // — modal state —
    isModalOpen: boolean;
    editingReagent: Reagent | null;
    setIsModalOpen: (open: boolean) => void;
    // — delete confirm state —
    deleteConfirm: string | null;
    setDeleteConfirm: (id: string | null) => void;
    // — detail drawer state —
    detailReagent: Reagent | null;
    setDetailReagent: (reagent: Reagent | null) => void;
    // — error state —
    error: string | null;
    setError: (err: string | null) => void;
    // — handlers —
    handleOpenAdd: () => void;
    handleOpenEdit: (reagent: Reagent) => void;
    handleOpenDetail: (reagent: Reagent) => void;
    handleDelete: (id: string) => Promise<void>;
    handleSave: (data: Partial<Reagent>) => Promise<void>;
}

export function useReagentActions({
    invalidateReagents,
    fetchReagents,
}: UseReagentActionsParams): UseReagentActionsResult {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingReagent, setEditingReagent] = useState<Reagent | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [detailReagent, setDetailReagent] = useState<Reagent | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleOpenAdd = () => {
        setEditingReagent(null);
        setIsModalOpen(true);
        setError(null);
    };

    const handleOpenEdit = (reagent: Reagent) => {
        setEditingReagent(reagent);
        setIsModalOpen(true);
        setError(null);
    };

    const handleOpenDetail = (reagent: Reagent) => {
        setDetailReagent(reagent);
    };

    const handleDelete = async (id: string) => {
        try {
            const result = await deleteReagent(id);
            if (result.success) {
                invalidateReagents();
                fetchReagents();
                setDeleteConfirm(null);
            } else {
                setError(result.error || 'Ошибка удаления');
            }
        } catch (_e) {
            setError('Ошибка связи');
        }
    };

    const handleSave = async (data: Partial<Reagent>) => {
        try {
            const payload = {
                name: (data.name || '').trim(),
                category: (data.category || '').trim(),
                manufacturer: data.manufacturer || null,
                country: data.country || null,
                description: data.description || null,
                activeSubstance: data.activeSubstance || null,
                form: data.form || null,
            };

            if (!payload.name || !payload.category) {
                setError('Название и категория обязательны');
                return;
            }

            const result = editingReagent
                ? await updateReagent(editingReagent.id, payload)
                : await createReagent(payload);

            if (result.success) {
                invalidateReagents();
                await fetchReagents();
                setIsModalOpen(false);
                setError(null);
            } else {
                setError(result.error || 'Ошибка сохранения');
            }
        } catch (_e) {
            setError('Ошибка связи');
        }
    };

    return {
        isModalOpen,
        editingReagent,
        setIsModalOpen,
        deleteConfirm,
        setDeleteConfirm,
        detailReagent,
        setDetailReagent,
        error,
        setError,
        handleOpenAdd,
        handleOpenEdit,
        handleOpenDetail,
        handleDelete,
        handleSave,
    };
}
