const RELEASE_CHANNELS = new Set(['stable', 'beta', 'internal']);
const UPDATER_PUBKEY_PLACEHOLDERS = [
  'REPLACE_WITH_TAURI_UPDATER_PUBKEY',
  'CHANGE_ME',
  'CHANGEME',
];

function resolveReleaseChannel(argv, envChannel) {
  const channelFlagIndex = argv.findIndex((arg) => arg === '--channel');
  const channelFlagValue = channelFlagIndex >= 0 ? argv[channelFlagIndex + 1] : undefined;
  const resolved = (channelFlagValue || envChannel || 'stable').toLowerCase();

  if (!RELEASE_CHANNELS.has(resolved)) {
    throw new Error(
      `Unknown release channel "${resolved}". Expected one of: ${Array.from(RELEASE_CHANNELS).join(', ')}`,
    );
  }

  return resolved;
}

function shouldRequireSignedArtifacts(channel) {
  return channel === 'stable' || channel === 'beta';
}

function shouldRequireUpdaterPubkey(channel) {
  return channel === 'stable' || channel === 'beta';
}

function normalizeUpdaterEndpoints(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function readUpdaterConfig(tauriConfig) {
  if (!tauriConfig || typeof tauriConfig !== 'object') {
    return null;
  }

  // Tauri v2 config layout.
  if (tauriConfig.plugins && typeof tauriConfig.plugins === 'object') {
    const updater = tauriConfig.plugins.updater;
    if (updater && typeof updater === 'object') {
      return updater;
    }
  }

  // Legacy / compatibility lookup if structure changes.
  if (tauriConfig.tauri && typeof tauriConfig.tauri === 'object') {
    const updater = tauriConfig.tauri.updater;
    if (updater && typeof updater === 'object') {
      return updater;
    }
  }

  return null;
}

function isPlaceholderPubkey(pubkey) {
  if (typeof pubkey !== 'string') {
    return true;
  }

  const trimmed = pubkey.trim();
  if (!trimmed) {
    return true;
  }

  return UPDATER_PUBKEY_PLACEHOLDERS.some((placeholder) => trimmed.includes(placeholder));
}

function endpointHasChannelMarker(endpoint) {
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    return false;
  }

  const text = endpoint.trim();
  if (/[?&]channel=/i.test(text)) {
    return true;
  }

  // Allow templated channel placeholders.
  return /channel[^a-zA-Z0-9]*(\{+|\$+|%+)?(release_)?channel/i.test(text);
}

function summarizeUpdaterConfig(tauriConfig) {
  const updaterConfig = readUpdaterConfig(tauriConfig);
  const endpoints = normalizeUpdaterEndpoints(updaterConfig?.endpoints);
  const pubkey = typeof updaterConfig?.pubkey === 'string' ? updaterConfig.pubkey : '';

  return {
    configured: Boolean(updaterConfig),
    endpoints,
    endpointCount: endpoints.length,
    pubkeyConfigured: !isPlaceholderPubkey(pubkey),
    pubkey,
  };
}

function validateUpdaterConfig({ tauriConfig, channel }) {
  const issues = [];
  const summary = summarizeUpdaterConfig(tauriConfig);

  if (!summary.configured) {
    issues.push('Missing plugins.updater configuration in src-tauri/tauri.conf.json');
    return {
      valid: false,
      summary,
      issues,
    };
  }

  if (summary.endpointCount === 0) {
    issues.push('Updater endpoints list is empty');
  } else if (!summary.endpoints.some(endpointHasChannelMarker)) {
    issues.push('Updater endpoint should include channel marker (query `channel=` or template)');
  }

  if (shouldRequireUpdaterPubkey(channel) && !summary.pubkeyConfigured) {
    issues.push(
      `Updater pubkey is missing or placeholder for "${channel}" channel. Set plugins.updater.pubkey to production public key.`,
    );
  }

  return {
    valid: issues.length === 0,
    summary,
    issues,
  };
}

function formatUpdaterIssues(issues) {
  return issues.map((item) => `- ${item}`).join('\n');
}

module.exports = {
  RELEASE_CHANNELS,
  resolveReleaseChannel,
  shouldRequireSignedArtifacts,
  shouldRequireUpdaterPubkey,
  normalizeUpdaterEndpoints,
  readUpdaterConfig,
  isPlaceholderPubkey,
  endpointHasChannelMarker,
  summarizeUpdaterConfig,
  validateUpdaterConfig,
  formatUpdaterIssues,
};
