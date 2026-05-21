/**
 * Tauri API Types for Frontend
 *
 * Auto-generated bindings are in `./generated.d.ts` вЂ” do NOT edit them manually.
 * This file re-exports everything from the generated bindings and adds:
 *   - Backward-compat aliases for types that were renamed when migrating to specta
 *   - Frontend-only types (PlatformBridge, Window extension, analysis types)
 *   - Response types for commands that return `serde_json::Value` (not generated)
 *
 * Regenerate generated.d.ts:
 *   cd src-tauri && cargo test export_ts_bindings
 */

import type {
  RheoStep,
  ExpertSettings,
  DetectionSettingsInput,
  AnalysisResult,
} from '@/lib/analysis/types';
import type { SeriesMetaResponse, SeriesWindow } from '@/lib/series/binary-series';

// в”Ђв”Ђв”Ђ Auto-generated Rust в†’ TypeScript bindings в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
export * from './generated';

// в”Ђв”Ђв”Ђ Backward-compat aliases (old name в†’ generated name) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// These are kept for gradual migration; prefer the generated names in new code.
export type { StoredExperiment as TauriExperiment } from './generated';
export type { ExperimentListItem as TauriExperimentListItem } from './generated';
export type { StoredReagent as ReagentRecord } from './generated';
export type { ApiKeyItem as ApiKeyRecord } from './generated';
export type { FixtureItem as FixtureSummaryItem } from './generated';
export type { FixturesListResponse as FixtureSummaryResponse } from './generated';
export type { ParseRequest as ParseFileRequest } from './generated';

// ─── Operators types ──────────────────────────────────────────────────────────
export interface OperatorRecord {
    id: string;
    name: string;
    position?: string | null;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface OperatorUpsertPayload {
    name: string;
    position?: string | null;
}

export interface OperatorMutationResponse {
    success: boolean;
    operator?: OperatorRecord;
    error?: string;
}

export interface OperatorDeleteResponse {
    success: boolean;
    error?: string;
}

// ─── Laboratories types ──────────────────────────────────────────────────
export interface LaboratoryRecord {
    id: string;
    name: string;
    description?: string | null;
    location?: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface LaboratoryUpsertPayload {
    name: string;
    description?: string | null;
    location?: string | null;
}

export interface LaboratoryMutationResponse {
    success: boolean;
    laboratory?: LaboratoryRecord;
    error?: string;
}

export interface LaboratoryDeleteResponse {
    success: boolean;
    error?: string;
}

// в”Ђв”Ђв”Ђ Extend Window with Tauri global API в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    };
    __TAURI__?: {
      invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      event: {
        listen: <T>(
          event: string,
          handler: (event: { payload: T }) => void
        ) => Promise<() => void>;
        emit: (event: string, payload?: unknown) => Promise<void>;
      };
    };
  }
}

// в”Ђв”Ђв”Ђ Analysis: column-oriented input (mirrors Rust RheoPointsColumnar) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
/**
 * Structure-of-Arrays representation of raw rheometer points.
 * Matches the Rust `RheoPointsColumnar` struct (camelCase via serde).
 */
export interface RheoPointsColumnar {
  timeSec: number[];
  viscosityCp: number[];
  temperatureC: number[];
  shearRate: (number | null)[];
  shearStress: (number | null)[];
  pressureBar: (number | null)[];
  rpm: (number | null)[];
}

// в”Ђв”Ђв”Ђ Experiments: export/import responses в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
// These commands serialize arbitrary JSON (Value), so shapes are TS-only.

export interface ExperimentExportLaboratory {
  id: string;
  name: string;
  experimentCount: number;
}

export interface ExperimentsLaboratoriesResponse {
  success: boolean;
  laboratories: ExperimentExportLaboratory[];
  error?: string;
}

/** Response returned by `experiments_export_to_file`. */
export interface ExperimentsExportToFileResponse {
  success: boolean;
  filePath: string;
  fileName: string;
  total: number;
  exportedAt: string;
  error?: string;
}

export interface ExperimentsImportResponse {
  success: boolean;
  imported: number;
  updated?: number;
  skipped: number;
  errors: string[];
  totalProcessed: number;
  error?: string;
}

// в”Ђв”Ђв”Ђ Reagents: export/import responses в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

export interface ReagentsExportResponse {
  success: boolean;
  total: number;
  reagents: unknown[];
  exportedAt: string;
  error?: string;
}

export interface ReagentsImportResponse {
  success: boolean;
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
  totalProcessed: number;
  error?: string;
}

// в”Ђв”Ђв”Ђ P3 Delta-Sync Engine (commands return Value) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

/** Result of `sync_export_delta`. */
export interface SyncExportDeltaResult {
  success: boolean;
  /** Absolute path to the written delta file. */
  filePath: string;
  /** Filename only (e.g. `delta_2024-01-15T10-30-00-000Z.json`). */
  fileName: string;
  /** Number of experiments included in the delta. */
  count: number;
  exportedAt: string;
}

