#![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]//! Licensing commands — native Rust implementation (V2).
//!
//! All licensing logic runs exclusively in Rust via [`LicenseEngine`].
//! Tauri commands: machine-id, was-ever-licensed, DB checkpoint,
//! experiment reset, and the V2 engine commands (check, status,
//! activate, deactivate, can-save, register-experiment).

pub mod types;
pub(super) mod hardware;
pub(super) mod crypto;
pub(super) mod features;
pub(super) mod security;
pub(super) mod online;
pub(super) mod demo;
pub mod engine;

pub use types::assert_production_keys;
pub use hardware::get_or_create_machine_id;
pub use hardware::all_legacy_ids;
pub use engine::LicenseEngine;

use crate::error::Result;
use crate::state::AppState;
use serde_json::{json, Value};
use tauri::State;

use self::crypto::{get_system_state, verify_signature};
use self::types::
    {SimpleResult, LicenseStatus, DB_KEY_WAS_LICENSED, LOCAL_USER_ID};

// ── Async write-capability check (shared by all write/export commands) ──────

/// Returns `true` if the current license state allows writes (Active, Grace, or Demo).
///
/// **Must be called BEFORE acquiring a `rusqlite::Connection`** because
/// `Connection` is `!Send` and cannot be held across an `.await` point.
pub(crate) async fn can_write_via_engine(state: &AppState) -> bool {
    // E2E test bypass — debug builds only (F-02: no bypass in release)
    #[cfg(debug_assertions)]
    {
        if std::env::var("RHEOLAB_E2E_SKIP_LICENSE_GATE").as_deref() == Ok("1") {
            return true;
        }
    }
    match state.license_engine.as_ref() {
        Some(engine) => {
            if engine.can_write().await {
                return true;
            }
            // Cache might be stale — trigger a fresh check
            let _ = engine.check(&state.db_pool).await;
            engine.can_write().await
        }
        None => false,
    }
}

// ── License gate for write/export commands (F-08) ──────────────────────

/// Synchronous license gate used **only** from unit tests.
///
/// Production write commands now use [`can_write_via_engine`] (async engine path)
/// instead of this function.  Kept here so that the existing licensing test suite
/// can validate DB-level HMAC + RSA verification logic without needing a full
/// async AppState.
#[cfg(test)]
fn check_license_gate(conn: &rusqlite::Connection) -> Result<()> {
    use crate::error::AppError;
    use self::crypto::verify_server_signature;
    use self::types::DB_KEY_LICENSE;
    // E2E test bypass: only available in debug (non-release) builds.
    // Prevents production binaries from being launched with the env var to skip licensing.
    #[cfg(debug_assertions)]
    {
        if std::env::var("RHEOLAB_E2E_SKIP_LICENSE_GATE").as_deref() == Ok("1") {
            return Ok(());
        }
    }
    match get_system_state(conn, DB_KEY_LICENSE) {
        Ok(None) => {
            // No stored license — fall through to demo check
            let demo_result = demo::check_demo(conn, None);
            if matches!(demo_result.status, LicenseStatus::Demo) {
                Ok(())
            } else {
                Err(AppError::License("required".into()))
            }
        }
        Err(e) => Err(AppError::License(format!("DB error: {e}"))),
        Ok(Some((value, signature))) => {
            if !verify_signature(&value, &signature) {
                // HMAC mismatch — treat as absent and fall through to demo,
                // exactly as LicenseEngine::load_verified_license() does.
                // This prevents a key-rotation or tampered record from permanently
                // blocking saves when the app is legitimately running in demo mode.
                tracing::warn!("[check_license_gate] License HMAC mismatch — treating as absent, falling through to demo check");
                let demo_result = demo::check_demo(conn, None);
                return if matches!(demo_result.status, LicenseStatus::Demo) {
                    Ok(())
                } else {
                    Err(AppError::License("required".into()))
                };
            }

            let data: Value = serde_json::from_str(&value).unwrap_or(json!({}));

            // Level 2: RSA server-signature verification — consistent with LicenseEngine.
            // Prevents forged HMAC-only records (extracted HMAC key) from bypassing the gate.
            // Legacy grace period closed (S-2): all licenses must now carry RSA proof.
            let has_signed_payload = data["signedPayload"].is_string();
            let has_server_sig     = data["serverSignature"].is_string();
            if has_signed_payload && has_server_sig {
                let payload    = data["signedPayload"].as_str().unwrap_or("");
                let server_sig = data["serverSignature"].as_str().unwrap_or("");
                if !verify_server_signature(payload, server_sig) {
                    tracing::warn!("[check_license_gate] RSA server-signature failed — treating as absent, falling through to demo check");
                    let demo_result = demo::check_demo(conn, None);
                    return if matches!(demo_result.status, LicenseStatus::Demo) {
                        Ok(())
                    } else {
                        Err(AppError::License("required".into()))
                    };
                }
            } else {
                // No signedPayload/serverSignature — legacy HMAC-only record.
                // Grace period closed (S-2): require RSA for all licenses.
                tracing::warn!("[check_license_gate] Legacy HMAC-only record — RSA required. Re-activate to continue.");
                let demo_result = demo::check_demo(conn, None);
                return if matches!(demo_result.status, LicenseStatus::Demo) {
                    Ok(())
                } else {
                    Err(AppError::License("required".into()))
                };
            }
            let expires_at_str = data["expiresAt"].as_str().unwrap_or("");
            let grace_days = data["gracePeriodDays"].as_i64().unwrap_or(30);

            if expires_at_str.is_empty() {
                return Ok(()); // No expiry stored — will be caught on next online check
            }

            // Parse ISO 8601 (Date.toISOString format) or SQL datetime (from PHP)
            let expiry_utc = chrono::DateTime::parse_from_rfc3339(expires_at_str)
                .map(|dt| dt.to_utc())
                .or_else(|_| {
                    chrono::NaiveDateTime::parse_from_str(expires_at_str, "%Y-%m-%d %H:%M:%S")
                        .map(|dt| dt.and_utc())
                })
                .ok();

            if let Some(expiry) = expiry_utc {
                let cutoff = expiry + chrono::Duration::days(grace_days);
                if chrono::Utc::now() > cutoff {
                    return Err(AppError::License("required".into()));
                }
            }

            Ok(())
        }
    }
}

