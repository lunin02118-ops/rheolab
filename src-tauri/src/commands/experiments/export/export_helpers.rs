//! Internal helpers for the export commands.

use crate::error::Result;
use serde_json::Value;
use super::super::types::*;

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

// NOTE: `load_all_experiments` (the non-streaming full-Vec loader) was removed
// together with the orphan `experiments_export` command.  Streaming export
// (`experiments_export_to_file`) uses `load_experiment_batch_no_raw` +
// `load_experiment_data_blobs` per 50-item chunk.
