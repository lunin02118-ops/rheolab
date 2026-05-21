use crate::commands::experiments::types::{
    ExperimentDetailMeta, ExperimentDetailSummary, RawTablePage, RawTableRow, RheologyParameterRow,
    RheologyParameterSource, StoredExperiment, StoredExperimentLaboratory, StoredExperimentReagent,
    StoredExperimentUser, StoredReagentDescriptor,
};
use crate::error::Result;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};

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
                    e.testCategory, e.testType, e.dominantPattern,
                    COALESCE(e.rheologySource, 'program')
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
                    rheology_source: RheologyParameterSource::from_db(
                        row.get::<_, String>(39)?.as_str(),
                    ),
                    rheology_parameters: Vec::new(),
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
            exp.rheology_parameters = load_rheology_parameters_for_experiment(conn, &exp.id)?;
            if let Some(pts) = columnar_raw_points {
                exp.raw_points = pts;
            }
            return Ok(Some(exp));
        }
    }

    Ok(row)
}

/// Load saved-experiment metadata for detail open without materializing raw
/// points. This is the MEM-1 read path: it intentionally does not select
/// `Experiment.rawPoints` or `ExperimentData.dataBlob`.
pub(crate) fn load_experiment_detail_meta_by_id(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<Option<ExperimentDetailMeta>> {
    let row = conn
        .query_row(
            "SELECT e.id, e.createdAt, e.updatedAt, e.name, e.fieldName, e.operatorName,
                    e.wellNumber, e.testId, e.originalFilename, e.testDate, e.instrumentType,
                    e.geometry, e.geometrySource, e.waterSource, e.waterParams,
                    e.fluidType, e.testGroup, e.testSubGroup, e.metrics,
                    e.calibration, e.maxViscosity, e.avgViscosity, e.userId, e.laboratoryId,
                    u.name, u.email, l.id, l.name,
                    e.parsedBy, e.parseSource, e.timeRangeMin, e.timeRangeMax,
                    e.viscosityMin, e.pressureMax, e.extraFields,
                    e.testCategory, e.testType, e.dominantPattern,
                    COALESCE(e.rheologySource, 'program'),
                    COALESCE(ed.pointCount, 0)
             FROM Experiment e
             LEFT JOIN User u ON e.userId = u.id
             LEFT JOIN Laboratory l ON e.laboratoryId = l.id
             LEFT JOIN ExperimentData ed ON ed.experimentId = e.id
             WHERE e.id = ?1",
            params![id],
            |row| {
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

                let water_params_str: Option<String> = row.get(14)?;
                let water_params =
                    water_params_str.and_then(|s| serde_json::from_str::<Value>(&s).ok());

                let metrics_str: String = row.get(18)?;
                let metrics = serde_json::from_str::<Value>(&metrics_str).unwrap_or_else(|e| {
                    tracing::warn!("malformed metrics JSON (detail-meta): {}", e);
                    json!({})
                });

                let calibration_str: Option<String> = row.get(19)?;
                let calibration =
                    calibration_str.and_then(|s| serde_json::from_str::<Value>(&s).ok());

                let extra_fields_str: Option<String> = row.get(34)?;
                let extra_fields = extra_fields_str.and_then(|s| {
                    if s == "{}" {
                        None
                    } else {
                        serde_json::from_str::<Value>(&s).ok()
                    }
                });

                let point_count = row.get::<_, i64>(39)?.max(0) as usize;
                let time_range_min = row.get(30)?;
                let time_range_max = row.get(31)?;
                let viscosity_min = row.get(32)?;
                let max_viscosity = row.get(20)?;
                let avg_viscosity = row.get(21)?;
                let pressure_max = row.get(33)?;

                Ok(ExperimentDetailMeta {
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
                    test_category: row.get(35)?,
                    test_type: row.get(36)?,
                    dominant_pattern: row.get(37)?,
                    metrics,
                    calibration,
                    reagents: vec![],
                    summary: ExperimentDetailSummary {
                        point_count,
                        time_range_min,
                        time_range_max,
                        viscosity_min,
                        max_viscosity,
                        avg_viscosity,
                        pressure_max,
                    },
                    user,
                    laboratory,
                    parsed_by: row.get(28)?,
                    parse_source: row.get(29)?,
                    extra_fields,
                    rheology_source: RheologyParameterSource::from_db(
                        row.get::<_, String>(38)?.as_str(),
                    ),
                })
            },
        )
        .optional()
        .map_err(|e| format!("SQL detail-meta error: {}", e))?;

    let Some(mut meta) = row else {
        return Ok(None);
    };

    meta.reagents = load_reagents_for_experiment(conn, &meta.id)?;
    Ok(Some(meta))
}

pub(crate) fn load_raw_table_page_by_id(
    conn: &rusqlite::Connection,
    experiment_id: &str,
    page: usize,
    page_size: usize,
) -> Result<Option<RawTablePage>> {
    let blob: Option<Vec<u8>> = conn
        .query_row(
            "SELECT dataBlob FROM ExperimentData WHERE experimentId = ?1",
            params![experiment_id],
            |row| row.get(0),
        )
        .optional()?;

    let columns = if let Some(blob) = blob {
        Some(crate::db::columnar::decode_typed(&blob)?)
    } else {
        let raw_points: Option<String> = conn
            .query_row(
                "SELECT rawPoints FROM Experiment WHERE id = ?1",
                params![experiment_id],
                |row| row.get(0),
            )
            .optional()?;
        match raw_points {
            Some(raw_points) if !raw_points.trim().is_empty() && raw_points.trim() != "[]" => {
                Some(raw_points_json_to_columns(&raw_points)?)
            }
            Some(_) => Some(HashMap::new()),
            None => None,
        }
    };

    let Some(columns) = columns else {
        return Ok(None);
    };

    let total_rows = columns.values().map(Vec::len).max().unwrap_or(0);
    let total_pages = total_rows.div_ceil(page_size).max(1);
    let start = page.saturating_sub(1).saturating_mul(page_size);
    let end = (start + page_size).min(total_rows);
    let has_bath_temperature =
        first_present_column(&columns, &["bath_temperature_c", "bathTemperatureC"])
            .map(|values| values.iter().any(|value| value.is_some_and(f64::is_finite)))
            .unwrap_or(false);

    let mut rows = Vec::with_capacity(end.saturating_sub(start));
    for idx in start..end {
        rows.push(RawTableRow {
            index: idx + 1,
            time_sec: finite_column_value(&columns, &["time_sec", "timeSec", "time"], idx),
            viscosity_cp: finite_column_value(
                &columns,
                &["viscosity_cp", "viscosityCp", "viscosity"],
                idx,
            ),
            temperature_c: finite_column_value(
                &columns,
                &["temperature_c", "temperatureC", "temperature"],
                idx,
            ),
            speed_rpm: finite_column_value(&columns, &["speed_rpm", "speedRpm", "rpm"], idx),
            shear_rate_s1: finite_column_value(
                &columns,
                &["shear_rate_s1", "shearRateS1", "shear_rate", "shearRate"],
                idx,
            ),
            shear_stress_pa: finite_column_value(
                &columns,
                &[
                    "shear_stress_pa",
                    "shearStressPa",
                    "shear_stress",
                    "shearStress",
                ],
                idx,
            ),
            pressure_bar: finite_column_value(
                &columns,
                &["pressure_bar", "pressureBar", "pressure"],
                idx,
            ),
            bath_temperature_c: finite_column_value(
                &columns,
                &["bath_temperature_c", "bathTemperatureC"],
                idx,
            ),
        });
    }

    Ok(Some(RawTablePage {
        experiment_id: experiment_id.to_string(),
        total_rows,
        page,
        page_size,
        total_pages,
        has_bath_temperature,
        rows,
    }))
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
                e.viscosityMin, e.pressureMax, e.extraFields, \
                e.testCategory, e.testType, e.dominantPattern, \
                COALESCE(e.rheologySource, 'program') \
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
                    test_category: row.get(36)?,
                    test_type: row.get(37)?,
                    dominant_pattern: row.get(38)?,
                    rheology_source: RheologyParameterSource::from_db(
                        row.get::<_, String>(39)?.as_str(),
                    ),
                    rheology_parameters: Vec::new(),
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

    let rheology_rows = load_rheology_parameters_batch(conn, ids)?;
    for (exp_id, rows) in rheology_rows {
        if let Some(exp) = experiments.get_mut(&exp_id) {
            exp.rheology_parameters = rows;
        }
    }

    // Return in the same order as `ids`, omitting not-found entries.
    Ok(ids.iter().filter_map(|id| experiments.remove(id)).collect())
}

fn load_reagents_for_experiment(
    conn: &rusqlite::Connection,
    experiment_id: &str,
) -> Result<Vec<StoredExperimentReagent>> {
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

    let reagents = reagents_stmt
        .query_map(params![experiment_id], |row| {
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

    Ok(reagents)
}

pub(crate) fn load_rheology_parameters_for_experiment(
    conn: &rusqlite::Connection,
    experiment_id: &str,
) -> Result<Vec<RheologyParameterRow>> {
    let mut stmt = conn
        .prepare(
            "SELECT source, cycleNo, timeMin, endTimeMin, tempC, pressureBar, \
                    nPrime, kvPaSn, kPrimePaSn, kSlotPaSn, kPipePaSn, r2, \
                    viscositiesJson, binghamPvPaS, binghamYpPa, binghamR2, \
                    calcPoints, sourceSheet, sourceRow, unitsJson \
             FROM ExperimentRheologyParameter \
             WHERE experimentId = ?1 \
             ORDER BY source, cycleNo",
        )
        .map_err(|e| format!("SQL error (rheology parameter prepare): {}", e))?;

    let rows = stmt
        .query_map(params![experiment_id], rheology_row_from_sql)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("SQL error (rheology parameter row): {}", e).into());
    rows
}

fn load_rheology_parameters_batch(
    conn: &rusqlite::Connection,
    ids: &[String],
) -> Result<HashMap<String, Vec<RheologyParameterRow>>> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }

    let ph = std::iter::repeat("?")
        .take(ids.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT experimentId, source, cycleNo, timeMin, endTimeMin, tempC, pressureBar, \
                nPrime, kvPaSn, kPrimePaSn, kSlotPaSn, kPipePaSn, r2, \
                viscositiesJson, binghamPvPaS, binghamYpPa, binghamR2, \
                calcPoints, sourceSheet, sourceRow, unitsJson \
         FROM ExperimentRheologyParameter \
         WHERE experimentId IN ({ph}) \
         ORDER BY experimentId, source, cycleNo"
    );
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("SQL error (rheology batch prepare): {}", e))?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(ids.iter()), |row| {
            let experiment_id: String = row.get(0)?;
            Ok((experiment_id, rheology_row_from_sql_offset(row, 1)?))
        })
        .map_err(|e| format!("SQL error (rheology batch): {}", e))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| format!("SQL error (rheology batch row): {}", e))?;

    let mut out: HashMap<String, Vec<RheologyParameterRow>> = HashMap::new();
    for (experiment_id, row) in rows {
        out.entry(experiment_id).or_default().push(row);
    }
    Ok(out)
}

