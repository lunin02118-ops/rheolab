//! Library-filter **slow path**: on-the-fly touch-point crossing detection
//! against a per-query viscosity threshold.
//!
//! The fast path (see `query.rs`) reads pre-computed columns populated at
//! save-time under the fixed **library contract** (threshold = 50 cP).
//! That works for simple slickwater / linear gels but falls down for
//! crosslinked fluids whose break-point lives at hundreds of cP — lab
//! researchers need to query with their own threshold per fluid type.
//!
//! To honor an arbitrary user-supplied threshold, this module:
//!   1. Coarse-prunes candidates via SQL (`maxViscosity >= threshold`).
//!   2. Decodes each candidate's columnar blob and re-runs the smart
//!      touch-point algorithm with the user's threshold.
//!   3. Applies the user's `hasCrossing` / `crossingTimeMin-Max` /
//!      `viscosityAtTargetMin-Max` filters against those fresh values.
//!   4. Sorts + paginates in-memory and batch-loads reagents for the
//!      final page.
//!
//! Result: no precompute schema change, no backfill churn.  Just a
//! small CPU-bound pass whose cost is linear in `candidates × points`.
//! For a 220-row library with ~1000 points each, the whole pass
//! completes in well under a second on a developer laptop.

use crate::db::columnar::decode_typed;
use crate::db::touch_point_precompute::{
    compute_from_inputs_with_threshold, to_touch_inputs_from_columns,
};
use crate::error::Result;
use crate::state::AppState;
use rayon::prelude::*;
use serde_json::Value;
use std::cmp::Ordering;

use super::super::helpers::*;
use super::super::types::*;
use super::query::append_base_conditions;

