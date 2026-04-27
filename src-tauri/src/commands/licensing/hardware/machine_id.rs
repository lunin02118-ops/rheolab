//! v2 machine-ID computation.
//!
//! The v2 algorithm is:
//! ```text
//! SHA-256("rheolab-hw-v2-" + cpu_id + "|" + mobo_uuid + "|" + bios_serial)[0..32]
//! ```
//!
//! The process-level cache in [`super::MACHINE_ID_CACHE`] means the real work
//! (three PowerShell spawns + SHA-256) runs at most once per process.

use sha2::{Digest, Sha256};

use super::cache::{read_cache, write_cache, MachineIdCache};
use super::collectors::{get_bios_serial, get_cpu_id, get_motherboard_uuid};
use super::MACHINE_ID_CACHE;

/// Salt prefix for the v2 algorithm.  Different from v1 (`"rheolab-hw-"`) to
/// guarantee no accidental collisions with old IDs.
const HW_SALT_V2: &str = "rheolab-hw-v2-";

/// Collect the three hardware components used in the v2 fingerprint.
///
/// Returns `(cpu_id, mobo_uuid, bios_serial)` — all sanitized + lowercased.
fn collect_hw_components() -> (String, String, String) {
    (get_cpu_id(), get_motherboard_uuid(), get_bios_serial())
}

/// SHA-256 hash of the raw component strings, used to validate the cache.
fn components_hash(cpu: &str, mobo: &str, bios: &str) -> String {
    let mut h = Sha256::new();
    h.update(cpu.as_bytes());
    h.update(b"|");
    h.update(mobo.as_bytes());
    h.update(b"|");
    h.update(bios.as_bytes());
    let r = h.finalize();
    format!("{:x}", r)
}

/// Compute the v2 machine ID deterministically from `(cpu, mobo, bios)`.
pub(crate) fn compute_v2_id(cpu: &str, mobo: &str, bios: &str) -> Option<String> {
    let parts: Vec<&str> = [cpu, mobo, bios]
        .into_iter()
        .filter(|c| !c.is_empty())
        .collect();
    if parts.is_empty() {
        return None;
    }
    let combined = parts.join("|");
    let mut hasher = Sha256::new();
    hasher.update(format!("{}{}", HW_SALT_V2, combined));
    let result = hasher.finalize();
    Some(format!("{:x}", result)[..32].to_string())
}

/// Compute the hardware machine ID (v2 algorithm).
///
/// **Fast path** (normal repeated calls): returns the process-level
/// `OnceLock` value — zero I/O, zero PowerShell.
///
/// **First call in this process**:
/// 1. Try the on-disk verification cache (`.machine_id_v2`) — if valid,
///    store in `OnceLock` and return.  Cost: one file read, **no** PowerShell.
/// 2. On cache miss, spawn 3 PowerShell processes (`Get-CimInstance`),
///    compute the ID, write cache, store in `OnceLock`.
///
/// ### Security
/// The cache contains a `components_hash` that is verified against live
/// hardware on demand (see `verify_machine_id`).  Copying the cache file
/// to another machine won't help — the hash won't match.
///
/// ### Fallback
/// If *no* hardware component is available (extreme VM scenario), a random
/// UUID-v4 is generated and cached.
pub fn get_or_create_machine_id(app_data_dir: &std::path::Path) -> String {
    // Process-level fast path — no I/O at all after the first call
    if let Some(id) = MACHINE_ID_CACHE.get() {
        return id.clone();
    }

    let id = compute_machine_id_inner(app_data_dir);
    // Store in OnceLock; if another thread raced us, use their value
    MACHINE_ID_CACHE.get_or_init(|| id).clone()
}

/// Inner computation: disk cache first, then PowerShell fallback.
fn compute_machine_id_inner(app_data_dir: &std::path::Path) -> String {
    // Collect live hardware (spawns 3 PowerShell processes on first call per process)
    let (cpu, mobo, bios) = collect_hw_components();
    let live_hash = components_hash(&cpu, &mobo, &bios);

    // Check on-disk cache: if the components_hash matches, hardware hasn't changed
    // since the last run.  The cache never stores the ID itself (S-4).
    let cache_fresh =
        read_cache(app_data_dir).is_some_and(|c| c.version == 2 && c.components_hash == live_hash);

    if !cache_fresh {
        tracing::info!("Machine ID cache: miss or stale — will write new cache");
    }

    let id = match compute_v2_id(&cpu, &mobo, &bios) {
        Some(id) => id,
        None => {
            tracing::warn!("Machine ID: no hardware components available, using random UUID v4");
            uuid::Uuid::new_v4().to_string().replace('-', "")
        }
    };

    #[cfg(debug_assertions)]
    {
        tracing::debug!(
            "[hw-id-v2] cpu={:?}  mobo={:?}  bios={:?}  → id={}",
            cpu,
            mobo,
            bios,
            id
        );
    }

    // Write cache only when stale — avoids unnecessary disk writes
    if !cache_fresh {
        write_cache(
            app_data_dir,
            &MachineIdCache {
                components_hash: live_hash,
                version: 2,
            },
        );
    }

    id
}
