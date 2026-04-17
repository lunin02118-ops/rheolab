/**
 * Shared save/download logic for report blobs (PDF & Excel).
 *
 * Detects Tauri vs browser environment and handles:
 * - Tauri: native save dialog → writeFile
 * - Browser: creates an <a> download link
 * - E2E: skips dialog when __e2e_skip_dialogs flag is set (dev builds only)
 */

import { isTauri } from '@/lib/tauri';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { logger as clientLogger } from '@/lib/client-logger';

export interface SaveBlobOptions {
    blob: Blob;
    filename: string;
    /** Tauri save dialog file filters, e.g. [{ name: 'PDF', extensions: ['pdf'] }] */
    filters: { name: string; extensions: string[] }[];
}

/**
 * Save a Blob to disk via Tauri native dialog or browser download fallback.
 */
export async function saveBlob({ blob, filename, filters }: SaveBlobOptions): Promise<void> {
    // sessionStorage (not localStorage) so the flag is automatically cleared
    // when the app restarts — only the E2E test harness sets it per-session
    // via addInitScript. The import.meta.env.DEV guard is a second barrier:
    // production builds (import.meta.env.DEV === false) ALWAYS show the dialog,
    // even if sessionStorage somehow has the flag.
    const e2eSkipDialogs = import.meta.env.DEV
        && sessionStorage.getItem('__e2e_skip_dialogs') === '1';

    if (isTauri() && !e2eSkipDialogs) {
        const filePath = await save({ defaultPath: filename, filters });
        if (!filePath) {
            // User cancelled the save dialog
            return;
        }
        try {
            const buffer = await blob.arrayBuffer();
            await writeFile(filePath, new Uint8Array(buffer));
            clientLogger.info(`[saveBlob] Saved to ${filePath}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            clientLogger.error(`[saveBlob] writeFile failed for ${filePath}: ${msg}`);
            // Re-throw so the caller can display the error to the user
            throw new Error(`Не удалось сохранить файл: ${msg}`);
        }
    } else {
        // Browser mode OR E2E (skip dialogs) — trigger browser-side download
        // so Playwright can intercept via page.waitForEvent('download').
        downloadViaBrowser(blob, filename);
    }
}

function downloadViaBrowser(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