/** Summary of one pending conflict returned by `sync_list_conflicts`. */
export interface SyncConflict {
  id: string;
  experimentId: string;
  localUpdatedAt: string | null;
  remoteUpdatedAt: string | null;
  createdAt: string;
}

/** Result of `sync_import_delta`. */
export interface SyncImportDeltaResult {
  success: boolean;
  /** Newly inserted experiments (no local copy existed). */
  imported: number;
  /** Experiments safely overwritten (local was not newer). */
  updated: number;
  /** Conflicts that need manual resolution via `sync_resolve_conflict`. */
  conflicts: SyncConflict[];
}

/** Result of `sync_resolve_conflict`. */
export interface SyncResolveConflictResult {
  success: boolean;
  conflictId: string;
  experimentId: string;
  /** The resolution applied: `keep_local` | `keep_remote` | `keep_both`. */
  resolution: string;
}

// в”Ђв”Ђв”Ђ Unified Platform Bridge API в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

/** Current platform */
export type PlatformType = 'tauri';

export interface PlatformBridge {
  /** Current platform */
  platform: PlatformType;
  /** Whether running in a desktop environment */
  isDesktop: boolean;

  /** Local backup operations */
  backup: {
    list: () => Promise<BackupInfo[]>;
    create: () => Promise<BackupResult>;
    restore: (filename: string) => Promise<BackupResult>;
    delete: (filename: string) => Promise<BackupResult>;
    openFolder: () => Promise<void>;
  };

  /** API keys operations */
  apiKeys: {
    list: () => Promise<ApiKeyItem[]>;
    create: (payload: ApiKeyCreatePayload) => Promise<ApiKeyMutationResponse>;
    setActive: (id: string) => Promise<ApiKeyMutationResponse>;
    delete: (id: string) => Promise<ApiKeyDeleteResponse>;
    checkActive: (provider?: string) => Promise<ApiKeyValidationResponse>;
    validate: (key: string, provider?: string) => Promise<ApiKeyValidationResponse>;
    active: (provider?: string) => Promise<ActiveApiKeyResponse>;
  };

  /** Experiments operations */
  experiments: {
    list: (query?: ExperimentsListQuery) => Promise<ExperimentsListResponse>;
    count: () => Promise<ExperimentsCountResponse>;
    filterMetadata: () => Promise<ExperimentsFilterMetadataResponse>;
    get: (id: string) => Promise<ExperimentGetResponse>;
    detailMeta: (id: string) => Promise<ExperimentDetailMetaResponse>;
    rawTablePage: (
      experimentId: string,
      page: number,
      pageSize: number,
    ) => Promise<RawTablePageResponse>;
    getBatch: (ids: string[]) => Promise<ExperimentGetBatchResponse>;
    checkExistence: (ids: string[]) => Promise<ExperimentExistenceResponse>;

    save: (payload: ExperimentSavePayload) => Promise<ExperimentSaveResponse>;
    delete: (id: string) => Promise<ExperimentDeleteResponse>;
    lastContext: () => Promise<LastContextResponse>;
    exportLaboratories: () => Promise<ExperimentsLaboratoriesResponse>;
    exportToFile: (laboratoryIds?: string[]) => Promise<ExperimentsExportToFileResponse>;
    importData: (experiments: unknown[]) => Promise<ExperimentsImportResponse>;
  };

  /** Reagents catalog operations */
  reagents: {
    list: () => Promise<StoredReagent[]>;
    create: (payload: ReagentUpsertPayload) => Promise<ReagentMutationResponse>;
    update: (id: string, payload: ReagentUpsertPayload) => Promise<ReagentMutationResponse>;
    delete: (id: string) => Promise<ReagentDeleteResponse>;
    exportData: () => Promise<ReagentsExportResponse>;
    importData: (reagents: unknown[]) => Promise<ReagentsImportResponse>;
    seed: () => Promise<{ success: boolean; inserted: number }>;
  };

  /** Operators (lab personnel) management */
  operators: {
    list: () => Promise<OperatorRecord[]>;
    create: (payload: OperatorUpsertPayload) => Promise<OperatorMutationResponse>;
    update: (id: string, payload: OperatorUpsertPayload) => Promise<OperatorMutationResponse>;
    delete: (id: string) => Promise<OperatorDeleteResponse>;
  };

  /** Laboratories management */
  laboratories: {
    list: () => Promise<LaboratoryRecord[]>;
    create: (payload: LaboratoryUpsertPayload) => Promise<LaboratoryMutationResponse>;
    update: (id: string, payload: LaboratoryUpsertPayload) => Promise<LaboratoryMutationResponse>;
    delete: (id: string) => Promise<LaboratoryDeleteResponse>;
  };

  /** Water sources suggestions from local experiments */
  waterSources: {
    list: () => Promise<WaterSourcesResponse>;
  };

