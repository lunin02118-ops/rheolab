//! V2 data flow commands — ImportBatch, ExperimentPayload, ParserArtifact,
//! ReportArtifact, SearchProjectionLog, SyncOutbox, SyncInbox, MergeEvent,
//! ConflictRecord.
//!
//! These 9 tables exist in the DDL (migration.rs) but had zero data flow.
//! This module provides both:
//!   • `pub(crate)` helpers called from other command modules (experiments,
//!     reagents, parsing, reports) to populate the tables as side effects of
//!     existing CRUD operations, and
//!   • Tauri commands for querying / managing the data from the frontend.

mod helpers;
mod types;
mod import_batch;
mod artifacts;
mod search;
mod sync;
mod conflicts;
#[cfg(test)]
mod tests;

pub(crate) use helpers::*;
pub use types::*;
pub use import_batch::*;
pub use artifacts::*;
pub use search::*;
pub use sync::*;
pub use conflicts::*;
