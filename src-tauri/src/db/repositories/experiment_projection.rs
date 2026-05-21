//! Experiment library projection repository.
//!
//! This read model denormalizes the fields needed by the Library list and
//! filter sidebar. The write path keeps new/edited rows current, while the
//! scheduler rebuild job fills existing installs without making migration
//! startup expensive.

use crate::commands::experiments::types::{
    ExperimentListItem, ExperimentsFilterMetadataResponse, ExperimentsListQuery,
    StoredExperimentLaboratory, StoredExperimentReagent, StoredExperimentUser,
    StoredReagentDescriptor, TouchPointLibraryStats,
};
use crate::error::{AppError, Result};
use crate::utils::time::now_rfc3339;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const EXPERIMENT_LIST_PROJECTION_VERSION: i64 = 1;

const META_PROJECTION_VERSION: &str = "projectionVersion";
const META_LAST_FULL_REBUILD_AT: &str = "lastFullRebuildAt";
const META_LAST_FACET_REBUILD_AT: &str = "lastFacetRebuildAt";
const META_FACET_DIRTY: &str = "facetDirty";
const META_ROW_COUNT: &str = "rowCount";

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ExperimentProjectionStatus {
    pub experiment_count: i64,
    pub projection_count: i64,
    pub current_projection_count: i64,
    pub missing_or_stale_count: i64,
    pub facet_count: i64,
    pub facet_dirty: bool,
    pub projection_version: i64,
    pub last_full_rebuild_at: Option<String>,
    pub last_facet_rebuild_at: Option<String>,
    pub ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionRebuildBatchResult {
    pub processed: usize,
    pub last_experiment_id: Option<String>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FacetRebuildResult {
    pub facet_rows: usize,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectionEligibility {
    Projection,
    Fallback(&'static str),
}

pub fn projection_status(conn: &rusqlite::Connection) -> Result<ExperimentProjectionStatus> {
    if !projection_tables_exist(conn)? {
        let experiment_count = count_experiments(conn)?;
        return Ok(ExperimentProjectionStatus {
            experiment_count,
            projection_count: 0,
            current_projection_count: 0,
            missing_or_stale_count: experiment_count,
            facet_count: 0,
            facet_dirty: true,
            projection_version: EXPERIMENT_LIST_PROJECTION_VERSION,
            last_full_rebuild_at: None,
            last_facet_rebuild_at: None,
            ready: experiment_count == 0,
        });
    }

    let experiment_count = count_experiments(conn)?;
    let projection_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM ExperimentListProjection", [], |row| {
            row.get(0)
        })?;
    let current_projection_count: i64 = conn.query_row(
        "SELECT COUNT(*)
         FROM Experiment e
         INNER JOIN ExperimentListProjection p ON p.experimentId = e.id
         WHERE p.projectionVersion = ?1
           AND p.updatedAt = e.updatedAt
           AND p.touchHasCrossing IS e.touchHasCrossing
           AND p.touchCrossingTimeMin IS e.touchCrossingTimeMin
           AND p.touchCrossingViscosityCp IS e.touchCrossingViscosityCp
           AND p.touchViscosityAtTargetCp IS e.touchViscosityAtTargetCp
           AND p.touchPrecomputeVersion IS e.touchPrecomputeVersion",
        params![EXPERIMENT_LIST_PROJECTION_VERSION],
        |row| row.get(0),
    )?;
    let missing_or_stale_count: i64 = conn.query_row(
        "SELECT COUNT(*)
         FROM Experiment e
         LEFT JOIN ExperimentListProjection p ON p.experimentId = e.id
         WHERE p.experimentId IS NULL
            OR p.projectionVersion <> ?1
            OR p.updatedAt <> e.updatedAt
            OR p.touchHasCrossing IS NOT e.touchHasCrossing
            OR p.touchCrossingTimeMin IS NOT e.touchCrossingTimeMin
            OR p.touchCrossingViscosityCp IS NOT e.touchCrossingViscosityCp
            OR p.touchViscosityAtTargetCp IS NOT e.touchViscosityAtTargetCp
            OR p.touchPrecomputeVersion IS NOT e.touchPrecomputeVersion",
        params![EXPERIMENT_LIST_PROJECTION_VERSION],
        |row| row.get(0),
    )?;
    let facet_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM ExperimentFacetCache", [], |row| {
            row.get(0)
        })?;
    let facet_dirty = get_meta(conn, META_FACET_DIRTY)?
        .map(|value| value == "1")
        .unwrap_or(experiment_count > 0 && facet_count == 0);
    let last_full_rebuild_at = get_meta(conn, META_LAST_FULL_REBUILD_AT)?;
    let last_facet_rebuild_at = get_meta(conn, META_LAST_FACET_REBUILD_AT)?;
    let ready = missing_or_stale_count == 0 && current_projection_count == experiment_count;

    Ok(ExperimentProjectionStatus {
        experiment_count,
        projection_count,
        current_projection_count,
        missing_or_stale_count,
        facet_count,
        facet_dirty,
        projection_version: EXPERIMENT_LIST_PROJECTION_VERSION,
        last_full_rebuild_at,
        last_facet_rebuild_at,
        ready,
    })
}

pub fn is_projection_ready(conn: &rusqlite::Connection) -> Result<bool> {
    projection_status(conn).map(|status| status.ready)
}

