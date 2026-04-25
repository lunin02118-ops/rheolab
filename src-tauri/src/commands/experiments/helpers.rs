//! Pure helper functions for experiment commands.

use crate::error::Result;
pub(crate) use crate::utils::time::now_rfc3339;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use super::types::*;

/// Load reagents for a batch of experiment IDs using a single SQL query.
pub(super) fn load_reagents_batch(
    conn: &rusqlite::Connection,
    experiment_ids: &[String],
) -> Result<HashMap<String, Vec<StoredExperimentReagent>>> {
    if experiment_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders: Vec<&str> = experiment_ids.iter().map(|_| "?").collect();
    let sql = format!(
        "SELECT er.experimentId, er.reagentId, er.reagentName, er.concentration, \
                er.unit, er.batchNumber, er.productionDate, er.category, \
                rc.name, rc.category \
         FROM ExperimentReagent er \
         LEFT JOIN ReagentCatalog rc ON er.reagentId = rc.id \
         WHERE er.experimentId IN ({})",
        placeholders.join(", ")
    );

    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> = experiment_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();

    let mut map: HashMap<String, Vec<StoredExperimentReagent>> = HashMap::new();
    stmt.query_map(params.as_slice(), |row| {
        let exp_id: String = row.get(0)?;
        let reagent_id: Option<String> = row.get(1)?;
        let denorm_name: Option<String> = row.get(2)?;
        let catalog_name: Option<String> = row.get(8)?;
        let denorm_category: Option<String> = row.get(7)?;
        let catalog_category: Option<String> = row.get(9)?;

        let reagent_name = catalog_name.or(denorm_name);
        let category = catalog_category.or(denorm_category);

        let reagent_descriptor = reagent_name
            .clone()
            .map(|name| StoredReagentDescriptor {
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
    })?
    .collect::<rusqlite::Result<Vec<_>>>()?
    .into_iter()
    .for_each(|(exp_id, reagent)| {
        map.entry(exp_id).or_default().push(reagent);
    });

    Ok(map)
}

/// Load compressed columnar blobs from `ExperimentData` for a batch of experiment IDs.
/// Returns a map of `experimentId → blob bytes`. IDs that have no row in ExperimentData
/// are simply absent from the map (caller falls back to inline rawPoints).
pub(super) fn load_experiment_data_blobs(
    conn: &rusqlite::Connection,
    experiment_ids: &[String],
) -> Result<HashMap<String, Vec<u8>>> {
    if experiment_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders: Vec<&str> = experiment_ids.iter().map(|_| "?").collect();
    let sql = format!(
        "SELECT experimentId, dataBlob FROM ExperimentData WHERE experimentId IN ({})",
        placeholders.join(", ")
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> = experiment_ids
        .iter()
        .map(|id| id as &dyn rusqlite::ToSql)
        .collect();

    let mut map: HashMap<String, Vec<u8>> = HashMap::new();
    stmt.query_map(params.as_slice(), |row| {
        let id: String = row.get(0)?;
        let blob: Vec<u8> = row.get(1)?;
        Ok((id, blob))
    })?
    .collect::<rusqlite::Result<Vec<_>>>()?
    .into_iter()
    .for_each(|(id, blob)| {
        map.insert(id, blob);
    });

    Ok(map)
}

pub(crate) fn short_hash(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    let digest = hasher.finalize();
    digest
        .iter()
        .take(6)
        .map(|b| format!("{:02x}", b))
        .collect::<String>()
}

pub(super) fn parse_number_from_str(raw: &str) -> Option<f64> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    raw.parse::<f64>().ok()
}

pub(super) fn extract_max_viscosity(metrics: &Value) -> Option<i64> {
    metrics
        .get("maxViscosity")
        .and_then(number_from_json)
        .or_else(|| {
            metrics
                .get("initialViscosity_5_10")
                .and_then(number_from_json)
        })
        .map(|v| v.round() as i64)
}

/// Compute average viscosity from rawPoints JSON.
pub(super) fn extract_avg_viscosity_from_raw(raw_points: &[Value]) -> Option<i64> {
    let mut sum = 0.0_f64;
    let mut count = 0_u64;

    for point in raw_points {
        if let Some(v) = channel_value_from_point(point, VISCOSITY_CHANNEL_ALIASES) {
            if v > 0.0 {
                count += 1;
                sum += v;
            }
        }
    }

    if count == 0 {
        return None;
    }

    Some((sum / count as f64).round() as i64)
}

pub(super) fn number_from_json(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_i64().map(|v| v as f64))
        .or_else(|| value.as_u64().map(|v| v as f64))
        .or_else(|| value.as_str().and_then(|v| v.parse::<f64>().ok()))
}

pub(super) fn parse_json_field(value: Option<&Value>, fallback: Value) -> Value {
    value.map(parse_json_value).unwrap_or(fallback)
}

pub(super) fn parse_json_array_field(value: Option<&Value>) -> Vec<Value> {
    let parsed = value.map(parse_json_value).unwrap_or_else(|| json!([]));
    parsed.as_array().cloned().unwrap_or_default()
}

pub(super) fn parse_json_value(value: &Value) -> Value {
    if let Some(raw) = value.as_str() {
        serde_json::from_str::<Value>(raw).unwrap_or_else(|_| Value::String(raw.to_string()))
    } else {
        value.clone()
    }
}

pub(super) fn parse_import_reagents(value: Option<&Value>) -> Vec<StoredExperimentReagent> {
    value
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|entry| {
            let reagent_name = string_from_path(&entry, &["reagentName"])
                .or_else(|| string_from_path(&entry, &["name"]))
                .or_else(|| string_from_path(&entry, &["reagent", "name"]));

            let category = string_from_path(&entry, &["reagentCategory"])
                .or_else(|| string_from_path(&entry, &["category"]))
                .or_else(|| string_from_path(&entry, &["reagent", "category"]));

            let concentration = entry
                .get("concentration")
                .and_then(number_from_json)
                .unwrap_or(0.0);

            let unit = string_from_path(&entry, &["unit"]).unwrap_or_else(|| "kg/m3".to_string());
            let reagent_id = string_from_path(&entry, &["reagentId"]);
            let batch_number = string_from_path(&entry, &["batchNumber"]);
            let production_date = string_from_path(&entry, &["productionDate"]);

            if reagent_name.is_none() && reagent_id.is_none() {
                return None;
            }

            let reagent = reagent_name.clone().map(|name| StoredReagentDescriptor {
                name,
                category: category.clone(),
            });

            Some(StoredExperimentReagent {
                reagent_id,
                reagent_name,
                concentration,
                unit,
                batch_number,
                production_date,
                category,
                reagent,
            })
        })
        .collect()
}

