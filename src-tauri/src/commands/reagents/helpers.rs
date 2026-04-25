use crate::error::{AppError, Result};
pub(crate) use crate::utils::time::now_rfc3339;
use rusqlite::params;
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};

use super::types::StoredReagent;

// ── Internal helpers ───────────────────────────────────────────────────

pub(crate) fn row_to_reagent(row: &rusqlite::Row) -> rusqlite::Result<StoredReagent> {
    Ok(StoredReagent {
        id: row.get(0)?,
        name: row.get(1)?,
        category: row.get(2)?,
        manufacturer: row.get(3)?,
        country: row.get(4)?,
        description: row.get(5)?,
        active_substance: row.get(6)?,
        form: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

pub(crate) fn get_reagent(
    conn: &rusqlite::Connection,
    id: &str,
) -> Result<Option<StoredReagent>> {
    conn.query_row(
        "SELECT id, name, category, manufacturer, country, description, \
                activeSubstance, form, createdAt, updatedAt \
         FROM ReagentCatalog WHERE id = ?1",
        params![id],
        row_to_reagent,
    )
    .optional()
    .map_err(AppError::Sql)
}

pub(crate) fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|s| s.trim().to_string())
        .and_then(|s| if s.is_empty() { None } else { Some(s) })
}

pub(crate) fn string_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| {
        v.as_str().map(|s| s.to_string()).or_else(|| {
            if v.is_null() {
                None
            } else {
                Some(v.to_string())
            }
        })
    })
}

pub(crate) fn generate_reagent_id(name: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(name.as_bytes());
    hasher.update(now_rfc3339().as_bytes());
    let digest = hasher.finalize();
    let short = digest
        .iter()
        .take(10)
        .map(|b| format!("{:02x}", b))
        .collect::<String>();
    format!("reag_{}", short)
}