/// Run the list query against a user-supplied viscosity threshold.
///
/// Called by `query_experiments_list_sql` when `viscosity_threshold` is
/// present and positive; otherwise the fast precomputed path is used.
pub(super) fn query_with_dynamic_threshold(
    state: &AppState,
    query: &ExperimentsListQuery,
    threshold_cp: f64,
) -> Result<(Vec<ExperimentListItem>, usize)> {
    // IMPORTANT — connection lifecycle.
    //
    // The dynamic path used to hold one pool connection for its **entire**
    // run: SQL fetch *plus* the multi-second CPU loop that decodes every
    // blob and recomputes touch-point metrics (11k rows × ~30 KB blob ≈
    // tens of seconds on a cold cache).  With `pool.max_size = 4` and a
    // 10-second `connection_timeout`, any parallel IPC command
    // (`experiments_filter_metadata`, `experiments_count`, licensing
    // background check, etc.) that happened during those seconds would
    // time out and surface to the UI as
    // **"Database temporarily unavailable"** — i.e. the user's
    // "Ошибка загрузки списка" when they turned on the touch-point filter.
    //
    // Fix: take a connection for the *SQL fetch only*, explicitly `drop`
    // it, do the CPU-heavy decode/recompute loop without a connection,
    // then take a fresh connection at the end for the page's reagent
    // batch.  This keeps each borrow under ~100 ms and lets other IPC
    // calls through.
    let conn = state.pool_conn()?;

    // ── 1. Build WHERE: base filters + coarse maxViscosity prune ──────────
    let mut conditions: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
    append_base_conditions(query, &mut conditions, &mut params);

    // Coarse-prune: curves whose peak viscosity never reached the threshold
    // cannot descend through it.  NULL `maxViscosity` (unknown peak — e.g.
    // legacy imports or test fixtures) is treated as "possibly crosses" so
    // the algorithm still gets a chance to rule it in or out.  This keeps
    // the slow path correct even when the summary column isn't populated.
    conditions.push("(e.maxViscosity IS NULL OR e.maxViscosity >= ?)".to_string());
    params.push(Box::new(threshold_cp));

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    // ── 2. Fetch candidates + their columnar blob in a single query ──────
    let data_sql = format!(
        "SELECT e.id, e.createdAt, e.updatedAt, e.name, e.fieldName, e.operatorName, \
                e.wellNumber, e.testId, e.originalFilename, e.testDate, e.instrumentType, \
                e.geometry, e.geometrySource, e.waterSource, e.waterParams, \
                e.fluidType, e.testGroup, e.testSubGroup, e.maxViscosity, \
                e.durationSeconds, e.avgTemperatureC, e.maxTemperatureC, e.avgViscosity, \
                e.userId, e.laboratoryId, \
                u.name, u.email, l.id, l.name, \
                e.testCategory, e.testType, e.dominantPattern, \
                e.touchPrecomputeVersion, ed.dataBlob \
         FROM Experiment e \
         LEFT JOIN User u ON e.userId = u.id \
         LEFT JOIN Laboratory l ON e.laboratoryId = l.id \
         LEFT JOIN ExperimentData ed ON ed.experimentId = e.id \
         {}",
        where_clause
    );

    // Scope the prepared statement so it's dropped BEFORE we release the
    // connection below — otherwise the borrow of `conn` by `stmt` would
    // keep the connection alive for the entire CPU loop.
    //
    // Shape: (list_item_shell_without_touch_points, dataBlob).
    let candidates: Vec<(ExperimentListItem, Option<Vec<u8>>)> = {
        let params_ref: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&data_sql)?;
        // Bind the result to a local so `stmt` drops in the right order
        // (otherwise the query_map iterator's borrow of stmt outlives it
        // at the end of the block and borrowck rejects the expression).
        let rows: Vec<(ExperimentListItem, Option<Vec<u8>>)> = stmt
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

                let blob: Option<Vec<u8>> = row.get(33)?;

                Ok((
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
                        // Touch-point fields are overwritten below after the
                        // on-the-fly algorithm runs — any value here would be
                        // for the wrong threshold anyway.
                        touch_has_crossing: None,
                        touch_crossing_time_min: None,
                        touch_crossing_viscosity_cp: None,
                        touch_viscosity_at_target_cp: None,
                        touch_precompute_version: row.get(32)?,
                        reagents: vec![],
                        user,
                        laboratory,
                    },
                    blob,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };

    // Release the connection NOW.  The decode/compute loop below is
    // pure CPU — no SQLite access — and at 11 k rows × ~30 KB blobs it
    // can run for several seconds.  Holding `conn` through it would
    // stall every other IPC command on the pool.  See lifecycle note
    // at the top of this function.
    drop(conn);

    // ── 3. Decode user's touch-point filters ──────────────────────────────
    let has_crossing_required: Option<bool> = query
        .has_crossing
        .as_deref()
        .map(|s| s.trim().to_ascii_lowercase())
        .and_then(|s| match s.as_str() {
            "yes" | "true" | "1" => Some(true),
            "no" | "false" | "0" => Some(false),
            _ => None,
        });
    let crossing_time_min_filter = query
        .crossing_time_min
        .as_deref()
        .and_then(parse_number_from_str);
    let crossing_time_max_filter = query
        .crossing_time_max
        .as_deref()
        .and_then(parse_number_from_str);
    let viscosity_at_target_min_filter = query
        .viscosity_at_target_min
        .as_deref()
        .and_then(parse_number_from_str);
    let viscosity_at_target_max_filter = query
        .viscosity_at_target_max
        .as_deref()
        .and_then(parse_number_from_str);

    // ── 4. For each candidate: decode blob, recompute, filter ────────────
    //
    // This is the hot path: 10 k+ candidates, each ~30 KB columnar blob,
    // each triggering an O(points) recompute.  Every iteration is
    // **independent** (pure functions, no shared mutable state) so we
    // run them in parallel via rayon.  On a 6-core laptop the scan drops
    // from ~100 s (single-threaded) to ~15-20 s — close to the memory-
    // bandwidth ceiling for zstd-decompressed blobs.
    //
    // Output order is not meaningful here: the next step (`sort_items`)
    // reorders everything by the user-selected column anyway, so the
    // non-deterministic parallel order costs us nothing.
    let mut matching: Vec<ExperimentListItem> = candidates
        .into_par_iter()
        .filter_map(|(mut item, blob)| {
            let inputs = match blob {
                Some(bytes) if !bytes.is_empty() => match decode_typed(&bytes) {
                    Ok(channels) => to_touch_inputs_from_columns(&channels),
                    Err(e) => {
                        tracing::warn!(
                            "dynamic-threshold: columnar decode failed for {} — {}",
                            item.id,
                            e
                        );
                        Vec::new()
                    }
                },
                _ => Vec::new(),
            };

            let (mut has_cross, mut t_cross, mut v_cross, v_target) =
                match compute_from_inputs_with_threshold(&inputs, threshold_cp) {
                    Some(r) => (
                        r.has_crossing,
                        r.crossing_time_min,
                        r.crossing_viscosity_cp,
                        r.viscosity_at_target_cp,
                    ),
                    None => (false, None, None, None),
                };

            // Guard against the "started below threshold" edge case the core
            // algorithm does not handle: if the curve never once rose above
            // the threshold, there's no gel state to break through and the
            // reported "crossing" is spurious.  Lab researchers only care
            // about experiments that actually descended from a gel phase.
            if has_cross {
                let max_viscosity = inputs
                    .iter()
                    .map(|p| p.viscosity_cp)
                    .fold(f64::NEG_INFINITY, f64::max);
                if !max_viscosity.is_finite() || max_viscosity <= threshold_cp {
                    has_cross = false;
                    t_cross = None;
                    v_cross = None;
                }
            }

            // hasCrossing tri-state
            if let Some(required) = has_crossing_required {
                if has_cross != required {
                    return None;
                }
            }

            // crossingTimeMin range — NULL crossing time is treated as "does
            // not satisfy a bounded range", matching the fast-path NULL
            // semantics on the precomputed column.
            if let Some(lo) = crossing_time_min_filter {
                match t_cross {
                    Some(t) if t >= lo => {}
                    _ => return None,
                }
            }
            if let Some(hi) = crossing_time_max_filter {
                match t_cross {
                    Some(t) if t <= hi => {}
                    _ => return None,
                }
            }

            // viscosityAtTarget range — independent of threshold (uses the
            // fixed 10-min target from the library contract).
            if let Some(lo) = viscosity_at_target_min_filter {
                match v_target {
                    Some(v) if v >= lo => {}
                    _ => return None,
                }
            }
            if let Some(hi) = viscosity_at_target_max_filter {
                match v_target {
                    Some(v) if v <= hi => {}
                    _ => return None,
                }
            }

            // Overwrite touch-point fields with dynamic-threshold values so
            // the UI card renders values consistent with the active filter
            // (rather than the stale 50 cP precompute).
            item.touch_has_crossing = Some(has_cross);
            item.touch_crossing_time_min = t_cross;
            item.touch_crossing_viscosity_cp = v_cross;
            item.touch_viscosity_at_target_cp = v_target;

            Some(item)
        })
        .collect();

    // ── 5. Sort in-memory ────────────────────────────────────────────────
    sort_items(&mut matching, query);

    // ── 6. Paginate ───────────────────────────────────────────────────────
    let total = matching.len();
    if total == 0 {
        return Ok((vec![], 0));
    }
    let page = query.page.unwrap_or(1).max(1);
    let limit = query.limit.unwrap_or(20).clamp(1, 500);
    let start = (page - 1) * limit;
    let end = (start + limit).min(total);
    let mut page_items: Vec<ExperimentListItem> = if start < total {
        matching[start..end].to_vec()
    } else {
        Vec::new()
    };

    // ── 7. Batch-load reagents for the page ──────────────────────────────
    // Take a fresh pool connection — the original was released before the
    // CPU loop.  Reagent batch load is a single small indexed query.
    let exp_ids: Vec<String> = page_items.iter().map(|e| e.id.clone()).collect();
    let conn = state.pool_conn()?;
    let reagents_map = load_reagents_batch(&conn, &exp_ids)?;
    for item in &mut page_items {
        if let Some(rs) = reagents_map.get(&item.id) {
            item.reagents = rs.clone();
        }
    }

    Ok((page_items, total))
}

