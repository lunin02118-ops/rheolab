#!/usr/bin/env node

/**
 * E2E test web-server — starts Vite preview to serve the built SPA.
 *
 * The app is a desktop-first Tauri + Vite SPA; this script only exists so that
 * Playwright can exercise frontend routes in a browser without Tauri.
 */

const path = require('node:path');
const { spawn } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const port = process.env.PORT || process.env.RHEOLAB_E2E_PORT || '3100';
const host = process.env.HOST || process.env.RHEOLAB_E2E_HOST || '127.0.0.1';
const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const maxRestarts = Number.parseInt(process.env.RHEOLAB_E2E_SERVER_MAX_RESTARTS || '2', 10);
const restartDelayMs = Number.parseInt(process.env.RHEOLAB_E2E_SERVER_RESTART_DELAY_MS || '1000', 10);

let child = null;
let restartCount = 0;
let shuttingDown = false;

function spawnServer() {
  console.log(
    `[e2e-webserver] starting vite preview on ${host}:${port} (attempt ${restartCount + 1}/${maxRestarts + 1})`,
  );

  child = spawn(
    process.execPath,
    [viteBin, 'preview', '--host', host, '--port', String(port), '--strictPort'],
    {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    },
  );

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      process.exit(code ?? 0);
      return;
    }

    if (signal) {
      console.error(`[e2e-webserver] vite preview exited by signal ${signal}`);
    } else {
      console.error(`[e2e-webserver] vite preview exited with code ${code ?? 0}`);
    }

    if (restartCount >= maxRestarts) {
      process.exit(code ?? 1);
      return;
    }

    restartCount += 1;
    setTimeout(() => {
      spawnServer();
    }, Math.max(0, restartDelayMs));
  });
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    shuttingDown = true;
    if (child && !child.killed) {
      child.kill(signal);
      return;
    }
    process.exit(0);
  });
}

spawnServer();
