/**
 * Tauri API Keys & Logger Commands
 *
 * Wraps api_keys_* Tauri commands and the logger commands.
 */

import { invoke } from './core';
import type {
  ApiKeyRecord,
  ApiKeyCreatePayload,
  ApiKeyMutationResponse,
  ApiKeyDeleteResponse,
  ApiKeyValidationResponse,
  ActiveApiKeyResponse,
} from '@/types/tauri';

export const apiKeys = {
  /**
   * List stored API keys (masked).
   */
  async list(): Promise<ApiKeyRecord[]> {
    return invoke<ApiKeyRecord[]>('api_keys_list');
  },

  /**
   * Create and store a new API key.
   */
  async create(payload: ApiKeyCreatePayload): Promise<ApiKeyMutationResponse> {
    return invoke<ApiKeyMutationResponse>('api_keys_create', { payload });
  },

  /**
   * Set key as active for its provider.
   */
  async setActive(id: string): Promise<ApiKeyMutationResponse> {
    return invoke<ApiKeyMutationResponse>('api_keys_set_active', { id });
  },

  /**
   * Delete key by id.
   */
  async delete(id: string): Promise<ApiKeyDeleteResponse> {
    return invoke<ApiKeyDeleteResponse>('api_keys_delete', { id });
  },

  /**
   * Get active key metadata for provider.
   */
  async active(provider = 'groq'): Promise<ActiveApiKeyResponse> {
    return invoke<ActiveApiKeyResponse>('api_keys_active', { provider });
  },

  /**
   * Validate currently active provider key.
   */
  async checkActive(provider = 'groq'): Promise<ApiKeyValidationResponse> {
    return invoke<ApiKeyValidationResponse>('api_keys_check_active', { provider });
  },

  /**
   * Validate provided key against provider API.
   */
  async validate(key: string, provider = 'groq'): Promise<ApiKeyValidationResponse> {
    return invoke<ApiKeyValidationResponse>('api_keys_validate', { key, provider });
  },
};

export const logger = {
  /**
   * Log an info message
   */
  async info(message: string): Promise<void> {
    return invoke<void>('log_info', { message });
  },

  /**
   * Log an error message
   */
  async error(message: string): Promise<void> {
    return invoke<void>('log_error', { message });
  },
};
