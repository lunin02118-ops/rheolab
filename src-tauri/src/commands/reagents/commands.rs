use crate::db::repositories::reagents as repo;
use crate::error::Result;
use crate::state::AppState;
use rusqlite::params;
use rusqlite::OptionalExtension;
use serde_json::{json, Value};
use tauri::State;

use super::helpers::*;
use super::seed_data::seed_default_reagents;
use super::types::*;

// ── Commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn reagents_list(state: State<'_, AppState>) -> Result<Vec<StoredReagent>> {
    let conn = state.pool_conn()?;
    repo::list_all(&conn)
}

#[tauri::command]
pub async fn reagents_create(
    state: State<'_, AppState>,
    payload: ReagentUpsertPayload,
) -> Result<ReagentMutationResponse> {
    let name = payload.name.trim().to_string();
    let category = payload.category.trim().to_string();

    if name.is_empty() {
        return Ok(ReagentMutationResponse::err(
            "Название реагента обязательно",
        ));
    }
    if category.is_empty() {
        return Ok(ReagentMutationResponse::err("Категория обязательна"));
    }

    let conn = state.pool_conn()?;

    // Wrap duplicate check + INSERT + sync outbox in a transaction for atomicity.
    let tx = conn.unchecked_transaction()?;

    // Check duplicate name (case-insensitive)
    if repo::is_duplicate_name(&tx, &name, None)? {
        return Ok(ReagentMutationResponse::err(
            "Реагент с таким названием уже существует",
        ));
    }

    let now = now_rfc3339();
    let id = generate_reagent_id(&name);
    let manufacturer = normalize_optional(payload.manufacturer);
    let country = normalize_optional(payload.country);
    let description = normalize_optional(payload.description);
    let active_substance = normalize_optional(payload.active_substance);
    let form = normalize_optional(payload.form);

    tx.execute(
        "INSERT INTO ReagentCatalog \
         (id, name, category, manufacturer, country, description, activeSubstance, form, createdAt, updatedAt) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![id, name, category, manufacturer, country, description, active_substance, form, now],
    )?;

    let reagent = get_reagent(&tx, &id)?;
    match reagent {
        Some(r) => {
            // V2 data flow: sync outbox for new reagent
            if let Ok(pj) = serde_json::to_string(&r) {
                crate::commands::data_flows::append_sync_outbox(
                    &tx, "reagent", &id, "create", &pj,
                )?;
            }
            tx.commit()?;
            Ok(ReagentMutationResponse::ok(r))
        }
        None => Ok(ReagentMutationResponse::err("Insert succeeded but reagent not found")),
    }
}

#[tauri::command]
pub async fn reagents_update(
    state: State<'_, AppState>,
    id: String,
    payload: ReagentUpsertPayload,
) -> Result<ReagentMutationResponse> {
    let name = payload.name.trim().to_string();
    let category = payload.category.trim().to_string();

    if name.is_empty() {
        return Ok(ReagentMutationResponse::err(
            "Название реагента обязательно",
        ));
    }
    if category.is_empty() {
        return Ok(ReagentMutationResponse::err("Категория обязательна"));
    }

    let conn = state.pool_conn()?;

    // Wrap existence check + duplicate check + UPDATE + sync outbox in a transaction.
    let tx = conn.unchecked_transaction()?;

    // Check that the reagent exists
    if !repo::exists_by_id(&tx, &id)? {
        return Ok(ReagentMutationResponse::err("Реагент не найден"));
    }

    // Check duplicate name (case-insensitive, excluding self)
    if repo::is_duplicate_name(&tx, &name, Some(&id))? {
        return Ok(ReagentMutationResponse::err(
            "Реагент с таким названием уже существует",
        ));
    }

    let now = now_rfc3339();
    let manufacturer = normalize_optional(payload.manufacturer);
    let country = normalize_optional(payload.country);
    let description = normalize_optional(payload.description);
    let active_substance = normalize_optional(payload.active_substance);
    let form = normalize_optional(payload.form);

    tx.execute(
        "UPDATE ReagentCatalog SET \
            name = ?1, category = ?2, manufacturer = ?3, country = ?4, \
            description = ?5, activeSubstance = ?6, form = ?7, updatedAt = ?8 \
         WHERE id = ?9",
        params![name, category, manufacturer, country, description, active_substance, form, now, id],
    )?;

    let reagent = get_reagent(&tx, &id)?;
    match reagent {
        Some(r) => {
            // V2 data flow: sync outbox for reagent update
            if let Ok(pj) = serde_json::to_string(&r) {
                crate::commands::data_flows::append_sync_outbox(
                    &tx, "reagent", &id, "update", &pj,
                )?;
            }
            tx.commit()?;
            Ok(ReagentMutationResponse::ok(r))
        }
        None => Ok(ReagentMutationResponse::err("Reagent disappeared after update")),
    }
}