pub fn can_use_projection(query: &ExperimentsListQuery) -> ProjectionEligibility {
    if has_text(&query.reagent_name)
        || query
            .reagent_names
            .as_ref()
            .is_some_and(|names| names.iter().any(|name| !name.trim().is_empty()))
        || has_text(&query.batch_number)
    {
        return ProjectionEligibility::Fallback("reagent filters remain on legacy path");
    }

    if let Some(threshold) = parse_positive_number(query.viscosity_threshold.as_deref()) {
        if (threshold - 50.0).abs() >= 0.01 {
            return ProjectionEligibility::Fallback(
                "non-default touch threshold requires dynamic/precomputed threshold path",
            );
        }
    }

    ProjectionEligibility::Projection
}

pub fn upsert_projection_for_experiment(
    conn: &rusqlite::Connection,
    experiment_id: &str,
) -> Result<()> {
    match build_projection_for_experiment(conn, experiment_id) {
        Ok(Some(row)) => {
            put_projection_row(conn, &row)?;
            mark_facet_cache_dirty(conn)?;
            Ok(())
        }
        Ok(None) => Ok(()),
        Err(error) if is_missing_projection_table(&error) => Ok(()),
        Err(error) => Err(error),
    }
}

pub fn delete_projection_for_experiment(
    conn: &rusqlite::Connection,
    experiment_id: &str,
) -> Result<usize> {
    match conn.execute(
        "DELETE FROM ExperimentListProjection WHERE experimentId = ?1",
        params![experiment_id],
    ) {
        Ok(deleted) => {
            mark_facet_cache_dirty(conn)?;
            Ok(deleted)
        }
        Err(error) if sqlite_error_mentions(&error, "no such table") => Ok(0),
        Err(error) => Err(error.into()),
    }
}

pub fn rebuild_projection_batch(
    conn: &rusqlite::Connection,
    after_id: Option<&str>,
    limit: usize,
) -> Result<ProjectionRebuildBatchResult> {
    if limit == 0 {
        return Ok(ProjectionRebuildBatchResult {
            processed: 0,
            last_experiment_id: after_id.map(str::to_owned),
            has_more: true,
        });
    }

    let ids = if let Some(after_id) = after_id {
        select_experiment_ids_after(conn, after_id, limit + 1)?
    } else {
        select_experiment_ids(conn, limit + 1)?
    };

    let has_more = ids.len() > limit;
    let page_ids = ids.into_iter().take(limit).collect::<Vec<_>>();
    let mut processed = 0usize;
    let mut last_experiment_id = None;

    for id in page_ids {
        upsert_projection_for_experiment(conn, &id)?;
        processed += 1;
        last_experiment_id = Some(id);
    }

    if processed > 0 {
        set_meta(
            conn,
            META_PROJECTION_VERSION,
            &EXPERIMENT_LIST_PROJECTION_VERSION.to_string(),
        )?;
        set_meta(conn, META_ROW_COUNT, &count_experiments(conn)?.to_string())?;
    }

    Ok(ProjectionRebuildBatchResult {
        processed,
        last_experiment_id,
        has_more,
    })
}

pub fn mark_full_rebuild_complete(conn: &rusqlite::Connection) -> Result<()> {
    let now = now_rfc3339();
    set_meta(conn, META_LAST_FULL_REBUILD_AT, &now)?;
    set_meta(
        conn,
        META_PROJECTION_VERSION,
        &EXPERIMENT_LIST_PROJECTION_VERSION.to_string(),
    )?;
    set_meta(conn, META_ROW_COUNT, &count_experiments(conn)?.to_string())?;
    Ok(())
}

pub fn rebuild_facet_cache(conn: &rusqlite::Connection) -> Result<FacetRebuildResult> {
    if !projection_tables_exist(conn)? {
        return Ok(FacetRebuildResult {
            facet_rows: 0,
            updated_at: now_rfc3339(),
        });
    }

    let now = now_rfc3339();
    conn.execute("DELETE FROM ExperimentFacetCache", [])?;

    for (facet_name, column) in [
        ("instrumentType", "instrumentType"),
        ("fluidType", "fluidType"),
        ("geometry", "geometry"),
        ("fieldName", "fieldName"),
        ("waterSource", "waterSource"),
        ("laboratoryName", "laboratoryName"),
        ("testCategory", "testCategory"),
        ("testType", "testType"),
        ("dominantPattern", "dominantPattern"),
    ] {
        insert_projection_facet(conn, facet_name, column, &now)?;
    }
    insert_reagent_facet(conn, &now)?;

    let facet_rows: i64 =
        conn.query_row("SELECT COUNT(*) FROM ExperimentFacetCache", [], |row| {
            row.get(0)
        })?;

    set_meta(conn, META_LAST_FACET_REBUILD_AT, &now)?;
    set_meta(conn, META_FACET_DIRTY, "0")?;

    Ok(FacetRebuildResult {
        facet_rows: facet_rows as usize,
        updated_at: now,
    })
}

pub fn mark_facet_cache_dirty(conn: &rusqlite::Connection) -> Result<()> {
    match set_meta(conn, META_FACET_DIRTY, "1") {
        Ok(()) => Ok(()),
        Err(error) if is_missing_projection_table(&error) => Ok(()),
        Err(error) => Err(error),
    }
}

pub fn filter_metadata_from_facet_cache(
    conn: &rusqlite::Connection,
) -> Result<Option<ExperimentsFilterMetadataResponse>> {
    let status = projection_status(conn)?;
    if !status.ready {
        return Ok(None);
    }
    if status.facet_dirty || (status.experiment_count > 0 && status.facet_count == 0) {
        rebuild_facet_cache(conn)?;
    }

    Ok(Some(ExperimentsFilterMetadataResponse {
        instrument_types: facet_values(conn, "instrumentType")?,
        fluid_types: facet_values(conn, "fluidType")?,
        geometries: facet_values(conn, "geometry")?,
        reagent_names: facet_values(conn, "reagentName")?,
        laboratory_names: facet_values(conn, "laboratoryName")?,
        field_names: facet_values(conn, "fieldName")?,
        water_sources: facet_values(conn, "waterSource")?,
        test_categories: facet_values(conn, "testCategory")?,
        test_types: facet_values(conn, "testType")?,
        touch_point_stats: query_touch_point_stats_projection(conn)?,
    }))
}

