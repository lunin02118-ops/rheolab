use chrono::Utc;
use serde_json::Value;

use super::super::crypto::{delete_system_state, get_system_state, sign_data, upsert_system_state, verify_server_signature, verify_signature};
use super::super::features::{expired_features, features_for_type};
use super::super::online::{migrate_machine_online, validate_online};
use super::super::security::{is_clock_tampered, is_offline_overdue};
use super::super::types::{
    LicenseCheckResult, LicenseSource, LicenseStatus, LicenseType,
    DB_KEY_LICENSE, DEFAULT_GRACE_PERIOD_DAYS,
};
use super::{compute_days_remaining, mask_key, parse_expiry, LicenseEngine};
use super::super::hardware::delete_legacy_cache;
use crate::db::DbPool;

impl LicenseEngine {
    // ── Internal ───────────────────────────────────────────────────────

    /// Load and HMAC-verify the license from the DB. Returns `(json_string, signature)`.
    ///
    /// Two-level verification (F-07):
    /// 1. **HMAC** — protects against local DB tampering (always checked).
    /// 2. **RSA** — proves the license originated from the real server.
    ///    Requires `signedPayload` + `serverSignature` to be present in the
    ///    stored record.  Records without these fields are rejected — the
    ///    time-limited legacy grace period has been closed (S-2).
    ///
    /// Automatic HMAC-rescue (S-3): when the HMAC check fails but the RSA
    /// proof is intact, the record is re-signed under the current
    /// `INTEGRITY_SECRET_KEY` instead of being discarded.  This covers the
    /// real-world case where the build-time integrity key rotated between
    /// releases — RSA is the authoritative server-side proof, HMAC is only
    /// a local tamper-detection layer, so as long as RSA verifies the
    /// payload the record is trustworthy.  Without RSA proof we cannot
    /// distinguish a stale-key record from a forged one and still reject.
    pub(super) fn load_verified_license(
        &self,
        conn: &rusqlite::Connection,
    ) -> Option<(String, String)> {
        let record = get_system_state(conn, DB_KEY_LICENSE).ok()?;
        let (value, signature) = match record {
            Some(pair) => pair,
            None => {
                self.diag("load_verified_license: no DB record found");
                return None;
            }
        };

        let hmac_ok = verify_signature(&value, &signature);

        // Parse JSON once — every downstream branch (HMAC-rescue, RSA verify,
        // legacy-reject) needs to inspect `signedPayload` / `serverSignature`.
        let data = match serde_json::from_str::<Value>(&value) {
            Ok(data) => data,
            Err(e) => {
                self.diag(&format!(
                    "load_verified_license: malformed JSON payload — rejecting record: {}",
                    e
                ));
                return None;
            }
        };
        let has_signed_payload = data["signedPayload"].is_string();
        let has_server_sig = data["serverSignature"].is_string();

        if !hmac_ok {
            // Rescue path: HMAC mismatch is almost always caused by the
            // build-time `INTEGRITY_SECRET_KEY` rotating between releases,
            // not by genuine tampering.  If the server's RSA proof is
            // present and valid we re-sign the record under the current
            // key instead of dropping the user back into demo mode.
            if !has_signed_payload || !has_server_sig {
                self.diag(
                    "load_verified_license: HMAC FAILED and no RSA proof — \
                     DB record tampered or key changed, re-activation required.",
                );
                return None;
            }
            let payload = data["signedPayload"].as_str().unwrap_or("");
            let server_sig = data["serverSignature"].as_str().unwrap_or("");
            if !verify_server_signature(payload, server_sig) {
                self.diag(
                    "load_verified_license: HMAC FAILED and RSA invalid — \
                     rejecting record (likely tampered).",
                );
                return None;
            }
            self.diag(
                "load_verified_license: HMAC FAILED but RSA PASSED — \
                 integrity key rotated, re-signing record under current key.",
            );
            if let Err(e) = upsert_system_state(conn, DB_KEY_LICENSE, &value) {
                self.diag(&format!(
                    "load_verified_license: HMAC re-sign failed ({e}) — rejecting record."
                ));
                return None;
            }
            // Return the fresh signature so callers see a consistent view
            // of the DB after the rescue write.
            let new_signature = sign_data(&value);
            return Some((value, new_signature));
        }

        // Level 2: RSA server-signature verification (HMAC already passed).
        self.diag(&format!(
            "load_verified_license: has_signedPayload={has_signed_payload}, has_serverSignature={has_server_sig}"
        ));

        if has_signed_payload && has_server_sig {
            let payload = data["signedPayload"].as_str().unwrap_or("");
            let server_sig = data["serverSignature"].as_str().unwrap_or("");
            self.diag("signedPayload: present");
            self.diag("serverSignature: present");

            if !verify_server_signature(payload, server_sig) {
                self.diag(
                    "RSA FAILED — signedPayload present but signature invalid. \
                     Server key mismatch or corrupted record."
                );
                return None;
            }
            self.diag("RSA PASSED — license record valid");
        } else {
            // No signedPayload/serverSignature — legacy HMAC-only record.
            // Grace period closed (S-2): all licenses must now carry RSA proof.
            self.diag(
                "load_verified_license: legacy HMAC-only record — \
                 RSA required, re-activate to continue.",
            );
            return None;
        }

        Some((value, signature))
    }

