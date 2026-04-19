#![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Schema for the unified SQLite database.
//!
//! All 21 tables, indexes, FTS5 virtual table, and triggers are defined
//! in a single consolidated V1_DDL constant.  All DDL uses `IF NOT EXISTS`
//! so `run_migrations` is safe to call on every startup — fresh DB or not.
//!
//! Schema versioning is tracked in the `schema_meta` table (singleton row,
//! id = 1). This table is created as part of V1_DDL so it is present on
//! both fresh installs and legacy databases upgraded from pre-versioned builds.
//!
//! **Downgrade policy**: schema_version only ever increases. If a user
//! downgrades the application binary the `schema_meta.schema_version` value
//! will be higher than `CURRENT_SCHEMA_VERSION`; `run_migrations` logs a
//! warning but does not attempt to reverse the schema — the caller should
//! handle this before touching user data.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

/// Current schema version embedded at compile time.
///
/// Increment this constant **and** add a corresponding `V{N}_MIGRATION` block
/// to `run_migrations` whenever a destructive schema change is needed (e.g.
/// `ALTER TABLE`, dropping a column, changing a column type).
/// Pure additions (new tables / indexes) are safe to add directly to V1_DDL
/// using `IF NOT EXISTS` without bumping the version.
pub const CURRENT_SCHEMA_VERSION: i64 = 1;

/// Information returned after a successful migration run.
///
/// Serialised and emitted to the frontend as the `startup_completed` Tauri event
/// so the UI can detect post-update first runs and offer recovery options.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    /// The schema version that is now active.
    pub schema_version: i64,
    /// `true` when schema_meta did not previously exist (first ever run / fresh install).
    pub was_fresh_install: bool,
    /// The app version string compiled into this binary (current version).
    pub app_version: String,
    /// The app version stored in schema_meta *before* this run, if any.
    /// `None` on a fresh install.  Different from `app_version` when the user
    /// has just upgraded from a previous release.
    pub previous_app_version: Option<String>,
    /// `true` when `previous_app_version` differs from `app_version` (i.e. this
    /// is the first run after an application update).
    pub version_changed: bool,
}

/// Apply the full schema and seed default data.
///
/// Idempotent — every `CREATE TABLE / INDEX / TRIGGER` uses `IF NOT EXISTS`.
/// Default reagents are seeded via `INSERT OR IGNORE`, so:
///   - Fresh install  → all defaults inserted.
///   - App update     → new defaults from updated source are inserted;
///                      existing rows (same name) left untouched.
///   - User data      → custom reagents, experiments, etc. are never affected.
///
/// # Schema versioning
/// `schema_meta` (id = 1) records the last seen schema_version and the
/// app version that ran the migration.  This is the prerequisite for
/// startup recovery detection (Phase 3.3).
pub fn run_migrations(conn: &Connection) -> Result<MigrationResult, rusqlite::Error> {
    // Step 1: Apply all registered migrations in version order.  Every
    // statement uses IF NOT EXISTS so this is safe on any existing database.
    for migration in super::migrations::MIGRATIONS {
        migration.up(conn).map_err(|e| match e {
            super::migrations::MigrationError::Sqlite(inner) => inner,
        })?;
    }

    // Step 2: Check whether schema_meta already existed before this run and
    // capture the previously-stored app version for post-update detection.
    let existing_row: Option<(i64, String)> = conn
        .query_row(
            "SELECT schema_version, app_version FROM schema_meta WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let was_fresh_install = existing_row.is_none();
    let previous_app_version: Option<String> = existing_row.map(|(_, ver)| ver);
    let app_version = env!("CARGO_PKG_VERSION").to_string();
    let version_changed = previous_app_version
        .as_deref()
        .map_or(false, |prev| prev != app_version);

    // Step 3: Upsert schema_meta so it always reflects this run.
    conn.execute(
        "INSERT INTO schema_meta (id, schema_version, app_version, migrated_at)
         VALUES (1, ?1, ?2, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
             schema_version = excluded.schema_version,
             app_version    = excluded.app_version,
             migrated_at    = excluded.migrated_at",
        rusqlite::params![CURRENT_SCHEMA_VERSION, app_version],
    )?;

    // Always attempt to seed default reagents.
    // seed_default_reagents uses INSERT OR IGNORE so it is safe to call on
    // every startup: existing rows (matched by UNIQUE name) are skipped,
    // user-created reagents with different names are never touched.
    if let Err(e) = crate::commands::reagents::seed_default_reagents(conn) {
        tracing::warn!("Reagent seed error (non-fatal): {}", e);
    }

    if version_changed {
        tracing::info!(
            "App updated: {} → {} (schema version: {})",
            previous_app_version.as_deref().unwrap_or("unknown"),
            app_version,
            CURRENT_SCHEMA_VERSION,
        );
    } else {
        tracing::info!(
            "Database schema ready (version: {}, app: {}, fresh_install: {})",
            CURRENT_SCHEMA_VERSION, app_version, was_fresh_install,
        );
    }

    Ok(MigrationResult {
        schema_version: CURRENT_SCHEMA_VERSION,
        was_fresh_install,
        app_version,
        previous_app_version,
        version_changed,
    })
}


#[cfg(test)]
#[path = "migration_tests.rs"]
mod tests;
