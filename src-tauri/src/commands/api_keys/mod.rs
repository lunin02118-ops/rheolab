//! API key commands — backed by rusqlite (APIKey table).
//!
//! Replaces the previous JSON store (`v2/api-keys-store.json`) with direct
//! SQLite queries via the shared connection pool.
//! Keys are encrypted at rest with AES-256-GCM using a machine-derived key.
//! Legacy XOR-obfuscated keys (OBFHEX: prefix) are transparently migrated on first read.

use crate::commands::licensing::can_write_via_engine;
use crate::error::Result;
use crate::state::AppState;
use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use rusqlite::params;
use sha2::{Digest, Sha256};
use tauri::State;

mod types;
pub use types::*;
pub(crate) mod commands;
pub(crate) use commands::resolve_active_ai_key;

// ── Constants ─────────────────────────────────────────────────────────

pub(crate) const MASKED_KEY: &str = "********";
pub(crate) const GROQ_BASE_URL: &str = "https://api.groq.com/openai/v1";
pub(crate) const GROQ_DEFAULT_MODEL: &str = "llama-3.3-70b-versatile";
/// Prefix for new AES-256-GCM encrypted keys: "AESGCM:<hex nonce>:<hex ciphertext+tag>"
pub(crate) const AES_GCM_PREFIX: &str = "AESGCM:";
/// Legacy XOR prefix — only for transparent migration.
pub(crate) const LEGACY_XOR_PREFIX: &str = "OBFHEX:";
const LEGACY_XOR_KEY: &str = "RheoLab2025ClientCache";
// Default userId for desktop-local keys (no real auth session)
pub(crate) const LOCAL_USER_ID: &str = "desktop-local-admin";

// ── Machine-ID helpers ─────────────────────────────────────────────────

/// Derive a stable 256-bit AES key from a machine-specific string.
/// Uses SHA-256(MACHINE_ID + APPLICATION_ID) — no key stored anywhere.
fn derive_aes_key(machine_id: &str) -> Key<Aes256Gcm> {
    let mut hasher = Sha256::new();
    hasher.update(machine_id.as_bytes());
    hasher.update(b":");
    hasher.update(b"rheolab-apikey-aes256gcm-v1");
    let raw = hasher.finalize();
    *Key::<Aes256Gcm>::from_slice(&raw)
}

/// Get machine identifier for AES key derivation.
/// Uses the hardware-bound machine ID (CPU + motherboard UUID + BIOS serial),
/// which is significantly more resistant to prediction than a filesystem path.
/// Falls back to AppData path if hardware fingerprinting is unavailable.
fn get_machine_seed(app_data_dir: &std::path::Path) -> String {
    crate::commands::licensing::get_or_create_machine_id(app_data_dir)
}

/// Get legacy machine IDs for backward-compatible decryption.
/// When the machine ID algorithm changes (v1 → v2), existing encrypted API keys
/// were stored with the old key. We try legacy seeds to decrypt them, then
/// re-encrypt with the current seed.
fn get_legacy_machine_seeds(app_data_dir: &std::path::Path) -> Vec<String> {
    crate::commands::licensing::all_legacy_ids(app_data_dir)
}

// ── Crypto helpers ─────────────────────────────────────────────────────

pub(crate) fn encode_key(
    raw: &str,
    app_data_dir: &std::path::Path,
) -> crate::error::Result<String> {
    let machine_seed = get_machine_seed(app_data_dir);
    let aes_key = derive_aes_key(&machine_seed);
    let cipher = Aes256Gcm::new(&aes_key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, raw.as_bytes())
        .map_err(|e| crate::error::AppError::Other(format!("AES-GCM encrypt failed: {}", e)))?;
    Ok(format!(
        "{}{}/{}",
        AES_GCM_PREFIX,
        to_hex(&nonce),
        to_hex(&ciphertext)
    ))
}

pub(crate) fn decode_key(stored: &str, app_data_dir: &std::path::Path) -> Option<String> {
    if let Some(payload) = stored.strip_prefix(AES_GCM_PREFIX) {
        // New AES-256-GCM path
        let parts: Vec<&str> = payload.splitn(2, '/').collect();
        if parts.len() != 2 {
            return None;
        }
        let nonce_bytes = from_hex(parts[0])?;
        let ct_bytes = from_hex(parts[1])?;
        if nonce_bytes.len() != 12 {
            return None;
        }

        // Try with current (v2) machine seed
        let machine_seed = get_machine_seed(app_data_dir);
        let aes_key = derive_aes_key(&machine_seed);
        let cipher = Aes256Gcm::new(&aes_key);
        let nonce = Nonce::from_slice(&nonce_bytes);
        if let Ok(plaintext) = cipher.decrypt(nonce, ct_bytes.as_ref()) {
            return String::from_utf8(plaintext).ok();
        }

        // Fallback: try legacy machine seeds (v1 algorithm).
        // The key was encrypted with the old machine ID before v2 migration.
        for legacy_seed in get_legacy_machine_seeds(app_data_dir) {
            if legacy_seed == machine_seed {
                continue;
            }
            let legacy_aes_key = derive_aes_key(&legacy_seed);
            let legacy_cipher = Aes256Gcm::new(&legacy_aes_key);
            if let Ok(plaintext) = legacy_cipher.decrypt(nonce, ct_bytes.as_ref()) {
                return String::from_utf8(plaintext).ok();
            }
        }

        return None;
    }
    if let Some(hex) = stored.strip_prefix(LEGACY_XOR_PREFIX) {
        // Legacy XOR path — transparent migration
        let bytes = from_hex(hex)?;
        let key = LEGACY_XOR_KEY.as_bytes();
        let restored: Vec<u8> = bytes
            .iter()
            .enumerate()
            .map(|(i, b)| b ^ key[i % key.len()])
            .collect();
        return String::from_utf8(restored).ok();
    }
    None
}

