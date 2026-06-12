use chrono::Utc;
use serde_json::Value;

use super::super::crypto::{
    delete_system_state, save_secure_last_check, upsert_system_state, verify_server_signature,
};
use super::super::demo::check_demo;
use super::super::features::features_for_type;
use super::super::online::{activate_online, deactivate_online, find_by_machine_online};
use super::super::types::{
    LicenseCheckResult, LicenseSource, LicenseStatus, DB_KEY_LICENSE, DB_KEY_WAS_LICENSED,
    DEFAULT_GRACE_PERIOD_DAYS,
};
use super::offline::{
    supported_payload_license_type, trusted_license_payload, validate_supported_license_payload,
};
use super::{build_invalid, compute_days_remaining, mask_key, LicenseEngine, CHECK_CACHE_TTL_SECS};
use crate::db::DbPool;
use crate::error::{AppError, Result};

impl LicenseEngine {
    // ── Primary check ──────────────────────────────────────────────────

    /// Perform a full license check. This is the *only* method that determines status.
    ///
    /// Flow:
    /// 1. Try to load an HMAC-verified license from the DB.
    /// 2. If found, validate online (if due) — handle revoked, expired, clock tamper.
    /// 3. If no license in DB, try server-side **auto-recovery by machine fingerprint**
    ///    (`find_by_machine_online`).  When the user reinstalls the OS on the same
    ///    hardware the v2 fingerprint (`CPU ProcessorId | Motherboard UUID | BIOS serial`)
    ///    is unchanged, so the server can return the last active license bound to this
    ///    machine.  The returned `signedPayload` is RSA-verified against the pinned
    ///    public key before being persisted — an attacker who somehow learns a
    ///    fingerprint still cannot forge a valid response without the server's
    ///    private key.  Rate-limited on the server side (10 req / 10 min / IP).
    /// 4. If recovery returns nothing (or signature invalid, or network down),
    ///    fall through to the local 30-day demo/trial period.
    /// 5. Cache and return the result.
    pub async fn check(&self, db_pool: &DbPool) -> LicenseCheckResult {
        // Fast path: return the cached result if it's fresh enough.
        // This prevents the frontend's `licensing_check` call from repeating
        // the full I/O flow that `AppState::build()` already performed.
        {
            let cache_time_guard = self.cache_time.read().await;
            if let Some(t) = *cache_time_guard {
                if t.elapsed().as_secs() < CHECK_CACHE_TTL_SECS {
                    drop(cache_time_guard);
                    if let Some(cached) = self.cached().await {
                        return cached;
                    }
                }
            }
        }

        // Get DB connection, load license, then DROP conn before any .await.
        // rusqlite::Connection is !Send so it must not be held across .await points.
        let license_opt = {
            let conn = match db_pool.get() {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!("LicenseEngine: DB pool error: {}", e);
                    let r = build_invalid("Ошибка базы данных");
                    self.set_cache(r.clone()).await;
                    return r;
                }
            };
            self.load_verified_license(&conn)
        }; // conn dropped here — before any .await

        let result = match license_opt {
            Some((license_json, _signature)) => {
                // conn is not in scope — no !Send types held across await
                self.check_stored_license(db_pool, &license_json).await
            }
            None => {
                // 2a. No license in DB — try auto-recovery by machine fingerprint.
                //     This covers the post-OS-reinstall scenario: hardware is the
                //     same, so the server can return the last license it saw
                //     bound to this fingerprint.  RSA-verified before trust.
                if let Some(recovered) = self.try_recover_by_machine_id(db_pool).await {
                    self.diag("check: auto-recovery by machine-ID succeeded");
                    self.set_cache(recovered.clone()).await;
                    return recovered;
                }

                // 2b. No license anywhere → local demo/trial mode.
                //
                // The server-side demo-registration endpoint was removed in
                // alpha.9, so this hotfix restores the desktop-local 30-day
                // trial instead of blocking a fresh installation outright.
                let conn = match db_pool.get() {
                    Ok(c) => c,
                    Err(e) => {
                        tracing::error!("LicenseEngine: DB pool error in demo check: {}", e);
                        let r = build_invalid("Ошибка базы данных");
                        self.set_cache(r.clone()).await;
                        return r;
                    }
                };
                check_demo(&conn, None)
            }
        };

