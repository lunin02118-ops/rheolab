/**
 * Playwright globalTeardown для тестов масштабирования БД.
 * Завершает Tauri-процесс и удаляет временную БД.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../..');
const PID_FILE = path.join(ROOT, '.tauri-db-scale.pid');

module.exports = async function globalTeardown() {
    // ── 1. Завершить Tauri-приложение ────────────────────────────────────
    let pid = null;

    if (fs.existsSync(PID_FILE)) {
        try {
            pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
        } catch { /* ignore */ }
        fs.unlinkSync(PID_FILE);
    }

    if (!pid && process.env.TAURI_DB_SCALE_PID) {
        pid = parseInt(process.env.TAURI_DB_SCALE_PID, 10);
    }

    if (pid && !isNaN(pid)) {
        console.log(`[db-scale] Завершаем Tauri-процесс (PID=${pid})...`);
        try {
            execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe' });
            console.log(`[db-scale] ✓ Tauri процесс (PID=${pid}) завершён.`);
        } catch {
            console.log(`[db-scale] Процесс уже завершён или PID не найден.`);
        }
    } else {
        console.log('[db-scale] PID не найден — пропускаем teardown.');
    }

    // ── 2. Удалить временную БД ───────────────────────────────────────────
    const tmpDbPath = process.env.RHEOLAB_DB_SCALE_DB_PATH;
    if (tmpDbPath && fs.existsSync(tmpDbPath)) {
        try {
            fs.unlinkSync(tmpDbPath);
            for (const suffix of ['-wal', '-shm']) {
                const extra = tmpDbPath + suffix;
                if (fs.existsSync(extra)) fs.unlinkSync(extra);
            }
            console.log(`[db-scale] ✓ Временная БД удалена: ${tmpDbPath}`);
        } catch (e) {
            console.warn(`[db-scale] Не удалось удалить временную БД: ${e.message}`);
        }
    }
};
