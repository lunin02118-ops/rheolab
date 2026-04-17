function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizePubkeyOverride(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseEndpointsOverride(rawValue) {
  if (typeof rawValue !== 'string') {
    return null;
  }

  const endpoints = rawValue
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return endpoints.length > 0 ? endpoints : null;
}

function isTemplateEndpoint(endpoint) {
  return /{{|}}|\$\{[^}]+\}/.test(endpoint);
}

function ensureUpdaterConfigShape(config) {
  if (!config.plugins || typeof config.plugins !== 'object') {
    config.plugins = {};
  }

  if (!config.plugins.updater || typeof config.plugins.updater !== 'object') {
    config.plugins.updater = {};
  }

  if (!Array.isArray(config.plugins.updater.endpoints)) {
    config.plugins.updater.endpoints = [];
  }

  if (typeof config.plugins.updater.pubkey !== 'string') {
    config.plugins.updater.pubkey = '';
  }

  return config.plugins.updater;
}

function setChannelOnEndpoint(endpoint, channel) {
  if (typeof endpoint !== 'string') {
    return endpoint;
  }

  const trimmed = endpoint.trim();
  if (!trimmed) {
    return endpoint;
  }

  if (isTemplateEndpoint(trimmed)) {
    if (/[?&]channel=/i.test(trimmed)) {
      // Already has a channel parameter — replace value only if it is not itself a template placeholder.
      if (!/[?&]channel=(\{\{|\$\{)/i.test(trimmed)) {
        return trimmed.replace(/([?&]channel=)[^&#]*/i, `$1${encodeURIComponent(channel)}`);
      }
      return endpoint; // templated channel placeholder — leave as-is for Tauri to resolve
    }
    // Template endpoint without channel= — append ?channel=<channel> so the
    // update server can distinguish stable / beta traffic.
    return trimmed.includes('?')
      ? `${trimmed}&channel=${encodeURIComponent(channel)}`
      : `${trimmed}?channel=${encodeURIComponent(channel)}`;
  }

  try {
    const url = new URL(trimmed);
    url.searchParams.set('channel', channel);
    return url.toString();
  } catch {
    return endpoint;
  }
}

function adjustEndpointsForChannel(endpoints, channel) {
  return endpoints.map((endpoint) => setChannelOnEndpoint(endpoint, channel));
}

function patchTauriUpdaterConfig({ tauriConfig, channel, env }) {
  const config = cloneJson(tauriConfig);
  const updater = ensureUpdaterConfigShape(config);

  const originalEndpoints = Array.isArray(updater.endpoints) ? [...updater.endpoints] : [];
  const originalPubkey = updater.pubkey;

  let usedEnvPubkey = false;
  let usedEnvEndpoints = false;

  const envPubkey = normalizePubkeyOverride(
    env.RHEOLAB_UPDATER_PUBKEY || env.TAURI_UPDATER_PUBKEY,
  );
  if (envPubkey) {
    updater.pubkey = envPubkey;
    usedEnvPubkey = true;
  }

  const envEndpoints = parseEndpointsOverride(env.RHEOLAB_UPDATER_ENDPOINTS);
  if (envEndpoints) {
    updater.endpoints = envEndpoints;
    usedEnvEndpoints = true;
  }

  updater.endpoints = adjustEndpointsForChannel(updater.endpoints, channel);

  const endpointsChanged = JSON.stringify(originalEndpoints) !== JSON.stringify(updater.endpoints);
  const pubkeyChanged = originalPubkey !== updater.pubkey;

  return {
    config,
    mutated: endpointsChanged || pubkeyChanged,
    usedEnvPubkey,
    usedEnvEndpoints,
    endpointsChanged,
    pubkeyChanged,
  };
}

module.exports = {
  normalizePubkeyOverride,
  parseEndpointsOverride,
  isTemplateEndpoint,
  setChannelOnEndpoint,
  adjustEndpointsForChannel,
  patchTauriUpdaterConfig,
};