        self.set_cache(result.clone()).await;
        result
    }

    // ── Startup-local check ────────────────────────────────────────────

    /// Perform a **local-only** license check for use during application startup.
    ///
    /// Identical fast-path to [`check`] but intentionally avoids **all** HTTP:
    /// - No online validation (`validate_online`)
    /// - No machine-ID recovery (`find_by_machine_online`)
    ///
    /// This is the check that blocks the Tauri `setup()` closure.  Because it
    /// never touches the network the window opens in ~50 ms instead of ~4 s.
    /// A full `check()` (with HTTP) is launched in a background task by `lib.rs`
    /// immediately after setup; it performs both online validation AND the
    /// auto-recovery-by-machine-ID flow, then updates the cache and emits
    /// `license_status_updated` to the frontend.
    ///
    /// UX note: after an OS reinstall the user briefly sees demo mode until
    /// the background `check()` recovers the license (~1-2 s), at which point
    /// the frontend transitions to the licensed UI.
    pub async fn check_local_startup(&self, db_pool: &DbPool) -> LicenseCheckResult {
        // Note: no TTL fast-path here — this method always reads from DB so that
        // the background check() call (which DOES respect TTL) will see cache_time=None
        // and perform the full online validation (when due).

        let license_opt = {
            let conn = match db_pool.get() {
                Ok(c) => c,
                Err(e) => {
                    tracing::error!("LicenseEngine startup check: DB pool error: {}", e);
                    let r = build_invalid("Ошибка базы данных");
                    self.set_cache_value_only(r.clone()).await;
                    return r;
                }
            };
            self.load_verified_license(&conn)
        }; // conn dropped here — no !Send across .await

        let has_license = license_opt.is_some();
        self.diag(&format!("check_local_startup: has_license={has_license}"));

        let result = match license_opt {
            Some((license_json, _)) => {
                // Local path: parse stored data and check expiry — no HTTP.
                let data: Value =
                    serde_json::from_str(&license_json).unwrap_or(serde_json::json!({}));
                let trusted = trusted_license_payload(&data);
                let key = data["key"].as_str().unwrap_or("");
                let license_type_str = trusted["type"]
                    .as_str()
                    .or_else(|| data["type"].as_str())
                    .unwrap_or("");
                match supported_payload_license_type(&trusted) {
                    None => build_invalid(
                        "Тип лицензии не поддерживается. Активируйте trial или corporate лицензию.",
                    ),
                    Some(license_type) => {
                        if let Err(e) =
                            validate_supported_license_payload(&self.app_data_dir, &trusted)
                        {
                            LicenseCheckResult {
                                status: LicenseStatus::Invalid,
                                source: LicenseSource::Key,
                                features: super::super::features::expired_features(),
                                key: Some(mask_key(key)),
                                license_type: Some(license_type_str.to_string()),
                                customer_name: trusted["customerName"]
                                    .as_str()
                                    .or_else(|| data["customerName"].as_str())
                                    .map(|s| s.to_string()),
                                expires_at: trusted["expiresAt"]
                                    .as_str()
                                    .or_else(|| data["expiresAt"].as_str())
                                    .map(|s| s.to_string()),
                                days_remaining: None,
                                experiments_remaining: None,
                                message: Some(e.to_string()),
                                show_warning: true,
                            }
                        } else {
                            let expires_at = trusted["expiresAt"]
                                .as_str()
                                .or_else(|| data["expiresAt"].as_str());
                            let grace_days = data["gracePeriodDays"]
                                .as_i64()
                                .unwrap_or(DEFAULT_GRACE_PERIOD_DAYS);
                            let customer_name = trusted["customerName"]
                                .as_str()
                                .or_else(|| data["customerName"].as_str())
                                .map(|s| s.to_string());
                            self.build_expiry_result(
                                key,
                                license_type_str,
                                license_type,
                                customer_name,
                                expires_at,
                                grace_days,
                            )
                        }
                    }
                }
            }
            None => {
                // No verified license — start local demo mode immediately.
                //
                // We intentionally DO NOT try machine-ID recovery here: this
                // function is on the splash-screen hot path and must stay
                // offline. The background `check()` kicked off by `lib.rs`
                // right after `setup()` will run recovery and promote us to
                // Active if a license is bound to this fingerprint on the server.
                let conn = match db_pool.get() {
                    Ok(c) => c,
                    Err(e) => {
                        tracing::error!(
                            "LicenseEngine startup check: DB pool error in demo check: {}",
                            e
                        );
                        let r = build_invalid("Ошибка базы данных");
                        self.set_cache_value_only(r.clone()).await;
                        return r;
                    }
                };
                check_demo(&conn, None)
            }
        };

        if has_license {
            // Keep the splash-screen path strictly local and DB-bound.
            //
            // `is_online_check_due()` eventually reads secure storage, and that
            // derivation currently depends on the machine fingerprint.  On Windows
            // the first fingerprint read can cost several seconds because it fans
            // out into WMI/PowerShell collectors.  Doing that work here regresses
            // the whole application startup for already-licensed users.
            //
            // Instead we always cache the local result as value-only and let the
            // background `check()` compute due-ness, offline-overdue, clock-tamper,
            // and optional HTTP validation after the first paint.
            self.diag(
                "check_local_startup: KEY path — value-only cache, background check() will decide due-ness/offline path"
            );
            self.set_cache_value_only(result.clone()).await;
        } else {
            // Demo path — value-only cache so the background `check()` can
            // still attempt machine-ID recovery before the demo state becomes
            // the final state.
            self.diag(
                "check_local_startup: DEMO path — value-only cache, background check() will run recovery"
            );
            self.set_cache_value_only(result.clone()).await;
        }
        result
    }

    // ── Register experiment ────────────────────────────────────────────

    /// Re-check after a saved experiment. The save path updates the demo
    /// counter inside its DB transaction before calling this refresh hook.
    pub async fn register_experiment(&self, db_pool: &DbPool) -> Result<LicenseCheckResult> {
        Ok(self.check(db_pool).await)
    }

    // ── Activate ───────────────────────────────────────────────────────

    /// Activate a license key: call the server, **verify the RSA signature**,
    /// store in DB, return result.
    ///
    /// **Audit-v2 LIC-003 — hard RSA gate:**
    ///
    /// Before this fix, `activate()` accepted any server response with
    /// `success: true`, extracted the licence fields from the *unsigned*
    /// top-level `data["license"]` JSON, and wrote them straight to the
    /// local DB.  An adversary who could redirect or MITM
    /// `LICENSE_SERVER_URL` (rogue DNS, hostile proxy, compromised
    /// network) would inject any feature set they liked — including
    /// `developer` / `superuser` tier flags — and the freshly cached
    /// state would grant write/export permissions for the rest of the
    /// process before the next boot's load-time RSA gate caught it.
    ///
    /// New contract: activation **demands** a non-empty `signedPayload`
    /// and `signature`, RSA-verifies them against the pinned public key
    /// **before** any DB write, and uses the *parsed signed payload* as
    /// the sole source of truth for licence fields (the unsigned
    /// top-level `license` field is ignored entirely).  This matches the
    /// recovery path's existing contract — there is no longer an
    /// activation route that is laxer than recovery.
    pub async fn activate(&self, key: &str, db_pool: &DbPool) -> Result<LicenseCheckResult> {
        let data = activate_online(key, &self.app_data_dir).await?;

        // ── Audit-v2 LIC-003 hard RSA gate (MUST run before any DB write) ──
        let (signed_payload, signature, license) = match validate_activation_response(&data) {
            Ok(v) => v,
            Err(e) => {
                self.diag(&format!("activate: rejected — {e}"));
                return Err(e);
            }
        };
        self.diag(&format!(
            "activate: RSA verified, signedPayload len={}",
            signed_payload.len()
        ));

        // Build license record for DB storage from the SIGNED payload only.
        // The unsigned `data["license"]` top-level field is intentionally
        // ignored — only fields covered by the RSA signature can be
        // trusted, otherwise a MITM could substitute the unsigned half.
        let license_type = validate_supported_license_payload(&self.app_data_dir, &license)?;
        let license_type_str = license["type"].as_str().unwrap_or("").to_string();

        let db_record = serde_json::json!({
            "id": license["id"],
            "type": license_type_str,
            "customerName": license["customerName"].as_str().unwrap_or(""),
            "email": license["email"],
            "issuedAt": license["issuedAt"],
            "expiresAt": license["expiresAt"],
            "gracePeriodDays": license["gracePeriodDays"].as_i64().unwrap_or(DEFAULT_GRACE_PERIOD_DAYS),
            "machineId": license["machineId"],
            "hardwareBound": license["hardwareBound"],
            "permanent": license["permanent"],
            "seats": license["seats"],
            "features": license["features"],
            "key": key,
            "serverSignature": signature,
            "signedPayload": signed_payload,
            "activatedAt": Utc::now().to_rfc3339(),
        });

        // Store in protected DB
        let conn = db_pool.get().map_err(AppError::Pool)?;
        let value_str = serde_json::to_string(&db_record)?;
        upsert_system_state(&conn, DB_KEY_LICENSE, &value_str)?;

        // Mark as ever-licensed
        let was_licensed = serde_json::json!({
            "wasLicensed": true,
            "date": Utc::now().to_rfc3339(),
        });
        let was_str = serde_json::to_string(&was_licensed)?;
        if let Err(e) = upsert_system_state(&conn, DB_KEY_WAS_LICENSED, &was_str) {
            tracing::warn!("Failed to persist was-licensed flag: {}", e);
        }

        // Save check date
        let today = Utc::now().format("%Y-%m-%d").to_string();
        if let Err(e) = save_secure_last_check(&self.app_data_dir, &today) {
            self.diag(&format!("activate: FAILED to save last-check date: {}", e));
        } else {
            self.diag(&format!("activate: saved last-check date = {today}"));
        }

        // Build and cache result
        let features = features_for_type(license_type);
        let expires_at = license["expiresAt"].as_str().map(|s| s.to_string());
        let days_remaining = compute_days_remaining(expires_at.as_deref());

        let result = LicenseCheckResult {
            status: LicenseStatus::Active,
            source: LicenseSource::Key,
            features,
            key: Some(mask_key(key)),
            license_type: Some(license_type_str),
            customer_name: license["customerName"].as_str().map(|s| s.to_string()),
            expires_at,
            days_remaining,
            experiments_remaining: None,
            message: Some("Лицензия активирована".to_string()),
            show_warning: false,
        };

        self.set_cache(result.clone()).await;
        Ok(result)
    }

    // ── Deactivate ─────────────────────────────────────────────────────

    /// Deactivate the current license: unbind from server, remove from DB.
    ///
    /// **Pool discipline**: a SQLite connection is acquired in three short
    /// scopes (read key → delete row → re-check demo) and is **never held
    /// across the network `.await`** to `deactivate_online`.  This avoids
    /// occupying one of the 8 pool slots for the duration of the HTTP
    /// timeout (up to ~30 s) while other IPC commands compete for a slot.
    ///
    /// **Online-only contract (audit-preflight OPS-001)**: server-side
    /// unbind is **mandatory** when a license key is locally stored. If
    /// the server is unreachable the deactivation is refused and local
    /// state is preserved.  Previously the function logged "will retry"
    /// on network failure but cleared the local row anyway, leaving the
    /// server bound to a machine that no longer thinks it owns the
    /// license — the user could not then re-activate on a different
    /// machine because the server still reported the binding as live.
    pub async fn deactivate(&self, db_pool: &DbPool) -> Result<LicenseCheckResult> {
        // Scope 1: read the stored key (sync, sub-millisecond), then drop conn.
        let stored_key: Option<String> = {
            let conn = db_pool.get().map_err(AppError::Pool)?;
            self.load_verified_license(&conn).and_then(|(value, _sig)| {
                let data: Value = serde_json::from_str(&value).unwrap_or(serde_json::json!({}));
                data["key"].as_str().map(|s| s.to_string())
            })
        };

        // Network round-trip — no DB connection held.
        // Server unbind is REQUIRED before we touch local state.  See the
        // function-level OPS-001 note for rationale.
        if let Some(ref key) = stored_key {
            if let Err(e) = deactivate_online(key, &self.app_data_dir).await {
                tracing::warn!("Server deactivation refused (offline?): {}", e);
                return Err(AppError::License(
                    "Не удалось отвязать лицензию от сервера. Деактивация \
                     требует подключения к интернету: иначе машина останется \
                     привязана на сервере и активация на другом устройстве \
                     будет отклонена. Подключитесь к сети и повторите."
                        .to_string(),
                ));
            }
            tracing::info!("License deactivated on server");
        }

        // Scope 2: delete row — fresh connection, short hold.
        // Reached only after the server confirmed (or there was nothing to unbind).
        let result = {
            let conn = db_pool.get().map_err(AppError::Pool)?;
            delete_system_state(&conn, DB_KEY_LICENSE)?;
            build_invalid("Лицензия не активирована")
        };

        self.set_cache(result.clone()).await;
        Ok(result)
    }

    // ── Auto-recovery by machine fingerprint ───────────────────────────

    /// Attempt to restore a license for the current machine by asking the
    /// server for anything bound to our hardware fingerprint.  Called from
    /// [`check`] when no local license exists (typical after an OS reinstall).
    ///
    /// Returns `Some(result)` only when:
    /// 1. The server returned an active license for this fingerprint.
    /// 2. The `signedPayload` verified against our pinned RSA public key.
    /// 3. The DB record was successfully persisted.
    ///
    /// In all other cases (network error, server miss, forged signature,
    /// DB write failure) this returns `None` so the caller cleanly falls
    /// through to local demo mode — the user is never worse off than before.
    async fn try_recover_by_machine_id(&self, db_pool: &DbPool) -> Option<LicenseCheckResult> {
        let data = match find_by_machine_online(&self.app_data_dir).await {
            Ok(Some(d)) => d,
            Ok(None) => {
                self.diag("recovery: no license bound to this machine on server");
                return None;
            }
            Err(e) => {
                self.diag(&format!("recovery: server call failed: {e}"));
                return None;
            }
        };

        // The server MUST return signedPayload + signature together.  Without
        // both we cannot verify, so treat this as a recovery miss.
        let Some(signed_payload) = data["signedPayload"].as_str() else {
            self.diag("recovery: server response missing signedPayload — refusing to trust");
            return None;
        };
        let Some(signature) = data["signature"].as_str() else {
            self.diag("recovery: server response missing signature — refusing to trust");
            return None;
        };

        // RSA verify against the pinned public key embedded at compile time.
        // An attacker who learns a fingerprint cannot forge a valid response
        // without the server's private key, so this gate is what makes the
        // whole flow safe.
        if !verify_server_signature(signed_payload, signature) {
            self.diag("recovery: RSA signature verification FAILED — rejecting payload");
            return None;
        }

        // Payload trusted from here on.  Parse it once to build the DB record.
        let license: Value = match serde_json::from_str::<Value>(signed_payload) {
            Ok(v) => v,
            Err(e) => {
                self.diag(&format!("recovery: signedPayload is not valid JSON: {e}"));
                return None;
            }
        };

        let license_type = match validate_supported_license_payload(&self.app_data_dir, &license) {
            Ok(license_type) => license_type,
            Err(e) => {
                self.diag(&format!("recovery: rejected signed payload — {e}"));
                return None;
            }
        };
        let license_type_str = license["type"].as_str().unwrap_or("").to_string();

        // Key must come from the RSA-signed payload — never from any raw
        // top-level `data["key"]` field, which is unsigned and could be
        // substituted by a MITM.  Fall back to `data["key"]` only if the
        // signed payload omits it (legacy server builds predating
        // signedPayload.key).
        let key_from_server = license["key"]
            .as_str()
            .or_else(|| data["key"].as_str())
            .unwrap_or("")
            .to_string();
        if key_from_server.is_empty() {
            self.diag(
                "recovery: neither signedPayload.key nor top-level data.key present — cannot build DB record"
            );
            return None;
        }

        // Build DB record with the SAME shape as `activate()` so subsequent
        // validate/deactivate/check calls treat it identically to a manually
        // activated license.
        let db_record = serde_json::json!({
            "id": license["id"],
            "type": license_type_str,
            "customerName": license["customerName"].as_str().unwrap_or(""),
            "email": license["email"],
            "issuedAt": license["issuedAt"],
            "expiresAt": license["expiresAt"],
            "gracePeriodDays": license["gracePeriodDays"].as_i64().unwrap_or(DEFAULT_GRACE_PERIOD_DAYS),
            "machineId": license["machineId"],
            "hardwareBound": license["hardwareBound"],
            "permanent": license["permanent"],
            "seats": license["seats"],
            "features": license["features"],
            "key": key_from_server.clone(),
            "serverSignature": signature,
            "signedPayload": signed_payload,
            "activatedAt": Utc::now().to_rfc3339(),
            "recoveredBy": "machine_id",
        });

        let conn = match db_pool.get() {
            Ok(c) => c,
            Err(e) => {
                self.diag(&format!("recovery: DB pool error: {e}"));
                return None;
            }
        };
        let value_str = match serde_json::to_string(&db_record) {
            Ok(s) => s,
            Err(e) => {
                self.diag(&format!("recovery: failed to serialise DB record: {e}"));
                return None;
            }
        };
        if let Err(e) = upsert_system_state(&conn, DB_KEY_LICENSE, &value_str) {
            self.diag(&format!("recovery: upsert_system_state failed: {e}"));
            return None;
        }

        // Mark as ever-licensed (best-effort; doesn't block recovery on failure)
        let was_licensed = serde_json::json!({
            "wasLicensed": true,
            "date": Utc::now().to_rfc3339(),
            "via": "machine_id_recovery",
        });
        if let Ok(was_str) = serde_json::to_string(&was_licensed) {
            if let Err(e) = upsert_system_state(&conn, DB_KEY_WAS_LICENSED, &was_str) {
                tracing::warn!("recovery: failed to persist was-licensed flag: {}", e);
            }
        }

        let today = Utc::now().format("%Y-%m-%d").to_string();
        if let Err(e) = save_secure_last_check(&self.app_data_dir, &today) {
            tracing::warn!("recovery: failed to save last-check date: {}", e);
        }

        // Build LicenseCheckResult identical to what activate() produces —
        // the frontend sees a seamless "активна" state.
        let features = features_for_type(license_type);
        let expires_at = license["expiresAt"].as_str().map(|s| s.to_string());
        let days_remaining = compute_days_remaining(expires_at.as_deref());

        Some(LicenseCheckResult {
            status: LicenseStatus::Active,
            source: LicenseSource::Key,
            features,
            key: Some(mask_key(&key_from_server)),
            license_type: Some(license_type_str),
            customer_name: license["customerName"].as_str().map(|s| s.to_string()),
            expires_at,
            days_remaining,
            experiments_remaining: None,
            message: Some(
                "Лицензия восстановлена автоматически по идентификатору железа".to_string(),
            ),
            show_warning: false,
        })
    }
}