pub(crate) fn to_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push_str(&format!("{:02x}", byte));
    }
    output
}

pub(crate) fn from_hex(hex: &str) -> Option<Vec<u8>> {
    if !hex.len().is_multiple_of(2) {
        return None;
    }

    let mut result = Vec::with_capacity(hex.len() / 2);
    let chars = hex.as_bytes();
    let mut index = 0;
    while index < chars.len() {
        let byte =
            u8::from_str_radix(std::str::from_utf8(&chars[index..index + 2]).ok()?, 16).ok()?;
        result.push(byte);
        index += 2;
    }
    Some(result)
}

// ── Misc helpers ───────────────────────────────────────────────────────

pub(crate) fn normalize_provider(provider: Option<String>) -> String {
    provider
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "groq".to_string())
}

pub(crate) use crate::utils::time::now_rfc3339;

pub(crate) fn generate_id(name: &str, key: &str, now: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(name.trim().to_lowercase());
    hasher.update(":");
    hasher.update(key.trim());
    hasher.update(":");
    hasher.update(now);
    let hash = hasher.finalize();
    format!("ak_{}", to_hex(&hash[..12]))
}

// ── Startup migration (F-04) ──────────────────────────────────────────

/// Proactively migrate **all** legacy OBFHEX: API keys to AES-256-GCM.
///
/// Called once during `AppState` initialization so that the XOR decode path
/// is never exercised at runtime.  After one full release cycle, the XOR
/// decode branch can be safely deleted.
pub fn migrate_legacy_xor_keys(db_pool: &crate::db::DbPool, app_data_dir: &std::path::Path) {
    let conn = match db_pool.get() {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("migrate_legacy_xor_keys: DB pool error: {}", e);
            return;
        }
    };

    let mut stmt = match conn.prepare("SELECT id, key FROM APIKey WHERE key LIKE 'OBFHEX:%'") {
        Ok(s) => s,
        Err(_) => return, // table may not exist yet
    };

    let rows: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .ok()
        .map(|r| r.filter_map(|x| x.ok()).collect())
        .unwrap_or_default();

    let count = rows.len();
    if count == 0 {
        return;
    }

    tracing::info!("Migrating {} legacy XOR API key(s) to AES-256-GCM …", count);

    let mut migrated = 0u32;
    for (id, encoded) in rows {
        if let Some(raw_key) = decode_key(&encoded, app_data_dir) {
            if let Ok(re_encrypted) = encode_key(&raw_key, app_data_dir) {
                if conn
                    .execute(
                        "UPDATE APIKey SET key = ?1 WHERE id = ?2",
                        params![re_encrypted, id],
                    )
                    .is_ok()
                {
                    migrated += 1;
                }
            }
        }
    }

    tracing::info!(
        "Legacy XOR key migration complete: {}/{} migrated",
        migrated,
        count
    );
}

// ── Thin #[tauri::command] wrappers ────────────────────────────────────

#[tauri::command]
pub async fn api_keys_list(state: State<'_, AppState>) -> Result<Vec<ApiKeyItem>> {
    commands::api_keys_list_impl(state).await
}

#[tauri::command]
pub async fn api_keys_create(
    state: State<'_, AppState>,
    payload: ApiKeyCreatePayload,
) -> Result<ApiKeyMutationResponse> {
    if !can_write_via_engine(&state).await {
        return Ok(ApiKeyMutationResponse::err("Требуется активная лицензия"));
    }
    commands::api_keys_create_impl(state, payload).await
}

#[tauri::command]
pub async fn api_keys_set_active(
    state: State<'_, AppState>,
    id: String,
) -> Result<ApiKeyMutationResponse> {
    if !can_write_via_engine(&state).await {
        return Ok(ApiKeyMutationResponse::err("Требуется активная лицензия"));
    }
    commands::api_keys_set_active_impl(state, id).await
}

#[tauri::command]
pub async fn api_keys_delete(
    state: State<'_, AppState>,
    id: String,
) -> Result<ApiKeyDeleteResponse> {
    if !can_write_via_engine(&state).await {
        return Ok(ApiKeyDeleteResponse::err("Требуется активная лицензия"));
    }
    commands::api_keys_delete_impl(state, id).await
}

#[tauri::command]
pub async fn api_keys_active(
    state: State<'_, AppState>,
    provider: Option<String>,
) -> Result<ActiveApiKeyResponse> {
    commands::api_keys_active_impl(state, provider).await
}

#[tauri::command]
pub async fn api_keys_check_active(
    state: State<'_, AppState>,
    provider: Option<String>,
) -> Result<ApiKeyValidationResponse> {
    commands::api_keys_check_active_impl(state, provider).await
}

#[tauri::command]
pub async fn api_keys_validate(
    key: String,
    provider: Option<String>,
) -> Result<ApiKeyValidationResponse> {
    commands::api_keys_validate_impl(key, provider).await
}
