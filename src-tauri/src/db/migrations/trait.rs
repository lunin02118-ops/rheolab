use rusqlite::Connection;
use super::error::MigrationError;

/// A single, versioned schema migration applied in monotonic order.
///
/// Implementations must be idempotent: every DDL statement inside `up()`
/// must use `IF NOT EXISTS` / `OR IGNORE` so the method is safe to call on
/// repeated application starts.
pub trait Migration: Send + Sync {
    /// Monotonically-increasing schema version introduced by this migration.
    fn version(&self) -> i64;

    /// Apply the migration DDL/DML to `conn`.
    ///
    /// Called once per startup before any user-facing code runs.
    /// Implementors must not assume an empty database: the existing schema
    /// may already contain tables from a previous run.
    fn up(&self, conn: &Connection) -> Result<(), MigrationError>;
}
