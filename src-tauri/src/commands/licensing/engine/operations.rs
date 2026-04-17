use chrono::Utc;
use serde_json::Value;

use super::super::crypto::{delete_system_state, save_secure_last_check, upsert_system_state};
use super::super::demo::{check_demo, increment_demo_experiments};
use super::super::features::features_for_type;
use super::super::online::{activate_online, deactivate_online, register_demo_online};
use super::super::types::{
    LicenseCheckResult, LicenseSource, LicenseStatus, LicenseType,
    DB_KEY_LICENSE, DB_KEY_WAS_LICENSED, DEFAULT_GRACE_PERIOD_DAYS,
};
use super::{build_invalid, compute_days_remaining, mask_key, CHECK_CACHE_TTL_SECS, LicenseEngine};
use crate::db::DbPool;
use crate::error::{AppError, Result};

impl LicenseEngine {
    // ── Primary check ──────────────────────────────────────────────────

    /// Perform a full license check. This is the *only* method that determines status.
    ///
    /// Flow:
    /// 1. Try to load an HMAC-verified license from the DB.
    /// 2. If found, validate online (if due) — handle revoked, expired, clock tamper.
    /// 3. If no license in DB, fall through to demo mode.
    ///    Automatic discovery by machine ID was removed because machine IDs
    ///    are not secret and cannot safely authorize key recovery.
    /// 4. If no license found anywhere, fall through to demo mode.
    /// 6. Cache and return the result.
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
                // 2. No license in DB → demo mode.
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
    /// Identical fast-path to [`check`] but intentionally avoids:
    /// - HTTP validation (`validate_online`)
    /// - Any server-side key recovery (machine-ID recovery is disabled)
    ///
    /// This is the check that blocks the Tauri `setup()` closure.  Because it
    /// never touches the network the window opens in ~50 ms instead of ~4 s.
    /// A full `check()` (with HTTP) is launched in a background task by `lib.rs`
    /// immediately after setup and will update the cache + emit
    /// `license_status_updated` to the frontend once it completes.
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
                // No verified license — enter demo mode. Restoring a license now
                // requires explicit activation with the original key.
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

        // Offline-first caching: if a recent online check exists on disk (within
        // ONLINE_CHECK_INTERVAL_DAYS), cache with a full timestamp so the background
        // check() call sees a fresh TTL and skips the HTTP round-trip entirely.
        // The user sees the correct license status instantly on launch without
        // waiting for a network response.
        //
        // If no recent disk check exists (first launch, or overdue period), cache
        // value-only so the background check() still validates online.
        //
        // For the demo path (no license) we always leave cache_time=None so the
        // background task can sync the demo counter + anchor date with the server.
        if has_license {
            let check_due = self.is_online_check_due().await;
            self.diag(&format!("check_local_startup: is_online_check_due={check_due}"));
            if !check_due {
                // Recent disk check — skip background HTTP, start instantly
                self.diag("check_local_startup: offline-first → no background HTTP this session");
                self.set_cache(result.clone()).await;
            } else {
                // Online check overdue — background task will validate
                self.diag("check_local_startup: online check DUE → background HTTP will run");
                self.set_cache_value_only(result.clone()).await;
            }
        } else {
            let check_due = self.is_online_check_due().await;
            self.diag(&format!(
                "check_local_startup: DEMO path — is_online_check_due={check_due}"
            ));
            if !check_due {
                self.diag("check_local_startup: demo offline-first → no background HTTP");
                self.set_cache(result.clone()).await;
            } else {
                self.diag("check_local_startup: demo sync overdue — background HTTP will run");
                self.set_cache_value_only(result.clone()).await;
            }
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
    pub async fn activate(
        &self,
        key: &str,
        db_pool: &DbPool,
    ) -> Result<LicenseCheckResult> {
        let data = activate_online(key, &self.app_data_dir).await?;

        if data["success"].as_bool() != Some(true) {
            return Err(
                data["error"]
                    .as_str()
                    .unwrap_or("Activation failed")
                    .to_string()
                    .into(),
            );
        }

        // Extract license info from server response
        let license = data.get("license").cloned().unwrap_or(serde_json::json!({}));
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
            self.diag(&format!("activate: server returned signedPayload (len={})", signed_payload.len()));
        }

        // Build license record for DB storage
        let license_type_str = license["type"]
            .as_str()
            .unwrap_or("standard")
            .to_string();
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
    pub async fn deactivate(&self, db_pool: &DbPool) -> Result<LicenseCheckResult> {
        let conn = db_pool.get().map_err(AppError::Pool)?;

        // Try to get the stored key for server deactivation
        if let Some((value, _sig)) = self.load_verified_license(&conn) {
            let data: Value = serde_json::from_str(&value).unwrap_or(serde_json::json!({}));
            if let Some(key) = data["key"].as_str() {
                // Best-effort server deactivation — don't fail if offline
                match deactivate_online(key, &self.app_data_dir).await {
                    Ok(_) => tracing::info!("License deactivated on server"),
                    Err(e) => tracing::warn!("Server deactivation failed (will retry): {}", e),
                }
            }
        }

        // Remove from DB regardless of server result
        delete_system_state(&conn, DB_KEY_LICENSE)?;

        // Re-check (will fall through to demo, no network needed after deactivation)
        let result = check_demo(&conn, None);
        self.set_cache(result.clone()).await;
        Ok(result)
    }
}
