/**
 * Tauri Reagents & Water Sources Commands
 */

import { invoke } from './core';
import type {
  ReagentRecord,
  ReagentDeleteResponse,
  ReagentMutationResponse,
  ReagentsExportResponse,
  ReagentsImportResponse,
  ReagentUpsertPayload,
  WaterSourcesResponse,
} from '@/types/tauri';

export const reagents = {
  /**
   * List reagents catalog.
   */
  async list(): Promise<ReagentRecord[]> {
    return invoke<ReagentRecord[]>('reagents_list');
  },

  /**
   * Create a reagent.
   */
  async create(payload: ReagentUpsertPayload): Promise<ReagentMutationResponse> {
    return invoke<ReagentMutationResponse>('reagents_create', { payload });
  },

  /**
   * Update a reagent.
   */
  async update(id: string, payload: ReagentUpsertPayload): Promise<ReagentMutationResponse> {
    return invoke<ReagentMutationResponse>('reagents_update', { id, payload });
  },

  /**
   * Delete reagent by id.
   */
  async delete(id: string): Promise<ReagentDeleteResponse> {
    return invoke<ReagentDeleteResponse>('reagents_delete', { id });
  },

  /**
   * Export reagents catalog to transferable JSON payload.
   */
  async exportData(): Promise<ReagentsExportResponse> {
    return invoke<ReagentsExportResponse>('reagents_export');
  },

  /**
   * Import reagents from transferable JSON payload.
   */
  async importData(reagents: unknown[]): Promise<ReagentsImportResponse> {
    return invoke<ReagentsImportResponse>('reagents_import', { reagents });
  },

  /**
   * Seed default reagents catalog (idempotent).
   */
  async seed(): Promise<{ success: boolean; inserted: number }> {
    return invoke<{ success: boolean; inserted: number }>('reagents_seed');
  },
};

export const waterSources = {
  /**
   * List unique water source suggestions.
   */
  async list(): Promise<WaterSourcesResponse> {
    return invoke<WaterSourcesResponse>('experiments_water_sources');
  },
};
