import { safeInvoke as invoke } from './core';
import type {
  AnalysisCachePruneResponse,
  AnalysisCacheStats,
  ExperimentProjectionRebuildResponse,
  ExperimentProjectionStatus,
  JobCancelResponse,
  JobRecord,
} from '@/types/tauri';

export const jobs = {
  list(): Promise<JobRecord[]> {
    return invoke<JobRecord[]>('jobs_list');
  },

  get(jobId: string): Promise<JobRecord> {
    return invoke<JobRecord>('jobs_get', { jobId });
  },

  cancel(jobId: string): Promise<JobCancelResponse> {
    return invoke<JobCancelResponse>('jobs_cancel', { jobId });
  },
};

export const analysisCache = {
  stats(): Promise<AnalysisCacheStats> {
    return invoke<AnalysisCacheStats>('analysis_cache_stats');
  },

  prune(maxTotalBytes?: number): Promise<AnalysisCachePruneResponse> {
    return invoke<AnalysisCachePruneResponse>('analysis_cache_prune', { maxTotalBytes });
  },
};

export const experimentProjection = {
  status(): Promise<ExperimentProjectionStatus> {
    return invoke<ExperimentProjectionStatus>('experiments_projection_status');
  },

  rebuild(): Promise<ExperimentProjectionRebuildResponse> {
    return invoke<ExperimentProjectionRebuildResponse>('experiments_projection_rebuild');
  },
};
