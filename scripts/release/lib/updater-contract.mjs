export const DEFAULT_UPDATE_TARGET = 'windows-x86_64';
export const DEFAULT_UPDATE_ARCH = 'x86_64';
export const DEFAULT_UPDATE_BASE_URL = 'https://license.vizbuka.ru';
export const VALID_UPDATE_CHANNELS = new Set(['alpha', 'beta', 'stable']);

const SEMVER_RE = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?(\+[0-9A-Za-z-.]+)?$/;
const RFC3339_NO_MS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;
const RFC3339_MS_RE = /\.\d+/;

function addCheck(result, status, label, detail = '') {
  const check = { status, label, detail };
  result.checks.push(check);
  if (status === 'fail') {
    result.issues.push(detail ? `${label}: ${detail}` : label);
  } else if (status === 'warn') {
    result.warnings.push(detail ? `${label}: ${detail}` : label);
  }
}

function normalizeBaseUrl(baseUrl) {
  const parsed = new URL(baseUrl || DEFAULT_UPDATE_BASE_URL);
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export function normalizeUpdateChannel(channel) {
  const normalized = String(channel || 'stable').trim().toLowerCase();
  if (!VALID_UPDATE_CHANNELS.has(normalized)) {
    throw new Error(
      `Unknown update channel "${normalized}". Expected one of: ${Array.from(VALID_UPDATE_CHANNELS).join(', ')}`,
    );
  }
  return normalized;
}

export function buildUpdaterContractUrls({
  baseUrl = DEFAULT_UPDATE_BASE_URL,
  channel = 'stable',
  localVersion,
  target = DEFAULT_UPDATE_TARGET,
  arch = DEFAULT_UPDATE_ARCH,
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedChannel = normalizeUpdateChannel(channel);
  const version = localVersion || '0.0.0';

  return [
    {
      label: `Current endpoint  -- {{target}}/update (channel: ${normalizedChannel})`,
      url: `${normalizedBaseUrl}/releases/v1/update/${target}/update`,
      headers: { 'X-Update-Channel': normalizedChannel },
      expectJson: true,
    },
    {
      label: `Channel manifest  -- {{target}}/${normalizedChannel}.json`,
      url: `${normalizedBaseUrl}/releases/v1/update/${target}/${normalizedChannel}.json`,
      expectJson: true,
      isPrimary: true,
    },
    {
      label: `Legacy endpoint   -- {{target}}/{{arch}}/{{version}}?channel=${normalizedChannel}`,
      url: `${normalizedBaseUrl}/releases/v1/update/${target}/${arch}/${encodeURIComponent(version)}?channel=${encodeURIComponent(normalizedChannel)}`,
      expectJson: true,
    },
  ];
}

export function isStrictBase64(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length % 4 !== 0) {
    return false;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    return false;
  }

  return Buffer.from(trimmed, 'base64').toString('base64') === trimmed;
}

export function validateSignatureContract(signature, { target = DEFAULT_UPDATE_TARGET } = {}) {
  const result = { valid: true, issues: [], warnings: [], checks: [], decoded: null };
  const labelPrefix = `platforms.${target}.signature`;

  if (typeof signature !== 'string' || !signature.trim()) {
    addCheck(result, 'fail', `${labelPrefix} present`);
    result.valid = false;
    return result;
  }
  addCheck(result, 'pass', `${labelPrefix} present`);

  const trimmed = signature.trim();
  if (!isStrictBase64(trimmed)) {
    addCheck(result, 'fail', `${labelPrefix} is strict base64`);
    result.valid = false;
    return result;
  }
  addCheck(result, 'pass', `${labelPrefix} is strict base64`);

  const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
  result.decoded = decoded;
  if (decoded.includes('\ufffd')) {
    addCheck(result, 'fail', `${labelPrefix} decodes as UTF-8`);
    result.valid = false;
  } else {
    addCheck(result, 'pass', `${labelPrefix} decodes as UTF-8`);
  }

  const hasMinisignStructure =
    decoded.includes('trusted comment:') || decoded.includes('untrusted comment:');
  if (!hasMinisignStructure) {
    addCheck(
      result,
      'fail',
      `${labelPrefix} has Tauri minisign structure`,
      'decoded base64 must contain a trusted or untrusted minisign comment',
    );
    result.valid = false;
  } else {
    addCheck(result, 'pass', `${labelPrefix} has Tauri minisign structure`);
  }

  return result;
}

export function validateDownloadUrlContract(urlValue, {
  expectedVersion,
  target = DEFAULT_UPDATE_TARGET,
  allowedHosts = ['license.vizbuka.ru'],
  requireHttps = true,
} = {}) {
  const result = { valid: true, issues: [], warnings: [], checks: [], url: null };
  const labelPrefix = `platforms.${target}.url`;

  if (typeof urlValue !== 'string' || !urlValue.trim()) {
    addCheck(result, 'fail', `${labelPrefix} present`);
    result.valid = false;
    return result;
  }
  addCheck(result, 'pass', `${labelPrefix} present`);

  let parsed;
  try {
    parsed = new URL(urlValue);
    result.url = parsed;
    addCheck(result, 'pass', `${labelPrefix} is valid URL`);
  } catch {
    addCheck(result, 'fail', `${labelPrefix} is valid URL`, urlValue);
    result.valid = false;
    return result;
  }

  if (requireHttps && parsed.protocol !== 'https:') {
    addCheck(result, 'fail', `${labelPrefix} uses HTTPS`, parsed.protocol);
    result.valid = false;
  } else {
    addCheck(result, 'pass', `${labelPrefix} uses HTTPS`);
  }

  if (allowedHosts.length > 0 && !allowedHosts.includes(parsed.hostname)) {
    addCheck(
      result,
      'fail',
      `${labelPrefix} host is allowed`,
      `got ${parsed.hostname}; expected one of ${allowedHosts.join(', ')}`,
    );
    result.valid = false;
  } else {
    addCheck(result, 'pass', `${labelPrefix} host is allowed`);
  }

  const decodedPath = decodeURIComponent(parsed.pathname);
  if (!decodedPath.startsWith('/releases/artifacts/')) {
    addCheck(result, 'fail', `${labelPrefix} points to release artifacts tree`);
    result.valid = false;
  } else {
    addCheck(result, 'pass', `${labelPrefix} points to release artifacts tree`);
  }

  if (decodedPath.includes('..')) {
    addCheck(result, 'fail', `${labelPrefix} has no traversal segments`);
    result.valid = false;
  } else {
    addCheck(result, 'pass', `${labelPrefix} has no traversal segments`);
  }

  const fileName = decodedPath.split('/').pop() || '';
  if (!fileName.endsWith('_x64-setup.exe')) {
    addCheck(result, 'fail', `${labelPrefix} names Windows x64 NSIS installer`, fileName);
    result.valid = false;
  } else {
    addCheck(result, 'pass', `${labelPrefix} names Windows x64 NSIS installer`);
  }

  if (expectedVersion) {
    const versionSegment = `/${expectedVersion}/`;
    const fileVersionSegment = `_${expectedVersion}_`;
    if (!decodedPath.includes(versionSegment)) {
      addCheck(result, 'fail', `${labelPrefix} includes version artifact directory`, expectedVersion);
      result.valid = false;
    } else {
      addCheck(result, 'pass', `${labelPrefix} includes version artifact directory`);
    }

    if (!fileName.includes(fileVersionSegment)) {
      addCheck(result, 'fail', `${labelPrefix} filename includes exact version`, expectedVersion);
      result.valid = false;
    } else {
      addCheck(result, 'pass', `${labelPrefix} filename includes exact version`);
    }
  }

  return result;
}

function mergeChildResult(parent, child) {
  for (const check of child.checks) {
    parent.checks.push(check);
  }
  parent.issues.push(...child.issues);
  parent.warnings.push(...child.warnings);
  parent.valid = parent.valid && child.valid;
}

export function validateUpdateManifestContract(manifest, {
  target = DEFAULT_UPDATE_TARGET,
  allowedHosts = ['license.vizbuka.ru'],
  requireHttps = true,
} = {}) {
  const result = {
    valid: true,
    issues: [],
    warnings: [],
    checks: [],
    platformEntry: null,
    version: null,
  };

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    addCheck(result, 'fail', 'manifest is an object');
    result.valid = false;
    return result;
  }
  addCheck(result, 'pass', 'manifest is an object');

  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    addCheck(result, 'fail', 'version field present and non-empty');
    result.valid = false;
  } else if (!SEMVER_RE.test(manifest.version.trim())) {
    addCheck(result, 'fail', `version is valid SemVer: "${manifest.version}"`);
    result.valid = false;
  } else {
    result.version = manifest.version.trim();
    addCheck(result, 'pass', `version is valid SemVer: ${result.version}`);
  }

  if (manifest.pub_date) {
    if (typeof manifest.pub_date !== 'string') {
      addCheck(result, 'fail', 'pub_date is a string');
      result.valid = false;
    } else if (RFC3339_MS_RE.test(manifest.pub_date)) {
      addCheck(
        result,
        'fail',
        `pub_date has no sub-second precision: "${manifest.pub_date}"`,
        "Tauri's Rust RFC-3339 parser rejects milliseconds",
      );
      result.valid = false;
    } else if (!RFC3339_NO_MS_RE.test(manifest.pub_date)) {
      addCheck(result, 'fail', `pub_date is valid RFC 3339: "${manifest.pub_date}"`);
      result.valid = false;
    } else {
      addCheck(result, 'pass', `pub_date is valid RFC 3339: ${manifest.pub_date}`);
    }
  } else {
    addCheck(result, 'warn', 'pub_date missing', 'optional but recommended');
  }

  if (!manifest.platforms || typeof manifest.platforms !== 'object' || Array.isArray(manifest.platforms)) {
    addCheck(result, 'fail', 'platforms object present');
    result.valid = false;
    return result;
  }
  addCheck(result, 'pass', 'platforms object present');

  const platformEntry = manifest.platforms[target];
  if (!platformEntry || typeof platformEntry !== 'object' || Array.isArray(platformEntry)) {
    addCheck(
      result,
      'fail',
      `platforms["${target}"] entry exists`,
      `available keys: ${Object.keys(manifest.platforms).join(', ') || '(none)'}`,
    );
    result.valid = false;
    return result;
  }
  result.platformEntry = platformEntry;
  addCheck(result, 'pass', `platforms["${target}"] entry exists`);

  mergeChildResult(
    result,
    validateDownloadUrlContract(platformEntry.url, {
      expectedVersion: result.version,
      target,
      allowedHosts,
      requireHttps,
    }),
  );
  mergeChildResult(result, validateSignatureContract(platformEntry.signature, { target }));

  return result;
}

export async function checkDownloadUrlReachability(urlValue, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch implementation is required for download URL reachability check');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetchImpl(urlValue, {
      method: 'HEAD',
      signal: ctrl.signal,
    });
    return {
      ok: response.status === 200,
      status: response.status,
      contentLength: response.headers?.get?.('content-length') ?? null,
      contentType: response.headers?.get?.('content-type') ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      contentLength: null,
      contentType: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
