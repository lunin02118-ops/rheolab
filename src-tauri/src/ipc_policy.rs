//! Static IPC command policy inventory.
//!
//! This module is intentionally read-only metadata for now. It does not change
//! Tauri command registration or runtime authorization behavior; it makes the
//! current IPC surface auditable and testable as a prerequisite for stricter
//! policy enforcement in later slices.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IpcRisk {
    Low,
    Medium,
    High,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IpcPayloadClass {
    Tiny,
    Small,
    Medium,
    LargeBinaryByDesign,
    ProhibitedLargeJson,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IpcCommandCapabilities {
    pub allows_external_network: bool,
    pub allows_file_read: bool,
    pub allows_file_write: bool,
    pub allows_db_read: bool,
    pub allows_db_write: bool,
    pub returns_binary: bool,
}

impl IpcCommandCapabilities {
    pub const NONE: Self = Self {
        allows_external_network: false,
        allows_file_read: false,
        allows_file_write: false,
        allows_db_read: false,
        allows_db_write: false,
        returns_binary: false,
    };

    pub const fn external_network(mut self) -> Self {
        self.allows_external_network = true;
        self
    }

    pub const fn file_read(mut self) -> Self {
        self.allows_file_read = true;
        self
    }

    pub const fn file_write(mut self) -> Self {
        self.allows_file_write = true;
        self
    }

    pub const fn db_read(mut self) -> Self {
        self.allows_db_read = true;
        self
    }

    pub const fn db_write(mut self) -> Self {
        self.allows_db_write = true;
        self
    }

    pub const fn binary_response(mut self) -> Self {
        self.returns_binary = true;
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IpcCommandPolicy {
    pub name: &'static str,
    pub risk: IpcRisk,
    pub requires_license: bool,
    pub requires_audit_log: bool,
    pub audit_log_exception: Option<&'static str>,
    pub allowed_in_demo: bool,
    pub capabilities: IpcCommandCapabilities,
    pub max_payload_class: IpcPayloadClass,
}

impl IpcCommandPolicy {
    pub const fn new(
        name: &'static str,
        risk: IpcRisk,
        capabilities: IpcCommandCapabilities,
        max_payload_class: IpcPayloadClass,
    ) -> Self {
        Self {
            name,
            risk,
            requires_license: false,
            requires_audit_log: false,
            audit_log_exception: None,
            allowed_in_demo: true,
            capabilities,
            max_payload_class,
        }
    }

    pub const fn requires_license(mut self) -> Self {
        self.requires_license = true;
        self
    }

    pub const fn denied_in_demo(mut self) -> Self {
        self.allowed_in_demo = false;
        self
    }

    pub const fn requires_audit_log(mut self) -> Self {
        self.requires_audit_log = true;
        self
    }

    pub const fn audit_log_exception(mut self, reason: &'static str) -> Self {
        self.audit_log_exception = Some(reason);
        self
    }

    pub const fn allowed_in_demo(mut self) -> Self {
        self.allowed_in_demo = true;
        self
    }
}

const NONE: IpcCommandCapabilities = IpcCommandCapabilities::NONE;
const DB_READ: IpcCommandCapabilities = NONE.db_read();
const DB_WRITE: IpcCommandCapabilities = NONE.db_read().db_write();
const FILE_READ: IpcCommandCapabilities = NONE.file_read();
const FILE_WRITE: IpcCommandCapabilities = NONE.file_write();
const FILE_READ_DB_WRITE: IpcCommandCapabilities = NONE.file_read().db_read().db_write();
const FILE_READ_WRITE_DB_WRITE: IpcCommandCapabilities =
    NONE.file_read().file_write().db_read().db_write();
const FILE_WRITE_DB_READ: IpcCommandCapabilities = NONE.file_write().db_read();
const FILE_WRITE_DB_WRITE: IpcCommandCapabilities = NONE.file_write().db_read().db_write();
const NETWORK_DB_READ: IpcCommandCapabilities = NONE.external_network().db_read();
const NETWORK_DB_WRITE: IpcCommandCapabilities = NONE.external_network().db_read().db_write();
const BINARY_DB_READ: IpcCommandCapabilities = NONE.db_read().binary_response();

const fn low(name: &'static str) -> IpcCommandPolicy {
    IpcCommandPolicy::new(name, IpcRisk::Low, NONE, IpcPayloadClass::Tiny)
}

const fn read(name: &'static str) -> IpcCommandPolicy {
    IpcCommandPolicy::new(name, IpcRisk::Low, DB_READ, IpcPayloadClass::Small)
}

const fn medium(
    name: &'static str,
    capabilities: IpcCommandCapabilities,
    payload: IpcPayloadClass,
) -> IpcCommandPolicy {
    IpcCommandPolicy::new(name, IpcRisk::Medium, capabilities, payload)
}

const fn high(
    name: &'static str,
    capabilities: IpcCommandCapabilities,
    payload: IpcPayloadClass,
) -> IpcCommandPolicy {
    IpcCommandPolicy::new(name, IpcRisk::High, capabilities, payload).requires_audit_log()
}

pub const IPC_COMMAND_POLICIES: &[IpcCommandPolicy] = &[
    // Backup commands.
    medium("backup_list", FILE_READ, IpcPayloadClass::Small),
    high("backup_create", FILE_WRITE_DB_READ, IpcPayloadClass::Small).requires_license(),
    high(
        "backup_restore",
        FILE_WRITE_DB_WRITE,
        IpcPayloadClass::Small,
    )
    .requires_license(),
    high("backup_delete", FILE_WRITE, IpcPayloadClass::Small).requires_license(),
    medium("backup_open_folder", FILE_READ, IpcPayloadClass::Small),
    high(
        "backup_import_db",
        FILE_READ_WRITE_DB_WRITE,
        IpcPayloadClass::Small,
    )
    .requires_license(),
    high(
        "backup_export_db",
        FILE_WRITE_DB_READ,
        IpcPayloadClass::Small,
    )
    .requires_license(),
    // API key commands.
    read("api_keys_list"),
    high("api_keys_create", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    high("api_keys_set_active", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    high("api_keys_delete", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    read("api_keys_active"),
    medium(
        "api_keys_check_active",
        NETWORK_DB_READ,
        IpcPayloadClass::Small,
    ),
    medium("api_keys_validate", NETWORK_DB_READ, IpcPayloadClass::Small),
    // Experiment commands.
    read("experiments_list"),
    read("experiments_count"),
    read("experiments_get"),
    read("experiments_detail_meta_by_id"),
    read("experiments_raw_table_page_by_id"),
    read("experiments_get_batch"),
    read("experiments_check_existence"),
    high("experiments_save", DB_WRITE, IpcPayloadClass::Medium).requires_license(),
    high("experiments_delete", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    read("experiments_last_context"),
    read("experiments_water_sources"),
    read("experiments_filter_metadata"),
    read("experiments_export_laboratories"),
    high(
        "experiments_export_to_file",
        FILE_WRITE_DB_READ,
        IpcPayloadClass::Medium,
    )
    .requires_license(),
    high("experiments_import", DB_WRITE, IpcPayloadClass::Medium).requires_license(),
    // Binary chart series commands.
    read("experiments_series_meta"),
    medium(
        "experiments_series_overview",
        BINARY_DB_READ,
        IpcPayloadClass::LargeBinaryByDesign,
    ),
    medium(
        "experiments_series_window",
        BINARY_DB_READ,
        IpcPayloadClass::LargeBinaryByDesign,
    ),
    read("series_decode_cache_stats"),
    // Catalog/personnel/lab commands.
    read("reagents_list"),
    high("reagents_create", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    high("reagents_update", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    high("reagents_delete", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    medium("reagents_export", DB_READ, IpcPayloadClass::Small),
    high("reagents_import", DB_WRITE, IpcPayloadClass::Medium).requires_license(),
    high("reagents_seed", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    read("operators_list"),
    high("operators_create", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    high("operators_update", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    high("operators_delete", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    read("laboratories_list"),
    high("laboratories_create", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    high("laboratories_update", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    high("laboratories_delete", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    // Fixtures and parsing.
    medium("test_fixtures_list", FILE_READ, IpcPayloadClass::Small),
    medium("test_fixtures_read", FILE_READ, IpcPayloadClass::Medium),
    medium("test_fixtures_parse", FILE_READ, IpcPayloadClass::Medium),
    high(
        "parsing_parse_file",
        FILE_READ.external_network(),
        IpcPayloadClass::Medium,
    ),
    low("parsing_release_cache"),
    low("parsing_cache_stats"),
    // Reports.
    medium(
        "reports_generate_pdf",
        BINARY_DB_READ,
        IpcPayloadClass::LargeBinaryByDesign,
    )
    .requires_license(),
    medium(
        "reports_generate_excel",
        BINARY_DB_READ,
        IpcPayloadClass::LargeBinaryByDesign,
    )
    .requires_license(),
    medium(
        "reports_generate_pdf_by_id",
        BINARY_DB_READ,
        IpcPayloadClass::LargeBinaryByDesign,
    )
    .requires_license(),
    medium(
        "reports_generate_excel_by_id",
        BINARY_DB_READ,
        IpcPayloadClass::LargeBinaryByDesign,
    )
    .requires_license(),
    medium(
        "reports_generate_comparison_pdf_by_ids",
        BINARY_DB_READ,
        IpcPayloadClass::LargeBinaryByDesign,
    )
    .requires_license(),
    medium(
        "reports_generate_comparison_excel_by_ids",
        BINARY_DB_READ,
        IpcPayloadClass::LargeBinaryByDesign,
    )
    .requires_license(),
    // Jobs, analysis cache, and native analysis.
    read("jobs_list"),
    read("jobs_get"),
    medium("jobs_cancel", NONE, IpcPayloadClass::Small),
    read("analysis_cache_stats"),
    high("analysis_cache_prune", DB_WRITE, IpcPayloadClass::Small).requires_audit_log(),
    read("experiments_projection_status"),
    high(
        "experiments_projection_rebuild",
        DB_WRITE,
        IpcPayloadClass::Small,
    )
    .requires_audit_log(),
    medium("analysis_analyze_full", NONE, IpcPayloadClass::Medium),
    medium(
        "analysis_analyze_experiment_by_id",
        DB_WRITE,
        IpcPayloadClass::Small,
    ),
    medium("analysis_detect_steps", NONE, IpcPayloadClass::Medium),
    medium("analysis_regroup_by_pattern", NONE, IpcPayloadClass::Medium),
    // Renderer logging and window polish.
    low("log_info"),
    low("log_error"),
    low("window_set_theme_chrome"),
    // Licensing.
    medium("licensing_machine_id", NONE, IpcPayloadClass::Small),
    high("licensing_debug_fingerprint", NONE, IpcPayloadClass::Small).requires_audit_log(),
    read("licensing_was_ever_licensed"),
    high("licensing_checkpoint_db", DB_WRITE, IpcPayloadClass::Small).requires_audit_log(),
    high(
        "licensing_reset_experiments",
        DB_WRITE,
        IpcPayloadClass::Small,
    )
    .requires_audit_log(),
    high(
        "licensing_reset_all_experiments",
        DB_WRITE,
        IpcPayloadClass::Small,
    )
    .requires_audit_log(),
    medium("licensing_check", NETWORK_DB_READ, IpcPayloadClass::Small),
    read("licensing_get_status"),
    high(
        "licensing_activate_full",
        NETWORK_DB_WRITE,
        IpcPayloadClass::Small,
    )
    .requires_audit_log(),
    high(
        "licensing_offline_activation_request",
        NONE,
        IpcPayloadClass::Small,
    )
    .requires_audit_log(),
    high(
        "licensing_activate_offline",
        DB_WRITE,
        IpcPayloadClass::Small,
    )
    .requires_audit_log(),
    high(
        "licensing_deactivate",
        NETWORK_DB_WRITE,
        IpcPayloadClass::Small,
    )
    .requires_audit_log(),
    read("licensing_can_save"),
    high(
        "licensing_register_experiment",
        DB_WRITE,
        IpcPayloadClass::Small,
    )
    .requires_audit_log(),
    low("get_update_channel"),
    low("is_e2e_mode"),
    low("is_updater_disabled"),
    // Data-flow and sync artifact commands.
    read("import_batches_list"),
    read("import_batches_get"),
    read("experiment_payloads_list"),
    read("parser_artifacts_list"),
    read("parser_artifacts_get"),
    read("report_artifacts_list"),
    high("report_artifacts_save", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    high("report_artifacts_delete", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    read("search_projections_list"),
    read("sync_status"),
    read("sync_outbox_list"),
    high("sync_outbox_mark_synced", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    high("sync_outbox_retry", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    high("sync_inbox_receive", DB_WRITE, IpcPayloadClass::Medium).requires_license(),
    read("sync_inbox_list"),
    read("conflicts_list"),
    high("conflicts_resolve", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    // File-based sync engine.
    high(
        "sync_export_delta",
        FILE_WRITE_DB_READ,
        IpcPayloadClass::Medium,
    )
    .requires_license(),
    high(
        "sync_import_delta",
        FILE_READ_DB_WRITE,
        IpcPayloadClass::Medium,
    )
    .requires_license(),
    high("sync_resolve_conflict", DB_WRITE, IpcPayloadClass::Small).requires_license(),
    read("sync_list_conflicts"),
];

pub fn policy_for_command(name: &str) -> Option<&'static IpcCommandPolicy> {
    IPC_COMMAND_POLICIES
        .iter()
        .find(|policy| policy.name == name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn registered_command_names() -> BTreeSet<&'static str> {
        include_str!("startup/commands_registry.rs")
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim();
                let path = trimmed
                    .strip_prefix("$crate::commands::")?
                    .strip_suffix(',')?;
                path.rsplit("::").next()
            })
            .collect()
    }

    fn policy_names() -> BTreeSet<&'static str> {
        IPC_COMMAND_POLICIES
            .iter()
            .map(|policy| policy.name)
            .collect()
    }

    #[test]
    fn every_registered_command_has_policy_entry() {
        let registered = registered_command_names();
        let policies = policy_names();
        let missing = registered
            .difference(&policies)
            .copied()
            .collect::<Vec<_>>();
        let extra = policies
            .difference(&registered)
            .copied()
            .collect::<Vec<_>>();

        assert!(missing.is_empty(), "missing IPC policies: {missing:?}");
        assert!(
            extra.is_empty(),
            "policy entries not in registry: {extra:?}"
        );
    }

    #[test]
    fn policy_names_are_unique() {
        assert_eq!(policy_names().len(), IPC_COMMAND_POLICIES.len());
    }

    #[test]
    fn high_risk_commands_require_audit_log_or_exception() {
        let violations = IPC_COMMAND_POLICIES
            .iter()
            .filter(|policy| {
                policy.risk == IpcRisk::High
                    && !policy.requires_audit_log
                    && policy.audit_log_exception.is_none()
            })
            .map(|policy| policy.name)
            .collect::<Vec<_>>();

        assert!(
            violations.is_empty(),
            "high-risk commands without audit logging policy: {violations:?}"
        );
    }

    #[test]
    fn file_write_commands_are_not_low_risk() {
        let violations = IPC_COMMAND_POLICIES
            .iter()
            .filter(|policy| policy.capabilities.allows_file_write && policy.risk == IpcRisk::Low)
            .map(|policy| policy.name)
            .collect::<Vec<_>>();

        assert!(
            violations.is_empty(),
            "file-write commands marked low risk: {violations:?}"
        );
    }

    #[test]
    fn external_network_commands_are_marked() {
        let expected = [
            "api_keys_check_active",
            "api_keys_validate",
            "parsing_parse_file",
            "licensing_check",
            "licensing_activate_full",
            "licensing_deactivate",
        ];

        for name in expected {
            let policy = policy_for_command(name).expect("policy exists");
            assert!(
                policy.capabilities.allows_external_network,
                "{name} must be marked as external-network capable"
            );
        }
    }

    #[test]
    fn file_write_commands_are_marked() {
        let expected = [
            "backup_create",
            "backup_restore",
            "backup_delete",
            "backup_import_db",
            "backup_export_db",
            "experiments_export_to_file",
            "sync_export_delta",
        ];

        for name in expected {
            let policy = policy_for_command(name).expect("policy exists");
            assert!(
                policy.capabilities.allows_file_write,
                "{name} must be marked as file-write capable"
            );
        }
    }

    #[test]
    fn large_binary_payloads_return_binary() {
        let violations = IPC_COMMAND_POLICIES
            .iter()
            .filter(|policy| policy.max_payload_class == IpcPayloadClass::LargeBinaryByDesign)
            .filter(|policy| !policy.capabilities.returns_binary)
            .map(|policy| policy.name)
            .collect::<Vec<_>>();

        assert!(
            violations.is_empty(),
            "large-binary policies without binary return marker: {violations:?}"
        );
    }

    #[test]
    fn requires_license_does_not_change_demo_policy() {
        let policy = medium("example_command", DB_READ, IpcPayloadClass::Small).requires_license();

        assert!(policy.requires_license);
        assert!(
            policy.allowed_in_demo,
            "license metadata must not imply demo denial"
        );
    }

    #[test]
    fn demo_denial_is_explicit_policy_metadata() {
        let policy = medium("example_command", DB_READ, IpcPayloadClass::Small)
            .requires_license()
            .denied_in_demo();

        assert!(policy.requires_license);
        assert!(!policy.allowed_in_demo);
    }

    #[test]
    fn production_registry_excludes_direct_comparison_payload_commands() {
        let registered = registered_command_names();
        let forbidden = [
            "reports_generate_comparison_pdf",
            "reports_generate_comparison_excel",
        ];

        for name in forbidden {
            assert!(
                !registered.contains(name),
                "{name} must not be exposed in the production command registry"
            );
            assert!(
                policy_for_command(name).is_none(),
                "{name} must not have production IPC policy metadata"
            );
        }
    }

    #[test]
    fn by_ids_comparison_export_commands_remain_registered() {
        let registered = registered_command_names();
        let expected = [
            "reports_generate_comparison_pdf_by_ids",
            "reports_generate_comparison_excel_by_ids",
        ];

        for name in expected {
            assert!(
                registered.contains(name),
                "{name} must remain exposed for production comparison export"
            );
            let policy = policy_for_command(name).expect("policy exists");
            assert_eq!(
                policy.max_payload_class,
                IpcPayloadClass::LargeBinaryByDesign
            );
            assert!(policy.capabilities.returns_binary);
            assert!(policy.requires_license);
            assert!(
                policy.allowed_in_demo,
                "{name} license metadata must not imply demo denial"
            );
        }
    }
}
