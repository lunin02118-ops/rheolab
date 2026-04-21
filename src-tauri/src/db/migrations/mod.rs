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
/// 4. Bump `CURRENT_SCHEMA_VERSION` in `db/migration.rs` to match the new
///    trailing version. Tests enforce `latest_registered_version()` equals
///    `CURRENT_SCHEMA_VERSION`.
pub static MIGRATIONS: &[&dyn Migration] = &[&V0001Initial];

/// Returns the version of the last registered migration, or `0` if the
/// registry is empty (should never happen in release builds).
///
/// Used by the runner to pick the target schema version and by tests to
/// verify that `CURRENT_SCHEMA_VERSION` and the registry agree.
pub fn latest_registered_version() -> i64 {
    MIGRATIONS.last().map(|m| m.version()).unwrap_or(0)
}

/// Enforces registry invariants at startup and in tests:
///   * every version ≥ 1
///   * versions are strictly monotonically increasing
///   * versions are unique
///
/// Returns an error string instead of a typed error because the result is
/// only ever consumed by assertions — a failure here indicates a
/// developer-time mistake rather than a runtime condition.
pub fn validate_registry() -> Result<(), String> {
    let mut prev: i64 = 0;
    for (idx, m) in MIGRATIONS.iter().enumerate() {
        let v = m.version();
        if v < 1 {
            return Err(format!("MIGRATIONS[{}] has version {} (< 1)", idx, v));
        }
        if v <= prev {
            return Err(format!(
                "MIGRATIONS[{}] version {} is not strictly greater than the previous version {}",
                idx, v, prev
            ));
        }
        prev = v;
    }
    Ok(())
}
