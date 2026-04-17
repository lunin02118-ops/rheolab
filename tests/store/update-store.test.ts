/**
 * update-store.test.ts
 *
 * Unit tests for the Zustand update-store.
 *
 * Regression coverage for bugs found during the March 2026 auto-updater
 * investigation:
 *
 *   Bug A — Manual check errors were silenced:
 *     checkUpdateNow() was calling store.reset() on error, which set status to
 *     'idle' and discarded the error message. The user saw "up to date" instead
 *     of the real problem (404, signature decode failure, etc.).
 *     Fix: setError() is now called instead of reset() in the manual check path.
 *
 *   Bug B — Background auto-check must stay silent on network errors:
 *     When the app is offline, the background check should reset silently.
 *     This is intentional — runCheck() calls reset(), not setError().
 */

import { beforeEach, describe, expect, test } from 'vitest';
import { useUpdateStore } from '@/lib/store/update-store';

function freshState() {
  useUpdateStore.setState({
    status: 'idle',
    version: null,
    notes: null,
    downloadProgress: 0,
    error: null,
  });
}

describe('useUpdateStore', () => {
  beforeEach(freshState);

  // ── Initial state ───────────────────────────────────────────────────────

  test('initial state is idle with nulls', () => {
    const s = useUpdateStore.getState();
    expect(s.status).toBe('idle');
    expect(s.version).toBeNull();
    expect(s.notes).toBeNull();
    expect(s.downloadProgress).toBe(0);
    expect(s.error).toBeNull();
  });

  // ── Individual actions ──────────────────────────────────────────────────

  test('startCheck() sets status to "checking"', () => {
    useUpdateStore.getState().startCheck();
    expect(useUpdateStore.getState().status).toBe('checking');
  });

  test('setAvailable() stores version and notes, clears error', () => {
    useUpdateStore.getState().setAvailable('1.2.3', 'What is new');
    const s = useUpdateStore.getState();
    expect(s.status).toBe('available');
    expect(s.version).toBe('1.2.3');
    expect(s.notes).toBe('What is new');
    expect(s.downloadProgress).toBe(0);
    expect(s.error).toBeNull();
  });

  test('setAvailable() accepts null notes', () => {
    useUpdateStore.getState().setAvailable('2.0.0', null);
    expect(useUpdateStore.getState().notes).toBeNull();
    expect(useUpdateStore.getState().status).toBe('available');
  });

  test('setDownloading() sets status and progress', () => {
    useUpdateStore.getState().setDownloading(42);
    const s = useUpdateStore.getState();
    expect(s.status).toBe('downloading');
    expect(s.downloadProgress).toBe(42);
  });

  test('setReady() sets status to "ready" and progress to 100', () => {
    useUpdateStore.getState().setReady();
    const s = useUpdateStore.getState();
    expect(s.status).toBe('ready');
    expect(s.downloadProgress).toBe(100);
  });

  test('dismiss() returns to idle and clears version/notes', () => {
    useUpdateStore.getState().setAvailable('1.0.0', 'notes');
    useUpdateStore.getState().dismiss();
    const s = useUpdateStore.getState();
    expect(s.status).toBe('idle');
    expect(s.version).toBeNull();
    expect(s.notes).toBeNull();
    expect(s.downloadProgress).toBe(0);
  });

  test('reset() clears all fields and returns to idle', () => {
    useUpdateStore.getState().setAvailable('1.0.0', 'notes');
    useUpdateStore.getState().reset();
    const s = useUpdateStore.getState();
    expect(s.status).toBe('idle');
    expect(s.version).toBeNull();
    expect(s.notes).toBeNull();
    expect(s.downloadProgress).toBe(0);
    expect(s.error).toBeNull();
  });

  // ── Bug A regression: setError() must not silently swallow errors ───────

  test('[Bug A] setError() → status is "error", not "idle"', () => {
    // Regression: checkUpdateNow() was calling reset() on catch, which set
    // status to 'idle', hiding the real error from the user.
    useUpdateStore.getState().setError('Не удалось проверить: 404 Not Found');
    const s = useUpdateStore.getState();

    expect(s.status).toBe('error');
    expect(s.status).not.toBe('idle'); // was the broken behaviour
    expect(s.error).toBe('Не удалось проверить: 404 Not Found');
  });

  test('[Bug A] setError() preserves the full error message', () => {
    const msg = 'The signature RWTduL3... could not be decoded, please check if it is a valid base64 string';
    useUpdateStore.getState().setError(msg);
    expect(useUpdateStore.getState().error).toBe(msg);
  });

  // ── reset() after setError() allows retry ─────────────────────────────

  test('reset() after setError() clears error and allows retry', () => {
    useUpdateStore.getState().setError('some error');
    expect(useUpdateStore.getState().status).toBe('error');

    useUpdateStore.getState().reset();
    expect(useUpdateStore.getState().status).toBe('idle');
    expect(useUpdateStore.getState().error).toBeNull();

    // Now startCheck() can run again
    useUpdateStore.getState().startCheck();
    expect(useUpdateStore.getState().status).toBe('checking');
  });

  // ── setError() and reset() have different semantics (guard) ────────────

  test('setError() and reset() behave differently (regression guard)', () => {
    // setError() → visible error state
    useUpdateStore.getState().setError('oops');
    expect(useUpdateStore.getState().status).toBe('error');
    expect(useUpdateStore.getState().error).not.toBeNull();

    // reset() → silent idle, no error
    useUpdateStore.getState().reset();
    expect(useUpdateStore.getState().status).toBe('idle');
    expect(useUpdateStore.getState().error).toBeNull();
  });

  // ── Status transition flows ─────────────────────────────────────────────

  test('idle → checking → error (failed manual check)', () => {
    expect(useUpdateStore.getState().status).toBe('idle');
    useUpdateStore.getState().startCheck();
    expect(useUpdateStore.getState().status).toBe('checking');
    useUpdateStore.getState().setError('network timeout');
    expect(useUpdateStore.getState().status).toBe('error');
    expect(useUpdateStore.getState().error).toBe('network timeout');
  });

  test('idle → checking → idle (background no-update, silent)', () => {
    // Background check completes normally with no update → reset()
    useUpdateStore.getState().startCheck();
    useUpdateStore.getState().reset();
    const s = useUpdateStore.getState();
    expect(s.status).toBe('idle');
    expect(s.error).toBeNull();
  });

  test('idle → checking → available → downloading → ready', () => {
    useUpdateStore.getState().startCheck();
    useUpdateStore.getState().setAvailable('2.0.0', null);
    expect(useUpdateStore.getState().status).toBe('available');

    useUpdateStore.getState().setDownloading(0);
    expect(useUpdateStore.getState().status).toBe('downloading');

    useUpdateStore.getState().setDownloading(50);
    expect(useUpdateStore.getState().downloadProgress).toBe(50);

    useUpdateStore.getState().setReady();
    expect(useUpdateStore.getState().status).toBe('ready');
    expect(useUpdateStore.getState().downloadProgress).toBe(100);
  });
});
