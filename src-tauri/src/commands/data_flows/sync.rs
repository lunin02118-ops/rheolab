use crate::error::{AppError, Result};
use crate::state::AppState;
use rusqlite::params;
use serde_json::{json, Value};
use tauri::State;

use super::helpers::{new_id, now_iso};
use super::types::{SyncStatusResponse, SyncOutboxItem, SyncInboxItem};

pub(super) const OUTBOX_STATUSES: &[&str] = &["pending", "failed", "synced"];
pub(super) const INBOX_STATUSES: &[&str] = &["pending", "processed", "failed"];

#[tauri::command]
pub async fn sync_status(state: State<'_, AppState>) -> Result<SyncStatusResponse> {
    let conn = state.pool_conn()?;

    let outbox_pending: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM SyncOutbox WHERE status = 'pending'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let outbox_failed: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM SyncOutbox WHERE status = 'failed'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let inbox_pending: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM SyncInbox WHERE status = 'pending'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let conflicts_open: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM ConflictRecord WHERE status = 'open'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);

    let last_sync_at: Option<String> = conn
        .query_row(
            "SELECT MAX(processedAt) FROM SyncOutbox WHERE status = 'synced'",
            [],
            |row| row.get(0),
        )
        .unwrap_or(None);

    Ok(SyncStatusResponse {
        outbox_pending,
        outbox_failed,
        inbox_pending,
        conflicts_open,
        last_sync_at,
    })
}

