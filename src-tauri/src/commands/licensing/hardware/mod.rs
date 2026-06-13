#![cfg_attr(
    not(test),
    warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]
//! Hardware identification — CPU / motherboard / BIOS fingerprinting.
//!
//! ## v2 algorithm (current)
//!
//! Machine ID is `SHA-256("rheolab-hw-v2-" + cpu_id + "|" + mobo_uuid + "|" + bios_serial)[0..32]`.
//!
//! **All three components live in firmware / silicon** and are completely
//! independent of disks, USB devices, or any software state.  They survive
//! any OS reinstall, disk swap, or registry wipe on the same hardware.
//!
//! | Component | WMI class | Property | What it identifies |
//! |---|---|---|---|
//! | **CPU ID** | `Win32_Processor` | `ProcessorId` | CPUID — unique per CPU model+stepping |
//! | **Motherboard UUID** | `Win32_ComputerSystemProduct` | `UUID` | SMBIOS type-1, burned into BIOS |
//! | **BIOS serial** | `Win32_BIOS` | `SerialNumber` | SMBIOS type-0, mainboard serial |
//!
//! ### Security
//! - **No file cache as primary source**: machine ID is *always* recomputed from
//!   hardware.  A verification cache (`.machine_id_v2`) is kept only for performance;
//!   it contains a `components_hash` that is re-validated on each access.  Copying
//!   the file to another machine has no effect — the hash won't match the real
//!   hardware and the ID will be recomputed.
//!
//! ### Migration
//! The old v1 algorithm used disk serial + mobo UUID + BIOS serial with a different
//! salt (`HW_SALT = "rheolab-hw-"`).  Functions `compute_legacy_machine_ids()` and
//! `read_legacy_cached_id()` remain for backward-compatible machine-ID migration.
//!
//! # Module layout
//! - [`collectors`] — PowerShell invocations + bogus-value filter
//! - [`cache`]      — AES-256-GCM encrypted freshness cache (`.machine_id_v2`)
//! - [`machine_id`] — v2 salt + hashing + `get_or_create_machine_id`
//! - [`legacy`]     — v1 algorithm support for activation migration

use std::sync::OnceLock;

mod cache;
mod collectors;
mod legacy;
mod machine_id;

// ── Re-exports forming the crate-level `hardware::` API ────────────────

pub use legacy::{all_legacy_ids, delete_legacy_cache};
pub use machine_id::get_or_create_machine_id;

/// Debug snapshot of the v2 machine-ID inputs.  Used by the
/// `licensing_debug_fingerprint` Tauri command so the user (or support) can
/// verify that two launches on the *same hardware* produce the same
/// fingerprint — critical for diagnosing "license didn't recover after OS
/// reinstall" complaints.
///
/// Raw component values are returned in lowercase, after the standard OEM
/// bogus-value filter (so a genuine blank field shows as empty string rather
/// than "to be filled by o.e.m.").  The final `id` is the canonical 32-hex
/// fingerprint actually used for licensing.
#[derive(Debug, serde::Serialize)]
pub struct FingerprintDebugInfo {
    /// Final v2 machine ID (SHA-256[0..32] of salted cpu|mobo|bios).
    pub id: String,
    /// Raw CPU `ProcessorId` from `Win32_Processor`, sanitized + lowercased.
    pub cpu_id: String,
    /// Raw motherboard UUID from `Win32_ComputerSystemProduct`, sanitized.
    pub motherboard_uuid: String,
    /// Raw BIOS `SerialNumber` from `Win32_BIOS`, sanitized.
    pub bios_serial: String,
    /// Legacy v1 IDs that may still be on the server (for activation migration).
    pub legacy_ids: Vec<String>,
}

/// Gather the three hardware components + the derived machine ID so a Tauri
/// command can surface them to the UI for diagnostics.
pub fn debug_fingerprint_info(app_data_dir: &std::path::Path) -> FingerprintDebugInfo {
    let cpu_id = collectors::get_cpu_id_pub();
    let motherboard_uuid = collectors::get_motherboard_uuid_pub();
    let bios_serial = collectors::get_bios_serial_pub();
    let id = get_or_create_machine_id(app_data_dir);
    let legacy_ids = all_legacy_ids(app_data_dir);
    FingerprintDebugInfo {
        id,
        cpu_id,
        motherboard_uuid,
        bios_serial,
        legacy_ids,
    }
}

// Items re-exported at this module level so that the existing test file
// (`hardware_tests.rs`) can continue to use `use super::*;`.
#[cfg(test)]
pub(crate) use super::types::HW_SALT;
#[cfg(test)]
pub(crate) use cache::{read_cache, CACHE_FILE};
#[cfg(test)]
pub(crate) use collectors::sanitize;
#[cfg(test)]
pub(crate) use machine_id::compute_v2_id;
#[cfg(test)]
pub(crate) use sha2::{Digest, Sha256};

// ── Process-level caches (shared across sub-modules) ───────────────────

/// Process-level cache for the v2 machine ID.  Hardware doesn't change
/// during a single process lifetime, so we compute once and reuse.
pub(super) static MACHINE_ID_CACHE: OnceLock<String> = OnceLock::new();

/// Process-level cache for legacy (v1) machine IDs.
pub(super) static LEGACY_IDS_CACHE: OnceLock<Vec<String>> = OnceLock::new();

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "../hardware_tests.rs"]
mod tests;
