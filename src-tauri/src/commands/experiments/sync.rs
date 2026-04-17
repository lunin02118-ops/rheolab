//! Import / sync command for experiments.

use crate::error::{AppError, Result};
use crate::commands::licensing::can_write_via_engine;
use crate::state::AppState;
use rusqlite::params;
use serde_json::{json, Value};
use tauri::State;
use super::types::*;
use super::helpers::*;
use super::crud::persist_experiment;

#[tauri::command]
pub async fn experiments_import(
    state: State<'_, AppState>,
    experiments: Vec<Value>,
) -> Result<Value> {
    let total_processed = experiments.len();

    // F-08: License gate — must call BEFORE acquiring Connection (!Send across .await)
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }

    let conn = state.pool_conn()?;

    let tx = conn.unchecked_transaction()?;

    // V2 data flow: create ImportBatch
    let batch_id = super::super::data_flows::create_import_batch(
        &tx, None, Some("RheoLab"), None, Some(LOCAL_USER_ID), None, None,
    )
    .ok();

    let mut imported = 0usize;
    let mut skipped = 0usize;
    let updated = 0usize;
    let mut errors: Vec<String> = vec![];

    for exp in experiments {
        let name = string_from_path(&exp, &["name"]).unwrap_or_default();
        let original_filename = string_from_path(&exp, &["originalFilename"]).unwrap_or_default();
        let test_date = string_from_path(&exp, &["testDate"]).unwrap_or_default();

        if name.trim().is_empty()
            || original_filename.trim().is_empty()
            || test_date.trim().is_empty()
        {
            errors.push(
                "Invalid experiment payload: missing name/originalFilename/testDate".to_string(),
            );
            continue;
        }

        // Check for duplicates: match on (originalFilename, testDate, LOWER(name))
        // to tolerate minor name differences while avoiding cross-experiment collisions.
        let duplicate_exists: bool = tx
            .query_row(
                "SELECT COUNT(*) FROM Experiment \
                 WHERE originalFilename = ?1 AND testDate = ?2 AND name = ?3 COLLATE NOCASE",
                params![original_filename, test_date, name],
                |row| row.get::<_, i32>(0),
            )
            .map(|c| c > 0)
            .unwrap_or(false);

        if duplicate_exists {
            skipped += 1;
            continue;
        }

        let metrics = parse_json_field(exp.get("metrics"), json!({}));
        let raw_points = parse_json_array_field(exp.get("rawPoints"));
        let water_params = exp.get("waterParams").map(parse_json_value);
        let calibration = exp.get("calibration").and_then(|value| {
            if value.is_null() {
                None
            } else {
                Some(parse_json_value(value))
            }
        });

        let reagents = parse_import_reagents(exp.get("reagents"));
        let max_viscosity = exp
            .get("maxViscosity")
            .and_then(number_from_json)
            .map(|v| v.round() as i64)
            .or_else(|| extract_max_viscosity(&metrics));
        let avg_viscosity = extract_avg_viscosity_from_raw(&raw_points);

        let source_lab_id = string_from_path(&exp, &["_exportMeta", "sourceLab"]);
        let source_lab_name = string_from_path(&exp, &["_exportMeta", "sourceLabName"]);
        let laboratory = match (source_lab_id, source_lab_name) {
            (Some(id), Some(name)) if !id.trim().is_empty() && !name.trim().is_empty() => {
                Some(StoredExperimentLaboratory { id, name })
            }
            (_, Some(name)) if !name.trim().is_empty() => Some(StoredExperimentLaboratory {
                id: format!("imported_lab_{}", short_hash(&name)),
                name,
            }),
            _ => None,
        };

        let imported_exp = StoredExperiment {
            id: generate_experiment_id_from_parts(&name, &original_filename, &test_date),
            created_at: string_from_path(&exp, &["createdAt"]).unwrap_or_else(now_rfc3339),
            updated_at: string_from_path(&exp, &["updatedAt"]).unwrap_or_else(now_rfc3339),
            name,
            field_name: string_from_path(&exp, &["fieldName"]),
            operator_name: string_from_path(&exp, &["operatorName"]),
            well_number: string_from_path(&exp, &["wellNumber"]),
            test_id: string_from_path(&exp, &["testId"]),
            original_filename,
            test_date,
            instrument_type: string_from_path(&exp, &["instrumentType"])
                .unwrap_or_else(|| "Unknown Instrument".to_string()),
            geometry: string_from_path(&exp, &["geometry"]),
            geometry_source: string_from_path(&exp, &["geometrySource"]),
            water_source: string_from_path(&exp, &["waterSource"])
                .unwrap_or_else(|| "Unknown".to_string()),
            water_params,
            fluid_type: string_from_path(&exp, &["fluidType"])
                .unwrap_or_else(|| "Linear".to_string()),
            test_group: string_from_path(&exp, &["testGroup"])
                .unwrap_or_else(|| "Rheology".to_string()),
            test_sub_group: string_from_path(&exp, &["testSubGroup"]),
            metrics,
            raw_points,
            calibration,
            reagents,
            max_viscosity,
            avg_viscosity,
            user: None,
            laboratory,
            parsed_by: None,
            parse_source: None,
            time_range_min: None,
            time_range_max: None,
            viscosity_min: None,
            pressure_max: None,
            extra_fields: None,
            test_category: string_from_path(&exp, &["testCategory"]),
            test_type: string_from_path(&exp, &["testType"]),
            dominant_pattern: None,
        };

        persist_experiment(&tx, &imported_exp)?;
        imported += 1;

        // V2 data flows: ExperimentPayload + SyncOutbox + SearchProjection
        // compact_ref avoids 3× data duplication — Experiment table is the canonical store.
        if let Ok(pj) = serde_json::to_string(&imported_exp) {
            let ref_json = super::super::data_flows::compact_ref(&imported_exp.id, &pj);
            if let Err(e) = super::super::data_flows::create_experiment_payload(
                &tx,
                &imported_exp.id,
                batch_id.as_deref(),
                &ref_json,
                imported_exp.laboratory.as_ref().map(|l| l.id.as_str()),
                Some("RheoLab"),
                None,
                true,
            ) {
                tracing::warn!("[data_flows] create_experiment_payload error: {}", e);
            }
            if let Err(e) = super::super::data_flows::append_sync_outbox(
                &tx, "experiment", &imported_exp.id, "create", &ref_json,
            ) {
                tracing::warn!("[data_flows] append_sync_outbox error: {}", e);
            }
            if let Err(e) = super::super::data_flows::log_search_projection(
                &tx, Some(&imported_exp.id), "import", "v1", None,
            ) {
                tracing::warn!("[data_flows] log_search_projection error: {}", e);
            }
        }
    }

    // V2 data flow: finalise ImportBatch
    if let Some(ref bid) = batch_id {
        if let Err(e) = super::super::data_flows::finalise_import_batch(
            &tx, bid, imported, skipped, "completed",
        ) {
            tracing::warn!("[data_flows] finalise_import_batch error: {}", e);
        }
    }

    tx.commit()?;
    super::list::invalidate_filter_metadata_cache();
    Ok(json!({
        "success": true,
        "imported": imported,
        "updated": updated,
        "skipped": skipped,
        "errors": errors.into_iter().take(10).collect::<Vec<_>>(),
        "totalProcessed": total_processed
    }))
}
