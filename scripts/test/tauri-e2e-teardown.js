/**
 * Playwright globalTeardown — завершает процесс Tauri, запущенный в globalSetup.
 *
 * На Windows использует taskkill /T /F для рекурсивного завершения дерева процессов
 * (WebView2 создаёт дочерние процессы, которые нужно убить вместе с родительским).
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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
                execSync(`taskkill /PID ${samplerPid} /F`, { stdio: 'pipe' });
                console.log(`[tauri-e2e] ✓ Native memory sampler (PID=${samplerPid}) остановлен.`);
            }
        } catch { /* sampler мог уже завершиться сам */ }
        fs.unlinkSync(SAMPLER_PID_FILE);
    }

    // ── 2. Завершить Tauri-приложение ─────────────────────────────────────
    let pid = null;

    if (fs.existsSync(PID_FILE)) {
        try {
            pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        } catch { /* ignore */ }
        fs.unlinkSync(PID_FILE);
    }

    // Фолбэк: PID передан через переменную окружения из setup
    if (!pid && process.env.TAURI_E2E_PID) {
        pid = parseInt(process.env.TAURI_E2E_PID, 10);
    }

    if (!pid || isNaN(pid)) {
        console.log('[tauri-e2e] PID не найден — пропускаем teardown.');
        return;
    }

    console.log(`[tauri-e2e] Завершаем Tauri-процесс (PID=${pid})...`);
    try {
        // /T — завершить дерево процессов; /F — принудительно
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' });
        console.log('[tauri-e2e] ✓ Tauri-процесс завершён.');
    } catch (err) {
        // Процесс мог уже завершиться сам
        console.warn(`[tauri-e2e] Не удалось завершить PID=${pid}: ${err.message}`);
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
        try { fs.unlinkSync(DB_PATH_FILE); } catch { /* ignore */ }

        if (dbPath) {
            const sidecars = ['', '-wal', '-shm', '-journal'].map((sfx) => `${dbPath}${sfx}`);
            let removed = 0;
            for (const file of sidecars) {
                try {
                    if (fs.existsSync(file)) {
                        fs.unlinkSync(file);
                        removed += 1;
                    }
                } catch (rmErr) {
                    console.warn(`[tauri-e2e] Не удалось удалить ${file}: ${rmErr.message}`);
                }
            }
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
        try { fs.unlinkSync(WEBVIEW_DIR_FILE); } catch { /* ignore */ }

        if (webViewDir && fs.existsSync(webViewDir)) {
            try {
                // node>=14.14: rmSync with recursive+force handles locked files
                // gracefully on Windows. WebView2 does sometimes leave handles
                // open on its log/cache files for a moment after shutdown, so
                // `maxRetries` gives the OS a chance to release them.
                fs.rmSync(webViewDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
                console.log(`[tauri-e2e] ✓ Изолированная WebView2 UserData удалена: ${webViewDir}`);
            } catch (rmErr) {
                console.warn(
                    `[tauri-e2e] Не удалось удалить WebView2 UserData ${webViewDir}: ${rmErr.message}`,
                );
            }
        }
    }
};
