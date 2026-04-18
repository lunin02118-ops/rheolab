//! Legacy v1 machine-ID support for backward-compatible activation migration.
//!
//! The v1 algorithm used: disk serial + motherboard UUID + BIOS serial
//! with salt `"rheolab-hw-"`, raw case (no normalisation), and the first
//! enumerated disk (which could be USB).
//!
//! These functions are **only** used to migrate legacy server records that
//! were activated with the old algorithm.

use sha2::{Digest, Sha256};

use super::super::types::HW_SALT;
use super::collectors::{get_bios_serial_raw, get_first_disk_serial_raw, get_motherboard_uuid_raw};
use super::LEGACY_IDS_CACHE;

/// Read the legacy `.machine_id_hw` cache file (v1 algorithm).
///
/// If present, this is the exact ID that was sent to the server during
/// the original activation.  Returns `None` if the file doesn't exist.
fn read_legacy_cached_id(app_data_dir: &std::path::Path) -> Option<String> {
    let path = app_data_dir.join(".machine_id_hw");
    let id = std::fs::read_to_string(&path).ok()?;
    let id = id.trim().to_string();
    if !id.is_empty() && id.len() == 32 {
        Some(id)
    } else {
        None
    }
}

/// Delete the legacy v1 cache file after successful migration.
pub fn delete_legacy_cache(app_data_dir: &std::path::Path) {
    let _ = std::fs::remove_file(app_data_dir.join(".machine_id_hw"));
}

/// Compute legacy machine IDs using the old v1 algorithm.
///
/// Returns 0–2 candidate IDs that may have been registered on the server
/// by older app versions. The caller should try each during legacy migration.
fn compute_legacy_machine_ids() -> Vec<String> {
    let disk = get_first_disk_serial_raw();
    let mobo = get_motherboard_uuid_raw();
    let bios = get_bios_serial_raw();

    let mut ids = Vec::new();

    // Variant 1: disk + mobo + bios (full v1)
    {
        let components: Vec<&str> = [disk.as_str(), mobo.as_str(), bios.as_str()]
            .into_iter()
            .filter(|c| !c.is_empty())
            .collect();
        if !components.is_empty() {
            let combined = components.join("|");
            let mut hasher = Sha256::new();
            hasher.update(format!("{}{}", HW_SALT, combined));
            let result = hasher.finalize();
            ids.push(format!("{:x}", result)[..32].to_string());
        }
    }

    // Variant 2: disk + mobo only (BIOS was often empty in old versions)
    if !bios.is_empty() {
        let components: Vec<&str> = [disk.as_str(), mobo.as_str()]
            .into_iter()
            .filter(|c| !c.is_empty())
            .collect();
        if !components.is_empty() {
            let combined = components.join("|");
            let mut hasher = Sha256::new();
            hasher.update(format!("{}{}", HW_SALT, combined));
            let result = hasher.finalize();
            let id = format!("{:x}", result)[..32].to_string();
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }

    ids
}

/// Collect ALL legacy candidate IDs: cached v1 file + computed v1 variants.
///
/// The cached v1 file is the most reliable — it's exactly what was sent to
/// the server.  Computed variants handle the case where the cache was lost
/// but the same hardware is still present.
///
/// Results are memoized in a process-level `OnceLock` — legacy hardware IDs
/// never change during a process lifetime.
pub fn all_legacy_ids(app_data_dir: &std::path::Path) -> Vec<String> {
    if let Some(ids) = LEGACY_IDS_CACHE.get() {
        return ids.clone();
    }

    let ids = compute_all_legacy_ids_inner(app_data_dir);
    LEGACY_IDS_CACHE.get_or_init(|| ids).clone()
}

fn compute_all_legacy_ids_inner(app_data_dir: &std::path::Path) -> Vec<String> {
    let mut ids = Vec::new();

    // Most reliable: the cached v1 file
    if let Some(cached) = read_legacy_cached_id(app_data_dir) {
        ids.push(cached);
    }

    // Computed from current hardware using v1 algorithm
    for id in compute_legacy_machine_ids() {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }

    ids
}