// ── Audit-v2 LIC-003: pure validator for activation responses ──────────────

/// Gates the JSON returned by `activate_online`.
///
/// Returns `Ok((signed_payload, signature, license_value))` when **all**
/// of the following hold:
///   1. `data["success"] == true`,
///   2. `data["signedPayload"]` is a non-empty string,
///   3. `data["signature"]` is a non-empty string,
///   4. `verify_server_signature(signed_payload, signature)` returns true
///      against the pinned public key,
///   5. `signed_payload` parses as valid JSON.
///
/// On any failure returns a typed `AppError::License(...)` describing
/// the rejection.  Extracted as a free function so the LIC-003 contract
/// can be unit-tested without standing up a mock HTTP server (see
/// `validate_activation_response_*` regression tests in this module).
///
/// The returned `license_value` is the **parsed signed payload**, not
/// `data["license"]`.  This is intentional: only fields covered by the
/// RSA signature are trustworthy, so the DB record must be built from
/// `license_value` alone.
fn validate_activation_response(data: &Value) -> Result<(String, String, Value)> {
    if data["success"].as_bool() != Some(true) {
        return Err(data["error"]
            .as_str()
            .unwrap_or("Activation failed")
            .to_string()
            .into());
    }

    let signed_payload = data["signedPayload"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::License(
                "Сервер не вернул подписанный payload — активация отклонена (LIC-003)".into(),
            )
        })?;

    let signature = data["signature"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::License("Сервер не вернул подпись — активация отклонена (LIC-003)".into())
        })?;

    if !verify_server_signature(signed_payload, signature) {
        return Err(AppError::License(
            "Подпись сервера некорректна — активация отклонена (LIC-003)".into(),
        ));
    }

    let license: Value = serde_json::from_str(signed_payload)
        .map_err(|_| AppError::License("Сервер вернул неразбираемый payload (LIC-003)".into()))?;

    Ok((signed_payload.to_string(), signature.to_string(), license))
}

