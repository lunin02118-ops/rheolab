#![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! Online license validation — HTTP calls to the license server.
//!
//! Encapsulates `validate_online()` and `activate_online()` logic.

use crate::error::{AppError, Result};
use chrono::Utc;
use serde_json::{json, Value};

use super::crypto::save_secure_last_check;
use super::hardware::{all_legacy_ids, get_or_create_machine_id};
use super::types::{APP_VERSION, LICENSE_SERVER_URL};

// ── Internal result types ──────────────────────────────────────────────

/// Result of an online validation attempt.
#[derive(Debug, Clone)]
pub struct OnlineValidationResult {
    /// Whether the server confirmed the license as valid
    pub success: bool,
    /// Server-reported status: "active", "revoked", "expired", "inactive", etc.
    pub status: Option<String>,
    /// Days remaining until expiry
    pub days_remaining: Option<i64>,
    /// Error message (network or server)
    pub error: Option<String>,
    /// Whether we actually reached the server (vs. network error)
    pub server_reached: bool,
    /// The exact JSON string the server RSA-signed (present when status == "active").
    /// Stored back into DB so RSA verification passes on subsequent cold starts
    /// without contacting the server again.
    pub signed_payload: Option<String>,
    /// The Base64-encoded RSA signature for `signed_payload`.
    pub server_signature: Option<String>,
}

// ── HTTP client factory ────────────────────────────────────────────────

fn http_client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(AppError::Http)
}

fn handle_network_error(error: &reqwest::Error) -> String {
    let msg = error.to_string();
    if msg.contains("certificate") || msg.contains("ssl") || msg.contains("tls") {
        return "Ошибка безопасности соединения. Проверьте системное время и дату на компьютере."
            .to_string();
    }
    if msg.contains("dns error")
        || msg.contains("resolve")
        || msg.contains("Name or service not known")
    {
        return "Сервер лицензий недоступен. Проверьте подключение к интернету.".to_string();
    }
    format!("Ошибка соединения с сервером лицензий: {}", msg)
}

fn build_validation_result(
    http_status: reqwest::StatusCode,
    data: Value,
    app_data_dir: &std::path::Path,
) -> OnlineValidationResult {
    // Save the check date whenever the server was reached, regardless of
    // license validity. The date tracks "when we last talked to the server",
    // not "when we last had a valid license". This prevents the situation
    // where an expired/revoked/wrong-machine response causes is_online_check_due()
    // to always return true (looping HTTP on every restart).
    let today = Utc::now().format("%Y-%m-%d").to_string();
    if let Err(e) = save_secure_last_check(app_data_dir, &today) {
        tracing::warn!("Failed to save last-check date after validation: {}", e);
    }

    if !http_status.is_success() {
        // Server reached but returned 4xx/5xx.
        let rejection_status = data["reason"]
            .as_str()
            .map(|r| r.to_string())
            .unwrap_or_else(|| "server_error".to_string());
        return OnlineValidationResult {
            success: false,
            status: Some(rejection_status),
            days_remaining: None,
            error: data["error"]
                .as_str()
                .or_else(|| data["message"].as_str())
                .map(|s| s.to_string()),
            server_reached: true,
            signed_payload: None,
            server_signature: None,
        };
    }

    let server_success = data["success"].as_bool().unwrap_or(false);
    let valid = data["valid"].as_bool().unwrap_or(false);
    let reason = data["reason"].as_str().unwrap_or("");

    let status = if !server_success {
        match reason {
            "revoked" => "revoked",
            "inactive" => "inactive",
            _ => "expired",
        }
    } else if valid {
        "active"
    } else {
        "expired"
    };

    // Capture signedPayload + signature so the caller can refresh
    // the DB record — avoids re-activating on every cold start when RSA
    // verification would otherwise fail on the old (pre-v0.1.524) record.
    let signed_payload = if server_success && valid {
        data["signedPayload"].as_str().map(|s| s.to_string())
    } else {
        None
    };
    let server_signature = if server_success && valid {
        data["signature"].as_str().map(|s| s.to_string())
    } else {
        None
    };
    if signed_payload.is_some() {
        tracing::debug!("validate_online: received fresh signedPayload from server");
    }

    OnlineValidationResult {
        success: server_success && valid,
        status: Some(status.to_string()),
        days_remaining: data["daysRemaining"].as_i64(),
        error: if !server_success {
            data["message"].as_str().map(|s| s.to_string())
        } else {
            None
        },
        server_reached: true,
        signed_payload,
        server_signature,
    }
}

