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

mod artifacts;
mod conflicts;
mod helpers;
mod import_batch;
mod search;
mod sync;
#[cfg(test)]
mod tests;
mod types;

pub use artifacts::*;
pub use conflicts::*;
pub(crate) use helpers::*;
pub use import_batch::*;
pub use search::*;
pub use sync::*;
pub use types::*;