#[cfg(test)]
mod activate_tests {
    //! Audit-v2 LIC-003 regression guards for `validate_activation_response`.
    //!
    //! These exercise the pure validator without going through the HTTP
    //! layer, so we can assert the contract on synthetic responses that a
    //! real server (or a malicious MITM) might produce.

    use super::*;
    use serde_json::json;

    /// Helper: sign with the dev private key (counterpart of the dev public
    /// key embedded into release/debug binaries via `RSA_PUBLIC_KEY_DER`).
    fn sign_with_dev_private_key(data: &[u8]) -> String {
        use base64::Engine;
        use rsa::pkcs1v15::SigningKey;
        use rsa::pkcs8::DecodePrivateKey;
        use rsa::signature::{SignatureEncoding, Signer};
        use sha2::Sha256;

        let private_der = include_bytes!("../../../../keys/dev_private.der");
        let private_key = rsa::RsaPrivateKey::from_pkcs8_der(private_der)
            .expect("dev private key should be valid");
        let signing_key = SigningKey::<Sha256>::new(private_key);
        let signature = signing_key.sign(data);
        base64::engine::general_purpose::STANDARD.encode(&*signature.to_bytes())
    }

    /// Happy path: server returns `success:true` + valid `signedPayload` +
    /// matching `signature` → validator returns the parsed payload as the
    /// licence Value.
    #[test]
    fn validate_activation_response_accepts_correctly_signed_payload() {
        let payload =
            r#"{"id":42,"type":"standard","customerName":"Acme","expiresAt":"2099-12-31"}"#;
        let signature = sign_with_dev_private_key(payload.as_bytes());
        let data = json!({
            "success": true,
            "signedPayload": payload,
            "signature": signature,
            // unsigned `license` field intentionally NOT present — validator
            // must work without it.
        });

        let (sp, sig, lic) =
            validate_activation_response(&data).expect("must accept valid payload");
        assert_eq!(sp, payload);
        assert!(!sig.is_empty());
        assert_eq!(lic["id"], 42);
        assert_eq!(lic["type"], "standard");
        assert_eq!(lic["customerName"], "Acme");
    }