#[tauri::command]
pub async fn sync_outbox_list(
    state: State<'_, AppState>,
    status_filter: Option<String>,
) -> Result<Vec<SyncOutboxItem>> {
    if let Some(ref s) = status_filter {
        if !OUTBOX_STATUSES.contains(&s.as_str()) {
            return Err(AppError::BadRequest(format!(
                "invalid status_filter '{s}', expected one of: {OUTBOX_STATUSES:?}"
            )));
        }
    }
    let conn = state.pool_conn()?;

    let (query, filter_val);
    if let Some(ref status) = status_filter {
        query = "SELECT id, entityType, entityId, operation, status, \
                        retryCount, nextAttemptAt, lastError, createdAt, processedAt \
                 FROM SyncOutbox WHERE status = ?1 ORDER BY createdAt DESC LIMIT 200";
        filter_val = Some(status.clone());
    } else {
        query = "SELECT id, entityType, entityId, operation, status, \
                        retryCount, nextAttemptAt, lastError, createdAt, processedAt \
                 FROM SyncOutbox ORDER BY createdAt DESC LIMIT 200";
        filter_val = None;
    }

    let mut stmt = conn.prepare(query)?;

    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<SyncOutboxItem> {
        Ok(SyncOutboxItem {
            id: row.get(0)?,
            entity_type: row.get(1)?,
            entity_id: row.get(2)?,
            operation: row.get(3)?,
            status: row.get(4)?,
            retry_count: row.get(5)?,
            next_attempt_at: row.get(6)?,
            last_error: row.get(7)?,
            created_at: row.get(8)?,
            processed_at: row.get(9)?,
        })
    };

    let items = if let Some(ref val) = filter_val {
        stmt.query_map(params![val], map_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?
    } else {
        stmt.query_map([], map_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };

    Ok(items)
}

/// Mark outbox entries as synced.
#[tauri::command]
pub async fn sync_outbox_mark_synced(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<Value> {
    if ids.is_empty() {
        return Err(AppError::BadRequest("ids must not be empty".into()));
    }
    let conn = state.pool_conn()?;
    let now = now_iso();
    let mut marked = 0i64;

    let tx = conn.unchecked_transaction()?;
    for id in &ids {
        let updated = tx
            .execute(
                "UPDATE SyncOutbox SET status = 'synced', processedAt = ?1 WHERE id = ?2",
                params![now, id],
            )?;
        marked += updated as i64;
    }
    tx.commit()?;

    Ok(json!({ "success": true, "marked": marked }))
}

/// Retry failed outbox entries (reset status to pending).
#[tauri::command]
pub async fn sync_outbox_retry(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<Value> {
    if ids.is_empty() {
        return Err(AppError::BadRequest("ids must not be empty".into()));
    }
    let conn = state.pool_conn()?;
    let mut retried = 0i64;

    let tx = conn.unchecked_transaction()?;
    for id in &ids {
        let updated = tx
            .execute(
                "UPDATE SyncOutbox SET status = 'pending', lastError = NULL WHERE id = ?1 AND status = 'failed'",
                params![id],
            )?;
        retried += updated as i64;
    }
    tx.commit()?;

    Ok(json!({ "success": true, "retried": retried }))
}

/// Receive sync events into the inbox (typically from a cloud download).
#[tauri::command]
pub async fn sync_inbox_receive(
    state: State<'_, AppState>,
    events: Vec<Value>,
) -> Result<Value> {
    let conn = state.pool_conn()?;
    let mut received = 0i64;
    let mut duplicates = 0i64;

    let tx = conn.unchecked_transaction()?;
    for event in &events {
        let remote_event_id = event
            .get("remoteEventId")
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        if remote_event_id.is_empty() {
            continue;
        }

        // Skip duplicates
        let exists: bool = tx
            .query_row(
                "SELECT COUNT(*) FROM SyncInbox WHERE remoteEventId = ?1",
                params![remote_event_id],
                |row| row.get::<_, i32>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);

        if exists {
            duplicates += 1;
            continue;
        }

        let id = new_id();
        let source_lab_id = event
            .get("sourceLabId")
            .and_then(|v| v.as_str());
        let source_system = event
            .get("sourceSystem")
            .and_then(|v| v.as_str());
        let source_app_version = event
            .get("sourceAppVersion")
            .and_then(|v| v.as_str());
        let payload_json = serde_json::to_string(event).unwrap_or_default();

        tx.execute(
            "INSERT INTO SyncInbox \
             (id, remoteEventId, sourceLabId, sourceSystem, sourceAppVersion, \
              payloadJson, status, receivedAt) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)",
            params![
                id,
                remote_event_id,
                source_lab_id,
                source_system,
                source_app_version,
                payload_json,
                now_iso(),
            ],
        )?;
        received += 1;
    }
    tx.commit()?;

    Ok(json!({
        "success": true,
        "received": received,
        "duplicates": duplicates
    }))
}

#[tauri::command]
pub async fn sync_inbox_list(
    state: State<'_, AppState>,
    status_filter: Option<String>,
) -> Result<Vec<SyncInboxItem>> {
    if let Some(ref s) = status_filter {
        if !INBOX_STATUSES.contains(&s.as_str()) {
            return Err(AppError::BadRequest(format!(
                "invalid status_filter '{s}', expected one of: {INBOX_STATUSES:?}"
            )));
        }
    }
    let conn = state.pool_conn()?;

    let (query, filter_val);
    if let Some(ref status) = status_filter {
        query = "SELECT id, remoteEventId, sourceLabId, sourceSystem, status, \
                        receivedAt, processedAt, importBatchId \
                 FROM SyncInbox WHERE status = ?1 ORDER BY receivedAt DESC LIMIT 200";
        filter_val = Some(status.clone());
    } else {
        query = "SELECT id, remoteEventId, sourceLabId, sourceSystem, status, \
                        receivedAt, processedAt, importBatchId \
                 FROM SyncInbox ORDER BY receivedAt DESC LIMIT 200";
        filter_val = None;
    }

    let mut stmt = conn.prepare(query)?;

    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<SyncInboxItem> {
        Ok(SyncInboxItem {
            id: row.get(0)?,
            remote_event_id: row.get(1)?,
            source_lab_id: row.get(2)?,
            source_system: row.get(3)?,
            status: row.get(4)?,
            received_at: row.get(5)?,
            processed_at: row.get(6)?,
            import_batch_id: row.get(7)?,
        })
    };

    let items = if let Some(ref val) = filter_val {
        stmt.query_map(params![val], map_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?
    } else {
        stmt.query_map([], map_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };

    Ok(items)
}
