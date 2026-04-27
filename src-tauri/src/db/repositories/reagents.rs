//! Repository layer for ReagentCatalog persistence.
//!
//! Provides the [`ReagentRepository`] trait and its SQLite implementation
//! [`SqliteReagentRepository`].  Centralises reagent SQL that was previously
//! scattered across `commands::reagents::commands` and `helpers`.
//!
//! Phase 6.6 — the `resolve_by_id_or_name` method is the canonical helper for
//! reagent resolution (previously written inline in four separate locations).

use crate::commands::reagents::StoredReagent;
use crate::error::{AppError, Result};
use rusqlite::{params, OptionalExtension};

// ── Trait ─────────────────────────────────────────────────────────────────────

/// Repository interface for ReagentCatalog persistence.
pub trait ReagentRepository {
    /// Return all reagents ordered by category then name (case-insensitive).
    fn list_all(&self, conn: &rusqlite::Connection) -> Result<Vec<StoredReagent>>;

    /// Find a single reagent by primary key.
    fn find_by_id(&self, conn: &rusqlite::Connection, id: &str) -> Result<Option<StoredReagent>>;

    /// Return `true` if a reagent row with the given `id` exists.
    fn exists_by_id(&self, conn: &rusqlite::Connection, id: &str) -> Result<bool>;

    /// Return `true` if another reagent with the same name (case-insensitive)
    /// exists.  Pass `exclude_id = Some(id)` to allow the row itself to keep
    /// its name during an update.
    fn is_duplicate_name(
        &self,
        conn: &rusqlite::Connection,
        name: &str,
        exclude_id: Option<&str>,
    ) -> Result<bool>;

    /// Resolve a reagent row for import matching:
    /// try by `id` first (if supplied), then fall back to case-insensitive
    /// name lookup.  Returns the resolved row if found.
    ///
    /// This is Phase 6.6's single helper that replaces an inline two-step
    /// lookup repeated in `reagents_import`.
    fn resolve_by_id_or_name(
        &self,
        conn: &rusqlite::Connection,
        id: Option<&str>,
        name: &str,
    ) -> Result<Option<ResolvedReagent>>;
}

/// Partial reagent row returned by [`ReagentRepository::resolve_by_id_or_name`].
/// Contains the fields needed for the import-merge logic without pulling the
/// full `StoredReagent` struct.
#[derive(Debug)]
pub struct ResolvedReagent {
    pub id: String,
    pub manufacturer: Option<String>,
    pub country: Option<String>,
    pub description: Option<String>,
    pub active_substance: Option<String>,
    pub form: Option<String>,
    pub extra_fields: Option<String>,
}

// ── Default SQLite implementation ─────────────────────────────────────────────

/// SQLite-backed implementation of [`ReagentRepository`].
pub struct SqliteReagentRepository;

impl ReagentRepository for SqliteReagentRepository {
    fn list_all(&self, conn: &rusqlite::Connection) -> Result<Vec<StoredReagent>> {
        list_all(conn)
    }

    fn find_by_id(&self, conn: &rusqlite::Connection, id: &str) -> Result<Option<StoredReagent>> {
        find_by_id(conn, id)
    }

    fn exists_by_id(&self, conn: &rusqlite::Connection, id: &str) -> Result<bool> {
        exists_by_id(conn, id)
    }

    fn is_duplicate_name(
        &self,
        conn: &rusqlite::Connection,
        name: &str,
        exclude_id: Option<&str>,
    ) -> Result<bool> {
        is_duplicate_name(conn, name, exclude_id)
    }

    fn resolve_by_id_or_name(
        &self,
        conn: &rusqlite::Connection,
        id: Option<&str>,
        name: &str,
    ) -> Result<Option<ResolvedReagent>> {
        resolve_by_id_or_name(conn, id, name)
    }
}

// ── Free-function API (pub(crate)) ────────────────────────────────────────────
//
// Callers that do not need trait polymorphism use these directly.

