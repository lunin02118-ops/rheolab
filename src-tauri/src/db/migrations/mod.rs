pub mod error;
pub mod r#trait;
pub mod v0001_initial;

pub use error::MigrationError;
pub use r#trait::Migration;

use v0001_initial::V0001Initial;

/// Ordered registry of all schema migrations, applied oldest-first on startup.
///
/// When adding a new migration:
/// 1. Create `v000N_<description>.rs` implementing [`Migration`].
/// 2. Declare it with `pub mod v000N_<description>;` above.
/// 3. Append `&V000NYourMigration` to this slice — order must be ascending.
pub static MIGRATIONS: &[&dyn Migration] = &[&V0001Initial];
