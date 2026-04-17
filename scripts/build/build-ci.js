#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');

function normalizeEnv(source) {
  const result = {};
  const seen = new Set();

  for (const [key, value] of Object.entries(source)) {
    if (!key || key.includes('=') || key.includes('\0')) {
      continue;
    }
    if (typeof value !== 'string') {
      continue;
    }

    const lowerKey = key.toLowerCase();
    if (seen.has(lowerKey)) {
      continue;
    }

    seen.add(lowerKey);
    result[key] = value;
  }

  return result;
}

const env = normalizeEnv({
  ...process.env,
  RHEOLAB_SKIP_VERSION_BUMP: '1',
});

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const node = process.execPath;
// Use the actual JS entry point rather than the platform shell shim in .bin/.
// node_modules/.bin/vite is a bash script on Linux/macOS and a .cmd on Windows;
// invoking it with `node` directly fails on both. vite/bin/vite.js is portable.
const viteJs = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');

run(node, ['scripts/build/generate-version.js']);
run(node, [viteJs, 'build']);
