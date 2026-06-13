//! Encrypted on-disk cache for machine-ID freshness verification.
//!
//! The cache file stores only the SHA-256 `components_hash` of the raw CPU /
//! motherboard / BIOS strings — **never** the machine ID itself (S-4).  The
//! envelope is AES-256-GCM encrypted with a key derived via HKDF from the
//! compile-time application integrity secret.

use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key as GcmKey, Nonce,
};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

use super::super::types::DEFAULT_INTEGRITY_KEY;

pub(crate) const CACHE_FILE: &str = ".machine_id_v2";

#[derive(Serialize, Deserialize)]
pub(crate) struct MachineIdCache {
    /// SHA-256 of the raw components — used to verify cache freshness.
    pub(super) components_hash: String,
    /// Algorithm version.
    pub(super) version: u8,
    // S-4: `id` intentionally omitted — the machine fingerprint is never
    // persisted to disk.  Only `components_hash` (non-reversible) is stored.
    // The actual ID is recomputed from live hardware on every process start.
}

/// Derive a 32-byte key for the machine-ID cache file from the compile-time
/// application secret.  This is intentionally independent of the machine ID
/// (no chicken-and-egg problem) and provides confidentiality + tamper-detection
/// for the on-disk cache without involving the machine ID derivation path.
fn derive_cache_key() -> crate::error::Result<[u8; 32]> {
    use hkdf::Hkdf;
    let hk = Hkdf::<Sha256>::new(None, DEFAULT_INTEGRITY_KEY.as_bytes());
    let mut okm = [0u8; 32];
    hk.expand(b"rheolab machine-id cache v1", &mut okm)
        .map_err(|e| crate::error::AppError::Other(format!("HKDF expand failed: {}", e)))?;
    Ok(okm)
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
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

pub(crate) fn read_cache(app_data_dir: &std::path::Path) -> Option<MachineIdCache> {
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
        let key_bytes = derive_cache_key().ok()?;
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

pub(super) fn write_cache(app_data_dir: &std::path::Path, cache: &MachineIdCache) {
    let _ = std::fs::create_dir_all(app_data_dir);
    let Ok(json) = serde_json::to_string(cache) else {
        return;
    };

    let Ok(key_bytes) = derive_cache_key() else {
        return;
    };
    let gcm_key = GcmKey::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(gcm_key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let Ok(ciphertext) = cipher.encrypt(&nonce, json.as_bytes()) else {
        return;
    };

    let envelope = serde_json::json!({
        "v": 3u8,
        "n": hex_encode(&nonce),
        "c": hex_encode(&ciphertext),
    });
    if let Ok(encoded) = serde_json::to_string(&envelope) {
        let _ = std::fs::write(app_data_dir.join(CACHE_FILE), encoded);
    }
}