// ── Demo counter (F-04) ────────────────────────────────────────────────

/// Atomically increment the demo experiment counter **if** the current
/// license status is Demo.  In licensed mode this is a no-op.
///
/// Call this inside the same transaction that persists a NEW experiment
/// so that the counter and the experiment commit or roll back together.
///
/// In E2E mode (`RHEOLAB_E2E_SKIP_LICENSE_GATE=1`) the counter is **not**
/// incremented even if the current status is Demo — otherwise repeated E2E
/// runs accumulate saves and trip `demo_expired` for subsequent launches,
/// which breaks the startup license dialog. The skip-gate already permits
/// saves without a license, so incrementing would be inconsistent anyway.
pub(crate) fn maybe_increment_demo_save(conn: &rusqlite::Connection) {
    if std::env::var("RHEOLAB_E2E_SKIP_LICENSE_GATE").as_deref() == Ok("1") {
        return;
    }
    let result = demo::check_demo(conn, None);
    if matches!(result.status, LicenseStatus::Demo) {
        if let Err(e) = demo::increment_demo_experiments(conn) {
            tracing::warn!("Failed to increment demo counter: {}", e);
        }
    }
}

// ── Tauri commands ─────────────────────────────────────────────────────

/// Get hardware machine ID
#[tauri::command]
pub async fn licensing_machine_id(state: State<'_, AppState>) -> Result<String> {
    Ok(get_or_create_machine_id(&state.app_data_dir))
}

/// Check if installation was ever licensed
#[tauri::command]
pub async fn licensing_was_ever_licensed(state: State<'_, AppState>) -> Result<bool> {
    let conn = state.pool_conn()?;
    match get_system_state(&conn, DB_KEY_WAS_LICENSED)? {
        None => Ok(false),
        Some((value, signature)) => {
            if !verify_signature(&value, &signature) {
                // On tamper, assume was-licensed (conservative default)
                return Ok(true);
            }
            let data: Value = serde_json::from_str(&value).unwrap_or(json!({}));
            Ok(data["wasLicensed"].as_bool().unwrap_or(false))
        }
    }
}

// ── Database maintenance commands ──────────────────────────────────────

/// Force WAL checkpoint
#[tauri::command]
pub async fn licensing_checkpoint_db(state: State<'_, AppState>) -> Result<SimpleResult> {
    let conn = state.pool_conn()?;
    match conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);") {
        Ok(()) => Ok(SimpleResult {
            success: true,
            message: Some("WAL checkpoint completed".to_string()),
            error: None,
            deleted_count: None,
        }),
        Err(e) => Ok(SimpleResult {
            success: false,
            message: None,
            error: Some(format!("Checkpoint failed: {}", e)),
            deleted_count: None,
        }),
    }
}

