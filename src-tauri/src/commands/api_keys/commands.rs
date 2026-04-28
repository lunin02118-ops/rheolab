use crate::error::Result;
use crate::state::AppState;
use reqwest::StatusCode;
use rusqlite::params;
use rusqlite::OptionalExtension;
use serde_json::json;
use std::time::Duration;
use tauri::State;

use super::*;

// ── Command implementations (called by thin #[tauri::command] wrappers in mod.rs) ──

/// Audit-v2 SEC-003: read-only listing.
///
/// This command is now **side-effect free**: it reads APIKey rows,
/// attempts to decrypt each one to populate the `is_decryptable` flag,
/// and returns the full list including any rows that failed to
/// decrypt.  The previous implementation deleted rows with unknown
/// prefixes and rows whose ciphertext could not be decoded, then
/// promoted another row to active if the deleted one was active.
///
/// The deletion path was triggered on every settings-screen open: a
/// transient hardware-fingerprint anomaly, an in-flight crypto
/// migration, or a bugged collector pass would silently destroy the
/// user's stored API keys.  Listing data is now read-only; explicit
/// cleanup is the user's choice via `api_keys_delete`.
pub(crate) async fn api_keys_list_impl(state: State<'_, AppState>) -> Result<Vec<ApiKeyItem>> {
    let conn = state.pool_conn()?;
    list_keys_with_decryptable_flag(&conn, &state.app_data_dir)
}

/// Inner helper for `api_keys_list_impl` so we can unit-test the
/// pure-read behaviour without constructing a Tauri `State` value.
pub(crate) fn list_keys_with_decryptable_flag(
    conn: &rusqlite::Connection,
    app_data_dir: &std::path::Path,
) -> Result<Vec<ApiKeyItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, key, provider, isActive, createdAt, updatedAt \
             FROM APIKey ORDER BY createdAt DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?, // id
            row.get::<_, String>(1)?, // name
            row.get::<_, String>(2)?, // key (encrypted)
            row.get::<_, String>(3)?, // provider
            row.get::<_, i32>(4)?,    // isActive
            row.get::<_, String>(5)?, // createdAt
            row.get::<_, String>(6)?, // updatedAt
        ))
    })?;

    let mut items = Vec::new();
    for row in rows {
        let (id, name, encoded_key, provider, is_active_int, created_at, updated_at) = row?;
        let is_decryptable = decode_key(&encoded_key, app_data_dir).is_some();
        items.push(ApiKeyItem {
            id,
            name,
            key: MASKED_KEY.to_string(),
            provider,
            is_active: is_active_int != 0,
            created_at,
            updated_at,
            is_decryptable,
        });
    }

    Ok(items)
}

pub(crate) async fn api_keys_create_impl(
    state: State<'_, AppState>,
    payload: ApiKeyCreatePayload,
) -> Result<ApiKeyMutationResponse> {
    let name = payload.name.trim().to_string();
    if name.is_empty() {
        return Ok(ApiKeyMutationResponse::err("Название ключа обязательно"));
    }

    let key = payload.key.trim().to_string();
    if key.is_empty() {
        return Ok(ApiKeyMutationResponse::err("API ключ не может быть пустым"));
    }

    let provider = normalize_provider(payload.provider);
    let conn = state.pool_conn()?;

    let has_provider_keys: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM APIKey WHERE provider = ?1",
            params![provider],
            |row| row.get::<_, i32>(0),
        )
        .map(|c| c > 0)?;

    let now = now_rfc3339();
    let id = generate_id(&name, &key, &now);
    let encoded_key = encode_key(&key, &state.app_data_dir)?;
    let is_active = if has_provider_keys { 0i32 } else { 1i32 };

    conn.execute(
        "INSERT INTO APIKey (id, name, key, provider, isActive, createdAt, updatedAt, userId) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)",
        params![
            id,
            name,
            encoded_key,
            provider,
            is_active,
            now,
            LOCAL_USER_ID
        ],
    )?;

    Ok(ApiKeyMutationResponse::ok(ApiKeyItem {
        id,
        name,
        key: MASKED_KEY.to_string(),
        provider,
        is_active: !has_provider_keys,
        created_at: now.clone(),
        updated_at: now,
        // We just successfully encoded this key, so it round-trips
        // through decode_key by definition.
        is_decryptable: true,
    }))
}

