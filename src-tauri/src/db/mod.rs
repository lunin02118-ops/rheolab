//! Database module — SQLite via rusqlite with r2d2 connection pool.
//!
//! Single source of truth for all Tauri command data storage.
//! Replaces the transitional JSON-file-per-domain pattern.

pub mod columnar;
pub mod migration;
pub mod migrations;
pub mod pool;
pub mod repositories;
pub mod touch_point_precompute;

pub use pool::{create_pool, DbConn, DbPool};
