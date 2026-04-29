//! Application state structures

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::commands::licensing::LicenseEngine;
use crate::db::migration::MigrationResult;
use crate::db::{self, DbConn, DbPool};
use crate::runtime::jobs::JobScheduler;

// ── Bootstrap paths ──────────────────────────────────────────────────────

/// Resolved filesystem paths for the application data layout.
///
/// Directories are created eagerly so that subsequent stages (pool, migrations)
/// can assume the paths exist.
pub struct BootstrapPaths {
    pub app_data_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub database_path: PathBuf,
}

impl BootstrapPaths {
    /// Resolve and create all required directories.
    ///
    /// `RHEOLAB_E2E_DB_PATH` overrides the default database location so the
    /// E2E harness can test against a pre-seeded DB.
    pub fn resolve(app_data_dir: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        std::fs::create_dir_all(&app_data_dir)?;

        let backups_dir = app_data_dir.join("backups");
        std::fs::create_dir_all(&backups_dir)?;

        let database_path = std::env::var("RHEOLAB_E2E_DB_PATH")
            .ok()
            .map(PathBuf::from)
            .unwrap_or_else(|| app_data_dir.join("rheolab.db"));

        Ok(Self {
            app_data_dir,
            backups_dir,
            database_path,
        })
    }
}

// ── Application state ────────────────────────────────────────────────────

/// Global application state
pub struct AppState {
    /// Path to the SQLite database
    pub database_path: PathBuf,
    /// Path to the backups directory
    pub backups_dir: PathBuf,
    /// Application data directory
    pub app_data_dir: PathBuf,
    /// SQLite connection pool (rusqlite + r2d2)
    pub db_pool: DbPool,
    /// Runtime scheduler for heavy report/import/maintenance jobs.
    pub job_scheduler: Arc<JobScheduler>,
    /// V2 License engine — authoritative source of license status
    pub license_engine: Option<LicenseEngine>,
    /// Result of the migration run at startup — used by lib.rs to emit the
    /// `startup_completed` event so the frontend can detect post-update runs.
    pub migration_result: MigrationResult,
}

impl AppState {
    /// Build application state from a resolved `app_data_dir` path.
    ///
    /// Stages: paths → pool → migrations → secrets migration → licensing.
    /// Each stage has clear error context so failures are diagnosable.
    ///
    /// Does **not** depend on `tauri::AppHandle` — call `app.path().app_data_dir()`
    /// in the setup closure and pass the result here.
    pub fn build(app_data_dir: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        // 1. Resolve & create directories
        let paths = BootstrapPaths::resolve(app_data_dir)?;
        tracing::info!("App data dir: {:?}", paths.app_data_dir);
        tracing::info!("Database path: {:?}", paths.database_path);
        tracing::info!("Backups dir: {:?}", paths.backups_dir);

        // 2. Create connection pool
        let db_pool = db::create_pool(&paths.database_path)?;

        // 3. Run schema migrations
        let migration_result = Self::run_migrations(&db_pool)?;
        tracing::info!("Database pool initialised, migrations applied");

        // 4. Migrate legacy XOR-obfuscated API keys to AES-256-GCM (F-04)
        Self::migrate_secrets(&db_pool, &paths.app_data_dir);

        // 5. Initialise the V2 license engine (local-only startup check)
        let license_engine = Self::init_licensing(&paths.app_data_dir, &db_pool);
        tracing::info!("License engine initialised (cache pre-populated from local DB)");

        Ok(Self {
            database_path: paths.database_path,
            backups_dir: paths.backups_dir,
            app_data_dir: paths.app_data_dir,
            db_pool,
            job_scheduler: Arc::new(JobScheduler::new()),
            license_engine,
            migration_result,
        })
    }

    // ── Private bootstrap stages ─────────────────────────────────────────

    fn run_migrations(pool: &DbPool) -> Result<MigrationResult, Box<dyn std::error::Error>> {
        let conn = pool
            .get()
            .map_err(|e| format!("Failed to get DB connection: {e}"))?;
        db::migration::run_migrations(&conn)
            .map_err(|e| format!("Failed to run migrations: {e}").into())
    }

    fn migrate_secrets(pool: &DbPool, app_data_dir: &Path) {
        // Proactively migrate all legacy XOR-obfuscated API keys to AES-256-GCM
        // so the weak XOR decode path is never exercised at runtime.
        crate::commands::api_keys::migrate_legacy_xor_keys(pool, app_data_dir);
    }

    fn init_licensing(app_data_dir: &Path, pool: &DbPool) -> Option<LicenseEngine> {
        // Pre-populate the cache from DB only — no network round-trip.
        // A full online check is launched as a background task in lib.rs.
        let engine = LicenseEngine::new(app_data_dir.to_path_buf());
        // block_in_place is safe here: we're inside Tauri's sync setup closure
        // on a tokio worker thread.
        let startup_result = tokio::task::block_in_place(|| {
            tauri::async_runtime::handle().block_on(engine.check_local_startup(pool))
        });
        engine.diag(&format!(
            "startup check result: status={:?}",
            startup_result.status
        ));
        Some(engine)
    }

    // ── Public helpers ───────────────────────────────────────────────────

    /// Get a pooled database connection, returning AppError::Pool on failure.
    pub fn pool_conn(&self) -> crate::error::Result<DbConn> {
        self.db_pool.get().map_err(crate::error::AppError::Pool)
    }
}
