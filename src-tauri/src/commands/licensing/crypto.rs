#![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Cryptographic helpers, secure storage, and HMAC-protected SystemState access.
//!
//! All items are `pub(super)` — visible to the parent `licensing/mod.rs` only.

use crate::error::{AppError, Result};
use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key as GcmKey, Nonce,
};
use chrono::Utc;
use hmac::Mac;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::path::PathBuf;

use super::hardware::{all_legacy_ids, get_or_create_machine_id};
use super::types::{
    Aes256CbcDec, HmacSha256,
    STORAGE_SALT, DEFAULT_INTEGRITY_KEY,
};

// в”Ђв”Ђ Hex helper в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

mod hex {
    use crate::error::{AppError, Result};

    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }

    pub fn decode(s: &str) -> Result<Vec<u8>> {
        if !s.len().is_multiple_of(2) {
            return Err("Invalid hex length".into());
        }
        (0..s.len())
            .step_by(2)
            .map(|i| {
                u8::from_str_radix(&s[i..i + 2], 16)
                    .map_err(|_| AppError::Other("Invalid hex character".to_owned()))
            })
            .collect()
    }
}

// в”Ђв”Ђ RSA server-signature verification (F-07) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

/// RSA-2048 public key in SPKI DER format, embedded at compile time.
/// Corresponds to the private key on license.vizbuka.ru used by `sign_rsa.php`
/// (`openssl_sign($data, $sig, $key, OPENSSL_ALGO_SHA256)`).
///
/// For development/testing a dev keypair is generated in `src-tauri/keys/`.
/// For production, replace `license_public.der` with the real server public key
/// before building release artifacts.
/// Generate from PEM: `openssl pkey -pubin -in license_public.pem -outform DER -out license_public.der`
#[cfg(not(test))]
const RSA_PUBLIC_KEY_DER: &[u8] = include_bytes!("../../../keys/license_public.der");

/// In unit-test builds use the dev keypair so tests can sign payloads themselves
/// without access to the production private key.
#[cfg(test)]
const RSA_PUBLIC_KEY_DER: &[u8] = include_bytes!("../../../keys/dev_public.der");

/// Verify an RSA-SHA256 (PKCS#1 v1.5) signature produced by the PHP license server.
///
/// - `canonical_json` — the JSON string that was signed (must match byte-for-byte
///   what PHP produced with `json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)`).
/// - `base64_sig` — the Base64-encoded raw signature returned by the server.
///
/// Returns `true` if the signature is valid, `false` otherwise (including any
/// parse / decode errors).
pub(super) fn verify_server_signature(canonical_json: &str, base64_sig: &str) -> bool {
    use base64::Engine;
    use rsa::pkcs8::DecodePublicKey;
    use rsa::pkcs1v15::{Signature, VerifyingKey};
    use rsa::signature::Verifier;
    use sha2::Sha256;

    let sig_bytes = match base64::engine::general_purpose::STANDARD.decode(base64_sig) {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!("RSA verify: Base64 decode failed: {}", e);
            return false;
        }
    };

    let public_key = match rsa::RsaPublicKey::from_public_key_der(RSA_PUBLIC_KEY_DER) {
        Ok(k) => k,
        Err(e) => {
            tracing::error!("RSA verify: failed to parse embedded public key: {}", e);
            return false;
        }
    };

    let verifying_key = VerifyingKey::<Sha256>::new(public_key);

    let signature = match Signature::try_from(sig_bytes.as_slice()) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("RSA verify: invalid signature bytes: {}", e);
            return false;
        }
    };

    match verifying_key.verify(canonical_json.as_bytes(), &signature) {
        Ok(()) => true,
        Err(e) => {
            tracing::warn!("RSA verify: verification failed: {}", e);
            false
        }
    }
}

// в”Ђв”Ђ Key derivation в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

pub(super) fn get_integrity_key() -> String {
    std::env::var("INTEGRITY_SECRET_KEY")
        .unwrap_or_else(|_| DEFAULT_INTEGRITY_KEY.to_string())
}

// в”Ђв”Ђ HMAC integrity в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

pub(super) fn sign_data(value: &str) -> String {
    let key = get_integrity_key();
    let mut mac =
        <HmacSha256 as Mac>::new_from_slice(key.as_bytes()).expect("HMAC can take key of any size");
    mac.update(value.as_bytes());
    let result = mac.finalize();
    hex::encode(&result.into_bytes())
}

pub(super) fn verify_signature(value: &str, signature: &str) -> bool {
    // Decode the provided hex signature; invalid hex → false immediately.
    let Ok(sig_bytes) = hex::decode(signature) else {
        return false;
    };
    let key = get_integrity_key();
    // create_from_slice never fails for HMAC (accepts any key length)
    let Ok(mut mac) = <HmacSha256 as Mac>::new_from_slice(key.as_bytes()) else {
        return false;
    };
    mac.update(value.as_bytes());
    // verify_slice performs constant-time comparison internally (via subtle crate
    // inside the hmac/digest stack) — avoids timing side-channels.
    mac.verify_slice(&sig_bytes).is_ok()
}

