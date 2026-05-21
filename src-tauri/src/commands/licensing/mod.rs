#![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Licensing commands — native Rust implementation (V2).
//!
//! All licensing logic runs exclusively in Rust via [`LicenseEngine`].
//! Tauri commands: machine-id, was-ever-licensed, DB checkpoint,
//! experiment reset, and the V2 engine commands (check, status,
//! activate, deactivate, can-save, register-experiment).

pub(super) mod crypto;
#[cfg(test)]
pub(super) mod demo;
pub mod engine;
pub(super) mod features;
pub(super) mod hardware;
pub(super) mod online;
pub(super) mod security;
pub mod types;

pub use engine::LicenseEngine;
pub use hardware::all_legacy_ids;
pub use hardware::get_or_create_machine_id;
pub use hardware::{debug_fingerprint_info, FingerprintDebugInfo};
pub use types::assert_production_keys;

use crate::error::{AppError, Result};
use crate::state::AppState;
use serde_json::{json, Value};
use tauri::State;

use self::crypto::{get_system_state, verify_signature};
use self::types::{SimpleResult, DB_KEY_WAS_LICENSED, LOCAL_USER_ID};

// ── Async write-capability check (shared by all write/export commands) ──────

/// Returns `true` if the current license state allows writes (Active or Grace).
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
            // Return the cached verdict immediately — never block the write
            // path on a network round-trip.  Background reconciliation
            // (setup.rs → online license check task) keeps the cache fresh;
            // if it has expired the user simply sees the last-known state
            // until the next background refresh completes.
            engine.can_write().await
        }
        None => false,
    }
}

/// Fail closed unless the current license state allows writes/exports.
///
/// Use this at the start of every mutating or data-exporting IPC command,
/// before acquiring a SQLite connection or doing file-system work.
pub(crate) async fn require_write_license(state: &AppState) -> Result<()> {
    if can_write_via_engine(state).await {
        Ok(())
    } else {
        Err(AppError::License("required".into()))
    }
}

