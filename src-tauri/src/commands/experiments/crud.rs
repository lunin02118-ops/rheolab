//! CRUD commands for experiments: get, save, delete.

use super::helpers::*;
use super::types::*;
use crate::commands::licensing::{
    can_write_via_engine, current_features, maybe_increment_demo_save, require_write_license,
};
use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::utils::validation::{validate_bounded_str, validate_hash_id};
use rusqlite::params;
use rusqlite::OptionalExtension;
use tauri::State;

#[tauri::command]
pub async fn experiments_get(
    state: State<'_, AppState>,
    id: String,
) -> Result<ExperimentGetResponse> {
    // WP-1.5: validate hash ID
    validate_hash_id(&id, "id")?;

    let conn = state.pool_conn()?;
    let exp = load_experiment_by_id(&conn, &id)?;
    match exp {
        Some(experiment) => Ok(ExperimentGetResponse::ok(experiment)),
        None => Ok(ExperimentGetResponse::err("Experiment not found")),
    }
}

#[tauri::command]
pub async fn experiments_detail_meta_by_id(
    state: State<'_, AppState>,
    id: String,
) -> Result<ExperimentDetailMetaResponse> {
    validate_hash_id(&id, "id")?;

    let conn = state.pool_conn()?;
    let exp = load_experiment_detail_meta_by_id(&conn, &id)?;
    match exp {
        Some(experiment) => Ok(ExperimentDetailMetaResponse::ok(experiment)),
        None => Ok(ExperimentDetailMetaResponse::err("Experiment not found")),
    }
}

const RAW_TABLE_PAGE_SIZE_MIN: usize = 1;
const RAW_TABLE_PAGE_SIZE_MAX: usize = 500;

#[tauri::command]
pub async fn experiments_raw_table_page_by_id(
    state: State<'_, AppState>,
    experiment_id: String,
    page: usize,
    page_size: usize,
) -> Result<RawTablePageResponse> {
    validate_hash_id(&experiment_id, "experimentId")?;
    if page == 0 {
        return Err(AppError::BadRequest("page must be >= 1".into()));
    }
    if !(RAW_TABLE_PAGE_SIZE_MIN..=RAW_TABLE_PAGE_SIZE_MAX).contains(&page_size) {
        return Err(AppError::BadRequest(format!(
            "pageSize must be between {RAW_TABLE_PAGE_SIZE_MIN} and {RAW_TABLE_PAGE_SIZE_MAX}"
        )));
    }

    let pool = state.db_pool.clone();
    let result = tokio::task::spawn_blocking(move || {
        let conn = pool.get()?;
        load_raw_table_page_by_id(&conn, &experiment_id, page, page_size)
    })
    .await??;

    match result {
        Some(page) => Ok(RawTablePageResponse::ok(page)),
        None => Ok(RawTablePageResponse::err("Experiment not found")),
    }
}

/// Hard cap on how many experiments can be loaded in a single batch request.
/// Prevents OOM from unconstrained payloads — callers that need more should
/// paginate via multiple IPC calls.
const BATCH_GET_MAX: usize = 50;

