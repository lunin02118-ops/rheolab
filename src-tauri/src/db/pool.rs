//! Connection pool for SQLite via r2d2.

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::OpenFlags;
use std::path::Path;
use std::time::Duration;

/// Type alias for the connection pool.
pub type DbPool = Pool<SqliteConnectionManager>;

/// Type alias for a pooled SQLite connection.
pub type DbConn = r2d2::PooledConnection<SqliteConnectionManager>;

/// Create a new SQLite connection pool with WAL mode, foreign keys, and busy timeout.
pub fn create_pool(db_path: &Path) -> Result<DbPool, Box<dyn std::error::Error>> {
    let manager = SqliteConnectionManager::file(db_path)
        .with_flags(
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .with_init(|conn| {
            conn.execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA foreign_keys = ON;
                 PRAGMA busy_timeout = 5000;
                 PRAGMA synchronous = NORMAL;
                 PRAGMA cache_size = -2000;
                 PRAGMA temp_store = MEMORY;
                 PRAGMA mmap_size = 67108864;",
            )?;
            Ok(())
        });

    // Single-user desktop app: 4 connections are sufficient.
    // Each connection reserves up to mmap_size (64 MB) of address space,
    // so 4 × 64 MB = 256 MB max (vs. previous 8 × 256 MB = 2 GB).
    let pool = Pool::builder()
        .max_size(4)
        .min_idle(Some(1))
        .connection_timeout(Duration::from_secs(10))
        .build(manager)?;

    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_pool_in_memory() {
        let dir = std::env::temp_dir().join("rheolab_pool_test");
        let _ = std::fs::create_dir_all(&dir);
        let db_path = dir.join("test.db");
        let pool = create_pool(&db_path).expect("pool creation should succeed");
        let conn = pool.get().expect("should get connection");
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |row| row.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
        let fk: i32 = conn
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .unwrap();
        assert_eq!(fk, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
