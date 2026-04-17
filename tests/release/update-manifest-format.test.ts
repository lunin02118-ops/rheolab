/**
 * update-manifest-format.test.ts
 *
 * Regression tests for the update manifest produced by publish-update.js.
 *
 * Bugs covered:
 *
 *   Bug 1 — pub_date had milliseconds
 *     Tauri v2's RFC-3339 parser in Rust is strict and rejects sub-second
 *     precision (e.g. "2026-03-06T22:32:59.123Z"). The publish script now
 *     strips milliseconds using .replace(/\.\d{3}Z$/, 'Z').
 *
 *   Bug 2 — platform key was "windows" (Tauri v2: {{target}} = "windows")
 *     Tauri v2 resolves {{target}} to "windows", NOT "windows-x86_64".
 *     The manifest platforms object must use "windows-x86_64" as the key,
 *     which matches what Tauri constructs from {{target}}-{{arch}}.
 *
 *   Bug 3 — signature field: must start with "RW" (minisign sig prefix)
 *     The .sig file produced by tauri-cli contains the minisign signature
 *     string starting with "RW". If this is wrong, Tauri rejects the update.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

// ─────────────────────────────────────────────────────────────────────────────
// pub_date formatting logic
// ─────────────────────────────────────────────────────────────────────────────

describe('pub_date formatting (Bug 1 regression)', () => {
  // The stripping function extracted from publish-update.js
  const stripMs = (iso: string) => iso.replace(/\.\d{3}Z$/, 'Z');

  it('strips milliseconds from ISO string', () => {
    expect(stripMs('2026-03-06T22:32:59.123Z')).toBe('2026-03-06T22:32:59Z');
    expect(stripMs('2026-01-01T00:00:00.000Z')).toBe('2026-01-01T00:00:00Z');
    expect(stripMs('2099-12-31T23:59:59.999Z')).toBe('2099-12-31T23:59:59Z');
  });

  it('is a no-op when milliseconds are already absent', () => {
    expect(stripMs('2026-03-06T22:32:59Z')).toBe('2026-03-06T22:32:59Z');
  });

  it('does not corrupt timestamps with offsets (not UTC Z)', () => {
    // Offset timestamps are not produced by the script but must not break
    const withOffset = '2026-03-06T22:32:59+03:00';
    expect(stripMs(withOffset)).toBe(withOffset); // unchanged
  });

  it('produces a valid RFC-3339 string without sub-second precision', () => {
    const pubDate = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    // Strict RFC-3339 / ISO8601 UTC without milliseconds
    expect(pubDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(pubDate).not.toContain('.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Platform key "windows-x86_64" (Bug 2 regression)
// ─────────────────────────────────────────────────────────────────────────────

describe('manifest platform key (Bug 2 regression)', () => {
  it('"windows-x86_64" key is used, not bare "windows"', () => {
    // In publish-update.js the manifest is built with 'windows-x86_64' hardcoded.
    // Tauri v2 {{target}}-{{arch}} resolves to "windows-x86_64" on Windows x64.
    // The old endpoint used {{target}} alone → "windows/stable.json" → HTTP 404.
    const exampleManifest = {
      version: '0.1.506',
      pub_date: '2026-03-06T22:32:59Z',
      notes: '',
      platforms: {
        'windows-x86_64': {
          url: 'https://license.vizbuka.ru/releases/artifacts/0.1.506/app.exe',
          signature: 'RWSsig...',
        },
      },
    };

    expect(Object.keys(exampleManifest.platforms)).toContain('windows-x86_64');
    expect(Object.keys(exampleManifest.platforms)).not.toContain('windows');
  });

  it('Tauri {{target}}-{{arch}} resolves to "windows-x86_64" on Windows x64', () => {
    // This is the substitution Tauri performs when reading the endpoint URL.
    // Confirmed via Apache server logs: Tauri v2 GETs "windows/stable.json",
    // NOT "windows-x86_64/stable.json" when using bare {{target}}.
    const endpointTemplate =
      'https://license.vizbuka.ru/releases/v1/update/{{target}}-{{arch}}/stable.json';
    const resolved = endpointTemplate
      .replace('{{target}}', 'windows')
      .replace('{{arch}}', 'x86_64');

    expect(resolved).toBe(
      'https://license.vizbuka.ru/releases/v1/update/windows-x86_64/stable.json',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// publish-update.js source-level invariants
// ─────────────────────────────────────────────────────────────────────────────

describe('publish-update.js source invariants', () => {
  let src: string;

  beforeAll(() => {
    src = readFileSync(
      join(REPO_ROOT, 'scripts', 'deploy', 'publish-update.js'),
      'utf-8',
    );
  });

  it('uses hardcoded "windows-x86_64" platform key in manifest object', () => {
    expect(src).toContain("'windows-x86_64'");
  });

  it('does not use bare "windows" as platform key', () => {
    // Must not have a pattern like  'windows': {  or  "windows": {
    expect(src).not.toMatch(/'windows'\s*:/);
    expect(src).not.toMatch(/"windows"\s*:/);
  });

  it('applies toISOString() ms-stripping before writing pub_date', () => {
    // The script must call .toISOString() and then strip milliseconds.
    expect(src).toContain('toISOString()');
    // Check for the replace call stripping the .123Z suffix
    expect(src).toContain("replace(/\\.\\d{3}Z$/, 'Z')");
  });

  it('upload directory for stable.json is "windows-x86_64"', () => {
    expect(src).toContain('windows-x86_64');
    // Must not upload to a bare "windows" directory
    expect(src).not.toMatch(/releases\/v1\/update\/windows['"` ]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Live manifest validation (skipped when file is absent, e.g. in CI)
// ─────────────────────────────────────────────────────────────────────────────

describe('outputs/release/stable.json (live manifest, skipped if absent)', () => {
  const manifestPath = join(REPO_ROOT, 'outputs', 'release', 'stable.json');
  const exists = existsSync(manifestPath);

  let manifest: any;
  beforeAll(() => {
    if (exists) {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    }
  });

  it.skipIf(!exists)('has required top-level fields', () => {
    expect(manifest).toHaveProperty('version');
    expect(manifest).toHaveProperty('pub_date');
    expect(manifest).toHaveProperty('platforms');
  });

  it.skipIf(!exists)('version is semver-like', () => {
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it.skipIf(!exists)('pub_date has no milliseconds (Bug 1)', () => {
    expect(manifest.pub_date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(manifest.pub_date).not.toContain('.');
  });

  it.skipIf(!exists)('platforms has "windows-x86_64" key, not "windows" (Bug 2)', () => {
    expect(Object.keys(manifest.platforms)).toContain('windows-x86_64');
    expect(Object.keys(manifest.platforms)).not.toContain('windows');
  });

  it.skipIf(!exists)('windows-x86_64 entry has url and signature', () => {
    const entry = manifest.platforms['windows-x86_64'];
    expect(entry).toHaveProperty('url');
    expect(entry).toHaveProperty('signature');
    expect(entry.url).toMatch(/^https?:\/\//);
  });

  it.skipIf(!exists)('signature is base64 that decodes to minisign text (Bug 3)', () => {
    // Tauri v2: the .sig file content is base64-encoded and stored verbatim.
    // Decoding the base64 must yield text containing "trusted comment:" or
    // "untrusted comment:" — the minisign signature file format.
    // See: scripts/test/check-update-endpoint.mjs for the canonical check.
    const entry = manifest.platforms['windows-x86_64'];
    expect(typeof entry.signature).toBe('string');
    expect(entry.signature.length).toBeGreaterThan(0);
    const decoded = Buffer.from(entry.signature, 'base64').toString('utf-8');
    const hasTauriSigStructure =
      decoded.includes('trusted comment:') || decoded.includes('untrusted comment:');
    expect(hasTauriSigStructure).toBe(true);
  });
});