#[tauri::command]
pub async fn experiments_get_batch(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<ExperimentGetBatchResponse> {
    // WP-1.5: validate each hash ID
    for id in &ids {
        validate_hash_id(id, "ids[]")?;
    }

    if ids.len() > BATCH_GET_MAX {
        return Err(crate::error::AppError::BadRequest(format!(
            "Batch size {} exceeds maximum of {BATCH_GET_MAX}",
            ids.len()
        )));
    }

    let conn = state.pool_conn()?;
    match load_experiments_batch(&conn, &ids) {
        Ok(experiments) => Ok(ExperimentGetBatchResponse {
            success: true,
            experiments,
            error: None,
        }),
        Err(e) => Ok(ExperimentGetBatchResponse {
            success: false,
            experiments: vec![],
            error: Some(format!("{e}")),
        }),
    }
}

/// Lightweight existence check — returns only the subset of `ids` that exist
/// in the Experiment table.  Uses a single `SELECT id ... WHERE id IN (...)`
/// query with no data loading.
#[tauri::command]
pub async fn experiments_check_existence(
    state: State<'_, AppState>,
    ids: Vec<String>,
) -> Result<ExperimentExistenceResponse> {
    // WP-1.5: validate each hash ID
    for id in &ids {
        validate_hash_id(id, "ids[]")?;
    }

    let conn = state.pool_conn()?;
    if ids.is_empty() {
        return Ok(ExperimentExistenceResponse {
            existing_ids: vec![],
        });
    }
    let ph: String = std::iter::repeat_n("?", ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!("SELECT id FROM Experiment WHERE id IN ({ph})");
    let mut stmt = conn.prepare(&sql).map_err(|e| format!("SQL error: {e}"))?;
    let existing: Vec<String> = stmt
        .query_map(rusqlite::params_from_iter(ids.iter()), |row| row.get(0))
        .map_err(|e| format!("SQL error: {e}"))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("SQL row error: {e}"))?;
    Ok(ExperimentExistenceResponse {
        existing_ids: existing,
    })
}

#[tauri::command]
pub async fn experiments_save(
    state: State<'_, AppState>,
    mut payload: ExperimentSavePayload,
) -> Result<ExperimentSaveResponse> {
    // WP-1.5: string length bounds on key fields
    validate_bounded_str(&payload.name, 500, "name")?;
    validate_bounded_str(&payload.water_source, 255, "waterSource")?;
    validate_bounded_str(&payload.original_filename, 500, "originalFilename")?;
    validate_bounded_str(&payload.instrument_type, 255, "instrumentType")?;
    validate_bounded_str(&payload.fluid_type, 255, "fluidType")?;
    validate_bounded_str(&payload.test_group, 255, "testGroup")?;
    if let Some(ref v) = payload.field_name {
        validate_bounded_str(v, 255, "fieldName")?;
    }
    if let Some(ref v) = payload.operator_name {
        validate_bounded_str(v, 255, "operatorName")?;
    }
    if let Some(ref v) = payload.well_number {
        validate_bounded_str(v, 100, "wellNumber")?;
    }
    if let Some(ref v) = payload.geometry {
        validate_bounded_str(v, 255, "geometry")?;
    }

    // F-08: License gate — must call BEFORE acquiring Connection (!Send across .await)
    if !can_write_via_engine(&state).await {
        return Ok(ExperimentSaveResponse {
            success: false,
            experiment_id: None,
            message: None,
            error: Some("Active license required to save experiments.".to_string()),
            code: Some("License:required".to_string()),
        });
    }
    let features = current_features(&state).await;
    strip_payload_calibration_unless_allowed(&mut payload, features.calibration_parsing);

    if payload.water_source.trim().is_empty() {
        return Ok(ExperimentSaveResponse {
            success: false,
            experiment_id: None,
            message: None,
            error: Some("waterSource is required".to_string()),
            code: None,
        });
    }

    if payload.name.trim().is_empty() {
        return Ok(ExperimentSaveResponse {
            success: false,
            experiment_id: None,
            message: None,
            error: Some("name is required".to_string()),
            code: None,
        });
    }

    let conn = state.pool_conn()?;
    let tx = conn.unchecked_transaction()?;

    let should_overwrite = payload.overwrite.unwrap_or(false);

    // Check for name-only duplicate first (new stricter rule: names must be unique)
    let name_match: Option<(String, String)> = tx
        .query_row(
            "SELECT id, name FROM Experiment \
             WHERE name = ?1 COLLATE NOCASE \
             LIMIT 1",
            params![payload.name],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    if let Some((existing_id, existing_name)) = name_match {
        if !should_overwrite {
            return Ok(ExperimentSaveResponse::name_conflict(
                existing_id,
                existing_name,
            ));
        }
        // overwrite=true: look up the existing record's createdAt and reuse its id
        let existing_created_at: String = tx
            .query_row(
                "SELECT createdAt FROM Experiment WHERE id = ?1",
                params![existing_id],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or_else(now_rfc3339);

        let updated = payload_to_stored(
            payload,
            existing_id.clone(),
            existing_created_at,
            None,
            None,
        );
        persist_experiment(&tx, &updated)?;

        if let Ok(payload_json) = serde_json::to_string(&updated) {
            let ref_json = super::super::data_flows::compact_ref(&existing_id, &payload_json);
            super::super::data_flows::create_experiment_payload(
                &tx,
                super::super::data_flows::ExperimentPayloadInsert {
                    experiment_id: &existing_id,
                    import_batch_id: None,
                    payload_json: &ref_json,
                    source_lab_id: None,
                    source_system: None,
                    source_app_version: None,
                    is_canonical: true,
                },
            )?;
            super::super::data_flows::create_parser_artifact(
                &tx,
                &existing_id,
                None,
                env!("CARGO_PKG_VERSION"),
                "v1",
                &ref_json,
            )?;
            super::super::data_flows::append_sync_outbox(
                &tx,
                "experiment",
                &existing_id,
                "update",
                &ref_json,
            )?;
            super::super::data_flows::log_search_projection(
                &tx,
                Some(&existing_id),
                "update",
                "v1",
                None,
            )?;
        }

        tx.commit()?;
        super::list::invalidate_filter_metadata_cache();
        super::super::series::release_series_decode_cache_for_experiment(&existing_id);
        return Ok(ExperimentSaveResponse::updated(existing_id));
    }

    // Legacy dedup check (same filename + date + name — retained as secondary guard)
    let duplicate: Option<(String, String)> = tx
        .query_row(
            "SELECT id, createdAt FROM Experiment \
             WHERE originalFilename = ?1 AND testDate = ?2 AND name = ?3 COLLATE NOCASE \
             LIMIT 1",
            params![payload.original_filename, payload.test_date, payload.name],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    if let Some((existing_id, existing_created_at)) = duplicate {
        if !should_overwrite {
            return Ok(ExperimentSaveResponse::duplicate());
        }

        let updated = payload_to_stored(
            payload,
            existing_id.clone(),
            existing_created_at,
            None,
            None,
        );
        persist_experiment(&tx, &updated)?;

        // V2 data flows: payload versioning + sync outbox + search projection
        // compact_ref avoids 3× data duplication — Experiment table is the canonical store.
        if let Ok(payload_json) = serde_json::to_string(&updated) {
            let ref_json = super::super::data_flows::compact_ref(&existing_id, &payload_json);
            super::super::data_flows::create_experiment_payload(
                &tx,
                super::super::data_flows::ExperimentPayloadInsert {
                    experiment_id: &existing_id,
                    import_batch_id: None,
                    payload_json: &ref_json,
                    source_lab_id: None,
                    source_system: None,
                    source_app_version: None,
                    is_canonical: true,
                },
            )?;

            super::super::data_flows::create_parser_artifact(
                &tx,
                &existing_id,
                None,
                env!("CARGO_PKG_VERSION"),
                "v1",
                &ref_json,
            )?;

            // SyncOutbox failure is critical — roll back so no ghost entry is created
            super::super::data_flows::append_sync_outbox(
                &tx,
                "experiment",
                &existing_id,
                "update",
                &ref_json,
            )?;

            super::super::data_flows::log_search_projection(
                &tx,
                Some(&existing_id),
                "update",
                "v1",
                None,
            )?;
        }

        tx.commit()?;
        super::list::invalidate_filter_metadata_cache();
        super::super::series::release_series_decode_cache_for_experiment(&existing_id);
        return Ok(ExperimentSaveResponse::updated(existing_id));
    }

    let experiment_id = generate_experiment_id(&payload);
    let stored = payload_to_stored(payload, experiment_id.clone(), now_rfc3339(), None, None);
    persist_experiment(&tx, &stored)?;

    // V2 data flows: payload + parser artifact + sync outbox + search projection
    // compact_ref avoids 3× data duplication — Experiment table is the canonical store.
    if let Ok(payload_json) = serde_json::to_string(&stored) {
        let ref_json = super::super::data_flows::compact_ref(&experiment_id, &payload_json);
        super::super::data_flows::create_experiment_payload(
            &tx,
            super::super::data_flows::ExperimentPayloadInsert {
                experiment_id: &experiment_id,
                import_batch_id: None,
                payload_json: &ref_json,
                source_lab_id: None,
                source_system: None,
                source_app_version: None,
                is_canonical: true,
            },
        )?;

        super::super::data_flows::create_parser_artifact(
            &tx,
            &experiment_id,
            None,
            env!("CARGO_PKG_VERSION"),
            "v1",
            &ref_json,
        )?;

        // SyncOutbox failure is critical — roll back so no ghost entry is created
        super::super::data_flows::append_sync_outbox(
            &tx,
            "experiment",
            &experiment_id,
            "create",
            &ref_json,
        )?;

        super::super::data_flows::log_search_projection(
            &tx,
            Some(&experiment_id),
            "create",
            "v1",
            None,
        )?;
    }

    // F-04: Atomically increment demo counter (no-op when licensed).
    // Runs inside the same transaction so counter and experiment are consistent.
    maybe_increment_demo_save(&tx);

    tx.commit()?;
    super::list::invalidate_filter_metadata_cache();
    Ok(ExperimentSaveResponse::created(experiment_id))
}

#[tauri::command]
pub async fn experiments_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<ExperimentDeleteResponse> {
    require_write_license(&state).await?;

    // WP-1.5: validate hash ID
    validate_hash_id(&id, "id")?;

    let conn = state.pool_conn()?;
    let tx = conn.unchecked_transaction()?;

    // V2 data flows: record deletion in sync outbox before actual delete
    // SyncOutbox failure is critical — roll back so the delete is not orphaned
    super::super::data_flows::append_sync_outbox(
        &tx,
        "experiment",
        &id,
        "delete",
        &format!(r#"{{"id":"{}"}}"#, id),
    )?;

    super::super::data_flows::log_search_projection(&tx, Some(&id), "delete", "v1", None)?;

    let deleted = tx.execute("DELETE FROM Experiment WHERE id = ?1", params![&id])?;

    if deleted == 0 {
        return Ok(ExperimentDeleteResponse {
            success: false,
            error: Some("Experiment not found".to_string()),
        });
    }

    if let Err(error) = crate::db::repositories::experiment_projection::mark_facet_cache_dirty(&tx)
    {
        tracing::warn!("experiment projection facet dirty mark failed: {}", error);
    }

    tx.commit()?;
    super::list::invalidate_filter_metadata_cache();
    super::super::series::release_series_decode_cache_for_experiment(&id);
    Ok(ExperimentDeleteResponse {
        success: true,
        error: None,
    })
}

fn strip_payload_calibration_unless_allowed(
    payload: &mut ExperimentSavePayload,
    allow_calibration: bool,
) {
    if !allow_calibration {
        payload.calibration = None;
    }
}

fn payload_to_stored(
    payload: ExperimentSavePayload,
    id: String,
    created_at: String,
    user: Option<StoredExperimentUser>,
    laboratory: Option<StoredExperimentLaboratory>,
) -> StoredExperiment {
    let max_viscosity = extract_max_viscosity(&payload.metrics);
    let avg_viscosity = extract_avg_viscosity_from_raw(&payload.raw_points);
    let dominant_pattern = compute_dominant_pattern(&payload.raw_points);
    let normalized_reagents = payload
        .reagents
        .into_iter()
        .map(normalize_reagent)
        .collect::<Vec<_>>();

    StoredExperiment {
        id,
        created_at,
        updated_at: now_rfc3339(),
        name: payload.name,
        field_name: payload.field_name,
        operator_name: payload.operator_name,
        well_number: payload.well_number,
        test_id: payload.test_id,
        original_filename: payload.original_filename,
        test_date: payload.test_date,
        instrument_type: payload.instrument_type,
        geometry: payload.geometry,
        geometry_source: payload.geometry_source,
        water_source: payload.water_source,
        water_params: payload.water_params,
        fluid_type: payload.fluid_type,
        test_group: payload.test_group,
        test_sub_group: payload.test_sub_group,
        test_category: payload.test_category,
        test_type: payload.test_type,
        dominant_pattern,
        metrics: payload.metrics,
        raw_points: payload.raw_points,
        calibration: payload.calibration,
        reagents: normalized_reagents,
        max_viscosity,
        avg_viscosity,
        user,
        laboratory,
        parsed_by: payload.parsed_by,
        parse_source: payload.parse_source,
        time_range_min: payload.time_range_min,
        time_range_max: payload.time_range_max,
        viscosity_min: payload.viscosity_min,
        pressure_max: payload.pressure_max,
        extra_fields: payload.extra_fields,
        rheology_source: payload.rheology_source,
        rheology_parameters: payload.rheology_parameters,
    }
}

fn normalize_reagent(mut reagent: StoredExperimentReagent) -> StoredExperimentReagent {
    if reagent.reagent.is_none() {
        if let Some(name) = reagent.reagent_name.clone() {
            reagent.reagent = Some(StoredReagentDescriptor {
                name,
                category: reagent.category.clone(),
            });
        }
    }
    reagent
}

// ── Repository re-exports ─────────────────────────────────────────────────────
// SQL for these operations lives in db::repositories::experiments.
// Re-exported here so existing callers (sync_engine, experiments::sync) do not
// need to change their import paths.
pub(crate) use crate::db::repositories::experiments::{
    load_experiment_by_id, load_experiment_detail_meta_by_id, load_experiments_batch,
    load_raw_table_page_by_id, persist_experiment,
};

// ─────────────────────────────────────────────────────────────────────────────
// Unit / integration tests — run with `cargo test -- --test-threads=1`
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "crud_tests.rs"]
mod tests;
