use crate::commands::experiments::types::{
    StoredExperiment, StoredExperimentLaboratory, StoredExperimentReagent, StoredExperimentUser,
    StoredReagentDescriptor,
};
use crate::error::Result;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// Load a single experiment by primary key, including reagents and columnar data.
/// This was previously `crud::load_experiment_by_id`.
pub(crate) fn load_experiment_by_id(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<Option<StoredExperiment>> {
    let row = conn
        .query_row(
            "SELECT e.id, e.createdAt, e.updatedAt, e.name, e.fieldName, e.operatorName,
                    e.wellNumber, e.testId, e.originalFilename, e.testDate, e.instrumentType,
                    e.geometry, e.geometrySource, e.waterSource, e.waterParams,
                    e.fluidType, e.testGroup, e.testSubGroup, e.metrics, e.rawPoints,
                    e.calibration, e.maxViscosity, e.avgViscosity, e.userId, e.laboratoryId,
                    u.name, u.email, l.id, l.name,
                    e.parsedBy, e.parseSource, e.timeRangeMin, e.timeRangeMax,
                    e.viscosityMin, e.pressureMax, e.extraFields,
                    e.testCategory, e.testType, e.dominantPattern
             FROM Experiment e
             LEFT JOIN User u ON e.userId = u.id
             LEFT JOIN Laboratory l ON e.laboratoryId = l.id
             WHERE e.id = ?1",
            params![id],
            |row| {
                let user_id: String = row.get(23)?;
                let user_name: Option<String> = row.get(25)?;
                let user_email: Option<String> = row.get(26)?;
                let lab_id: Option<String> = row.get(27)?;
                let lab_name: Option<String> = row.get(28)?;

                let user = user_name.map(|name| StoredExperimentUser {
                    id: user_id,
                    name,
                    email: user_email,
                });

                let laboratory = match (lab_id, lab_name) {
                    (Some(id), Some(name)) => Some(StoredExperimentLaboratory { id, name }),
                    _ => None,
                };

                let water_params_str: Option<String> = row.get(14)?;
                let water_params =
                    water_params_str.and_then(|s| serde_json::from_str::<Value>(&s).ok());

                let metrics_str: String = row.get(18)?;
                let metrics = serde_json::from_str::<Value>(&metrics_str).unwrap_or_else(|e| {
                    tracing::warn!("malformed metrics JSON (single-read): {}", e);
                    json!({})
                });

                // P0 refactoring: defer raw_points parsing — columnar blob is preferred.
                // Only parse inline JSON as fallback for legacy rows (pre-V2 migration).
                let raw_points_str: String = row.get(19)?;
                let raw_points = if raw_points_str == "[]" || raw_points_str.is_empty() {
                    vec![]
                } else {
                    serde_json::from_str::<Vec<Value>>(&raw_points_str).unwrap_or_else(|e| {
                        tracing::warn!("malformed rawPoints JSON (single-read): {}", e);
                        vec![]
                    })
                };

                let calibration_str: Option<String> = row.get(20)?;
                let calibration =
                    calibration_str.and_then(|s| serde_json::from_str::<Value>(&s).ok());

                let extra_fields_str: Option<String> = row.get(35)?;
                let extra_fields = extra_fields_str.and_then(|s| {
                    if s == "{}" {
                        None
                    } else {
                        serde_json::from_str::<Value>(&s).ok()
                    }
                });

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
                    raw_points,
                    calibration,
                    max_viscosity: row.get(21)?,
                    avg_viscosity: row.get(22)?,
                    reagents: vec![],
                    user,
                    laboratory,
                    parsed_by: row.get(29)?,
                    parse_source: row.get(30)?,
                    time_range_min: row.get(31)?,
                    time_range_max: row.get(32)?,
                    viscosity_min: row.get(33)?,
                    pressure_max: row.get(34)?,
                    extra_fields,
                    test_category: row.get(36)?,
                    test_type: row.get(37)?,
                    dominant_pattern: row.get(38)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("SQL error: {}", e))?;

    if let Some(ref exp) = row {
        // P0: Prefer compressed columnar data over inline-JSON rawPoints.
        // Falls back to the already-loaded row.raw_points if ExperimentData is absent/malformed.
        let columnar_raw_points: Option<Vec<Value>> = conn
            .query_row(
                "SELECT dataBlob FROM ExperimentData WHERE experimentId = ?1",
                params![exp.id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .optional()
            .ok()
            .flatten()
            .and_then(|blob| {
                crate::db::columnar::decode(&blob)
                    .map_err(|e| {
                        tracing::warn!("columnar decode failed for {}: {}", exp.id, e);
                        e
                    })
                    .ok()
            })
            .filter(|pts: &Vec<Value>| !pts.is_empty());

        // Load reagents for this experiment
        let mut reagents_stmt = conn
            .prepare(
                "SELECT er.reagentId, er.reagentName, er.concentration, er.unit,
                        er.batchNumber, er.productionDate, er.category,
                        rc.name, rc.category
                 FROM ExperimentReagent er
                 LEFT JOIN ReagentCatalog rc ON er.reagentId = rc.id
                 WHERE er.experimentId = ?1",
            )
            .map_err(|e| format!("SQL error: {}", e))?;

        let reagents: Vec<StoredExperimentReagent> = reagents_stmt
            .query_map(params![exp.id], |row| {
                let reagent_id: Option<String> = row.get(0)?;
                let denorm_name: Option<String> = row.get(1)?;
                let catalog_name: Option<String> = row.get(7)?;
                let denorm_category: Option<String> = row.get(6)?;
                let catalog_category: Option<String> = row.get(8)?;

                let reagent_name = catalog_name.or(denorm_name);
                let category = catalog_category.or(denorm_category);

                let reagent_descriptor = reagent_name.clone().map(|name| StoredReagentDescriptor {
                    name,
                    category: category.clone(),
                });

                Ok(StoredExperimentReagent {
                    reagent_id,
                    reagent_name: reagent_descriptor.as_ref().map(|d| d.name.clone()),
                    concentration: row.get(2)?,
                    unit: row.get(3)?,
                    batch_number: row.get(4)?,
                    production_date: row.get(5)?,
                    category,
                    reagent: reagent_descriptor,
                })
            })
            .map_err(|e| format!("SQL error: {}", e))?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| format!("SQL error (reagent row): {}", e))?;

        // Consume the Option by moving row — we know it's Some because we're inside
        // the `if let Some(ref exp) = row` guard above.
        if let Some(mut exp) = row {
            exp.reagents = reagents;
            if let Some(pts) = columnar_raw_points {
                exp.raw_points = pts;
            }
            return Ok(Some(exp));
        }
    }

    Ok(row)
}

/// Batch-load multiple experiments in 3 queries rather than 3 × N.
///
/// Preferred over calling [`load_experiment_by_id`] in a loop whenever `ids`
/// contains more than one element.  Returns experiments in the same order as
/// `ids`; IDs not found in the database are silently omitted.
pub(crate) fn load_experiments_batch(
    conn: &rusqlite::Connection,
    ids: &[String],
) -> Result<Vec<StoredExperiment>> {
    if ids.is_empty() {
        return Ok(vec![]);
    }

    let ph: String = std::iter::repeat("?")
        .take(ids.len())
        .collect::<Vec<_>>()
        .join(",");

    // ── Query 1: Main experiment rows + user/lab ──────────────────────────
    let main_sql = format!(
        "SELECT e.id, e.createdAt, e.updatedAt, e.name, e.fieldName, e.operatorName, \
                e.wellNumber, e.testId, e.originalFilename, e.testDate, e.instrumentType, \
                e.geometry, e.geometrySource, e.waterSource, e.waterParams, \
                e.fluidType, e.testGroup, e.testSubGroup, e.metrics, e.rawPoints, \
                e.calibration, e.maxViscosity, e.avgViscosity, e.userId, e.laboratoryId, \
                u.name, u.email, l.id, l.name, \
                e.parsedBy, e.parseSource, e.timeRangeMin, e.timeRangeMax, \
                e.viscosityMin, e.pressureMax, e.extraFields \
         FROM Experiment e \
         LEFT JOIN User u ON e.userId = u.id \
         LEFT JOIN Laboratory l ON e.laboratoryId = l.id \
         WHERE e.id IN ({ph})"
    );
    let mut stmt = conn
        .prepare(&main_sql)
        .map_err(|e| format!("SQL batch error: {}", e))?;

    let mut experiments: std::collections::HashMap<String, StoredExperiment> = stmt
        .query_map(rusqlite::params_from_iter(ids.iter()), |row| {
            let user_id: String = row.get(23)?;
            let user_name: Option<String> = row.get(25)?;
            let user_email: Option<String> = row.get(26)?;
            let lab_id: Option<String> = row.get(27)?;
            let lab_name: Option<String> = row.get(28)?;

            let user = user_name.map(|name| StoredExperimentUser {
                id: user_id,
                name,
                email: user_email,
            });
            let laboratory = match (lab_id, lab_name) {
                (Some(lid), Some(lname)) => Some(StoredExperimentLaboratory {
                    id: lid,
                    name: lname,
                }),
                _ => None,
            };

            let water_params_str: Option<String> = row.get(14)?;
            let water_params =
                water_params_str.and_then(|s| serde_json::from_str::<Value>(&s).ok());

            let metrics_str: String = row.get(18)?;
            let metrics = serde_json::from_str::<Value>(&metrics_str).unwrap_or_else(|e| {
                tracing::warn!("malformed metrics JSON (batch-read): {}", e);
                json!({})
            });

            let raw_points_str: String = row.get(19)?;
            let raw_points = if raw_points_str == "[]" || raw_points_str.is_empty() {
                vec![]
            } else {
                serde_json::from_str::<Vec<Value>>(&raw_points_str).unwrap_or_else(|e| {
                    tracing::warn!("malformed rawPoints JSON (batch-read): {}", e);
                    vec![]
                })
            };

            let calibration_str: Option<String> = row.get(20)?;
            let calibration = calibration_str.and_then(|s| serde_json::from_str::<Value>(&s).ok());

            let extra_fields_str: Option<String> = row.get(35)?;
            let extra_fields = extra_fields_str.and_then(|s| {
                if s == "{}" {
                    None
                } else {
                    serde_json::from_str::<Value>(&s).ok()
                }
            });

            let exp_id: String = row.get(0)?;
            Ok((
                exp_id.clone(),
                StoredExperiment {
                    id: exp_id,
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
                    reagents: vec![],
                    user,
                    laboratory,
                    parsed_by: row.get(29)?,
                    parse_source: row.get(30)?,
                    time_range_min: row.get(31)?,
                    time_range_max: row.get(32)?,
                    viscosity_min: row.get(33)?,
                    pressure_max: row.get(34)?,
                    extra_fields,
                    test_category: None,
                    test_type: None,
                    dominant_pattern: None,
                },
            ))
        })
        .map_err(|e| format!("SQL batch error: {}", e))?
        .collect::<rusqlite::Result<std::collections::HashMap<_, _>>>()
        .map_err(|e| format!("SQL batch row error: {}", e))?;

    // ── Query 2: Columnar blobs ───────────────────────────────────────────
    let blobs_sql =
        format!("SELECT experimentId, dataBlob FROM ExperimentData WHERE experimentId IN ({ph})");
    let mut blob_stmt = conn
        .prepare(&blobs_sql)
        .map_err(|e| format!("SQL blob batch error: {}", e))?;
    let blob_rows: Vec<(String, Vec<u8>)> = blob_stmt
        .query_map(rusqlite::params_from_iter(ids.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
        })
        .map_err(|e| format!("SQL blob batch error: {}", e))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("SQL blob row error: {}", e))?;
    for (exp_id, blob) in blob_rows {
        if let Some(exp) = experiments.get_mut(&exp_id) {
            match crate::db::columnar::decode(&blob) {
                Ok(pts) if !pts.is_empty() => {
                    exp.raw_points = pts;
                }
                Ok(_) => {} // empty decoded result — use inline fallback
                Err(e) => {
                    tracing::warn!("columnar decode failed for {} (batch): {}", exp_id, e);
                }
            }
        }
    }

    // ── Query 3: Reagents ─────────────────────────────────────────────────
    let reagents_sql = format!(
        "SELECT er.experimentId, er.reagentId, er.reagentName, er.concentration, er.unit, \
                er.batchNumber, er.productionDate, er.category, \
                rc.name, rc.category \
         FROM ExperimentReagent er \
         LEFT JOIN ReagentCatalog rc ON er.reagentId = rc.id \
         WHERE er.experimentId IN ({ph})"
    );
    let mut reagents_stmt = conn
        .prepare(&reagents_sql)
        .map_err(|e| format!("SQL reagents batch error: {}", e))?;
    let reagent_rows: Vec<(String, StoredExperimentReagent)> = reagents_stmt
        .query_map(rusqlite::params_from_iter(ids.iter()), |row| {
            let exp_id: String = row.get(0)?;
            let reagent_id: Option<String> = row.get(1)?;
            let denorm_name: Option<String> = row.get(2)?;
            let catalog_name: Option<String> = row.get(8)?;
            let denorm_category: Option<String> = row.get(7)?;
            let catalog_category: Option<String> = row.get(9)?;

            let reagent_name = catalog_name.or(denorm_name);
            let category = catalog_category.or(denorm_category);
            let reagent_descriptor = reagent_name.clone().map(|name| StoredReagentDescriptor {
                name,
                category: category.clone(),
            });
            Ok((
                exp_id,
                StoredExperimentReagent {
                    reagent_id,
                    reagent_name: reagent_descriptor.as_ref().map(|d| d.name.clone()),
                    concentration: row.get(3)?,
                    unit: row.get(4)?,
                    batch_number: row.get(5)?,
                    production_date: row.get(6)?,
                    category,
                    reagent: reagent_descriptor,
                },
            ))
        })
        .map_err(|e| format!("SQL reagents batch error: {}", e))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("SQL reagents row error: {}", e))?;
    for (exp_id, reagent) in reagent_rows {
        if let Some(exp) = experiments.get_mut(&exp_id) {
            exp.reagents.push(reagent);
        }
    }

    // Return in the same order as `ids`, omitting not-found entries.
    Ok(ids.iter().filter_map(|id| experiments.remove(id)).collect())
}

/// Return sha256 hashes of the compressed ExperimentData blobs for the
/// requested experiments. Missing legacy rows are omitted so callers can
/// choose a fallback key material.
pub(crate) fn load_experiment_data_hashes(
    conn: &rusqlite::Connection,
    ids: &[String],
) -> Result<HashMap<String, String>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }

    let ph: String = std::iter::repeat("?")
        .take(ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql =
        format!("SELECT experimentId, dataBlob FROM ExperimentData WHERE experimentId IN ({ph})");
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("SQL blob hash batch error: {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(ids.iter()), |row| {
            let experiment_id = row.get::<_, String>(0)?;
            let blob = row.get::<_, Vec<u8>>(1)?;
            let digest = Sha256::digest(&blob);
            Ok((experiment_id, hex::encode(digest)))
        })
        .map_err(|e| format!("SQL blob hash batch error: {}", e))?
        .collect::<rusqlite::Result<HashMap<_, _>>>()
        .map_err(|e| format!("SQL blob hash row error: {}", e))?;

    Ok(rows)
}

/// Find a duplicate experiment by filename + date + name.
/// Returns `Some((id, createdAt))` when a match exists, `None` otherwise.
pub(crate) fn find_duplicate(
    conn: &rusqlite::Connection,
    filename: &str,
    date: &str,
    name: &str,
) -> Result<Option<(String, String)>> {
    conn.query_row(
        "SELECT id, createdAt FROM Experiment \
         WHERE originalFilename = ?1 AND testDate = ?2 AND name = ?3 COLLATE NOCASE \
         LIMIT 1",
        params![filename, date, name],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .map_err(|e| format!("SQL error: {}", e).into())
}