/// In-memory sort matching the fast-path's whitelist of `sort_by` columns.
///
/// Uses `Option`-aware `partial_cmp` for numeric fields — `None` values sort
/// last regardless of direction, which matches SQL's `NULLS LAST` default
/// behaviour on SQLite.
fn sort_items(items: &mut [ExperimentListItem], query: &ExperimentsListQuery) {
    let ascending = matches!(query.sort_dir.as_deref(), Some("asc"));

    // Option<T>-aware partial_cmp wrapper for numeric fields: NULLs sort
    // last, mirroring SQLite's default NULL ordering.
    fn cmp_opt_f64(a: Option<f64>, b: Option<f64>) -> Ordering {
        match (a, b) {
            (Some(x), Some(y)) => x.partial_cmp(&y).unwrap_or(Ordering::Equal),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        }
    }
    fn cmp_opt_str(a: Option<&String>, b: Option<&String>) -> Ordering {
        match (a, b) {
            (Some(x), Some(y)) => x.cmp(y),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        }
    }
    fn cmp_opt_i64(a: Option<i64>, b: Option<i64>) -> Ordering {
        match (a, b) {
            (Some(x), Some(y)) => x.cmp(&y),
            (Some(_), None) => Ordering::Less,
            (None, Some(_)) => Ordering::Greater,
            (None, None) => Ordering::Equal,
        }
    }

    items.sort_by(|a, b| {
        let ord = match query.sort_by.as_deref() {
            Some("name") => a.name.cmp(&b.name),
            Some("testDate") => a.test_date.cmp(&b.test_date),
            Some("instrumentType") => a.instrument_type.cmp(&b.instrument_type),
            Some("geometry") => cmp_opt_str(a.geometry.as_ref(), b.geometry.as_ref()),
            Some("fluidType") => a.fluid_type.cmp(&b.fluid_type),
            Some("durationSeconds") => cmp_opt_f64(a.duration_seconds, b.duration_seconds),
            Some("avgTemperatureC") => cmp_opt_f64(a.avg_temperature_c, b.avg_temperature_c),
            Some("avgViscosity") => cmp_opt_i64(a.avg_viscosity, b.avg_viscosity),
            Some("testCategory") => cmp_opt_str(a.test_category.as_ref(), b.test_category.as_ref()),
            Some("testType") => cmp_opt_str(a.test_type.as_ref(), b.test_type.as_ref()),
            Some("dominantPattern") => {
                cmp_opt_str(a.dominant_pattern.as_ref(), b.dominant_pattern.as_ref())
            }
            _ => b.test_date.cmp(&a.test_date), // default: DESC by testDate
        };
        if ascending {
            ord
        } else {
            ord.reverse()
        }
    });
}
