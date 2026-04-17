/**
 * Bridge wrappers for V2 Data Flow commands.
 * These are Tauri-only features.
 *
 * Covered: importBatches, experimentPayloads, parserArtifacts,
 *          reportArtifacts, searchProjections, sync, conflicts
 */
import {
  importBatches as tauriImportBatches,
  experimentPayloads as tauriExperimentPayloads,
  parserArtifacts as tauriParserArtifacts,
  reportArtifacts as tauriReportArtifacts,
  searchProjections as tauriSearchProjections,
  sync as tauriSync,
  conflicts as tauriConflicts,
} from '../index';

export type DataFlowsBridge = {
  importBatches: typeof tauriImportBatches;
  experimentPayloads: typeof tauriExperimentPayloads;
  parserArtifacts: typeof tauriParserArtifacts;
  reportArtifacts: typeof tauriReportArtifacts;
  searchProjections: typeof tauriSearchProjections;
  sync: typeof tauriSync;
  conflicts: typeof tauriConflicts;
};

/** Create data-flows sub-bridge for Tauri runtime. */
export function createTauriDataFlows(): DataFlowsBridge {
  return {
    importBatches: tauriImportBatches,
    experimentPayloads: tauriExperimentPayloads,
    parserArtifacts: tauriParserArtifacts,
    reportArtifacts: tauriReportArtifacts,
    searchProjections: tauriSearchProjections,
    sync: tauriSync,
    conflicts: tauriConflicts,
  };
}

