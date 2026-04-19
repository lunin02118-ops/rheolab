/**
 * Unified Platform Bridge  public entry point.
 *
 * This file is intentionally thin: it re-exports everything from the
 * decomposed bridge/ directory so all existing consumers keep working
 * without any import changes.
 *
 * Internal structure:
 *   src/lib/tauri/bridge/index.ts        factories + lifecycle
 *   src/lib/tauri/bridge/experiments.ts  HTTP fallbacks for experiments
 *   src/lib/tauri/bridge/reagents.ts     HTTP fallbacks for reagents
 *   src/lib/tauri/bridge/api-keys.ts     HTTP fallbacks for API keys
 *   src/lib/tauri/bridge/parsing.ts      HTTP fallbacks for parsing/fixtures
 *   src/lib/tauri/bridge/types.ts        type re-exports
 */
export {
  createBridge,
  getBridge,
  resetBridge,
} from './bridge/index';

export type {
  BackupInfo,
  BackupResult,
  ExperimentDeleteResponse,
  ExperimentGetResponse,
  ExperimentsImportResponse,
  ExperimentsLaboratoriesResponse,
  ExperimentSaveResponse,
  ExperimentsCountResponse,
  ExperimentsFilterMetadataResponse,
  ExperimentsListQuery,
  ExperimentsListResponse,
  LastContextResponse,
  ReagentDeleteResponse,
  ReagentMutationResponse,
  ReagentRecord,
  ReagentsExportResponse,
  ReagentsImportResponse,
  ReagentUpsertPayload,
  WaterSourcesResponse,
  PlatformBridge,
} from './bridge/index';

export { default } from './bridge/index';
