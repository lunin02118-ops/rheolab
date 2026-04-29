/**
 * Tauri API — re-export barrel.
 *
 * All implementations live in domain-specific modules:
 *   ./core         — isTauri(), invoke()
 *   ./backup       — backup.*
 *   ./api-keys     — apiKeys.*, logger.*
 *   ./experiments  — experiments.*, importBatches.*, etc.
 *   ./reagents     — reagents.*, waterSources.*
 *   ./reports      — reports.*, fixtures.*, parsing.*
 *   ./analysis     — analysis.*
 *   ./jobs         — jobs.*, analysisCache.*
 *   ./sync         — sync.*, conflicts.*, syncEngine.*
 *
 * This file exists solely for backward-compatible imports from '@/lib/tauri'.
 * Add new Tauri API surface in the appropriate domain module, not here.
 */

export { isTauri, invoke, safeInvoke } from './core';
export { backup } from './backup';
export { apiKeys, logger } from './api-keys';
export {
  experiments,
  importBatches,
  experimentPayloads,
  parserArtifacts,
  reportArtifacts,
  searchProjections,
} from './experiments';
export { reagents, waterSources } from './reagents';
export { operators } from './operators';
export { laboratories } from './laboratories';
export { reports, fixtures, parsing } from './reports';
export { analysis } from './analysis';
export { jobs, analysisCache } from './jobs';
export { sync, conflicts, syncEngine } from './sync';

// Backward-compatible type re-export
export type { RheoPointsColumnar } from '@/types/tauri';

// Re-export TauriError so consumers can do: import { TauriError } from '@/lib/tauri'
export { TauriError, isTauriError } from './errors';
export type { TauriErrorKind } from './errors';

// ── Default re-export (mirrors original default export shape) ────────────────
import { isTauri, invoke, safeInvoke } from './core';
import { backup } from './backup';
import { apiKeys, logger } from './api-keys';
import {
  experiments,
  importBatches,
  experimentPayloads,
  parserArtifacts,
  reportArtifacts,
  searchProjections,
} from './experiments';
import { reagents, waterSources } from './reagents';
import { reports, fixtures, parsing } from './reports';
import { analysis } from './analysis';
import { jobs, analysisCache } from './jobs';
import { sync, conflicts, syncEngine } from './sync';

const tauriApi = {
  isTauri,
  invoke,
  safeInvoke,
  backup,
  apiKeys,
  logger,
  experiments,
  reagents,
  waterSources,
  reports,
  fixtures,
  parsing,
  analysis,
  jobs,
  analysisCache,
  importBatches,
  experimentPayloads,
  parserArtifacts,
  reportArtifacts,
  searchProjections,
  sync,
  conflicts,
  syncEngine,
};

export default tauriApi;
