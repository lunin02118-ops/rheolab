import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import updaterConfigUtils from '../../scripts/release/lib/tauri-updater-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

 
const utils = updaterConfigUtils as any;
const {
  parseEndpointsOverride,
  setChannelOnEndpoint,
  patchTauriUpdaterConfig,
} = utils;

describe('tauri-updater-config', () => {
  it('parses endpoint overrides from comma/newline separated string', () => {
    const parsed = parseEndpointsOverride(
      'https://a.example.com/latest.json, https://b.example.com/latest.json\nhttps://c.example.com/latest.json',
    );

    expect(parsed).toEqual([
      'https://a.example.com/latest.json',
      'https://b.example.com/latest.json',
      'https://c.example.com/latest.json',
    ]);
  });

  it('replaces channel query for static url endpoint', () => {
    const result = setChannelOnEndpoint(
      'https://updates.rheolab.local/v2/windows/current?channel=stable',
      'beta',
    );

    expect(result).toBe('https://updates.rheolab.local/v2/windows/current?channel=beta');
  });

  it('keeps template endpoints unchanged', () => {
    const result = setChannelOnEndpoint(
      'https://updates.rheolab.local/v2/{{target}}/{{current_version}}?channel={{channel}}',
      'internal',
    );

    expect(result).toBe('https://updates.rheolab.local/v2/{{target}}/{{current_version}}?channel={{channel}}');
  });

  it('applies env pubkey override and channel adjustment', () => {
    const patch = patchTauriUpdaterConfig({
      channel: 'beta',
      env: {
        RHEOLAB_UPDATER_PUBKEY: 'real-updater-pubkey-value',
      },
      tauriConfig: {
        plugins: {
          updater: {
            endpoints: [
              'https://updates.rheolab.local/v2/{{target}}/{{current_version}}?channel=stable',
            ],
            pubkey: 'REPLACE_WITH_TAURI_UPDATER_PUBKEY',
          },
        },
      },
    });

    expect(patch.mutated).toBe(true);
    expect(patch.usedEnvPubkey).toBe(true);
    expect(patch.config.plugins.updater.pubkey).toBe('real-updater-pubkey-value');
    expect(patch.config.plugins.updater.endpoints).toEqual([
      'https://updates.rheolab.local/v2/{{target}}/{{current_version}}?channel=beta',
    ]);
  });

  it('applies env endpoints override and then pins selected channel', () => {
    const patch = patchTauriUpdaterConfig({
      channel: 'internal',
      env: {
        RHEOLAB_UPDATER_ENDPOINTS:
          'https://u1.example.com/latest.json?channel=stable,https://u2.example.com/latest.json',
      },
      tauriConfig: {
        plugins: {
          updater: {
            endpoints: ['https://fallback.example.com/latest.json?channel=stable'],
            pubkey: 'real-key',
          },
        },
      },
    });

    expect(patch.usedEnvEndpoints).toBe(true);
    expect(patch.config.plugins.updater.endpoints).toEqual([
      'https://u1.example.com/latest.json?channel=internal',
      'https://u2.example.com/latest.json?channel=internal',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression tests for the production bugs discovered in March 2026
//
// Bug 1 — {{target}} = "windows" NOT "windows-x86_64"
//   Tauri v2 resolves {{target}} to the OS name ("windows"), not the full
//   platform string. The endpoint must use {{target}}-{{arch}} to produce
//   "windows-x86_64", otherwise the server returns 404.
//
// Bug 2 — pubkey format (bare key vs full .pub file)
//   Tauri v2 verify_signature() calls base64_to_string(pub_key) which
//   base64-decodes the key and then expects valid UTF-8. A bare minisign key
//   (56 chars starting with "RWT...") decodes to binary → Error::SignatureUtf8.
//   The pubkey value must be a base64-encoded FULL .pub file, which includes
//   the "untrusted comment: minisign public key: ...\n" header, making the
//   decoded bytes valid UTF-8.
// ─────────────────────────────────────────────────────────────────────────────
describe('tauri.conf.json — production values (regression)', () => {
  let conf: any;

  beforeAll(() => {
    const raw = readFileSync(
      join(REPO_ROOT, 'src-tauri', 'tauri.conf.json'),
      'utf-8',
    );
    conf = JSON.parse(raw);
  });

  // ── Bug 1: {{target}} template variable ──────────────────────────────────

  it('endpoint uses {{target}}-{{arch}}, not bare {{target}}', () => {
    // Regression: using {{target}} alone produced "windows/stable.json" → 404
    // because Tauri v2 {{target}} = "windows", not "windows-x86_64".
    const endpoints: string[] = conf.plugins.updater.endpoints;
    expect(endpoints.length).toBeGreaterThan(0);
    for (const ep of endpoints) {
      expect(ep, `endpoint should contain {{target}}-{{arch}}: ${ep}`)
        .toMatch(/\{\{target\}\}-\{\{arch\}\}/);
      // Should never have {{target}} immediately followed by / or EOL (bare target)
      expect(ep, `endpoint must not use bare {{target}}: ${ep}`)
        .not.toMatch(/\{\{target\}\}(?:[^-]|$)/);
    }
  });

  it('endpoint resolves to "windows-x86_64" path (not "windows")', () => {
    const endpoints: string[] = conf.plugins.updater.endpoints;
    for (const ep of endpoints) {
      const resolved = ep
        .replace('{{target}}', 'windows')
        .replace('{{arch}}', 'x86_64');
      expect(resolved).toContain('windows-x86_64');
      expect(resolved).not.toMatch(/\/windows\/|\/windows$/);
    }
  });

  // ── Bug 2: pubkey format ──────────────────────────────────────────────────

  it('pubkey is valid base64', () => {
    const pubkey: string = conf.plugins.updater.pubkey;
    expect(pubkey).toBeTruthy();
    // Must be valid base64 — Buffer.from does not throw
    const decoded = Buffer.from(pubkey, 'base64');
    expect(decoded.length).toBeGreaterThan(0);
  });

  it('decoded pubkey is valid UTF-8 (Tauri v2 calls from_utf8() on it)', () => {
    // Regression: bare "RWT..." key decodes to ~42 binary bytes → from_utf8() fails
    // → Error::SignatureUtf8 — "signature could not be decoded"
    const pubkey: string = conf.plugins.updater.pubkey;
    const decoded = Buffer.from(pubkey, 'base64').toString('utf-8');
    // No UTF-8 replacement character — means the bytes are valid UTF-8 text
    expect(decoded).not.toContain('\ufffd');
  });

  it('decoded pubkey starts with "untrusted comment:" (full minisign .pub format)', () => {
    // A bare key like "RWT..." starts with binary after base64-decode.
    // The full .pub file begins with the ASCII text "untrusted comment:" — only
    // this format survives Tauri v2's from_utf8() check.
    const pubkey: string = conf.plugins.updater.pubkey;
    const decoded = Buffer.from(pubkey, 'base64').toString('utf-8');
    expect(decoded.trim()).toMatch(/^untrusted comment:/);
  });

  it('decoded pubkey second line starts with "RWT" (minisign key prefix)', () => {
    const pubkey: string = conf.plugins.updater.pubkey;
    const decoded = Buffer.from(pubkey, 'base64').toString('utf-8');
    const lines = decoded.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[1].trim()).toMatch(/^RWT/);
  });

  it('pubkey matches src-tauri/keys/updater.key.pub on disk', () => {
    // Single source of truth: the .pub file is the authoritative key.
    // tauri.conf.json must contain exactly the same base64 content.
    const pubkeyInConf: string = conf.plugins.updater.pubkey.trim();
    const keyFileContent = readFileSync(
      join(REPO_ROOT, 'src-tauri', 'keys', 'updater.key.pub'),
      'utf-8',
    ).trim();
    expect(pubkeyInConf).toBe(keyFileContent);
  });
});
