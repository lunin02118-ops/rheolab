// Wrapper around the Vitest CLI that pins cwd and the CLI entry path to their
// canonical filesystem casing.
//
// Why: on Windows, launching vitest from a shell whose cwd has a lowercase
// drive letter (`d:\...` instead of `D:\...`) makes Node ESM treat identical
// files as different module URLs. Vitest then loads two copies of
// @vitest/runner and every suite fails before running a single test with:
//   "TypeError: Cannot read properties of undefined (reading 'config')"
//   "Vitest failed to find the runner"
//
// Spawning the CLI from the realpath-normalized project root guarantees a
// single module graph regardless of how the shell reports the drive letter.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = fs.realpathSync.native(path.resolve(here, '..', '..'));
const vitestCli = path.join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');

if (!fs.existsSync(vitestCli)) {
    console.error(`[run-vitest] vitest CLI not found at ${vitestCli}. Run "npm install" first.`);
    process.exit(1);
}

const result = spawnSync(process.execPath, [vitestCli, ...process.argv.slice(2)], {
    cwd: projectRoot,
    stdio: 'inherit',
});

if (result.error) {
    console.error('[run-vitest] failed to spawn vitest:', result.error.message);
    process.exit(1);
}
process.exit(result.status ?? 1);
