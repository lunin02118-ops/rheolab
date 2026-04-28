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

pub(crate) async fn api_keys_list_impl(state: State<'_, AppState>) -> Result<Vec<ApiKeyItem>> {
    let conn = state.pool_conn()?;

    // Delete any rows with un-decodable keys (allow both AESGCM: and legacy OBFHEX: formats)
    conn.execute(
        "DELETE FROM APIKey WHERE key NOT LIKE 'AESGCM:%' AND key NOT LIKE 'OBFHEX:%'",
        [],
    )
    .ok();

    let mut stmt = conn.prepare(
        "SELECT id, name, key, provider, isActive, createdAt, updatedAt \
             FROM APIKey ORDER BY createdAt DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(2)?))
    })?;

    let mut invalid_ids = Vec::new();

    for row in rows {
        let (id, encoded) = row?;
        if decode_key(&encoded, &state.app_data_dir).is_none() {
            invalid_ids.push(id);
        }
    }

    // Clean up undecryptable keys
    for id in invalid_ids {
        let existing: Option<(String, i32)> = conn
            .query_row(
                "SELECT provider, isActive FROM APIKey WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .unwrap_or(None);

        let _ = conn.execute("DELETE FROM APIKey WHERE id = ?1", params![id]);

        if let Some((provider, was_active)) = existing {
            if was_active != 0 {
                let now = now_rfc3339();
                let _ = conn.execute(
                    "UPDATE APIKey SET isActive = 1, updatedAt = ?1 \
                     WHERE id = (SELECT id FROM APIKey WHERE provider = ?2 ORDER BY createdAt DESC LIMIT 1)",
                    params![now, provider],
                );
            }
        }
    }

    // Re-query after cleanup
    let mut stmt = conn.prepare(
        "SELECT id, name, key, provider, isActive, createdAt, updatedAt \
             FROM APIKey ORDER BY createdAt DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(ApiKeyItem {
            id: row.get(0)?,
            name: row.get(1)?,
            key: MASKED_KEY.to_string(),
            provider: row.get(3)?,
            is_active: row.get::<_, i32>(4)? != 0,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
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
