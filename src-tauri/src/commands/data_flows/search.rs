use crate::error::Result;
use crate::state::AppState;
use rusqlite::params;
use serde_json::{json, Value};
use tauri::State;

#[tauri::command]
pub async fn search_projections_list(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Value> {
    let conn = state.pool_conn()?;
    let max = limit.unwrap_or(100).min(1000);

    let mut stmt = conn.prepare(
        "SELECT id, experimentId, operation, projectionVersion, \
                    detailsJson, createdAt \
             FROM SearchProjectionLog ORDER BY createdAt DESC LIMIT ?1",
    )?;

    let rows = stmt.query_map(params![max], |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "experimentId": row.get::<_, Option<String>>(1)?,
            "operation": row.get::<_, String>(2)?,
            "projectionVersion": row.get::<_, String>(3)?,
            "detailsJson": row.get::<_, Option<String>>(4)?,
            "createdAt": row.get::<_, String>(5)?
        }))
    })?;

    let items: Vec<Value> = rows.collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(json!({ "success": true, "entries": items, "count": items.len() }))
}
