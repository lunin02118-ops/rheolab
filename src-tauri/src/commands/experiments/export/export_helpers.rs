//! Internal helpers for the export commands.

use crate::error::Result;
use crate::state::AppState;
use serde_json::{json, Value};
use super::super::types::*;
use super::super::helpers::*;

/// Load experiment metadata (NO rawPoints) for a batch of specific IDs.
pub(super) fn load_experiment_batch_no_raw(
    conn: &rusqlite::Connection,
    ids: &[String],
) -> Result<Vec<StoredExperiment>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let phs = ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT e.id, e.createdAt, e.updatedAt, e.name, e.fieldName, e.operatorName,
                e.wellNumber, e.testId, e.originalFilename, e.testDate, e.instrumentType,
                e.geometry, e.geometrySource, e.waterSource, e.waterParams,
                e.fluidType, e.testGroup, e.testSubGroup, e.metrics,
                e.calibration, e.maxViscosity, e.avgViscosity, e.userId, e.laboratoryId,
                u.name, u.email, l.id, l.name
         FROM Experiment e
         LEFT JOIN User u ON e.userId = u.id
         LEFT JOIN Laboratory l ON e.laboratoryId = l.id
         WHERE e.id IN ({})",
        phs
    );
    let params_ref: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    let mut stmt = conn.prepare(&sql)?;

    let rows: Vec<StoredExperiment> = stmt
        .query_map(params_ref.as_slice(), |row| {
            let user_id: String = row.get(22)?;
            let user_name: Option<String> = row.get(24)?;
            let user_email: Option<String> = row.get(25)?;
            let lab_id: Option<String> = row.get(26)?;
            let lab_name: Option<String> = row.get(27)?;

            let user = user_name.map(|name| StoredExperimentUser {
                id: user_id,
                name,
                email: user_email,
            });
            let laboratory = match (lab_id, lab_name) {
                (Some(id), Some(name)) => Some(StoredExperimentLaboratory { id, name }),
                _ => None,
            };

            let water_params = row.get::<_, Option<String>>(14)?
                .and_then(|s| serde_json::from_str::<Value>(&s).ok());
            let metrics = serde_json::from_str::<Value>(&row.get::<_, String>(18)?)
                .unwrap_or_else(|_| serde_json::json!({}));
            let calibration = row.get::<_, Option<String>>(19)?
                .and_then(|s| serde_json::from_str::<Value>(&s).ok());

            Ok(StoredExperiment {
                id: row.get(0)?,
                created_at: row.get(1)?,
                updated_at: row.get(2)?,
                name: row.get(3)?,
                field_name: row.get(4)?,
                operator_name: row.get(5)?,
                well_number: row.get(6)?,
                test_id: row.get(7)?,
                original_filename: row.get(8)?,
                test_date: row.get(9)?,
                instrument_type: row.get(10)?,
                geometry: row.get(11)?,
                geometry_source: row.get(12)?,
                water_source: row.get(13)?,
                water_params,
                fluid_type: row.get(15)?,
                test_group: row.get(16)?,
                test_sub_group: row.get(17)?,
                metrics,
                raw_points: vec![], // loaded separately from ExperimentData
                calibration,
                max_viscosity: row.get(20)?,
                avg_viscosity: row.get(21)?,
                reagents: vec![],
                user,
                laboratory,
                parsed_by: None,
                parse_source: None,
                time_range_min: None,
                time_range_max: None,
                viscosity_min: None,
                pressure_max: None,
                extra_fields: None,
                test_category: None,
                test_type: None,
                dominant_pattern: None,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Load experiments from SQL (with reagents, user, lab), filtered by lab IDs when provided.
/// Used only for full-data operations (export).
pub(super) fn load_all_experiments(state: &AppState, lab_ids: &[String]) -> Result<Vec<StoredExperiment>> {
    let conn = state.pool_conn()?;

    // Build WHERE clause for laboratory filter вЂ” push into SQL instead of filtering in memory
    let include_no_lab = lab_ids.iter().any(|id| id.as_str() == NO_LAB_ID);
    let real_ids: Vec<&String> = lab_ids.iter().filter(|id| id.as_str() != NO_LAB_ID).collect();

    let (where_clause, filter_params): (String, Vec<Box<dyn rusqlite::ToSql>>) =
        if lab_ids.is_empty() {
            (String::new(), vec![])
        } else if include_no_lab && real_ids.is_empty() {
            ("WHERE e.laboratoryId IS NULL".to_string(), vec![])
        } else if include_no_lab {
            let placeholders = real_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let params: Vec<Box<dyn rusqlite::ToSql>> = real_ids
                .iter()
                .map(|id| Box::new((*id).clone()) as Box<dyn rusqlite::ToSql>)
                .collect();
            (
                format!(
                    "WHERE (e.laboratoryId IS NULL OR e.laboratoryId IN ({}))",
                    placeholders
                ),
                params,
            )
        } else {
            let placeholders = real_ids.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
            let params: Vec<Box<dyn rusqlite::ToSql>> = real_ids
                .iter()
                .map(|id| Box::new((*id).clone()) as Box<dyn rusqlite::ToSql>)
                .collect();
            (format!("WHERE e.laboratoryId IN ({})", placeholders), params)
        };

    // 1. Load filtered experiments with user/lab info
    let sql = format!(
        "SELECT e.id, e.createdAt, e.updatedAt, e.name, e.fieldName, e.operatorName,
                e.wellNumber, e.testId, e.originalFilename, e.testDate, e.instrumentType,
                e.geometry, e.geometrySource, e.waterSource, e.waterParams,
                e.fluidType, e.testGroup, e.testSubGroup, e.metrics, e.rawPoints,
                e.calibration, e.maxViscosity, e.avgViscosity, e.userId, e.laboratoryId,
                u.name, u.email, l.id, l.name
         FROM Experiment e
         LEFT JOIN User u ON e.userId = u.id
         LEFT JOIN Laboratory l ON e.laboratoryId = l.id
         {}",
        where_clause
    );
    let params_ref: Vec<&dyn rusqlite::ToSql> =
        filter_params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn
        .prepare(&sql)?;

    let exp_rows: Vec<(String, StoredExperiment)> = stmt
        .query_map(params_ref.as_slice(), |row| {
            let experiment_id: String = row.get(0)?;
            let user_id: String = row.get::<_, String>(23)?;
            let user_name: Option<String> = row.get(25)?;
            let user_email: Option<String> = row.get(26)?;
            let lab_id: Option<String> = row.get(27)?;
            let lab_name: Option<String> = row.get(28)?;

            let user = user_name.map(|name| StoredExperimentUser {
                id: user_id.clone(),
                name,
                email: user_email,
            });

            let laboratory = match (lab_id, lab_name) {
                (Some(id), Some(name)) => Some(StoredExperimentLaboratory { id, name }),
                _ => None,
            };

            let water_params_str: Option<String> = row.get(14)?;
            let water_params = water_params_str
                .and_then(|s| serde_json::from_str::<Value>(&s).ok());

            let metrics_str: String = row.get(18)?;
            let metrics = serde_json::from_str::<Value>(&metrics_str)
                .unwrap_or_else(|_| json!({}));

            let raw_points_str: String = row.get(19)?;
            let raw_points = serde_json::from_str::<Vec<Value>>(&raw_points_str)
                .unwrap_or_default();

            let calibration_str: Option<String> = row.get(20)?;
            let calibration = calibration_str
                .and_then(|s| serde_json::from_str::<Value>(&s).ok());

            Ok((
                experiment_id.clone(),
                StoredExperiment {
                    id: experiment_id,
                    created_at: row.get(1)?,
                    updated_at: row.get(2)?,
                    name: row.get(3)?,
                    field_name: row.get(4)?,
                    operator_name: row.get(5)?,
                    well_number: row.get(6)?,
                    test_id: row.get(7)?,
                    original_filename: row.get(8)?,
                    test_date: row.get(9)?,
                    instrument_type: row.get(10)?,
                    geometry: row.get(11)?,
                    geometry_source: row.get(12)?,
                    water_source: row.get(13)?,
                    water_params,
                    fluid_type: row.get(15)?,
                    test_group: row.get(16)?,
                    test_sub_group: row.get(17)?,
                    metrics,
                    raw_points,
                    calibration,
                    max_viscosity: row.get(21)?,
                    avg_viscosity: row.get(22)?,
                    reagents: vec![], // filled below
                    user,
                    laboratory,
                    parsed_by: None,
                    parse_source: None,
                    time_range_min: None,
                    time_range_max: None,
                    viscosity_min: None,
                    pressure_max: None,
                    extra_fields: None,
                    test_category: None,
                    test_type: None,
                    dominant_pattern: None,
                },
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    // 2. Batch-load reagents only for the filtered experiments
    let exp_ids: Vec<String> = exp_rows.iter().map(|(id, _)| id.clone()).collect();
    let reagents_map = load_reagents_batch(&conn, &exp_ids)?;

    // 3. P2-A: Prefer ExperimentData columnar blobs over inline rawPoints JSON.
    let blobs_map = load_experiment_data_blobs(&conn, &exp_ids)?;

    // 4. Merge reagents + decode blobs into experiments
    let experiments: Vec<StoredExperiment> = exp_rows
        .into_iter()
        .map(|(id, mut exp)| {
            exp.reagents = reagents_map.get(&id).cloned().unwrap_or_default();
            if let Some(blob) = blobs_map.get(&id) {
                if let Ok(pts) = crate::db::columnar::decode(blob) {
                    if !pts.is_empty() {
                        exp.raw_points = pts;
                    }
                }
            }
            exp
        })
        .collect();

    Ok(experiments)
}