  /** Native report generation (desktop optional) */
  reports?: {
    generatePdf: (input: unknown) => Promise<Uint8Array>;
    generateExcel: (input: unknown) => Promise<Uint8Array>;
    generatePdfById: (request: ExperimentReportByIdRequest) => Promise<Uint8Array>;
    generateExcelById: (request: ExperimentReportByIdRequest) => Promise<Uint8Array>;
    generateComparisonPdf: (input: unknown) => Promise<Uint8Array>;
    generateComparisonExcel: (input: unknown) => Promise<Uint8Array>;
    generateComparisonPdfByIds: (request: ComparisonReportByIdsRequest) => Promise<Uint8Array>;
    generateComparisonExcelByIds: (request: ComparisonReportByIdsRequest) => Promise<Uint8Array>;
  };

  /** Runtime job scheduler status and cancellation */
  jobs?: {
    list: () => Promise<JobRecord[]>;
    get: (jobId: string) => Promise<JobRecord>;
    cancel: (jobId: string) => Promise<JobCancelResponse>;
  };

  /** Persistent AnalysisArtifact cache maintenance */
  analysisCache?: {
    stats: () => Promise<AnalysisCacheStats>;
    prune: (maxTotalBytes?: number) => Promise<AnalysisCachePruneResponse>;
  };

  /** Denormalized Library projection maintenance */
  experimentProjection?: {
    status: () => Promise<ExperimentProjectionStatus>;
    rebuild: () => Promise<ExperimentProjectionRebuildResponse>;
  };

  /** Binary by-id chart series IPC */
  series?: {
    meta: (experimentId: string) => Promise<SeriesMetaResponse>;
    overview: (
      experimentId: string,
      metrics: string[],
      maxPoints: number,
    ) => Promise<SeriesWindow>;
    window: (
      experimentId: string,
      xMinSec: number,
      xMaxSec: number,
      metrics: string[],
      maxPoints: number,
      downsampleMode?: string,
    ) => Promise<SeriesWindow>;
  };

  /** Local demo fixtures operations */
  fixtures: {
    list: () => Promise<FixturesListResponse>;
    read: (filename: string) => Promise<FixtureReadResponse>;
    parse: (filename: string) => Promise<ParseFileResponse>;
  };

  /** Native/compat parsing operations */
  parsing: {
    parseFile: (request: ParseRequest) => Promise<ParseFileResponse>;
  };

  /** Logger operations */
  logger: {
    info: (message: string) => Promise<void>;
    error: (message: string) => Promise<void>;
  };

  /** Native analysis pipeline */
  analysis: {
    analyzeData: (
      rheoPoints: RheoPointsColumnar,
      geometryKey: string,
      settings: ExpertSettings,
      detectionSettings: DetectionSettingsInput,
      cycleOverrides?: Map<number, number[]>,
    ) => Promise<AnalysisResult>;
    analyzeExperimentById: (
      experimentId: string,
      geometryKey: string,
      settings: ExpertSettings,
      detectionSettings: DetectionSettingsInput,
      cycleOverrides?: Map<number, number[]>,
    ) => Promise<AnalysisResult>;
    detectSteps: (
      rheoPoints: RheoPointsColumnar,
      detectionSettings: DetectionSettingsInput,
    ) => Promise<RheoStep[]>;
    regroupByPattern: (
      allSteps: RheoStep[],
      shearRatePattern: number[],
      geometryKey: string,
      settings: ExpertSettings,
    ) => Promise<AnalysisResult>;
  };

  /** V2 Data Flow operations */
  dataFlows?: {
    importBatches: {
      list: () => Promise<Array<Record<string, unknown>>>;
      get: (id: string) => Promise<Record<string, unknown>>;
    };
    experimentPayloads: {
      list: (experimentId: string) => Promise<Array<Record<string, unknown>>>;
    };
    parserArtifacts: {
      list: (experimentId: string) => Promise<Array<Record<string, unknown>>>;
      get: (id: string) => Promise<Record<string, unknown>>;
    };
    reportArtifacts: {
      list: (experimentId: string) => Promise<Array<Record<string, unknown>>>;
      save: (params: {
        experimentId: string;
        reportType: string;
        templateVersion?: string;
        settingsJson?: string;
        storagePath?: string;
        binarySha256?: string;
        sizeBytes?: number;
      }) => Promise<Record<string, unknown>>;
      delete: (id: string) => Promise<Record<string, unknown>>;
    };
    searchProjections: {
      list: (limit?: number) => Promise<Record<string, unknown>>;
    };
    sync: {
      status: () => Promise<{
        outboxPending: number;
        outboxFailed: number;
        inboxPending: number;
        conflictsOpen: number;
        lastSyncAt: string | null;
      }>;
      outboxList: (statusFilter?: string) => Promise<Array<Record<string, unknown>>>;
      outboxMarkSynced: (ids: string[]) => Promise<Record<string, unknown>>;
      outboxRetry: (ids: string[]) => Promise<Record<string, unknown>>;
      inboxReceive: (events: Array<Record<string, unknown>>) => Promise<Record<string, unknown>>;
      inboxList: (statusFilter?: string) => Promise<Array<Record<string, unknown>>>;
    };
    conflicts: {
      list: (statusFilter?: string) => Promise<Array<Record<string, unknown>>>;
      resolve: (conflictId: string, resolution: string) => Promise<Record<string, unknown>>;
    };
  };
}

export {};
