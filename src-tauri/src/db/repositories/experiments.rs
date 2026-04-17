//! Repository layer for Experiment persistence.
//!
//! Provides the [`ExperimentRepository`] trait and its SQLite implementation
//! [`SqliteExperimentRepository`].  All SQL for experiment CRUD lives here;
//! command handlers in `commands::experiments` remain thin orchestrators.

use crate::commands::experiments::helpers::{
    calculate_avg_temperature_c, calculate_duration_seconds, calculate_max_temperature_c,
    now_rfc3339, short_hash,
};
use crate::commands::experiments::types::{
    LOCAL_USER_ID, StoredExperiment, StoredExperimentLaboratory, StoredExperimentReagent,
    StoredExperimentUser, StoredReagentDescriptor,
};
use crate::error::Result;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

// ── Trait ─────────────────────────────────────────────────────────────────────

/// Repository interface for Experiment persistence operations.
///
/// Abstracting behind this trait allows command handlers to be tested with
/// in-memory SQLite implementations or mocks.
pub trait ExperimentRepository {
    /// Insert or update an experiment, including its user/lab references,
    /// columnar data blob, and reagents.
    fn save(&self, conn: &rusqlite::Connection, exp: &StoredExperiment) -> Result<()>;

    /// Retrieve a full experiment by primary key, including reagents and
    /// columnar point data.
    fn find_by_id(
        &self,
        conn: &rusqlite::Connection,
        id: &str,
    ) -> Result<Option<StoredExperiment>>;

    /// Check for a duplicate row (filename + date + name).
    /// Returns `Some((id, createdAt))` when a match exists.
    fn find_duplicate(
        &self,
        conn: &rusqlite::Connection,
        filename: &str,
        date: &str,
        name: &str,
    ) -> Result<Option<(String, String)>>;

    /// Delete an experiment by primary key.
    /// Returns `true` if a row was deleted, `false` if not found.
    fn delete(&self, conn: &rusqlite::Connection, id: &str) -> Result<bool>;
}

// ── Default SQLite implementation ─────────────────────────────────────────────

/// SQLite-backed implementation of [`ExperimentRepository`].
pub struct SqliteExperimentRepository;

impl ExperimentRepository for SqliteExperimentRepository {
    fn save(&self, conn: &rusqlite::Connection, exp: &StoredExperiment) -> Result<()> {
        persist_experiment(conn, exp)
    }

    fn find_by_id(
        &self,
        conn: &rusqlite::Connection,
        id: &str,
    ) -> Result<Option<StoredExperiment>> {
        load_experiment_by_id(conn, id)
    }

    fn find_duplicate(
        &self,
        conn: &rusqlite::Connection,
        filename: &str,
        date: &str,
        name: &str,
    ) -> Result<Option<(String, String)>> {
        find_duplicate(conn, filename, date, name)
    }

    fn delete(&self, conn: &rusqlite::Connection, id: &str) -> Result<bool> {
        delete_experiment(conn, id)
    }
}

// ── Free-function API (pub(crate)) ────────────────────────────────────────────
//
// These functions mirror the trait methods and are retained for callers that
// do not need polymorphism (e.g. sync_engine, experiments::sync).
// They are the canonical home for all experiment SQL.

