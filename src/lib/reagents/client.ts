import { getBridge } from '@/lib/tauri/bridge';
import type {
  ReagentDeleteResponse,
  ReagentMutationResponse,
  ReagentRecord,
  ReagentsExportResponse,
  ReagentsImportResponse,
  ReagentUpsertPayload,
} from '@/types/tauri';

/**
 * Unified reagents client for desktop/web.
 * Desktop uses Tauri commands, web/electron uses HTTP fallback via bridge.
 */
export async function listReagents(): Promise<ReagentRecord[]> {
  return getBridge().reagents.list();
}

export async function createReagent(payload: ReagentUpsertPayload): Promise<ReagentMutationResponse> {
  return getBridge().reagents.create(payload);
}

export async function updateReagent(id: string, payload: ReagentUpsertPayload): Promise<ReagentMutationResponse> {
  return getBridge().reagents.update(id, payload);
}

export async function deleteReagent(id: string): Promise<ReagentDeleteResponse> {
  return getBridge().reagents.delete(id);
}

export async function exportReagents(): Promise<ReagentsExportResponse> {
  return getBridge().reagents.exportData();
}

export async function importReagents(reagents: unknown[]): Promise<ReagentsImportResponse> {
  return getBridge().reagents.importData(reagents);
}
