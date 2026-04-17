//! Export commands for experiments.

use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::commands::licensing::can_write_via_engine;
use serde_json::{json, Value};
use std::io::Write;
use tauri::State;
use super::types::*;
use super::helpers::*;

mod export_helpers;

#[tauri::command]
pub async fn experiments_export_laboratories(state: State<'_, AppState>) -> Result<Value> {
    let conn = state.pool_conn()?;

    // Count experiments with no laboratory
    let no_lab_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM Experiment WHERE laboratoryId IS NULL",
            [],
            |row| row.get(0),
        )?;

    // Count experiments grouped by laboratory
    let mut stmt = conn
        .prepare(
            "SELECT l.id, l.name, COUNT(*) as cnt \
             FROM Experiment e \
             INNER JOIN Laboratory l ON e.laboratoryId = l.id \
             GROUP BY l.id, l.name \
             ORDER BY l.name COLLATE NOCASE",
        )?;

    let mut laboratories: Vec<Value> = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let name: String = row.get(1)?;
            let count: i64 = row.get(2)?;
            Ok(json!({
                "id": id,
                "name": name,
                "experimentCount": count
            }))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    if no_lab_count > 0 {
        laboratories.insert(
            0,
            json!({
                "id": NO_LAB_ID,
                "name": "Р‘РµР· Р»Р°Р±РѕСЂР°С‚РѕСЂРёРё",
                "experimentCount": no_lab_count
            }),
        );
    }

    Ok(json!({
        "success": true,
        "laboratories": laboratories
    }))
}

