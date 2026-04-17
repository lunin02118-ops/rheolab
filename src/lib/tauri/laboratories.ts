/**
 * Tauri Laboratories Commands
 */

import { safeInvoke as invoke } from './core';
import type {
    LaboratoryRecord,
    LaboratoryDeleteResponse,
    LaboratoryMutationResponse,
    LaboratoryUpsertPayload,
} from '@/types/tauri';

export const laboratories = {
    /** List all laboratories ordered by name. */
    async list(): Promise<LaboratoryRecord[]> {
        return invoke<LaboratoryRecord[]>('laboratories_list');
    },

    /** Create a new laboratory. */
    async create(payload: LaboratoryUpsertPayload): Promise<LaboratoryMutationResponse> {
        return invoke<LaboratoryMutationResponse>('laboratories_create', { payload });
    },

    /** Update an existing laboratory. */
    async update(id: string, payload: LaboratoryUpsertPayload): Promise<LaboratoryMutationResponse> {
        return invoke<LaboratoryMutationResponse>('laboratories_update', { id, payload });
    },

    /**
     * Delete a laboratory.
     * Returns an error if any experiments reference this laboratory.
     */
    async delete(id: string): Promise<LaboratoryDeleteResponse> {
        return invoke<LaboratoryDeleteResponse>('laboratories_delete', { id });
    },
};
