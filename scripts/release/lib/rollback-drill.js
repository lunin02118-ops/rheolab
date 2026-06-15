const VALID_CHANNELS = new Set(['alpha', 'beta', 'stable']);

const CHANNEL_AUDIENCES = {
  alpha: 'owner/superuser channel only',
  beta: 'developer/internal beta channel only',
  stable: 'public channel for Standard, Enterprise, Trial, and Demo users',
};

const REQUIRED_ROLLBACK_DRILL_STEPS = [
  'bad_release_detection',
  'rollback_channel_update',
  'server_side_deploy_safety',
  'artifact_cleanup',
  'user_facing_version_behavior',
];

function normalizeChannel(channel) {
  const normalized = String(channel || 'alpha').trim().toLowerCase();
  if (!VALID_CHANNELS.has(normalized)) {
    throw new Error(
      `Unknown rollback channel "${normalized}". Expected one of: ${Array.from(VALID_CHANNELS).join(', ')}`,
    );
  }
  return normalized;
}

function quoteCliValue(value) {
  return `"${String(value).replace(/(["\\$`])/g, '\\$1')}"`;
}

function appendTargetArgs(parts, { toVersion, toManifest }) {
  if (toManifest) {
    parts.push('--to-manifest', quoteCliValue(toManifest));
  }
  if (toVersion) {
    parts.push('--to-version', quoteCliValue(toVersion));
  }
  return parts;
}

function rollbackChannelCommand({
  channel,
  reason,
  toVersion,
  toManifest,
  dryRun = false,
}) {
  const parts = [
    'node',
    'scripts/release/rollback-channel.js',
    '--channel',
    channel,
  ];
  if (dryRun) {
    parts.push('--dry-run');
  }
  appendTargetArgs(parts, { toVersion, toManifest });
  if (!dryRun && reason) {
    parts.push('--reason', quoteCliValue(reason));
  }
  return parts.join(' ');
}

function publishFromManifestCommand({ channel, manifestPath, dryRun = false }) {
  const parts = [
    'node',
    'scripts/deploy/publish-update.js',
    '--from-manifest',
    quoteCliValue(manifestPath),
    '--channel',
    channel,
  ];
  if (dryRun) {
    parts.push('--dry-run');
  }
  return parts.join(' ');
}

function checkUpdateCommand({ channel, version, manifestPath }) {
  const parts = ['npm', 'run', 'check:update', '--'];
  if (manifestPath) {
    parts.push('--manifest', quoteCliValue(manifestPath));
  }
  parts.push('--channel', channel);
  if (version) {
    parts.push('--version', quoteCliValue(version));
  }
  return parts.join(' ');
}