// ── Core validation ────────────────────────────────────────────────────

/// Validate a license key against the server, binding it to the current machine.
///
/// On success, also persists the check date to secure storage.
/// Sends `legacyMachineIds` so the server can auto-migrate v1 → v2 bindings.
pub(super) async fn validate_online(
    key: &str,
    app_data_dir: &std::path::Path,
) -> OnlineValidationResult {
    let machine_id = get_or_create_machine_id(app_data_dir);
    let legacy_ids = all_legacy_ids(app_data_dir);
    let client = match http_client() {
        Ok(c) => c,
        Err(e) => {
            return OnlineValidationResult {
                success: false,
                status: None,
                days_remaining: None,
                error: Some(e.to_string()),
                server_reached: false,
                signed_payload: None,
                server_signature: None,
            };
        }
    };

    let body = json!({
        "key": key,
        "machineId": machine_id,
        "legacyMachineIds": legacy_ids,
    });

    match client
        .post(format!("{}/api/validate.php", LICENSE_SERVER_URL))
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => {
            let http_status = resp.status();
            let data: Value = resp.json().await.unwrap_or(json!({}));
            build_validation_result(http_status, data, app_data_dir)
        }
        Err(e) => OnlineValidationResult {
            success: false,
            status: None,
            days_remaining: None,
            error: Some(handle_network_error(&e)),
            server_reached: false,
            signed_payload: None,
            server_signature: None,
        },
    }
}

/// Activate a license key on the server (binds to current machine).
///
/// Sends `legacyMachineIds` so the server can recognise a machine-ID migration
/// (v1 → v2 algorithm) and allow re-binding in a single roundtrip.
///
/// Returns raw `serde_json::Value` from the server response.
pub(super) async fn activate_online(key: &str, app_data_dir: &std::path::Path) -> Result<Value> {
    let machine_id = get_or_create_machine_id(app_data_dir);
    let legacy_ids = all_legacy_ids(app_data_dir);
    let client = http_client()?;

    let body = json!({
        "key": key,
        "machineId": machine_id,
        "legacyMachineIds": legacy_ids,
        "appVersion": APP_VERSION,
        "platform": "win32",
    });

    match client
        .post(format!("{}/api/activate.php", LICENSE_SERVER_URL))
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            let data: Value = resp.json().await.unwrap_or(json!({}));
            if !status.is_success() {
                return Err(data["error"]
                    .as_str()
                    .unwrap_or("Activation failed")
                    .to_string()
                    .into());
            }
            // Save the check date on successful activation
            let today = Utc::now().format("%Y-%m-%d").to_string();
            if let Err(e) = save_secure_last_check(app_data_dir, &today) {
                tracing::warn!("Failed to save last-check date after activation: {}", e);
            }
            Ok(data)
        }
        Err(e) => Err(handle_network_error(&e).into()),
    }
}

