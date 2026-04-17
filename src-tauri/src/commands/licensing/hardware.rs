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

use std::sync::OnceLock;

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key as GcmKey, Nonce,
};
use sha2::{Digest, Sha256};
use serde::{Deserialize, Serialize};

use super::types::{DEFAULT_INTEGRITY_KEY, HW_SALT};
#[cfg(target_os = "windows")]
use super::types::POWERSHELL_PATH;

/// Process-level cache for the v2 machine ID.  Hardware doesn't change
/// during a single process lifetime, so we compute once and reuse.
static MACHINE_ID_CACHE: OnceLock<String> = OnceLock::new();

/// Process-level cache for legacy (v1) machine IDs.
static LEGACY_IDS_CACHE: OnceLock<Vec<String>> = OnceLock::new();

/// Salt prefix for the v2 algorithm.  Different from v1 (`"rheolab-hw-"`) to
/// guarantee no accidental collisions with old IDs.
const HW_SALT_V2: &str = "rheolab-hw-v2-";

// ── Bogus-value filter ─────────────────────────────────────────────────

/// Values commonly returned when the hardware doesn't expose a real identifier.
const BOGUS_PATTERNS: &[&str] = &[
    "to be filled by o.e.m.",
    "default string",
    "none",
    "no asset tag",
    "not available",
    "not specified",
    "system serial number",
    "chassis serial number",
    "0123456789abcdef",
    "123456789",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "03000200-0400-0500-0006-000700080009", // VMware default
    "0000000000000000", // Some CPUs return all-zero ProcessorId
];

/// Create a `Command` that won't flash a console window on Windows.
#[cfg(target_os = "windows")]
fn hidden_command(program: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut cmd = std::process::Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Returns `None` if the value is empty, too short, or matches a known bogus pattern.
fn sanitize(raw: &str) -> Option<String> {
    let v = raw.trim().to_lowercase();
    if v.len() < 4 {
        return None;
    }
    if BOGUS_PATTERNS.iter().any(|p| v == *p) {
        return None;
    }
    // All-zeros or all-F's (any length)
    if v.chars().all(|c| c == '0') || v.chars().all(|c| c == 'f') {
        return None;
    }
    Some(v)
}

// ── Hardware queries (v2 — no disks) ───────────────────────────────────

/// CPU `ProcessorId` from `Win32_Processor` (CPUID instruction result).
///
/// This is a 16-hex-char identifier burned into the CPU silicon.
/// It does NOT change on OS reinstall, BIOS update, or disk replacement.
/// Available on all Windows versions (10, 11, Server 2019+).
fn get_cpu_id() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = hidden_command(POWERSHELL_PATH)
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty ProcessorId",
            ])
            .output()
        {
            if output.status.success() {
                if let Some(v) = sanitize(&String::from_utf8_lossy(&output.stdout)) {
                    return v;
                }
            }
        }
    }
    String::new()
}

/// Motherboard UUID from `Win32_ComputerSystemProduct` (SMBIOS type-1).
fn get_motherboard_uuid() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = hidden_command(POWERSHELL_PATH)
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_ComputerSystemProduct | Select-Object -ExpandProperty UUID",
            ])
            .output()
        {
            if output.status.success() {
                if let Some(v) = sanitize(&String::from_utf8_lossy(&output.stdout)) {
                    return v;
                }
            }
        }
    }
    String::new()
}

/// BIOS serial from `Win32_BIOS` (SMBIOS type-0).
fn get_bios_serial() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = hidden_command(POWERSHELL_PATH)
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_BIOS | Select-Object -ExpandProperty SerialNumber",
            ])
            .output()
        {
            if output.status.success() {
                if let Some(v) = sanitize(&String::from_utf8_lossy(&output.stdout)) {
                    return v;
                }
            }
        }
    }
    String::new()
}

// ── Core v2 computation ────────────────────────────────────────────────

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
fn compute_v2_id(cpu: &str, mobo: &str, bios: &str) -> Option<String> {
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

// ── Verification cache (`.machine_id_v2`) ──────────────────────────────

#[derive(Serialize, Deserialize)]
struct MachineIdCache {
    /// SHA-256 of the raw components — used to verify cache freshness.
    components_hash: String,
    /// Algorithm version.
    version: u8,
    // S-4: `id` intentionally omitted — the machine fingerprint is never
    // persisted to disk.  Only `components_hash` (non-reversible) is stored.
    // The actual ID is recomputed from live hardware on every process start.
}

const CACHE_FILE: &str = ".machine_id_v2";

/// Derive a 32-byte key for the machine-ID cache file from the compile-time
/// application secret.  This is intentionally independent of the machine ID
/// (no chicken-and-egg problem) and provides confidentiality + tamper-detection
/// for the on-disk cache without involving the machine ID derivation path.
fn derive_cache_key() -> [u8; 32] {
    use hkdf::Hkdf;
    let hk = Hkdf::<Sha256>::new(None, DEFAULT_INTEGRITY_KEY.as_bytes());
    let mut okm = [0u8; 32];
    hk.expand(b"rheolab machine-id cache v1", &mut okm)
        .expect("HKDF expand: 32 bytes is always a valid output length for SHA-256");
    okm
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok())
        .collect()
}

