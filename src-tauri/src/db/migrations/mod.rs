pub mod error;
pub mod r#trait;
pub mod v0001_initial;
pub mod v0002_touch_point_metrics;
pub mod v0003_multi_threshold_touch_point;
pub mod v0004_experiment_list_default_index;
pub mod v0005_reagent_and_testtype_indexes;
pub mod v0006_artifact_import_batch_indexes;
pub mod v0007_fk_indexes;
pub mod v0008_analysis_artifact;
pub mod v0009_experiment_list_projection;
pub mod v0010_experiment_rheology_parameters;

pub use error::MigrationError;
pub use r#trait::Migration;

use v0001_initial::V0001Initial;
use v0002_touch_point_metrics::V0002TouchPointMetrics;
use v0003_multi_threshold_touch_point::V0003MultiThresholdTouchPoint;
use v0004_experiment_list_default_index::V0004ExperimentListDefaultIndex;
use v0005_reagent_and_testtype_indexes::V0005ReagentAndTestTypeIndexes;
use v0006_artifact_import_batch_indexes::V0006ArtifactImportBatchIndexes;
use v0007_fk_indexes::V0007FkIndexes;
use v0008_analysis_artifact::V0008AnalysisArtifact;
use v0009_experiment_list_projection::V0009ExperimentListProjection;
use v0010_experiment_rheology_parameters::V0010ExperimentRheologyParameters;

/// Ordered registry of all schema migrations, applied oldest-first on startup.
///
/// When adding a new migration:
/// 1. Create `v000N_<description>.rs` implementing [`Migration`].
/// 2. Declare it with `pub mod v000N_<description>;` above.
/// 3. Append `&V000NYourMigration` to this slice — order must be ascending.
/// 4. Bump `CURRENT_SCHEMA_VERSION` in `db/migration.rs` to match the new
///    trailing version. Tests enforce `latest_registered_version()` equals
///    `CURRENT_SCHEMA_VERSION`.
pub static MIGRATIONS: &[&dyn Migration] = &[
    &V0001Initial,
    &V0002TouchPointMetrics,
    &V0003MultiThresholdTouchPoint,
    &V0004ExperimentListDefaultIndex,
    &V0005ReagentAndTestTypeIndexes,
    &V0006ArtifactImportBatchIndexes,
    &V0007FkIndexes,
    &V0008AnalysisArtifact,
    &V0009ExperimentListProjection,
    &V0010ExperimentRheologyParameters,
];

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