pub fn query_experiments_list_projection(
    conn: &rusqlite::Connection,
    query: &ExperimentsListQuery,
) -> Result<(Vec<ExperimentListItem>, usize)> {
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    append_projection_conditions(query, &mut conditions, &mut params);
    append_projection_touch_conditions(query, &mut conditions, &mut params);

    let where_clause = build_where_clause(&conditions);
    let params_ref: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let total: usize = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM ExperimentListProjection p {}",
            where_clause
        ),
        params_ref.as_slice(),
        |row| row.get::<_, i64>(0),
    )? as usize;

    if total == 0 {
        return Ok((vec![], 0));
    }

    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).clamp(1, 500);
    let sort_col = projection_sort_column(query.sort_by.as_deref());
    let sort_dir_sql = match query.sort_dir.as_deref() {
        Some("asc") => "ASC",
        _ => "DESC",
    };

    let (order_clause, limit_clause) = if let Some(ref aid) = query.after_id {
        let cursor_at: Option<String> = conn
            .query_row(
                "SELECT createdAt FROM ExperimentListProjection WHERE experimentId = ?1",
                params![aid],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten();

        if let Some(at) = cursor_at {
            let existing = conditions.join(" AND ");
            conditions.clear();
            conditions
                .push("(p.createdAt < ? OR (p.createdAt = ? AND p.experimentId < ?))".to_string());
            if !existing.is_empty() {
                conditions.push(existing);
            }
            params.insert(0, Box::new(aid.clone()));
            params.insert(0, Box::new(at.clone()));
            params.insert(0, Box::new(at));
            params.push(Box::new(limit as i64));
            (
                "ORDER BY p.createdAt DESC, p.experimentId DESC".to_string(),
                "LIMIT ?".to_string(),
            )
        } else {
            let offset = (page - 1) * limit;
            params.push(Box::new(limit as i64));
            params.push(Box::new(offset as i64));
            (
                format!("ORDER BY {} {}", sort_col, sort_dir_sql),
                "LIMIT ? OFFSET ?".to_string(),
            )
        }
    } else {
        let offset = (page - 1) * limit;
        params.push(Box::new(limit as i64));
        params.push(Box::new(offset as i64));
        (
            format!("ORDER BY {} {}", sort_col, sort_dir_sql),
            "LIMIT ? OFFSET ?".to_string(),
        )
    };

    let where_clause = build_where_clause(&conditions);
    let params_ref: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let sql = format!(
        "SELECT experimentId, createdAt, updatedAt, testDate, name, originalFilename,
                userId, userName, userEmail, laboratoryId, laboratoryName,
                fieldName, operatorName, wellNumber, testId,
                instrumentType, geometry, geometrySource, waterSource, waterParams, fluidType,
                testGroup, testSubGroup, testCategory, testType, dominantPattern,
                maxViscosity, avgViscosity, durationSeconds, avgTemperatureC, maxTemperatureC,
                touchHasCrossing, touchCrossingTimeMin, touchCrossingViscosityCp,
                touchViscosityAtTargetCp, touchPrecomputeVersion, reagentSummaryJson
         FROM ExperimentListProjection p
         {}
         {}
         {}",
        where_clause, order_clause, limit_clause
    );

    let mut stmt = conn.prepare(&sql)?;
    let experiments = stmt
        .query_map(params_ref.as_slice(), projection_row_to_item)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok((experiments, total))
}

fn build_projection_for_experiment(
    conn: &rusqlite::Connection,
    experiment_id: &str,
) -> Result<Option<ProjectionRow>> {
    let base = conn
        .query_row(
            "SELECT e.id, e.createdAt, e.updatedAt, e.testDate, e.name, e.originalFilename,
                    e.userId, u.name, u.email, e.laboratoryId, l.name,
                    e.fieldName, e.operatorName, e.wellNumber, e.testId,
                    e.instrumentType, e.geometry, e.geometrySource, e.waterSource,
                    e.waterParams, e.fluidType, e.testGroup, e.testSubGroup,
                    e.testCategory, e.testType, e.dominantPattern,
                    e.maxViscosity, e.avgViscosity, e.durationSeconds,
                    e.avgTemperatureC, e.maxTemperatureC,
                    e.touchHasCrossing, e.touchCrossingTimeMin,
                    e.touchCrossingViscosityCp, e.touchViscosityAtTargetCp,
                    e.touchPrecomputeVersion
             FROM Experiment e
             LEFT JOIN User u ON e.userId = u.id
             LEFT JOIN Laboratory l ON e.laboratoryId = l.id
             WHERE e.id = ?1",
            params![experiment_id],
            |row| {
                Ok(ProjectionRow {
                    experiment_id: row.get(0)?,
                    created_at: row.get(1)?,
                    updated_at: row.get(2)?,
                    test_date: row.get(3)?,
                    name: row.get(4)?,
                    original_filename: row.get(5)?,
                    user_id: row.get(6)?,
                    user_name: row.get(7)?,
                    user_email: row.get(8)?,
                    laboratory_id: row.get(9)?,
                    laboratory_name: row.get(10)?,
                    field_name: row.get(11)?,
                    operator_name: row.get(12)?,
                    well_number: row.get(13)?,
                    test_id: row.get(14)?,
                    instrument_type: row.get(15)?,
                    geometry: row.get(16)?,
                    geometry_source: row.get(17)?,
                    water_source: row.get(18)?,
                    water_params: row.get(19)?,
                    fluid_type: row.get(20)?,
                    test_group: row.get(21)?,
                    test_sub_group: row.get(22)?,
                    test_category: row.get(23)?,
                    test_type: row.get(24)?,
                    dominant_pattern: row.get(25)?,
                    max_viscosity: row.get(26)?,
                    avg_viscosity: row.get(27)?,
                    duration_seconds: row.get(28)?,
                    avg_temperature_c: row.get(29)?,
                    max_temperature_c: row.get(30)?,
                    touch_has_crossing: row.get(31)?,
                    touch_crossing_time_min: row.get(32)?,
                    touch_crossing_viscosity_cp: row.get(33)?,
                    touch_viscosity_at_target_cp: row.get(34)?,
                    touch_precompute_version: row.get(35)?,
                    reagent_summary_json: "[]".to_string(),
                    reagent_search_text: String::new(),
                    search_text: String::new(),
                })
            },
        )
        .optional()?;

    let Some(mut projection) = base else {
        return Ok(None);
    };

    let reagents = load_reagents_for_experiment(conn, experiment_id)?;
    projection.reagent_search_text = reagents
        .iter()
        .filter_map(|reagent| reagent.reagent_name.as_deref())
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    projection.reagent_summary_json = serde_json::to_string(&reagents)?;
    projection.search_text = build_search_text(&projection, &reagents);
    Ok(Some(projection))
}

