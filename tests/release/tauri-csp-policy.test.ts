import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

type TauriConfig = {
  app?: {
    security?: {
      csp?: string;
      dangerousDisableAssetCspModification?: string[];
    };
  };
};

function readTauriConfig(): TauriConfig {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'),
  ) as TauriConfig;
}

function parseCsp(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();

  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      continue;
    }

    const [name, ...values] = tokens;
    directives.set(name, values);
  }

  return directives;
}

function cspDirectives(): Map<string, string[]> {
  const csp = readTauriConfig().app?.security?.csp;
  expect(csp).toBeTypeOf('string');
  return parseCsp(csp ?? '');
}

describe('tauri CSP policy', () => {
  it('keeps default fallback narrow', () => {
    const defaultSrc = cspDirectives().get('default-src');

    expect(defaultSrc).toEqual(["'self'"]);
    expect(defaultSrc).not.toContain('blob:');
    expect(defaultSrc).not.toContain('data:');
    expect(defaultSrc).not.toContain('*');
  });

  it('does not allow unsafe script execution', () => {
    const scriptSrc = cspDirectives().get('script-src');

    expect(scriptSrc).toEqual(["'self'"]);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).not.toContain('*');
  });

  it('blocks high-risk browser surfaces explicitly', () => {
    const directives = cspDirectives();

    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
    expect(directives.get('form-action')).toEqual(["'none'"]);
  });

  it('keeps external connections pinned to approved hosts', () => {
    const connectSrc = cspDirectives().get('connect-src');

    expect(connectSrc).toEqual([
      "'self'",
      'http://ipc.localhost',
      'https://license.vizbuka.ru',
      'https://api.groq.com',
    ]);
  });

  it('keeps blob and data allowances explicit instead of inherited', () => {
    const directives = cspDirectives();

    expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'blob:']);
    expect(directives.get('font-src')).toEqual(["'self'", 'data:']);
    expect(directives.get('worker-src')).toEqual(["'self'", 'blob:']);
    expect(directives.get('media-src')).toEqual(["'self'", 'blob:']);
    expect(directives.get('manifest-src')).toEqual(["'self'"]);
  });

  it('keeps the Tauri CSP asset-modification exception limited to styles', () => {
    const exceptions = readTauriConfig().app?.security?.dangerousDisableAssetCspModification;

    expect(exceptions).toEqual(['style-src']);
  });
});
