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
};
