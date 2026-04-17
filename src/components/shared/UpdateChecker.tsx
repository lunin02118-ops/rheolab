/**
 * UpdateChecker.tsx
 *
 * Invisible component that silently polls for updates in the background.
 * - On mount: waits 30 s, then calls the Tauri updater endpoint.
 * - If an update is found: stores it for later installation and notifies the
 *   update-store so UpdateBanner can show the prompt.
 * - On error (network down, server unreachable, etc.): fails silently.
 * - Repeats the check every 4 hours while the app is open.
 *
 * Installation is triggered by `startUpdateInstall()` (called by UpdateBanner).
 */

import { useEffect, useRef } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { logger as clientLogger } from '@/lib/client-logger';
import { isTauri } from '@/lib/tauri';
import { useUpdateStore, type StartupCompletedPayload } from '@/lib/store/update-store';
import { backup } from '@/lib/tauri/backup';

// Delay before first check after app startup (ms)
const INITIAL_DELAY_MS = 30_000;
// Interval between subsequent checks (ms)
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Returns the update channel and a verifiable HMAC token from the cached license. */
async function getUpdateChannelInfo(): Promise<{ channel: string; token: string | null }> {
    try {
        return await invoke<{ channel: string; token: string | null }>('get_update_channel');
    } catch {
        return { channel: 'stable', token: null };
    }
}

/** Builds request headers forwarded to the update server. */
function buildUpdateHeaders(info: { channel: string; token: string | null }): Record<string, string> {
    const headers: Record<string, string> = { 'X-Update-Channel': info.channel };
    if (info.token) headers['X-Update-Token'] = info.token;
    return headers;
}

// Module-level reference to the pending Update object.
// Kept outside React state because it contains non-serialisable callbacks.
let _pendingUpdate: Update | null = null;

/**
 * Trigger download + install of the pending update.
 * Call this when the user confirms installation (e.g. from UpdateBanner).
 */
export async function startUpdateInstall(): Promise<void> {
    if (!_pendingUpdate) return;

    const store = useUpdateStore.getState();
    store.setDownloading(0);

    // Create a pre-update backup so the user can roll back if the new version
    // causes data-loss or crashes.  Non-fatal: a backup failure must not block
    // the update — log a warning and continue.
    try {
        const backupResult = await backup.create();
        clientLogger.info(`[UpdateChecker] Pre-update backup created: ${backupResult.name ?? '(no name)'}`);
    } catch (backupErr) {
        const msg = backupErr instanceof Error ? backupErr.message : String(backupErr);
        clientLogger.warn(`[UpdateChecker] Pre-update backup failed (non-fatal): ${msg}`);
    }

    let downloaded = 0;
    let totalBytes = 0;

    try {
        await _pendingUpdate.downloadAndInstall((event) => {
            if (event.event === 'Started') {
                totalBytes = event.data.contentLength ?? 0;
            } else if (event.event === 'Progress') {
                downloaded += event.data.chunkLength;
                const pct = totalBytes > 0
                    ? Math.min(99, Math.round((downloaded / totalBytes) * 100))
                    : 0;
                store.setDownloading(pct);
            } else if (event.event === 'Finished') {
                store.setReady();
            }
        });

        // If downloadAndInstall resolves without 'Finished' event (edge-case):
        store.setReady();
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        clientLogger.error(`[UpdateChecker] Install failed: ${msg}`);
        store.setError(`Ошибка установки: ${msg}`);
    }
}

/**
 * Trigger an immediate update check (called from Settings → О программе).
 * Safe to call at any time — no-ops if already checking/installing.
 */
export async function checkUpdateNow(): Promise<void> {
    const store = useUpdateStore.getState();
    if (
        store.status === 'checking' ||
        store.status === 'downloading' ||
        store.status === 'ready'
    ) return;
    // Reset stale error so we can retry
    if (store.status === 'error') store.reset();

    try {
        store.startCheck();
        const info = await getUpdateChannelInfo();
        const update = await check({ headers: buildUpdateHeaders(info) });
        if (update?.available) {
            _pendingUpdate = update;
            const notes = update.body?.trim() ?? null;
            store.setAvailable(update.version, notes);
            clientLogger.info(`[UpdateChecker] Manual check — update available: v${update.version}`);
        } else {
            store.reset();
            clientLogger.info('[UpdateChecker] Manual check — up to date');
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Surface the error so the user sees it instead of a misleading
        // "up to date" message.  The background auto-check still resets
        // silently (offline is expected), but manual checks should be honest.
        store.setError(`Не удалось проверить: ${msg}`);
        clientLogger.error(`[UpdateChecker] Manual check failed: ${msg}`);
    }
}

/**
 * Trigger app relaunch after update installation.
 * Call this when the user clicks "Restart" in UpdateBanner.
 */
export async function relaunchApp(): Promise<void> {
    try {
        await relaunch();
    } catch (err) {
        clientLogger.error(`[UpdateChecker] Relaunch failed: ${String(err)}`);
    }
}

export function UpdateChecker(): null {
    const hasStarted = useRef(false);

    useEffect(() => {
        // Only run inside the actual Tauri desktop app, not in browser/tests.
        if (!isTauri() || hasStarted.current) return;
        hasStarted.current = true;

        // Subscribe to the startup_completed event emitted by lib.rs ~500 ms
        // after launch.  When version_changed is true the user has just run
        // the app for the first time after an update — show recovery banner.
        let unlistenStartup: (() => void) | undefined;
        listen<StartupCompletedPayload>('startup_completed', ({ payload }) => {
            if (payload.versionChanged && payload.previousAppVersion) {
                useUpdateStore.getState().setPostUpdate(
                    payload.previousAppVersion,
                    payload.appVersion,
                );
                clientLogger.info(
                    `[UpdateChecker] Post-update first run: ${payload.previousAppVersion} → ${payload.appVersion}`,
                );
            }
        }).then((unlisten) => {
            unlistenStartup = unlisten;
        }).catch((err) => {
            clientLogger.warn(`[UpdateChecker] Failed to register startup_completed listener: ${String(err)}`);
        });

        let intervalId: ReturnType<typeof setInterval> | null = null;

        async function runCheck(): Promise<void> {
            const store = useUpdateStore.getState();
            // Skip if an update is already pending or being installed.
            if (store.status !== 'idle') return;

            try {
                store.startCheck();
                const info = await getUpdateChannelInfo();
                const update = await check({ headers: buildUpdateHeaders(info) });

                if (update?.available) {
                    _pendingUpdate = update;
                    const notes = update.body?.trim() ?? null;
                    store.setAvailable(update.version, notes);
                    clientLogger.info(
                        `[UpdateChecker] Update available: v${update.version}`,
                    );
                } else {
                    store.reset();
                }
            } catch (err) {
                // Network / server errors are expected when offline — reset quietly.
                store.reset();
                clientLogger.error(
                    `[UpdateChecker] Background check failed: ${String(err)}`,
                );
            }
        }

        const initialTimer = setTimeout(() => {
            runCheck();
            intervalId = setInterval(runCheck, CHECK_INTERVAL_MS);
        }, INITIAL_DELAY_MS);

        return () => {
            clearTimeout(initialTimer);
            if (intervalId !== null) clearInterval(intervalId);
            unlistenStartup?.();
        };
    }, []);

    return null;
}
