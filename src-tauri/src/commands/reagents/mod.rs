//! Reagents catalog commands — backed by rusqlite (ReagentCatalog table).
//!
//! Replaces the previous JSON store (`v2/reagents-catalog.json`) with direct
//! SQLite queries via the shared connection pool.

mod commands;
mod helpers;
mod seed_data;
mod types;

pub use commands::*;
pub use seed_data::*;
pub use types::*;
