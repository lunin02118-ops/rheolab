/**
 * Tauri Backup Commands
 *
 * Wraps backup_* Tauri commands: list, create, restore, delete, open-folder.
 */

import { safeInvoke as invoke } from './core';
import type { BackupInfo, BackupResult } from '@/types/tauri';
import { seriesWindowCache } from '@/lib/series/series-window-cache';

export const backup = {
  /**
   * List all local backups
   */
  async list(): Promise<BackupInfo[]> {
    return invoke<BackupInfo[]>('backup_list');
  },

  /**
   * Create a new backup
   */
  async create(): Promise<BackupResult> {
    return invoke<BackupResult>('backup_create');
  },

  /**
   * Restore from a backup (will restart the app)
   */
  async restore(filename: string): Promise<BackupResult> {
    const result = await invoke<BackupResult>('backup_restore', { filename });
    if (result.success) {
      seriesWindowCache.clear();
    }
    return result;
  },

  /**
   * Delete a backup
   */
  async delete(filename: string): Promise<BackupResult> {
    return invoke<BackupResult>('backup_delete', { filename });
  },

  /**
   * Open the backups folder in file manager
   */
  async openFolder(): Promise<void> {
    return invoke<void>('backup_open_folder');
  },
};
