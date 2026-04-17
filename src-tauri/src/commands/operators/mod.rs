//! Operator management commands — backed by SQLite Operator table.
//!
//! Operators are lab personnel whose names appear in the save-experiment dropdown.
//! They are created/managed in Settings → Общие.

mod commands;
mod types;

pub use commands::*;
pub use types::*;
