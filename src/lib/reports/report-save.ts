/**
 * Shared save/download logic for report blobs (PDF & Excel).
 *
 * Detects Tauri vs browser environment and handles:
 * - Tauri: native save dialog → writeFile
 * - Browser: creates an <a> download link
 * - E2E: skips dialog when __e2e_skip_dialogs flag is set (dev builds only)
 */

import { isTauri } from '@/lib/tauri';
import { save, open } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { logger } from '@/lib/logger';

export interface SaveBlobOptions {
    blob: Blob;
    filename: string;
    /** Tauri save dialog file filters, e.g. [{ name: 'PDF', extensions: ['pdf'] }] */
    filters: { name: string; extensions: string[] }[];
}

export interface SaveBytesOptions {
    bytes: Uint8Array;
    filename: string;
    mimeType: string;
    /** Tauri save dialog file filters, e.g. [{ name: 'PDF', extensions: ['pdf'] }] */
    filters: { name: string; extensions: string[] }[];
}

/**
 * Save a Blob to disk via Tauri native dialog or browser download fallback.
 */
export async function saveBlob({ blob, filename, filters }: SaveBlobOptions): Promise<void> {
    // sessionStorage (not localStorage) so the flag is automatically cleared
    // when the app restarts — only the E2E test harness sets it per-session
    // via addInitScript. No DEV guard here: web-mode e2e tests run against a
    // production Vite build (import.meta.env.DEV === false), so gating on DEV
    // breaks the download assertions. The sessionStorage key itself is the
    // barrier — nothing in production code ever sets it.
    const e2eSkipDialogs = sessionStorage.getItem('__e2e_skip_dialogs') === '1';

    if (isTauri() && !e2eSkipDialogs) {
        const filePath = await save({ defaultPath: filename, filters });
        if (!filePath) {
            // User cancelled the save dialog
            return;
        }
        try {
            const buffer = await blob.arrayBuffer();
            await writeFile(filePath, new Uint8Array(buffer));
            logger.info(`[saveBlob] Saved to ${filePath}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`[saveBlob] writeFile failed for ${filePath}: ${msg}`);
            // Re-throw so the caller can display the error to the user
            throw new Error(`Не удалось сохранить файл: ${msg}`);
        }
    } else {
        // Browser mode OR E2E (skip dialogs) — trigger browser-side download
        // so Playwright can intercept via page.waitForEvent('download').
        downloadViaBrowser(blob, filename);
    }
}

/**
 * Save binary report bytes without first wrapping them in a Blob in the normal
 * Tauri path. Browser/e2e download mode still creates a short-lived Blob so
 * Playwright can observe the download event.
 */
export async function saveBytes({ bytes, filename, mimeType, filters }: SaveBytesOptions): Promise<void> {
    const e2eSkipDialogs = sessionStorage.getItem('__e2e_skip_dialogs') === '1';

    if (isTauri() && !e2eSkipDialogs) {
        const filePath = await save({ defaultPath: filename, filters });
        if (!filePath) return;
        try {
            await writeFile(filePath, bytes);
            logger.info(`[saveBytes] Saved to ${filePath}`);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(`[saveBytes] writeFile failed for ${filePath}: ${msg}`);
            throw new Error(`Не удалось сохранить файл: ${msg}`);
        }
    } else {
        downloadBytesViaBrowser(bytes, filename, mimeType);
    }
}

/** Item to save in a batch (multiple files to one directory). */
export interface SaveBlobItem {
    blob: Blob;
    filename: string;
}

export interface SaveBytesItem {
    bytes: Uint8Array;
    filename: string;
    mimeType: string;
}

/**
 * Save multiple blobs to a single directory chosen via one dialog.
 * Falls back to individual browser downloads outside Tauri.
 */
export async function saveBlobsToDir(items: SaveBlobItem[]): Promise<void> {
    if (items.length === 0) return;

    // Single file — use the normal single-file save dialog
    if (items.length === 1) {
        const ext = items[0].filename.split('.').pop() ?? '';
        await saveBlob({
            blob: items[0].blob,
            filename: items[0].filename,
            filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
        });
        return;
    }

    const e2eSkipDialogs = sessionStorage.getItem('__e2e_skip_dialogs') === '1';

    if (isTauri() && !e2eSkipDialogs) {
        const dir = await open({ directory: true, title: 'Выберите папку для сохранения отчётов' });
        if (!dir || typeof dir !== 'string') return; // cancelled

        for (const item of items) {
            try {
                const filePath = await join(dir, item.filename);
                const buffer = await item.blob.arrayBuffer();
                await writeFile(filePath, new Uint8Array(buffer));
                logger.info(`[saveBlobsToDir] Saved to ${filePath}`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.error(`[saveBlobsToDir] writeFile failed for ${item.filename}: ${msg}`);
                throw new Error(`Не удалось сохранить ${item.filename}: ${msg}`);
            }
        }
    } else {
        // Browser fallback — download each file individually
        for (const item of items) {
            downloadViaBrowser(item.blob, item.filename);
        }
    }
}

/**
 * Save multiple binary files to a directory without Blob materialisation in the
 * normal Tauri path. Browser/e2e mode falls back to individual downloads.
 */
export async function saveBytesToDir(items: SaveBytesItem[]): Promise<void> {
    if (items.length === 0) return;

    if (items.length === 1) {
        const ext = items[0].filename.split('.').pop() ?? '';
        await saveBytes({
            bytes: items[0].bytes,
            filename: items[0].filename,
            mimeType: items[0].mimeType,
            filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
        });
        return;
    }

    const e2eSkipDialogs = sessionStorage.getItem('__e2e_skip_dialogs') === '1';

    if (isTauri() && !e2eSkipDialogs) {
        const dir = await open({ directory: true, title: 'Выберите папку для сохранения отчётов' });
        if (!dir || typeof dir !== 'string') return;

        for (const item of items) {
            try {
                const filePath = await join(dir, item.filename);
                await writeFile(filePath, item.bytes);
                logger.info(`[saveBytesToDir] Saved to ${filePath}`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.error(`[saveBytesToDir] writeFile failed for ${item.filename}: ${msg}`);
                throw new Error(`Не удалось сохранить ${item.filename}: ${msg}`);
            }
        }
    } else {
        for (const item of items) {
            downloadBytesViaBrowser(item.bytes, item.filename, item.mimeType);
        }
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

function downloadBytesViaBrowser(bytes: Uint8Array, filename: string, mimeType: string): void {
    const blob = new Blob([bytes as unknown as BlobPart], { type: mimeType });
    downloadViaBrowser(blob, filename);
}