    /// `success: false` short-circuits with the server's error message.
    #[test]
    fn validate_activation_response_rejects_success_false() {
        let data = json!({
            "success": false,
            "error": "key_already_used",
        });
        let err = validate_activation_response(&data).unwrap_err().to_string();
        assert!(
            err.contains("key_already_used"),
            "must surface server error message; got: {err}"
        );
    }

    /// **The headline LIC-003 regression**: server response with `success:true`
    /// but no `signedPayload` MUST be refused.  Pre-fix this fell back to a
    /// Rust-side serialisation of `data["license"]` and the unsigned fields
    /// were trusted; post-fix it is a hard error before any DB write.
    #[test]
    fn validate_activation_response_rejects_missing_signed_payload() {
        let data = json!({
            "success": true,
            "license": {"id": 1, "type": "developer"}, // unsigned junk
            "signature": "AAAA",
        });
        let err = validate_activation_response(&data).unwrap_err().to_string();
        assert!(
            err.contains("signedPayload") || err.contains("LIC-003"),
            "must explicitly reject missing signedPayload; got: {err}"
        );
    }

    /// Empty `signedPayload` string is also a refusal — the field must be
    /// non-empty content the server actually signed.
    #[test]
    fn validate_activation_response_rejects_empty_signed_payload() {
        let data = json!({
            "success": true,
            "signedPayload": "",
            "signature": "AAAA",
        });
        let err = validate_activation_response(&data).unwrap_err().to_string();
        assert!(
            err.contains("signedPayload") || err.contains("LIC-003"),
            "empty signedPayload must be refused; got: {err}"
        );
    }

