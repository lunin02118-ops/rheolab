use thiserror::Error;

/// Error type for schema migration operations.
#[derive(Debug, Error)]
pub enum MigrationError {
    /// A SQLite operation failed during migration DDL or DML.
    #[error("database error during migration: {0}")]
    Sqlite(#[from] rusqlite::Error),
}
