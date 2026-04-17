/**
 * Playwright globalSetup для тестов масштабирования БД.
 *
 * Логика:
 *  1. Определяет масштаб из RHEOLAB_DB_SCALE (small | large, default: small).
 *  2. Для "small": генерирует временную БД с 1 копией каждой фикстуры (~12 экспериментов).
 *  3. Для "large": использует заранее созданную БД outputs/seed/rheolab-fixture-seed.db
 *     (создаётся командой npm run db:seed:large).
 *  4. Копирует выбранную БД в outputs/seed/tmp-<scale>-<ts>.db.
 *  5. Записывает путь в process.env.RHEOLAB_E2E_DB_PATH (передаётся бинарнику Tauri).
 *  6. Запускает Tauri-бинарник с CDP аналогично tauri-e2e-setup.js.
 *
 * Переменные окружения:
 *   RHEOLAB_DB_SCALE          — "small" | "large" (default: "small")
 *   TAURI_CDP_PORT            — CDP-порт (default: 9223, чтобы не конфликтовать)
 *   TAURI_E2E_SKIP_BUILD      — "1" — пропустить сборку бинарника
 *   RHEOLAB_DB_SCALE_SKIP_SEED — "1" — пропустить генерацию seed (использовать существующую)
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

const ROOT = path.resolve(__dirname, '../..');
const CDP_PORT = parseInt(process.env.TAURI_CDP_PORT || '9223', 10);
const BINARY_PATH = process.env.TAURI_BINARY_PATH ||
    path.join(ROOT, 'src-tauri', 'target', 'debug', 'rheolab-enterprise.exe');
const PID_FILE = path.join(ROOT, '.tauri-db-scale.pid');

const SCALE = (process.env.RHEOLAB_DB_SCALE || 'small').toLowerCase();
const LARGE_SEED_DB = path.join(ROOT, 'outputs', 'seed', 'rheolab-fixture-seed.db');
const TMP_DB_DIR = path.join(ROOT, 'outputs', 'seed');

/** Ждёт, пока CDP-эндпоинт ответит /json/version */
function waitForCdp(port, timeoutMs = 90_000) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        const attempt = () => {
            const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
                if (res.statusCode === 200) { resolve(); } else { scheduleRetry(); }
                res.resume();
            });
            req.on('error', scheduleRetry);
            req.setTimeout(1000, () => { req.destroy(); scheduleRetry(); });
        };
        const scheduleRetry = () => {
            if (Date.now() < deadline) { setTimeout(attempt, 600); }
            else { reject(new Error(`[db-scale] CDP не ответил на порту ${port} в течение ${timeoutMs} мс`)); }
        };
        attempt();
    });
}

function runSync(cmd, cwd = ROOT) {
    console.log(`[db-scale] $ ${cmd}`);
    execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

/** Возвращает максимальный mtime (мс) всех файлов в директории (рекурсивно) */
function maxMtime(dir, exts = null) {
    let max = 0;
    if (!fs.existsSync(dir)) return max;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { max = Math.max(max, maxMtime(full, exts)); }
        else if (!exts || exts.some(e => full.endsWith(e))) {
            max = Math.max(max, fs.statSync(full).mtimeMs);
        }
    }
    return max;
}

function needsRebuild() {
    if (!fs.existsSync(BINARY_PATH)) return true;
    const binMtime  = fs.statSync(BINARY_PATH).mtimeMs;
    const srcMtime  = maxMtime(path.join(ROOT, 'src-tauri', 'src'), ['.rs']);
    const distMtime = maxMtime(path.join(ROOT, 'dist'), ['.js', '.html', '.css']);
    return srcMtime > binMtime || distMtime > binMtime;
}

/**
 * Подготавливает БД нужного масштаба и возвращает путь к временной копии.
 */
async function prepareDb() {
    fs.mkdirSync(TMP_DB_DIR, { recursive: true });

    const skipSeed = process.env.RHEOLAB_DB_SCALE_SKIP_SEED === '1';
    const ts = Date.now();

    if (SCALE === 'large') {
        // ── Large: использует заранее построенный seed ──────────────────────
        if (!fs.existsSync(LARGE_SEED_DB)) {
            if (skipSeed) {
                throw new Error(
                    `[db-scale] large seed DB не найдена: ${LARGE_SEED_DB}\n` +
                    'Выполните: npm run db:seed:large'
                );
            }
            console.log('[db-scale] Генерируем large seed DB (~588 копий × все фикстуры)...');
            // Гарантируем, что cargo в PATH
            const cargoExe = path.join(os.homedir(), '.cargo', 'bin',
                process.platform === 'win32' ? 'cargo.exe' : 'cargo');
            const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH';
            const delim   = process.platform === 'win32' ? ';' : ':';
            if (fs.existsSync(cargoExe) && !(process.env[pathKey] || '').includes(path.dirname(cargoExe))) {
                process.env[pathKey] = `${path.dirname(cargoExe)}${delim}${process.env[pathKey] || ''}`;
            }
            runSync(
                `cargo run --manifest-path tools/fixture_seed/Cargo.toml --release ` +
                `-- --db "${LARGE_SEED_DB}"`,
                ROOT
            );
        } else {
            console.log(`[db-scale] Используем готовую large seed DB: ${LARGE_SEED_DB}`);
        }

        // Копируем в tmp, чтобы приложение не мутировало эталонный seed
        const tmpPath = path.join(TMP_DB_DIR, `tmp-large-${ts}.db`);
        fs.copyFileSync(LARGE_SEED_DB, tmpPath);
        // Копируем WAL-файлы если есть
        for (const suffix of ['-wal', '-shm']) {
            const src = LARGE_SEED_DB + suffix;
            if (fs.existsSync(src)) fs.copyFileSync(src, tmpPath + suffix);
        }
        console.log(`[db-scale] ✓ large tmp DB: ${tmpPath} (${(fs.statSync(tmpPath).size / 1_048_576).toFixed(1)} MB)`);
        return tmpPath;
    } else {
        // ── Small: генерируем маленькую БД на месте (--copies 1) ────────────
        const smallPath = path.join(TMP_DB_DIR, `tmp-small-${ts}.db`);
        if (!skipSeed) {
            console.log('[db-scale] Генерируем small seed DB (1 копия × все фикстуры)...');
            const cargoExe = path.join(os.homedir(), '.cargo', 'bin',
                process.platform === 'win32' ? 'cargo.exe' : 'cargo');
            const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH';
            const delim   = process.platform === 'win32' ? ';' : ':';
            if (fs.existsSync(cargoExe) && !(process.env[pathKey] || '').includes(path.dirname(cargoExe))) {
                process.env[pathKey] = `${path.dirname(cargoExe)}${delim}${process.env[pathKey] || ''}`;
            }
            runSync(
                `cargo run --manifest-path tools/fixture_seed/Cargo.toml ` +
                `-- --copies 1 --db "${smallPath}"`,
                ROOT
            );
        } else if (!fs.existsSync(smallPath)) {
            throw new Error(`[db-scale] small DB не найдена и RHEOLAB_DB_SCALE_SKIP_SEED=1: ${smallPath}`);
        }

        console.log(`[db-scale] ✓ small tmp DB: ${smallPath} (${(fs.statSync(smallPath).size / 1_048_576).toFixed(1)} MB)`);
        return smallPath;
    }
}

