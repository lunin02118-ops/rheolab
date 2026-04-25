#!/usr/bin/env node
/**
 * RELEASE GATE runner — обязательный E2E-чек перед публикацией любого релиза.
 *
 * Что делает:
 *   1. Проверяет, что release-бинарник Tauri существует. Если нет —
 *      запускает `npm run tauri:build`, чтобы собрать его.
 *   2. Выставляет env для playwright.tauri.config.ts:
 *        FULL_EXPORT=1
 *        TAURI_BINARY_PATH=<full path to rheolab-enterprise.exe>
 *        TAURI_E2E_SKIP_BUILD=1
 *   3. Запускает единственный workflow-тест:
 *        tests/e2e/reports/comparison-workflow-release-gate.tauri.spec.ts
 *   4. Возвращает exit code playwright-прогона (0 — зелёный свет,
 *      1 — блокирует релиз).
 *
 * Использование:
 *   node scripts/test/run-release-gate.js          # прогнать gate на существующем бинарнике
 *   node scripts/test/run-release-gate.js --build  # принудительно пересобрать бинарник
 *
 * Или:
 *   npm run test:release-gate
 *
 * Этот скрипт также дёргается из scripts/release/prepare-production.js
 * между `tauri build` и генерацией manifest'a — так что забыть прогнать
 * gate перед релизом невозможно. Отключить можно только через явный флаг
 * `--skip-release-gate` в `prepare-production.js` (c warning в stdout).
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const forceBuild = args.includes('--build');
const debugBuild = args.includes('--debug');

const binarySubpath = debugBuild
    ? 'src-tauri/target/debug/rheolab-enterprise.exe'
    : 'src-tauri/target/release/rheolab-enterprise.exe';
const binaryPath = path.join(repoRoot, binarySubpath);

const playwrightSpec = 'tests/e2e/reports/comparison-workflow-release-gate.tauri.spec.ts';

// ─── Step 1 — make sure the binary exists ───────────────────────────────────

function binaryExists() {
    return fs.existsSync(binaryPath);
}

function buildBinary() {
    console.log('[release-gate] building Tauri binary...');
    const buildArgs = debugBuild
        ? ['run', 'tauri:build:debug', '--', '--no-bundle']
        : ['run', 'tauri:build', '--', '--no-bundle'];
    const result = spawnSync('npm', buildArgs, {
        cwd: repoRoot,
        stdio: 'inherit',
        shell: true,
        env: {
            ...process.env,
            RHEOLAB_SKIP_VERSION_BUMP: '1',
            // Release binary panics without a non-sentinel secret; use a
            // dev-only token for E2E purposes. This binary must NOT be shipped.
            ALPHA_CHANNEL_SECRET: process.env.ALPHA_CHANNEL_SECRET
                || 'dev-secret-for-e2e-release-gate-only',
            BETA_CHANNEL_SECRET: process.env.BETA_CHANNEL_SECRET
                || 'dev-secret-for-e2e-release-gate-only',
        },
    });
    if (result.status !== 0) {
        console.error('[release-gate] tauri build failed');
        process.exit(result.status || 1);
    }
}

if (forceBuild || !binaryExists()) {
    if (!binaryExists()) {
        console.log(`[release-gate] binary missing: ${binaryPath}`);
    } else {
        console.log('[release-gate] --build supplied → rebuilding');
    }
    buildBinary();
}

if (!binaryExists()) {
    console.error(`[release-gate] binary still missing after build: ${binaryPath}`);
    process.exit(1);
}

// ─── Step 2 — run the workflow spec ─────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════');
console.log('  RELEASE GATE — Comparison Report workflow');
console.log(`  Binary: ${path.relative(repoRoot, binaryPath)}`);
console.log(`  Spec:   ${playwrightSpec}`);
console.log('════════════════════════════════════════════════════════\n');

const playwrightResult = spawnSync(
    'npx',
    [
        'playwright', 'test',
        '--config', 'playwright.tauri.config.ts',
        playwrightSpec,
        '--reporter=list',
    ],
    {
        cwd: repoRoot,
        stdio: 'inherit',
        shell: true,
        env: {
            ...process.env,
            FULL_EXPORT: '1',
            TAURI_BINARY_PATH: binarySubpath.split('/').join(path.sep),
            TAURI_E2E_SKIP_BUILD: '1',
        },
    },
);

const exitCode = playwrightResult.status ?? 1;

if (exitCode === 0) {
    console.log('\n[release-gate] ✅ PASSED — release is green-lit');
} else {
    console.error(`\n[release-gate] ❌ FAILED (exit=${exitCode}) — release blocked`);
    console.error('[release-gate] inspect playwright-report/ for details');
}

process.exit(exitCode);