/// Look up any active license bound to the current machine fingerprint
/// (auto-recovery path used when no local license file exists, e.g. after
/// an OS reinstall on the same hardware).
///
/// Returns:
/// - `Ok(Some(json))` — server found an active license for this fingerprint.
///   The `json` has the same shape as `activate_online`'s response:
///   `{ license, key, signedPayload, signature }`.
/// - `Ok(None)` — server reached, but no active license is bound to this
///   machine (HTTP 404 / `success: false`).
/// - `Err(...)` — network error, rate-limited (429), or server 5xx.
///
/// The caller is responsible for RSA-verifying `signedPayload` + `signature`
/// via [`super::crypto::verify_server_signature`] before trusting the result.
pub(super) async fn find_by_machine_online(
    app_data_dir: &std::path::Path,
) -> Result<Option<Value>> {
    let machine_id = get_or_create_machine_id(app_data_dir);
    let client = http_client()?;

    let body = json!({ "machineId": machine_id });

    let resp = match client
        .post(format!("{}/api/find_by_machine.php", LICENSE_SERVER_URL))
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return Err(handle_network_error(&e).into()),
    };

    let http_status = resp.status();

    // HTTP 404 == "not_found" — treated as the deterministic "no license"
    // outcome, not an error.  Returning Ok(None) lets the caller cleanly
    // fall through to demo mode.
    if http_status.as_u16() == 404 {
        return Ok(None);
    }

    let data: Value = resp.json().await.unwrap_or(json!({}));

    if !http_status.is_success() {
        let err = data["error"]
            .as_str()
            .unwrap_or("Recovery failed")
            .to_string();
        return Err(err.into());
    }

    if data["success"].as_bool() != Some(true) {
        return Ok(None);
    }

    // Persist the check date so subsequent cold starts respect the online-check
    // TTL — we just reached the server.
    let today = Utc::now().format("%Y-%m-%d").to_string();
    if let Err(e) = save_secure_last_check(app_data_dir, &today) {
        tracing::warn!(
            "Failed to save last-check date after machine-ID recovery: {}",
            e
        );
    }

    Ok(Some(data))
}

/// Register this machine's demo period with the license server and return the
/// server's authoritative `first_seen_at` date (YYYY-MM-DD).
///
/// ## How it works
/// - **First call**: the server inserts a new row in `demo_users` and returns
///   today's date.
/// - **Subsequent calls**: the server returns the *original* `first_seen_at` date,
///   regardless of local clock or DB state.
///
/// This creates a tamper-resistant anchor: even if the user deletes the local
/// SQLite DB, reinstalls the app, or manually edits `first_launch_date`, the
/// next online check will fetch the real start date from the server and
/// correct the local state.
///
/// Returns `None` if the server is unreachable (caller falls back to local state).
pub(super) async fn register_demo_online(app_data_dir: &std::path::Path) -> Option<String> {
    let machine_id = get_or_create_machine_id(app_data_dir);
    let client = http_client().ok()?;

    let body = json!({ "machineId": machine_id });

    let resp = client
        .post(format!("{}/api/register_demo.php", LICENSE_SERVER_URL))
        .json(&body)
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        tracing::debug!(
            "register_demo_online: server returned HTTP {}",
            resp.status()
        );
        return None;
    }

    let data: Value = resp.json().await.ok()?;

    if data["success"].as_bool() != Some(true) {
        return None;
    }

    // Take only the date part (first 10 chars) from the ISO datetime/date string.
    data["firstSeenAt"]
        .as_str()
        .map(|s| s.get(..10).unwrap_or(s).to_string())
}

