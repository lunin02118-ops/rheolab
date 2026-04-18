//! Repository layer for Experiment persistence.
//!
//! Provides the [`ExperimentRepository`] trait and its SQLite implementation
//! [`SqliteExperimentRepository`].  All SQL for experiment CRUD lives in the sub-modules
//! below; command handlers in `commands::experiments` remain thin orchestrators.
//!
//! ## Module layout
//! | Sub-module | Contents |
//! |------------|----------|
//! | `write`    | `persist_experiment` — single upsert + columnar blob + reagents |
//! | `read`     | `load_experiment_by_id`, `load_experiments_batch`, `find_duplicate` |
//! | `delete`   | `delete_experiment` |

use crate::commands::experiments::types::StoredExperiment;
use crate::error::Result;

mod delete;
mod read;
mod write;

pub(crate) use delete::delete_experiment;
pub(crate) use read::{find_duplicate, load_experiment_by_id, load_experiments_batch};
pub(crate) use write::persist_experiment;

// ── Trait ─────────────────────────────────────────────────────────────────────

/// Repository interface for Experiment persistence operations.
pub trait ExperimentRepository {
    fn save(&self, conn: &rusqlite::Connection, exp: &StoredExperiment) -> Result<()>;
    fn find_by_id(
        &self,
        conn: &rusqlite::Connection,
        id: &str,
    ) -> Result<Option<StoredExperiment>>;
    fn find_duplicate(
        &self,
        conn: &rusqlite::Connection,
        filename: &str,
        date: &str,
        name: &str,
    ) -> Result<Option<(String, String)>>;
    fn delete(&self, conn: &rusqlite::Connection, id: &str) -> Result<bool>;
}

// ── Default SQLite implementation ─────────────────────────────────────────────

/// SQLite-backed implementation of [`ExperimentRepository`].
pub struct SqliteExperimentRepository;

impl ExperimentRepository for SqliteExperimentRepository {
    fn save(&self, conn: &rusqlite::Connection, exp: &StoredExperiment) -> Result<()> {
        persist_experiment(conn, exp)
    }

    fn find_by_id(
        &self,
        conn: &rusqlite::Connection,
        id: &str,
    ) -> Result<Option<StoredExperiment>> {
        load_experiment_by_id(conn, id)
    }

    fn find_duplicate(
        &self,
        conn: &rusqlite::Connection,
        filename: &str,
        date: &str,
        name: &str,
    ) -> Result<Option<(String, String)>> {
        find_duplicate(conn, filename, date, name)
    }

    fn delete(&self, conn: &rusqlite::Connection, id: &str) -> Result<bool> {
        delete_experiment(conn, id)
    }
}
