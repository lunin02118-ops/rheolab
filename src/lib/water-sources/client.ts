import { getBridge } from '@/lib/tauri/bridge';
import type { WaterSourcesResponse } from '@/types/tauri';

/**
 * Unified water sources client for desktop/web.
 * Desktop uses Tauri commands, web/electron uses HTTP fallback via bridge.
 */
export async function listWaterSources(): Promise<string[]> {
  const result: WaterSourcesResponse = await getBridge().waterSources.list();
  return result.waterSources ?? [];
}
