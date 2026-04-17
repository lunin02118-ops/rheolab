/**
 * Tauri Operators Commands
 */

import { safeInvoke as invoke } from './core';
import type {
    OperatorRecord,
    OperatorDeleteResponse,
    OperatorMutationResponse,
    OperatorUpsertPayload,
} from '@/types/tauri';

export const operators = {
    /** List all active operators ordered by name. */
    async list(): Promise<OperatorRecord[]> {
        return invoke<OperatorRecord[]>('operators_list');
    },

    /** Create a new operator. */
    async create(payload: OperatorUpsertPayload): Promise<OperatorMutationResponse> {
        return invoke<OperatorMutationResponse>('operators_create', { payload });
    },

    /** Update an existing operator. */
    async update(id: string, payload: OperatorUpsertPayload): Promise<OperatorMutationResponse> {
        return invoke<OperatorMutationResponse>('operators_update', { id, payload });
    },

    /** Soft-delete an operator (marks isActive = 0). */
    async delete(id: string): Promise<OperatorDeleteResponse> {
        return invoke<OperatorDeleteResponse>('operators_delete', { id });
    },
};