fn put_projection_row(conn: &rusqlite::Connection, row: &ProjectionRow) -> Result<()> {
    let now = now_rfc3339();
    conn.execute(
        "INSERT INTO ExperimentListProjection (
            experimentId, createdAt, updatedAt, testDate, name, originalFilename,
            userId, userName, userEmail, laboratoryId, laboratoryName,
            fieldName, operatorName, wellNumber, testId,
            instrumentType, geometry, geometrySource, waterSource, waterParams, fluidType,
            testGroup, testSubGroup, testCategory, testType, dominantPattern,
            maxViscosity, avgViscosity, durationSeconds, avgTemperatureC, maxTemperatureC,
            touchHasCrossing, touchCrossingTimeMin, touchCrossingViscosityCp,
            touchViscosityAtTargetCp, touchPrecomputeVersion,
            reagentSummaryJson, reagentSearchText, searchText,
            projectionVersion, projectionUpdatedAt
        ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6,
            ?7, ?8, ?9, ?10, ?11,
            ?12, ?13, ?14, ?15,
            ?16, ?17, ?18, ?19, ?20, ?21,
            ?22, ?23, ?24, ?25, ?26,
            ?27, ?28, ?29, ?30, ?31,
            ?32, ?33, ?34, ?35, ?36,
            ?37, ?38, ?39,
            ?40, ?41
        )
        ON CONFLICT(experimentId) DO UPDATE SET
            createdAt = excluded.createdAt,
            updatedAt = excluded.updatedAt,
            testDate = excluded.testDate,
            name = excluded.name,
            originalFilename = excluded.originalFilename,
            userId = excluded.userId,
            userName = excluded.userName,
            userEmail = excluded.userEmail,
            laboratoryId = excluded.laboratoryId,
            laboratoryName = excluded.laboratoryName,
            fieldName = excluded.fieldName,
            operatorName = excluded.operatorName,
            wellNumber = excluded.wellNumber,
            testId = excluded.testId,
            instrumentType = excluded.instrumentType,
            geometry = excluded.geometry,
            geometrySource = excluded.geometrySource,
            waterSource = excluded.waterSource,
            waterParams = excluded.waterParams,
            fluidType = excluded.fluidType,
            testGroup = excluded.testGroup,
            testSubGroup = excluded.testSubGroup,
            testCategory = excluded.testCategory,
            testType = excluded.testType,
            dominantPattern = excluded.dominantPattern,
            maxViscosity = excluded.maxViscosity,
            avgViscosity = excluded.avgViscosity,
            durationSeconds = excluded.durationSeconds,
            avgTemperatureC = excluded.avgTemperatureC,
            maxTemperatureC = excluded.maxTemperatureC,
            touchHasCrossing = excluded.touchHasCrossing,
            touchCrossingTimeMin = excluded.touchCrossingTimeMin,
            touchCrossingViscosityCp = excluded.touchCrossingViscosityCp,
            touchViscosityAtTargetCp = excluded.touchViscosityAtTargetCp,
            touchPrecomputeVersion = excluded.touchPrecomputeVersion,
            reagentSummaryJson = excluded.reagentSummaryJson,
            reagentSearchText = excluded.reagentSearchText,
            searchText = excluded.searchText,
            projectionVersion = excluded.projectionVersion,
            projectionUpdatedAt = excluded.projectionUpdatedAt",
        params![
            &row.experiment_id,
            &row.created_at,
            &row.updated_at,
            &row.test_date,
            &row.name,
            &row.original_filename,
            row.user_id.as_deref(),
            row.user_name.as_deref(),
            row.user_email.as_deref(),
            row.laboratory_id.as_deref(),
            row.laboratory_name.as_deref(),
            row.field_name.as_deref(),
            row.operator_name.as_deref(),
            row.well_number.as_deref(),
            row.test_id.as_deref(),
            &row.instrument_type,
            row.geometry.as_deref(),
            row.geometry_source.as_deref(),
            &row.water_source,
            row.water_params.as_deref(),
            &row.fluid_type,
            &row.test_group,
            row.test_sub_group.as_deref(),
            row.test_category.as_deref(),
            row.test_type.as_deref(),
            row.dominant_pattern.as_deref(),
            row.max_viscosity,
            row.avg_viscosity,
            row.duration_seconds,
            row.avg_temperature_c,
            row.max_temperature_c,
            row.touch_has_crossing,
            row.touch_crossing_time_min,
            row.touch_crossing_viscosity_cp,
            row.touch_viscosity_at_target_cp,
            row.touch_precompute_version,
            &row.reagent_summary_json,
            &row.reagent_search_text,
            &row.search_text,
            EXPERIMENT_LIST_PROJECTION_VERSION,
            &now,
        ],
    )?;
    Ok(())
}

