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
import { check } from '@tauri-apps/plugin-updater';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { logger } from '@/lib/logger';
import { isTauri } from '@/lib/tauri';
import { useUpdateStore, type StartupCompletedPayload } from '@/lib/store/update-store';
import { setPendingUpdate } from './update-install';

// Re-export the install/relaunch helpers so existing callers that imported
// them from `./UpdateChecker` continue to work — but prefer the lazy
// `./update-install` path when you are about to add a new call site.
export { startUpdateInstall, relaunchApp } from './update-install';

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
            setPendingUpdate(update);
            const notes = update.body?.trim() ?? null;
            store.setAvailable(update.version, notes);
            logger.info(`[UpdateChecker] Manual check — update available: v${update.version}`);
        } else {
            store.reset();
            logger.info('[UpdateChecker] Manual check — up to date');
        }
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Surface the error so the user sees it instead of a misleading
        // "up to date" message.  The background auto-check still resets
        // silently (offline is expected), but manual checks should be honest.
        store.setError(`Не удалось проверить: ${msg}`);
        logger.error(`[UpdateChecker] Manual check failed: ${msg}`);
    }
}

export function UpdateChecker(): null {
    const hasStarted = useRef(false);
    const isE2ERef = useRef(false);

    useEffect(() => {
        // Only run inside the actual Tauri desktop app, not in browser/tests.
        if (!isTauri() || hasStarted.current) return;
        hasStarted.current = true;

        let unlistenStartup: (() => void) | undefined;
        let initialTimer: ReturnType<typeof setTimeout> | null = null;
        let intervalId: ReturnType<typeof setInterval> | null = null;
        let cancelled = false;

        async function runCheck(): Promise<void> {
            // Hard stop in E2E — avoid any network / WebView navigation side-effects.
            if (isE2ERef.current) return;
            const store = useUpdateStore.getState();
            // Skip if an update is already pending or being installed.
            if (store.status !== 'idle') return;

            try {
                store.startCheck();
                const info = await getUpdateChannelInfo();
                const update = await check({ headers: buildUpdateHeaders(info) });

                if (update?.available) {
                    setPendingUpdate(update);
                    const notes = update.body?.trim() ?? null;
                    store.setAvailable(update.version, notes);
                    logger.info(
                        `[UpdateChecker] Update available: v${update.version}`,
                    );
                } else {
                    store.reset();
                }
            } catch (err) {
                // Network / server errors are expected when offline — reset quietly.
                store.reset();
                logger.error(
                    `[UpdateChecker] Background check failed: ${String(err)}`,
                );
            }
        }

        // Resolve E2E flag first so we can skip side-effects entirely in tests.
        // Then register the startup_completed listener and schedule the timer.
        (async () => {
            // Suppress the auto-updater entirely in E2E test environments.
            // The updater can trigger a WebView2 navigation to `edge://downloads/hub`
            // mid-run, which breaks CDP-based Playwright fixtures. The Rust
            // backend flags E2E mode via `RHEOLAB_E2E_SKIP_LICENSE_GATE=1`.
            try {
                isE2ERef.current = await invoke<boolean>('is_e2e_mode');
            } catch {
                isE2ERef.current = false;
            }
            if (cancelled) return;

            if (isE2ERef.current) {
                logger.info('[UpdateChecker] E2E mode detected — auto-updater disabled');
                // Still register the startup_completed listener: tests may assert on it.
            }

            // Subscribe to the startup_completed event emitted by lib.rs ~500 ms
            // after launch.  When version_changed is true the user has just run
            // the app for the first time after an update — show recovery banner.
            try {
                const unlisten = await listen<StartupCompletedPayload>('startup_completed', ({ payload }) => {
                    if (payload.versionChanged && payload.previousAppVersion) {
                        useUpdateStore.getState().setPostUpdate(
                            payload.previousAppVersion,
                            payload.appVersion,
                        );
                        logger.info(
                            `[UpdateChecker] Post-update first run: ${payload.previousAppVersion} → ${payload.appVersion}`,
                        );
                    }
                });
                if (cancelled) { unlisten(); return; }
                unlistenStartup = unlisten;
            } catch (err) {
                logger.warn(`[UpdateChecker] Failed to register startup_completed listener: ${String(err)}`);
            }

            // In E2E mode stop here — no background timer.
            if (isE2ERef.current) return;

            initialTimer = setTimeout(() => {
                void runCheck();
                intervalId = setInterval(runCheck, CHECK_INTERVAL_MS);
            }, INITIAL_DELAY_MS);
        })();

        return () => {
            cancelled = true;
            if (initialTimer !== null) clearTimeout(initialTimer);
            if (intervalId !== null) clearInterval(intervalId);
            unlistenStartup?.();
        };
    }, []);

    return null;
}