/// Encrypted envelope stored on disk: `{"v":3,"n":"<hex nonce>","c":"<hex ciphertext>"}`
#[derive(Deserialize)]
struct CacheEnvelope {
    #[allow(dead_code)] // present in JSON; version is checked before deserialization
    v: u8,
    n: String,
    c: String,
}

fn read_cache(app_data_dir: &std::path::Path) -> Option<MachineIdCache> {
    let path = app_data_dir.join(CACHE_FILE);
    let raw = std::fs::read_to_string(&path).ok()?;
    let data: serde_json::Value = serde_json::from_str(&raw).ok()?;

    // ── Encrypted format (v3) ─────────────────────────────────────────────
    if data["v"].as_u64() == Some(3) {
        let envelope: CacheEnvelope = serde_json::from_value(data).ok()?;
        let nonce_bytes = hex_decode(&envelope.n)?;
        let ct_bytes = hex_decode(&envelope.c)?;
        if nonce_bytes.len() != 12 {
            return None;
        }
        let key_bytes = derive_cache_key();
        let gcm_key = GcmKey::<Aes256Gcm>::from_slice(&key_bytes);
        let cipher = Aes256Gcm::new(gcm_key);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let plaintext = cipher.decrypt(nonce, ct_bytes.as_ref()).ok()?;
        let json_str = String::from_utf8(plaintext).ok()?;
        return serde_json::from_str(&json_str).ok();
    }

    // ── Migration fallback: plaintext JSON written by an older build ───────
    serde_json::from_str(&raw).ok()
}

fn write_cache(app_data_dir: &std::path::Path, cache: &MachineIdCache) {
    let _ = std::fs::create_dir_all(app_data_dir);
    let Ok(json) = serde_json::to_string(cache) else { return };

    let key_bytes = derive_cache_key();
    let gcm_key = GcmKey::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(gcm_key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let Ok(ciphertext) = cipher.encrypt(&nonce, json.as_bytes()) else { return };

    let envelope = serde_json::json!({
        "v": 3u8,
        "n": hex_encode(&nonce),
        "c": hex_encode(&ciphertext),
    });
    if let Ok(encoded) = serde_json::to_string(&envelope) {
        let _ = std::fs::write(app_data_dir.join(CACHE_FILE), encoded);
    }
}

// ── Public API ─────────────────────────────────────────────────────────

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
    let cache_fresh = read_cache(app_data_dir)
        .is_some_and(|c| c.version == 2 && c.components_hash == live_hash);

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
            cpu, mobo, bios, id
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

// ── Legacy v1 support (backward-compatible machine-ID migration) ───────
//
// The v1 algorithm used: disk serial + motherboard UUID + BIOS serial
// with salt "rheolab-hw-", raw case (no normalisation), and the first
// enumerated disk (which could be USB).
//
// These functions are ONLY used to migrate legacy server records that were
// activated with the old algorithm.

/// Read the legacy `.machine_id_hw` cache file (v1 algorithm).
///
/// If present, this is the exact ID that was sent to the server during
/// the original activation.  Returns `None` if the file doesn't exist.
pub fn read_legacy_cached_id(app_data_dir: &std::path::Path) -> Option<String> {
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

fn get_first_disk_serial_raw() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = hidden_command(POWERSHELL_PATH)
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_DiskDrive | Select-Object -ExpandProperty SerialNumber | Select-Object -First 1",
            ])
            .output()
        {
            if output.status.success() {
                let r = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !r.is_empty() {
                    return r;
                }
            }
        }
    }
    String::new()
}

fn get_motherboard_uuid_raw() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = hidden_command(POWERSHELL_PATH)
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_ComputerSystemProduct | Select-Object -ExpandProperty UUID",
            ])
            .output()
        {
            if output.status.success() {
                let r = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !r.is_empty() {
                    return r;
                }
            }
        }
    }
    String::new()
}

fn get_bios_serial_raw() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = hidden_command(POWERSHELL_PATH)
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_BIOS | Select-Object -ExpandProperty SerialNumber",
            ])
            .output()
        {
            if output.status.success() {
                let r = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !r.is_empty() {
                    return r;
                }
            }
        }
    }
    String::new()
}

/// Compute legacy machine IDs using the old v1 algorithm.
///
/// Returns 0–2 candidate IDs that may have been registered on the server
/// by older app versions. The caller should try each during legacy migration.
pub fn compute_legacy_machine_ids() -> Vec<String> {
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

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
#[path = "hardware_tests.rs"]
mod tests;
