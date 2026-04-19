/**
 * Tauri Experiments Commands
 *
 * Wraps experiments_* Tauri commands (CRUD, export, import) and the V2 data
 * flow commands (import batches, payloads, artifacts, search projections).
 */

import { safeInvoke as invoke } from './core';
import type {
  ExperimentDeleteResponse,
  ExperimentsExportToFileResponse,
  ExperimentGetResponse,
  ExperimentGetBatchResponse,
  ExperimentExistenceResponse,
  ExperimentsImportResponse,
  ExperimentsLaboratoriesResponse,
  ExperimentSavePayload as WireExperimentSavePayload,
  ExperimentSaveResponse,
  ExperimentsCountResponse,
  ExperimentsFilterMetadataResponse,
  ExperimentsListQuery,
  ExperimentsListResponse,
  LastContextResponse,
} from '@/types/tauri';
import type {
  ImportBatchItem,
  ExperimentPayloadItem,
  ParserArtifactItem,
  ReportArtifactItem,
} from '@/types/generated';

// ── Experiments CRUD & export/import ────────────────────────────────────────

export const experiments = {
  /**
   * List experiments with filters and pagination.
   */
  async list(query?: ExperimentsListQuery): Promise<ExperimentsListResponse> {
    return invoke<ExperimentsListResponse>('experiments_list', { query });
  },

  /**
   * Get experiments count.
   */
  async count(): Promise<ExperimentsCountResponse> {
    return invoke<ExperimentsCountResponse>('experiments_count');
  },

  /**
   * Get distinct/sorted filter metadata for library filters.
   */
  async filterMetadata(): Promise<ExperimentsFilterMetadataResponse> {
    return invoke<ExperimentsFilterMetadataResponse>('experiments_filter_metadata');
  },

  /**
   * Get a single experiment by id.
   */
  async get(id: string): Promise<ExperimentGetResponse> {
    return invoke<ExperimentGetResponse>('experiments_get', { id });
  },

  /**
   * Batch-load experiments by ids (3 SQL queries instead of 3×N).
   */
  async getBatch(ids: string[]): Promise<ExperimentGetBatchResponse> {
    return invoke<ExperimentGetBatchResponse>('experiments_get_batch', { ids });
  },

  /**
   * Lightweight existence check — returns only IDs that exist in DB.
   */
  async checkExistence(ids: string[]): Promise<ExperimentExistenceResponse> {
    return invoke<ExperimentExistenceResponse>('experiments_check_existence', { ids });
  },

  /**
   * Save or overwrite an experiment.
   * Accepts the wire-layer type (generated from Rust via Specta) — use
   * `toWirePayload()` from @/lib/experiments/payload to convert the app type.
   */
  async save(payload: WireExperimentSavePayload): Promise<ExperimentSaveResponse> {
    return invoke<ExperimentSaveResponse>('experiments_save', { payload });
  },

  /**
   * Delete experiment by id.
   */
  async delete(id: string): Promise<ExperimentDeleteResponse> {
    return invoke<ExperimentDeleteResponse>('experiments_delete', { id });
  },

  /**
   * Get last experiment context for Smart Fill.
   */
  async lastContext(): Promise<LastContextResponse> {
    return invoke<LastContextResponse>('experiments_last_context');
  },

  /**
   * List laboratories for export filter.
   */
  async exportLaboratories(): Promise<ExperimentsLaboratoriesResponse> {
    return invoke<ExperimentsLaboratoriesResponse>('experiments_export_laboratories');
  },

  /**
   * Stream-export experiments to a file in app_data_dir/exports/ (OOM-safe).
   * Returns filePath + fileName; caller reads the file via Tauri FS.
   */
  async exportToFile(laboratoryIds?: string[]): Promise<ExperimentsExportToFileResponse> {
    return invoke<ExperimentsExportToFileResponse>('experiments_export_to_file', {
      laboratoryIds: laboratoryIds ?? null,
    });
  },

  /**
   * Import experiments from transferable JSON payload.
   */
  async importData(experiments: unknown[]): Promise<ExperimentsImportResponse> {
    return invoke<ExperimentsImportResponse>('experiments_import', {
      experiments,
    });
  },
};

// ── V2 Data Flow Commands ────────────────────────────────────────────────────

export const importBatches = {
  async list(): Promise<ImportBatchItem[]> {
    return invoke<ImportBatchItem[]>('import_batches_list');
  },
  async get(id: string): Promise<{ success: boolean; batch?: ImportBatchItem; payloads?: ExperimentPayloadItem[]; error?: string }> {
    return invoke('import_batches_get', { id });
  },
};

export const experimentPayloads = {
  async list(experimentId: string): Promise<ExperimentPayloadItem[]> {
    return invoke<ExperimentPayloadItem[]>('experiment_payloads_list', { experimentId });
  },
};

export const parserArtifacts = {
  async list(experimentId: string): Promise<ParserArtifactItem[]> {
    return invoke<ParserArtifactItem[]>('parser_artifacts_list', { experimentId });
  },
  async get(id: string): Promise<{ success: boolean; artifact?: unknown; error?: string }> {
    return invoke('parser_artifacts_get', { id });
  },
};

export const reportArtifacts = {
  async list(experimentId: string): Promise<ReportArtifactItem[]> {
    return invoke<ReportArtifactItem[]>('report_artifacts_list', { experimentId });
  },
  async save(params: {
    experimentId: string;
    reportType: string;
    templateVersion?: string;
    settingsJson?: string;
    storagePath?: string;
    binarySha256?: string;
    sizeBytes?: number;
  }): Promise<{ success: boolean; id?: string }> {
    return invoke('report_artifacts_save', params);
  },
  async delete(id: string): Promise<{ success: boolean; error?: string }> {
    return invoke('report_artifacts_delete', { id });
  },
};

export const searchProjections = {
  async list(limit?: number): Promise<Record<string, unknown>> {
    return invoke<Record<string, unknown>>('search_projections_list', { limit });
  },
};