/// Deactivate (unbind) a license from this machine.
///
/// **Audit-v2 LIC-004 — strict success contract:**
///
/// Returns `Ok(data)` only when the server affirmatively confirmed the
/// unbind, signalled by **both** a 2xx HTTP status code **and** a JSON
/// body containing `success: true`.  Any other outcome — non-2xx HTTP
/// status, network failure, JSON without `success`, or an explicit
/// `success: false` — is mapped to `Err(...)` with a human-readable
/// description of the failure.
///
/// The previous implementation returned `Ok(data)` for **any** response
/// the server produced, which meant a server-side rejection (e.g. "key
/// already unbound", "rate-limited", "key belongs to another customer")
/// was silently treated as a successful deactivation by the caller.
/// `engine::operations::deactivate` then cleared local state and the
/// user could no longer reach the (still bound, server-side) licence —
/// effectively a self-DoS on legitimate accounts and a way to mask
/// tampering attempts on others.
pub(super) async fn deactivate_online(key: &str, app_data_dir: &std::path::Path) -> Result<Value> {
    let machine_id = get_or_create_machine_id(app_data_dir);
    let client = http_client()?;

    let body = json!({
        "key": key,
        "machineId": machine_id,
    });

    let resp = match client
        .post(format!("{}/api/deactivate.php", LICENSE_SERVER_URL))
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => return Err(handle_network_error(&e).into()),
    };

    let http_status = resp.status();
    let data: Value = resp.json().await.unwrap_or(json!({}));
    interpret_deactivate_response(http_status, data)
}

/// Pure helper for the strict-success contract used by `deactivate_online`.
///
/// Extracted so the audit-v2 LIC-004 contract can be unit-tested without
/// standing up a mock HTTP server.  Same gating logic as inline at the
/// callsite — kept private to this module because no other caller needs it.
fn interpret_deactivate_response(http_status: reqwest::StatusCode, data: Value) -> Result<Value> {
    // Gate 1: HTTP status must be 2xx.  4xx / 5xx are always errors —
    // there is no "successful 4xx" deactivation path on the server.
    if !http_status.is_success() {
        let server_msg = data["error"]
            .as_str()
            .unwrap_or("Server rejected deactivation");
        return Err(format!(
            "Deactivation failed (HTTP {}): {}",
            http_status.as_u16(),
            server_msg
        )
        .into());
    }

    // Gate 2: JSON body must explicitly say `success: true`.  A 200 OK
    // with `success: false` (or with the field missing) means the
    // server reached a clean rejection decision and reported it in the
    // body — that must NOT be treated as a successful unbind.
    if data["success"].as_bool() != Some(true) {
        let server_msg = data["error"]
            .as_str()
            .unwrap_or("Server did not confirm deactivation (success != true)");
        return Err(format!("Deactivation refused: {}", server_msg).into());
    }

    Ok(data)
}

/// Migrate a license binding from a legacy machine ID to the current v2 ID.
///
/// Called when the server already bound a license to a v1 machine ID and we
/// need to update it to the new v2 ID without a full deactivate + re-activate
/// (which might be blocked by "already activated on another machine").
///
/// Returns `Ok(true)` if migration succeeded, `Ok(false)` if the server rejected
/// the legacy ID, and `Err` on network/server errors.
pub(super) async fn migrate_machine_online(
    key: &str,
    app_data_dir: &std::path::Path,
) -> Result<bool> {
    let machine_id = get_or_create_machine_id(app_data_dir);
    let legacy_ids = all_legacy_ids(app_data_dir);
    let client = http_client()?;

    let body = json!({
        "key": key,
        "machineId": machine_id,
        "legacyMachineIds": legacy_ids,
    });

    match client
        .post(format!("{}/api/migrate_machine.php", LICENSE_SERVER_URL))
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => {
            let data: Value = resp.json().await.unwrap_or(json!({}));
            let success = data["success"].as_bool().unwrap_or(false);
            if success {
                tracing::info!("Machine ID migration succeeded on server");
            } else {
                tracing::warn!(
                    "Machine ID migration rejected: {}",
                    data["error"].as_str().unwrap_or("unknown")
                );
            }
            Ok(success)
        }
        Err(e) => Err(handle_network_error(&e).into()),
    }
}

#[cfg(test)]
mod tests {
    use super::super::crypto::get_secure_last_check;
    use super::*;

