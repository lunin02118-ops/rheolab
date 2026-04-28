/**
 * Playwright globalSetup — запускает Tauri desktop-приложение с открытым
 * CDP-портом для Playwright.
 *
 * Используется конфигом playwright.tauri.config.ts.
 *
 * Шаги:
 *  1. Если бинарник отсутствует или устарел — запускает:
 *       npx tauri build --debug --no-bundle
 *     Это собирает prod-frontend (npm run build) и компилирует Rust
 *     с bundled ассетами. Бинарник открывает https://tauri.localhost.
 *  2. Запускает бинарник с WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=PORT.
 *  3. Ждёт, пока CDP-эндпоинт станет доступен.
 *
 * PID-файл сохраняется в .tauri-e2e.pid для teardown-скрипта.
 *
 * Переменные окружения:
 *   TAURI_CDP_PORT       — CDP-порт (по умолчанию 9222)
 *   TAURI_E2E_SKIP_BUILD — "1" — пропустить сборку (использовать то, что есть)
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

const ROOT = path.resolve(__dirname, '../..');
const CDP_PORT = parseInt(process.env.TAURI_CDP_PORT || '9222', 10);
const BINARY_PATH = process.env.TAURI_BINARY_PATH || path.join(ROOT, 'src-tauri', 'target', 'debug', 'rheolab-enterprise.exe');
const DIST_DIR = path.join(ROOT, 'dist');
const PID_FILE = path.join(ROOT, '.tauri-e2e.pid');
const SAMPLER_PID_FILE = path.join(ROOT, '.tauri-e2e-sampler.pid');
const SAMPLER_SCRIPT = path.join(ROOT, 'scripts', 'test', 'tauri-native-memory-sampler.ps1');

/**
 * Side-channel file used to communicate the per-run temp-DB path to the
 * teardown script so it can clean up the file after Playwright exits.
 *
 * If the calling harness has already set `RHEOLAB_E2E_DB_PATH` (e.g.
 * `tauri-db-scale-setup.js` for the scale suite, or a developer who wants
 * to point at a hand-crafted seed), we do NOT overwrite it — only the
 * paths *we* allocate are tracked here for deletion.
 */
const DB_PATH_FILE = path.join(ROOT, '.tauri-e2e-db.path');

/** Allocate a fresh, isolated temp DB path for this E2E run. */
function allocateIsolatedDbPath() {
    const dir = path.join(ROOT, 'outputs', 'e2e', 'temp-db');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `e2e-${Date.now()}-${process.pid}.db`);
}

/** Ждёт, пока CDP-эндпоинт ответит /json/version */
function waitForCdp(port, timeoutMs = 60_000) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const attempt = () => {
            const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
                if (res.statusCode === 200) {
                    resolve();
                } else {
                    scheduleRetry();
                }
                res.resume();
            });
            req.on('error', scheduleRetry);
            req.setTimeout(1000, () => { req.destroy(); scheduleRetry(); });
        };
        const scheduleRetry = () => {
            if (Date.now() < deadline) {
                setTimeout(attempt, 600);
            } else {
                reject(new Error(`[tauri-e2e] CDP не ответил на порту ${port} в течение ${timeoutMs} мс`));
            }
        };
        attempt();
    });
}

/** Выполняет синхронную команду с выводом в консоль */
function runSync(cmd, cwd = ROOT) {
    console.log(`[tauri-e2e] $ ${cmd}`);
    execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

/** Возвращает максимальный mtime (мс) всех файлов в директории (рекурсивно) */
function maxMtime(dir, exts = null) {
    let max = 0;
    if (!fs.existsSync(dir)) return max;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            max = Math.max(max, maxMtime(full, exts));
        } else if (!exts || exts.some(e => full.endsWith(e))) {
            max = Math.max(max, fs.statSync(full).mtimeMs);
        }
    }
    return max;
}

/** Нужна ли пересборка? Сравниваем mtime бинарника с исходниками */
function needsRebuild() {
    if (!fs.existsSync(BINARY_PATH)) return true;
    const binMtime = fs.statSync(BINARY_PATH).mtimeMs;
    const srcMtime = maxMtime(path.join(ROOT, 'src-tauri', 'src'), ['.rs']);
    const distMtime = maxMtime(DIST_DIR, ['.js', '.html', '.css']);
    return srcMtime > binMtime || distMtime > binMtime;
}

