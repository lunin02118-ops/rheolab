import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkActiveApiKey,
  createApiKey,
  deleteApiKey,
  listApiKeys,
  setApiKeyActive,
  validateApiKey,
} from '@/lib/api-keys/client';
import { getBridge } from '@/lib/tauri/bridge';

vi.mock('@/lib/tauri/bridge', () => ({
  getBridge: vi.fn(),
}));

describe('api-keys client', () => {
  const bridge = {
    platform: 'web' as 'web' | 'tauri' | 'electron',
    isDesktop: false,
    apiKeys: {
      list: vi.fn(),
      create: vi.fn(),
      setActive: vi.fn(),
      delete: vi.fn(),
      checkActive: vi.fn(),
      validate: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBridge).mockReturnValue(bridge as never);
    bridge.platform = 'web';
    bridge.isDesktop = false;
  });

  it('routes list/create/toggle/delete through unified bridge', async () => {
    bridge.apiKeys.list.mockResolvedValue([
      {
        id: 'ak_1',
        name: 'Main',
        key: '********',
        provider: 'groq',
        isActive: true,
        createdAt: '2026-02-13T00:00:00.000Z',
        updatedAt: '2026-02-13T00:00:00.000Z',
      },
    ]);
    bridge.apiKeys.create.mockResolvedValue({ success: true });
    bridge.apiKeys.setActive.mockResolvedValue({ success: true });
    bridge.apiKeys.delete.mockResolvedValue({ success: true });

    await expect(listApiKeys()).resolves.toHaveLength(1);
    await expect(createApiKey({ name: 'Main', key: 'gsk', provider: 'groq' })).resolves.toMatchObject({ success: true });
    await expect(setApiKeyActive('ak_1')).resolves.toMatchObject({ success: true });
    await expect(deleteApiKey('ak_1')).resolves.toMatchObject({ success: true });

    expect(bridge.apiKeys.list).toHaveBeenCalledTimes(1);
    expect(bridge.apiKeys.create).toHaveBeenCalledWith({
      name: 'Main',
      key: 'gsk',
      provider: 'groq',
    });
    expect(bridge.apiKeys.setActive).toHaveBeenCalledWith('ak_1');
    expect(bridge.apiKeys.delete).toHaveBeenCalledWith('ak_1');
  });

  it('routes active key check through unified bridge', async () => {
    bridge.apiKeys.checkActive.mockResolvedValue({
      isValid: true,
    });

    const result = await checkActiveApiKey();
    expect(result.isValid).toBe(true);
    expect(bridge.apiKeys.checkActive).toHaveBeenCalledWith('groq', false);
  });

  it('passes explicit external-network opt-in for active key check', async () => {
    bridge.apiKeys.checkActive.mockResolvedValue({
      isValid: true,
    });

    const result = await checkActiveApiKey('groq', true);
    expect(result.isValid).toBe(true);
    expect(bridge.apiKeys.checkActive).toHaveBeenCalledWith('groq', true);
  });

  it('uses bridge validation on web runtime', async () => {
    bridge.platform = 'web';
    bridge.isDesktop = false;
    bridge.apiKeys.validate.mockResolvedValue({
      isValid: false,
      error: 'Invalid API key',
    });

    const result = await validateApiKey('gsk_bad');
    expect(result.isValid).toBe(false);
    expect(bridge.apiKeys.validate).toHaveBeenCalledWith('gsk_bad', 'groq', false);
  });

  it('uses native key validation in tauri runtime', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.apiKeys.validate.mockResolvedValue({ isValid: true });

    const result = await validateApiKey('gsk_good');

    expect(result.isValid).toBe(true);
    expect(bridge.apiKeys.validate).toHaveBeenCalledWith('gsk_good', 'groq', false);
  });

  it('passes explicit external-network opt-in for key validation', async () => {
    bridge.platform = 'tauri';
    bridge.isDesktop = true;
    bridge.apiKeys.validate.mockResolvedValue({ isValid: true });

    const result = await validateApiKey('gsk_good', 'groq', true);

    expect(result.isValid).toBe(true);
    expect(bridge.apiKeys.validate).toHaveBeenCalledWith('gsk_good', 'groq', true);
  });
});
