#!/usr/bin/env node

/**
 * Generate a Tauri v2 updater key pair.
 *
 * Usage:
 *   node scripts/release/generate-updater-keys.js [--password <pwd>]
 *
 * If --password is not provided, one is generated automatically.
 * The public key should be committed to src-tauri/tauri.conf.json.
 * The private key (and password) must be stored in CI secrets:
 *   TAURI_SIGNING_PRIVATE_KEY
 *   TAURI_SIGNING_PRIVATE_KEY_PASSWORD
 *
 * See: https://v2.tauri.app/plugin/updater/
 */

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const path = require('node:path');

const args = process.argv.slice(2);
const pwdFlagIndex = args.indexOf('--password');
const password = pwdFlagIndex >= 0 && args[pwdFlagIndex + 1]
  ? args[pwdFlagIndex + 1]
  : crypto.randomBytes(24).toString('base64url');

const repoRoot = path.resolve(__dirname, '../..');

// Try npx tauri signer generate first
const result = spawnSync(
  'npx',
  ['tauri', 'signer', 'generate', '-w', '.tauri-private-key.tmp', '--password', password],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: true,
  },
);

if (result.error || result.status !== 0) {
  console.error('[keygen] npx tauri signer generate failed.');
  console.error('[keygen] Make sure @tauri-apps/cli is installed: npm install -D @tauri-apps/cli');
  process.exit(1);
}

console.log('\n[keygen] ─── Actions ───────────────────────────────────────');
console.log('[keygen] 1. Copy the PUBLIC key above into src-tauri/tauri.conf.json → plugins.updater.pubkey');
console.log(`[keygen] 2. Store the private key (.tauri-private-key.tmp) as CI secret TAURI_SIGNING_PRIVATE_KEY`);
console.log(`[keygen] 3. Store the password as CI secret TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${password}`);
console.log('[keygen] 4. Delete .tauri-private-key.tmp after storing securely');
console.log('[keygen] ──────────────────────────────────────────────────────');