#[tauri::command]
pub async fn reagents_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<ReagentDeleteResponse> {
    let conn = state.pool_conn()?;

    // Wrap existence check + usage check + DELETE + sync outbox in a transaction.
    let tx = conn.unchecked_transaction()?;

    // Check existence and get name for usage check
    let reagent_info: Option<(String, String)> = tx
        .query_row(
            "SELECT id, name FROM ReagentCatalog WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let Some((reagent_id, _reagent_name)) = reagent_info else {
        return Ok(ReagentDeleteResponse::err("Реагент не найден"));
    };

    // Check if reagent is used in any experiments
    let usage_count: i32 = tx
        .query_row(
            "SELECT COUNT(DISTINCT experimentId) FROM ExperimentReagent WHERE reagentId = ?1",
            params![reagent_id],
            |row| row.get(0),
        )
        .unwrap_or(0);

    if usage_count > 0 {
        return Ok(ReagentDeleteResponse::err(format!(
            "Невозможно удалить: реагент используется в {} эксперимент(ах)",
            usage_count
        )));
    }

    // DELETE first, then sync outbox — both within the same transaction.
    tx.execute("DELETE FROM ReagentCatalog WHERE id = ?1", params![id])?;

    // V2 data flow: sync outbox for reagent deletion (after successful DELETE)
    crate::commands::data_flows::append_sync_outbox(
        &tx, "reagent", &id, "delete", &format!(r#"{{"id":"{}"}}"#, id),
    )?;

    tx.commit()?;
    Ok(ReagentDeleteResponse::ok())
}

#[tauri::command]
pub async fn reagents_export(state: State<'_, AppState>) -> Result<Value> {
    let conn = state.pool_conn()?;
    let exported_at = now_rfc3339();

    let mut stmt = conn
        .prepare(
            "SELECT id, name, category, manufacturer, country, description, \
                    activeSubstance, form, createdAt, updatedAt, extraFields \
             FROM ReagentCatalog ORDER BY LOWER(category), LOWER(name)",
        )?;

    let reagents: Vec<Value> = stmt
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "category": row.get::<_, String>(2)?,
                "manufacturer": row.get::<_, Option<String>>(3)?,
                "country": row.get::<_, Option<String>>(4)?,
                "description": row.get::<_, Option<String>>(5)?,
                "activeSubstance": row.get::<_, Option<String>>(6)?,
                "form": row.get::<_, Option<String>>(7)?,
                "createdAt": row.get::<_, String>(8)?,
                "updatedAt": row.get::<_, String>(9)?,
                "extraFields": row.get::<_, Option<String>>(10)?
            }))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(json!({
        "success": true,
        "version": 1,
        "total": reagents.len(),
        "reagents": reagents,
        "exportedAt": exported_at
    }))
}

