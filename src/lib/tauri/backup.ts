/**
 * Tauri Backup Commands
 *
 * Wraps backup_* Tauri commands: list, create, restore, delete, open-folder.
 */

import { safeInvoke as invoke } from './core';
import type { BackupInfo, BackupResult } from '@/types/tauri';

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
    return invoke<BackupResult>('backup_restore', { filename });
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
