//! List, count, and filter commands for experiments.

use super::types::*;
use crate::error::Result;
use crate::state::AppState;
use rusqlite::params;
use rusqlite::OptionalExtension;
use std::sync::LazyLock;
use std::time::{Duration, Instant};
use tauri::State;

mod dynamic;
mod query;
pub(crate) use query::query_experiments_list_sql;

/// 30-second TTL in-memory cache for `experiments_filter_metadata`.
/// Avoids 8 sequential `SELECT DISTINCT` round-trips on every filter-panel refresh.
static FILTER_META_CACHE: LazyLock<
    std::sync::Mutex<Option<(Instant, ExperimentsFilterMetadataResponse)>>,
> = LazyLock::new(|| std::sync::Mutex::new(None));

const FILTER_META_TTL: Duration = Duration::from_secs(30);

/// Invalidate the filter-metadata cache.
/// Must be called after any write that changes distinct column values
/// (instrument type, fluid type, geometry, field name, water source, etc.).
pub(crate) fn invalidate_filter_metadata_cache() {
    if let Ok(mut guard) = FILTER_META_CACHE.lock() {
        *guard = None;
    }
}

/// Compute library-wide touch-point coverage / range stats.
///
/// Single aggregate scan of `Experiment` — cheap for any realistic library
/// (the cost is proportional to row count and stays under ~10 ms at 10 k
/// rows on a warm cache).  Results feed the UI's range hints and contextual
/// empty state so users understand why a touch-point filter narrows to zero.
///
/// Extracted into a free function (rather than inlined into
/// `experiments_filter_metadata`) so the unit-test harness can call it
/// without spinning up a `tauri::State` — see `list_tests` for the
/// corresponding assertions.
pub(crate) fn query_touch_point_stats(
    conn: &rusqlite::Connection,
) -> Result<TouchPointLibraryStats> {
    let stats = conn.query_row(
        "SELECT \
           COUNT(*) AS total, \
           COALESCE(SUM(CASE WHEN touchHasCrossing = 1 THEN 1 ELSE 0 END), 0) AS with_crossing, \
           COALESCE(SUM(CASE WHEN touchViscosityAtTargetCp IS NOT NULL THEN 1 ELSE 0 END), 0) AS with_target, \
           MIN(touchCrossingTimeMin), MAX(touchCrossingTimeMin), \
           MIN(touchCrossingViscosityCp), MAX(touchCrossingViscosityCp), \
           MIN(touchViscosityAtTargetCp), MAX(touchViscosityAtTargetCp) \
         FROM Experiment",
        [],
        |row| {
            Ok(TouchPointLibraryStats {
                total_experiments: row.get::<_, i64>(0)? as usize,
                with_crossing_count: row.get::<_, i64>(1)? as usize,
                with_target_viscosity_count: row.get::<_, i64>(2)? as usize,
                crossing_time_min_minutes: row.get::<_, Option<f64>>(3)?,
                crossing_time_max_minutes: row.get::<_, Option<f64>>(4)?,
                crossing_viscosity_min_cp: row.get::<_, Option<f64>>(5)?,
                crossing_viscosity_max_cp: row.get::<_, Option<f64>>(6)?,
                viscosity_at_target_min_cp: row.get::<_, Option<f64>>(7)?,
                viscosity_at_target_max_cp: row.get::<_, Option<f64>>(8)?,
            })
        },
    )?;
    Ok(stats)
}

