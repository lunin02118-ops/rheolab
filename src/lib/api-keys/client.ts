import { getBridge } from '@/lib/tauri/bridge';
import type {
  ApiKeyCreatePayload,
  ApiKeyDeleteResponse,
  ApiKeyMutationResponse,
  ApiKeyRecord,
  ApiKeyValidationResponse,
} from '@/types/tauri';

export async function listApiKeys(): Promise<ApiKeyRecord[]> {
  return getBridge().apiKeys.list();
}

export async function createApiKey(
  payload: ApiKeyCreatePayload,
): Promise<ApiKeyMutationResponse> {
  return getBridge().apiKeys.create(payload);
}

export async function setApiKeyActive(id: string): Promise<ApiKeyMutationResponse> {
  return getBridge().apiKeys.setActive(id);
}

export async function deleteApiKey(id: string): Promise<ApiKeyDeleteResponse> {
  return getBridge().apiKeys.delete(id);
}

export async function checkActiveApiKey(
  provider = 'groq',
  allowExternalNetwork = false,
): Promise<ApiKeyValidationResponse> {
  return getBridge().apiKeys.checkActive(provider, allowExternalNetwork);
}

export async function validateApiKey(
  key: string,
  provider = 'groq',
  allowExternalNetwork = false,
): Promise<ApiKeyValidationResponse> {
  return getBridge().apiKeys.validate(key, provider, allowExternalNetwork);
}
