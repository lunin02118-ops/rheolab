import { describe, expect, it } from 'vitest';
import * as updaterContract from '../../scripts/release/lib/updater-contract.mjs';

const contract = updaterContract as any;
const {
  buildUpdaterContractUrls,
  checkDownloadUrlReachability,
  validateDownloadUrlContract,
  validateSignatureContract,
  validateUpdateManifestContract,
} = contract;

const validSignature = Buffer.from(
  [
    'untrusted comment: signature from tauri secret key',
    'RUTexampleSignaturePayload',
    'trusted comment: timestamp:1781244680\tfile:RheoLab Enterprise_0.2.3-alpha.23_x64-setup.exe',
    'VQ8exampleTrustedSignaturePayload',
  ].join('\n'),
  'utf8',
).toString('base64');

const validManifest = {
  version: '0.2.3-alpha.23',
  notes: 'Release notes',
  pub_date: '2026-06-12T09:18:24Z',
  platforms: {
    'windows-x86_64': {
      url: 'https://license.vizbuka.ru/releases/artifacts/0.2.3-alpha.23/RheoLab%20Enterprise_0.2.3-alpha.23_x64-setup.exe',
      signature: validSignature,
    },
  },
};

describe('updater contract smoke', () => {
  it('builds current, direct manifest, and legacy endpoint URLs', () => {
    const urls = buildUpdaterContractUrls({
      baseUrl: 'https://license.vizbuka.ru/',
      channel: 'beta',
      localVersion: '0.2.3-alpha.19',
    });

    expect(urls).toHaveLength(3);
    expect(urls[0]).toMatchObject({
      url: 'https://license.vizbuka.ru/releases/v1/update/windows-x86_64/update',
      headers: { 'X-Update-Channel': 'beta' },
    });
    expect(urls[1]).toMatchObject({
      url: 'https://license.vizbuka.ru/releases/v1/update/windows-x86_64/beta.json',
      isPrimary: true,
    });
    expect(urls[2].url).toBe(
      'https://license.vizbuka.ru/releases/v1/update/windows-x86_64/x86_64/0.2.3-alpha.19?channel=beta',
    );
  });

  it('validates update manifest schema, signature, and download URL contract', () => {
    const result = validateUpdateManifestContract(validManifest);

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.platformEntry?.url).toBe(validManifest.platforms['windows-x86_64'].url);
    expect(result.checks.map((check: { label: string }) => check.label)).toContain(
      'platforms.windows-x86_64.signature has Tauri minisign structure',
    );
    expect(result.checks.map((check: { label: string }) => check.label)).toContain(
      'platforms.windows-x86_64.url filename includes exact version',
    );
  });

  it('rejects signatures that are not strict base64 minisign payloads', () => {
    const malformed = validateSignatureContract('not-base64!!!');
    expect(malformed.valid).toBe(false);
    expect(malformed.issues.join('\n')).toMatch(/strict base64/);

    const wrongShape = validateSignatureContract(Buffer.from('plain text').toString('base64'));
    expect(wrongShape.valid).toBe(false);
    expect(wrongShape.issues.join('\n')).toMatch(/minisign structure/);
  });

  it('rejects download URLs outside the release artifact tree', () => {
    const result = validateDownloadUrlContract(
      'http://evil.example.com/releases/artifacts/0.2.3-alpha.23/RheoLab%20Enterprise_0.2.3-alpha.23_x64-setup.exe',
      { expectedVersion: '0.2.3-alpha.23' },
    );

    expect(result.valid).toBe(false);
    expect(result.issues.join('\n')).toMatch(/HTTPS/);
    expect(result.issues.join('\n')).toMatch(/host is allowed/);
  });

  it('rejects manifest URL/version drift', () => {
    const manifest = {
      ...validManifest,
      version: '0.2.3-alpha.24',
    };
    const result = validateUpdateManifestContract(manifest);

    expect(result.valid).toBe(false);
    expect(result.issues.join('\n')).toMatch(/version artifact directory/);
    expect(result.issues.join('\n')).toMatch(/filename includes exact version/);
  });

  it('checks download URL reachability with HEAD', async () => {
    const calls: Array<{ url: string; method?: string; redirect?: string }> = [];
    const fetchImpl = async (url: string, options: { method?: string; redirect?: string }) => {
      calls.push({ url, method: options.method, redirect: options.redirect });
      return {
        status: 200,
        headers: {
          get(name: string) {
            return name.toLowerCase() === 'content-length' ? '1048576' : null;
          },
        },
      };
    };

    const result = await checkDownloadUrlReachability(
      validManifest.platforms['windows-x86_64'].url,
      { fetchImpl },
    );

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      contentLength: '1048576',
    });
    expect(calls).toEqual([
      {
        url: validManifest.platforms['windows-x86_64'].url,
        method: 'HEAD',
        redirect: 'manual',
      },
    ]);
  });

  it('rejects artifact redirects instead of accepting download pages', async () => {
    const result = await checkDownloadUrlReachability(
      validManifest.platforms['windows-x86_64'].url,
      {
        fetchImpl: async (_url: string, _options: { method?: string; redirect?: string }) => ({
          status: 302,
          headers: {
            get(name: string) {
              return name.toLowerCase() === 'location'
                ? 'https://rheolab.site/download/latest/'
                : null;
            },
          },
        }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(302);
    expect(result.issue).toMatch(/redirected/);
  });

  it('rejects artifact responses without a positive content length', async () => {
    const result = await checkDownloadUrlReachability(
      validManifest.platforms['windows-x86_64'].url,
      {
        fetchImpl: async (_url: string, _options: { method?: string; redirect?: string }) => ({
          status: 200,
          headers: {
            get() {
              return null;
            },
          },
        }),
      },
    );

    expect(result.ok).toBe(false);
    expect(result.issue).toMatch(/Content-Length/);
  });
});