pub(super) fn string_from_path(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }

    current.as_str().map(|s| s.to_string()).or_else(|| {
        if current.is_null() {
            None
        } else {
            Some(current.to_string())
        }
    })
}

pub(super) fn number_from_path(value: &Value, path: &[&str]) -> Option<f64> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }

    number_from_json(current)
}

// ─────────────────────────────────────────────────────────────────────────────
// Channel alias lookup — single source of truth
// ─────────────────────────────────────────────────────────────────────────────
//
// Raw-point JSON keys appear in two naming conventions in production data:
//   * snake_case (`time_sec`, `viscosity_cp`, `temperature_c`, `shear_rate_s1`)
//     — what the frontend persists today via `parse-normalize.ts` /
//       `experiments/mappers.ts`;
//   * camelCase (`timeSec`, `viscosityCp`, `temperatureC`, `shearRate`) —
//     legacy shape produced by the WASM parser and the TypeScript
//     `ColumnarData` wire format.
//
// Centralising the alias arrays here guarantees every consumer (JSON read
// path, columnar decode path, touch-point precompute, export aggregations,
// …) sees the same list.  Adding a new alias becomes a one-line change.

pub(crate) const TIME_CHANNEL_ALIASES:        &[&str] = &["time_sec",      "timeSec",      "time"];
pub(crate) const VISCOSITY_CHANNEL_ALIASES:   &[&str] = &["viscosity_cp",  "viscosityCp",  "viscosity"];
pub(crate) const TEMPERATURE_CHANNEL_ALIASES: &[&str] = &["temperature_c", "temperatureC", "temperature"];
pub(crate) const SHEAR_RATE_CHANNEL_ALIASES:  &[&str] = &[
    "shear_rate_s1", "shearRateS1",
    "shear_rate",    "shearRate",
];

/// Read a numeric channel from a raw-point JSON object, trying each alias
/// in order. Returns `None` when none of the aliases resolve to a number.
///
/// Replaces the previous `number_from_path(p, &[snake]).or_else(|| number_from_path(p, &[camel]))`
/// pattern that used to be duplicated across every aggregation helper.
pub(crate) fn channel_value_from_point(point: &Value, aliases: &[&str]) -> Option<f64> {
    aliases.iter().find_map(|alias| number_from_path(point, &[*alias]))
}