pub(crate) async fn api_keys_set_active_impl(
    state: State<'_, AppState>,
    id: String,
) -> Result<ApiKeyMutationResponse> {
    let conn = state.pool_conn()?;

    let target: Option<(String, String)> = conn
        .query_row(
            "SELECT id, provider FROM APIKey WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let Some((_target_id, provider)) = target else {
        return Ok(ApiKeyMutationResponse::err("Ключ не найден"));
    };

    let now = now_rfc3339();

    // Deactivate all keys for this provider
    conn.execute(
        "UPDATE APIKey SET isActive = 0, updatedAt = ?1 WHERE provider = ?2",
        params![now, provider],
    )?;

    // Activate the target key
    conn.execute(
        "UPDATE APIKey SET isActive = 1, updatedAt = ?1 WHERE id = ?2",
        params![now, id],
    )?;

    let updated = conn
        .query_row(
            "SELECT id, name, provider, isActive, createdAt, updatedAt FROM APIKey WHERE id = ?1",
            params![id],
            |row| {
                Ok(ApiKeyItem {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    key: MASKED_KEY.to_string(),
                    provider: row.get(2)?,
                    is_active: row.get::<_, i32>(3)? != 0,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    // set_active doesn't touch the encrypted blob; the
                    // blob already round-tripped at create-time so we
                    // mirror that flag here.
                    is_decryptable: true,
                })
            },
        )
        .optional()?;

    match updated {
        Some(item) => Ok(ApiKeyMutationResponse::ok(item)),
        None => Ok(ApiKeyMutationResponse::err("Key disappeared after update")),
    }
}

/// Resolve the decrypted plaintext API key for the active entry of a provider.
///
/// This is a synchronous, `State`-free helper so that other command domains
/// (e.g. parsing) can resolve AI keys without exposing them over IPC.
pub(crate) fn resolve_active_ai_key(
    conn: &rusqlite::Connection,
    app_data_dir: &std::path::Path,
    provider: &str,
) -> Option<String> {
    let mut stmt = conn
        .prepare(
            "SELECT key FROM APIKey WHERE provider = ?1 \
             ORDER BY isActive DESC, createdAt DESC",
        )
        .ok()?;

    let rows = stmt
        .query_map(params![provider], |row| row.get::<_, String>(0))
        .ok()?;

    for row in rows {
        if let Ok(encoded) = row {
            if let Some(raw_key) = decode_key(&encoded, app_data_dir) {
                return Some(raw_key);
            }
        }
    }

    None
}

pub(crate) async fn api_keys_delete_impl(
    state: State<'_, AppState>,
    id: String,
) -> Result<ApiKeyDeleteResponse> {
    let conn = state.pool_conn()?;

    let existing: Option<(String, i32)> = conn
        .query_row(
            "SELECT provider, isActive FROM APIKey WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let Some((provider, was_active)) = existing else {
        return Ok(ApiKeyDeleteResponse::err("Ключ не найден"));
    };

    conn.execute("DELETE FROM APIKey WHERE id = ?1", params![id])?;

    // If deleted key was active, promote the newest remaining key for this provider
    if was_active != 0 {
        let now = now_rfc3339();
        conn.execute(
            "UPDATE APIKey SET isActive = 1, updatedAt = ?1 \
             WHERE id = (SELECT id FROM APIKey WHERE provider = ?2 ORDER BY createdAt DESC LIMIT 1)",
            params![now, provider],
        )
        .ok();
    }

    Ok(ApiKeyDeleteResponse::ok())
}

pub(crate) async fn api_keys_active_impl(
    state: State<'_, AppState>,
    provider: Option<String>,
) -> Result<ActiveApiKeyResponse> {
    let provider = normalize_provider(provider);
    let conn = state.pool_conn()?;

    let count: i32 = conn.query_row(
        "SELECT COUNT(*) FROM APIKey WHERE provider = ?1",
        params![provider],
        |row| row.get(0),
    )?;

    if count == 0 {
        return Ok(ActiveApiKeyResponse {
            provider,
            count: 0,
            active_key: None,
            error: Some("No API keys configured for this provider".to_string()),
        });
    }

    // Prefer the active key, fallback to newest, but only if it's decryptable
    let mut stmt = conn.prepare(
        "SELECT id, name, isActive, createdAt, key FROM APIKey \
             WHERE provider = ?1 \
             ORDER BY isActive DESC, createdAt DESC",
    )?;

    let rows = stmt.query_map(params![provider], |row| {
        Ok((
            ActiveApiKeyMeta {
                id: row.get(0)?,
                name: row.get(1)?,
                is_active: row.get::<_, i32>(2)? != 0,
                created_at: row.get(3)?,
            },
            row.get::<_, String>(4)?,
        ))
    })?;

    let mut active = None;
    for row in rows {
        if let Ok((meta, encoded)) = row {
            if decode_key(&encoded, &state.app_data_dir).is_some() {
                active = Some(meta);
                break;
            }
        }
    }

    Ok(ActiveApiKeyResponse {
        provider,
        count: count as usize,
        active_key: active,
        error: None,
    })
}

