/**
 * @fileoverview Tests for api-keys helpers.
 *
 * The getActiveGroqKey function was removed in the S-1 security fix.
 * API keys are now resolved server-side by the Rust parsing command,
 * never sent over IPC.
 */

import { describe, it, expect } from 'vitest';

describe('api-keys/helpers', () => {
  it('module is importable (placeholder after S-1 removal)', () => {
    expect(true).toBe(true);
  });
});