    #[test]
    fn build_validation_result_persists_last_check_for_http_rejection() {
        let tmp = std::env::temp_dir().join("rheolab_test_online_http_rejection");
        let _ = std::fs::create_dir_all(&tmp);

        let expected_date = Utc::now().format("%Y-%m-%d").to_string();
        let result = build_validation_result(
            reqwest::StatusCode::FORBIDDEN,
            json!({
                "success": false,
                "valid": false,
                "reason": "wrong_machine",
                "message": "Ключ не привязан к этому устройству"
            }),
            &tmp,
        );

        assert!(!result.success);
        assert!(result.server_reached);
        assert_eq!(result.status.as_deref(), Some("wrong_machine"));
        assert_eq!(
            get_secure_last_check(&tmp).as_deref(),
            Some(expected_date.as_str()),
            "Any server response should persist the last successful contact date"
        );

        let _ = std::fs::remove_dir_all(tmp.parent().unwrap_or(&tmp).join(".rheolab"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    // ── Audit-v2 LIC-004 regression guards ────────────────────────────

    /// Happy path: HTTP 2xx + JSON `success: true` → `Ok(data)`.
    #[test]
    fn interpret_deactivate_response_accepts_2xx_with_success_true() {
        let result = interpret_deactivate_response(
            reqwest::StatusCode::OK,
            json!({"success": true, "message": "Лицензия отвязана"}),
        );
        assert!(result.is_ok(), "200 OK + success:true must be Ok");
    }

    /// Server replies 200 OK but `success: false` (e.g. "key already
    /// unbound", "key belongs to another customer").  Pre-LIC-004 this
    /// returned Ok(data) and the caller wiped local state — must now Err.
    #[test]
    fn interpret_deactivate_response_rejects_2xx_with_success_false() {
        let result = interpret_deactivate_response(
            reqwest::StatusCode::OK,
            json!({"success": false, "error": "key_already_unbound"}),
        );
        assert!(
            result.is_err(),
            "200 OK + success:false must NOT be treated as a successful deactivation"
        );
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.contains("Deactivation refused") && msg.contains("key_already_unbound"),
            "error message should explain the server-side rejection: got {msg}"
        );
    }

    /// Server replies 200 OK with no `success` field at all → must Err.
    /// Empty bodies, non-JSON noise, or future server bugs must not
    /// silently look like a successful deactivation.
    #[test]
    fn interpret_deactivate_response_rejects_2xx_without_success_field() {
        let result = interpret_deactivate_response(
            reqwest::StatusCode::OK,
            json!({"message": "ok"}), // no success key
        );
        assert!(
            result.is_err(),
            "200 OK without success:true field must Err — server contract requires explicit confirmation"
        );
    }

    /// Server replies 4xx (e.g. 401 unauthorised, 404 unknown key) — must Err.
    #[test]
    fn interpret_deactivate_response_rejects_4xx() {
        let result = interpret_deactivate_response(
            reqwest::StatusCode::UNAUTHORIZED,
            json!({"error": "invalid_key"}),
        );
        assert!(result.is_err(), "401 must Err");
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.contains("HTTP 401") && msg.contains("invalid_key"),
            "error must surface HTTP code + server message: got {msg}"
        );
    }

    /// Server replies 5xx — must Err (and not be silently treated as success
    /// even if the body happens to contain `success: true` due to a server
    /// bug; the HTTP gate runs first).
    #[test]
    fn interpret_deactivate_response_rejects_5xx_even_if_body_says_success() {
        let result = interpret_deactivate_response(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            json!({"success": true, "error": "internal_error"}), // contradictory body
        );
        assert!(
            result.is_err(),
            "5xx must always Err regardless of body content — never trust the body alone"
        );
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.contains("HTTP 500"),
            "error must include HTTP status: got {msg}"
        );
    }

    /// Server returned a completely empty / non-JSON body (so `data` is
    /// `{}`) along with non-2xx HTTP — must Err with a generic message,
    /// not panic on missing fields.
    #[test]
    fn interpret_deactivate_response_handles_empty_body() {
        let result =
            interpret_deactivate_response(reqwest::StatusCode::BAD_GATEWAY, json!({}));
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(msg.contains("HTTP 502"));
    }
}