// в”Ђв”Ђ Secure storage (encrypted file) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

pub(super) fn secure_storage_path(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir
        .parent()
        .unwrap_or(app_data_dir)
        .join(".rheolab")
        .join("rheolab_secure_storage.dat")
}

/// Derive a 32-byte storage key from `machine_id` using HKDF-SHA256.
///
/// This is the canonical key derivation function (Phase 6.8).
/// Salt = `STORAGE_SALT`, IKM = `machine_id`, info = `"rheolab storage key v1"`.
pub(super) fn derive_storage_key(machine_id: &str) -> [u8; 32] {
    use hkdf::Hkdf;
    use sha2::Sha256;
    let hk = Hkdf::<Sha256>::new(
        Some(STORAGE_SALT.as_bytes()),
        machine_id.as_bytes(),
    );
    let mut okm = [0u8; 32];
    hk.expand(b"rheolab storage key v1", &mut okm)
        .expect("HKDF expand: 32 bytes is always a valid output length for SHA-256");
    okm
}

/// Legacy key derivation used before Phase 6.8 (HMAC-SHA256 single-block).
/// Kept for backward-compatible decryption of existing v2 GCM blobs and v1 CBC blobs.
fn derive_storage_key_legacy(machine_id: &str) -> [u8; 32] {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(STORAGE_SALT.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(machine_id.as_bytes());
    let result = mac.finalize();
    let bytes = result.into_bytes();
    let mut key = [0u8; 32];
    key.copy_from_slice(&bytes);
    key
}

pub(super) fn save_secure_last_check(
    app_data_dir: &std::path::Path,
    date_iso: &str,
) -> Result<()> {
    let machine_id = get_or_create_machine_id(app_data_dir);
    let key_bytes = derive_storage_key(&machine_id);

    let payload = json!({
        "date": date_iso,
        "timestamp": Utc::now().timestamp_millis()
    });
    let payload_str = serde_json::to_string(&payload)?;

    // AES-256-GCM (F-06: replaces CBC, provides authenticated encryption)
    let gcm_key = GcmKey::<Aes256Gcm>::from_slice(&key_bytes);
    let cipher = Aes256Gcm::new(gcm_key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, payload_str.as_bytes())
        .map_err(|e| AppError::Other(format!("Encryption failed: {}", e)))?;

    let data = json!({
        "version": 2,
        "nonce": hex::encode(&nonce),
        "content": hex::encode(&ciphertext)
    });

    let path = secure_storage_path(app_data_dir);
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let json_str = serde_json::to_string(&data)?;
    std::fs::write(&path, json_str)
        .map_err(AppError::Io)
}

pub(super) fn get_secure_last_check(app_data_dir: &std::path::Path) -> Option<String> {
    let path = secure_storage_path(app_data_dir);
    let content = std::fs::read_to_string(&path).ok()?;
    let data: Value = serde_json::from_str(&content).ok()?;

    let machine_id = get_or_create_machine_id(app_data_dir);

    // в”Ђв”Ђ V2 format: AES-256-GCM (version == 2) в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ
    if data["version"].as_u64() == Some(2) {
        let nonce_hex = data["nonce"].as_str()?;
        let content_hex = data["content"].as_str()?;
        let nonce_bytes = hex::decode(nonce_hex).ok()?;
        let ct_bytes = hex::decode(content_hex).ok()?;
        if nonce_bytes.len() != 12 {
            return None;
        }
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Try current machine ID with HKDF key (new scheme — Phase 6.8)
        let key_bytes = derive_storage_key(&machine_id);
        let gcm_key = GcmKey::<Aes256Gcm>::from_slice(&key_bytes);
        let cipher = Aes256Gcm::new(gcm_key);
        if let Ok(plaintext) = cipher.decrypt(nonce, ct_bytes.as_ref()) {
            if let Ok(payload_str) = String::from_utf8(plaintext) {
                if let Ok(payload) = serde_json::from_str::<Value>(&payload_str) {
                    return payload["date"].as_str().map(|s| s.to_string());
                }
            }
        }

        // Migration fallback: try legacy HMAC key for current machine ID.
        // Handles existing v2 blobs written before Phase 6.8.
        {
            let legacy_key_bytes = derive_storage_key_legacy(&machine_id);
            let legacy_gcm_key = GcmKey::<Aes256Gcm>::from_slice(&legacy_key_bytes);
            let legacy_cipher = Aes256Gcm::new(legacy_gcm_key);
            if let Ok(plaintext) = legacy_cipher.decrypt(nonce, ct_bytes.as_ref()) {
                if let Ok(payload_str) = String::from_utf8(plaintext) {
                    if let Ok(payload) = serde_json::from_str::<Value>(&payload_str) {
                        if let Some(date) = payload["date"].as_str().map(|s| s.to_string()) {
                            // Re-save with new HKDF key
                            let _ = save_secure_last_check(app_data_dir, &date);
                            tracing::info!("Secure storage: migrated key derivation from HMAC to HKDF");
                            return Some(date);
                        }
                    }
                }
            }
        }

        // Fallback: legacy machine IDs (try HKDF then HMAC for each)
        for legacy_id in all_legacy_ids(app_data_dir) {
            if legacy_id == machine_id {
                continue;
            }
            for legacy_key in [derive_storage_key(&legacy_id), derive_storage_key_legacy(&legacy_id)] {
                let legacy_gcm_key = GcmKey::<Aes256Gcm>::from_slice(&legacy_key);
                let legacy_cipher = Aes256Gcm::new(legacy_gcm_key);
                if let Ok(plaintext) = legacy_cipher.decrypt(nonce, ct_bytes.as_ref()) {
                    if let Ok(payload_str) = String::from_utf8(plaintext) {
                        if let Ok(payload) = serde_json::from_str::<Value>(&payload_str) {
                            if let Some(date) = payload["date"].as_str().map(|s| s.to_string()) {
                                let _ = save_secure_last_check(app_data_dir, &date);
                                tracing::info!("Secure storage (GCM): migrated from legacy machine ID to v2");
                                return Some(date);
                            }
                        }
                    }
                }
            }
        }

        return None;
    }

    // в”Ђв”Ђ V1 format: AES-256-CBC (legacy — read-only, re-encrypt as GCM) в”Ђв”Ђ
    // V1 blobs were always encrypted with the HMAC-based key derivation.
    let iv_hex = data["iv"].as_str()?;
    let content_hex = data["content"].as_str()?;
    let key = derive_storage_key_legacy(&machine_id);
    let iv = hex::decode(iv_hex).ok()?;
    let ciphertext_bytes = hex::decode(content_hex).ok()?;

    // Try decryption with current (v2) machine ID
    {
        let mut buf = ciphertext_bytes.clone();
        if let Ok(decrypted) = Aes256CbcDec::new(&key.into(), iv.as_slice().into())
            .decrypt_padded_mut::<Pkcs7>(&mut buf)
        {
            if let Ok(payload_str) = String::from_utf8(decrypted.to_vec()) {
                if let Ok(payload) = serde_json::from_str::<Value>(&payload_str) {
                    if let Some(date) = payload["date"].as_str().map(|s| s.to_string()) {
                        // Re-encrypt as GCM (F-06 migration)
                        let _ = save_secure_last_check(app_data_dir, &date);
                        tracing::info!("Secure storage: migrated from CBC (v1) to GCM (v2)");
                        return Some(date);
                    }
                }
            }
        }
    }

    // Fallback: try legacy machine IDs (v1 algorithm — always HMAC-keyed)
    for legacy_id in all_legacy_ids(app_data_dir) {
        if legacy_id == machine_id {
            continue;
        }
        let legacy_key = derive_storage_key_legacy(&legacy_id);
        let mut buf = ciphertext_bytes.clone();
        if let Ok(decrypted) = Aes256CbcDec::new(&legacy_key.into(), iv.as_slice().into())
            .decrypt_padded_mut::<Pkcs7>(&mut buf)
        {
            if let Ok(payload_str) = String::from_utf8(decrypted.to_vec()) {
                if let Ok(payload) = serde_json::from_str::<Value>(&payload_str) {
                    if let Some(date) = payload["date"].as_str().map(|s| s.to_string()) {
                        // Re-encrypt with GCM + current v2 key
                        let _ = save_secure_last_check(app_data_dir, &date);
                        tracing::info!("Secure storage: migrated from CBC (v1) + legacy ID to GCM (v2)");
                        return Some(date);
                    }
                }
            }
        }
    }

    None
}

// в”Ђв”Ђ HMAC-protected SystemState DB helpers в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ

pub(super) fn get_system_state(
    conn: &rusqlite::Connection,
    key: &str,
) -> Result<Option<(String, String)>> {
    conn.query_row(
        "SELECT value, signature FROM SystemState WHERE key = ?1",
        params![key],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )
    .optional()
    .map_err(AppError::Sql)
}

pub(super) fn upsert_system_state(
    conn: &rusqlite::Connection,
    key: &str,
    value: &str,
) -> Result<()> {
    let signature = sign_data(value);
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO SystemState (key, value, signature, updatedAt) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(key) DO UPDATE SET value = ?2, signature = ?3, updatedAt = ?4",
        params![key, value, signature, now],
    )?;
    Ok(())
}

pub(super) fn delete_system_state(
    conn: &rusqlite::Connection,
    key: &str,
) -> Result<()> {
    conn.execute("DELETE FROM SystemState WHERE key = ?1", params![key])?;
    Ok(())
}

// в”Ђв”Ђ Tests в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ


#[cfg(test)]
#[path = "crypto_tests.rs"]
mod tests;
