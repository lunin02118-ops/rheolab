import type { ExperimentSavePayload, LastContext } from '@/types';
import { toWirePayload } from './payload';
import { getBridge } from '@/lib/tauri/bridge';
import { resetExperimentFilterMetadataCache } from './filter-metadata-cache';
import type {
  ExperimentDeleteResponse,
  ExperimentDetailMetaResponse,
  ExperimentsFilterMetadataResponse,
  ExperimentsExportToFileResponse,
  ExperimentGetResponse,
  ExperimentGetBatchResponse,
  ExperimentExistenceResponse,
  ExperimentsLaboratoriesResponse,
  ExperimentSaveResponse,
  ExperimentsCountResponse,
  ExperimentsListQuery,
  ExperimentsListResponse,
  LastContextResponse
} from '@/types/tauri';

/**
 * Unified experiments client for desktop/web.
 * Desktop uses Tauri commands, web/electron uses HTTP fallback via bridge.
 */
export async function listExperiments(query?: ExperimentsListQuery): Promise<ExperimentsListResponse> {
  return getBridge().experiments.list(query);
}

export async function getExperimentById(id: string): Promise<ExperimentGetResponse> {
  return getBridge().experiments.get(id);
}

export async function getExperimentDetailMetaById(id: string): Promise<ExperimentDetailMetaResponse> {
  return getBridge().experiments.detailMeta(id);
}

/**
 * Batch-load experiments by ids — 3 SQL queries instead of 3×N IPC round-trips.
 */
export async function getExperimentsByIds(ids: string[]): Promise<ExperimentGetBatchResponse> {
  return getBridge().experiments.getBatch(ids);
}

/**
 * Lightweight existence check — returns only the IDs that still exist in DB.
 */
export async function checkExperimentsExist(ids: string[]): Promise<ExperimentExistenceResponse> {
  return getBridge().experiments.checkExistence(ids);
}

export async function saveExperiment(payload: ExperimentSavePayload): Promise<ExperimentSaveResponse> {
  const result = await getBridge().experiments.save(toWirePayload(payload));
  // Mirror the Rust-side `invalidate_filter_metadata_cache`: a successful
  // save can introduce a brand-new distinct value (e.g. fluid type, water
  // source) that the sidebar must surface immediately.
  if (result.success) {
    resetExperimentFilterMetadataCache();
  }
  return result;
}

export async function deleteExperiment(id: string): Promise<ExperimentDeleteResponse> {
  const result = await getBridge().experiments.delete(id);
  // Symmetric to save: deleting the last experiment carrying a distinct
  // value should drop that value from the filter sidebar on the next
  // mount.  Guard on `success` so a no-op response ("not found") still
  // leaves the cache warm.
  if (result.success) {
    resetExperimentFilterMetadataCache();
  }
  return result;
}

export async function getExperimentsCount(): Promise<number> {
  const result: ExperimentsCountResponse = await getBridge().experiments.count();
  return result.count ?? 0;
}

export async function getExperimentFilterMetadata(): Promise<ExperimentsFilterMetadataResponse> {
  return getBridge().experiments.filterMetadata();
}

export async function getLastExperimentContext(): Promise<LastContext> {
  const result: LastContextResponse = await getBridge().experiments.lastContext();
  return {
    fieldName: result.fieldName,
    operatorName: result.operatorName,
    waterSource: result.waterSource,
    reagents: result.reagents.map((r) => ({
      reagentId: r.reagentId,
      reagentName: r.reagentName,
      concentration: r.concentration,
      unit: r.unit,
      batchNumber: r.batchNumber,
      productionDate: r.productionDate,
    })),
  };
}

export async function getExperimentExportLaboratories(): Promise<ExperimentsLaboratoriesResponse> {
  return getBridge().experiments.exportLaboratories();
}

export async function exportExperimentsToFile(laboratoryIds?: string[]): Promise<ExperimentsExportToFileResponse> {
  return getBridge().experiments.exportToFile(laboratoryIds);
}
