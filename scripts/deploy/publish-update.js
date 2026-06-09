#!/usr/bin/env node
/**
 * publish-update.js
 *
 * Publishes a signed Tauri installer to the VPS so that the in-app auto-updater
 * can detect and deliver it.
 *
 * Modes:
 *   Default publish — alpha channel (Superuser / project owner personal tier).
 *     This is the default so unqualified publishes never leak to external users:
 *       node scripts/deploy/publish-update.js
 *
 *   Beta publish — Developer license users only:
 *     node scripts/deploy/publish-update.js --channel beta
 *
 *   Stable publish — all users (Standard / Enterprise / Trial / Demo):
 *     node scripts/deploy/publish-update.js --channel stable
 *
 *   Rollback / re-publish from existing release manifest:
 *     node scripts/deploy/publish-update.js --from-manifest outputs/release/stable.json
 *     node scripts/deploy/publish-update.js --from-manifest outputs/release/beta.json --channel beta
 *     node scripts/deploy/publish-update.js --from-manifest outputs/release/alpha.json --channel alpha
 *     (The installer is already on the server; only {channel}.json is re-uploaded.)
 *
 * What this script does:
 *   1. Reads version + artifact info (from package.json / NSIS dir, or from --from-manifest)
 *   2. Extracts the latest CHANGELOG entry as release notes
 *   3. Builds a `{channel}.json` update manifest (stable.json, beta.json, or alpha.json)
 *   4. SCPs the .exe to /var/www/license-server/releases/artifacts/{version}/  (skipped with --from-manifest)
 *   5. SCPs {channel}.json as {channel}.json.tmp, validates it server-side, then atomically renames
 *      tmp → {channel}.json so clients never see a partial write.
 *
 * Options:
 *   --channel <alpha|beta|stable>  Update channel to publish (default: alpha)
 *   --host <user@host>           VPS host (default: root@license.vizbuka.ru)
 *   --key  <path>                SSH identity file
 *   --from-manifest <path>       Path to a local release manifest JSON (rollback / re-deploy)
 *   --dry-run | -n               Print commands without executing
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);

const HOST         = flag('--host') ?? 'root@license.vizbuka.ru';
const SSH_KEY      = flag('--key');
const DRY_RUN      = hasFlag('--dry-run') || hasFlag('-n');
const FROM_MANIFEST = flag('--from-manifest');

// Default channel mirrors release-policy.js DEFAULT_RELEASE_CHANNEL —
// the owner's personal `alpha` tier, so unqualified publishes never
// leak to external users.  Promotion to beta/stable is deliberate.
const CHANNEL_RAW = (flag('--channel') ?? 'alpha').toLowerCase();
if (!['stable', 'beta', 'alpha'].includes(CHANNEL_RAW)) {
    console.error(`\n❌  Invalid --channel value: "${CHANNEL_RAW}". Must be "alpha", "beta", or "stable".`);
    process.exit(1);
}
const CHANNEL = CHANNEL_RAW; // 'alpha' | 'beta' | 'stable'

const KNOWN_HOSTS_FILE = join(REPO_ROOT, 'scripts', 'deploy', 'known_hosts');
const knownHostsPopulated = existsSync(KNOWN_HOSTS_FILE) &&
    readFileSync(KNOWN_HOSTS_FILE, 'utf-8').trim().replace(/^#[^\n]*/gm, '').trim() !== '';
if (!knownHostsPopulated) {
    console.warn('  ⚠️  scripts/deploy/known_hosts is missing or has no fingerprints.');
    console.warn('     Run the setup script once and commit the result:');
    console.warn('       node scripts/deploy/setup-known-hosts.js');
    console.warn('     or: npm run deploy:setup-keys');
    console.warn('     Continuing with StrictHostKeyChecking=accept-new (TOFU) — NOT for production.\n');
}
const SSH_OPTS = [
    knownHostsPopulated ? '-o StrictHostKeyChecking=yes' : '-o StrictHostKeyChecking=accept-new',
    '-o BatchMode=yes',
    '-o ConnectTimeout=15',
    knownHostsPopulated && `-o UserKnownHostsFile=${KNOWN_HOSTS_FILE}`,
    SSH_KEY && `-i ${SSH_KEY}`,
].filter(Boolean).join(' ');

