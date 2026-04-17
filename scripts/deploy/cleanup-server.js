#!/usr/bin/env node
/**
 * cleanup-server.js
 *
 * Cleans stale artefacts and DB rows on the license-server VPS.
 *
 * What it does — in order:
 *   1. Removes old installer artefact dirs from
 *        /var/www/license-server/releases/artifacts/
 *      keeping the N newest versions  (--keep N, default 2).
 *
 *   2. Deletes stale *.json.tmp files from
 *        /var/www/license-server/releases/v1/update/windows-x86_64/
 *      (leftover from aborted publish-update.js runs before the atomic rename).
 *
 *   3. Purges expired rows from `rate_limits` MySQL table
 *        WHERE expires_at < NOW()
 *
 *   4. Purges old rows from `activation_log` MySQL table
 *        WHERE created_at < NOW() - --log-days  (default 90 days)
 *
 * Options:
 *   --host <user@host>   VPS host (default: root@license.vizbuka.ru)
 *   --key  <path>        SSH identity file
 *   --keep <n>           Number of newest artifact versions to keep  (default: 2)
 *   --log-days <n>       Days of activation_log history to keep       (default: 90, min: 7)
 *   --dry-run | -n       Print all commands without executing anything
 *
 * Examples:
 *   node scripts/deploy/cleanup-server.js
 *   node scripts/deploy/cleanup-server.js --keep 3 --log-days 180
 *   node scripts/deploy/cleanup-server.js --dry-run
 */

import { execSync }                         from 'node:child_process';
import { existsSync, readFileSync }         from 'node:fs';
import { join, dirname }                    from 'node:path';
import { fileURLToPath }                    from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = join(__dirname, '..', '..');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const flag    = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : undefined; };
const hasFlag = (name) => args.includes(name);

const HOST     = flag('--host') ?? 'root@license.vizbuka.ru';
const SSH_KEY  = flag('--key');
const DRY_RUN  = hasFlag('--dry-run') || hasFlag('-n');
const KEEP     = parseInt(flag('--keep')     ?? '2',  10);
const LOG_DAYS = parseInt(flag('--log-days') ?? '90', 10);

if (isNaN(KEEP) || KEEP < 1) {
    console.error('❌  --keep must be a positive integer (>= 1)');
    process.exit(1);
}
if (isNaN(LOG_DAYS) || LOG_DAYS < 7) {
    console.error('❌  --log-days must be >= 7 (minimum retention period)');
    process.exit(1);
}