/// Reset (delete) experiments for a user. If user_id is None, uses LOCAL_USER_ID.
#[tauri::command]
pub async fn licensing_reset_experiments(
    state: State<'_, AppState>,
    user_id: Option<String>,
) -> Result<SimpleResult> {
    use rusqlite::params;
    let conn = state.pool_conn()?;
    let uid = user_id.unwrap_or_else(|| LOCAL_USER_ID.to_string());

    let tx = conn.unchecked_transaction()?;

    let count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM Experiment WHERE userId = ?1",
            params![uid],
            |row| row.get(0),
        )?;

    // Delete reagents first (FK), then experiments — wrapped in RAII transaction
    tx.execute(
        "DELETE FROM ExperimentReagent WHERE experimentId IN \
         (SELECT id FROM Experiment WHERE userId = ?1)",
        params![uid],
    )?;

    tx.execute(
        "DELETE FROM Experiment WHERE userId = ?1",
        params![uid],
    )?;

    tx.commit()?;

    Ok(SimpleResult {
        success: true,
        message: Some(format!("Удалено {} экспериментов", count)),
        error: None,
        deleted_count: Some(count),
    })
}

/// Reset ALL experiments (requires admin role; wraps deletes in a single transaction)
#[tauri::command]
pub async fn licensing_reset_all_experiments(
    state: State<'_, AppState>,
    user_id: String,
) -> Result<SimpleResult> {
    use rusqlite::params;
    let conn = state.pool_conn()?;

    // Auth check — caller must be an active admin
    let role: String = conn
        .query_row(
            "SELECT role FROM User WHERE id = ?1 AND isActive = 1",
            params![user_id],
            |row| row.get(0),
        )
        .map_err(|_| "Unauthorized: user not found or inactive".to_string())?;

    if role != "admin" {
        return Err("Unauthorized: admin role required".into());
    }

    let tx = conn.unchecked_transaction()?;

    let count: i64 = tx
        .query_row("SELECT COUNT(*) FROM Experiment", [], |row| row.get(0))?;

    // Transactional delete — RAII transaction guarantees rollback on error
    tx.execute("DELETE FROM ExperimentReagent", [])?;
    tx.execute("DELETE FROM Experiment", [])?;

    tx.commit()?;

    Ok(SimpleResult {
        success: true,
        message: Some(format!("Удалено всего {} экспериментов", count)),
        error: None,
        deleted_count: Some(count),
    })
}

// ── V2 Engine-based Tauri commands ─────────────────────────────────────

/// Authoritative license check — the single source of truth for license status.
///
/// Returns a single [`LicenseCheckResult`] with status, features, and metadata.
/// The frontend should call this once on startup and then react to the result.
#[tauri::command]
pub async fn licensing_check(state: State<'_, AppState>) -> Result<types::LicenseCheckResult> {
    let engine = state.license_engine.as_ref().ok_or("License engine not initialized")?;
    Ok(engine.check(&state.db_pool).await)
}

/// Get the cached license status (fast, no I/O).
/// Returns `None` if `licensing_check` hasn't been called yet.
#[tauri::command]
pub async fn licensing_get_status(
    state: State<'_, AppState>,
) -> Result<Option<types::LicenseCheckResult>> {
    let engine = state.license_engine.as_ref().ok_or("License engine not initialized")?;
    Ok(engine.cached().await)
}

/// Activate a license key via the engine (server call + DB store + cache update).
#[tauri::command]
pub async fn licensing_activate_full(
    state: State<'_, AppState>,
    key: String,
) -> Result<types::LicenseCheckResult> {
    let engine = state.license_engine.as_ref().ok_or("License engine not initialized")?;
    engine.activate(&key, &state.db_pool).await
}

/// Deactivate the current license via the engine.
#[tauri::command]
pub async fn licensing_deactivate(
    state: State<'_, AppState>,
) -> Result<types::LicenseCheckResult> {
    let engine = state.license_engine.as_ref().ok_or("License engine not initialized")?;
    engine.deactivate(&state.db_pool).await
}

/// Check if the current license allows saving/exporting (write gate).
#[tauri::command]
pub async fn licensing_can_save(state: State<'_, AppState>) -> Result<bool> {
    let engine = state.license_engine.as_ref().ok_or("License engine not initialized")?;
    Ok(engine.can_write().await)
}