module.exports = async function globalSetup() {
    console.log(`\n[db-scale] === DB-Scale Setup (scale=${SCALE}) ===\n`);

    // ── Cargo/rustc в PATH ──────────────────────────────────────────────────
    {
        const cargoBin = path.join(os.homedir(), '.cargo', 'bin');
        const cargoExe = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
        const cargoPath = path.join(cargoBin, cargoExe);
        const pathKey = Object.keys(process.env).find(k => k.toLowerCase() === 'path') || 'PATH';
        const delimiter = process.platform === 'win32' ? ';' : ':';
        if (fs.existsSync(cargoPath) && !(process.env[pathKey] || '').includes(cargoBin)) {
            process.env[pathKey] = `${cargoBin}${delimiter}${process.env[pathKey] || ''}`;
            console.log(`[db-scale] Cargo добавлен в PATH: ${cargoBin}`);
        }
    }

    // ── 1. Подготовка БД ────────────────────────────────────────────────────
    const dbPath = await prepareDb();
    process.env.RHEOLAB_E2E_DB_PATH = dbPath;
    process.env.RHEOLAB_DB_SCALE_DB_PATH = dbPath;  // для teardown
    console.log(`[db-scale] RHEOLAB_E2E_DB_PATH = ${dbPath}`);

    // ── 2. Сборка бинарника (если нужно) ────────────────────────────────────
    const skipBuild = process.env.TAURI_E2E_SKIP_BUILD === '1';
    if (!skipBuild && needsRebuild()) {
        console.log('[db-scale] Источники новее бинарника — запускаем tauri build --debug --no-bundle...');
        runSync('npx tauri build --debug --no-bundle --config src-tauri/tauri.e2e.conf.json', ROOT);
    } else if (!fs.existsSync(BINARY_PATH)) {
        throw new Error(
            `[db-scale] Бинарник не найден: ${BINARY_PATH}\n` +
            'Запустите: npx tauri build --debug --no-bundle\n' +
            'Или установите TAURI_E2E_SKIP_BUILD=1 если бинарник существует.'
        );
    } else {
        console.log('[db-scale] Бинарник актуален.');
    }

    // ── 3. Запуск приложения с CDP ───────────────────────────────────────────
    console.log(`[db-scale] Запускаем приложение с CDP на порту ${CDP_PORT}...`);
    const child = spawn(BINARY_PATH, [], {
        env: {
            ...process.env,
            WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
            RHEOLAB_E2E_MOCK_REPORTS: '1',
            RHEOLAB_E2E_SKIP_LICENSE_GATE: '1',
            RHEOLAB_E2E_DB_PATH: dbPath,
        },
        detached: false,
        stdio: 'pipe',
    });

    child.stdout.on('data', (d) => process.stdout.write(`[tauri] ${d}`));
    child.stderr.on('data', (d) => process.stderr.write(`[tauri] ${d}`));
    child.on('error', (err) => {
        console.error('[db-scale] Не удалось запустить приложение:', err.message);
    });

    fs.writeFileSync(PID_FILE, String(child.pid), 'utf8');
    process.env.TAURI_DB_SCALE_PID = String(child.pid);
    process.env.TAURI_CDP_PORT = String(CDP_PORT);

    // ── 4. Ожидание CDP ──────────────────────────────────────────────────────
    console.log(`[db-scale] Ожидаем CDP на http://127.0.0.1:${CDP_PORT}/json/version ...`);
    try {
        await waitForCdp(CDP_PORT, 90_000);
    } catch (err) {
        try { child.kill(); } catch { /* ignore */ }
        throw err;
    }

    console.log(`[db-scale] ✓ CDP готов — http://127.0.0.1:${CDP_PORT}`);

    // Небольшая пауза для первого кадра
    await new Promise(r => setTimeout(r, 2_000));
    console.log(`[db-scale] === Setup complete (scale=${SCALE}) ===\n`);
};
