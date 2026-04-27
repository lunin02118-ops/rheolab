use crate::error::{AppError, Result};
use crate::state::AppState;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use tauri::State;

use super::types::{ExperimentPayloadItem, ImportBatchItem};

#[tauri::command]
pub async fn import_batches_list(state: State<'_, AppState>) -> Result<Vec<ImportBatchItem>> {
    let conn = state.pool_conn()?;
    let mut stmt = conn.prepare(
        "SELECT id, sourceLabId, sourceSystem, sourceAppVersion, \
                    importedByUserId, fileName, checksum, notes, \
                    experimentsImported, duplicatesDetected, status, \
                    createdAt, updatedAt \
             FROM ImportBatch ORDER BY createdAt DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(ImportBatchItem {
            id: row.get(0)?,
            source_lab_id: row.get(1)?,
            source_system: row.get(2)?,
            source_app_version: row.get(3)?,
            imported_by_user_id: row.get(4)?,
            file_name: row.get(5)?,
            checksum: row.get(6)?,
            notes: row.get(7)?,
            experiments_imported: row.get(8)?,
            duplicates_detected: row.get(9)?,
            status: row.get(10)?,
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
        })
    })?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

#[tauri::command]
pub async fn import_batches_get(state: State<'_, AppState>, id: String) -> Result<Value> {
    if id.is_empty() {
        return Err(AppError::BadRequest("id must not be empty".into()));
    }
    let conn = state.pool_conn()?;

    let batch: Option<ImportBatchItem> = conn
        .query_row(
            "SELECT id, sourceLabId, sourceSystem, sourceAppVersion, \
                    importedByUserId, fileName, checksum, notes, \
                    experimentsImported, duplicatesDetected, status, \
                    createdAt, updatedAt \
             FROM ImportBatch WHERE id = ?1",
            params![id],
            |row| {
                Ok(ImportBatchItem {
                    id: row.get(0)?,
                    source_lab_id: row.get(1)?,
                    source_system: row.get(2)?,
                    source_app_version: row.get(3)?,
                    imported_by_user_id: row.get(4)?,
                    file_name: row.get(5)?,
                    checksum: row.get(6)?,
                    notes: row.get(7)?,
                    experiments_imported: row.get(8)?,
                    duplicates_detected: row.get(9)?,
                    status: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            },
        )
        .optional()?;

    let Some(batch) = batch else {
        return Ok(json!({ "success": false, "error": "Import batch not found" }));
    };

    // Load associated payloads
    let mut stmt = conn.prepare(
        "SELECT id, experimentId, importBatchId, payloadVersion, \
                    payloadFormat, contentFingerprint, sourceLabId, \
                    isCanonical, createdAt \
             FROM ExperimentPayload WHERE importBatchId = ?1 \
             ORDER BY createdAt",
    )?;

    let payloads = stmt
        .query_map(params![id], |row| {
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
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(json!({
        "success": true,
        "batch": batch,
        "payloads": payloads
    }))
}
