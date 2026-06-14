/**
 * Playwright globalTeardown — завершает процесс Tauri, запущенный в globalSetup.
 *
 * На Windows использует taskkill /T /F для рекурсивного завершения дерева процессов
 * (WebView2 создаёт дочерние процессы, которые нужно убить вместе с родительским).
 */

const path = require('path');
const fs = require('fs');
const {
    delay,
    killProcessTree,
    removePathWithRetry,
    removeSidecarsWithRetry,
} = require('./tauri-cleanup-utils');

const ROOT = path.resolve(__dirname, '../..');
const PID_FILE = path.join(ROOT, '.tauri-e2e.pid');
const SAMPLER_PID_FILE = path.join(ROOT, '.tauri-e2e-sampler.pid');
const DB_PATH_FILE = path.join(ROOT, '.tauri-e2e-db.path');
const WEBVIEW_DIR_FILE = path.join(ROOT, '.tauri-e2e-webview.dir');

module.exports = async function globalTeardown() {
    // ── 1. Остановить sampler нативной памяти ─────────────────────────────
    if (fs.existsSync(SAMPLER_PID_FILE)) {
        try {
            const samplerPid = parseInt(fs.readFileSync(SAMPLER_PID_FILE, 'utf8').trim(), 10);
            if (!isNaN(samplerPid)) {
                killProcessTree(samplerPid, {
                    label: 'native memory sampler',
                    prefix: '[tauri-e2e]',
                    tree: false,
                });
            }
        } catch { /* sampler мог уже завершиться сам */ }
        await removePathWithRetry(SAMPLER_PID_FILE, {
            label: 'native memory sampler pid file',
            prefix: '[tauri-e2e]',
        });
    }

    // ── 2. Завершить Tauri-приложение ─────────────────────────────────────
    let pid = null;

    if (fs.existsSync(PID_FILE)) {
        try {
            pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        } catch { /* ignore */ }
        await removePathWithRetry(PID_FILE, {
            label: 'tauri pid file',
            prefix: '[tauri-e2e]',
        });
    }

    // Фолбэк: PID передан через переменную окружения из setup
    if (!pid && process.env.TAURI_E2E_PID) {
        pid = parseInt(process.env.TAURI_E2E_PID, 10);
    }

    if (!pid || isNaN(pid)) {
        console.log('[tauri-e2e] PID не найден — пропускаем только остановку процесса.');
    } else {
        console.log(`[tauri-e2e] Завершаем Tauri-процесс (PID=${pid})...`);
        killProcessTree(pid, {
            label: 'Tauri process tree',
            prefix: '[tauri-e2e]',
            tree: true,
        });
        // Give WebView2/SQLite a short grace window to release file handles
        // before deleting per-run artifacts.
        await delay(500);
    }

    // ── 3. Убрать изолированную E2E-DB ────────────────────────────────────
    //   `tauri-e2e-setup.js` пишет путь временной DB в .tauri-e2e-db.path
    //   (только если она была им же выделена под isolation — caller-provided
    //   пути не отслеживаются и удаляются той гармонией, что их создала).
    //   Удаляем main DB-файл вместе со всеми SQLite сайдкарами (-wal, -shm, -journal).
    if (fs.existsSync(DB_PATH_FILE)) {
        let dbPath = '';
        try {
            dbPath = fs.readFileSync(DB_PATH_FILE, 'utf8').trim();
        } catch { /* ignore */ }
        await removePathWithRetry(DB_PATH_FILE, {
            label: 'isolated DB path marker',
            prefix: '[tauri-e2e]',
        });

        if (dbPath) {
            const removed = await removeSidecarsWithRetry(dbPath, ['', '-wal', '-shm', '-journal'], {
                attempts: 8,
                delayMs: 200,
                label: 'isolated DB',
                prefix: '[tauri-e2e]',
            });
            if (removed > 0) {
                console.log(`[tauri-e2e] ✓ Изолированная DB удалена (${removed} файлов): ${dbPath}`);
            }
        }
    }

    // ── 4. Убрать изолированную WebView2 UserData директорию ──────────────
    //   Per-run folder under outputs/e2e/temp-webview/ — created by
    //   tauri-e2e-setup.js to keep WebView2 instances independent from any
    //   other RheoLab build that happens to be running. Recursive remove
    //   is fine because the directory is exclusively owned by this run.
    if (fs.existsSync(WEBVIEW_DIR_FILE)) {
        let webViewDir = '';
        try {
            webViewDir = fs.readFileSync(WEBVIEW_DIR_FILE, 'utf8').trim();
        } catch { /* ignore */ }
        await removePathWithRetry(WEBVIEW_DIR_FILE, {
            label: 'WebView2 UserData marker',
            prefix: '[tauri-e2e]',
        });

        if (webViewDir && fs.existsSync(webViewDir)) {
            const removed = await removePathWithRetry(webViewDir, {
                attempts: 10,
                delayMs: 250,
                label: `WebView2 UserData ${webViewDir}`,
                prefix: '[tauri-e2e]',
                recursive: true,
            });
            if (removed) {
                console.log(`[tauri-e2e] ✓ Изолированная WebView2 UserData удалена: ${webViewDir}`);
            }
        }
    }
};
