#!/usr/bin/env node
/**
 * check-update-endpoint.js
 *
 * Smoke-tests the auto-update pipeline end-to-end without installing anything.
 * Simulates exactly what tauri-plugin-updater does:
 *   1. Fetches the manifest from the live server (all known URL patterns)
 *   2. Validates JSON schema (required fields, types, formats)
 *   3. Checks the artifact URL is reachable (HEAD request)
 *   4. Validates signature format (base64, Tauri minisign structure)
 *   5. Verifies pub_date is valid RFC 3339 without sub-second precision
 *   6. Compares manifest version against local package.json
 *
 * Usage:
 *   node scripts/test/check-update-endpoint.js
 *   node scripts/test/check-update-endpoint.js --version 0.1.500
 *   node scripts/test/check-update-endpoint.js --base-url https://license.vizbuka.ru
 *   node scripts/test/check-update-endpoint.js --manifest outputs/release/beta.json --channel beta
 *
 * Exit codes:
 *   0  All checks passed
 *   1  One or more checks failed
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    DEFAULT_UPDATE_ARCH,
    DEFAULT_UPDATE_BASE_URL,
    DEFAULT_UPDATE_TARGET,
    buildUpdaterContractUrls,
    checkDownloadUrlReachability,
    validateUpdateManifestContract,
} from '../release/lib/updater-contract.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dir, '..', '..');

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argMap = {};
for (let i = 0; i < args.length; i += 2) {
    if (args[i].startsWith('--')) argMap[args[i].slice(2)] = args[i + 1] ?? true;
}

const BASE_URL = argMap['base-url'] ?? DEFAULT_UPDATE_BASE_URL;
const TIMEOUT_MS = Number(argMap['timeout'] ?? 10000);
const CHANNEL = (argMap['channel'] ?? 'stable').toLowerCase();
const MANIFEST_PATH = argMap['manifest'] ?? null;
const ALLOWED_ARTIFACT_HOSTS = (() => {
    const hosts = new Set(['license.vizbuka.ru']);
    try {
        hosts.add(new URL(BASE_URL).hostname);
    } catch {
        // Invalid base-url is reported later by endpoint fetch/build logic.
    }
    return Array.from(hosts);
})();

// Read local version from package.json
const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
const LOCAL_VERSION = argMap['version'] ?? pkg.version;

// ── Helpers ───────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function ok(label) {
    console.log(`  ✅ ${label}`);
    passed++;
}

function fail(label, detail = '') {
    console.error(`  ❌ ${label}${detail ? `\n       ${detail}` : ''}`);
    failed++;
}

function warn(label) {
    console.warn(`  ⚠️  ${label}`);
}

async function fetchWithTimeout(url, options = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}

// ── 1. Build list of URLs to test ─────────────────────────────────────────────
// Mirrors what tauri-plugin-updater sends, accounting for all endpoint formats
// used across our release history.
const TARGET = DEFAULT_UPDATE_TARGET;
const ARCH   = DEFAULT_UPDATE_ARCH;
// In Tauri v2, {{target}} resolves to the combined OS-ARCH string (e.g. windows-x86_64),
// NOT just the OS name. The old endpoint format was {{target}}/{{arch}}/{{current_version}}.
const LEGACY_TARGET = TARGET;  // same — windows-x86_64

const urlsToTest = buildUpdaterContractUrls({
    baseUrl: BASE_URL,
    channel: CHANNEL,
    localVersion: LOCAL_VERSION,
    target: LEGACY_TARGET,
    arch: ARCH,
});

// ── 2. Schema validator ────────────────────────────────────────────────────────
function validateManifest(manifest, urlLabel) {
    console.log(`\n  Validating manifest from: ${urlLabel}`);

    const result = validateUpdateManifestContract(manifest, {
        target: TARGET,
        allowedHosts: ALLOWED_ARTIFACT_HOSTS,
    });
    for (const check of result.checks) {
        if (check.status === 'pass') {
            ok(check.label);
        } else if (check.status === 'warn') {
            warn(`${check.label}${check.detail ? ` (${check.detail})` : ''}`);
        } else {
            fail(check.label, check.detail);
        }
    }

    return result.platformEntry;
}

async function checkArtifactUrl(url) {
    const headRes = await checkDownloadUrlReachability(url, { timeoutMs: TIMEOUT_MS });
    if (!headRes.ok) {
        if (headRes.error) {
            fail(`Artifact URL reachable: ${headRes.error}`);
        } else {
            fail(`Artifact URL HTTP 200: got ${headRes.status}`);
        }
        return null;
    }

    const remoteSize = headRes.contentLength;
    const remoteMB   = remoteSize ? (Number(remoteSize) / 1_048_576).toFixed(1) : null;
    ok(`Artifact URL returns HTTP 200${remoteMB ? ` (${remoteMB} MB)` : ''}`);
    return { remoteSize, remoteMB };
}

async function runLocalManifestSmoke() {
    console.log(`\n🔍  RheoLab Update Manifest Contract Checker`);
    console.log(`    Manifest      : ${MANIFEST_PATH}`);
    console.log(`    Target        : ${TARGET}`);
    console.log(`    Channel       : ${CHANNEL}`);
    console.log(`    Timeout       : ${TIMEOUT_MS}ms\n`);

    let manifest;
    try {
        manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
    } catch (err) {
        fail(`Manifest file is readable JSON: ${err.message}`);
        manifest = null;
    }

    const platformEntry = manifest ? validateManifest(manifest, MANIFEST_PATH) : null;
    if (platformEntry?.url) {
        console.log(`\n──────────────────────────────────────────`);
        console.log(`📦  Artifact reachability check`);
        console.log(`    ${platformEntry.url}`);
        await checkArtifactUrl(platformEntry.url);
    }

    printSummary();
}

function printSummary() {
    console.log(`\n══════════════════════════════════════════`);
    if (failed === 0) {
        console.log(`✅  All ${passed} checks passed. Update pipeline healthy.\n`);
    } else {
        console.error(`❌  ${failed} check(s) FAILED, ${passed} passed.\n`);
        process.exit(1);
    }
}

// ── 3. Run all checks ──────────────────────────────────────────────────────────
async function run() {
    if (MANIFEST_PATH) {
        await runLocalManifestSmoke();
        return;
    }

    console.log(`\n🔍  RheoLab Update Endpoint Checker`);
    console.log(`    Local version : ${LOCAL_VERSION}`);
    console.log(`    Base URL      : ${BASE_URL}`);
    console.log(`    Target        : ${TARGET}`);
    console.log(`    Channel       : ${CHANNEL}`);
    console.log(`    Timeout       : ${TIMEOUT_MS}ms\n`);

    let manifestForArtifactCheck = null;

    for (const entry of urlsToTest) {
        console.log(`\n──────────────────────────────────────────`);
        console.log(`📡  ${entry.label}`);
        console.log(`    ${entry.url}`);

        let res;
        try {
            res = await fetchWithTimeout(entry.url, entry.headers ? { headers: entry.headers } : {});
        } catch (err) {
            fail(`HTTP reachable: ${err.message}`);
            continue;
        }

        if (res.status === 200) {
            ok(`HTTP 200`);
        } else if (res.status === 204) {
            ok(`HTTP 204 (no update — server says up to date)`);
            continue;
        } else {
            fail(`HTTP status: got ${res.status}`, `URL: ${entry.url}`);
            continue;
        }

        // Content-Type check
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('application/json')) {
            ok(`Content-Type: ${ct.split(';')[0].trim()}`);
        } else {
            fail(`Content-Type is application/json: got "${ct}"`,
                'Apache may be serving an error page or wrong MIME type');
        }

        // Parse JSON
        let manifest;
        try {
            manifest = await res.json();
        } catch (err) {
            fail(`Response body is valid JSON: ${err.message}`);
            continue;
        }
        ok('Response body is valid JSON');

        // Schema validation
        const platformEntry = validateManifest(manifest, entry.label);

        // Version comparison
        if (manifest.version) {
            const clean = (v) => v.replace(/^v/, '');
            const parts = (v) => clean(v).split('.').map(Number);
            const [sM, sm, sp] = parts(manifest.version);
            const [lM, lm, lp] = parts(LOCAL_VERSION);
            const isNewer =
                sM > lM || (sM === lM && sm > lm) || (sM === lM && sm === lm && sp > lp);
            const isSame =
                sM === lM && sm === lm && sp === lp;

            if (isNewer) {
                ok(`Server version ${manifest.version} > local ${LOCAL_VERSION} → update would be offered`);
            } else if (isSame) {
                warn(`Server version ${manifest.version} === local ${LOCAL_VERSION} → Tauri will report "no update"`);
            } else {
                warn(`Server version ${manifest.version} < local ${LOCAL_VERSION} → Tauri would not offer downgrade`);
            }
        }

        // Use the primary (direct {channel}.json) endpoint for artifact comparison;
        // fall back to any endpoint if primary wasn't reached.
        if (platformEntry?.url && (!manifestForArtifactCheck || entry.isPrimary)) {
            manifestForArtifactCheck = { ...platformEntry, version: manifest.version };
        }
    }

    // ── 4. Check artifact URL + Content-Length vs local size ──────────────────
    if (manifestForArtifactCheck?.url) {
        console.log(`\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
        console.log(`\uD83D\uDCE6  Artifact reachability check`);
        console.log(`    ${manifestForArtifactCheck.url}`);
        try {
            const artifactCheck = await checkArtifactUrl(manifestForArtifactCheck.url);
            if (artifactCheck) {
                const { remoteSize, remoteMB } = artifactCheck;

                // Compare Content-Length against local installer if available
                const localManifestPath = join(REPO_ROOT, 'outputs', 'release', `${CHANNEL}.json`);
                if (remoteSize && existsSync(localManifestPath)) {
                    try {
                        const localManifest = JSON.parse(readFileSync(localManifestPath, 'utf-8'));
                        const artifactName  = decodeURIComponent(
                            manifestForArtifactCheck.url.split('/').pop() ?? '',
                        );
                        // Find local NSIS dir and look for matching artifact
                        const nsisDir   = join(REPO_ROOT, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
                        const nsisPath  = join(nsisDir, artifactName);
                        if (existsSync(nsisPath)) {
                            const localSize = statSync(nsisPath).size;
                            if (localSize === Number(remoteSize)) {
                                ok(`Remote Content-Length matches local installer size (${(localSize / 1_048_576).toFixed(1)} MB)`);
                            } else {
                                fail(
                                    `Remote Content-Length (${remoteMB} MB) does not match local installer (${(localSize / 1_048_576).toFixed(1)} MB)`,
                                    'The uploaded artifact may differ from the locally built installer',
                                );
                            }
                        }

                        // Compare remote manifest signature against local {channel}.json
                        const remoteSignature = manifestForArtifactCheck.signature?.trim();
                        const localSignature  = localManifest?.platforms?.['windows-x86_64']?.signature?.trim();
                        if (remoteSignature && localSignature) {
                            if (remoteSignature === localSignature) {
                                ok(`Remote manifest signature matches local ${CHANNEL}.json`);
                            } else {
                                fail(
                                    `Remote manifest signature does not match local ${CHANNEL}.json`,
                                    `The live ${CHANNEL}.json may have been modified after upload, or a different build was published`,
                                );
                            }
                        }

                        // Compare version
                        const remoteVersion = manifestForArtifactCheck.version ?? null;
                        const localVersion  = localManifest?.version ?? null;
                        if (remoteVersion && localVersion) {
                            if (remoteVersion === localVersion) {
                                ok(`Remote manifest version (${remoteVersion}) matches local ${CHANNEL}.json`);
                            } else {
                                fail(
                                    `Remote version (${remoteVersion}) does not match local ${CHANNEL}.json version (${localVersion})`,
                                    'Re-run publish-update.js or check that the correct build was deployed',
                                );
                            }
                        }
                    } catch {
                        // Non-fatal: local manifest missing or parse error, skip comparison
                    }
                }
            }
        } catch (err) {
            fail(`Artifact URL reachable: ${err.message}`);
        }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    printSummary();
}

run().catch((err) => {
    console.error('\nFatal:', err);
    process.exit(1);
});
