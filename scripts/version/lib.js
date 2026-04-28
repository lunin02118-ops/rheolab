/**
 * Shared version-tooling helpers.
 *
 * Single source of truth (SSoT): /version.json at the repo root.
 *
 * Four dependent files MUST be kept in lockstep with the SSoT:
 *   - /package.json                   (npm version field)
 *   - /src-tauri/tauri.conf.json      (Tauri bundle metadata; drives installer name)
 *   - /src-tauri/Cargo.toml           ([package] version; drives Rust binary file metadata)
 *   - /src/lib/version.ts             (frontend APP_VERSION + BUILD_DATE + COMMIT_HASH)
 *
 * The two consumer scripts in this folder do not duplicate file-format logic:
 *   - sync.js     mutates the four dependents until they match the SSoT
 *   - validate.js asserts they already match (read-only) and exits non-zero
 *                 with a colourful diff if they do not
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

// ── Paths ───────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SSOT_PATH = path.join(REPO_ROOT, 'version.json');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');
const TAURI_CONF_PATH = path.join(REPO_ROOT, 'src-tauri', 'tauri.conf.json');
const CARGO_TOML_PATH = path.join(REPO_ROOT, 'src-tauri', 'Cargo.toml');
const VERSION_TS_PATH = path.join(REPO_ROOT, 'src', 'lib', 'version.ts');

// ── ANSI helpers (no chalk dep) ─────────────────────────────────────────────

const NO_COLOR = process.env.NO_COLOR || !process.stdout.isTTY;
const ansi = (code) => (NO_COLOR ? '' : `\x1b[${code}m`);
const C = {
    reset: ansi(0),
    bold: ansi(1),
    dim: ansi(2),
    red: ansi(31),
    green: ansi(32),
    yellow: ansi(33),
    blue: ansi(34),
    cyan: ansi(36),
};

// ── SemVer / channel rules ──────────────────────────────────────────────────

/**
 * Strict SemVer check covering the only formats RheoLab releases use:
 *   - "X.Y.Z"               (stable)
 *   - "X.Y.Z-<tag>.<n>"     (prerelease — alpha.N / beta.N / rc.N)
 *
 * `<tag>` is restricted to lowercase alpha tokens to keep registry / installer
 * filenames predictable. If the spec ever expands (e.g. dev or nightly), update
 * `KNOWN_CHANNELS` below as well.
 */
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/;

const KNOWN_CHANNELS = ['alpha', 'beta', 'rc', 'stable'];

/**
 * Map the `channel` field in version.json to the prerelease tag we expect on
 * the SSoT version. Stable releases have no prerelease tag.
 */
function expectedTagForChannel(channel) {
    switch (channel) {
        case 'alpha': return 'alpha';
        case 'beta':  return 'beta';
        case 'rc':    return 'rc';
        case 'stable': return null;
        default: return undefined;
    }
}

function parseSemver(version) {
    const m = SEMVER_RE.exec(version);
    if (!m) return null;
    return {
        major: Number(m[1]),
        minor: Number(m[2]),
        patch: Number(m[3]),
        tag:   m[4] ?? null,
        pre:   m[5] != null ? Number(m[5]) : null,
    };
}

// ── Read SSoT ───────────────────────────────────────────────────────────────

/**
 * Reads version.json, validates SemVer + channel/tag consistency, and returns
 * `{ version, channel, parsed }`. Throws a single human-readable Error on any
 * problem so callers can `try { … } catch (err) { console.error(err.message); process.exit(1); }`.
 */