/// Returns the [`LicenseFeatures`] currently in effect for this process.
///
/// **Audit-v2 REP-001:** the report-generation IPCs used to gate solely
/// on `can_write_via_engine` (which says "Active OR Grace, fine"),
/// but never inspected the per-feature flags or per-feature limits.  A
/// Trial and corporate licences have different limits; a malicious or buggy frontend could
/// hand the native PDF engine an unbounded comparison list and watch
/// memory go through the roof.
///
/// `current_features` is the per-feature counterpart of
/// `can_write_via_engine`: it returns the cached features so individual
/// IPCs can enforce the exact flags the licence grants.
///
/// Behaviour:
/// * In debug builds with `RHEOLAB_E2E_SKIP_LICENSE_GATE=1` → returns
///   [`features::full_features`].  Mirrors the bypass that
///   `can_write_via_engine` honours for Playwright fixtures.  Release
///   builds do **not** honour this env var, matching audit-v2 LIC-001.
/// * If the engine has produced a cached `LicenseCheckResult` → returns
///   that result's `features` (already correct for Active / Grace / Expired
///   / Revoked).
/// * Otherwise (engine not yet attached, cache empty before first
///   `check()` call) → returns [`features::expired_features`] which
///   denies everything.  Fail-closed by default.
pub(crate) async fn current_features(state: &AppState) -> types::LicenseFeatures {
    #[cfg(debug_assertions)]
    {
        if std::env::var("RHEOLAB_E2E_SKIP_LICENSE_GATE").as_deref() == Ok("1") {
            return features::full_features();
        }
    }

    match state.license_engine.as_ref() {
        Some(engine) => match engine.cached().await {
            Some(result) => result.features,
            None => features::expired_features(),
        },
        None => features::expired_features(),
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
    use self::crypto::verify_server_signature;
    use self::types::DB_KEY_LICENSE;
    use crate::error::AppError;
    // E2E test bypass: only available in debug (non-release) builds.
    // Prevents production binaries from being launched with the env var to skip licensing.
    #[cfg(debug_assertions)]
    {
        if std::env::var("RHEOLAB_E2E_SKIP_LICENSE_GATE").as_deref() == Ok("1") {
            return Ok(());
        }
    }
    match get_system_state(conn, DB_KEY_LICENSE) {
        Ok(None) => Err(AppError::License("required".into())),
        Err(e) => Err(AppError::License(format!("DB error: {e}"))),
        Ok(Some((value, signature))) => {
            if !verify_signature(&value, &signature) {
                tracing::warn!("[check_license_gate] License HMAC mismatch — rejecting");
                return Err(AppError::License("required".into()));
            }

            let data: Value = serde_json::from_str(&value).unwrap_or(json!({}));

            // Level 2: RSA server-signature verification — consistent with LicenseEngine.
            // Prevents forged HMAC-only records (extracted HMAC key) from bypassing the gate.
            // Legacy grace period closed (S-2): all licenses must now carry RSA proof.
            let has_signed_payload = data["signedPayload"].is_string();
            let has_server_sig = data["serverSignature"].is_string();
            if has_signed_payload && has_server_sig {
                let payload = data["signedPayload"].as_str().unwrap_or("");
                let server_sig = data["serverSignature"].as_str().unwrap_or("");
                if !verify_server_signature(payload, server_sig) {
                    tracing::warn!("[check_license_gate] RSA server-signature failed — rejecting");
                    return Err(AppError::License("required".into()));
                }
            } else {
                // No signedPayload/serverSignature — legacy HMAC-only record.
                // Grace period closed (S-2): require RSA for all licenses.
                tracing::warn!("[check_license_gate] Legacy HMAC-only record — RSA required. Re-activate to continue.");
                return Err(AppError::License("required".into()));
            }
            let license_type = data["type"].as_str().unwrap_or("");
            if types::LicenseType::from_str_supported(license_type).is_none() {
                tracing::warn!(
                    "[check_license_gate] Unsupported license type '{}' — rejecting",
                    license_type
                );
                return Err(AppError::License("required".into()));
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

/// Legacy compatibility hook for the old demo experiment counter.
///
/// The product no longer has a demo license mode, but save flows still call
/// this function from older code paths. Keep it as a no-op rather than
/// touching the surrounding transaction code.
pub(crate) fn maybe_increment_demo_save(conn: &rusqlite::Connection) {
    let _ = conn;
}

// ── Tauri commands ─────────────────────────────────────────────────────

/// Get hardware machine ID
#[tauri::command]
pub async fn licensing_machine_id(state: State<'_, AppState>) -> Result<String> {
    Ok(get_or_create_machine_id(&state.app_data_dir))
}

/// Return the raw hardware components that feed into the v2 machine ID
/// plus the final ID itself.  Intended for the **Settings → Диагностика**
/// panel so users can verify, before and after an OS reinstall, that their
/// fingerprint is unchanged (and therefore that auto-recovery *will* work).
///
/// Safe to call repeatedly — both the components and the final ID are
/// process-cached after the first PowerShell roundtrip.
#[tauri::command]
pub async fn licensing_debug_fingerprint(
    state: State<'_, AppState>,
) -> Result<FingerprintDebugInfo> {
    Ok(debug_fingerprint_info(&state.app_data_dir))
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

/// Reset (delete) the experiments belonging to the local user.
///
/// **IPC scope tightening (audit-preflight SEC-002)**: this command no longer
/// accepts an arbitrary `user_id` argument.  RheoLab Enterprise is a
/// single-user desktop application — every row is owned by `LOCAL_USER_ID` —
/// so accepting a caller-supplied identifier was an unused IPC parameter
/// that allowed the webview (or a compromised page) to wipe experiments
/// for any value it chose.  The function now hard-codes `LOCAL_USER_ID`.
#[tauri::command]
pub async fn licensing_reset_experiments(state: State<'_, AppState>) -> Result<SimpleResult> {
    require_write_license(&state).await?;

    use rusqlite::params;
    let conn = state.pool_conn()?;

    let tx = conn.unchecked_transaction()?;

    let count: i64 = tx.query_row(
        "SELECT COUNT(*) FROM Experiment WHERE userId = ?1",
        params![LOCAL_USER_ID],
        |row| row.get(0),
    )?;

    // Delete reagents first (FK), then experiments — wrapped in RAII transaction
    tx.execute(
        "DELETE FROM ExperimentReagent WHERE experimentId IN \
         (SELECT id FROM Experiment WHERE userId = ?1)",
        params![LOCAL_USER_ID],
    )?;

    tx.execute(
        "DELETE FROM Experiment WHERE userId = ?1",
        params![LOCAL_USER_ID],
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
    require_write_license(&state).await?;

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

    let count: i64 = tx.query_row("SELECT COUNT(*) FROM Experiment", [], |row| row.get(0))?;

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
    let engine = state
        .license_engine
        .as_ref()
        .ok_or("License engine not initialized")?;
    Ok(engine.check(&state.db_pool).await)
}

/// Get the cached license status (fast, no I/O).
/// Returns `None` if `licensing_check` hasn't been called yet.
#[tauri::command]
pub async fn licensing_get_status(
    state: State<'_, AppState>,
) -> Result<Option<types::LicenseCheckResult>> {
    let engine = state
        .license_engine
        .as_ref()
        .ok_or("License engine not initialized")?;
    Ok(engine.cached().await)
}

/// Activate a license key via the engine (server call + DB store + cache update).
#[tauri::command]
pub async fn licensing_activate_full(
    state: State<'_, AppState>,
    key: String,
) -> Result<types::LicenseCheckResult> {
    let engine = state
        .license_engine
        .as_ref()
        .ok_or("License engine not initialized")?;
    engine.activate(&key, &state.db_pool).await
}

/// Generate an offline Corporate activation request code for support.
#[tauri::command]
pub async fn licensing_offline_activation_request(
    state: State<'_, AppState>,
) -> Result<types::OfflineActivationRequestInfo> {
    let engine = state
        .license_engine
        .as_ref()
        .ok_or("License engine not initialized")?;
    engine.generate_offline_activation_request()
}

/// Activate a Corporate license using a signed offline activation code.
#[tauri::command]
pub async fn licensing_activate_offline(
    state: State<'_, AppState>,
    activation_code: String,
) -> Result<types::LicenseCheckResult> {
    let engine = state
        .license_engine
        .as_ref()
        .ok_or("License engine not initialized")?;
    engine
        .activate_offline(&activation_code, &state.db_pool)
        .await
}

/// Deactivate the current license via the engine.
#[tauri::command]
pub async fn licensing_deactivate(state: State<'_, AppState>) -> Result<types::LicenseCheckResult> {
    let engine = state
        .license_engine
        .as_ref()
        .ok_or("License engine not initialized")?;
    engine.deactivate(&state.db_pool).await
}

/// Check if the current license allows saving/exporting (write gate).
#[tauri::command]
pub async fn licensing_can_save(state: State<'_, AppState>) -> Result<bool> {
    let engine = state
        .license_engine
        .as_ref()
        .ok_or("License engine not initialized")?;
    Ok(engine.can_write().await)
}

/// Register a saved experiment (increments demo counter, re-checks).
/// In licensed mode this is a no-op re-check.
#[tauri::command]
pub async fn licensing_register_experiment(
    state: State<'_, AppState>,
) -> Result<types::LicenseCheckResult> {
    let engine = state
        .license_engine
        .as_ref()
        .ok_or("License engine not initialized")?;
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
/// - `"stable"` — everything else (Trial, Corporate, unlicensed)
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
    use self::types::HmacSha256;
    use hmac::Mac;
    // 5-minute rolling window — limits replay exposure while tolerating clock skew.
    let window = chrono::Utc::now().timestamp() / 300;
    let message = format!("{}:{}", label, window);
    // HMAC-SHA256 accepts any key length by design — new_from_slice is infallible here.
    #[allow(clippy::expect_used)]
    let mut mac = HmacSha256::new_from_slice(key.as_bytes()).expect("HMAC accepts any key size");
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
    let license_type: Option<self::types::LicenseType> = if let Some(engine) = &state.license_engine
    {
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

#[cfg(any(debug_assertions, test))]
fn debug_env_flag(name: &str) -> bool {
    std::env::var(name).as_deref() == Ok("1")
}

/// Returns `true` when the application is running with the license-gate E2E bypass.
///
/// Detection is based on the `RHEOLAB_E2E_SKIP_LICENSE_GATE=1` environment
/// variable, which is already the standard marker the test harness sets for
/// license-gate bypass and demo-counter no-op.
///
/// **Audit-v2 E2E-001:** the env-driven detection is gated to
/// `cfg(any(debug_assertions, test))`.  In a `cargo build --release`
/// binary this command **always** returns `false`, even if the user
/// (or a malicious launcher) sets `RHEOLAB_E2E_SKIP_LICENSE_GATE=1` in
/// their environment.
#[tauri::command]
pub fn is_e2e_mode() -> bool {
    #[cfg(any(debug_assertions, test))]
    {
        debug_env_flag("RHEOLAB_E2E_SKIP_LICENSE_GATE")
    }
    #[cfg(not(any(debug_assertions, test)))]
    {
        false
    }
}

/// Returns `true` when E2E should suppress the auto-updater.
///
/// Kept separate from [`is_e2e_mode`] so Playwright can test updater behaviour
/// without also opening the license gate.  Release builds ignore the env var and
/// always return `false`, preserving the updater as a security delivery path.
#[tauri::command]
pub fn is_updater_disabled() -> bool {
    #[cfg(any(debug_assertions, test))]
    {
        debug_env_flag("RHEOLAB_E2E_DISABLE_UPDATER")
    }
    #[cfg(not(any(debug_assertions, test)))]
    {
        false
    }
}

// ── Security regression tests (P2-3 groups G, D) ──────────────────────

#[cfg(test)]
#[path = "licensing_tests.rs"]
mod tests;