pub(crate) async fn api_keys_check_active_impl(
    state: State<'_, AppState>,
    provider: Option<String>,
) -> Result<ApiKeyValidationResponse> {
    let provider = normalize_provider(provider);
    let conn = state.pool_conn()?;

    let keys_to_check: Vec<(String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, key FROM APIKey WHERE provider = ?1 \
                 ORDER BY isActive DESC, createdAt DESC",
        )?;

        let rows = stmt.query_map(params![provider], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;

        let mut keys = Vec::new();
        for row in rows {
            if let Ok(k) = row {
                keys.push(k);
            }
        }
        keys
    };

    for (row_id, encoded) in keys_to_check {
        if let Some(raw_key) = decode_key(&encoded, &state.app_data_dir) {
            // Transparent migration: re-encrypt legacy XOR keys with AES-256-GCM
            if encoded.starts_with(LEGACY_XOR_PREFIX) {
                let re_encrypted = encode_key(&raw_key, &state.app_data_dir)?;
                let _ = conn.execute(
                    "UPDATE APIKey SET key = ?1 WHERE id = ?2",
                    params![re_encrypted, row_id],
                );
            }

            return validate_provider_key(&provider, &raw_key).await;
        }
    }

    Ok(ApiKeyValidationResponse::err(
        "No valid API keys configured",
    ))
}

pub(crate) async fn api_keys_validate_impl(
    key: String,
    provider: Option<String>,
) -> Result<ApiKeyValidationResponse> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Ok(ApiKeyValidationResponse::err("API key is empty"));
    }

    let provider = normalize_provider(provider);
    validate_provider_key(&provider, trimmed).await
}

// ── Provider validation ────────────────────────────────────────────────

