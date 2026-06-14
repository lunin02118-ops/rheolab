/**
 * Playwright globalTeardown для тестов масштабирования БД.
 * Завершает Tauri-процесс и удаляет временную БД.
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
const PID_FILE = path.join(ROOT, '.tauri-db-scale.pid');

module.exports = async function globalTeardown() {
    // ── 1. Завершить Tauri-приложение ────────────────────────────────────
    let pid = null;

    if (fs.existsSync(PID_FILE)) {
        try {
            pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        } catch { /* ignore */ }
        await removePathWithRetry(PID_FILE, {
            label: 'db-scale pid file',
            prefix: '[db-scale]',
        });
    }

    if (!pid && process.env.TAURI_DB_SCALE_PID) {
        pid = parseInt(process.env.TAURI_DB_SCALE_PID, 10);
    }

    if (pid && !isNaN(pid)) {
        console.log(`[db-scale] Завершаем Tauri-процесс (PID=${pid})...`);
        killProcessTree(pid, {
            label: 'Tauri process tree',
            prefix: '[db-scale]',
            tree: true,
        });
        await delay(500);
    } else {
        console.log('[db-scale] PID не найден — пропускаем только остановку процесса.');
    }

    // ── 2. Удалить временную БД ───────────────────────────────────────────
    const tmpDbPath = process.env.RHEOLAB_DB_SCALE_DB_PATH;
    if (tmpDbPath && fs.existsSync(tmpDbPath)) {
        const removed = await removeSidecarsWithRetry(tmpDbPath, ['', '-wal', '-shm', '-journal'], {
            attempts: 8,
            delayMs: 200,
            label: 'temporary DB',
            prefix: '[db-scale]',
        });
        if (removed > 0) {
            console.log(`[db-scale] ✓ Временная БД удалена: ${tmpDbPath}`);
        }
    }
};