#[tauri::command]
pub async fn experiments_list(
    app: tauri::AppHandle,
    query: Option<ExperimentsListQuery>,
) -> Result<ExperimentsListResponse> {
    let query = query.unwrap_or(ExperimentsListQuery {
        page: Some(1),
        limit: Some(20),
        laboratory_id: None,
        search_query: None,
        test_name: None,
        laboratory_name: None,
        field_name: None,
        operator_name: None,
        well_number: None,
        water_source: None,
        fluid_type: None,
        instrument_type: None,
        geometry: None,
        batch_number: None,
        reagent_name: None,
        reagent_names: None,
        date_from: None,
        date_to: None,
        duration_min: None,
        duration_max: None,
        temp_min: None,
        temp_max: None,
        viscosity_min: None,
        viscosity_max: None,
        test_category: None,
        test_type: None,
        crossing_time_min: None,
        crossing_time_max: None,
        crossing_viscosity_min: None,
        crossing_viscosity_max: None,
        viscosity_at_target_min: None,
        viscosity_at_target_max: None,
        has_crossing: None,
        viscosity_threshold: None,
        after_id: None,
        sort_by: None,
        sort_dir: None,
    });

    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).clamp(1, 500);

    // Move the potentially heavy query (especially the dynamic-threshold
    // slow path with rayon blob decode) into a controlled blocking task
    // so it never occupies a tokio worker thread.
    let (experiments, total) = tokio::task::spawn_blocking(move || {
        use tauri::Manager as _;
        let state = app.state::<AppState>();
        query_experiments_list_sql(&state, &query)
    })
    .await??;

    let total_pages = if total == 0 {
        0
    } else {
        ((total as f64) / (limit as f64)).ceil() as usize
    };

    // Return last item's ID as next cursor for client-side keyset pagination.
    // When the returned page is full (== limit), there may be more results.
    let next_cursor = if experiments.len() == limit {
        experiments.last().map(|e| e.id.clone())
    } else {
        None
    };

    Ok(ExperimentsListResponse {
        experiments,
        pagination: ExperimentsPagination {
            page,
            limit,
            total,
            total_pages,
            next_cursor,
        },
    })
}

#[tauri::command]
pub async fn experiments_count(state: State<'_, AppState>) -> Result<ExperimentsCountResponse> {
    let conn = state.pool_conn()?;
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM Experiment", [], |row| row.get(0))?;
    Ok(ExperimentsCountResponse {
        count: count as usize,
    })
}

