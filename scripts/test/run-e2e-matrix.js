#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const cliArgs = process.argv.slice(2);
const mode = (cliArgs[0] || 'smoke').toLowerCase();
const skipFull = process.env.RHEOLAB_SKIP_E2E_FULL === '1';
const skipSlow = process.env.RHEOLAB_SKIP_E2E_SLOW === '1';

const suites = {
  smoke: [
    // Core critical path
    'tests/e2e/auth/auth-login.spec.ts',
    'tests/e2e/dashboard/dashboard-ui.spec.ts',
    'tests/e2e/settings/settings-ui.spec.ts',
  ],
  full: [
    // Parser — all instrument formats
    'tests/e2e/parser/file-loading.spec.ts',
    // Database — save/load
    'tests/e2e/database/save-load.spec.ts',
    // Library — filters, views
    'tests/e2e/library/library-ui.spec.ts',
    // Chart rendering
    'tests/e2e/chart/chart-rendering.spec.ts',
    // Comparison
    'tests/e2e/comparison/comparison-ui.spec.ts',
    // Reports
    'tests/e2e/reports/reports-export.spec.ts',
  ],
  slow: [
    // Critical end-to-end workflow
    'tests/e2e/core/critical-workflow.spec.ts',
    // Full multi-file workflow (parse, save, library, comparison, reports)
    'tests/e2e/core/full-workflow-multifile.spec.ts',
  ],
};

function runPlaywright(label, testFiles) {

  const nodeBin = process.execPath;
  const playwrightCli = path.join(repoRoot, 'node_modules', 'playwright', 'cli.js');
  const e2eEnv = buildE2EEnv();

  ensureE2EDatabaseReady(nodeBin, e2eEnv);
  ensurePlaywrightBrowserInstalled(nodeBin, playwrightCli, e2eEnv);
  const workerCount = (process.env.RHEOLAB_E2E_WORKERS || '1').trim();
  const args = [playwrightCli, 'test', `--workers=${workerCount}`, ...testFiles];

  console.log(`\n[e2e:${label}] ${nodeBin} ${args.join(' ')}`);

  const result = spawnSync(nodeBin, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: e2eEnv,
    shell: false,
  });

  if (result.error) {
    console.error(`[e2e:${label}] failed to launch: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[e2e:${label}] failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }

  console.log(`[e2e:${label}] passed`);
}

function buildE2EEnv() {
  const env = { ...process.env };
  const e2ePort = env.RHEOLAB_E2E_PORT || env.PORT || '3100';
  const e2eHost = env.RHEOLAB_E2E_HOST || '127.0.0.1';
  const baseUrl = `http://${e2eHost}:${e2ePort}`;

  env.RHEOLAB_E2E_PORT = e2ePort;
  env.RHEOLAB_E2E_HOST = e2eHost;
  env.PORT = e2ePort;

  // Ensure workers and webServer both see the fake-parse flag.
  // playwright.config.ts also sets this at module scope, but explicit here for
  // defence-in-depth (covers any future alternative entry points).
  if (!env.RHEOLAB_E2E_FAKE_PARSE) env.RHEOLAB_E2E_FAKE_PARSE = '1';

  return env;
}

function ensureE2EDatabaseReady(nodeBin, env) {
  if (process.env.RHEOLAB_E2E_SKIP_DB_PREP === '1') {
    return;
  }

  const prepScript = path.join(repoRoot, 'scripts', 'build', 'create-prod-db.js');
  if (!fs.existsSync(prepScript)) {
    return;
  }

  console.log(`\n[e2e] ${nodeBin} ${prepScript}`);
  const prep = spawnSync(nodeBin, [prepScript], {
    cwd: repoRoot,
    stdio: 'inherit',
    env,
    shell: false,
  });

  if (prep.error) {
    console.error(`[e2e] failed to prepare test database: ${prep.error.message}`);
    process.exit(1);
  }

  if (prep.status !== 0) {
    console.error(`[e2e] test database preparation failed with exit code ${prep.status}`);
    process.exit(prep.status ?? 1);
  }
}

function ensurePlaywrightBrowserInstalled(nodeBin, playwrightCli, env) {
  if (process.env.RHEOLAB_E2E_SKIP_BROWSER_INSTALL === '1') {
    return;
  }

  const installArgs = [playwrightCli, 'install', 'chromium'];
  console.log(`\n[e2e] ${nodeBin} ${installArgs.join(' ')}`);

  const install = spawnSync(nodeBin, installArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env,
    shell: false,
  });

  if (install.error) {
    console.error(`[e2e] failed to run Playwright browser install: ${install.error.message}`);
    process.exit(1);
  }

  if (install.status !== 0) {
    console.error(`[e2e] Playwright browser install failed with exit code ${install.status}`);
    process.exit(install.status ?? 1);
  }
}

if (mode === 'smoke') {
  runPlaywright('smoke', suites.smoke);
  process.exit(0);
}

if (mode === 'full') {
  if (skipFull) {
    console.log('[e2e] full suite skipped (RHEOLAB_SKIP_E2E_FULL=1).');
    process.exit(0);
  }
  runPlaywright('full', suites.full);
  process.exit(0);
}

if (mode === 'slow') {
  if (skipSlow) {
    console.log('[e2e] slow suite skipped (RHEOLAB_SKIP_E2E_SLOW=1).');
    process.exit(0);
  }
  runPlaywright('slow', suites.slow);
  process.exit(0);
}

if (mode === 'all') {
  runPlaywright('smoke', suites.smoke);

  if (!skipFull) {
    runPlaywright('full', suites.full);

    if (!skipSlow) {
      runPlaywright('slow', suites.slow);
    }
  } else {
    console.log('[e2e] full suite skipped (RHEOLAB_SKIP_E2E_FULL=1).');
  }

  process.exit(0);
}

console.error(`[e2e] unknown mode: ${mode}. Use: smoke | full | slow | all`);
process.exit(1);
