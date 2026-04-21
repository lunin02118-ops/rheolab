/**
 * Installation / relaunch helpers for the desktop auto-updater.
 *
 * Kept in a dedicated module so `UpdateBanner` can pull it in via dynamic
 * `import()` on click rather than synchronously from `UpdateChecker`.
 * This prevents the Tauri updater / process plugins from being bundled
 * into the main chunk just because the banner is rendered on every page.
 */
import type { Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { logger } from '@/lib/logger';
import { useUpdateStore } from '@/lib/store/update-store';
import { backup } from '@/lib/tauri/backup';

// Module-level reference to the pending Update object.
// Kept outside React state because it contains non-serialisable callbacks.
let _pendingUpdate: Update | null = null;

/** Store the `Update` object discovered by a successful check. */
export function setPendingUpdate(update: Update | null): void {
    _pendingUpdate = update;
}

/** Read the currently pending update (may be null). */
export function getPendingUpdate(): Update | null {
    return _pendingUpdate;
}

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
        logger.info(`[UpdateChecker] Pre-update backup created: ${backupResult.name ?? '(no name)'}`);
    } catch (backupErr) {
        const msg = backupErr instanceof Error ? backupErr.message : String(backupErr);
        logger.warn(`[UpdateChecker] Pre-update backup failed (non-fatal): ${msg}`);
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
        logger.error(`[UpdateChecker] Install failed: ${msg}`);
        store.setError(`Ошибка установки: ${msg}`);
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
        logger.error(`[UpdateChecker] Relaunch failed: ${String(err)}`);
    }
}