fn rheology_row_from_sql(row: &rusqlite::Row<'_>) -> rusqlite::Result<RheologyParameterRow> {
    rheology_row_from_sql_offset(row, 0)
}

fn rheology_row_from_sql_offset(
    row: &rusqlite::Row<'_>,
    offset: usize,
) -> rusqlite::Result<RheologyParameterRow> {
    let source: String = row.get(offset)?;
    let viscosities_json: String = row.get(offset + 12)?;
    let units_json: String = row.get(offset + 19)?;
    let viscosities =
        serde_json::from_str::<BTreeMap<String, f64>>(&viscosities_json).unwrap_or_default();
    let units = serde_json::from_str::<BTreeMap<String, String>>(&units_json).unwrap_or_default();

    Ok(RheologyParameterRow {
        source: RheologyParameterSource::from_db(&source),
        cycle_no: row.get(offset + 1)?,
        time_min: row.get(offset + 2)?,
        end_time_min: row.get(offset + 3)?,
        temp_c: row.get(offset + 4)?,
        pressure_bar: row.get(offset + 5)?,
        n_prime: row.get(offset + 6)?,
        kv_pasn: row.get(offset + 7)?,
        k_prime_pasn: row.get(offset + 8)?,
        k_slot_pasn: row.get(offset + 9)?,
        k_pipe_pasn: row.get(offset + 10)?,
        r2: row.get(offset + 11)?,
        viscosities,
        bingham_pv_pas: row.get(offset + 13)?,
        bingham_yp_pa: row.get(offset + 14)?,
        bingham_r2: row.get(offset + 15)?,
        calc_points: row.get(offset + 16)?,
        source_sheet: row.get(offset + 17)?,
        source_row: row.get(offset + 18)?,
        units,
    })
}

