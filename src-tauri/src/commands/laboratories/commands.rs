//! Tauri command handlers for Laboratory CRUD.

use crate::error::Result;
use crate::state::AppState;
use crate::utils::validation::{validate_bounded_str, validate_uuid};
use rusqlite::{params, OptionalExtension};
use tauri::State;
use uuid::Uuid;

use super::types::*;

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn get_laboratory(conn: &rusqlite::Connection, id: &str) -> Result<Option<StoredLaboratory>> {
    conn.query_row(
        "SELECT id, name, description, location, createdAt, updatedAt FROM Laboratory WHERE id = ?1",
        params![id],
        |row| {
            Ok(StoredLaboratory {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                location: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("SQL error: {}", e).into())
}

#[tauri::command]
pub async fn laboratories_list(state: State<'_, AppState>) -> Result<Vec<StoredLaboratory>> {
    let conn = state.pool_conn()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, description, location, createdAt, updatedAt \
             FROM Laboratory ORDER BY name COLLATE NOCASE",
        )
        .map_err(|e| format!("SQL error: {e}"))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(StoredLaboratory {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                location: row.get(3)?,
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
pub async fn laboratories_create(
    state: State<'_, AppState>,
    payload: LaboratoryUpsertPayload,
) -> Result<LaboratoryMutationResponse> {
    // WP-1.5: string length bounds
    validate_bounded_str(&payload.name, 255, "name")?;
    if let Some(ref d) = payload.description { validate_bounded_str(d, 2000, "description")?; }
    if let Some(ref l) = payload.location { validate_bounded_str(l, 500, "location")?; }

    let name = payload.name.trim().to_string();
    if name.is_empty() {
        return Ok(LaboratoryMutationResponse::err("Название лаборатории обязательно"));
    }

    let conn = state.pool_conn()?;

    // Duplicate check
    let exists: Option<String> = conn
        .query_row(
            "SELECT id FROM Laboratory WHERE name = ?1 COLLATE NOCASE LIMIT 1",
            params![name],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("SQL error: {e}"))?;
    if exists.is_some() {
        return Ok(LaboratoryMutationResponse::err(
            "Лаборатория с таким названием уже существует",
        ));
    }

    let id = Uuid::new_v4().to_string();
    let now = now_rfc3339();
    conn.execute(
        "INSERT INTO Laboratory (id, name, description, location, createdAt, updatedAt) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        params![id, name, payload.description, payload.location, now],
    )
    .map_err(|e| format!("SQL error: {e}"))?;

    match get_laboratory(&conn, &id)? {
        Some(lab) => Ok(LaboratoryMutationResponse::ok(lab)),
        None => Ok(LaboratoryMutationResponse::err("Insert succeeded but laboratory not found")),
    }
}

#[tauri::command]
pub async fn laboratories_update(
    state: State<'_, AppState>,
    id: String,
    payload: LaboratoryUpsertPayload,
) -> Result<LaboratoryMutationResponse> {
    // WP-1.5: validate ID format + string bounds
    validate_uuid(&id, "id")?;
    validate_bounded_str(&payload.name, 255, "name")?;
    if let Some(ref d) = payload.description { validate_bounded_str(d, 2000, "description")?; }
    if let Some(ref l) = payload.location { validate_bounded_str(l, 500, "location")?; }

    let name = payload.name.trim().to_string();
    if name.is_empty() {
        return Ok(LaboratoryMutationResponse::err("Название лаборатории обязательно"));
    }

    let conn = state.pool_conn()?;

    // Duplicate check (excluding self)
    let duplicate: Option<String> = conn
        .query_row(
            "SELECT id FROM Laboratory WHERE name = ?1 COLLATE NOCASE AND id != ?2 LIMIT 1",
            params![name, id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("SQL error: {e}"))?;
    if duplicate.is_some() {
        return Ok(LaboratoryMutationResponse::err(
            "Лаборатория с таким названием уже существует",
        ));
    }

    let now = now_rfc3339();
    let changed = conn
        .execute(
            "UPDATE Laboratory SET name = ?1, description = ?2, location = ?3, updatedAt = ?4 \
             WHERE id = ?5",
            params![name, payload.description, payload.location, now, id],
        )
        .map_err(|e| format!("SQL error: {e}"))?;

    if changed == 0 {
        return Ok(LaboratoryMutationResponse::err("Лаборатория не найдена"));
    }

    match get_laboratory(&conn, &id)? {
        Some(lab) => Ok(LaboratoryMutationResponse::ok(lab)),
        None => Ok(LaboratoryMutationResponse::err("Update succeeded but laboratory not found")),
    }
}

#[tauri::command]
pub async fn laboratories_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<LaboratoryDeleteResponse> {
    // WP-1.5: validate ID format
    validate_uuid(&id, "id")?;

    let conn = state.pool_conn()?;

    // Guard: don't delete if experiments reference this laboratory
    let in_use: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM Experiment WHERE laboratoryId = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| format!("SQL error: {e}"))?;

    if in_use > 0 {
        return Ok(LaboratoryDeleteResponse {
            success: false,
            error: Some(format!(
                "Нельзя удалить: лаборатория используется в {} тест(ах)",
                in_use
            )),
        });
    }

    conn.execute("DELETE FROM Laboratory WHERE id = ?1", params![id])
        .map_err(|e| format!("SQL error: {e}"))?;

    Ok(LaboratoryDeleteResponse { success: true, error: None })
}