    /// Check a license that was already verified from the DB.
    pub(super) async fn check_stored_license(
        &self,
        db_pool: &DbPool,
        license_json: &str,
    ) -> LicenseCheckResult {
        let data: Value =
            serde_json::from_str(license_json).unwrap_or(serde_json::json!({}));

        let key = data["key"].as_str().unwrap_or("");
        let license_type_str = data["type"].as_str().unwrap_or("standard");
        let license_type = LicenseType::from_str_loose(license_type_str);
        let expires_at = data["expiresAt"].as_str();
        let grace_days = data["gracePeriodDays"]
            .as_i64()
            .unwrap_or(DEFAULT_GRACE_PERIOD_DAYS);
        let customer_name = data["customerName"].as_str().map(|s| s.to_string());

        // Security checks
        if is_clock_tampered(&self.app_data_dir) {
            tracing::warn!("Clock tampering detected — invalidating license");
            return LicenseCheckResult {
                status: LicenseStatus::Invalid,
                source: LicenseSource::Key,
                features: expired_features(),
                key: Some(mask_key(key)),
                license_type: Some(license_type_str.to_string()),
                customer_name,
                expires_at: expires_at.map(|s| s.to_string()),
                days_remaining: None,
                experiments_remaining: None,
                message: Some(
                    "Обнаружена манипуляция с системными часами. Подключитесь к интернету для повторной проверки."
                        .to_string(),
                ),
                show_warning: true,
            };
        }

        // Online validation — throttled to at most once per ONLINE_CHECK_INTERVAL_SECS.
        // `is_online_check_due` returns true on the first call this session so the
        // background task (spawned in lib.rs after setup) always gets a fresh result.
        let online_result = if !key.is_empty() && self.is_online_check_due().await {
            let result = validate_online(key, &self.app_data_dir).await;
            if result.server_reached {
                // Any server response (active, revoked, expired) resets the throttle
                // so that subsequent restarts within the hour skip the HTTP call.
                self.mark_online_check_done().await;
            }
            Some(result)
        } else {
            None
        };

        // Handle online result
        if let Some(ref online) = online_result {
            if online.server_reached {
                // Server was reached — its verdict is authoritative
                if let Some(ref status) = online.status {
                    match status.as_str() {
                        "revoked" => {
                            // Revoked — remove from DB and return revoked status
                            if let Ok(db_conn) = db_pool.get() {
                                if let Err(e) = delete_system_state(&db_conn, DB_KEY_LICENSE) {
                                    tracing::warn!("Failed to remove revoked license from DB: {}", e);
                                }
                            }
                            return LicenseCheckResult {
                                status: LicenseStatus::Revoked,
                                source: LicenseSource::Key,
                                features: expired_features(),
                                key: Some(mask_key(key)),
                                license_type: Some(license_type_str.to_string()),
                                customer_name,
                                expires_at: expires_at.map(|s| s.to_string()),
                                days_remaining: None,
                                experiments_remaining: None,
                                message: Some(
                                    "Лицензия была отозвана сервером".to_string(),
                                ),
                                show_warning: true,
                            };
                        }
                        "inactive" => {
                            if let Ok(db_conn) = db_pool.get() {
                                if let Err(e) = delete_system_state(&db_conn, DB_KEY_LICENSE) {
                                    tracing::warn!("Failed to remove deactivated license from DB: {}", e);
                                }
                            }
                            return LicenseCheckResult {
                                status: LicenseStatus::Invalid,
                                source: LicenseSource::Key,
                                features: expired_features(),
                                key: Some(mask_key(key)),
                                license_type: Some(license_type_str.to_string()),
                                customer_name,
                                expires_at: expires_at.map(|s| s.to_string()),
                                days_remaining: None,
                                experiments_remaining: None,
                                message: Some("Лицензия деактивирована".to_string()),
                                show_warning: true,
                            };
                        }
                        // Machine ID mismatch: the server has a v1 ID but we're
                        // now sending v2.  Try migration, then re-validate.
                        "wrong_machine" | "already_activated" => {
                            tracing::info!("Server reported machine ID mismatch — attempting migration");
                            if let Ok(true) = migrate_machine_online(key, &self.app_data_dir).await {
                                // Migration succeeded — re-validate to get the fresh status
                                let retry = validate_online(key, &self.app_data_dir).await;
                                if retry.success {
                                    let features = features_for_type(license_type);
                                    let days = retry.days_remaining.or_else(|| compute_days_remaining(expires_at));
                                    let warn = days.map_or(false, |d| d <= 30);
                                    delete_legacy_cache(&self.app_data_dir);
                                    return LicenseCheckResult {
                                        status: LicenseStatus::Active,
                                        source: LicenseSource::Key,
                                        features,
                                        key: Some(mask_key(key)),
                                        license_type: Some(license_type_str.to_string()),
                                        customer_name,
                                        expires_at: expires_at.map(|s| s.to_string()),
                                        days_remaining: days,
                                        experiments_remaining: None,
                                        message: Some("Лицензия перенесена на обновлённый идентификатор".to_string()),
                                        show_warning: warn,
                                    };
                                }
                            }
                            // Migration failed — keep local license and try again later (offline path)
                            tracing::warn!("Machine ID migration failed — falling through to offline path");
                        }
                        "expired" => {
                            // Check grace period
                            return self.build_expiry_result(
                                key,
                                license_type_str,
                                license_type,
                                customer_name,
                                expires_at,
                                grace_days,
                            );
                        }
                        "active" => {
                            // Server confirmed active — refresh the DB record with the new
                            // signedPayload so RSA verification passes on subsequent cold
                            // starts without contacting the server (offline-first, 7-day TTL).
                            self.diag(&format!(
                                "check_stored_license: server says ACTIVE. \
                                 signed_payload_present={}, server_sig_present={}",
                                online.signed_payload.is_some(),
                                online.server_signature.is_some()
                            ));
                            if let (Some(sp), Some(ss)) = (&online.signed_payload, &online.server_signature) {
                                self.diag(&format!("refreshing DB with signedPayload (len={})", sp.len()));
                                if let Ok(mut stored) = serde_json::from_str::<serde_json::Map<String, Value>>(license_json) {
                                    stored.insert("signedPayload".into(), Value::String(sp.clone()));
                                    stored.insert("serverSignature".into(), Value::String(ss.clone()));
                                    let updated_str = serde_json::to_string(&Value::Object(stored)).unwrap_or_default();
                                    if let Ok(db_conn) = db_pool.get() {
                                        match upsert_system_state(&db_conn, DB_KEY_LICENSE, &updated_str) {
                                            Ok(()) => self.diag("DB refresh OK — RSA will pass on next cold start"),
                                            Err(e) => self.diag(&format!("DB refresh FAILED: {}", e)),
                                        }
                                    }
                                }
                            } else {
                                self.diag("validate.php returned ACTIVE but no signedPayload — DB NOT refreshed! Check server PHP version.");
                            }

                            // Return active result
                            let features = features_for_type(license_type);
                            let days_remaining =
                                online.days_remaining.or_else(|| compute_days_remaining(expires_at));
                            let show_warning = days_remaining.map_or(false, |d| d <= 30);

                            return LicenseCheckResult {
                                status: LicenseStatus::Active,
                                source: LicenseSource::Key,
                                features,
                                key: Some(mask_key(key)),
                                license_type: Some(license_type_str.to_string()),
                                customer_name,
                                expires_at: expires_at.map(|s| s.to_string()),
                                days_remaining,
                                experiments_remaining: None,
                                message: None,
                                show_warning,
                            };
                        }
                        _ => {
                            // Unknown status — treat as expired
                            return self.build_expiry_result(
                                key,
                                license_type_str,
                                license_type,
                                customer_name,
                                expires_at,
                                grace_days,
                            );
                        }
                    }
                }
            } else if let Some(ref err_msg) = online.error {
                // Server not reached — log for diagnostics (covers network errors,
                // HTTP client build failures, etc.)
                tracing::warn!("Online validation skipped (server unreachable): {}", err_msg);
            }
        }

        // Offline path: use locally stored data
        if is_offline_overdue(&self.app_data_dir) {
            return LicenseCheckResult {
                status: LicenseStatus::Invalid,
                source: LicenseSource::Key,
                features: expired_features(),
                key: Some(mask_key(key)),
                license_type: Some(license_type_str.to_string()),
                customer_name,
                expires_at: expires_at.map(|s| s.to_string()),
                days_remaining: None,
                experiments_remaining: None,
                message: Some(
                    "Требуется подключение к интернету для проверки лицензии (оффлайн более 30 дней)"
                        .to_string(),
                ),
                show_warning: true,
            };
        }

        // Offline but within allowed window — check local expiry
        self.build_expiry_result(key, license_type_str, license_type, customer_name, expires_at, grace_days)
    }