function readSsot() {
    if (!fs.existsSync(SSOT_PATH)) {
        throw new Error(
            `version.json not found at ${SSOT_PATH}.\n` +
            `Restore it from git, or create it with:\n` +
            `  { "version": "X.Y.Z[-tag.N]", "channel": "alpha" }`,
        );
    }

    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(SSOT_PATH, 'utf8'));
    } catch (err) {
        throw new Error(`version.json is not valid JSON: ${err.message}`);
    }

    if (typeof raw.version !== 'string' || !raw.version.trim()) {
        throw new Error(`version.json is missing a string "version" field.`);
    }
    const version = raw.version.trim();
    const parsed = parseSemver(version);
    if (!parsed) {
        throw new Error(
            `version.json "version" = "${version}" is not a supported SemVer.\n` +
            `Allowed forms:  X.Y.Z   |   X.Y.Z-alpha.N   |   X.Y.Z-beta.N   |   X.Y.Z-rc.N`,
        );
    }

    const channel = (raw.channel ?? '').toString().trim();
    if (!channel || !KNOWN_CHANNELS.includes(channel)) {
        throw new Error(
            `version.json "channel" = "${channel}" is missing or unknown.\n` +
            `Allowed channels: ${KNOWN_CHANNELS.join(', ')}.`,
        );
    }

    const expected = expectedTagForChannel(channel);
    if (expected === null && parsed.tag !== null) {
        throw new Error(
            `Channel "stable" requires a non-prerelease version (X.Y.Z), got "${version}".`,
        );
    }
    if (expected !== null && parsed.tag !== expected) {
        throw new Error(
            `Channel "${channel}" requires a "-${expected}.<n>" prerelease tag, ` +
            `but version is "${version}" (tag = ${parsed.tag ?? 'none'}).\n` +
            `Either rename the channel or change the version's prerelease tag.`,
        );
    }

    return { version, channel, parsed, raw };
}

// ── Per-file readers ────────────────────────────────────────────────────────

function readPackageJsonVersion() {
    return JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8')).version;
}

function readTauriConfVersion() {
    return JSON.parse(fs.readFileSync(TAURI_CONF_PATH, 'utf8')).version;
}

/**
 * Reads the `version = "..."` field inside the first `[package]` table of
 * Cargo.toml. We do not pull in a TOML parser — the file shape is stable and
 * `toml` would add a runtime dep just for this lookup.
 */
function readCargoTomlVersion() {
    const lines = fs.readFileSync(CARGO_TOML_PATH, 'utf8').split(/\r?\n/);
    let inPackage = false;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[')) {
            inPackage = trimmed === '[package]';
            continue;
        }
        if (inPackage) {
            const m = trimmed.match(/^version\s*=\s*"([^"]+)"/);
            if (m) return m[1];
        }
    }
    return null;
}

function readVersionTsVersion() {
    if (!fs.existsSync(VERSION_TS_PATH)) return null;
    const content = fs.readFileSync(VERSION_TS_PATH, 'utf8');
    const m = content.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
}

// ── Per-file writers ────────────────────────────────────────────────────────

/**
 * Writes a new version into package.json while preserving every other field
 * and the trailing newline npm tooling expects.
 */
function writePackageJsonVersion(version) {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
    if (pkg.version === version) return false;
    pkg.version = version;
    fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(pkg, null, 2) + '\n');
    return true;
}

/**
 * Writes a new version into tauri.conf.json. Tauri historically wants CRLF
 * line endings here on Windows; we mirror what generate-version.js used to do.
 */
function writeTauriConfVersion(version) {
    const conf = JSON.parse(fs.readFileSync(TAURI_CONF_PATH, 'utf8'));
    if (conf.version === version) return false;
    conf.version = version;
    fs.writeFileSync(TAURI_CONF_PATH, JSON.stringify(conf, null, 2) + '\r\n');
    return true;
}

/**
 * In-place rewrites the `[package]` `version = "..."` line in Cargo.toml,
 * keeping every other line — including the rest of `[package]`, comments, and
 * dependency tables — exactly as it was. Preserves the file's existing line
 * endings.
 */
