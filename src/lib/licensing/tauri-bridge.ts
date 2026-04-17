/**
 * Licensing Tauri Bridge — V2 (minimal)
 *
 * Only low-level utility commands that the UI needs directly.
 * All licensing logic uses the V2 engine commands via the Zustand store.
 */

import { invoke } from '@tauri-apps/api/core';

// ─── Types ──────────────────────────────────────────────────────────

/** Mirrors Rust `SimpleResult` */
export interface SimpleResult {
    success: boolean;
    message?: string;
    error?: string;
    deletedCount?: number;
}

// ─── machine-id action ──────────────────────────────────────────────

export async function getServerMachineId(): Promise<string> {
    return invoke<string>('licensing_machine_id');
}

// ─── database actions ───────────────────────────────────────────────

export async function checkpointDatabase(): Promise<SimpleResult> {
    return invoke<SimpleResult>('licensing_checkpoint_db');
}