    /// Missing `signature` field → refuse.
    #[test]
    fn validate_activation_response_rejects_missing_signature() {
        let payload = r#"{"id":1,"type":"standard"}"#;
        let data = json!({
            "success": true,
            "signedPayload": payload,
            // no signature
        });
        let err = validate_activation_response(&data).unwrap_err().to_string();
        assert!(
            err.contains("подпись") || err.contains("signature") || err.contains("LIC-003"),
            "must reject missing signature; got: {err}"
        );
    }

    /// Forged signature (signed against different bytes) → refuse.
    /// This is the actual MITM scenario the audit identified: an attacker
    /// who intercepts the activation HTTP response and substitutes the
    /// payload with their preferred features cannot also forge a valid
    /// RSA signature without the server's private key.
    #[test]
    fn validate_activation_response_rejects_forged_signature() {
        let real_payload = r#"{"id":1,"type":"standard"}"#;
        let attacker_payload = r#"{"id":1,"type":"developer","features":{"export_pdf":true}}"#;
        // Attacker keeps the legitimate signature but swaps the payload.
        let real_sig = sign_with_dev_private_key(real_payload.as_bytes());
        let data = json!({
            "success": true,
            "signedPayload": attacker_payload,
            "signature": real_sig,
        });
        let err = validate_activation_response(&data).unwrap_err().to_string();
        assert!(
            err.contains("Подпись") || err.contains("signature") || err.contains("LIC-003"),
            "MITM substitution must fail RSA verify; got: {err}"
        );
    }

