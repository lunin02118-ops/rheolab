#!/usr/bin/env node
/**
 * publish-all-channels.js
 *
 * Publishes the current build to ALL channels (beta + stable) in one command.
 *
 * Strategy:
 *   1. Beta  — uploads the installer artifact + beta.json         (full publish)
 *   2. Stable — re-uses the same artifact that is already on the server;
 *               only stable.json is (re-)uploaded via --from-manifest.
 *              This avoids a redundant second SCP of a large .exe.
 *
 * Options:
 *   --from-manifest <path>   Start from an existing local release manifest.
 *                            Beta will skip the artifact upload; stable re-uses it.
 *                            Default: outputs/release/beta.json  (if it exists)
 *   --host <user@host>       VPS host passed through to publish-update.js
 *   --key  <path>            SSH identity file passed through
 *   --dry-run | -n           Print all commands without executing anything
 *
 * Examples:
 *   # Normal publish — fresh installer from current build:
 *   node scripts/deploy/publish-all-channels.js
 *
 *   # Re-publish from beta.3 manifest (artifact already on server):
 *   node scripts/deploy/publish-all-channels.js --from-manifest outputs/release/beta.json
 *
 *   # Dry run — see exact commands:
 *   node scripts/deploy/publish-all-channels.js --dry-run
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = join(__dirname, '..', '..');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args  = process.argv.slice(2);
const flag  = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : undefined; };
const hasFlag = (name) => args.includes(name);

const DRY_RUN = hasFlag('--dry-run') || hasFlag('-n');
const HOST    = flag('--host');
const SSH_KEY = flag('--key');

// If --from-manifest was given explicitly, use it.
// Otherwise fall back to the local beta.json written by the previous beta publish.
const EXPLICIT_MANIFEST = flag('--from-manifest');
const BETA_MANIFEST     = join(REPO_ROOT, 'outputs', 'release', 'beta.json');
const NORMALIZED_RELEASE_MANIFEST = join(
    REPO_ROOT,
    'outputs',
    'release',
    'publish-all-channels.release-manifest.json',
);

const PUBLISH_SCRIPT = join(__dirname, 'publish-update.js');

// ── Helper ────────────────────────────────────────────────────────────────────
function normalizeManifestPath(manifestPath) {
    if (!manifestPath) {
        return undefined;
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (manifest?.artifacts?.[0]?.fileName && manifest?.artifacts?.[0]?.signature) {
        return manifestPath;
    }

    const platformEntry = manifest?.platforms?.['windows-x86_64'];
    if (!manifest?.version || !platformEntry?.url || !platformEntry?.signature) {
        throw new Error(
            `Unsupported manifest format: ${manifestPath}. ` +
            'Expected either release manifest artifacts[0] fields or update manifest platforms.windows-x86_64 fields.',
        );
    }

    let fileName;
    try {
        const artifactUrl = new URL(platformEntry.url);
        fileName = decodeURIComponent(basename(artifactUrl.pathname));
    } catch (error) {
        throw new Error(`Could not extract artifact filename from manifest URL: ${platformEntry.url} (${error.message})`);
    }

    const normalizedManifest = {
        version: manifest.version,
        artifacts: [
            {
                fileName,
                signature: platformEntry.signature,
            },
        ],
    };

    mkdirSync(dirname(NORMALIZED_RELEASE_MANIFEST), { recursive: true });
    writeFileSync(NORMALIZED_RELEASE_MANIFEST, JSON.stringify(normalizedManifest, null, 2));
    return NORMALIZED_RELEASE_MANIFEST;
}

function buildArgs(channel, fromManifest) {
    const parts = ['--channel', channel];
    if (fromManifest) parts.push('--from-manifest', `"${fromManifest}"`);
    if (HOST)         parts.push('--host', HOST);
    if (SSH_KEY)      parts.push('--key', SSH_KEY);
    if (DRY_RUN)      parts.push('--dry-run');
    return parts.join(' ');
}

function publish(channel, fromManifest) {
    const cmd = `node "${PUBLISH_SCRIPT}" ${buildArgs(channel, fromManifest)}`;
    const sep = '─'.repeat(62);
    console.log(`\n${sep}`);
    console.log(`🚀  Channel: ${channel.toUpperCase()}${fromManifest ? '  (from existing manifest — skip re-upload)' : ''}`);
    console.log(sep);
    if (DRY_RUN) {
        console.log(`  [DRY-RUN] ${cmd}`);
        return;
    }
    execSync(cmd, { stdio: 'inherit' });
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(
    `\n${'═'.repeat(62)}\n` +
    `  publish-all-channels  →  beta + stable${DRY_RUN ? '  (DRY RUN)' : ''}\n` +
    `${'═'.repeat(62)}`
);

try {
    // ── Step 1: beta ──────────────────────────────────────────────────────────
    // Normal path: uploads installer + writes beta.json on the server.
    // --from-manifest path: skips upload, only refreshes beta.json.
    const betaManifest = normalizeManifestPath(EXPLICIT_MANIFEST);
    publish('beta', betaManifest);

    // ── Step 2: stable ────────────────────────────────────────────────────────
    // The installer is already on the server from step 1 (or was there before).
    // We only need to upload stable.json pointing at the same artifact URL.
    // Resolve the manifest to pass:  explicit > just-written beta.json > none
    const stableManifest = normalizeManifestPath(
        EXPLICIT_MANIFEST ??
        (existsSync(BETA_MANIFEST) ? BETA_MANIFEST : undefined),
    );

    if (!stableManifest) {
        console.warn(
            '\n⚠️  No local beta.json found (outputs/release/beta.json).' +
            '\n    Stable channel will be published as a full upload (fresh artifact lookup).'
        );
    }
    publish('stable', stableManifest);

    // ── Summary ───────────────────────────────────────────────────────────────
    const eq = '═'.repeat(62);
    console.log(`\n${eq}`);
    console.log(`✅  All channels published${DRY_RUN ? ' (DRY RUN — nothing was sent)' : ''}:`);
    console.log('    beta   → beta.json   updated');
    console.log('    stable → stable.json updated');
    console.log(`${eq}\n`);

} catch (err) {
    console.error('\n❌  publish-all-channels failed:', err.message);
    process.exit(1);
}
