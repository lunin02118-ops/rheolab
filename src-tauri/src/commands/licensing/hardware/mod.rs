#![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
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
