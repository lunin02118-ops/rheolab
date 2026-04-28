#!/usr/bin/env node
/**
 * DEPRECATED — replaced by `scripts/version/sync.js`.
 *
 * Historically this script:
 *   1. Read the current version out of /package.json
 *   2. Auto-bumped the trailing prerelease number unless
 *      RHEOLAB_SKIP_VERSION_BUMP=1 was set in the environment
 *   3. Wrote the new value into /src-tauri/Cargo.toml,
 *      /src-tauri/tauri.conf.json, and /src/lib/version.ts
 *
 * That design treated /package.json as an implicit source of truth and the
 * `RHEOLAB_SKIP_VERSION_BUMP` flag as the only safety net — which produced
 * silent rassinkhron between the four version files (package.json,
 * tauri.conf.json, Cargo.toml, version.ts) whenever someone forgot the flag,
 * built locally without the npm wrapper, or installed an unrelated build
 * with a higher version than /package.json.
 *
 * The replacement is the pair of scripts under /scripts/version/, driven by
 * the explicit Single Source of Truth at /version.json:
 *
 *   npm run version:sync       propagate /version.json → 4 dependent files
 *   npm run version:validate   read-only consistency check (CI-grade)
 *
 * This shim still runs `version:sync` for any caller that has not yet been
 * updated, but it deliberately does NOT auto-bump anything and prints a
 * loud deprecation banner so the migration is impossible to ignore.
 */

'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const banner = [
    '┌─────────────────────────────────────────────────────────────────────┐',
    '│  DEPRECATED: scripts/build/generate-version.js                      │',
    '│  → use `npm run version:sync` (or `version:validate` in CI).        │',
    '│  Single source of truth is now /version.json.                       │',
    '└─────────────────────────────────────────────────────────────────────┘',
].join('\n');
console.warn(banner);

const syncScript = path.resolve(__dirname, '..', 'version', 'sync.js');
const result = spawnSync(process.execPath, [syncScript], { stdio: 'inherit' });
process.exit(result.status ?? 1);