fn append_projection_conditions(
    query: &ExperimentsListQuery,
    conditions: &mut Vec<String>,
    params: &mut Vec<Box<dyn rusqlite::ToSql>>,
) {
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

    if let Some(ref lab_id) = query.laboratory_id {
        let lab_id = lab_id.trim();
        if !lab_id.is_empty() {
            conditions.push("p.laboratoryId = ?".to_string());
            params.push(Box::new(lab_id.to_string()));
        }
    }

    add_like!("p.name", query.test_name);
    add_like!("p.fieldName", query.field_name);
    add_like!("p.operatorName", query.operator_name);
    add_like!("p.wellNumber", query.well_number);
    add_like!("p.waterSource", query.water_source);
    add_like!("p.fluidType", query.fluid_type);
    add_like!("p.geometry", query.geometry);
    add_like!("p.laboratoryName", query.laboratory_name);

    if let Some(ref instrument) = query.instrument_type {
        let instrument = instrument.trim();
        if !instrument.is_empty() {
            for part in instrument.split_whitespace() {
                conditions.push("p.instrumentType LIKE ? COLLATE NOCASE".to_string());
                params.push(Box::new(format!("%{}%", part)));
            }
        }
    }

    if let Some(ref d) = query.date_from {
        let d = d.trim();
        if !d.is_empty() {
            conditions.push("p.testDate >= ?".to_string());
            params.push(Box::new(d.to_string()));
        }
    }
    if let Some(ref d) = query.date_to {
        let d = d.trim();
        if !d.is_empty() {
            conditions.push("p.testDate <= ?".to_string());
            params.push(Box::new(format!("{}T23:59:59.999Z", d)));
        }
    }

    if let Some(min) = parse_positive_or_zero_number(query.duration_min.as_deref()) {
        conditions.push("p.durationSeconds >= ?".to_string());
        params.push(Box::new(min * 60.0));
    }
    if let Some(max) = parse_positive_or_zero_number(query.duration_max.as_deref()) {
        conditions.push("p.durationSeconds <= ?".to_string());
        params.push(Box::new(max * 60.0));
    }
    if let Some(min) = parse_positive_or_zero_number(query.temp_min.as_deref()) {
        conditions.push("p.avgTemperatureC >= ?".to_string());
        params.push(Box::new(min));
    }
    if let Some(max) = parse_positive_or_zero_number(query.temp_max.as_deref()) {
        conditions.push("p.avgTemperatureC <= ?".to_string());
        params.push(Box::new(max));
    }
    if let Some(min) = parse_positive_or_zero_number(query.viscosity_min.as_deref()) {
        conditions.push("COALESCE(p.maxViscosity, 0) >= ?".to_string());
        params.push(Box::new(min as i64));
    }
    if let Some(max) = parse_positive_or_zero_number(query.viscosity_max.as_deref()) {
        conditions.push("COALESCE(p.maxViscosity, 0) <= ?".to_string());
        params.push(Box::new(max as i64));
    }

    if let Some(ref tc) = query.test_category {
        let tc = tc.trim();
        if !tc.is_empty() {
            conditions.push("p.testCategory = ?".to_string());
            params.push(Box::new(tc.to_string()));
        }
    }

    if let Some(ref tt) = query.test_type {
        let tt = tt.trim();
        if !tt.is_empty() {
            conditions.push("p.testType = ?".to_string());
            params.push(Box::new(tt.to_string()));
        }
    }

    if let Some(ref search) = query.search_query {
        let s = search.trim();
        if !s.is_empty() {
            let fts_query = s
                .split_whitespace()
                .map(|w| {
                    let escaped = w.replace('"', "\"\"");
                    format!("\"{}\"*", escaped)
                })
                .collect::<Vec<_>>()
                .join(" ");
            conditions.push(
                "p.experimentId IN (
                    SELECT e.id FROM Experiment e
                    WHERE e.rowid IN (
                        SELECT rowid FROM fts_experiment WHERE fts_experiment MATCH ?
                    )
                 )"
                .to_string(),
            );
            params.push(Box::new(fts_query));
        }
    }
}

