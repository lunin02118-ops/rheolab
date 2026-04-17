import { describe, expect, it } from 'vitest';
import releasePolicy from '../../scripts/release/lib/release-policy.js';

 
const policy = releasePolicy as any;
const {
  resolveReleaseChannel,
  shouldRequireSignedArtifacts,
  isPlaceholderPubkey,
  endpointHasChannelMarker,
  validateUpdaterConfig,
} = policy;

describe('release-policy', () => {
  it('resolves release channel from cli flag', () => {
    expect(resolveReleaseChannel(['--channel', 'beta'], undefined)).toBe('beta');
  });

  it('falls back to environment release channel', () => {
    expect(resolveReleaseChannel([], 'internal')).toBe('internal');
  });

  it('rejects unknown channels', () => {
    expect(() => resolveReleaseChannel(['--channel', 'nightly'], undefined)).toThrow(
      /Unknown release channel/i,
    );
  });

  it('requires signatures for stable and beta channels only', () => {
    expect(shouldRequireSignedArtifacts('stable')).toBe(true);
    expect(shouldRequireSignedArtifacts('beta')).toBe(true);
    expect(shouldRequireSignedArtifacts('internal')).toBe(false);
  });

  it('detects placeholder updater pubkeys', () => {
    expect(isPlaceholderPubkey('')).toBe(true);
    expect(isPlaceholderPubkey('REPLACE_WITH_TAURI_UPDATER_PUBKEY')).toBe(true);
    expect(isPlaceholderPubkey('real-public-key-value')).toBe(false);
  });

  it('detects channel markers in updater endpoints', () => {
    expect(endpointHasChannelMarker('https://updates.example.com/latest.json?channel=stable')).toBe(true);
    expect(endpointHasChannelMarker('https://updates.example.com/latest.json?channel=${RHEOLAB_RELEASE_CHANNEL}')).toBe(true);
    expect(endpointHasChannelMarker('https://updates.example.com/latest.json')).toBe(false);
  });

  it('flags placeholder pubkey for stable channel', () => {
    const result = validateUpdaterConfig({
      channel: 'stable',
      tauriConfig: {
        plugins: {
          updater: {
            endpoints: ['https://updates.example.com/latest.json?channel=stable'],
            pubkey: 'REPLACE_WITH_TAURI_UPDATER_PUBKEY',
          },
        },
      },
    });

    expect(result.valid).toBe(false);
    expect(result.issues.join('\n')).toMatch(/pubkey/i);
  });

  it('allows internal channel without strict pubkey requirement', () => {
    const result = validateUpdaterConfig({
      channel: 'internal',
      tauriConfig: {
        plugins: {
          updater: {
            endpoints: ['https://updates.example.com/latest.json?channel=internal'],
            pubkey: '',
          },
        },
      },
    });

    expect(result.valid).toBe(true);
  });
});