fn raw_points_json_to_columns(raw_points: &str) -> Result<HashMap<String, Vec<Option<f64>>>> {
    let values: Vec<Value> = serde_json::from_str(raw_points)?;
    let mut columns: HashMap<String, Vec<Option<f64>>> = HashMap::new();
    for (idx, value) in values.iter().enumerate() {
        if let Value::Object(map) = value {
            for key in map.keys() {
                columns
                    .entry(key.clone())
                    .or_insert_with(|| vec![None; idx]);
            }
            for column in columns.values_mut() {
                column.push(None);
            }
            for (key, value) in map {
                if let Some(column) = columns.get_mut(key) {
                    column[idx] = value.as_f64();
                }
            }
        } else {
            for column in columns.values_mut() {
                column.push(None);
            }
        }
    }
    Ok(columns)
}

fn first_present_column<'a>(
    columns: &'a HashMap<String, Vec<Option<f64>>>,
    aliases: &[&str],
) -> Option<&'a Vec<Option<f64>>> {
    aliases.iter().find_map(|alias| columns.get(*alias))
}

fn finite_column_value(
    columns: &HashMap<String, Vec<Option<f64>>>,
    aliases: &[&str],
    idx: usize,
) -> Option<f64> {
    first_present_column(columns, aliases)
        .and_then(|column| column.get(idx).copied().flatten())
        .filter(|value| value.is_finite())
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