module.exports = async function globalSetup() {
    // ── Ensure cargo/rustc are in PATH (Rust toolchain may not be in system PATH) ──
    // Mirrors the ensureCargoInPath() logic in scripts/dev/run-tauri-cli.js
    {
        const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
        const cargoExe = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
        const cargoPath = path.join(cargoBin, cargoExe);
        const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH';
        const delimiter = process.platform === 'win32' ? ';' : ':';
        if (fs.existsSync(cargoPath) && !(process.env[pathKey] || '').includes(cargoBin)) {
            process.env[pathKey] = `${cargoBin}${delimiter}${process.env[pathKey] || ''}`;
            console.log(`[tauri-e2e] Cargo добавлен в PATH: ${cargoBin}`);
        }
    }

    const skipBuild = process.env.TAURI_E2E_SKIP_BUILD === '1';

    // ── 1. Build (frontend + Rust bundled) ────────────────────────────────
    //   Используем `tauri build --debug --no-bundle` — это prod-сборка:
    //   • запускает beforeBuildCommand (npm run build)
    //   • компилирует Rust с bundled dist/ (не devUrl)
    //   • бинарник открывает https://tauri.localhost (не localhost:1420)
    //   • --no-bundle пропускает создание установщика (nsis/msi)
    if (!skipBuild && needsRebuild()) {
        console.log('[tauri-e2e] Источники новее бинарника — запускаем tauri build --debug --no-bundle...');
        // --config src-tauri/tauri.e2e.conf.json переопределяет devUrl → ""
        // чтобы бинарник использовал frontendDist (bundled assets, URL: https://tauri.localhost)
        // а не devUrl (localhost:1420), который Tauri v2 использует для debug-сборок по умолчанию.
        runSync('npx tauri build --debug --no-bundle --config src-tauri/tauri.e2e.conf.json', ROOT);
    } else if (!fs.existsSync(BINARY_PATH)) {
        throw new Error(
            `[tauri-e2e] Бинарник не найден: ${BINARY_PATH}\n` +
            'Запустите: npx tauri build --debug --no-bundle\n' +
            'Или установите TAURI_E2E_SKIP_BUILD=1 если бинарник существует в другом месте.'
        );
    } else {
        console.log('[tauri-e2e] Бинарник актуален (TAURI_E2E_SKIP_BUILD=1 или исходники не изменились).');
    }

    // ── 2. DB isolation — never let an E2E run touch the production DB ────
    //   Tauri resolves `app_data_dir` from the bundle identifier
    //   (`com.rheolab.enterprise`), which on Windows points at
    //   `%APPDATA%\com.rheolab.enterprise`.  By default the app uses
    //   `<app_data_dir>/rheolab.db`, but the Rust bootstrap honours
    //   `RHEOLAB_E2E_DB_PATH` as an explicit override
    //   (see src-tauri/src/state/app_state.rs::BootstrapPaths::resolve).
    //
    //   If we don't override it here, the E2E binary opens the user's
    //   real production DB.  In the past this turned a successful
    //   release-gate run into a downgrade trap: dev / E2E binaries
    //   migrated the production DB to a newer schema version, after
    //   which the previously-installed (older) build refused to open
    //   it with "schema_version (N) is newer than the binary's
    //   CURRENT_SCHEMA_VERSION (M); refusing to open".
    //
    //   We allocate a fresh, empty DB per run under
    //   `outputs/e2e/temp-db/` and let `run_migrations` apply every
    //   migration from scratch.  Cleanup happens in
    //   `tauri-e2e-teardown.js`, which reads `.tauri-e2e-db.path`.
    //
    //   Callers that need a hand-crafted seed (`tauri-db-scale-setup.js`)
    //   set `RHEOLAB_E2E_DB_PATH` themselves before invoking us; in
    //   that case we honour their choice and do NOT track the path
    //   for cleanup (the seeded DB lives outside our temp dir and is
    //   managed by the calling harness).
    const callerProvidedDbPath = (process.env.RHEOLAB_E2E_DB_PATH || '').trim();
    let isolatedDbPath = null;
    if (callerProvidedDbPath) {
        console.log(`[tauri-e2e] Honouring caller-provided RHEOLAB_E2E_DB_PATH=${callerProvidedDbPath}`);
    } else {
        isolatedDbPath = allocateIsolatedDbPath();
        process.env.RHEOLAB_E2E_DB_PATH = isolatedDbPath;
        try {
            fs.writeFileSync(DB_PATH_FILE, isolatedDbPath, 'utf8');
        } catch (writeErr) {
            console.warn(`[tauri-e2e] Не удалось записать ${DB_PATH_FILE}: ${writeErr.message}`);
        }
        console.log(`[tauri-e2e] Isolated DB: ${isolatedDbPath}`);
    }

    // ── 3. Запуск приложения с CDP ─────────────────────────────────────────
    console.log(`[tauri-e2e] Запускаем приложение с CDP на порту ${CDP_PORT}...`);
    const child = spawn(BINARY_PATH, [], {
        env: {
            ...process.env,
            // WebView2 (Windows) принимает дополнительные аргументы Chromium:
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
            // E2E mock: reports_generate_pdf/excel return stub bytes instead of
            // running Typst (which at opt-level=0 takes 5+ minutes).
            // Remove this line when Typst is compiled with opt-level=2 (rebuild needed).
            RHEOLAB_E2E_MOCK_REPORTS: '1',
            // E2E bypass: skip native Rust license gate so experiments_save works
            // without a real license in the test DB. Mirror of RHEOLAB_E2E_MOCK_REPORTS.
            RHEOLAB_E2E_SKIP_LICENSE_GATE: '1',
            // DB isolation — see the long comment above the spawn block.
            RHEOLAB_E2E_DB_PATH: process.env.RHEOLAB_E2E_DB_PATH,
        },
        detached: false,
        stdio: 'pipe',
    });

    child.stdout.on('data', (d) => process.stdout.write(`[tauri] ${d}`));
    child.stderr.on('data', (d) => process.stderr.write(`[tauri] ${d}`));
    child.on('error', (err) => {
        console.error('[tauri-e2e] Не удалось запустить приложение:', err.message);
    });

    // Сохраняем PID для teardown
    fs.writeFileSync(PID_FILE, String(child.pid), 'utf8');
    process.env.TAURI_E2E_PID = String(child.pid);
    process.env.TAURI_CDP_PORT = String(CDP_PORT);

    // ── 4. Ожидание CDP ────────────────────────────────────────────────────
    console.log(`[tauri-e2e] Ожидаем CDP на http://127.0.0.1:${CDP_PORT}/json/version ...`);
    try {
        await waitForCdp(CDP_PORT, 90_000);
    } catch (err) {
        // Убиваем процесс перед падением
        try { child.kill(); } catch { /* ignore */ }
        throw err;
    }

    console.log(`[tauri-e2e] ✓ CDP готов — http://127.0.0.1:${CDP_PORT}`);

    // ── 5. Запуск фонового сэмплера нативной памяти (Working Set) ───────
    try {
        const nativeMemDir = path.join(ROOT, 'outputs', 'e2e', 'perf');
        fs.mkdirSync(nativeMemDir, { recursive: true });
        const nativeMemFile = path.join(nativeMemDir, `native-memory-${Date.now()}.jsonl`);

        const sampler = spawn('powershell', [
            '-ExecutionPolicy', 'Bypass',
            '-File', SAMPLER_SCRIPT,
            '-PidFile', PID_FILE,
            '-OutputFile', nativeMemFile,
            '-IntervalMs', '2000',
        ], { detached: false, stdio: 'pipe' });

        if (sampler.pid) {
            fs.writeFileSync(SAMPLER_PID_FILE, String(sampler.pid), 'utf8');
            process.env.TAURI_E2E_NATIVE_MEM_FILE = nativeMemFile;
            console.log(`[tauri-e2e] Native memory sampler PID=${sampler.pid}`);
            console.log(`[tauri-e2e] Native memory output: ${nativeMemFile}`);
        }
        sampler.stderr.on('data', (d) => process.stderr.write(`[sampler] ${d}`));
    } catch (samplerErr) {
        console.warn(`[tauri-e2e] Не удалось запустить sampler: ${samplerErr.message}`);
    }

    // Небольшая пауза чтобы приложение отрисовало первый кадр
    await new Promise(r => setTimeout(r, 2_000));
};
