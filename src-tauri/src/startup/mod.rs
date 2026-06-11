//! Startup orchestration: logging, application setup, and IPC command registry.
//!
//! The `run()` entry point in `lib.rs` composes these pieces; moving them out
//! of `lib.rs` keeps the top-level file focused on the Tauri builder chain.

pub mod commands_registry;
pub mod crash_reporter;
pub mod logging;
pub mod setup;
