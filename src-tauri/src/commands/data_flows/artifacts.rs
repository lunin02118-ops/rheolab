use crate::error::{AppError, Result};
use crate::state::AppState;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use tauri::State;

use super::helpers::create_report_artifact;
use super::types::{ExperimentPayloadItem, ParserArtifactItem, ReportArtifactItem};

// ---------------------------------------------------------------------------
// Tauri commands — ExperimentPayload
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn experiment_payloads_list(
    state: State<'_, AppState>,
    experiment_id: String,
) -> Result<Vec<ExperimentPayloadItem>> {
    if experiment_id.is_empty() {
        return Err(AppError::BadRequest("experiment_id must not be empty".into()));
    }
    let conn = state.pool_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, experimentId, importBatchId, payloadVersion, \
                    payloadFormat, contentFingerprint, sourceLabId, \
                    isCanonical, createdAt \
             FROM ExperimentPayload WHERE experimentId = ?1 \
             ORDER BY payloadVersion DESC",
        )?;

    let rows = stmt
        .query_map(params![experiment_id], |row| {
            Ok(ExperimentPayloadItem {
                id: row.get(0)?,
                experiment_id: row.get(1)?,
                import_batch_id: row.get(2)?,
                payload_version: row.get(3)?,
                payload_format: row.get(4)?,
                content_fingerprint: row.get(5)?,
                source_lab_id: row.get(6)?,
                is_canonical: row.get::<_, i32>(7)? != 0,
                created_at: row.get(8)?,
            })
        })?;

    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::Sql)
}

// ---------------------------------------------------------------------------
// Tauri commands — ParserArtifact
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn parser_artifacts_list(
    state: State<'_, AppState>,
    experiment_id: String,
) -> Result<Vec<ParserArtifactItem>> {
    if experiment_id.is_empty() {
        return Err(AppError::BadRequest("experiment_id must not be empty".into()));
    }
    let conn = state.pool_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, experimentId, importBatchId, parserVersion, \
                    schemaVersion, contentFingerprint, promotedToHot, createdAt \
             FROM ParserArtifact WHERE experimentId = ?1 \
             ORDER BY createdAt DESC",
        )?;

    let rows = stmt
        .query_map(params![experiment_id], |row| {
            Ok(ParserArtifactItem {
                id: row.get(0)?,
                experiment_id: row.get(1)?,
                import_batch_id: row.get(2)?,
                parser_version: row.get(3)?,
                schema_version: row.get(4)?,
                content_fingerprint: row.get(5)?,
                promoted_to_hot: row.get::<_, i32>(6)? != 0,
                created_at: row.get(7)?,
            })
        })?;

    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::Sql)
}

/// Read the raw artifact JSON for a specific parser artifact.
#[tauri::command]
pub async fn parser_artifacts_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<Value> {
    if id.is_empty() {
        return Err(AppError::BadRequest("id must not be empty".into()));
    }
    let conn = state.pool_conn()?;
    let json_str: Option<String> = conn
        .query_row(
            "SELECT artifactJson FROM ParserArtifact WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;

    match json_str {
        Some(s) => {
            let parsed: Value =
                serde_json::from_str(&s).unwrap_or(Value::String(s));
            Ok(json!({ "success": true, "artifact": parsed }))
        }
        None => Ok(json!({ "success": false, "error": "Parser artifact not found" })),
    }
}

// ---------------------------------------------------------------------------
// Tauri commands — ReportArtifact
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn report_artifacts_list(
    state: State<'_, AppState>,
    experiment_id: String,
) -> Result<Vec<ReportArtifactItem>> {
    if experiment_id.is_empty() {
        return Err(AppError::BadRequest("experiment_id must not be empty".into()));
    }
    let conn = state.pool_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, experimentId, importBatchId, reportType, \
                    templateVersion, storagePath, binarySha256, sizeBytes, createdAt \
             FROM ReportArtifact WHERE experimentId = ?1 \
             ORDER BY createdAt DESC",
        )?;

    let rows = stmt
        .query_map(params![experiment_id], |row| {
            Ok(ReportArtifactItem {
                id: row.get(0)?,
                experiment_id: row.get(1)?,
                import_batch_id: row.get(2)?,
                report_type: row.get(3)?,
                template_version: row.get(4)?,
                storage_path: row.get(5)?,
                binary_sha256: row.get(6)?,
                size_bytes: row.get(7)?,
                created_at: row.get(8)?,
            })
        })?;

    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::Sql)
}

#[tauri::command]
pub async fn report_artifacts_save(
    state: State<'_, AppState>,
    experiment_id: String,
    report_type: String,
    template_version: Option<String>,
    settings_json: Option<String>,
    storage_path: Option<String>,
    binary_sha256: Option<String>,
    size_bytes: Option<i64>,
) -> Result<Value> {
    if experiment_id.is_empty() {
        return Err(AppError::BadRequest("experiment_id must not be empty".into()));
    }
    if report_type.is_empty() {
        return Err(AppError::BadRequest("report_type must not be empty".into()));
    }
    let conn = state.pool_conn()?;
    let id = create_report_artifact(
        &conn,
        &experiment_id,
        None,
        &report_type,
        template_version.as_deref(),
        settings_json.as_deref(),
        storage_path.as_deref(),
        binary_sha256.as_deref(),
        size_bytes,
    )?;
    Ok(json!({ "success": true, "id": id }))
}

#[tauri::command]
pub async fn report_artifacts_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<Value> {
    if id.is_empty() {
        return Err(AppError::BadRequest("id must not be empty".into()));
    }
    let conn = state.pool_conn()?;
    let deleted = conn
        .execute("DELETE FROM ReportArtifact WHERE id = ?1", params![id])?;

    if deleted == 0 {
        return Ok(json!({ "success": false, "error": "Report artifact not found" }));
    }
    Ok(json!({ "success": true }))
}
