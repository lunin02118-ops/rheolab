//! Tauri command handlers for Operator CRUD.

use crate::error::Result;
use crate::state::AppState;
use rusqlite::{params, OptionalExtension};
use tauri::State;
use uuid::Uuid;

use super::types::*;

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn get_operator(conn: &rusqlite::Connection, id: &str) -> Result<Option<StoredOperator>> {
    conn.query_row(
        "SELECT id, name, position, isActive, createdAt, updatedAt FROM Operator WHERE id = ?1",
        params![id],
        |row| {
            Ok(StoredOperator {
                id: row.get(0)?,
                name: row.get(1)?,
                position: row.get(2)?,
                is_active: row.get::<_, i64>(3)? != 0,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("SQL error: {}", e).into())
}

#[tauri::command]
pub async fn operators_list(state: State<'_, AppState>) -> Result<Vec<StoredOperator>> {
    let conn = state.pool_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, position, isActive, createdAt, updatedAt \
             FROM Operator WHERE isActive = 1 ORDER BY name COLLATE NOCASE",
        )
        .map_err(|e| format!("SQL error: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(StoredOperator {
                id: row.get(0)?,
                name: row.get(1)?,
                position: row.get(2)?,
                is_active: row.get::<_, i64>(3)? != 0,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| format!("SQL error: {e}"))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("SQL row error: {e}"))?;
    Ok(rows)
}

#[tauri::command]
pub async fn operators_create(
    state: State<'_, AppState>,
    payload: OperatorUpsertPayload,
) -> Result<OperatorMutationResponse> {
    let name = payload.name.trim().to_string();
    if name.is_empty() {
        return Ok(OperatorMutationResponse::err("Имя оператора обязательно"));
    }

    let conn = state.pool_conn()?;

    // Duplicate name check
    let exists: Option<String> = conn
        .query_row(
            "SELECT id FROM Operator WHERE name = ?1 COLLATE NOCASE LIMIT 1",
            params![name],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("SQL error: {e}"))?;
    if exists.is_some() {
        return Ok(OperatorMutationResponse::err(
            "Оператор с таким именем уже существует",
        ));
    }

    let id = Uuid::new_v4().to_string();
    let now = now_rfc3339();
    conn.execute(
        "INSERT INTO Operator (id, name, position, isActive, createdAt, updatedAt) \
         VALUES (?1, ?2, ?3, 1, ?4, ?4)",
        params![id, name, payload.position, now],
    )
    .map_err(|e| format!("SQL error: {e}"))?;

    match get_operator(&conn, &id)? {
        Some(op) => Ok(OperatorMutationResponse::ok(op)),
        None => Ok(OperatorMutationResponse::err("Insert succeeded but operator not found")),
    }
}

#[tauri::command]
pub async fn operators_update(
    state: State<'_, AppState>,
    id: String,
    payload: OperatorUpsertPayload,
) -> Result<OperatorMutationResponse> {
    let name = payload.name.trim().to_string();
    if name.is_empty() {
        return Ok(OperatorMutationResponse::err("Имя оператора обязательно"));
    }

    let conn = state.pool_conn()?;

    // Duplicate name check (excluding self)
    let duplicate: Option<String> = conn
        .query_row(
            "SELECT id FROM Operator WHERE name = ?1 COLLATE NOCASE AND id != ?2 LIMIT 1",
            params![name, id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("SQL error: {e}"))?;
    if duplicate.is_some() {
        return Ok(OperatorMutationResponse::err(
            "Оператор с таким именем уже существует",
        ));
    }

    let now = now_rfc3339();
    let changed = conn
        .execute(
            "UPDATE Operator SET name = ?1, position = ?2, updatedAt = ?3 WHERE id = ?4",
            params![name, payload.position, now, id],
        )
        .map_err(|e| format!("SQL error: {e}"))?;

    if changed == 0 {
        return Ok(OperatorMutationResponse::err("Оператор не найден"));
    }

    match get_operator(&conn, &id)? {
        Some(op) => Ok(OperatorMutationResponse::ok(op)),
        None => Ok(OperatorMutationResponse::err("Update succeeded but operator not found")),
    }
}

#[tauri::command]
pub async fn operators_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<OperatorDeleteResponse> {
    let conn = state.pool_conn()?;
    // Soft-delete: mark inactive
    let changed = conn
        .execute(
            "UPDATE Operator SET isActive = 0, updatedAt = ?1 WHERE id = ?2",
            params![now_rfc3339(), id],
        )
        .map_err(|e| format!("SQL error: {e}"))?;

    if changed == 0 {
        return Ok(OperatorDeleteResponse {
            success: false,
            error: Some("Оператор не найден".to_string()),
        });
    }
    Ok(OperatorDeleteResponse { success: true, error: None })
}
