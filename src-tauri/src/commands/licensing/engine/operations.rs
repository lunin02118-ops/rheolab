use chrono::Utc;
use serde_json::Value;

use super::super::crypto::{
    delete_system_state, save_secure_last_check, upsert_system_state, verify_server_signature,
};
use super::super::demo::{check_demo, increment_demo_experiments};
use super::super::features::features_for_type;
use super::super::online::{
    activate_online, deactivate_online, find_by_machine_online, register_demo_online,
};
use super::super::types::{
    LicenseCheckResult, LicenseSource, LicenseStatus, LicenseType, DB_KEY_LICENSE,
    DB_KEY_WAS_LICENSED, DEFAULT_GRACE_PERIOD_DAYS,
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
    ///    fall through to demo mode.
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

                // 2b. No license anywhere → demo mode.
                // Register / sync with server to obtain (or restore) the authoritative
                // first_seen_at anchor. This prevents DB-wipe attacks where the user
                // deletes the local state to reset the 30-day clock.
                let server_anchor = register_demo_online(&self.app_data_dir).await;
                if let Some(ref anchor) = server_anchor {
                    tracing::debug!("Demo server anchor: first_seen_at={}", anchor);
                    // Persist the sync date so subsequent launches can skip HTTP
                    // for demo mode too (same offline-first logic as licensed checks).
                    let today = Utc::now().format("%Y-%m-%d").to_string();
                    if let Err(e) = save_secure_last_check(&self.app_data_dir, &today) {
                        tracing::warn!("Failed to save demo sync date: {}", e);
                    }
                }

                let conn = match db_pool.get() {
                    Ok(c) => c,
                    Err(e) => {
                        tracing::error!("LicenseEngine: DB pool error in demo check: {}", e);
                        let r = build_invalid("Ошибка базы данных");
                        self.set_cache(r.clone()).await;
                        return r;
                    }
                };
                check_demo(&conn, server_anchor.as_deref())
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
    /// UX note: after an OS reinstall the user briefly sees "Demo mode" on the
    /// startup splash until the background `check()` recovers the license
    /// (~1-2 s), at which point the frontend transitions to the licensed UI.
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
                let key = data["key"].as_str().unwrap_or("");
                let license_type_str = data["type"].as_str().unwrap_or("standard");
                let license_type = LicenseType::from_str_loose(license_type_str);
                let expires_at = data["expiresAt"].as_str();
                let grace_days = data["gracePeriodDays"]
                    .as_i64()
                    .unwrap_or(DEFAULT_GRACE_PERIOD_DAYS);
                let customer_name = data["customerName"].as_str().map(|s| s.to_string());
                self.build_expiry_result(
                    key,
                    license_type_str,
                    license_type,
                    customer_name,
                    expires_at,
                    grace_days,
                )
            }
            None => {
                // No verified license — tentatively enter demo mode.
                //
                // We intentionally DO NOT try machine-ID recovery here: this
                // function is on the splash-screen hot path and must stay
                // offline.  The background `check()` kicked off by `lib.rs`
                // right after `setup()` will run recovery (and promote us to
                // Active if a license is bound to this fingerprint on the
                // server).
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
            // DEMO path — NEVER offline-first.
            //
            // We intentionally ignore `is_online_check_due` here.  The
            // background `check()` that runs right after `setup()` must be
            // allowed to:
            //   (a) sync the demo counter / first_seen_at anchor with the
            //       server (prevents DB-wipe attacks);
            //   (b) try auto-recovery by machine fingerprint — this is the
            //       whole point of beta.28.  Writing a fresh
            //       `cache_time=Some(now)` here would trip `check()`'s
            //       `CHECK_CACHE_TTL_SECS` fast-path and make it return the
            //       cached Demo result without ever reaching recovery.
            //
            // So for demo we always set value-only (cache_time stays None),
            // which forces the background `check()` to do real work.
            self.diag(
                "check_local_startup: DEMO path — value-only cache, background check() will run recovery + demo sync"
            );
            self.set_cache_value_only(result.clone()).await;
        }
        result
    }

    // ── Register experiment (demo counter) ──────────────────────────────

    /// Increment the demo experiment counter and re-check.
    /// In demo mode, this decrements `experiments_remaining`.
    /// In licensed mode (no DemoState), this is a no-op re-check.
    pub async fn register_experiment(&self, db_pool: &DbPool) -> Result<LicenseCheckResult> {
        if let Some(cached) = self.cached().await {
            if cached.status == LicenseStatus::Demo {
                let conn = db_pool.get().map_err(AppError::Pool)?;
                if let Err(e) = increment_demo_experiments(&conn) {
                    tracing::warn!("Failed to increment demo counter: {}", e);
                }
            }
        }
        // Re-check to update cache with new experiment count
        Ok(self.check(db_pool).await)
    }

    // ── Activate ───────────────────────────────────────────────────────

    /// Activate a license key: call the server, store in DB, return result.
    pub async fn activate(&self, key: &str, db_pool: &DbPool) -> Result<LicenseCheckResult> {
        let data = activate_online(key, &self.app_data_dir).await?;

        if data["success"].as_bool() != Some(true) {
            return Err(data["error"]
                .as_str()
                .unwrap_or("Activation failed")
                .to_string()
                .into());
        }

        // Extract license info from server response
        let license = data
            .get("license")
            .cloned()
            .unwrap_or(serde_json::json!({}));
        let signature = data["signature"].as_str().unwrap_or("");

        // Store the canonical signed payload exactly as the server produced it.
        //
        // Since v0.1.524 the server includes a `signedPayload` field in the response
        // containing the verbatim `json_encode($licenseData, ...)` string that was
        // RSA-signed.  We store that directly so byte-for-byte RSA verification works
        // regardless of JSON key ordering or serialiser differences.
        //
        // Fallback for older server versions: re-serialise the `license` Value.
        // serde_json uses IndexMap (preserves key order) so in practice this matches
        // PHP's json_encode output for typical ASCII/Cyrillic data.
        let server_gave_payload = data["signedPayload"].is_string();
        let signed_payload = data["signedPayload"]
            .as_str()
            .map(|s| s.to_string())
            .unwrap_or_else(|| {
                self.diag("activate: server did NOT return signedPayload — using Rust JSON fallback (RSA will likely fail on next launch!)");
                serde_json::to_string(&license).unwrap_or_default()
            });
        if server_gave_payload {
            self.diag(&format!(
                "activate: server returned signedPayload (len={})",
                signed_payload.len()
            ));
        }

        // Build license record for DB storage
        let license_type_str = license["type"].as_str().unwrap_or("standard").to_string();
        let license_type = LicenseType::from_str_loose(&license_type_str);

        let db_record = serde_json::json!({
            "id": license["id"],
            "type": license_type_str,
            "customerName": license["customerName"].as_str().unwrap_or(""),
            "email": license["email"],
            "issuedAt": license["issuedAt"],
            "expiresAt": license["expiresAt"],
            "gracePeriodDays": license["gracePeriodDays"].as_i64().unwrap_or(DEFAULT_GRACE_PERIOD_DAYS),
            "machineId": license["machineId"],
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
        if let Some(ref key) = stored_key {
            // Best-effort server deactivation — don't fail if offline
            match deactivate_online(key, &self.app_data_dir).await {
                Ok(_) => tracing::info!("License deactivated on server"),
                Err(e) => tracing::warn!("Server deactivation failed (will retry): {}", e),
            }
        }

        // Scope 2: delete row + check demo — fresh connection, short hold.
        let result = {
            let conn = db_pool.get().map_err(AppError::Pool)?;
            delete_system_state(&conn, DB_KEY_LICENSE)?;
            // Re-check (will fall through to demo, no network needed after deactivation)
            check_demo(&conn, None)
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
    /// through to demo mode — the user is never worse off than before.
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

        let license_type_str = license["type"].as_str().unwrap_or("standard").to_string();
        let license_type = LicenseType::from_str_loose(&license_type_str);

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