#[tauri::command]
#[deprecated(note = "Use experiments_export_to_file for OOM-safe streaming export")]
pub async fn experiments_export(
    state: State<'_, AppState>,
    laboratory_ids: Option<Vec<String>>,
) -> Result<Value> {
    tracing::warn!("experiments_export called — this non-streaming export is deprecated, use experiments_export_to_file instead");
    let selected_lab_ids = laboratory_ids.unwrap_or_default();
    let all_experiments = export_helpers::load_all_experiments(&state, &selected_lab_ids)?;
    let export_time = now_rfc3339();

    let experiments = all_experiments
        .into_iter()
        .map(|exp| {
            let reagents = exp
                .reagents
                .iter()
                .map(|r| {
                    let reagent_name = r
                        .reagent_name
                        .clone()
                        .or_else(|| r.reagent.as_ref().map(|descriptor| descriptor.name.clone()))
                        .unwrap_or_else(|| "Unknown".to_string());
                    let reagent_category = r.category.clone().or_else(|| {
                        r.reagent
                            .as_ref()
                            .and_then(|descriptor| descriptor.category.clone())
                    });

                    json!({
                        "reagentName": reagent_name,
                        "reagentCategory": reagent_category,
                        "concentration": r.concentration,
                        "unit": r.unit,
                        "batchNumber": r.batch_number,
                        "productionDate": r.production_date
                    })
                })
                .collect::<Vec<_>>();

            let duration_seconds = calculate_duration_seconds(&exp.raw_points);
            let avg_temperature_c = calculate_avg_temperature_c(&exp.raw_points);
            let max_temperature_c = calculate_max_temperature_c(&exp.raw_points);

            json!({
                "_exportMeta": {
                    "originalId": exp.id,
                    "exportedAt": export_time,
                    "sourceLabName": exp.laboratory.as_ref().map(|l| l.name.clone()),
                    "sourceLab": exp.laboratory.as_ref().map(|l| l.id.clone())
                },
                "originalFilename": exp.original_filename,
                "testDate": exp.test_date,
                "instrumentType": exp.instrument_type,
                "geometry": exp.geometry,
                "geometrySource": exp.geometry_source,
                "durationSeconds": duration_seconds,
                "avgTemperatureC": avg_temperature_c,
                "maxTemperatureC": max_temperature_c,
                "maxViscosity": exp.max_viscosity,
                "name": exp.name,
                "fieldName": exp.field_name,
                "operatorName": exp.operator_name,
                "wellNumber": exp.well_number,
                "testId": exp.test_id,
                "waterSource": exp.water_source,
                "waterParams": exp.water_params,
                "fluidType": exp.fluid_type,
                "testGroup": exp.test_group,
                "testSubGroup": exp.test_sub_group,
                "metrics": exp.metrics,
                "rawPoints": exp.raw_points,
                "reagents": reagents,
                "calibration": exp.calibration,
                "createdAt": exp.created_at,
                "updatedAt": exp.updated_at
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "success": true,
        "total": experiments.len(),
        "experiments": experiments,
        "exportedAt": export_time
    }))
}

/// Stream-write ALL matching experiments to a temp file and return the path.
///
/// Unlike `experiments_export` (which materialises the full Vec<Value> in memory),
/// this command processes experiments in batches of 50, keeping peak memory bounded
/// to ~50 experiments Г— 3.5 MB в‰€ 175 MB regardless of total count.
/// The caller (TypeScript) reads the file via Tauri FS and triggers a browser download.
#[tauri::command]
pub async fn experiments_export_to_file(
    state: State<'_, AppState>,
    laboratory_ids: Option<Vec<String>>,
) -> Result<Value> {
    let selected_lab_ids = laboratory_ids.unwrap_or_default();

    // F-08: License gate — must call BEFORE acquiring Connection (!Send across .await)
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }

    // Ensure exports directory exists
    let exports_dir = state.app_data_dir.join("exports");
    std::fs::create_dir_all(&exports_dir)?;

    let export_time = now_rfc3339();
    // File-safe timestamp: replace chars not valid in filenames
    let ts_safe = export_time.chars().map(|c| if c == ':' || c == '.' { '-' } else { c }).collect::<String>();
    let file_name = format!("export-{}.json", ts_safe);
    let file_path = exports_dir.join(&file_name);
    let file_path_str = file_path.to_string_lossy().to_string();

    // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
    // Phase 1: collect experiment IDs (lightweight, no rawPoints)
    // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
    let all_ids: Vec<String> = {
        let conn = state.pool_conn()?;
        let include_no_lab = selected_lab_ids.iter().any(|id| id.as_str() == "__no_lab__");
        let real_ids: Vec<&String> = selected_lab_ids
            .iter().filter(|id| id.as_str() != "__no_lab__").collect();

        let (where_clause, params_raw): (String, Vec<String>) = if selected_lab_ids.is_empty() {
            (String::new(), vec![])
        } else if include_no_lab && real_ids.is_empty() {
            ("WHERE laboratoryId IS NULL".to_string(), vec![])
        } else if include_no_lab {
            let phs = real_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let ps = real_ids.iter().map(|s| (*s).clone()).collect();
            (format!("WHERE (laboratoryId IS NULL OR laboratoryId IN ({}))", phs), ps)
        } else {
            let phs = real_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let ps = real_ids.iter().map(|s| (*s).clone()).collect();
            (format!("WHERE laboratoryId IN ({})", phs), ps)
        };

        let sql = format!("SELECT id FROM Experiment {} ORDER BY testDate DESC", where_clause);
        let params_ref: Vec<&dyn rusqlite::ToSql> = params_raw
            .iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let mut stmt = conn.prepare(&sql)?;
        let ids: Vec<String> = stmt
            .query_map(params_ref.as_slice(), |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(stmt); // release borrow before conn drops
        ids
    };

    let total = all_ids.len();

    // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
    // Phase 2: stream JSON to file in batches of 50
    // в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
    {
        let file = std::fs::File::create(&file_path)?;
        let mut writer = std::io::BufWriter::new(file);

        // JSON envelope header
        writer.write_all(b"{\"success\":true,\"exportedAt\":\"")?;
        writer.write_all(export_time.as_bytes())?;
        writer.write_all(format!("\",\"total\":{},\"experiments\":[", total).as_bytes())?;

        let mut first_item = true;
        const BATCH: usize = 50;

        for chunk in all_ids.chunks(BATCH) {
            let chunk_vec: Vec<String> = chunk.to_vec();
            let conn = state.pool_conn()?;

            // Load metadata batch (no rawPoints column)
            let experiments = export_helpers::load_experiment_batch_no_raw(&conn, &chunk_vec)?;
            let blobs_map = load_experiment_data_blobs(&conn, &chunk_vec)?;
            let reagents_map = load_reagents_batch(&conn, &chunk_vec)?;

            for mut exp in experiments {
                // Decode raw_points from blob; fall back to empty if blob absent
                let raw_points: Vec<Value> = blobs_map
                    .get(&exp.id)
                    .and_then(|blob| crate::db::columnar::decode(blob).ok())
                    .unwrap_or_default();

                exp.reagents = reagents_map.get(&exp.id).cloned().unwrap_or_default();

                let reagents_json: Vec<Value> = exp.reagents.iter().map(|r| {
                    let reagent_name = r.reagent_name.clone()
                        .or_else(|| r.reagent.as_ref().map(|d| d.name.clone()))
                        .unwrap_or_else(|| "Unknown".to_string());
                    let reagent_category = r.category.clone().or_else(|| {
                        r.reagent.as_ref().and_then(|d| d.category.clone())
                    });
                    json!({
                        "reagentName": reagent_name,
                        "reagentCategory": reagent_category,
                        "concentration": r.concentration,
                        "unit": r.unit,
                        "batchNumber": r.batch_number,
                        "productionDate": r.production_date
                    })
                }).collect();

                let duration_seconds = calculate_duration_seconds(&raw_points);
                let avg_temperature_c = calculate_avg_temperature_c(&raw_points);

                let exp_json = json!({
                    "_exportMeta": {
                        "originalId": exp.id,
                        "exportedAt": export_time,
                        "sourceLabName": exp.laboratory.as_ref().map(|l| l.name.clone()),
                        "sourceLab": exp.laboratory.as_ref().map(|l| l.id.clone())
                    },
                    "originalFilename": exp.original_filename,
                    "testDate": exp.test_date,
                    "instrumentType": exp.instrument_type,
                    "geometry": exp.geometry,
                    "geometrySource": exp.geometry_source,
                    "durationSeconds": duration_seconds,
                    "avgTemperatureC": avg_temperature_c,
                    "maxViscosity": exp.max_viscosity,
                    "name": exp.name,
                    "fieldName": exp.field_name,
                    "operatorName": exp.operator_name,
                    "wellNumber": exp.well_number,
                    "testId": exp.test_id,
                    "waterSource": exp.water_source,
                    "waterParams": exp.water_params,
                    "fluidType": exp.fluid_type,
                    "testGroup": exp.test_group,
                    "testSubGroup": exp.test_sub_group,
                    "metrics": exp.metrics,
                    "rawPoints": raw_points,
                    "reagents": reagents_json,
                    "calibration": exp.calibration,
                    "createdAt": exp.created_at,
                    "updatedAt": exp.updated_at
                });

                if !first_item {
                    writer.write_all(b",")?;
                }
                first_item = false;

                serde_json::to_writer(&mut writer, &exp_json)?;
            }
        }

        // Close JSON envelope
        writer.write_all(b"]}")?;
        writer.flush()?;
    }

    tracing::info!(
        "Export to file complete: {} experiments в†’ {}",
        total,
        file_path_str
    );

    Ok(json!({
        "success": true,
        "filePath": file_path_str,
        "fileName": file_name,
        "total": total,
        "exportedAt": export_time
    }))
}