async fn validate_provider_key(provider: &str, key: &str) -> Result<ApiKeyValidationResponse> {
    if provider != "groq" {
        return Ok(ApiKeyValidationResponse::err(format!(
            "Unsupported provider: {}",
            provider
        )));
    }

    // Endpoint resolution policy:
    //   * Release builds → hard-coded `GROQ_BASE_URL` only.  An attacker who
    //     can set the process environment must NOT be able to redirect a
    //     stored bearer token to an arbitrary host.
    //   * Debug / test builds → allow `GROQ_BASE_URL` env override so local
    //     development and integration tests can point at mock servers.
    //
    // See audit-preflight SEC-003 (and prior wave-3 finding W3-12).
    #[cfg(any(debug_assertions, test))]
    let url = std::env::var("GROQ_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| GROQ_BASE_URL.to_string());
    #[cfg(not(any(debug_assertions, test)))]
    let url = GROQ_BASE_URL.to_string();

    let endpoint = format!("{}/chat/completions", url.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {}", error))?;

    let response = client
        .post(endpoint)
        .bearer_auth(key)
        .json(&json!({
            "model": GROQ_DEFAULT_MODEL,
            "messages": [{ "role": "user", "content": "ping" }],
            "max_tokens": 1
        }))
        .send()
        .await
        .map_err(|error| format!("Validation request failed: {}", error))?;

    if response.status().is_success() {
        return Ok(ApiKeyValidationResponse::ok());
    }

    if response.status() == StatusCode::UNAUTHORIZED {
        return Ok(ApiKeyValidationResponse::err(
            "Invalid API key (401 Unauthorized)",
        ));
    }

    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    Ok(ApiKeyValidationResponse::err(format!(
        "Validation failed ({}) {}",
        status,
        body.chars().take(160).collect::<String>()
    )))
}

// ── Audit-v2 SEC-003 regression guards ────────────────────────────────

#[cfg(test)]
mod sec003_tests {
    use super::*;

    /// Build an in-memory APIKey table mirroring v0001_initial.rs schema.
    fn open_inmem_apikey() -> rusqlite::Connection {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE APIKey (\n\
                id        TEXT PRIMARY KEY,\n\
                name      TEXT NOT NULL,\n\
                key       TEXT NOT NULL,\n\
                provider  TEXT NOT NULL DEFAULT 'groq',\n\
                isActive  INTEGER NOT NULL DEFAULT 0,\n\
                createdAt TEXT NOT NULL DEFAULT (datetime('now')),\n\
                updatedAt TEXT NOT NULL DEFAULT (datetime('now')),\n\
                userId    TEXT NOT NULL\n\
            );",
        )
        .unwrap();
        conn
    }

    fn insert_raw(
        conn: &rusqlite::Connection,
        id: &str,
        name: &str,
        encrypted: &str,
        active: bool,
    ) {
        conn.execute(
            "INSERT INTO APIKey (id, name, key, provider, isActive, createdAt, updatedAt, userId) \
             VALUES (?1, ?2, ?3, 'groq', ?4, '2026-01-01', '2026-01-01', 'desktop-local-admin')",
            params![id, name, encrypted, if active { 1 } else { 0 }],
        )
        .unwrap();
    }

    /// Audit-v2 SEC-003: list_keys_with_decryptable_flag must NEVER
    /// delete rows it cannot decode.  Insert an obviously malformed
    /// row and assert it survives + is flagged is_decryptable=false.
    #[test]
    fn list_does_not_delete_undecryptable_row() {
        let conn = open_inmem_apikey();
        let app_data = std::env::temp_dir().join("rheolab_sec003_test_dir");
        let _ = std::fs::create_dir_all(&app_data);

        // Row 1: malformed prefix — old code would have DELETEd this.
        insert_raw(&conn, "id-bad-1", "Bad Prefix", "GARBAGE:notvalid", true);
        // Row 2: AESGCM prefix but ciphertext is junk — old code would
        //        have DELETEd this too.
        insert_raw(&conn, "id-bad-2", "Bad Cipher", "AESGCM:00/ff", false);

        // Before list: 2 rows.
        let before: i64 = conn
            .query_row("SELECT COUNT(*) FROM APIKey", [], |r| r.get(0))
            .unwrap();
        assert_eq!(before, 2);

        let items = list_keys_with_decryptable_flag(&conn, &app_data).unwrap();

        // After list: STILL 2 rows in DB (no destructive side effect).
        let after: i64 = conn
            .query_row("SELECT COUNT(*) FROM APIKey", [], |r| r.get(0))
            .unwrap();
        assert_eq!(
            after, 2,
            "audit-v2 SEC-003: list must not delete undecryptable rows; \
             user opening Settings must not lose API keys to a transient \
             decode error"
        );

        // Returned items reflect both rows with is_decryptable=false.
        assert_eq!(items.len(), 2);
        assert!(
            items.iter().all(|i| !i.is_decryptable),
            "Both seeded rows have unparseable ciphertext — both must be \
             flagged is_decryptable=false"
        );
        // Masked: never serialise the underlying ciphertext as the key.
        assert!(items.iter().all(|i| i.key == MASKED_KEY));
    }

    /// Active flag passes through untouched — list does not promote
    /// a different row to active even when an active key cannot be
    /// decrypted (the old code did this).
    #[test]
    fn list_does_not_promote_alternate_active_key() {
        let conn = open_inmem_apikey();
        let app_data = std::env::temp_dir().join("rheolab_sec003_test_dir2");
        let _ = std::fs::create_dir_all(&app_data);

        insert_raw(&conn, "id-active-broken", "Broken Active", "AESGCM:00/ff", true);
        insert_raw(&conn, "id-inactive", "Inactive Other", "AESGCM:00/ff", false);

        list_keys_with_decryptable_flag(&conn, &app_data).unwrap();

        // The "Inactive Other" row must still be inactive (no auto-promote).
        let active_for_inactive: i32 = conn
            .query_row(
                "SELECT isActive FROM APIKey WHERE id = 'id-inactive'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            active_for_inactive, 0,
            "audit-v2 SEC-003: list must not promote a different key to \
             active behind the user's back"
        );

        // The originally-active row must still be active too.
        let active_for_broken: i32 = conn
            .query_row(
                "SELECT isActive FROM APIKey WHERE id = 'id-active-broken'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(active_for_broken, 1);
    }
}