// ── SSH opts — mirrors publish-update.js ─────────────────────────────────────
const KNOWN_HOSTS_FILE = join(REPO_ROOT, 'scripts', 'deploy', 'known_hosts');
const knownHostsOk = existsSync(KNOWN_HOSTS_FILE) &&
    readFileSync(KNOWN_HOSTS_FILE, 'utf-8').trim().replace(/^#[^\n]*/gm, '').trim() !== '';

const SSH_OPTS = [
    knownHostsOk ? '-o StrictHostKeyChecking=yes' : '-o StrictHostKeyChecking=accept-new',
    '-o BatchMode=yes',
    '-o ConnectTimeout=15',
    knownHostsOk && `-o UserKnownHostsFile=${KNOWN_HOSTS_FILE}`,
    SSH_KEY && `-i ${SSH_KEY}`,
].filter(Boolean).join(' ');

// ── Helpers ───────────────────────────────────────────────────────────────────
function run(cmd, description = '') {
    if (description) console.log(`  → ${description}`);
    if (DRY_RUN) {
        console.log(`  [DRY-RUN] ${cmd}`);
        return '';
    }
    return execSync(cmd, { stdio: ['pipe', 'pipe', 'inherit'], encoding: 'utf-8' }).trim();
}

// Wrap remote command in double quotes; inner double quotes are escaped.
// Single quotes inside remoteCmd are fine (used for SQL strings).
function ssh(remoteCmd, description = '') {
    const escaped = remoteCmd.replace(/"/g, '\\"');
    return run(`ssh ${SSH_OPTS} ${HOST} "${escaped}"`, description);
}

// Semver-ish comparator: "0.2.0-beta.3" < "0.2.0"  (pre-release < release)
function semverCompare(a, b) {
    const parse = (s) => s.replace(/^v/, '').split(/[.\-]/).map(n => {
        const num = Number(n);
        return isNaN(num) ? n : num;
    });
    const av = parse(a), bv = parse(b);
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
        const ai = av[i] ?? -Infinity;
        const bi = bv[i] ?? -Infinity;
        if (typeof ai === 'number' && typeof bi === 'number') {
            if (ai !== bi) return ai < bi ? -1 : 1;
        } else {
            const sa = String(ai), sb = String(bi);
            if (sa !== sb) return sa < sb ? -1 : 1;
        }
    }
    return 0;
}

// ── Header ────────────────────────────────────────────────────────────────────
const sep = '─'.repeat(62);
console.log(`\n${'═'.repeat(62)}`);
console.log('  🗑️   RheoLab License Server — cleanup-server.js');
console.log(`${'═'.repeat(62)}`);
console.log(`  Host       : ${HOST}`);
console.log(`  Keep       : ${KEEP} newest artifact version(s)`);
console.log(`  Log days   : ${LOG_DAYS} days of activation_log`);
if (DRY_RUN) console.log('  Mode       : DRY RUN — nothing will be changed');
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// 1. Artifact dirs
// ─────────────────────────────────────────────────────────────────────────────
console.log(`${sep}`);
console.log('  Step 1/4 — Old artifact directories');
console.log(sep);

const ARTIFACTS_DIR = '/var/www/license-server/releases/artifacts';

const rawListing = ssh(
    `ls -1 "${ARTIFACTS_DIR}" 2>/dev/null || echo ""`,
    'Listing artifact directories',
);

const vers = rawListing.split('\n').map(v => v.trim()).filter(Boolean);

if (vers.length === 0) {
    console.log('  (no artifact directories found — skipping)');
} else {
    const sorted   = vers.slice().sort(semverCompare);
    const toKeep   = sorted.slice(Math.max(0, sorted.length - KEEP));
    const toDelete = sorted.slice(0,            Math.max(0, sorted.length - KEEP));

    console.log(`  Found   : ${vers.length} dir(s): ${sorted.join('  ')}`);
    console.log(`  Keep    : ${toKeep.join('  ')}`);

    if (toDelete.length === 0) {
        console.log('  Nothing to remove (count ≤ --keep limit).\n');
    } else {
        console.log(`  Remove  : ${toDelete.join('  ')}`);
        for (const v of toDelete) {
            // Guard against path traversal — artifact dir names must be semver-like.
            if (!/^[0-9a-zA-Z][0-9a-zA-Z.\-]*$/.test(v)) {
                console.warn(`  ⚠️   Skipping suspicious dir name: "${v}" — does not match semver pattern`);
                continue;
            }
            ssh(`rm -rf "${ARTIFACTS_DIR}/${v}"`, `Removing ${ARTIFACTS_DIR}/${v}`);
        }
        console.log(`  ✅  Removed ${toDelete.length} old artifact dir(s).\n`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Stale *.json.tmp files
// ─────────────────────────────────────────────────────────────────────────────
console.log(sep);
console.log('  Step 2/4 — Stale *.json.tmp files (aborted uploads)');
console.log(sep);

const UPDATE_DIR = '/var/www/license-server/releases/v1/update/windows-x86_64';

const tmpListing = ssh(
    `find "${UPDATE_DIR}" -name "*.json.tmp" 2>/dev/null || echo ""`,
    'Searching for *.json.tmp',
);

const staleFiles = tmpListing.split('\n').map(f => f.trim()).filter(Boolean);

if (staleFiles.length === 0) {
    console.log('  (no stale .json.tmp files — skipping)\n');
} else {
    console.log(`  Found ${staleFiles.length} stale file(s):`);
    for (const f of staleFiles) {
        // Basic path-traversal guard: must start with expected prefix, no ".."
        if (!f.startsWith('/var/www/license-server/') || f.includes('..')) {
            console.warn(`  ⚠️   Skipping unexpected path: "${f}"`);
            continue;
        }
        console.log(`       ${f}`);
        ssh(`rm -f "${f}"`, `Deleting ${f}`);
    }
    console.log(`  ✅  Removed ${staleFiles.length} stale .json.tmp file(s).\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. rate_limits — expired rows
// ─────────────────────────────────────────────────────────────────────────────
console.log(sep);
console.log('  Step 3/4 — MySQL: purge expired rate_limits rows');
console.log(sep);

// LOG_DAYS is validated as integer above — no SQL injection possible.
// SQL uses single quotes to avoid shell escaping conflicts inside the double-quoted SSH wrapper.
const rlOut = ssh(
    `mysql --defaults-file=/root/.my.cnf rheolab_license -N -e ` +
    `'DELETE FROM rate_limits WHERE expires_at < NOW(); SELECT ROW_COUNT() AS deleted_rows;'`,
    'DELETE FROM rate_limits WHERE expires_at < NOW()',
);
console.log(`  Deleted rows : ${rlOut || '0'}\n`);

// ─────────────────────────────────────────────────────────────────────────────
// 4. activation_log — old rows
// ─────────────────────────────────────────────────────────────────────────────
console.log(sep);
console.log(`  Step 4/4 — MySQL: purge activation_log rows older than ${LOG_DAYS} days`);
console.log(sep);

const alOut = ssh(
    `mysql --defaults-file=/root/.my.cnf rheolab_license -N -e ` +
    `'DELETE FROM activation_log WHERE created_at < DATE_SUB(NOW(), INTERVAL ${LOG_DAYS} DAY); SELECT ROW_COUNT() AS deleted_rows;'`,
    `DELETE FROM activation_log WHERE created_at < NOW() - ${LOG_DAYS}d`,
);
console.log(`  Deleted rows : ${alOut || '0'}\n`);

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`${'═'.repeat(62)}`);
console.log(`✅  Cleanup complete${DRY_RUN ? ' (DRY RUN — nothing was actually changed)' : ''}`);
console.log(`${'═'.repeat(62)}\n`);