fn append_projection_touch_conditions(
    query: &ExperimentsListQuery,
    conditions: &mut Vec<String>,
    params: &mut Vec<Box<dyn rusqlite::ToSql>>,
) {
    if let Some(ref raw) = query.has_crossing {
        match raw.trim().to_ascii_lowercase().as_str() {
            "yes" | "true" | "1" => conditions.push("p.touchHasCrossing = 1".to_string()),
            "no" | "false" | "0" => {
                conditions.push(
                    "(p.touchHasCrossing = 0 AND p.touchHasCrossing IS NOT NULL)".to_string(),
                );
            }
            _ => {}
        }
    }

    if let Some(min) = parse_positive_or_zero_number(query.crossing_time_min.as_deref()) {
        conditions.push("p.touchCrossingTimeMin >= ?".to_string());
        params.push(Box::new(min));
    }
    if let Some(max) = parse_positive_or_zero_number(query.crossing_time_max.as_deref()) {
        conditions.push("p.touchCrossingTimeMin <= ?".to_string());
        params.push(Box::new(max));
    }
    if let Some(min) = parse_positive_or_zero_number(query.crossing_viscosity_min.as_deref()) {
        conditions.push("p.touchCrossingViscosityCp >= ?".to_string());
        params.push(Box::new(min));
    }
    if let Some(max) = parse_positive_or_zero_number(query.crossing_viscosity_max.as_deref()) {
        conditions.push("p.touchCrossingViscosityCp <= ?".to_string());
        params.push(Box::new(max));
    }
    if let Some(min) = parse_positive_or_zero_number(query.viscosity_at_target_min.as_deref()) {
        conditions.push("p.touchViscosityAtTargetCp >= ?".to_string());
        params.push(Box::new(min));
    }
    if let Some(max) = parse_positive_or_zero_number(query.viscosity_at_target_max.as_deref()) {
        conditions.push("p.touchViscosityAtTargetCp <= ?".to_string());
        params.push(Box::new(max));
    }
}

fn projection_row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<ExperimentListItem> {
    let experiment_id: String = row.get(0)?;
    let user_id: Option<String> = row.get(6)?;
    let user_name: Option<String> = row.get(7)?;
    let user_email: Option<String> = row.get(8)?;
    let lab_id: Option<String> = row.get(9)?;
    let lab_name: Option<String> = row.get(10)?;

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

    let water_params_str: Option<String> = row.get(19)?;
    let water_params = water_params_str.and_then(|s| serde_json::from_str::<Value>(&s).ok());
    let touch_has_crossing_raw: Option<i64> = row.get(31)?;
    let reagent_summary_json: String = row.get(36)?;
    let reagents = serde_json::from_str::<Vec<StoredExperimentReagent>>(&reagent_summary_json)
        .unwrap_or_default();

    Ok(ExperimentListItem {
        id: experiment_id,
        created_at: row.get(1)?,
        updated_at: row.get(2)?,
        test_date: row.get(3)?,
        name: row.get(4)?,
        original_filename: row.get(5)?,
        field_name: row.get(11)?,
        operator_name: row.get(12)?,
        well_number: row.get(13)?,
        test_id: row.get(14)?,
        instrument_type: row.get(15)?,
        geometry: row.get(16)?,
        geometry_source: row.get(17)?,
        water_source: row.get(18)?,
        water_params,
        fluid_type: row.get(20)?,
        test_group: row.get(21)?,
        test_sub_group: row.get(22)?,
        test_category: row.get(23)?,
        test_type: row.get(24)?,
        dominant_pattern: row.get(25)?,
        max_viscosity: row.get(26)?,
        avg_viscosity: row.get(27)?,
        duration_seconds: row.get(28)?,
        avg_temperature_c: row.get(29)?,
        max_temperature_c: row.get(30)?,
        touch_has_crossing: touch_has_crossing_raw.map(|value| value != 0),
        touch_crossing_time_min: row.get(32)?,
        touch_crossing_viscosity_cp: row.get(33)?,
        touch_viscosity_at_target_cp: row.get(34)?,
        touch_precompute_version: row.get(35)?,
        reagents,
        user,
        laboratory,
    })
}

fn query_touch_point_stats_projection(
    conn: &rusqlite::Connection,
) -> Result<TouchPointLibraryStats> {
    conn.query_row(
        "SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN touchHasCrossing = 1 THEN 1 ELSE 0 END), 0) AS with_crossing,
           COALESCE(SUM(CASE WHEN touchViscosityAtTargetCp IS NOT NULL THEN 1 ELSE 0 END), 0) AS with_target,
           MIN(touchCrossingTimeMin), MAX(touchCrossingTimeMin),
           MIN(touchCrossingViscosityCp), MAX(touchCrossingViscosityCp),
           MIN(touchViscosityAtTargetCp), MAX(touchViscosityAtTargetCp)
         FROM ExperimentListProjection",
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
    )
    .map_err(Into::into)
}

fn load_reagents_for_experiment(
    conn: &rusqlite::Connection,
    experiment_id: &str,
) -> Result<Vec<StoredExperimentReagent>> {
    let mut stmt = conn.prepare(
        "SELECT er.reagentId, er.reagentName, er.concentration,
                er.unit, er.batchNumber, er.productionDate, er.category,
                rc.name, rc.category
         FROM ExperimentReagent er
         LEFT JOIN ReagentCatalog rc ON er.reagentId = rc.id
         WHERE er.experimentId = ?1
         ORDER BY lower(COALESCE(rc.name, er.reagentName, '')), er.id",
    )?;

    let reagents = stmt
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
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(reagents)
}

fn insert_projection_facet(
    conn: &rusqlite::Connection,
    facet_name: &str,
    column: &str,
    updated_at: &str,
) -> Result<()> {
    let sql = format!(
        "INSERT INTO ExperimentFacetCache(facetName, facetValue, count, sortKey, updatedAt)
         SELECT ?1, {column}, COUNT(*), lower({column}), ?2
         FROM ExperimentListProjection
         WHERE {column} IS NOT NULL AND trim({column}) <> ''
         GROUP BY {column}"
    );
    conn.execute(&sql, params![facet_name, updated_at])?;
    Ok(())
}