#[tauri::command]
pub async fn experiments_last_context(state: State<'_, AppState>) -> Result<LastContextResponse> {
    let conn = state.pool_conn()?;

    // Find the most recently created experiment
    let row = conn
        .query_row(
            "SELECT e.id, e.fieldName, e.operatorName, e.waterSource \
             FROM Experiment e \
             ORDER BY e.createdAt DESC \
             LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()?;

    let Some((exp_id, field_name, operator_name, water_source)) = row else {
        return Ok(LastContextResponse {
            field_name: None,
            operator_name: None,
            water_source: None,
            reagents: vec![],
        });
    };

    // Load reagents for that experiment
    let mut stmt = conn.prepare(
        "SELECT er.reagentId, er.reagentName, er.concentration, er.unit, \
                    er.batchNumber, er.productionDate, \
                    rc.name \
             FROM ExperimentReagent er \
             LEFT JOIN ReagentCatalog rc ON er.reagentId = rc.id \
             WHERE er.experimentId = ?1",
    )?;

    let reagents: Vec<LastContextReagent> = stmt
        .query_map(params![exp_id], |row| {
            let reagent_id: Option<String> = row.get(0)?;
            let denorm_name: Option<String> = row.get(1)?;
            let catalog_name: Option<String> = row.get(6)?;
            let reagent_name = catalog_name.or(denorm_name).unwrap_or_default();

            Ok(LastContextReagent {
                reagent_id: reagent_id.unwrap_or_default(),
                reagent_name,
                concentration: row.get(2)?,
                unit: row.get(3)?,
                batch_number: row.get(4)?,
                production_date: row.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(LastContextResponse {
        field_name,
        operator_name,
        water_source: Some(water_source),
        reagents,
    })
}

#[tauri::command]
pub async fn experiments_water_sources(state: State<'_, AppState>) -> Result<WaterSourcesResponse> {
    let conn = state.pool_conn()?;

    let mut stmt = conn.prepare(
        "SELECT DISTINCT waterSource FROM Experiment \
             WHERE waterSource IS NOT NULL AND TRIM(waterSource) != '' \
             ORDER BY createdAt DESC \
             LIMIT 50",
    )?;

    let water_sources: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(WaterSourcesResponse { water_sources })
}

#[tauri::command]
pub async fn experiments_filter_metadata(
    state: State<'_, AppState>,
) -> Result<ExperimentsFilterMetadataResponse> {
    // Serve cached value when still fresh — avoids 8 sequential SELECT DISTINCT per call.
    if let Ok(guard) = FILTER_META_CACHE.lock() {
        if let Some((ts, ref cached)) = *guard {
            if ts.elapsed() < FILTER_META_TTL {
                return Ok(cached.clone());
            }
        }
    }

    let conn = state.pool_conn()?;

    if let Some(result) =
        crate::db::repositories::experiment_projection::filter_metadata_from_facet_cache(&conn)?
    {
        if let Ok(mut guard) = FILTER_META_CACHE.lock() {
            *guard = Some((Instant::now(), result.clone()));
        }
        return Ok(result);
    }

    fn query_distinct(conn: &rusqlite::Connection, sql: &str) -> Result<Vec<String>> {
        let mut stmt = conn.prepare(sql)?;
        let values: Vec<String> = stmt
            .query_map([], |row| row.get::<_, Option<String>>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .flatten()
            .filter(|v| !v.trim().is_empty())
            .collect();
        Ok(values)
    }

    let instrument_types = query_distinct(
        &conn,
        "SELECT DISTINCT instrumentType FROM Experiment WHERE instrumentType IS NOT NULL ORDER BY instrumentType COLLATE NOCASE",
    )?;

    let fluid_types = query_distinct(
        &conn,
        "SELECT DISTINCT fluidType FROM Experiment WHERE fluidType IS NOT NULL ORDER BY fluidType COLLATE NOCASE",
    )?;

    let geometries = query_distinct(
        &conn,
        "SELECT DISTINCT geometry FROM Experiment WHERE geometry IS NOT NULL AND TRIM(geometry) != '' ORDER BY geometry COLLATE NOCASE",
    )?;

    let field_names = query_distinct(
        &conn,
        "SELECT DISTINCT fieldName FROM Experiment WHERE fieldName IS NOT NULL AND TRIM(fieldName) != '' ORDER BY fieldName COLLATE NOCASE",
    )?;

    let water_sources = query_distinct(
        &conn,
        "SELECT DISTINCT waterSource FROM Experiment WHERE waterSource IS NOT NULL AND TRIM(waterSource) != '' ORDER BY waterSource COLLATE NOCASE",
    )?;

    let laboratory_names = query_distinct(
        &conn,
        "SELECT DISTINCT l.name FROM Laboratory l INNER JOIN Experiment e ON e.laboratoryId = l.id WHERE l.name IS NOT NULL AND TRIM(l.name) != '' ORDER BY l.name COLLATE NOCASE",
    )?;

    let reagent_names = query_distinct(
        &conn,
        "SELECT DISTINCT COALESCE(rc.name, er.reagentName) AS rname \
         FROM ExperimentReagent er \
         LEFT JOIN ReagentCatalog rc ON er.reagentId = rc.id \
         WHERE rname IS NOT NULL AND TRIM(rname) != '' \
         ORDER BY rname COLLATE NOCASE",
    )?;

    let test_categories = query_distinct(
        &conn,
        "SELECT DISTINCT testCategory FROM Experiment WHERE testCategory IS NOT NULL AND TRIM(testCategory) != '' ORDER BY testCategory COLLATE NOCASE",
    )?;

    let test_types = query_distinct(
        &conn,
        "SELECT DISTINCT testType FROM Experiment WHERE testType IS NOT NULL AND TRIM(testType) != '' ORDER BY testType COLLATE NOCASE",
    )?;

    let touch_point_stats = query_touch_point_stats(&conn)?;

    let result = ExperimentsFilterMetadataResponse {
        instrument_types,
        fluid_types,
        geometries,
        reagent_names,
        laboratory_names,
        field_names,
        water_sources,
        test_categories,
        test_types,
        touch_point_stats,
    };

    // Populate cache for subsequent calls within the TTL window.
    if let Ok(mut guard) = FILTER_META_CACHE.lock() {
        *guard = Some((Instant::now(), result.clone()));
    }

    Ok(result)
}

#[cfg(test)]
#[path = "list_tests/mod.rs"]
mod tests;
