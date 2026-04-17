/**
 * update-store.ts
 * Zustand store for the auto-update lifecycle.
 *
 * Status transitions:
 *   idle → checking → available → downloading → ready → (relaunch)
 *                              ↘ dismissed (user skipped)
 *                              ↘ error
 */

import { create } from 'zustand';

/** Payload of the `startup_completed` Tauri event (mirrors MigrationResult in Rust). */
export interface StartupCompletedPayload {
    schemaVersion: number;
    wasFreshInstall: boolean;
    appVersion: string;
    previousAppVersion: string | null;
    versionChanged: boolean;
}

export type UpdateStatus =
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'error';

interface UpdateStore {
    status: UpdateStatus;
    /** Available update version, e.g. "0.1.490" */
    version: string | null;
    /** Release notes extracted from the update manifest */
    notes: string | null;
    /** Download progress 0–100 */
    downloadProgress: number;
    /** Error message for status === 'error' */
    error: string | null;
    /**
     * Set when the app detects it ran for the first time after an update
     * (previousVersion ≠ currentVersion in schema_meta).
     * Cleared when the user dismisses the post-update banner.
     */
    postUpdate: { previousVersion: string; currentVersion: string } | null;

    // ── Actions ───────────────────────────────────────────────────────────────────
    startCheck: () => void;
    setAvailable: (version: string, notes: string | null) => void;
    setDownloading: (progress: number) => void;
    setReady: () => void;
    setError: (err: string) => void;
    dismiss: () => void;
    reset: () => void;
    setPostUpdate: (previousVersion: string, currentVersion: string) => void;
    dismissPostUpdate: () => void;
}

export const useUpdateStore = create<UpdateStore>((set) => ({
    status: 'idle',
    version: null,
    notes: null,
    downloadProgress: 0,
    error: null,
    postUpdate: null,

    startCheck: () => set({ status: 'checking' }),

    setAvailable: (version, notes) => set({
        status: 'available',
        version,
        notes,
        downloadProgress: 0,
        error: null,
    }),

    setDownloading: (progress) => set({
        status: 'downloading',
        downloadProgress: progress,
    }),

    setReady: () => set({
        status: 'ready',
        downloadProgress: 100,
    }),

    setError: (err) => set({
        status: 'error',
        error: err,
    }),

    dismiss: () => set({
        status: 'idle',
        version: null,
        notes: null,
        downloadProgress: 0,
        error: null,
    }),

    reset: () => set({
        status: 'idle',
        version: null,
        notes: null,
        downloadProgress: 0,
        error: null,
    }),

    setPostUpdate: (previousVersion, currentVersion) => set({
        postUpdate: { previousVersion, currentVersion },
    }),

    dismissPostUpdate: () => set({ postUpdate: null }),
}));
