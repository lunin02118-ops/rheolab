use crate::error::Result;
use rusqlite::params;

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