/// List all reagents, ordered by category then name (case-insensitive).
pub(crate) fn list_all(conn: &rusqlite::Connection) -> Result<Vec<StoredReagent>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, category, manufacturer, country, description, \
                    activeSubstance, form, createdAt, updatedAt \
             FROM ReagentCatalog \
             ORDER BY LOWER(category), LOWER(name)",
        )
        .map_err(|e| format!("SQL error: {}", e))?;

    let rows = stmt
        .query_map([], row_to_reagent)
        .map_err(|e| format!("SQL error: {}", e))?;

    let mut reagents = Vec::new();
    for row in rows {
        reagents.push(row.map_err(|e| format!("Row error: {}", e))?);
    }
    Ok(reagents)
}

/// Find a reagent by primary key.
/// Previously `commands::reagents::helpers::get_reagent`.
pub(crate) fn find_by_id(conn: &rusqlite::Connection, id: &str) -> Result<Option<StoredReagent>> {
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

/// Check whether a reagent row with `id` exists.
pub(crate) fn exists_by_id(conn: &rusqlite::Connection, id: &str) -> Result<bool> {
    conn.query_row(
        "SELECT COUNT(*) FROM ReagentCatalog WHERE id = ?1",
        params![id],
        |row| row.get::<_, i32>(0),
    )
    .map(|c| c > 0)
    .map_err(|e| format!("SQL error: {}", e).into())
}

/// Check whether another reagent uses the same name (case-insensitive).
/// Pass `exclude_id = Some(id)` during updates to allow keeping the same name.
pub(crate) fn is_duplicate_name(
    conn: &rusqlite::Connection,
    name: &str,
    exclude_id: Option<&str>,
) -> Result<bool> {
    if let Some(exc) = exclude_id {
        conn.query_row(
            "SELECT COUNT(*) FROM ReagentCatalog WHERE id != ?1 AND LOWER(name) = LOWER(?2)",
            params![exc, name],
            |row| row.get::<_, i32>(0),
        )
        .map(|c| c > 0)
        .map_err(|e| format!("SQL error: {}", e).into())
    } else {
        conn.query_row(
            "SELECT COUNT(*) FROM ReagentCatalog WHERE LOWER(name) = LOWER(?1)",
            params![name],
            |row| row.get::<_, i32>(0),
        )
        .map(|c| c > 0)
        .map_err(|e| format!("SQL error: {}", e).into())
    }
}

/// Resolve a reagent row for import matching.
///
/// Tries a lookup by `id` first (if supplied) then falls back to
/// case-insensitive name matching.  This is the canonical implementation for
/// Phase 6.6 — the same two-step pattern previously written inline in
/// `reagents_import`.
pub(crate) fn resolve_by_id_or_name(
    conn: &rusqlite::Connection,
    id: Option<&str>,
    name: &str,
) -> Result<Option<ResolvedReagent>> {
    const SQL: &str = "SELECT id, manufacturer, country, description, \
                               activeSubstance, form, extraFields \
                        FROM ReagentCatalog";

    let map_row = |row: &rusqlite::Row| -> rusqlite::Result<ResolvedReagent> {
        Ok(ResolvedReagent {
            id: row.get(0)?,
            manufacturer: row.get(1)?,
            country: row.get(2)?,
            description: row.get(3)?,
            active_substance: row.get(4)?,
            form: row.get(5)?,
            extra_fields: row.get(6)?,
        })
    };

    // Try by id first
    if let Some(iid) = id {
        let by_id = conn
            .query_row(&format!("{} WHERE id = ?1", SQL), params![iid], map_row)
            .optional()
            .map_err(|e| format!("SQL error: {}", e))?;

        if by_id.is_some() {
            return Ok(by_id);
        }
    }

    // Fallback: match by name
    conn.query_row(
        &format!("{} WHERE LOWER(name) = LOWER(?1)", SQL),
        params![name],
        map_row,
    )
    .optional()
    .map_err(|e| format!("SQL error: {}", e).into())
}

// ── Row mapper ────────────────────────────────────────────────────────────────

/// Map a rusqlite row (columns 0-9) to a [`StoredReagent`].
/// Previously `commands::reagents::helpers::row_to_reagent`.
fn row_to_reagent(row: &rusqlite::Row) -> rusqlite::Result<StoredReagent> {
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
