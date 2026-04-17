//! Delta-sync file engine for offline laboratory data exchange.
//!
//! # Scenario
//!
//! Lab A → USB/sftp → Lab B → Central Lab
//!
//! Each lab exports a delta file containing all experiments modified since a
//! given timestamp.  The receiving lab imports the delta, detects per-experiment
//! conflicts (both sides changed after the last sync point), and resolves them.
//!
//! ## Delta file format  (`sync/delta_<ts>.json`)
//! ```json
//! {
//!   "_deltaVersion": "1",
//!   "_sinceTimestamp": "<RFC-3339>",
//!   "_exportedAt":    "<RFC-3339>",
//!   "experiments":    [ <StoredExperiment>, … ]
//! }
//! ```
//!
//! ## Conflict tracking
//! Per-experiment conflicts are stored in `ConflictRecord` with
//! `fieldName = "_entire_experiment"`.  `localValue` holds the local
//! `updatedAt` timestamp; `incomingValue` holds the full remote experiment JSON
//! snapshot.  `status` starts as `"open"` and transitions to `"resolved"`.

use crate::error::Result;
use crate::commands::experiments::crud::{load_experiments_batch, persist_experiment};
use crate::commands::experiments::list::invalidate_filter_metadata_cache;
use crate::commands::experiments::types::StoredExperiment;
use crate::state::AppState;
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn now_iso() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Export a delta file containing all experiments modified since
/// `since_timestamp` (RFC 3339 string, inclusive lower bound).
///
/// The file is written to `<app_data_dir>/sync/delta_<ts>.json` and the path
/// is returned to the frontend so it can be opened in the OS file picker /
/// copied to USB.
#[tauri::command]
pub async fn sync_export_delta(
    state: State<'_, AppState>,
    since_timestamp: String,
) -> Result<Value> {
    let conn = state.pool_conn()?;

    // 1. Find experiments updated after `since_timestamp`.
    let mut stmt = conn
        .prepare(
            "SELECT id FROM Experiment WHERE updatedAt > ?1 ORDER BY updatedAt",
        )?;

    let ids: Vec<String> = stmt
        .query_map(params![since_timestamp], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    // 2. Batch-load all experiments in 3 queries (vs 3×N).
    let experiments = load_experiments_batch(&conn, &ids)?;
    let count = experiments.len();
    let exported_at = now_iso();

    // 4. Write to <app_data_dir>/sync/delta_<ts>.json
    //    Sanitise timestamp so it is safe as a filename on all OSes.
    let sync_dir = state.app_data_dir.join("sync");
    std::fs::create_dir_all(&sync_dir)?;

    let ts_safe = exported_at.replace([':', '.'], "-");
    let file_name = format!("delta_{}.json", ts_safe);
    let file_path = sync_dir.join(&file_name);

    {
        let file = std::fs::File::create(&file_path)?;
        let mut writer = std::io::BufWriter::new(file);

        // JSON envelope header: write user-influenced fields via serde so they
        // are escaped correctly inside the streamed envelope.
        use std::io::Write;
        writer.write_all(b"{\"_deltaVersion\":\"1\",\"_sinceTimestamp\":")?;
        serde_json::to_writer(&mut writer, &since_timestamp)?;
        writer.write_all(b",\"_exportedAt\":")?;
        serde_json::to_writer(&mut writer, &exported_at)?;
        writer.write_all(b",\"experiments\":[")?;

        let mut first = true;
        for exp in &experiments {
            if !first {
                writer.write_all(b",")?;
            }
            first = false;
            serde_json::to_writer(&mut writer, exp)?;
        }

        writer.write_all(b"]}")?;
        writer.flush()?;
    }

    let file_path_str = file_path
        .to_str()
        .unwrap_or_default()
        .to_string();

    tracing::info!(
        "sync_export_delta: exported {} experiments since {} → {}",
        count, since_timestamp, file_path_str
    );

    Ok(json!({
        "success": true,
        "filePath": file_path_str,
        "fileName": file_name,
        "count": count,
        "exportedAt": exported_at,
    }))
}

/// Import a delta file produced by `sync_export_delta`.
///
/// For each experiment in the payload:
/// - **No local row** → INSERT directly (`imported` counter).
/// - **Local `updatedAt` ≤ remote `updatedAt`** → safe overwrite (`updated` counter).
/// - **Local `updatedAt` > remote `updatedAt`** → diverged; a `ConflictRecord`
///   row is created with `fieldName = "_entire_experiment"` (`conflicts` counter).
///
/// Returns `{ success, imported, updated, conflicts: [{ id, experimentId,
/// localUpdatedAt, remoteUpdatedAt, createdAt }] }`.
#[tauri::command]
pub async fn sync_import_delta(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<Value> {
    // 1. Read + parse delta file.
    let file = std::fs::File::open(&file_path)
        .map_err(|e| format!("Cannot open delta file '{}': {}", file_path, e))?;
    let delta: Value = serde_json::from_reader(std::io::BufReader::new(file))?;

    let remote_experiments = delta
        .get("experiments")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Delta file missing 'experiments' array".to_string())?
        .clone();

    let conn = state.pool_conn()?;
    let tx = conn
        .unchecked_transaction()?;

    let mut imported: usize = 0;
    let mut updated: usize = 0;
    let mut conflict_rows: Vec<Value> = vec![];

    for exp_val in &remote_experiments {
        // Deserialise the incoming experiment snapshot.
        let remote_exp: StoredExperiment = match serde_json::from_value(exp_val.clone()) {
            Ok(e) => e,
            Err(err) => {
                tracing::warn!("sync_import_delta: skipping malformed experiment: {}", err);
                continue;
            }
        };

        // 2. Check whether a local row exists.
        let local_updated_at: Option<String> = tx
            .query_row(
                "SELECT updatedAt FROM Experiment WHERE id = ?1",
                params![remote_exp.id],
                |row| row.get(0),
            )
            .optional()?;

        match local_updated_at {
            None => {
                // No local row — safe INSERT.
                persist_experiment(&tx, &remote_exp)?;
                imported += 1;
            }
            Some(ref local_ts) if local_ts.as_str() <= remote_exp.updated_at.as_str() => {
                // Local is same-age or older — safe overwrite.
                persist_experiment(&tx, &remote_exp)?;
                updated += 1;
            }
            Some(ref local_ts) => {
                // Conflict: local was modified after the remote snapshot.
                let conflict_id = new_id();
                let merge_event_id = new_id();
                let now = now_iso();

                // Record a MergeEvent for audit trail.
                tx.execute(
                    "INSERT INTO MergeEvent \
                     (id, canonicalExperimentId, incomingExperimentId, importBatchId, \
                      fieldClass, resolutionPolicy, resolutionSummary, createdAt) \
                     VALUES (?1, ?2, ?2, NULL, 'identity', 'manual', 'delta-sync conflict', ?3)",
                    params![merge_event_id, remote_exp.id, now],
                )?;

                let incoming_snapshot = serde_json::to_string(exp_val)
                    .unwrap_or_else(|_| "{}".to_string());

                tx.execute(
                    "INSERT INTO ConflictRecord \
                     (id, mergeEventId, experimentId, fieldName, \
                      localValue, incomingValue, status, createdAt) \
                     VALUES (?1, ?2, ?3, '_entire_experiment', ?4, ?5, 'open', ?6)",
                    params![
                        conflict_id,
                        merge_event_id,
                        remote_exp.id,
                        local_ts,
                        incoming_snapshot,
                        now,
                    ],
                )?;

                conflict_rows.push(json!({
                    "id": conflict_id,
                    "experimentId": remote_exp.id,
                    "localUpdatedAt": local_ts,
                    "remoteUpdatedAt": remote_exp.updated_at,
                    "createdAt": now,
                }));
            }
        }
    }

    tx.commit()?;
    invalidate_filter_metadata_cache();

    tracing::info!(
        "sync_import_delta: imported={} updated={} conflicts={}",
        imported, updated, conflict_rows.len()
    );

    Ok(json!({
        "success": true,
        "imported": imported,
        "updated": updated,
        "conflicts": conflict_rows,
    }))
}

/// Resolve a conflict previously created by `sync_import_delta`.
///
/// `resolution` must be one of:
/// - `keep_local`  — discard the remote snapshot; mark conflict resolved.
/// - `keep_remote` — overwrite the local experiment with the remote snapshot.
/// - `keep_both`   — insert the remote snapshot as a *new* experiment with a
///                   fresh UUID; the local copy is untouched.
#[tauri::command]
pub async fn sync_resolve_conflict(
    state: State<'_, AppState>,
    conflict_id: String,
    resolution: String,
) -> Result<Value> {
    if !matches!(resolution.as_str(), "keep_local" | "keep_remote" | "keep_both") {
        return Err(format!(
            "Invalid resolution '{}'. Must be keep_local | keep_remote | keep_both.",
            resolution
        ).into());
    }

    let conn = state.pool_conn()?;
    let tx = conn
        .unchecked_transaction()?;

    // Load the ConflictRecord.
    let (experiment_id, incoming_snapshot_json): (String, String) = tx
        .query_row(
            "SELECT experimentId, incomingValue FROM ConflictRecord \
             WHERE id = ?1 AND fieldName = '_entire_experiment' AND status = 'open'",
            params![conflict_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;

    let now = now_iso();

    match resolution.as_str() {
        "keep_local" => {
            // Nothing to change in Experiment — just mark the conflict resolved.
            tx.execute(
                "UPDATE ConflictRecord SET status='resolved', resolution='keep_local', \
                 resolvedAt=?1 WHERE id=?2",
                params![now, conflict_id],
            )?;
        }

        "keep_remote" => {
            // Overwrite local experiment with remote snapshot.
            let remote_exp: StoredExperiment =
                serde_json::from_str(&incoming_snapshot_json)?;

            persist_experiment(&tx, &remote_exp)?;

            tx.execute(
                "UPDATE ConflictRecord SET status='resolved', resolution='keep_remote', \
                 resolvedAt=?1 WHERE id=?2",
                params![now, conflict_id],
            )?;
        }

        "keep_both" => {
            // Insert the remote snapshot under a new UUID; local copy unchanged.
            let mut remote_exp: StoredExperiment =
                serde_json::from_str(&incoming_snapshot_json)?;

            let new_id_str = format!("exp_{}", new_id().replace('-', ""));
            remote_exp.id = new_id_str.clone();
            // Mark the duplicate so operators can identify its origin.
            remote_exp.name = format!("{} [remote copy]", remote_exp.name);

            persist_experiment(&tx, &remote_exp)?;

            tx.execute(
                "UPDATE ConflictRecord SET status='resolved', resolution='keep_both', \
                 resolvedAt=?1 WHERE id=?2",
                params![now, conflict_id],
            )?;
        }

        _ => return Err(format!("Invalid resolution '{}'", resolution).into()),
    }

    tx.commit()?;
    invalidate_filter_metadata_cache();

    tracing::info!(
        "sync_resolve_conflict: conflict={} experiment={} resolution={}",
        conflict_id, experiment_id, resolution
    );

    Ok(json!({
        "success": true,
        "conflictId": conflict_id,
        "experimentId": experiment_id,
        "resolution": resolution,
    }))
}

/// List all open (unresolved) experiment-level conflicts.
///
/// Returns `{ success, conflicts: [{ id, experimentId, localUpdatedAt,
/// remoteUpdatedAt, createdAt }] }`.
#[tauri::command]
pub async fn sync_list_conflicts(state: State<'_, AppState>) -> Result<Value> {
    let conn = state.pool_conn()?;

    let mut stmt = conn
        .prepare(
            "SELECT id, experimentId, localValue, incomingValue, createdAt \
             FROM ConflictRecord \
             WHERE fieldName = '_entire_experiment' AND status = 'open' \
             ORDER BY createdAt DESC",
        )?;

    let conflicts: Vec<Value> = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let experiment_id: String = row.get(1)?;
            let local_updated_at: Option<String> = row.get(2)?;
            let incoming_json: String = row.get(3)?;
            let created_at: String = row.get(4)?;

            // Extract remoteUpdatedAt from the stored snapshot without cloning
            // the entire document.
            let remote_updated_at: Option<String> =
                serde_json::from_str::<Value>(&incoming_json)
                    .ok()
                    .and_then(|v| {
                        v.get("updatedAt")
                            .and_then(|u| u.as_str())
                            .map(|s| s.to_string())
                    });

            Ok(json!({
                "id": id,
                "experimentId": experiment_id,
                "localUpdatedAt": local_updated_at,
                "remoteUpdatedAt": remote_updated_at,
                "createdAt": created_at,
            }))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(json!({ "success": true, "conflicts": conflicts }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── now_iso ───────────────────────────────────────────────────────────────

    #[test]
    fn now_iso_is_not_empty() {
        assert!(!now_iso().is_empty());
    }

    #[test]
    fn now_iso_contains_t_separator() {
        assert!(now_iso().contains('T'), "ISO timestamp must contain 'T'");
    }

    #[test]
    fn now_iso_ends_with_z() {
        assert!(now_iso().ends_with('Z'), "UTC timestamp must end with 'Z'");
    }

    #[test]
    fn now_iso_year_starts_with_20() {
        assert!(
            now_iso().starts_with("20"),
            "timestamp should start with '20' (21st century)"
        );
    }

    // ── new_id ────────────────────────────────────────────────────────────────

    #[test]
    fn new_id_has_uuid_structure() {
        let id = new_id();
        assert_eq!(id.len(), 36, "UUID must be 36 characters");
        let parts: Vec<&str> = id.split('-').collect();
        assert_eq!(parts.len(), 5, "UUID must have 5 hyphen-separated parts");
        // Check group lengths: 8-4-4-4-12
        assert_eq!(parts[0].len(), 8);
        assert_eq!(parts[1].len(), 4);
        assert_eq!(parts[2].len(), 4);
        assert_eq!(parts[3].len(), 4);
        assert_eq!(parts[4].len(), 12);
    }

    #[test]
    fn new_id_generates_unique_values() {
        let ids: std::collections::HashSet<String> = (0..20).map(|_| new_id()).collect();
        assert_eq!(ids.len(), 20, "each generated ID must be unique");
    }
}
