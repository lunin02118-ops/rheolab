#!/usr/bin/env node
/**
 * setup-known-hosts.js
 *
 * Populates scripts/deploy/known_hosts with the production server's SSH host
 * key fingerprints so that publish-update.js can use StrictHostKeyChecking=yes.
 *
 * Usage (run once before first deploy, commit the result):
 *   node scripts/deploy/setup-known-hosts.js
 *   node scripts/deploy/setup-known-hosts.js license.vizbuka.ru   # custom host
 *
 * The key is stored in hashed format (-H) — the hostname is not exposed in
 * plain text in the repository.
 *
 * After running, verify the fingerprint matches what your VPS provider shows
 * in its console before committing the file.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KNOWN_HOSTS_FILE = join(__dirname, 'known_hosts');
const HOST = process.argv[2] || 'license.vizbuka.ru';

if (!/^[a-zA-Z0-9.-]+$/.test(HOST)) {
    console.error(`\n❌  Invalid host: ${HOST}`);
    console.error('    Hostnames may only contain letters, digits, dots, and hyphens.');
    process.exit(1);
}

console.log(`\nScanning SSH host keys for ${HOST} …`);

let scanned;
try {
    scanned = execFileSync('ssh-keyscan', ['-H', HOST], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
    });
} catch (err) {
    console.error(`\n❌  ssh-keyscan failed: ${err.message}`);
    console.error('    Make sure ssh-keyscan is available (OpenSSH) and the host is reachable.');
    process.exit(1);
}

const newLines = scanned
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#'));

if (newLines.length === 0) {
    console.error('\n❌  ssh-keyscan returned no keys — check the hostname and network.');
    process.exit(1);
}

// Read the existing file (preserves the explanatory comments at the top).
const existing = existsSync(KNOWN_HOSTS_FILE)
    ? readFileSync(KNOWN_HOSTS_FILE, 'utf-8')
    : '';

// Strip any previous hashed entries for this host to avoid duplicates, then
// append the freshly scanned lines.
const withoutOld = existing
    .split('\n')
    .filter(l => !l.startsWith('|1|'))   // remove all hashed entries
    .join('\n')
    .trimEnd();

const updated = withoutOld + '\n' + newLines.join('\n') + '\n';
writeFileSync(KNOWN_HOSTS_FILE, updated, 'utf-8');

console.log(`✅  Written ${newLines.length} key(s) to scripts/deploy/known_hosts`);
console.log('\n⚠️   BEFORE COMMITTING: verify the fingerprint matches your VPS console.');
console.log(`    ssh-keyscan -l -f scripts/deploy/known_hosts\n`);
