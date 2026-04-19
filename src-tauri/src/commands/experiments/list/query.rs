use crate::error::Result;
use crate::state::AppState;
use rusqlite::params;
use rusqlite::OptionalExtension;
use serde_json::Value;
use super::super::types::*;
use super::super::helpers::*;

/// Build dynamic WHERE clause from `ExperimentsListQuery`, execute SQL-based
/// list query with ORDER BY + LIMIT/OFFSET, and return lightweight items
/// excluding rawPoints/metrics/calibration.
pub(crate) fn query_experiments_list_sql(
    state: &AppState,
    query: &ExperimentsListQuery,
) -> Result<(Vec<ExperimentListItem>, usize)> {
    let conn = state.pool_conn()?;

    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    // Helper macro for LIKE %value% filters
    macro_rules! add_like {
        ($col:expr, $val:expr) => {
            if let Some(ref v) = $val {
                let v = v.trim();
                if !v.is_empty() {
                    conditions.push(format!("{} LIKE ? COLLATE NOCASE", $col));
                    params.push(Box::new(format!("%{}%", v)));
                }
            }
        };
    }

    // Exact match filters
    if let Some(ref lab_id) = query.laboratory_id {
        let lab_id = lab_id.trim();
        if !lab_id.is_empty() {
            conditions.push("e.laboratoryId = ?".to_string());
            params.push(Box::new(lab_id.to_string()));
        }
    }
    // LIKE contains filters on Experiment columns
    add_like!("e.name", query.test_name);
    add_like!("e.fieldName", query.field_name);
    add_like!("e.operatorName", query.operator_name);
    add_like!("e.wellNumber", query.well_number);
    add_like!("e.waterSource", query.water_source);
    add_like!("e.fluidType", query.fluid_type);
    add_like!("e.geometry", query.geometry);
    add_like!("l.name", query.laboratory_name);

    // instrumentType — all whitespace-separated words must match
    if let Some(ref instrument) = query.instrument_type {
        let instrument = instrument.trim();
        if !instrument.is_empty() {
            for part in instrument.split_whitespace() {
                conditions.push("e.instrumentType LIKE ? COLLATE NOCASE".to_string());
                params.push(Box::new(format!("%{}%", part)));
            }
        }
    }

    // Date range (compare YYYY-MM-DD prefix of testDate)
    if let Some(ref d) = query.date_from {
        let d = d.trim();
        if !d.is_empty() {
            conditions.push("e.testDate >= ?".to_string());
            params.push(Box::new(d.to_string()));
        }
    }
    if let Some(ref d) = query.date_to {
        let d = d.trim();
        if !d.is_empty() {
            conditions.push("e.testDate <= ?".to_string());
            params.push(Box::new(format!("{}T23:59:59.999Z", d)));
        }
    }

    // Duration range (frontend sends minutes, DB stores seconds)
    if let Some(ref v) = query.duration_min {
        if let Some(min) = parse_number_from_str(v) {
            conditions.push("e.durationSeconds >= ?".to_string());
            params.push(Box::new(min * 60.0));
        }
    }
    if let Some(ref v) = query.duration_max {
        if let Some(max) = parse_number_from_str(v) {
            conditions.push("e.durationSeconds <= ?".to_string());
            params.push(Box::new(max * 60.0));
        }
    }

    // Temperature range
    if let Some(ref v) = query.temp_min {
        if let Some(min) = parse_number_from_str(v) {
            conditions.push("e.avgTemperatureC >= ?".to_string());
            params.push(Box::new(min));
        }
    }
    if let Some(ref v) = query.temp_max {
        if let Some(max) = parse_number_from_str(v) {
            conditions.push("e.avgTemperatureC <= ?".to_string());
            params.push(Box::new(max));
        }
    }

    // Viscosity range
    if let Some(ref v) = query.viscosity_min {
        if let Some(min) = parse_number_from_str(v) {
            conditions.push("COALESCE(e.maxViscosity, 0) >= ?".to_string());
            params.push(Box::new(min as i64));
        }
    }
    if let Some(ref v) = query.viscosity_max {
        if let Some(max) = parse_number_from_str(v) {
            conditions.push("COALESCE(e.maxViscosity, 0) <= ?".to_string());
            params.push(Box::new(max as i64));
        }
    }

    // Test category (exact match)
    if let Some(ref tc) = query.test_category {
        let tc = tc.trim();
        if !tc.is_empty() {
            conditions.push("e.testCategory = ?".to_string());
            params.push(Box::new(tc.to_string()));
        }
    }

    // Test type (exact match)
    if let Some(ref tt) = query.test_type {
        let tt = tt.trim();
        if !tt.is_empty() {
            conditions.push("e.testType = ?".to_string());
            params.push(Box::new(tt.to_string()));
        }
    }

    // Reagent name (EXISTS subquery across ExperimentReagent + ReagentCatalog)
    if let Some(ref rn) = query.reagent_name {
        let rn = rn.trim();
        if !rn.is_empty() {
            conditions.push(
                "EXISTS (SELECT 1 FROM ExperimentReagent er \
                 LEFT JOIN ReagentCatalog rc ON er.reagentId = rc.id \
                 WHERE er.experimentId = e.id \
                 AND (er.reagentName LIKE ? COLLATE NOCASE OR rc.name LIKE ? COLLATE NOCASE))"
                    .to_string(),
            );
            let pat = format!("{}%", rn);
            params.push(Box::new(pat.clone()));
            params.push(Box::new(pat));
        }
    }

    // Multiple reagent names — AND semantics: experiment must contain ALL of the selected reagents
    if let Some(ref names) = query.reagent_names {
        for rn in names.iter().map(|s| s.trim()).filter(|s| !s.is_empty()) {
            conditions.push(
                "EXISTS (SELECT 1 FROM ExperimentReagent er \
                 LEFT JOIN ReagentCatalog rc ON er.reagentId = rc.id \
                 WHERE er.experimentId = e.id \
                 AND (er.reagentName LIKE ? COLLATE NOCASE OR rc.name LIKE ? COLLATE NOCASE))"
                    .to_string(),
            );
            let pat = format!("{}%", rn);
            params.push(Box::new(pat.clone()));
            params.push(Box::new(pat));
        }
    }

    // Batch number (EXISTS subquery)
    if let Some(ref bn) = query.batch_number {
        let bn = bn.trim();
        if !bn.is_empty() {
            conditions.push(
                "EXISTS (SELECT 1 FROM ExperimentReagent er \
                 WHERE er.experimentId = e.id \
                 AND er.batchNumber LIKE ? COLLATE NOCASE)"
                    .to_string(),
            );
            params.push(Box::new(format!("%{}%", bn)));
        }
    }

    // Full-text search — use FTS5 index when available, fall back to multi-LIKE
    if let Some(ref search) = query.search_query {
        let s = search.trim();
        if !s.is_empty() {
            // Tokenise the query: split on whitespace and suffix each word with *
            // so "pump fluid" matches "pump station" + "fluid viscosity" records.
            let fts_query: String = s
                .split_whitespace()
                .map(|w| {
                    // Escape FTS5 special chars to avoid parse errors
                    let escaped = w.replace('"', "\"\"");
                    format!("\"{}\"*", escaped)
                })
                .collect::<Vec<_>>()
                .join(" ");

            conditions.push(
                "e.rowid IN (SELECT rowid FROM fts_experiment WHERE fts_experiment MATCH ?)".to_string(),
            );
            params.push(Box::new(fts_query));
        }
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    // ── COUNT query ──
    let count_sql = format!(
        "SELECT COUNT(*) FROM Experiment e \
         LEFT JOIN User u ON e.userId = u.id \
         LEFT JOIN Laboratory l ON e.laboratoryId = l.id \
         {}",
        where_clause
    );
    let params_ref: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let total: usize = conn
        .query_row(&count_sql, params_ref.as_slice(), |row| row.get::<_, i64>(0))? as usize;

    if total == 0 {
        return Ok((vec![], 0));
    }

    // ── Pagination ──
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).clamp(1, 500);
    // Resolve sort column + direction from whitelist (no user input in SQL string).
    let sort_col = match query.sort_by.as_deref() {
        Some("name")            => "e.name",
        Some("testDate")        => "e.testDate",
        Some("instrumentType")  => "e.instrumentType",
        Some("geometry")        => "e.geometry",
        Some("fluidType")       => "e.fluidType",
        Some("durationSeconds") => "e.durationSeconds",
        Some("avgTemperatureC") => "e.avgTemperatureC",
        Some("avgViscosity")    => "e.avgViscosity",
        Some("testCategory")    => "e.testCategory",
        Some("testType")        => "e.testType",
        Some("dominantPattern") => "e.dominantPattern",
        _                       => "e.testDate",
    };
    let sort_dir_sql = match query.sort_dir.as_deref() {
        Some("asc") => "ASC",
        _           => "DESC",
    };
    // Keyset cursor: when `after_id` is provided, fetch that row's createdAt,
    // then replace OFFSET with a WHERE condition on createdAt. This eliminates
    // O(k) SQLite full-scan at deep pages.
    let (order_clause, limit_clause) = if let Some(ref aid) = query.after_id {
        // Look up the cursor row's createdAt
        let cursor_at: Option<String> = conn
            .query_row(
                "SELECT createdAt FROM Experiment WHERE id = ?1",
                params![aid],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten();

        if let Some(at) = cursor_at {
            // Add cursor condition using parameterized bindings (no string interpolation)
            let cursor_cond =
                "(e.createdAt < ? OR (e.createdAt = ? AND e.id < ?))".to_string();
            // Prepend cursor condition into existing WHERE
            let existing = conditions.join(" AND ");
            conditions.clear();
            if !existing.is_empty() {
                conditions.push(cursor_cond);
                conditions.push(existing);
            } else {
                conditions.push(cursor_cond);
            }
            // Insert cursor params at front so positions match the ? placeholders
            params.insert(0, Box::new(aid.clone()));
            params.insert(0, Box::new(at.clone()));
            params.insert(0, Box::new(at));
            // Parameterize LIMIT as well
            params.push(Box::new(limit as i64));
            (
                "ORDER BY e.createdAt DESC, e.id DESC".to_string(),
                "LIMIT ?".to_string(),
            )
        } else {
            // Cursor row not found — fall back to offset pagination
            let offset = (page - 1) * limit;
            params.push(Box::new(limit as i64));
            params.push(Box::new(offset as i64));
            (format!("ORDER BY {} {}", sort_col, sort_dir_sql), "LIMIT ? OFFSET ?".to_string())
        }
    } else {
        let offset = (page - 1) * limit;
        params.push(Box::new(limit as i64));
        params.push(Box::new(offset as i64));
        (format!("ORDER BY {} {}", sort_col, sort_dir_sql), "LIMIT ? OFFSET ?".to_string())
    };

    // ── DATA query (excludes rawPoints, metrics, calibration) ──
    // Rebuild where_clause after cursor condition may have updated conditions
    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let data_sql = format!(
        "SELECT e.id, e.createdAt, e.updatedAt, e.name, e.fieldName, e.operatorName, \
                e.wellNumber, e.testId, e.originalFilename, e.testDate, e.instrumentType, \
                e.geometry, e.geometrySource, e.waterSource, e.waterParams, \
                e.fluidType, e.testGroup, e.testSubGroup, e.maxViscosity, \
                e.durationSeconds, e.avgTemperatureC, e.maxTemperatureC, e.avgViscosity, \
                e.userId, e.laboratoryId, \
                u.name, u.email, l.id, l.name, \
                e.testCategory, e.testType, e.dominantPattern \
         FROM Experiment e \
         LEFT JOIN User u ON e.userId = u.id \
         LEFT JOIN Laboratory l ON e.laboratoryId = l.id \
         {} \
         {} \
         {}",
        where_clause, order_clause, limit_clause
    );

    let params_ref: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&data_sql)?;

    let rows: Vec<(String, ExperimentListItem)> = stmt
        .query_map(params_ref.as_slice(), |row| {
            let experiment_id: String = row.get(0)?;
            let user_id: Option<String> = row.get(23)?;
            let user_name: Option<String> = row.get(25)?;
            let user_email: Option<String> = row.get(26)?;
            let lab_id: Option<String> = row.get(27)?;
            let lab_name: Option<String> = row.get(28)?;

            let user = match (user_id, user_name) {
                (Some(id), Some(name)) => Some(StoredExperimentUser {
                    id,
                    name,
                    email: user_email,
                }),
                _ => None,
            };

            let laboratory = match (lab_id, lab_name) {
                (Some(id), Some(name)) => Some(StoredExperimentLaboratory { id, name }),
                _ => None,
            };

            let water_params_str: Option<String> = row.get(14)?;
            let water_params =
                water_params_str.and_then(|s| serde_json::from_str::<Value>(&s).ok());

            Ok((
                experiment_id.clone(),
                ExperimentListItem {
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
                    max_viscosity: row.get(18)?,
                    duration_seconds: row.get(19)?,
                    avg_temperature_c: row.get(20)?,
                    max_temperature_c: row.get(21)?,
                    avg_viscosity: row.get(22)?,
                    test_category: row.get(29)?,
                    test_type: row.get(30)?,
                    dominant_pattern: row.get(31)?,
                    reagents: vec![], // filled below
                    user,
                    laboratory,
                },
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    // Batch-load reagents for the page of experiments
    let exp_ids: Vec<String> = rows.iter().map(|(id, _)| id.clone()).collect();
    let reagents_map = load_reagents_batch(&conn, &exp_ids)?;

    let experiments: Vec<ExperimentListItem> = rows
        .into_iter()
        .map(|(id, mut item)| {
            item.reagents = reagents_map.get(&id).cloned().unwrap_or_default();
            item
        })
        .collect();

    Ok((experiments, total))
}