fn insert_reagent_facet(conn: &rusqlite::Connection, updated_at: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO ExperimentFacetCache(facetName, facetValue, count, sortKey, updatedAt)
         SELECT 'reagentName',
                COALESCE(rc.name, er.reagentName) AS reagent_name,
                COUNT(DISTINCT er.experimentId),
                lower(COALESCE(rc.name, er.reagentName)),
                ?1
         FROM ExperimentReagent er
         LEFT JOIN ReagentCatalog rc ON er.reagentId = rc.id
         INNER JOIN ExperimentListProjection p ON p.experimentId = er.experimentId
         WHERE reagent_name IS NOT NULL AND trim(reagent_name) <> ''
         GROUP BY reagent_name",
        params![updated_at],
    )?;
    Ok(())
}

fn facet_values(conn: &rusqlite::Connection, facet_name: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT facetValue
         FROM ExperimentFacetCache
         WHERE facetName = ?1
         ORDER BY sortKey COLLATE NOCASE, facetValue COLLATE NOCASE",
    )?;
    let values = stmt
        .query_map(params![facet_name], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(values)
}

fn select_experiment_ids(conn: &rusqlite::Connection, limit: usize) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM Experiment ORDER BY id LIMIT ?1")?;
    let ids = stmt
        .query_map(params![limit as i64], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ids)
}

fn select_experiment_ids_after(
    conn: &rusqlite::Connection,
    after_id: &str,
    limit: usize,
) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT id FROM Experiment WHERE id > ?1 ORDER BY id LIMIT ?2")?;
    let ids = stmt
        .query_map(params![after_id, limit as i64], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(ids)
}

fn projection_tables_exist(conn: &rusqlite::Connection) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master
         WHERE type = 'table' AND name IN (
            'ExperimentListProjection',
            'ExperimentFacetCache',
            'ExperimentProjectionMeta'
         )",
        [],
        |row| row.get(0),
    )?;
    Ok(count == 3)
}

fn count_experiments(conn: &rusqlite::Connection) -> Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM Experiment", [], |row| row.get(0))
        .map_err(Into::into)
}

fn get_meta(conn: &rusqlite::Connection, key: &str) -> Result<Option<String>> {
    match conn
        .query_row(
            "SELECT value FROM ExperimentProjectionMeta WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
    {
        Ok(value) => Ok(value),
        Err(error) if sqlite_error_mentions(&error, "no such table") => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn set_meta(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO ExperimentProjectionMeta(key, value, updatedAt)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updatedAt = excluded.updatedAt",
        params![key, value, now_rfc3339()],
    )?;
    Ok(())
}

fn build_where_clause(conditions: &[String]) -> String {
    if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    }
}

fn projection_sort_column(sort_by: Option<&str>) -> &'static str {
    match sort_by {
        Some("name") => "p.name",
        Some("testDate") => "p.testDate",
        Some("instrumentType") => "p.instrumentType",
        Some("geometry") => "p.geometry",
        Some("fluidType") => "p.fluidType",
        Some("durationSeconds") => "p.durationSeconds",
        Some("avgTemperatureC") => "p.avgTemperatureC",
        Some("avgViscosity") => "p.avgViscosity",
        Some("testCategory") => "p.testCategory",
        Some("testType") => "p.testType",
        Some("dominantPattern") => "p.dominantPattern",
        _ => "p.testDate",
    }
}

fn parse_positive_number(raw: Option<&str>) -> Option<f64> {
    raw.and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
}

fn parse_positive_or_zero_number(raw: Option<&str>) -> Option<f64> {
    raw.and_then(|value| {
        let value = value.trim();
        if value.is_empty() {
            None
        } else {
            value.parse::<f64>().ok()
        }
    })
    .filter(|value| value.is_finite())
}

fn has_text(value: &Option<String>) -> bool {
    value.as_ref().is_some_and(|value| !value.trim().is_empty())
}