    /// Garbage Base64 signature → refuse without panic.
    #[test]
    fn validate_activation_response_rejects_garbage_signature() {
        let payload = r#"{"id":1,"type":"standard"}"#;
        let data = json!({
            "success": true,
            "signedPayload": payload,
            "signature": "this-is-not-valid-base64!!!",
        });
        let err = validate_activation_response(&data).unwrap_err().to_string();
        assert!(
            err.contains("Подпись") || err.contains("signature") || err.contains("LIC-003"),
            "garbage signature must Err, never panic; got: {err}"
        );
    }

    /// `signedPayload` is RSA-valid but not parseable JSON → refuse.
    /// Catches the case where a legitimate server has a serialiser bug or
    /// an attacker chose a non-JSON "payload" they could sign.
    #[test]
    fn validate_activation_response_rejects_non_json_payload() {
        let payload = "definitely-not-json";
        let signature = sign_with_dev_private_key(payload.as_bytes());
        let data = json!({
            "success": true,
            "signedPayload": payload,
            "signature": signature,
        });
        let err = validate_activation_response(&data).unwrap_err().to_string();
        assert!(
            err.contains("payload") || err.contains("LIC-003"),
            "non-JSON payload must be refused; got: {err}"
        );
    }

    /// Headline anti-MITM proof: validator returns the **signed** payload's
    /// fields, not whatever an attacker put in the unsigned top-level
    /// `data["license"]`.  Even if we leave a forged `license` field next
    /// to a legitimate signed payload, the returned `license_value`
    /// reflects only the signed half.
    #[test]
    fn validate_activation_response_uses_signed_payload_not_unsigned_license() {
        let signed = r#"{"id":1,"type":"standard","features":{"export_pdf":false}}"#;
        let signature = sign_with_dev_private_key(signed.as_bytes());
        let data = json!({
            "success": true,
            "signedPayload": signed,
            "signature": signature,
            // attacker-injected unsigned half
            "license": {"id": 1, "type": "developer", "features": {"export_pdf": true}},
        });
        let (_, _, lic) = validate_activation_response(&data).expect("signed payload accepted");
        assert_eq!(
            lic["type"], "standard",
            "must use SIGNED type, not unsigned `license.type`"
        );
        assert_eq!(
            lic["features"]["export_pdf"], false,
            "must use SIGNED features, not unsigned `license.features`"
        );
    }
}