    /// Build the result for a license based on local expiry data.
    /// `pub(super)` so that sibling impl blocks (operations.rs) can call it
    /// without duplicating the expiry logic.
    pub(super) fn build_expiry_result(
        &self,
        key: &str,
        license_type_str: &str,
        license_type: LicenseType,
        customer_name: Option<String>,
        expires_at: Option<&str>,
        grace_days: i64,
    ) -> LicenseCheckResult {
        let now = Utc::now();
        let features = features_for_type(license_type);

        let (status, days_remaining, show_warning, message) =
            if let Some(exp_str) = expires_at {
                match parse_expiry(exp_str) {
                    Some(expiry) => {
                        let days = (expiry.date_naive() - now.date_naive()).num_days();
                        if days >= 0 {
                            // Not yet expired
                            let warn = days <= 30;
                            let msg = if warn {
                                Some(format!("Лицензия истекает через {} дней", days))
                            } else {
                                None
                            };
                            (LicenseStatus::Active, Some(days), warn, msg)
                        } else {
                            // Past expiry — check grace period
                            let past_expiry = -days;
                            if past_expiry <= grace_days {
                                (
                                    LicenseStatus::Grace,
                                    Some(grace_days - past_expiry),
                                    true,
                                    Some(format!(
                                        "Лицензия истекла. Осталось {} дней льготного периода",
                                        grace_days - past_expiry
                                    )),
                                )
                            } else {
                                (
                                    LicenseStatus::Expired,
                                    Some(days),
                                    true,
                                    Some("Лицензия истекла".to_string()),
                                )
                            }
                        }
                    }
                    None => {
                        // Can't parse expiry — treat as active (will be caught on next online check)
                        (LicenseStatus::Active, None, false, None)
                    }
                }
            } else {
                // No expiry date — perpetual license
                (LicenseStatus::Active, None, false, None)
            };

        let final_features = if matches!(status, LicenseStatus::Expired) {
            expired_features()
        } else {
            features
        };

        LicenseCheckResult {
            status,
            source: LicenseSource::Key,
            features: final_features,
            key: Some(mask_key(key)),
            license_type: Some(license_type_str.to_string()),
            customer_name,
            expires_at: expires_at.map(|s| s.to_string()),
            days_remaining,
            experiments_remaining: None,
            message,
            show_warning,
        }
    }
}