/// Register a saved experiment (increments demo counter, re-checks).
/// In licensed mode this is a no-op re-check.
#[tauri::command]
pub async fn licensing_register_experiment(
    state: State<'_, AppState>,
) -> Result<types::LicenseCheckResult> {
    let engine = state.license_engine.as_ref().ok_or("License engine not initialized")?;
    engine.register_experiment(&state.db_pool).await
}

/// Returned by `get_update_channel` — carries the update channel and a
/// time-bounded HMAC token that the update server uses to verify the
/// client is genuinely entitled to the requested channel before serving
/// `alpha.json` / `beta.json`.
///
/// Channel assignment (see [`types::LicenseType`]):
///
/// - `"alpha"`  — Superuser licence (project owner's personal tier)
/// - `"beta"`   — Developer licence (internal team pre-release builds)
/// - `"stable"` — everything else (Standard, Enterprise, Trial, Demo, unlicensed)
#[derive(Debug, Clone, serde::Serialize)]
pub struct UpdateChannelInfo {
    pub channel: String,
    /// HMAC-SHA256 token; `None` for stable-channel clients.
    pub token: Option<String>,
}

/// Produce an HMAC token for a rolling 5-minute window, keyed by `key`.
/// `label` is the channel prefix that gets mixed into the MAC message so
/// alpha / beta tokens cannot be reused interchangeably on the server.
fn make_channel_token(label: &str, key: &str) -> String {
    use hmac::Mac;
    use self::types::HmacSha256;
    // 5-minute rolling window — limits replay exposure while tolerating clock skew.
    let window = chrono::Utc::now().timestamp() / 300;
    let message = format!("{}:{}", label, window);
    // HMAC-SHA256 accepts any key length by design — new_from_slice is infallible here.
    #[allow(clippy::expect_used)]
    let mut mac = HmacSha256::new_from_slice(key.as_bytes())
        .expect("HMAC accepts any key size");
    mac.update(message.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

fn make_beta_channel_token() -> String {
    make_channel_token("beta", self::types::BETA_CHANNEL_KEY)
}

fn make_alpha_channel_token() -> String {
    make_channel_token("alpha", self::types::ALPHA_CHANNEL_KEY)
}

/// Returns the update channel for this installation, together with a
/// server-verifiable HMAC token for entitled clients.
///
/// Called by `UpdateChecker.tsx` before each `check()` call.
/// The token is forwarded as `X-Update-Token`; the server validates it
/// before serving the channel manifest so the channel cannot be spoofed
/// by header alone.
///
/// Ordering matters: we check Superuser first so that a licence that is
/// somehow tagged as both cannot downgrade itself to beta. In practice
/// the server issues exactly one license_type string per licence key.
#[tauri::command]
pub async fn get_update_channel(state: State<'_, AppState>) -> Result<UpdateChannelInfo> {
    let license_type: Option<self::types::LicenseType> = if let Some(engine) = &state.license_engine {
        if let Some(cached) = engine.cached().await {
            cached
                .license_type
                .as_deref()
                .map(self::types::LicenseType::from_str_loose)
        } else {
            None
        }
    } else {
        None
    };

    match license_type {
        Some(self::types::LicenseType::Superuser) => Ok(UpdateChannelInfo {
            channel: "alpha".to_string(),
            token: Some(make_alpha_channel_token()),
        }),
        Some(self::types::LicenseType::Developer) => Ok(UpdateChannelInfo {
            channel: "beta".to_string(),
            token: Some(make_beta_channel_token()),
        }),
        _ => Ok(UpdateChannelInfo {
            channel: "stable".to_string(),
            token: None,
        }),
    }
}

/// Returns `true` when the application is running in an E2E test environment.
///
/// Detection is based on the `RHEOLAB_E2E_SKIP_LICENSE_GATE=1` environment
/// variable, which is already the standard marker the test harness sets for
/// other E2E-only behaviours (license-gate bypass, demo-counter no-op).
///
/// The frontend uses this to suppress side-effects that would otherwise
/// destabilise Playwright tests — most importantly, the Tauri auto-updater
/// (which can trigger a WebView2 navigation to `edge://downloads/hub` mid-run
/// and break CDP-based test fixtures).
#[tauri::command]
pub fn is_e2e_mode() -> bool {
    std::env::var("RHEOLAB_E2E_SKIP_LICENSE_GATE").as_deref() == Ok("1")
}

// ── Security regression tests (P2-3 groups G, D) ──────────────────────


#[cfg(test)]
#[path = "licensing_tests.rs"]
mod tests;
