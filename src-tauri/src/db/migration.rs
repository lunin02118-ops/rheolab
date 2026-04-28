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

use rusqlite::Connection;
use serde::Serialize;

/// Current schema version embedded at compile time.
///
/// Increment this constant **and** add a corresponding `V{N}_MIGRATION` block
/// to `run_migrations` whenever a destructive schema change is needed (e.g.
/// `ALTER TABLE`, dropping a column, changing a column type).
/// Pure additions (new tables / indexes) are safe to add directly to V1_DDL
/// using `IF NOT EXISTS` without bumping the version.
pub const CURRENT_SCHEMA_VERSION: i64 = 6;

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
    // Dev-time invariant check: catches typos in the MIGRATIONS registry
    // (non-monotonic or duplicate versions). In release builds this is a
    // no-op on a correctly-ordered registry.
    debug_assert!(
        super::migrations::validate_registry().is_ok(),
        "MIGRATIONS registry invariants violated: {:?}",
        super::migrations::validate_registry()
    );

    // Step 0: Read the existing schema_meta row *before* applying anything,
    // so we can (a) skip migrations that have already been applied and
    // (b) detect downgrades (stored_version > target).
    //
    // schema_meta itself is created by v0001_initial's DDL (`IF NOT EXISTS`),
    // so this query may fail with `no such table` on a fresh install — treat
    // that as "no prior state" rather than surfacing the error.
    let existing_row: Option<(i64, String)> = match conn.query_row(
        "SELECT schema_version, app_version FROM schema_meta WHERE id = 1",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
    ) {
        Ok(r) => Some(r),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(rusqlite::Error::SqliteFailure(_, Some(ref msg))) if msg.contains("no such table") => {
            None
        }
        Err(e) => {
            // Any other error (corruption, I/O, …) is a real failure we
            // should not swallow.
            let err_msg = e.to_string();
            if err_msg.contains("no such table") {
                None
            } else {
                return Err(e);
            }
        }
    };
    let stored_version: i64 = existing_row.as_ref().map(|(v, _)| *v).unwrap_or(0);

    // Step 1: Downgrade detection — the stored schema is ahead of this binary.
    //
    // Fail-closed: we MUST NOT touch `schema_meta` in this case.  The
    // historical bug (audit-preflight DB-001) was that the unconditional
    // upsert at the end of this function would silently rewrite
    // `schema_version` from the higher stored value back down to
    // CURRENT_SCHEMA_VERSION, masking the fact that the database had
    // previously been used by a newer binary.  A subsequent re-upgrade
    // would then incorrectly classify the DB as "current" instead of
    // "future-version, please verify".
    //
    // We don't attempt automatic rollback; we return early with a truthful
    // MigrationResult that carries the higher stored version so the caller
    // / UI layer can detect the downgrade and offer recovery (e.g. restore
    // from backup) before any user data is touched.
    if stored_version > CURRENT_SCHEMA_VERSION {
        tracing::warn!(
            "Database schema_version ({}) is newer than the binary's CURRENT_SCHEMA_VERSION ({}). \
             This is a downgrade — no migrations will be applied and schema_meta will not be modified.",
            stored_version,
            CURRENT_SCHEMA_VERSION
        );
        let app_version = env!("CARGO_PKG_VERSION").to_string();
        let previous_app_version: Option<String> = existing_row.map(|(_, ver)| ver);
        let version_changed = previous_app_version
            .as_deref()
            .map_or(false, |prev| prev != app_version);
        return Ok(MigrationResult {
            schema_version: stored_version,
            was_fresh_install: false,
            app_version,
            previous_app_version,
            version_changed,
        });
    }

    // Step 2: Apply each registered migration whose version is greater than
    // what's already stored. Every migration's DDL is idempotent (uses
    // `IF NOT EXISTS`), but skipping already-applied versions still matters:
    //   * avoids needless work on every app start,
    //   * keeps `ALTER TABLE` migrations (non-idempotent) from firing twice,
    //   * preserves a clear "applied N migrations this run" log signal.
    //
    // Each migration runs in its own transaction so a partial failure
    // leaves the database at a well-defined prior version.
    for migration in super::migrations::MIGRATIONS {
        if migration.version() <= stored_version {
            continue;
        }
        let tx = conn.unchecked_transaction()?;
        migration.up(&tx).map_err(|e| match e {
            super::migrations::MigrationError::Sqlite(inner) => inner,
        })?;
        tx.commit()?;
        tracing::info!("Migration v{:04} applied", migration.version());
    }

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
            CURRENT_SCHEMA_VERSION,
            app_version,
            was_fresh_install,
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