#[tauri::command]
pub async fn reagents_import(
    state: State<'_, AppState>,
    reagents: Vec<Value>,
) -> Result<Value> {
    let total_processed = reagents.len();
    let conn = state.pool_conn()?;

    // Wrap the entire import in a transaction — all-or-nothing on hard errors.
    let tx = conn.unchecked_transaction()?;

    let mut imported = 0usize;
    let mut updated = 0usize;
    let mut skipped = 0usize;
    let mut errors: Vec<String> = vec![];

    for raw in reagents {
        let name = string_field(&raw, "name")
            .unwrap_or_default()
            .trim()
            .to_string();
        let category = string_field(&raw, "category")
            .unwrap_or_default()
            .trim()
            .to_string();

        if name.is_empty() || category.is_empty() {
            errors.push(format!("Skipped invalid reagent: {}", raw));
            skipped += 1;
            continue;
        }

        // If the import data includes an id, try to match by id first, then by name.
        let import_id = string_field(&raw, "id");

        // Phase 6.6 — single canonical resolver (id first, name fallback).
        let existing = repo::resolve_by_id_or_name(&tx, import_id.as_deref(), &name)?;

        if let Some(ex) = existing {
            let existing_id = ex.id;
            let ex_mfg = ex.manufacturer;
            let ex_country = ex.country;
            let ex_desc = ex.description;
            let ex_as = ex.active_substance;
            let ex_form = ex.form;
            let ex_extra = ex.extra_fields;
            let now = now_rfc3339();
            let manufacturer = normalize_optional(string_field(&raw, "manufacturer").or(ex_mfg));
            let country = normalize_optional(string_field(&raw, "country").or(ex_country));
            let description = normalize_optional(string_field(&raw, "description").or(ex_desc));
            let active_substance = normalize_optional(
                string_field(&raw, "activeSubstance")
                    .or(string_field(&raw, "active_substance"))
                    .or(ex_as),
            );
            let form = normalize_optional(string_field(&raw, "form").or(ex_form));
            let extra_fields = normalize_optional(
                string_field(&raw, "extraFields")
                    .or(string_field(&raw, "extra_fields"))
                    .or(ex_extra),
            );

            tx.execute(
                "UPDATE ReagentCatalog SET \
                    category = ?1, manufacturer = ?2, country = ?3, \
                    description = ?4, activeSubstance = ?5, form = ?6, \
                    extraFields = ?7, updatedAt = ?8 \
                 WHERE id = ?9",
                params![category, manufacturer, country, description, active_substance, form, extra_fields, now, existing_id],
            )?;
            updated += 1;
        } else {
            let now = now_rfc3339();
            // Use imported id if available, otherwise generate a new one.
            let id = import_id.unwrap_or_else(|| generate_reagent_id(&name));
            let manufacturer = normalize_optional(string_field(&raw, "manufacturer"));
            let country = normalize_optional(string_field(&raw, "country"));
            let description = normalize_optional(string_field(&raw, "description"));
            let active_substance = normalize_optional(
                string_field(&raw, "activeSubstance")
                    .or(string_field(&raw, "active_substance")),
            );
            let form = normalize_optional(string_field(&raw, "form"));
            let extra_fields = normalize_optional(
                string_field(&raw, "extraFields")
                    .or(string_field(&raw, "extra_fields")),
            );

            tx.execute(
                "INSERT INTO ReagentCatalog \
                 (id, name, category, manufacturer, country, description, activeSubstance, form, extraFields, createdAt, updatedAt) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
                params![id, name, category, manufacturer, country, description, active_substance, form, extra_fields, now],
            )?;
            imported += 1;
        }
    }

    tx.commit()?;

    Ok(json!({
        "success": true,
        "imported": imported,
        "updated": updated,
        "skipped": skipped,
        "errors": errors.into_iter().take(10).collect::<Vec<_>>(),
        "totalProcessed": total_processed
    }))
}

#[tauri::command]
pub async fn reagents_seed(state: State<'_, AppState>) -> Result<Value> {
    let conn = state.pool_conn()?;
    let inserted = seed_default_reagents(&conn)?;
    Ok(json!({ "success": true, "inserted": inserted }))
}