pub(crate) fn calculate_duration_seconds(raw_points: &[Value]) -> Option<f64> {
    let mut min_time: Option<f64> = None;
    let mut max_time: Option<f64> = None;

    for point in raw_points {
        let Some(time) = channel_value_from_point(point, TIME_CHANNEL_ALIASES) else {
            continue;
        };

        min_time = Some(min_time.map(|current| current.min(time)).unwrap_or(time));
        max_time = Some(max_time.map(|current| current.max(time)).unwrap_or(time));
    }

    match (min_time, max_time) {
        (Some(min_time), Some(max_time)) => Some((max_time - min_time).max(0.0)),
        _ => None,
    }
}

pub(crate) fn calculate_avg_temperature_c(raw_points: &[Value]) -> Option<f64> {
    let mut count = 0_u64;
    let mut sum = 0.0_f64;

    for point in raw_points {
        let Some(temp) = channel_value_from_point(point, TEMPERATURE_CHANNEL_ALIASES) else {
            continue;
        };

        if temp > 0.0 {
            count += 1;
            sum += temp;
        }
    }

    if count == 0 {
        return None;
    }

    Some(sum / count as f64)
}

pub(crate) fn calculate_max_temperature_c(raw_points: &[Value]) -> Option<f64> {
    let mut max_temp: Option<f64> = None;

    for point in raw_points {
        let Some(temp) = channel_value_from_point(point, TEMPERATURE_CHANNEL_ALIASES) else {
            continue;
        };

        if temp > 0.0 {
            max_temp = Some(max_temp.map_or(temp, |current: f64| current.max(temp)));
        }
    }

    max_temp
}

pub(super) fn generate_experiment_id(payload: &ExperimentSavePayload) -> String {
    generate_experiment_id_from_parts(
        &payload.name,
        &payload.original_filename,
        &payload.test_date,
    )
}

pub(super) fn generate_experiment_id_from_parts(
    name: &str,
    original_filename: &str,
    test_date: &str,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(name.as_bytes());
    hasher.update(original_filename.as_bytes());
    hasher.update(test_date.as_bytes());
    hasher.update(now_rfc3339().as_bytes());
    let digest = hasher.finalize();
    let short = digest
        .iter()
        .take(10)
        .map(|b| format!("{:02x}", b))
        .collect::<String>();
    format!("exp_{}", short)
}

// ─────────────────────────────────────────────────────────────────────────────
// Dominant pattern detection
// ─────────────────────────────────────────────────────────────────────────────

/// Compute the dominant cycle pattern (ISO / API / SST / Custom) from raw data points.
///
/// Runs the full schedule-detection pipeline via `rheolab_core` and returns the most
/// frequently occurring `cycle_type` among detected anchor cycles. Returns `None` when
/// the point list is empty or no cycles can be detected.
pub(super) fn compute_dominant_pattern(raw_points: &[serde_json::Value]) -> Option<String> {
    if raw_points.is_empty() {
        return None;
    }

    let points: Vec<rheolab_core::types::RheoPoint> = raw_points
        .iter()
        .filter_map(|v| serde_json::from_value(v.clone()).ok())
        .collect();

    if points.is_empty() {
        return None;
    }

    let steps = rheolab_core::schedule_detector::detect_schedule(
        &points,
        &rheolab_core::schedule_detector::ScheduleConfig::default(),
    );

    // Check SST first — detect_anchor_cycles_internal doesn't recognise this pattern.
    if rheolab_core::is_sst_pattern(&steps) {
        let sst_cycles = rheolab_core::detect_sst_cycles_internal(&steps);
        if !sst_cycles.is_empty() {
            return Some("SST".to_string());
        }
    }

    let cycles = rheolab_core::detect_anchor_cycles_internal(&steps);

    if cycles.is_empty() {
        return None;
    }

    // Return the most frequent cycle_type.
    let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for cycle in &cycles {
        *counts.entry(cycle.cycle_type.clone()).or_insert(0) += 1;
    }
    counts.into_iter()
        .max_by_key(|(_, count)| *count)
        .map(|(ct, _)| ct)
}

#[cfg(test)]
#[path = "helpers_tests.rs"]
mod tests;
