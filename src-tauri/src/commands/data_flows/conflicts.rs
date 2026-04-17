use crate::error::{AppError, Result};
use crate::state::AppState;
use rusqlite::params;
use serde_json::{json, Value};
use tauri::State;

use super::helpers::now_iso;
use super::types::ConflictItem;

pub(super) const CONFLICT_STATUSES: &[&str] = &["open", "resolved"];

#[tauri::command]
pub async fn conflicts_list(
    state: State<'_, AppState>,
    status_filter: Option<String>,
) -> Result<Vec<ConflictItem>> {
    if let Some(ref s) = status_filter {
        if !CONFLICT_STATUSES.contains(&s.as_str()) {
            return Err(AppError::BadRequest(format!(
                "invalid status_filter '{s}', expected one of: {CONFLICT_STATUSES:?}"
            )));
        }
    }
    let conn = state.pool_conn()?;
    let filter = status_filter.unwrap_or_else(|| "open".to_string());

    let mut stmt = conn
        .prepare(
            "SELECT id, mergeEventId, experimentId, fieldName, \
                    localValue, incomingValue, resolution, status, \
                    createdAt, resolvedAt \
             FROM ConflictRecord WHERE status = ?1 \
             ORDER BY createdAt DESC LIMIT 500",
        )?;

    let rows = stmt
        .query_map(params![filter], |row| {
            Ok(ConflictItem {
                id: row.get(0)?,
                merge_event_id: row.get(1)?,
                experiment_id: row.get(2)?,
                field_name: row.get(3)?,
                local_value: row.get(4)?,
                incoming_value: row.get(5)?,
                resolution: row.get(6)?,
                status: row.get(7)?,
                created_at: row.get(8)?,
                resolved_at: row.get(9)?,
            })
        })?;

    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::Sql)
}

/// Resolve one or more conflicts.
#[tauri::command]
pub async fn conflicts_resolve(
    state: State<'_, AppState>,
    conflict_id: String,
    resolution: String,
) -> Result<Value> {
    if conflict_id.is_empty() {
        return Err(AppError::BadRequest("conflict_id must not be empty".into()));
    }
    if resolution.is_empty() {
        return Err(AppError::BadRequest("resolution must not be empty".into()));
    }
    let conn = state.pool_conn()?;
    let now = now_iso();

    let updated = conn
        .execute(
            "UPDATE ConflictRecord SET resolution = ?1, status = 'resolved', resolvedAt = ?2 \
             WHERE id = ?3 AND status = 'open'",
            params![resolution, now, conflict_id],
        )?;

    if updated == 0 {
        return Ok(json!({ "success": false, "error": "Conflict not found or already resolved" }));
    }

    Ok(json!({ "success": true }))
}
