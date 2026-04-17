/**
 * Tauri Sync Commands
 *
 * Wraps sync_* and conflicts_* Tauri commands: outbox/inbox management,
 * conflict resolution, and the P3 delta-sync engine.
 */

import { invoke } from './core';
import type {
  SyncExportDeltaResult,
  SyncImportDeltaResult,
  SyncResolveConflictResult,
  SyncConflict,
} from '@/types/tauri';
import type {
  SyncStatusResponse,
  SyncOutboxItem,
  SyncInboxItem,
  ConflictItem,
} from '@/types/generated';

export const sync = {
  async status(): Promise<SyncStatusResponse> {
    return invoke<SyncStatusResponse>('sync_status');
  },
  async outboxList(statusFilter?: string): Promise<SyncOutboxItem[]> {
    return invoke<SyncOutboxItem[]>('sync_outbox_list', { statusFilter });
  },
  async outboxMarkSynced(ids: string[]): Promise<{ success: boolean; marked: number }> {
    return invoke('sync_outbox_mark_synced', { ids });
  },
  async outboxRetry(ids: string[]): Promise<{ success: boolean; retried: number }> {
    return invoke('sync_outbox_retry', { ids });
  },
  async inboxReceive(events: Array<Record<string, unknown>>): Promise<{ success: boolean; received: number; duplicates: number }> {
    return invoke('sync_inbox_receive', { events });
  },
  async inboxList(statusFilter?: string): Promise<SyncInboxItem[]> {
    return invoke<SyncInboxItem[]>('sync_inbox_list', { statusFilter });
  },
};

export const conflicts = {
  async list(statusFilter?: string): Promise<ConflictItem[]> {
    return invoke<ConflictItem[]>('conflicts_list', { statusFilter });
  },
  async resolve(conflictId: string, resolution: string): Promise<{ success: boolean; error?: string }> {
    return invoke('conflicts_resolve', { conflictId, resolution });
  },
};

// ── P3 Delta-Sync Engine ─────────────────────────────────────────────────────

export const syncEngine = {
  /**
   * Export all experiments modified since `sinceTimestamp` (RFC-3339) to a
   * JSON delta file under `<app_data_dir>/sync/`.
   *
   * Returns the path to the written file so the UI can surface it to the user
   * (e.g. "copy to USB" / "share via file picker").
   */
  async exportDelta(sinceTimestamp: string): Promise<SyncExportDeltaResult> {
    return invoke<SyncExportDeltaResult>('sync_export_delta', { sinceTimestamp });
  },

  /**
   * Import a delta file produced by `exportDelta`.
   *
   * Safe rows are committed immediately; conflicting experiments create
   * `ConflictRecord` rows returned in `conflicts`.  Call `resolveConflict`
   * for each conflict before the import is considered complete.
   */
  async importDelta(filePath: string): Promise<SyncImportDeltaResult> {
    return invoke<SyncImportDeltaResult>('sync_import_delta', { filePath });
  },

  /**
   * Resolve a conflict created during `importDelta`.
   *
   * @param conflictId - ID of the `ConflictRecord` row.
   * @param resolution - One of `keep_local` | `keep_remote` | `keep_both`.
   */
  async resolveConflict(
    conflictId: string,
    resolution: 'keep_local' | 'keep_remote' | 'keep_both',
  ): Promise<SyncResolveConflictResult> {
    return invoke<SyncResolveConflictResult>('sync_resolve_conflict', { conflictId, resolution });
  },

  /**
   * List all open (unresolved) delta-sync conflicts.
   */
  async listConflicts(): Promise<{ success: boolean; conflicts: SyncConflict[] }> {
    return invoke<{ success: boolean; conflicts: SyncConflict[] }>('sync_list_conflicts');
  },
};
