//! Job scheduler and cache-maintenance IPC commands.

use crate::db::repositories::analysis_artifacts::prune_analysis_artifacts_lru;
use crate::db::repositories::experiment_projection::{
    mark_full_rebuild_complete, projection_status, rebuild_facet_cache, rebuild_projection_batch,
    ExperimentProjectionStatus, FacetRebuildResult,
};
use crate::error::{AppError, Result};
use crate::runtime::jobs::{JobCancelResponse, JobKind, JobRecord};
use crate::state::AppState;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

const DEFAULT_ANALYSIS_CACHE_MAX_BYTES: i64 = 256 * 1024 * 1024;
const PROJECTION_REBUILD_BATCH_SIZE: usize = 250;

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisCacheStats {
    pub total_rows: i64,
    pub total_bytes: i64,
    pub accessed_rows: i64,
    pub oldest_updated_at: Option<String>,
    pub newest_updated_at: Option<String>,
    pub newest_accessed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisCachePruneResponse {
    pub max_total_bytes: i64,
    pub deleted_rows: usize,
    pub before: AnalysisCacheStats,
    pub after: AnalysisCacheStats,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentProjectionRebuildResponse {
    pub before: ExperimentProjectionStatus,
    pub after: ExperimentProjectionStatus,
    pub rebuilt_rows: usize,
    pub facet_rebuild: FacetRebuildResult,
}

#[tauri::command]
pub async fn jobs_list(state: State<'_, AppState>) -> Result<Vec<JobRecord>> {
    Ok(state.job_scheduler.list())
}

#[tauri::command]
pub async fn jobs_get(state: State<'_, AppState>, job_id: String) -> Result<JobRecord> {
    state.job_scheduler.get(&job_id)
}

#[tauri::command]
pub async fn jobs_cancel(state: State<'_, AppState>, job_id: String) -> Result<JobCancelResponse> {
    state.job_scheduler.cancel(&job_id)
}

#[tauri::command]
pub async fn analysis_cache_stats(state: State<'_, AppState>) -> Result<AnalysisCacheStats> {
    let pool = state.db_pool.clone();
    tokio::task::spawn_blocking(move || {
        let conn = pool.get().map_err(AppError::Pool)?;
        query_analysis_cache_stats(&conn)
    })
    .await?
}

#[tauri::command]
pub async fn analysis_cache_prune(
    app: AppHandle,
    state: State<'_, AppState>,
    max_total_bytes: Option<i64>,
) -> Result<AnalysisCachePruneResponse> {
    let max_total_bytes = max_total_bytes.unwrap_or(DEFAULT_ANALYSIS_CACHE_MAX_BYTES);
    if max_total_bytes < 0 {
        return Err(AppError::BadRequest(
            "maxTotalBytes must be greater than or equal to 0".into(),
        ));
    }

    let pool = state.db_pool.clone();
    #[cfg(not(test))]
    let app_handle = Some(app);
    #[cfg(test)]
    let app_handle = {
        let _ = app;
        Some(())
    };
    state
        .job_scheduler
        .run_blocking(app_handle, JobKind::AnalysisCachePrune, move |ctx| {
            ctx.progress(
                "prune_cache",
                0,
                Some(1),
                Some("Pruning AnalysisArtifact cache".into()),
            );
            ctx.ensure_not_cancelled()?;

            let conn = pool.get().map_err(AppError::Pool)?;
            let before = query_analysis_cache_stats(&conn)?;
            let deleted_rows = prune_analysis_artifacts_lru(&conn, max_total_bytes)?;
            let after = query_analysis_cache_stats(&conn)?;

            ctx.progress(
                "done",
                1,
                Some(1),
                Some("AnalysisArtifact cache pruned".into()),
            );
            Ok(AnalysisCachePruneResponse {
                max_total_bytes,
                deleted_rows,
                before,
                after,
            })
        })
        .await
}

#[tauri::command]
pub async fn experiments_projection_status(
    state: State<'_, AppState>,
) -> Result<ExperimentProjectionStatus> {
    let pool = state.db_pool.clone();
    tokio::task::spawn_blocking(move || {
        let conn = pool.get().map_err(AppError::Pool)?;
        projection_status(&conn)
    })
    .await?
}

#[tauri::command]
pub async fn experiments_projection_rebuild(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ExperimentProjectionRebuildResponse> {
    let pool = state.db_pool.clone();
    #[cfg(not(test))]
    let app_handle = Some(app);
    #[cfg(test)]
    let app_handle = {
        let _ = app;
        Some(())
    };

    state
        .job_scheduler
        .run_blocking(
            app_handle,
            JobKind::ExperimentProjectionRebuild,
            move |ctx| {
                ctx.progress(
                    "projection_status",
                    0,
                    None,
                    Some("Reading library projection status".into()),
                );
                ctx.ensure_not_cancelled()?;

                let before = {
                    let conn = pool.get().map_err(AppError::Pool)?;
                    projection_status(&conn)?
                };

                let mut rebuilt_rows = 0usize;
                let mut after_id: Option<String> = None;
                let total = before.experiment_count.max(0) as u64;

                loop {
                    ctx.ensure_not_cancelled()?;
                    let batch = {
                        let conn = pool.get().map_err(AppError::Pool)?;
                        rebuild_projection_batch(
                            &conn,
                            after_id.as_deref(),
                            PROJECTION_REBUILD_BATCH_SIZE,
                        )?
                    };
                    rebuilt_rows += batch.processed;
                    after_id = batch.last_experiment_id;
                    ctx.progress(
                        "projection_rebuild",
                        rebuilt_rows as u64,
                        Some(total),
                        Some("Rebuilding ExperimentListProjection".into()),
                    );
                    if !batch.has_more || batch.processed == 0 {
                        break;
                    }
                }

                ctx.ensure_not_cancelled()?;
                let (facet_rebuild, after) = {
                    let conn = pool.get().map_err(AppError::Pool)?;
                    mark_full_rebuild_complete(&conn)?;
                    ctx.progress(
                        "facet_rebuild",
                        rebuilt_rows as u64,
                        Some(total),
                        Some("Rebuilding ExperimentFacetCache".into()),
                    );
                    let facet_rebuild = rebuild_facet_cache(&conn)?;
                    let after = projection_status(&conn)?;
                    (facet_rebuild, after)
                };

                ctx.progress(
                    "done",
                    total,
                    Some(total),
                    Some("Library projection rebuild complete".into()),
                );

                Ok(ExperimentProjectionRebuildResponse {
                    before,
                    after,
                    rebuilt_rows,
                    facet_rebuild,
                })
            },
        )
        .await
}

fn query_analysis_cache_stats(conn: &Connection) -> Result<AnalysisCacheStats> {
    conn.query_row(
        "SELECT COUNT(*),
                COALESCE(SUM(artifactBytes), 0),
                COUNT(lastAccessedAt),
                MIN(updatedAt),
                MAX(updatedAt),
                MAX(lastAccessedAt)
         FROM AnalysisArtifact",
        [],
        |row| {
            Ok(AnalysisCacheStats {
                total_rows: row.get(0)?,
                total_bytes: row.get(1)?,
                accessed_rows: row.get(2)?,
                oldest_updated_at: row.get(3)?,
                newest_updated_at: row.get(4)?,
                newest_accessed_at: row.get(5)?,
            })
        },
    )
    .map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations::v0008_analysis_artifact::V0008AnalysisArtifact;
    use crate::db::migrations::Migration;
    use rusqlite::params;

    #[test]
    fn analysis_cache_stats_counts_rows_and_bytes() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE Experiment (
                id TEXT PRIMARY KEY,
                createdAt TEXT NOT NULL DEFAULT '',
                updatedAt TEXT NOT NULL DEFAULT ''
            );",
        )
        .unwrap();
        V0008AnalysisArtifact.up(&conn).unwrap();
        conn.execute("INSERT INTO Experiment (id) VALUES ('exp-1')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO AnalysisArtifact (
                id, experimentId, experimentDataHash, geometry,
                analysisSettingsHash, reportViscosityRatesHash,
                rheolabCoreVersion, algorithmVersion,
                artifactEncoding, artifactBlob, artifactBytes,
                createdAt, updatedAt, lastAccessedAt, hitCount
            ) VALUES (
                'a1', 'exp-1', ?1, 'R1B5', ?2, ?3, '0.2.2-alpha.3', 1,
                'analysis-output.json+zstd:v1', x'010203', 3,
                '2026-04-29T00:00:00Z', '2026-04-29T00:00:00Z',
                '2026-04-29T00:01:00Z', 1
            )",
            params!["a".repeat(64), "b".repeat(64), "c".repeat(64)],
        )
        .unwrap();

        let stats = query_analysis_cache_stats(&conn).unwrap();
        assert_eq!(stats.total_rows, 1);
        assert_eq!(stats.total_bytes, 3);
        assert_eq!(stats.accessed_rows, 1);
        assert_eq!(
            stats.newest_accessed_at.as_deref(),
            Some("2026-04-29T00:01:00Z")
        );
    }
}
