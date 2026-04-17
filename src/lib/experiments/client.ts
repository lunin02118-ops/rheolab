import type { ExperimentSavePayload, LastContext } from '@/types';
import { toWirePayload } from './payload';
import { getBridge } from '@/lib/tauri/bridge';
import type {
  ExperimentDeleteResponse,
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
  return getBridge().experiments.save(toWirePayload(payload));
}

export async function deleteExperiment(id: string): Promise<ExperimentDeleteResponse> {
  return getBridge().experiments.delete(id);
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