function writeCargoTomlVersion(version) {
    const original = fs.readFileSync(CARGO_TOML_PATH, 'utf8');
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    const lines = original.split(/\r?\n/);

    let inPackage = false;
    let updated = false;
    let found = false;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.startsWith('[')) {
            inPackage = trimmed === '[package]';
            continue;
        }
        if (inPackage && /^version\s*=/.test(trimmed)) {
            found = true;
            const next = `version = "${version}"`;
            if (lines[i] !== next) {
                lines[i] = next;
                updated = true;
            }
            break;
        }
    }

    if (!found) {
        throw new Error(
            `Cargo.toml has no "version = ..." line in its [package] section. ` +
            `version.json cannot be propagated until that field exists.`,
        );
    }

    if (!updated) return false;
    fs.writeFileSync(CARGO_TOML_PATH, lines.join(eol));
    return true;
}

/**
 * Resolves the short git commit hash (or a sensible CI fallback). Used only
 * inside `version.ts` — the SSoT itself never depends on git state.
 */
function resolveCommitHash() {
    try {
        return execSync('git rev-parse --short HEAD', {
            stdio: ['ignore', 'pipe', 'pipe'],
        }).toString().trim();
    } catch {
        const ciHash = process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA;
        if (ciHash && ciHash.length >= 7) return ciHash.slice(0, 7);
        return 'dev';
    }
}

/**
 * Writes the auto-generated TypeScript module consumed by the frontend. Always
 * rewrites because BUILD_DATE / COMMIT_HASH change every run; that is fine —
 * sync.js is meant to be idempotent w.r.t. version *content*, not byte-for-byte
 * file contents.
 */
function writeVersionTs(version) {
    const buildDate = new Date().toISOString().split('T')[0];
    const commitHash = resolveCommitHash();
    const content =
`/**
 * Auto-generated version file
 * Do not edit manually
 *
 * Source of truth: /version.json
 * Run \`npm run version:sync\` to regenerate this file.
 */

export const APP_VERSION = '${version}';
export const BUILD_DATE = '${buildDate}';
export const COMMIT_HASH = '${commitHash}';
`;
    const previous = fs.existsSync(VERSION_TS_PATH)
        ? fs.readFileSync(VERSION_TS_PATH, 'utf8')
        : '';
    if (previous === content) return { changed: false, buildDate, commitHash };
    fs.mkdirSync(path.dirname(VERSION_TS_PATH), { recursive: true });
    fs.writeFileSync(VERSION_TS_PATH, content);
    return { changed: true, buildDate, commitHash };
}

// ── Aggregate snapshot used by validate.js ──────────────────────────────────

/**
 * Returns the *current* version each dependent file claims, alongside the
 * SSoT, so callers can render a one-shot diff. Validation logic itself lives
 * in validate.js so this helper stays purely descriptive.
 */
function snapshotAllVersions() {
    const ssot = readSsot();
    return {
        ssot,
        files: [
            { label: 'package.json',                 path: PACKAGE_JSON_PATH, actual: readPackageJsonVersion() ?? null },
            { label: 'src-tauri/tauri.conf.json',    path: TAURI_CONF_PATH,   actual: readTauriConfVersion()   ?? null },
            { label: 'src-tauri/Cargo.toml',         path: CARGO_TOML_PATH,   actual: readCargoTomlVersion()   ?? null },
            { label: 'src/lib/version.ts',           path: VERSION_TS_PATH,   actual: readVersionTsVersion()   ?? null },
        ],
    };
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
    REPO_ROOT,
    SSOT_PATH,
    PACKAGE_JSON_PATH,
    TAURI_CONF_PATH,
    CARGO_TOML_PATH,
    VERSION_TS_PATH,
    KNOWN_CHANNELS,
    C,
    parseSemver,
    expectedTagForChannel,
    readSsot,
    readPackageJsonVersion,
    readTauriConfVersion,
    readCargoTomlVersion,
    readVersionTsVersion,
    writePackageJsonVersion,
    writeTauriConfVersion,
    writeCargoTomlVersion,
    writeVersionTs,
    resolveCommitHash,
    snapshotAllVersions,
};
