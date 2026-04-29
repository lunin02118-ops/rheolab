use crate::commands::experiments::helpers::{
    calculate_avg_temperature_c, calculate_duration_seconds, calculate_max_temperature_c,
    now_rfc3339, short_hash,
};
use crate::commands::experiments::types::{StoredExperiment, LOCAL_USER_ID};
use crate::error::Result;
use rusqlite::params;

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
    let metrics_json = serde_json::to_string(&exp.metrics).unwrap_or_else(|_| "{}".to_string());
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

    if let Err(e) = invalidate_analysis_artifacts_for_experiment(conn, &exp.id) {
        tracing::warn!(
            "analysis artifact cache invalidation failed for {}: {}",
            exp.id,
            e
        );
    }

    // PR2: Precompute touch-point metrics under the fixed library contract
    // (threshold = 50 cP, target_time = 10 min) so the experiment-library
    // filter sidebar can answer range queries without rescanning the
    // columnar blob. Failure is logged but non-fatal: the backfill task
    // will retry on next startup.
    if let Err(e) =
        crate::db::touch_point_precompute::update_touch_point_row(conn, &exp.id, &exp.raw_points)
    {
        tracing::warn!(
            "touch-point precompute (save-path) failed for {}: {}",
            exp.id,
            e
        );
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
            .or_else(|| reagent.reagent.as_ref().and_then(|d| d.category.clone()));

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

    if let Err(e) = crate::db::repositories::experiment_projection::upsert_projection_for_experiment(
        conn, &exp.id,
    ) {
        tracing::warn!(
            "experiment list projection update failed for {}: {}",
            exp.id,
            e
        );
    }

    Ok(())
}

fn invalidate_analysis_artifacts_for_experiment(
    conn: &rusqlite::Connection,
    experiment_id: &str,
) -> Result<()> {
    match conn.execute(
        "DELETE FROM AnalysisArtifact WHERE experimentId = ?1",
        params![experiment_id],
    ) {
        Ok(_) => Ok(()),
        Err(error)
            if error
                .to_string()
                .contains("no such table: AnalysisArtifact") =>
        {
            Ok(())
        }
        Err(error) => Err(format!("SQL error (analysis artifact invalidation): {}", error).into()),
    }
}