fn build_search_text(row: &ProjectionRow, reagents: &[StoredExperimentReagent]) -> String {
    let mut parts = vec![
        Some(row.name.as_str()),
        Some(row.original_filename.as_str()),
        row.field_name.as_deref(),
        row.operator_name.as_deref(),
        row.well_number.as_deref(),
        row.test_id.as_deref(),
        Some(row.water_source.as_str()),
        Some(row.instrument_type.as_str()),
        row.geometry.as_deref(),
        Some(row.fluid_type.as_str()),
        row.test_category.as_deref(),
        row.test_type.as_deref(),
        row.dominant_pattern.as_deref(),
        row.laboratory_name.as_deref(),
    ];
    for reagent in reagents {
        parts.push(reagent.reagent_name.as_deref());
        parts.push(reagent.batch_number.as_deref());
    }

    parts
        .into_iter()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn is_missing_projection_table(error: &AppError) -> bool {
    matches!(error, AppError::Sql(sqlite) if sqlite_error_mentions(sqlite, "no such table"))
}

fn sqlite_error_mentions(error: &rusqlite::Error, needle: &str) -> bool {
    error.to_string().to_ascii_lowercase().contains(needle)
}

#[derive(Debug, Clone)]
struct ProjectionRow {
    experiment_id: String,
    created_at: String,
    updated_at: String,
    test_date: String,
    name: String,
    original_filename: String,
    user_id: Option<String>,
    user_name: Option<String>,
    user_email: Option<String>,
    laboratory_id: Option<String>,
    laboratory_name: Option<String>,
    field_name: Option<String>,
    operator_name: Option<String>,
    well_number: Option<String>,
    test_id: Option<String>,
    instrument_type: String,
    geometry: Option<String>,
    geometry_source: Option<String>,
    water_source: String,
    water_params: Option<String>,
    fluid_type: String,
    test_group: String,
    test_sub_group: Option<String>,
    test_category: Option<String>,
    test_type: Option<String>,
    dominant_pattern: Option<String>,
    max_viscosity: Option<i64>,
    avg_viscosity: Option<i64>,
    duration_seconds: Option<f64>,
    avg_temperature_c: Option<f64>,
    max_temperature_c: Option<f64>,
    touch_has_crossing: Option<i64>,
    touch_crossing_time_min: Option<f64>,
    touch_crossing_viscosity_cp: Option<f64>,
    touch_viscosity_at_target_cp: Option<f64>,
    touch_precompute_version: Option<i64>,
    reagent_summary_json: String,
    reagent_search_text: String,
    search_text: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::experiments::types::{
        RheologyParameterSource, StoredExperiment, LOCAL_USER_ID,
    };
    use crate::db::migration::run_migrations;
    use crate::db::repositories::experiments::persist_experiment;
    use rusqlite::Connection;
    use serde_json::json;

    fn open() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", true).unwrap();
        run_migrations(&conn).unwrap();
        conn
    }

    fn default_query() -> ExperimentsListQuery {
        serde_json::from_value(json!({})).unwrap()
    }

    fn minimal_experiment(id: &str, field: Option<&str>, water: &str) -> StoredExperiment {
        StoredExperiment {
            id: id.to_string(),
            created_at: "2026-04-29T10:00:00Z".to_string(),
            updated_at: "2026-04-29T10:00:00Z".to_string(),
            name: format!("Test {id}"),
            field_name: field.map(str::to_string),
            operator_name: None,
            well_number: None,
            test_id: None,
            original_filename: format!("{id}.xlsx"),
            test_date: "2026-04-29".to_string(),
            instrument_type: "Grace".to_string(),
            geometry: Some("R1B5".to_string()),
            geometry_source: None,
            water_source: water.to_string(),
            water_params: None,
            fluid_type: "Linear".to_string(),
            test_group: "Rheology".to_string(),
            test_sub_group: None,
            test_category: Some("Fracturing".to_string()),
            test_type: Some("ShearViscosity".to_string()),
            dominant_pattern: None,
            metrics: json!({}),
            raw_points: vec![],
            calibration: None,
            reagents: vec![],
            max_viscosity: None,
            avg_viscosity: None,
            user: Some(StoredExperimentUser {
                id: LOCAL_USER_ID.to_string(),
                name: "Local Admin".to_string(),
                email: Some("local@desktop".to_string()),
            }),
            laboratory: None,
            parsed_by: None,
            parse_source: None,
            time_range_min: None,
            time_range_max: None,
            viscosity_min: None,
            pressure_max: None,
            extra_fields: None,
            rheology_source: RheologyParameterSource::Program,
            rheology_parameters: vec![],
        }
    }

    fn experiment_with_crossing(id: &str, start_cp: f64, end_cp: f64) -> StoredExperiment {
        let mut exp = minimal_experiment(id, None, "Well");
        exp.raw_points = (0..=720)
            .map(|i| {
                let frac = (i as f64) / 720.0;
                let viscosity = start_cp + (end_cp - start_cp) * frac;
                json!({
                    "timeSec": i as f64,
                    "viscosityCp": viscosity,
                    "shearRate": 511.0,
                    "temperatureC": 70.0,
                })
            })
            .collect();
        exp
    }

    #[test]
    fn save_path_upserts_projection_row() {
        let conn = open();
        let exp = minimal_experiment("projection-save-1", Some("Field A"), "Water A");
        persist_experiment(&conn, &exp).unwrap();

        let status = projection_status(&conn).unwrap();
        assert!(status.ready);
        assert_eq!(status.experiment_count, 1);
        assert_eq!(status.current_projection_count, 1);
    }

    #[test]
    fn projection_query_matches_default_list_shape() {
        let conn = open();
        persist_experiment(
            &conn,
            &minimal_experiment("projection-list-1", Some("A"), "W1"),
        )
        .unwrap();
        persist_experiment(
            &conn,
            &minimal_experiment("projection-list-2", Some("B"), "W2"),
        )
        .unwrap();

        let (rows, total) = query_experiments_list_projection(&conn, &default_query()).unwrap();
        assert_eq!(total, 2);
        assert_eq!(rows.len(), 2);
        assert!(rows
            .iter()
            .any(|row| row.field_name.as_deref() == Some("A")));
    }

    #[test]
    fn facet_cache_rebuild_reads_projection_values() {
        let conn = open();
        persist_experiment(
            &conn,
            &minimal_experiment("projection-facet-1", Some("North Field"), "Brine"),
        )
        .unwrap();
        rebuild_facet_cache(&conn).unwrap();

        let metadata = filter_metadata_from_facet_cache(&conn).unwrap().unwrap();
        assert_eq!(metadata.field_names, vec!["North Field".to_string()]);
        assert_eq!(metadata.water_sources, vec!["Brine".to_string()]);
    }

    #[test]
    fn touch_stats_use_projection_columns() {
        let conn = open();
        persist_experiment(
            &conn,
            &experiment_with_crossing("projection-touch-1", 200.0, 10.0),
        )
        .unwrap();
        rebuild_facet_cache(&conn).unwrap();

        let metadata = filter_metadata_from_facet_cache(&conn).unwrap().unwrap();
        assert_eq!(metadata.touch_point_stats.total_experiments, 1);
        assert_eq!(metadata.touch_point_stats.with_crossing_count, 1);
    }

    #[test]
    fn reagent_filters_are_not_projection_eligible() {
        let mut query = default_query();
        query.reagent_name = Some("Crosslinker".into());
        assert!(matches!(
            can_use_projection(&query),
            ProjectionEligibility::Fallback(_)
        ));
    }
}