function parseSemverLike(value) {
  const [withoutBuild] = String(value || '').trim().replace(/^v/, '').split('+');
  const [main, prerelease = ''] = withoutBuild.split('-', 2);
  const nums = main.split('.').map((part) => Number(part));
  if (nums.length < 3 || nums.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Invalid semantic version: ${value}`);
  }
  return {
    major: nums[0],
    minor: nums[1],
    patch: nums[2],
    prerelease: prerelease ? prerelease.split('.') : [],
  };
}

function compareIdentifier(left, right) {
  const leftNum = Number(left);
  const rightNum = Number(right);
  const leftIsNum = Number.isInteger(leftNum);
  const rightIsNum = Number.isInteger(rightNum);

  if (leftIsNum && rightIsNum) {
    return Math.sign(leftNum - rightNum);
  }
  if (leftIsNum) {
    return -1;
  }
  if (rightIsNum) {
    return 1;
  }
  return left.localeCompare(right);
}

function compareSemverLike(left, right) {
  const a = parseSemverLike(left);
  const b = parseSemverLike(right);

  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) {
      return Math.sign(a[key] - b[key]);
    }
  }

  if (a.prerelease.length === 0 && b.prerelease.length === 0) {
    return 0;
  }
  if (a.prerelease.length === 0) {
    return 1;
  }
  if (b.prerelease.length === 0) {
    return -1;
  }

  const max = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < max; i += 1) {
    const ai = a.prerelease[i];
    const bi = b.prerelease[i];
    if (ai === undefined) {
      return -1;
    }
    if (bi === undefined) {
      return 1;
    }
    const compared = compareIdentifier(ai, bi);
    if (compared !== 0) {
      return compared;
    }
  }

  return 0;
}

function classifyUserFacingVersionBehavior({ badVersion, rollbackVersion, hotfixVersion }) {
  if (!badVersion || !rollbackVersion) {
    return {
      alreadyUpdatedClientsAutoDowngrade: false,
      requiresHotfixForAlreadyUpdatedClients: true,
      summary:
        'Version behavior cannot be proven without both badVersion and rollbackVersion.',
    };
  }

  const rollbackVsBad = compareSemverLike(rollbackVersion, badVersion);
  const hotfixVsBad = hotfixVersion ? compareSemverLike(hotfixVersion, badVersion) : null;

  if (rollbackVsBad < 0) {
    return {
      alreadyUpdatedClientsAutoDowngrade: false,
      requiresHotfixForAlreadyUpdatedClients: true,
      rollbackStopsNewInstallsOrFutureOffers: true,
      hotfixVersionAcceptedByBadClients: hotfixVsBad === null ? null : hotfixVsBad > 0,
      summary:
        `Rollback version ${rollbackVersion} is lower than bad version ${badVersion}; ` +
        'clients that already installed the bad release will not auto-downgrade. ' +
        'Publish a hotfix with a version greater than the bad release for those clients.',
    };
  }

  if (rollbackVsBad === 0) {
    return {
      alreadyUpdatedClientsAutoDowngrade: false,
      requiresHotfixForAlreadyUpdatedClients: true,
      rollbackStopsNewInstallsOrFutureOffers: false,
      hotfixVersionAcceptedByBadClients: hotfixVsBad === null ? null : hotfixVsBad > 0,
      summary:
        `Rollback version ${rollbackVersion} equals bad version ${badVersion}; ` +
        'clients will not see a replacement update unless a greater hotfix version is published.',
    };
  }

  return {
    alreadyUpdatedClientsAutoDowngrade: false,
    requiresHotfixForAlreadyUpdatedClients: false,
    rollbackStopsNewInstallsOrFutureOffers: true,
    hotfixVersionAcceptedByBadClients: true,
    summary:
      `Target version ${rollbackVersion} is greater than bad version ${badVersion}; ` +
      'clients can accept it as a forward hotfix rather than a downgrade.',
  };
}

function createRollbackDrillPlan({
  channel = 'alpha',
  badVersion,
  rollbackVersion,
  hotfixVersion,
  reason = 'bad release rollback drill',
  manifestPath,
  toManifest,
  keepArtifacts = 3,
} = {}) {
  const normalizedChannel = normalizeChannel(channel);
  const resolvedManifestPath = manifestPath || `outputs/release/${normalizedChannel}.json`;
  const versionBehavior = classifyUserFacingVersionBehavior({
    badVersion,
    rollbackVersion,
    hotfixVersion,
  });

  return {
    channel: normalizedChannel,
    audience: CHANNEL_AUDIENCES[normalizedChannel],
    badVersion: badVersion || null,
    rollbackVersion: rollbackVersion || null,
    hotfixVersion: hotfixVersion || null,
    manifestPath: resolvedManifestPath,
    reason,
    versionBehavior,
    steps: [
      {
        id: 'bad_release_detection',
        title: 'Detect and freeze the bad release',
        commands: [
          'npm run test:release-gate',
          checkUpdateCommand({
            channel: normalizedChannel,
            version: badVersion,
            manifestPath: resolvedManifestPath,
          }),
        ],
        evidence: [
          'release gate failure, crash report, bad updater manifest, or operator incident note',
          'bad release version and channel recorded before rollback',
        ],
      },
      {
        id: 'rollback_channel_update',
        title: 'Select and apply the channel rollback',
        commands: [
          rollbackChannelCommand({
            channel: normalizedChannel,
            toVersion: rollbackVersion,
            toManifest,
            dryRun: true,
          }),
          rollbackChannelCommand({
            channel: normalizedChannel,
            reason,
            toVersion: rollbackVersion,
            toManifest,
          }),
        ],
        evidence: [
          'dry-run selected the expected prior manifest',
          'rollback log written under runtime/release/channels/<channel>/',
        ],
      },
      {
        id: 'server_side_deploy_safety',
        title: 'Publish the rollback manifest safely',
        commands: [
          publishFromManifestCommand({
            channel: normalizedChannel,
            manifestPath: resolvedManifestPath,
            dryRun: true,
          }),
          publishFromManifestCommand({
            channel: normalizedChannel,
            manifestPath: resolvedManifestPath,
          }),
          checkUpdateCommand({
            channel: normalizedChannel,
            version: rollbackVersion,
          }),
        ],
        evidence: [
          'publish-update validates tmp manifest on server before atomic rename',
          'post-publish check:update passes for the same channel',
        ],
      },
      {
        id: 'artifact_cleanup',
        title: 'Clean stale server artifacts after rollback is verified',
        commands: [
          `node scripts/deploy/cleanup-server.js --dry-run --keep ${keepArtifacts}`,
          `node scripts/deploy/cleanup-server.js --keep ${keepArtifacts}`,
        ],
        evidence: [
          'dry-run lists artifact directories to keep/delete',
          'cleanup is run only after channel manifest and download URL validation pass',
        ],
      },
      {
        id: 'user_facing_version_behavior',
        title: 'Confirm user-facing version behavior',
        commands: [],
        evidence: [versionBehavior.summary],
      },
    ],
  };
}

function validateRollbackDrillPlan(plan) {
  const issues = [];
  const stepIds = new Set((plan?.steps || []).map((step) => step.id));
  for (const requiredStep of REQUIRED_ROLLBACK_DRILL_STEPS) {
    if (!stepIds.has(requiredStep)) {
      issues.push(`Missing rollback drill step: ${requiredStep}`);
    }
  }

  if (!plan?.channel || !VALID_CHANNELS.has(plan.channel)) {
    issues.push('Rollback drill plan must use a known release channel.');
  }

  if (!plan?.reason || String(plan.reason).trim().length < 8) {
    issues.push('Rollback drill plan should include an incident reason.');
  }

  if (plan?.channel === 'stable') {
    const audience = CHANNEL_AUDIENCES.stable;
    if (!audience.includes('Trial') || !audience.includes('Demo')) {
      issues.push('Stable rollback audience must explicitly include Trial and Demo users.');
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

module.exports = {
  CHANNEL_AUDIENCES,
  REQUIRED_ROLLBACK_DRILL_STEPS,
  normalizeChannel,
  compareSemverLike,
  classifyUserFacingVersionBehavior,
  rollbackChannelCommand,
  publishFromManifestCommand,
  checkUpdateCommand,
  createRollbackDrillPlan,
  validateRollbackDrillPlan,
};