// ── Helper: run or print ──────────────────────────────────────────────────────
function run(cmd, description = '') {
    if (description) console.log(`  → ${description}`);
    if (DRY_RUN) {
        console.log(`  [DRY-RUN] ${cmd}`);
        return '';
    }
    return execSync(cmd, { stdio: ['pipe', 'pipe', 'inherit'], encoding: 'utf-8' }).trim();
}

// ── 1. Version & artifacts ────────────────────────────────────────────────────
let version, exeName, exePath, signature;

if (FROM_MANIFEST) {
    // --from-manifest: publish from an existing release manifest (rollback / re-deploy).
    // The installer is already on the server — only stable.json is (re-)uploaded.
    if (!existsSync(FROM_MANIFEST)) {
        console.error(`\n\u274C  Release manifest not found: ${FROM_MANIFEST}`);
        process.exit(1);
    }
    const releaseManifest = JSON.parse(readFileSync(FROM_MANIFEST, 'utf-8'));
    version = releaseManifest.version;
    const artifact = releaseManifest.artifacts?.[0];
    if (!version || !artifact?.fileName || !artifact?.signature) {
        console.error('\n\u274C  Release manifest is missing required fields (version / artifacts[0].fileName / artifacts[0].signature)');
        process.exit(1);
    }
    exeName   = artifact.fileName;
    exePath   = null;  // installer already on server
    signature = artifact.signature;
    console.log(`\n🔄  Publishing from release manifest (rollback / re-deploy): v${version} [channel: ${CHANNEL}]`);
    console.log(`    Artifact  : ${exeName}`);
    console.log(`    Manifest  : ${FROM_MANIFEST}`);
    console.log(`    Signature : ${signature.slice(0, 20)}\u2026`);
} else {
    // Normal publish: derive version from package.json, find freshly built artifact.
    const pkgJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
    version = pkgJson.version;
    console.log(`\n\uD83D\uDE80  Publishing RheoLab Enterprise v${version} [channel: ${CHANNEL}]`);

    const nsisDir = join(REPO_ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
    let allExe;
    try {
        allExe = readdirSync(nsisDir)
            .filter(f => f.endsWith('.exe') && !f.toLowerCase().includes('uninstall'));
    } catch {
        console.error('\n\u274C  NSIS output directory not found:', nsisDir);
        console.error('    Run the release build first: npm run release:prepare');
        process.exit(1);
    }

    // Match the exact filename version segment. A stable version like "0.2.2"
    // is a substring of prerelease artifacts such as "0.2.2-alpha.24".
    const exactVersionSegment = `_${version}_`;
    const matched = allExe.filter(f => f.includes(exactVersionSegment));
    if (matched.length === 0) {
        console.error(`\n\u274C  No installer matching version ${version} found in ${nsisDir}`);
        console.error(`    Found: ${allExe.length > 0 ? allExe.join(', ') : '(none)'}`);
        console.error('    Run the release build first: npm run release:prepare');
        process.exit(1);
    }

    exeName = matched[0];
    exePath = join(nsisDir, exeName);
    const sigPath = exePath + '.sig';

    if (!existsSync(exePath)) {
        console.error(`\n\u274C  Installer not found: ${exePath}`);
        process.exit(1);
    }
    if (!existsSync(sigPath)) {
        console.error(`\n\u274C  Signature file not found: ${sigPath}`);
        console.error('    Rebuild with TAURI_SIGNING_PRIVATE_KEY set (npm run release:prepare).');
        process.exit(1);
    }

    signature = readFileSync(sigPath, 'utf-8').trim();
    console.log(`\n  Installer : ${exeName}`);
    console.log(`  Signature : ${signature.slice(0, 20)}\u2026`);
}
// Validate version format to prevent shell injection via interpolated SSH commands.
if (!/^\d+(\.\d+)*(-[\w.]+)?$/.test(version)) {
    console.error(`\n\u274C  Version string has unexpected format: "${version}"`);
    process.exit(1);
}
// ── 3. Release notes from CHANGELOG ──────────────────────────────────────────
let notes = '';
try {
    const changelog = readFileSync(join(REPO_ROOT, 'CHANGELOG.md'), 'utf-8');
    // Grab everything between the first two "## " headings
    const match = changelog.match(/^## \S[^\n]*\n([\s\S]*?)(?=^## |\Z)/m);
    if (match) {
        notes = match[1].trim().slice(0, 2000); // cap at 2000 chars
    }
} catch {
    console.warn('  ⚠️  CHANGELOG.md unreadable — notes will be empty');
}

// ── 4. Build {channel}.json ─────────────────────────────────────────────────
// Tauri's Rust RFC-3339 parser does not accept sub-second precision.
const pubDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const artifactUrl =
    `https://license.vizbuka.ru/releases/artifacts/${version}/${exeName.replace(/ /g, '%20')}`;

const manifest = {
    version: `${version}`,
    notes,
    pub_date: pubDate,
    platforms: {
        'windows-x86_64': {
            url: artifactUrl,
            signature,
        },
    },
};

const manifestJson = JSON.stringify(manifest, null, 2);
const localManifest = join(REPO_ROOT, 'outputs', 'release', `${CHANNEL}.json`);

// Ensure dir exists
mkdirSync(join(REPO_ROOT, 'outputs', 'release'), { recursive: true });
writeFileSync(localManifest, manifestJson, 'utf-8');
console.log(`\n  Manifest saved locally: ${localManifest}`);

// ── Pre-upload validation ──────────────────────────────────────────────────────
if (!FROM_MANIFEST) {
    const exeSize      = statSync(exePath).size;
    const MIN_EXE_SIZE = 512 * 1024;          // 512 KB  (NSIS-compressed Tauri bundles can be < 1 MiB)
    const MAX_EXE_SIZE = 500 * 1024 * 1024;  // 500 MB

    const validationErrors = [];

    if (!exeName.includes(`_${version}_`)) {
        validationErrors.push(`Installer filename does not contain version ${version}: ${exeName}`);
    }
    if (exeSize < MIN_EXE_SIZE || exeSize > MAX_EXE_SIZE) {
        validationErrors.push(
            `Installer size out of expected range: ${(exeSize / 1_048_576).toFixed(1)} MB ` +
            `(expected 1 MB – 500 MB)`,
        );
    }
    if (!existsSync(exePath + '.sig')) {
        validationErrors.push(`Signature file not found: ${exePath}.sig`);
    }
    if (!signature || signature.trim().length < 10) {
        validationErrors.push('Signature content is empty or suspiciously short');
    }

    if (validationErrors.length > 0) {
        console.error('\n\u274C  Pre-upload validation failed:');
        for (const err of validationErrors) console.error(`    - ${err}`);
        process.exit(1);
    }

    const sha256 = createHash('sha256').update(readFileSync(exePath)).digest('hex');
    console.log(`\n  Pre-upload validation passed:`);
    console.log(`    Size     : ${(exeSize / 1_048_576).toFixed(1)} MB`);
    console.log(`    SHA-256  : ${sha256}`);
    console.log(`    Signature: present (${signature.length} chars)`);
} else {
    // --from-manifest: validate signature field from the manifest
    if (!signature || signature.trim().length < 10) {
        console.error('\n\u274C  Release manifest artifact has no valid signature field');
        process.exit(1);
    }
}
if (!FROM_MANIFEST) {
    const remoteArtifactDir = `/var/www/license-server/releases/artifacts/${version}`;
    run(
        `ssh ${SSH_OPTS} ${HOST} "mkdir -p ${remoteArtifactDir}"`,
        `Creating remote dir ${remoteArtifactDir}`,
    );
    // scp destination: end with '/' so scp uses the source filename (avoids shell-quoting spaces)
    run(
        `scp ${SSH_OPTS} "${exePath}" "${HOST}:${remoteArtifactDir}/"`,
        `Uploading ${exeName} (${(statSync(exePath).size / 1_048_576).toFixed(1)} MB)`,
    );
}

// ── 5. Upload {channel}.json (atomic: tmp → rename) ──────────────────────────
// Upload as {channel}.json.tmp first so the live endpoint is never replaced with
// an incomplete or corrupted file.  Only when the upload succeeds is the file
// atomically renamed to {channel}.json via SSH mv.  This eliminates the window
// where a client could fetch a partial write.
const remoteUpdateDir = `/var/www/license-server/releases/v1/update/windows-x86_64`;
run(
    `ssh ${SSH_OPTS} ${HOST} "mkdir -p ${remoteUpdateDir}"`,
    `Ensuring ${remoteUpdateDir} exists`,
);
run(
    `scp ${SSH_OPTS} "${localManifest}" ${HOST}:${remoteUpdateDir}/${CHANNEL}.json.tmp`,
    `Uploading ${CHANNEL}.json.tmp`,
);
// Server-side sanity check: confirm the tmp file was written with the right version
// before we promote it.  Uses only Python3 (present on every Debian/Ubuntu VPS).
run(
    `ssh ${SSH_OPTS} ${HOST} "python3 -c \\"import json,sys; d=json.load(open('${remoteUpdateDir}/${CHANNEL}.json.tmp')); sys.exit(0 if str(d.get('version','')) == '${version}' else 1)\\" || (echo 'version mismatch - aborting' && exit 1)"`,
    `Validating ${CHANNEL}.json.tmp on server (version == ${version})`,
);
// Atomic rename: clients polling the endpoint see the complete new manifest or
// the old one — never an intermediate state.
run(
    `ssh ${SSH_OPTS} ${HOST} "mv -f ${remoteUpdateDir}/${CHANNEL}.json.tmp ${remoteUpdateDir}/${CHANNEL}.json"`,
    `Promoting ${CHANNEL}.json.tmp → ${CHANNEL}.json (atomic)`,
);

// ── 6. Prune stale artifacts ─────────────────────────────────────────────────
// Policy: the server keeps ONLY the installer versions that are still referenced
// by a live channel manifest (alpha/beta/stable). Since every published release
// updates the channel manifests, this normally collapses to just the newest
// build — so old versions can never be downloaded (directly or via cache) and
// speak a dead protocol. The just-published version is always kept as a safety
// net even if a manifest fails to parse, and the prune aborts (deleting nothing)
// if it cannot resolve any version to keep.
const prunePy = `
import json, os, glob, shutil, sys
UPD = "/var/www/license-server/releases/v1/update/windows-x86_64"
ART = "/var/www/license-server/releases/artifacts"
keep = set()
for f in glob.glob(os.path.join(UPD, "*.json")):
    try:
        with open(f) as fh:
            v = str(json.load(fh).get("version", "")).strip()
        if v:
            keep.add(v)
    except Exception as e:
        print("[prune] WARN could not parse", f, e)
keep.add("${version}")
keep.discard("")
if not keep:
    print("[prune] ABORT: no versions resolved to keep; deleting nothing")
    sys.exit(1)
print("[prune] keeping:", sorted(keep))
removed = []
for name in sorted(os.listdir(ART)):
    p = os.path.join(ART, name)
    if os.path.isdir(p) and name not in keep:
        shutil.rmtree(p)
        removed.append(name)
print("[prune] removed:", removed if removed else "(none)")
`;
const pruneB64 = Buffer.from(prunePy, 'utf-8').toString('base64');
run(
    `ssh ${SSH_OPTS} ${HOST} "echo ${pruneB64} | base64 -d | python3"`,
    'Pruning stale artifacts (keep only versions referenced by channel manifests)',
);

// ── Done + smoke test ───────────────────────────────────────────────────────────────────
console.log(`
✅  Published v${version} [${CHANNEL}]${DRY_RUN ? ' (DRY RUN — nothing was actually uploaded)' : ''}

   Update endpoint : https://license.vizbuka.ru/releases/v1/update/windows-x86_64/update
   Channel manifest: https://license.vizbuka.ru/releases/v1/update/windows-x86_64/${CHANNEL}.json
   Artifact URL    : ${artifactUrl}
`);

if (!DRY_RUN) {
    console.log('\u23f3  Running post-deploy smoke test...\n');
    // Small delay to let the server flush the uploaded files
    await new Promise(r => setTimeout(r, 2000));
    try {
        execSync(
            `node "${join(REPO_ROOT, 'scripts', 'test', 'check-update-endpoint.mjs')}" --version ${version} --channel ${CHANNEL}`,
            { stdio: 'inherit' },
        );
    } catch {
        // check-update-endpoint exits with code 1 on failure — message already printed
        process.exit(1);
    }
}