/// Persist a single experiment (INSERT OR REPLACE) with its user, laboratory,
/// columnar data blob, and reagents.  This was previously `crud::persist_experiment`.
pub(crate) fn persist_experiment(
    conn: &rusqlite::Connection,
    exp: &StoredExperiment,
) -> Result<()> {
    let user_id = exp
        .user
        .as_ref()
        .map(|u| u.id.clone())
        .unwrap_or_else(|| LOCAL_USER_ID.to_string());

    // Ensure user exists (INSERT OR IGNORE).
    // Always upsert: either the provided user OR the fallback LOCAL_USER_ID,
    // because PRAGMA foreign_keys = ON and Experiment.userId is NOT NULL.
    if let Some(ref user) = exp.user {
        conn.execute(
            "INSERT OR IGNORE INTO User (id, name, email, role, isActive, createdAt, updatedAt) \
             VALUES (?1, ?2, ?3, 'operator', 1, ?4, ?4)",
            params![user.id, user.name, user.email, now_rfc3339()],
        )
        .map_err(|e| format!("SQL error (user ensure): {}", e))?;
    } else {
        // No user provided — ensure the local desktop admin record exists.
        conn.execute(
            "INSERT OR IGNORE INTO User (id, name, email, role, isActive, createdAt, updatedAt) \
             VALUES (?1, 'Local Admin', 'local@desktop', 'admin', 1, ?2, ?2)",
            params![LOCAL_USER_ID, now_rfc3339()],
        )
        .map_err(|e| format!("SQL error (local user ensure): {}", e))?;
    }

    let lab_id = exp.laboratory.as_ref().map(|l| l.id.clone());

    // Ensure laboratory exists (INSERT OR IGNORE)
    if let Some(ref lab) = exp.laboratory {
        conn.execute(
            "INSERT OR IGNORE INTO Laboratory (id, name, createdAt, updatedAt) \
             VALUES (?1, ?2, ?3, ?3)",
            params![lab.id, lab.name, now_rfc3339()],
        )
        .map_err(|e| format!("SQL error (lab ensure): {}", e))?;
    }

    let water_params_json = exp
        .water_params
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_default());
    let metrics_json =
        serde_json::to_string(&exp.metrics).unwrap_or_else(|_| "{}".to_string());
    // P0 refactoring: rawPoints column is kept as '[]' sentinel — all point data
    // lives exclusively in ExperimentData (columnar-zstd blob). The column is NOT NULL
    // so we cannot use NULL; '[]' signals "look in ExperimentData".
    let raw_points_json = "[]".to_string();
    let calibration_json = exp
        .calibration
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_default());

    let duration_seconds = calculate_duration_seconds(&exp.raw_points);
    let avg_temperature_c = calculate_avg_temperature_c(&exp.raw_points);
    let max_temperature_c = calculate_max_temperature_c(&exp.raw_points);

    let extra_fields_json = exp
        .extra_fields
        .as_ref()
        .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "{}".to_string()))
        .unwrap_or_else(|| "{}".to_string());

    // CRITICAL-1: Use ON CONFLICT DO UPDATE instead of INSERT OR REPLACE to avoid
    // cascading DELETE on child tables (ExperimentData, ExperimentReagent, etc.).
    // createdAt is intentionally excluded from the UPDATE SET to preserve original creation time.
    conn.execute(
        "INSERT INTO Experiment \
         (id, createdAt, updatedAt, originalFilename, testDate, instrumentType, \
          geometry, geometrySource, durationSeconds, avgTemperatureC, maxTemperatureC, maxViscosity, avgViscosity, \
          name, fieldName, operatorName, wellNumber, testId, waterSource, waterParams, \
          fluidType, testGroup, testSubGroup, metrics, rawPoints, calibration, userId, laboratoryId, \
          parsedBy, parseSource, timeRangeMin, timeRangeMax, viscosityMin, pressureMax, extraFields, \
          testCategory, testType, dominantPattern) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33,?34,?35,?36,?37,?38) \
         ON CONFLICT(id) DO UPDATE SET \
           updatedAt = excluded.updatedAt, \
           originalFilename = excluded.originalFilename, \
           testDate = excluded.testDate, \
           instrumentType = excluded.instrumentType, \
           geometry = excluded.geometry, \
           geometrySource = excluded.geometrySource, \
           durationSeconds = excluded.durationSeconds, \
           avgTemperatureC = excluded.avgTemperatureC, \
           maxTemperatureC = excluded.maxTemperatureC, \
           maxViscosity = excluded.maxViscosity, \
           avgViscosity = excluded.avgViscosity, \
           name = excluded.name, \
           fieldName = excluded.fieldName, \
           operatorName = excluded.operatorName, \
           wellNumber = excluded.wellNumber, \
           testId = excluded.testId, \
           waterSource = excluded.waterSource, \
           waterParams = excluded.waterParams, \
           fluidType = excluded.fluidType, \
           testGroup = excluded.testGroup, \
           testSubGroup = excluded.testSubGroup, \
           metrics = excluded.metrics, \
           rawPoints = excluded.rawPoints, \
           calibration = excluded.calibration, \
           userId = excluded.userId, \
           laboratoryId = excluded.laboratoryId, \
           parsedBy = excluded.parsedBy, \
           parseSource = excluded.parseSource, \
           timeRangeMin = excluded.timeRangeMin, \
           timeRangeMax = excluded.timeRangeMax, \
           viscosityMin = excluded.viscosityMin, \
           pressureMax = excluded.pressureMax, \
           extraFields = excluded.extraFields, \
           testCategory = excluded.testCategory, \
           testType = excluded.testType, \
           dominantPattern = excluded.dominantPattern",
        params![
            exp.id,
            exp.created_at,
            exp.updated_at,
            exp.original_filename,
            exp.test_date,
            exp.instrument_type,
            exp.geometry,
            exp.geometry_source,
            duration_seconds,
            avg_temperature_c,
            max_temperature_c,
            exp.max_viscosity,
            exp.avg_viscosity,
            exp.name,
            exp.field_name,
            exp.operator_name,
            exp.well_number,
            exp.test_id,
            exp.water_source,
            water_params_json,
            exp.fluid_type,
            exp.test_group,
            exp.test_sub_group,
            metrics_json,
            raw_points_json,
            calibration_json,
            user_id,
            lab_id,
            exp.parsed_by,
            exp.parse_source,
            exp.time_range_min,
            exp.time_range_max,
            exp.viscosity_min,
            exp.pressure_max,
            extra_fields_json,
            exp.test_category,
            exp.test_type,
            exp.dominant_pattern,
        ],
    )
    .map_err(|e| format!("SQL error (experiment insert): {}", e))?;

    // P0: Write compressed columnar blob to ExperimentData — this is the ONLY
    // store for point data now (rawPoints = '[]' in Experiment table).
    // Encoding failure is a hard error — we must not lose data.
    if !exp.raw_points.is_empty() {
        let blob = crate::db::columnar::encode(&exp.raw_points)
            .map_err(|e| format!("Columnar encode failed for {}: {}", exp.id, e))?;
        conn.execute(
            "INSERT INTO ExperimentData \
             (experimentId, dataBlob, encoding, pointCount, createdAt, updatedAt) \
             VALUES (?1, ?2, 'columnar-v1-zstd', ?3, ?4, ?5) \
             ON CONFLICT(experimentId) DO UPDATE SET \
               dataBlob = excluded.dataBlob, \
               encoding = excluded.encoding, \
               pointCount = excluded.pointCount, \
               updatedAt = excluded.updatedAt",
            params![
                exp.id,
                blob,
                exp.raw_points.len() as i64,
                exp.created_at,
                exp.updated_at,
            ],
        )
        .map_err(|e| format!("SQL error (experiment data insert): {}", e))?;
    }

    // Delete old reagents and insert new ones
    conn.execute(
        "DELETE FROM ExperimentReagent WHERE experimentId = ?1",
        params![exp.id],
    )
    .map_err(|e| format!("SQL error (reagent cleanup): {}", e))?;

    for reagent in &exp.reagents {
        let reagent_row_id = format!("er_{}_{}", short_hash(&exp.id), short_hash(&now_rfc3339()));
        let reagent_name = reagent
            .reagent_name
            .clone()
            .or_else(|| reagent.reagent.as_ref().map(|d| d.name.clone()));
        let category = reagent
            .category
            .clone()
            .or_else(|| {
                reagent
                    .reagent
                    .as_ref()
                    .and_then(|d| d.category.clone())
            });

        conn.execute(
            "INSERT INTO ExperimentReagent \
             (id, experimentId, reagentId, reagentName, category, concentration, unit, batchNumber, productionDate) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                reagent_row_id,
                exp.id,
                reagent.reagent_id,
                reagent_name,
                category,
                reagent.concentration,
                reagent.unit,
                reagent.batch_number,
                reagent.production_date,
            ],
        )
        .map_err(|e| format!("SQL error (reagent insert): {}", e))?;
    }

    Ok(())
}

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
                let water_params = water_params_str
                    .and_then(|s| serde_json::from_str::<Value>(&s).ok());

                let metrics_str: String = row.get(18)?;
                let metrics = serde_json::from_str::<Value>(&metrics_str)
                    .unwrap_or_else(|_| json!({}));

                // P0 refactoring: defer raw_points parsing — columnar blob is preferred.
                // Only parse inline JSON as fallback for legacy rows (pre-V2 migration).
                let raw_points_str: String = row.get(19)?;
                let raw_points = if raw_points_str == "[]" || raw_points_str.is_empty() {
                    vec![]
                } else {
                    serde_json::from_str::<Vec<Value>>(&raw_points_str)
                        .unwrap_or_default()
                };

                let calibration_str: Option<String> = row.get(20)?;
                let calibration = calibration_str
                    .and_then(|s| serde_json::from_str::<Value>(&s).ok());

                let extra_fields_str: Option<String> = row.get(35)?;
                let extra_fields = extra_fields_str
                    .and_then(|s| if s == "{}" { None } else { serde_json::from_str::<Value>(&s).ok() });

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
            .and_then(|blob| crate::db::columnar::decode(&blob).ok())
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

                let reagent_descriptor = reagent_name
                    .clone()
                    .map(|name| StoredReagentDescriptor {
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

    let ph: String = std::iter::repeat("?").take(ids.len()).collect::<Vec<_>>().join(",");

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
                (Some(lid), Some(lname)) => Some(StoredExperimentLaboratory { id: lid, name: lname }),
                _ => None,
            };

            let water_params_str: Option<String> = row.get(14)?;
            let water_params =
                water_params_str.and_then(|s| serde_json::from_str::<Value>(&s).ok());

            let metrics_str: String = row.get(18)?;
            let metrics =
                serde_json::from_str::<Value>(&metrics_str).unwrap_or_else(|_| json!({}));

            let raw_points_str: String = row.get(19)?;
            let raw_points = if raw_points_str == "[]" || raw_points_str.is_empty() {
                vec![]
            } else {
                serde_json::from_str::<Vec<Value>>(&raw_points_str).unwrap_or_default()
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
    let blobs_sql = format!(
        "SELECT experimentId, dataBlob FROM ExperimentData WHERE experimentId IN ({ph})"
    );
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
            if let Ok(pts) = crate::db::columnar::decode(&blob) {
                if !pts.is_empty() {
                    exp.raw_points = pts;
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

/// Delete an experiment by primary key.
/// Returns `true` if deleted, `false` if not found.
pub(crate) fn delete_experiment(conn: &rusqlite::Connection, id: &str) -> Result<bool> {
    let deleted = conn
        .execute("DELETE FROM Experiment WHERE id = ?1", params![id])
        .map_err(|e| format!("SQL error: {}", e))?;

    if deleted > 0 {
        // CRITICAL-2a: Explicit cleanup for pre-V10 databases without FK CASCADE.
        conn.execute(
            "DELETE FROM ExperimentData WHERE experimentId = ?1",
            params![id],
        )
        .map_err(|e| format!("SQL error (ExperimentData cleanup): {}", e))?;
    }

    Ok(deleted > 0)
}
