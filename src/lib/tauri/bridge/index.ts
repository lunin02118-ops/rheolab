/**
 * Unified Platform Bridge
 *
 * Provides a unified API for the Tauri desktop runtime.
 *
 * Internal structure:
 *   bridge/data-flows.ts   — V2 data flow wrappers (Tauri-only)
 *   bridge/types.ts        — type re-exports
 */

import type { PlatformBridge } from './types';
import {
  isTauri,
  backup as tauriBackup,
  apiKeys as tauriApiKeys,
  experiments as tauriExperiments,
  reagents as tauriReagents,
  waterSources as tauriWaterSources,
  fixtures as tauriFixtures,
  parsing as tauriParsing,
  reports as tauriReports,
  logger as tauriLogger,
  analysis as tauriAnalysis,
  jobs as tauriJobs,
  analysisCache as tauriAnalysisCache,
  experimentProjection as tauriExperimentProjection,
  operators as tauriOperators,
  laboratories as tauriLaboratories,
} from '../index';

import { createTauriDataFlows } from './data-flows';

// ── Tauri bridge factory ───────────────────────────────────────────────

function createTauriBridge(): PlatformBridge {
  return {
    platform: 'tauri',
    isDesktop: true,

    backup: {
      list: () => tauriBackup.list(),
      create: () => tauriBackup.create(),
      restore: (filename) => tauriBackup.restore(filename),
      delete: (filename) => tauriBackup.delete(filename),
      openFolder: () => tauriBackup.openFolder(),
    },

    apiKeys: {
      list: () => tauriApiKeys.list(),
      create: (payload) => tauriApiKeys.create(payload),
      setActive: (id) => tauriApiKeys.setActive(id),
      delete: (id) => tauriApiKeys.delete(id),
      checkActive: (provider) => tauriApiKeys.checkActive(provider),
      validate: (key, provider) => tauriApiKeys.validate(key, provider),
      active: (provider) => tauriApiKeys.active(provider),
    },

    experiments: {
      list: (query) => tauriExperiments.list(query),
      count: () => tauriExperiments.count(),
      filterMetadata: () => tauriExperiments.filterMetadata(),
      get: (id) => tauriExperiments.get(id),
      getBatch: (ids) => tauriExperiments.getBatch(ids),
      checkExistence: (ids) => tauriExperiments.checkExistence(ids),
      save: (payload) => tauriExperiments.save(payload),
      delete: (id) => tauriExperiments.delete(id),
      lastContext: () => tauriExperiments.lastContext(),
      exportLaboratories: () => tauriExperiments.exportLaboratories(),
      exportToFile: (laboratoryIds) => tauriExperiments.exportToFile(laboratoryIds),
      importData: (experiments) => tauriExperiments.importData(experiments),
    },

    reagents: {
      list: () => tauriReagents.list(),
      create: (payload) => tauriReagents.create(payload),
      update: (id, payload) => tauriReagents.update(id, payload),
      delete: (id) => tauriReagents.delete(id),
      exportData: () => tauriReagents.exportData(),
      importData: (reagents) => tauriReagents.importData(reagents),
      seed: () => tauriReagents.seed(),
    },

    operators: {
      list: () => tauriOperators.list(),
      create: (payload) => tauriOperators.create(payload),
      update: (id, payload) => tauriOperators.update(id, payload),
      delete: (id) => tauriOperators.delete(id),
    },

    laboratories: {
      list: () => tauriLaboratories.list(),
      create: (payload) => tauriLaboratories.create(payload),
      update: (id, payload) => tauriLaboratories.update(id, payload),
      delete: (id) => tauriLaboratories.delete(id),
    },

    waterSources: {
      list: () => tauriWaterSources.list(),
    },

    fixtures: {
      list: () => tauriFixtures.list(),
      read: (filename) => tauriFixtures.read(filename),
      parse: (filename) => tauriFixtures.parse(filename),
    },

    parsing: {
      parseFile: (request) => tauriParsing.parseFile(request),
    },

    reports: {
      generatePdf: (input) => tauriReports.generatePdf(input),
      generateExcel: (input) => tauriReports.generateExcel(input),
      generateComparisonPdf: (input) => tauriReports.generateComparisonPdf(input),
      generateComparisonExcel: (input) => tauriReports.generateComparisonExcel(input),
      generateComparisonPdfByIds: (request) => tauriReports.generateComparisonPdfByIds(request),
      generateComparisonExcelByIds: (request) =>
        tauriReports.generateComparisonExcelByIds(request),
    },

    jobs: {
      list: () => tauriJobs.list(),
      get: (jobId) => tauriJobs.get(jobId),
      cancel: (jobId) => tauriJobs.cancel(jobId),
    },

    analysisCache: {
      stats: () => tauriAnalysisCache.stats(),
      prune: (maxTotalBytes) => tauriAnalysisCache.prune(maxTotalBytes),
    },

    experimentProjection: {
      status: () => tauriExperimentProjection.status(),
      rebuild: () => tauriExperimentProjection.rebuild(),
    },

    logger: {
      info: (message) => tauriLogger.info(message),
      error: (message) => tauriLogger.error(message),
    },

    analysis: {
      analyzeData: (...args) => tauriAnalysis.analyzeData(...args),
      detectSteps: (...args) => tauriAnalysis.detectSteps(...args),
      regroupByPattern: (...args) => tauriAnalysis.regroupByPattern(...args),
    },

    dataFlows: createTauriDataFlows(),
  };
}

// ── Bridge singleton ──────────────────────────────────────────────────

let bridgeInstance: PlatformBridge | null = null;

/**
 * Create or get the platform bridge (lazy singleton).
 * Throws if Tauri runtime is not detected.
 */
export function createBridge(): PlatformBridge {
  if (!bridgeInstance) {
    if (!isTauri()) {
      throw new Error(
        'RheoLab Enterprise requires Tauri desktop runtime. Web-only mode is not supported.',
      );
    }
    bridgeInstance = createTauriBridge();
  }
  return bridgeInstance;
}

/** Get the current bridge instance (alias for createBridge). */
export function getBridge(): PlatformBridge {
  return createBridge();
}

/** Reset the bridge singleton — useful for testing. */
export function resetBridge(): void {
  bridgeInstance = null;
}

// Re-export types so existing `import … from '@/lib/tauri/bridge'` consumers keep working
export type {
  BackupInfo,
  BackupResult,
  ExperimentDeleteResponse,
  ExperimentsExportToFileResponse,
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
  JobRecord,
  JobCancelResponse,
  AnalysisCacheStats,
  AnalysisCachePruneResponse,
  ExperimentProjectionStatus,
  ExperimentProjectionRebuildResponse,
  PlatformBridge,
} from './types';

const bridgeApi = { createBridge, getBridge, resetBridge };
export default bridgeApi;
