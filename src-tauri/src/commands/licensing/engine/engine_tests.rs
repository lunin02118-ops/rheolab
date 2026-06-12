use super::*;
use crate::commands::licensing::crypto::upsert_system_state;
use crate::commands::licensing::types::DB_KEY_LICENSE;

#[test]
fn mask_key_standard() {
    assert_eq!(mask_key("RHEO-ABCD-EFGH-1234"), "RHEO-****-****-1234");
}

#[test]
fn mask_key_short() {
    assert_eq!(mask_key("ABC"), "ABC");
}

#[test]
fn mask_key_long_no_dashes() {
    let masked = mask_key("ABCDEFGHIJKL");
    assert_eq!(masked, "ABCD****IJKL");
}

#[test]
fn parse_expiry_rfc3339() {
    let dt = parse_expiry("2025-12-31T23:59:59Z");
    assert!(dt.is_some());
    assert_eq!(
        dt.unwrap().date_naive(),
        NaiveDate::from_ymd_opt(2025, 12, 31).unwrap()
    );
}

#[test]
fn parse_expiry_sql() {
    let dt = parse_expiry("2025-12-31 23:59:59");
    assert!(dt.is_some());
}

#[test]
fn parse_expiry_date_only() {
    let dt = parse_expiry("2025-12-31");
    assert!(dt.is_some());
}

#[test]
fn compute_days_remaining_future() {
    let future = (Utc::now() + chrono::Duration::days(10))
        .format("%Y-%m-%dT23:59:59Z")
        .to_string();
    let days = compute_days_remaining(Some(&future));
    assert!(days.is_some());
    assert!(days.unwrap() >= 9); // Might be 9 or 10 depending on time of day
}

#[test]
fn compute_days_remaining_past() {
    let past = (Utc::now() - chrono::Duration::days(5))
        .format("%Y-%m-%dT00:00:00Z")
        .to_string();
    let days = compute_days_remaining(Some(&past));
    assert!(days.is_some());
    assert!(days.unwrap() <= -4);
}

// ── Two-level RSA verification tests (F-07 / P2-3 group R) ────────

fn setup_test_db() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS SystemState (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            signature TEXT NOT NULL,
            updatedAt TEXT NOT NULL
        );",
    )
    .unwrap();
    conn
}

fn setup_test_pool() -> (tempfile::TempDir, crate::db::DbPool) {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("licensing-test.db");
    let pool = crate::db::create_pool(&db_path).unwrap();
    {
        let conn = pool.get().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS SystemState (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                signature TEXT NOT NULL,
                updatedAt TEXT NOT NULL
            );",
        )
        .unwrap();
    }
    (dir, pool)
}

/// Helper: sign with the dev private key (same as in crypto::tests).
fn sign_with_dev_private_key(data: &[u8]) -> String {
    use base64::Engine;
    use rsa::pkcs1v15::SigningKey;
    use rsa::pkcs8::DecodePrivateKey;
    use rsa::signature::{SignatureEncoding, Signer};
    use sha2::Sha256;

    let private_der = include_bytes!("../../../../keys/dev_private.der");
    let private_key =
        rsa::RsaPrivateKey::from_pkcs8_der(private_der).expect("dev private key should be valid");
    let signing_key = SigningKey::<Sha256>::new(private_key);
    let signature = signing_key.sign(data);
    base64::engine::general_purpose::STANDARD.encode(&*signature.to_bytes())
}

#[test]
fn load_verified_accepts_valid_rsa() {
    // R-1: License with valid HMAC + valid RSA signedPayload → accepted
    let conn = setup_test_db();
    let tmp = std::env::temp_dir().join("rheolab_test_engine_rsa_valid");
    let _ = std::fs::create_dir_all(&tmp);

    let engine = LicenseEngine::new(tmp.clone());

    let signed_payload =
        r#"{"id":1,"type":"standard","customerName":"Test","expiresAt":"2099-01-01"}"#;
    let server_sig = sign_with_dev_private_key(signed_payload.as_bytes());

    let db_record = serde_json::json!({
        "id": 1,
        "type": "standard",
        "customerName": "Test",
        "expiresAt": "2099-01-01T00:00:00Z",
        "gracePeriodDays": 30,
        "key": "RHEO-TEST-AAAA-BBBB",
        "serverSignature": server_sig,
        "signedPayload": signed_payload,
    });
    let value_str = serde_json::to_string(&db_record).unwrap();
    upsert_system_state(&conn, DB_KEY_LICENSE, &value_str).unwrap();

    let result = engine.load_verified_license(&conn);
    assert!(
        result.is_some(),
        "Valid HMAC + valid RSA should be accepted"
    );

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn load_verified_rejects_forged_rsa() {
    // R-2: License with valid HMAC but forged RSA signature → rejected
    let conn = setup_test_db();
    let tmp = std::env::temp_dir().join("rheolab_test_engine_rsa_forged");
    let _ = std::fs::create_dir_all(&tmp);

    let engine = LicenseEngine::new(tmp.clone());

    let signed_payload = r#"{"id":1,"type":"enterprise","expiresAt":"2099-01-01"}"#;
    // Use a wrong signature (signed different data)
    let wrong_sig = sign_with_dev_private_key(b"different data entirely");

    let db_record = serde_json::json!({
        "id": 1,
        "type": "enterprise",
        "expiresAt": "2099-01-01T00:00:00Z",
        "gracePeriodDays": 30,
        "key": "RHEO-FAKE-CCCC-DDDD",
        "serverSignature": wrong_sig,
        "signedPayload": signed_payload,
    });
    let value_str = serde_json::to_string(&db_record).unwrap();
    upsert_system_state(&conn, DB_KEY_LICENSE, &value_str).unwrap();

    let result = engine.load_verified_license(&conn);
    assert!(result.is_none(), "Valid HMAC + forged RSA must be rejected");

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn load_verified_rejects_legacy_no_signed_payload() {
    // R-3: Legacy license without signedPayload — grace period closed (S-2).
    //      Must be rejected even with a recent activatedAt.
    let conn = setup_test_db();
    let tmp = std::env::temp_dir().join("rheolab_test_engine_rsa_legacy");
    let _ = std::fs::create_dir_all(&tmp);

    let engine = LicenseEngine::new(tmp.clone());

    let db_record = serde_json::json!({
        "id": 1,
        "type": "standard",
        "expiresAt": "2099-01-01T00:00:00Z",
        "gracePeriodDays": 30,
        "key": "RHEO-LEGA-EEEE-FFFF",
        "serverSignature": "old_hmac_style_no_rsa",
        "activatedAt": Utc::now().to_rfc3339(),
        // No "signedPayload" field — legacy record
    });
    let value_str = serde_json::to_string(&db_record).unwrap();
    upsert_system_state(&conn, DB_KEY_LICENSE, &value_str).unwrap();

    let result = engine.load_verified_license(&conn);
    assert!(
        result.is_none(),
        "Legacy HMAC-only record must be rejected — grace period closed (S-2)"
    );

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn load_verified_rejects_legacy_expired_grace() {
    // R-3b: Legacy record activated > LEGACY_HMAC_GRACE_DAYS ago → rejected
    let conn = setup_test_db();
    let tmp = std::env::temp_dir().join("rheolab_test_engine_legacy_expired");
    let _ = std::fs::create_dir_all(&tmp);

    let engine = LicenseEngine::new(tmp.clone());

    let old_activation = (Utc::now() - chrono::Duration::days(91)).to_rfc3339();
    let db_record = serde_json::json!({
        "id": 1,
        "type": "standard",
        "expiresAt": "2099-01-01T00:00:00Z",
        "gracePeriodDays": 30,
        "key": "RHEO-LEGA-OLDX-XXXX",
        "serverSignature": "old_hmac_style_no_rsa",
        "activatedAt": old_activation,
    });
    let value_str = serde_json::to_string(&db_record).unwrap();
    upsert_system_state(&conn, DB_KEY_LICENSE, &value_str).unwrap();

    let result = engine.load_verified_license(&conn);
    assert!(
        result.is_none(),
        "Legacy record with expired grace (>90 days) must be rejected"
    );

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn load_verified_rejects_legacy_no_activated_at() {
    // R-3c: Legacy record without activatedAt at all → rejected (very old record)
    let conn = setup_test_db();
    let tmp = std::env::temp_dir().join("rheolab_test_engine_legacy_no_activated");
    let _ = std::fs::create_dir_all(&tmp);

    let engine = LicenseEngine::new(tmp.clone());

    let db_record = serde_json::json!({
        "id": 1,
        "type": "standard",
        "expiresAt": "2099-01-01T00:00:00Z",
        "gracePeriodDays": 30,
        "key": "RHEO-LEGA-NACT-XXXX",
        "serverSignature": "old_hmac_style_no_rsa",
        // No activatedAt — very old legacy record
    });
    let value_str = serde_json::to_string(&db_record).unwrap();
    upsert_system_state(&conn, DB_KEY_LICENSE, &value_str).unwrap();

    let result = engine.load_verified_license(&conn);
    assert!(
        result.is_none(),
        "Legacy record without activatedAt must be rejected"
    );

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn load_verified_rejects_tampered_hmac() {
    // R-4: License with tampered HMAC (first level) → rejected before RSA check
    let conn = setup_test_db();
    let tmp = std::env::temp_dir().join("rheolab_test_engine_hmac_tampered");
    let _ = std::fs::create_dir_all(&tmp);

    let engine = LicenseEngine::new(tmp.clone());

    let db_record = serde_json::json!({
        "id": 1,
        "type": "enterprise",
        "expiresAt": "2099-01-01T00:00:00Z",
        "key": "RHEO-HACK-GGGG-HHHH",
    });
    let value_str = serde_json::to_string(&db_record).unwrap();
    // Insert with wrong HMAC directly
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO SystemState (key, value, signature, updatedAt) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![DB_KEY_LICENSE, value_str, "forged_hmac", now],
    )
    .unwrap();

    let result = engine.load_verified_license(&conn);
    assert!(result.is_none(), "Tampered HMAC must be rejected");

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn load_verified_rejects_malformed_json_even_with_valid_hmac() {
    // R-5: HMAC-valid but malformed JSON must fail closed before any RSA/path logic.
    let conn = setup_test_db();
    let tmp = std::env::temp_dir().join("rheolab_test_engine_malformed_json");
    let _ = std::fs::create_dir_all(&tmp);

    let engine = LicenseEngine::new(tmp.clone());

    let malformed_value = r#"{"id":1,"type":"standard","signedPayload":"oops""#;
    upsert_system_state(&conn, DB_KEY_LICENSE, malformed_value).unwrap();

    let result = engine.load_verified_license(&conn);
    assert!(
        result.is_none(),
        "Malformed JSON must be rejected even when the stored HMAC is valid"
    );

    let _ = std::fs::remove_dir_all(&tmp);
}

// ── HMAC-rescue path (S-3) ──────────────────────────────────────────────

#[test]
fn load_verified_rescues_hmac_when_rsa_is_intact() {
    // S-3/R-6: Simulates the real-world scenario where the build-time
    // INTEGRITY_SECRET_KEY rotated between releases, breaking the stored
    // HMAC, but the server's RSA proof (signedPayload + serverSignature)
    // survives untouched. The engine must re-sign the record under the
    // current key and keep the user licensed instead of dropping them to
    // demo mode.
    use crate::commands::licensing::crypto::{get_system_state, verify_signature};
    let conn = setup_test_db();
    let tmp = std::env::temp_dir().join("rheolab_test_engine_hmac_rescue");
    let _ = std::fs::create_dir_all(&tmp);

    let engine = LicenseEngine::new(tmp.clone());

    let signed_payload =
        r#"{"id":1,"type":"standard","customerName":"Test","expiresAt":"2099-01-01"}"#;
    let server_sig = sign_with_dev_private_key(signed_payload.as_bytes());

    let db_record = serde_json::json!({
        "id": 1,
        "type": "standard",
        "customerName": "Test",
        "expiresAt": "2099-01-01T00:00:00Z",
        "gracePeriodDays": 30,
        "key": "RHEO-RESC-AAAA-BBBB",
        "serverSignature": server_sig,
        "signedPayload": signed_payload,
    });
    let value_str = serde_json::to_string(&db_record).unwrap();

    // Insert with a deliberately wrong HMAC — simulates a key rotation.
    // We cannot go through upsert_system_state() because it always signs
    // with the current key, which would defeat the test.
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO SystemState (key, value, signature, updatedAt) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![DB_KEY_LICENSE, &value_str, "deadbeef_stale_hmac", now],
    )
    .unwrap();

    // Sanity check: the starting HMAC must be invalid under the current key.
    let pre = get_system_state(&conn, DB_KEY_LICENSE).unwrap().unwrap();
    assert!(
        !verify_signature(&pre.0, &pre.1),
        "Precondition: stored HMAC should NOT verify under the current key",
    );

    let result = engine.load_verified_license(&conn);
    assert!(
        result.is_some(),
        "HMAC rescue: broken HMAC + valid RSA must NOT drop the license",
    );
    let (returned_value, returned_sig) = result.unwrap();
    assert_eq!(
        returned_value, value_str,
        "Rescue must preserve the payload byte-for-byte"
    );

    // The returned signature must verify under the current key (i.e. it's
    // the freshly-computed HMAC, not the original stale one).
    assert!(
        verify_signature(&returned_value, &returned_sig),
        "Rescue must return a signature valid under the current INTEGRITY_SECRET_KEY",
    );

    // The DB record must have been updated in place — next cold start
    // should hit the fast HMAC-valid path without rescuing again.
    let post = get_system_state(&conn, DB_KEY_LICENSE).unwrap().unwrap();
    assert_eq!(
        post.0, value_str,
        "DB value must remain unchanged after rescue"
    );
    assert!(
        verify_signature(&post.0, &post.1),
        "DB HMAC must be re-signed under the current key after rescue",
    );
    assert_ne!(
        post.1, "deadbeef_stale_hmac",
        "Stale HMAC must be overwritten"
    );

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn load_verified_does_not_rescue_when_rsa_is_invalid() {
    // S-3/R-7: HMAC-rescue must be gated on RSA success. A record whose
    // HMAC is broken AND whose RSA proof fails verification could have
    // been forged — we must still reject it to avoid turning the rescue
    // path into an authentication bypass.
    let conn = setup_test_db();
    let tmp = std::env::temp_dir().join("rheolab_test_engine_hmac_rescue_bad_rsa");
    let _ = std::fs::create_dir_all(&tmp);

    let engine = LicenseEngine::new(tmp.clone());

    let signed_payload = r#"{"id":1,"type":"enterprise","expiresAt":"2099-01-01"}"#;
    // RSA signature over unrelated bytes — RSA verify must fail.
    let wrong_sig = sign_with_dev_private_key(b"completely different payload");

    let db_record = serde_json::json!({
        "id": 1,
        "type": "enterprise",
        "expiresAt": "2099-01-01T00:00:00Z",
        "gracePeriodDays": 30,
        "key": "RHEO-BAD-RSAA-XXXX",
        "serverSignature": wrong_sig,
        "signedPayload": signed_payload,
    });
    let value_str = serde_json::to_string(&db_record).unwrap();

    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO SystemState (key, value, signature, updatedAt) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![DB_KEY_LICENSE, &value_str, "stale_hmac_here", now],
    )
    .unwrap();

    let result = engine.load_verified_license(&conn);
    assert!(
        result.is_none(),
        "Broken HMAC with invalid RSA must NOT be rescued — that would be an auth bypass",
    );

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn load_verified_does_not_rescue_when_rsa_is_missing() {
    // S-3/R-8: Legacy record without signedPayload/serverSignature cannot be
    // rescued even if the stored HMAC happens to be stale — without RSA
    // proof the engine has no authoritative way to trust the payload.
    let conn = setup_test_db();
    let tmp = std::env::temp_dir().join("rheolab_test_engine_hmac_rescue_no_rsa");
    let _ = std::fs::create_dir_all(&tmp);

    let engine = LicenseEngine::new(tmp.clone());

    let db_record = serde_json::json!({
        "id": 1,
        "type": "standard",
        "expiresAt": "2099-01-01T00:00:00Z",
        "gracePeriodDays": 30,
        "key": "RHEO-NO-RSA-XXXX",
        // No signedPayload / serverSignature — legacy-shape record.
    });
    let value_str = serde_json::to_string(&db_record).unwrap();

    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO SystemState (key, value, signature, updatedAt) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![DB_KEY_LICENSE, &value_str, "stale_hmac_no_rsa", now],
    )
    .unwrap();

    let result = engine.load_verified_license(&conn);
    assert!(
        result.is_none(),
        "Broken HMAC + no RSA proof must remain rejected — user must re-activate",
    );

    let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn check_local_startup_keeps_key_path_value_only() {
    let (_db_dir, pool) = setup_test_pool();
    let app_dir = tempfile::tempdir().unwrap();
    let engine = LicenseEngine::new(app_dir.path().to_path_buf());

    let signed_payload =
        r#"{"id":1,"type":"trial","customerName":"Startup","expiresAt":"2099-01-01"}"#;
    let server_sig = sign_with_dev_private_key(signed_payload.as_bytes());
    let db_record = serde_json::json!({
        "id": 1,
        "type": "trial",
        "customerName": "Startup",
        "expiresAt": "2099-01-01T00:00:00Z",
        "gracePeriodDays": 30,
        "key": "RHEO-STAR-TUPP-TEST",
        "serverSignature": server_sig,
        "signedPayload": signed_payload,
    });
    let value_str = serde_json::to_string(&db_record).unwrap();
    {
        let conn = pool.get().unwrap();
        upsert_system_state(&conn, DB_KEY_LICENSE, &value_str).unwrap();
    }

    let rt = tokio::runtime::Runtime::new().unwrap();
    let result = rt.block_on(engine.check_local_startup(&pool));
    assert_eq!(result.status, LicenseStatus::Active);

    let cache_time = rt.block_on(async { *engine.cache_time.read().await });
    assert!(
        cache_time.is_none(),
        "Startup key path should keep cache_time unset so machine-id / secure-storage work stays off the blocking startup path"
    );

    let cached = rt.block_on(engine.cached()).expect("cached startup result");
    assert_eq!(cached.status, LicenseStatus::Active);
}

#[test]
fn check_local_startup_accepts_corporate_permanent_current_machine() {
    let (_db_dir, pool) = setup_test_pool();
    let app_dir = tempfile::tempdir().unwrap();
    let engine = LicenseEngine::new(app_dir.path().to_path_buf());
    let machine_id = crate::commands::licensing::get_or_create_machine_id(app_dir.path());

    let payload = serde_json::json!({
        "id": 77,
        "type": "corporate",
        "customerName": "ACME Corporate",
        "expiresAt": null,
        "hardwareBound": true,
        "permanent": true,
        "machineId": machine_id,
        "key": "RHEO-CORP-PERM-TEST"
    });
    let signed_payload = serde_json::to_string(&payload).unwrap();
    let server_sig = sign_with_dev_private_key(signed_payload.as_bytes());
    let db_record = serde_json::json!({
        "id": 77,
        "type": "corporate",
        "customerName": "ACME Corporate",
        "expiresAt": null,
        "gracePeriodDays": 30,
        "machineId": payload["machineId"],
        "hardwareBound": true,
        "permanent": true,
        "key": "RHEO-CORP-PERM-TEST",
        "serverSignature": server_sig,
        "signedPayload": signed_payload,
    });
    {
        let conn = pool.get().unwrap();
        upsert_system_state(
            &conn,
            DB_KEY_LICENSE,
            &serde_json::to_string(&db_record).unwrap(),
        )
        .unwrap();
    }

    let rt = tokio::runtime::Runtime::new().unwrap();
    let result = rt.block_on(engine.check_local_startup(&pool));

    assert_eq!(result.status, LicenseStatus::Active);
    assert_eq!(result.license_type.as_deref(), Some("corporate"));
    assert_eq!(result.days_remaining, None);
}

#[test]
fn check_local_startup_rejects_corporate_wrong_machine() {
    let (_db_dir, pool) = setup_test_pool();
    let app_dir = tempfile::tempdir().unwrap();
    let engine = LicenseEngine::new(app_dir.path().to_path_buf());

    let payload = serde_json::json!({
        "id": 78,
        "type": "corporate",
        "customerName": "ACME Corporate",
        "expiresAt": null,
        "hardwareBound": true,
        "permanent": true,
        "machineId": "definitely-not-this-machine",
        "key": "RHEO-CORP-WRNG-TEST"
    });
    let signed_payload = serde_json::to_string(&payload).unwrap();
    let server_sig = sign_with_dev_private_key(signed_payload.as_bytes());
    let db_record = serde_json::json!({
        "id": 78,
        "type": "corporate",
        "customerName": "ACME Corporate",
        "expiresAt": null,
        "gracePeriodDays": 30,
        "machineId": "definitely-not-this-machine",
        "hardwareBound": true,
        "permanent": true,
        "key": "RHEO-CORP-WRNG-TEST",
        "serverSignature": server_sig,
        "signedPayload": signed_payload,
    });
    {
        let conn = pool.get().unwrap();
        upsert_system_state(
            &conn,
            DB_KEY_LICENSE,
            &serde_json::to_string(&db_record).unwrap(),
        )
        .unwrap();
    }

    let rt = tokio::runtime::Runtime::new().unwrap();
    let result = rt.block_on(engine.check_local_startup(&pool));

    assert_eq!(result.status, LicenseStatus::Invalid);
    assert!(
        result
            .message
            .as_deref()
            .unwrap_or_default()
            .contains("другого устройства"),
        "unexpected message: {:?}",
        result.message
    );
}

/// Regression guard: `check_local_startup()` must complete without any
/// network I/O.  If someone accidentally adds an HTTP call (validate_online,
/// find_by_machine_online, register_demo_online, etc.) the 15 s reqwest
/// timeout would blow past this 2 s budget and the test would fail.
///
/// Both code paths are exercised:
///   - **Key path** (stored license in DB)
///   - **Unlicensed path** (no license → invalid)
#[test]
fn check_local_startup_is_strictly_local_no_http() {
    // ── Key path ─────────────────────────────────────────────────────
    {
        let (_db_dir, pool) = setup_test_pool();
        let app_dir = tempfile::tempdir().unwrap();
        let engine = LicenseEngine::new(app_dir.path().to_path_buf());

        let signed_payload =
            r#"{"id":99,"type":"trial","customerName":"NoHTTP","expiresAt":"2099-06-01"}"#;
        let server_sig = sign_with_dev_private_key(signed_payload.as_bytes());
        let db_record = serde_json::json!({
            "id": 99,
            "type": "trial",
            "customerName": "NoHTTP",
            "expiresAt": "2099-06-01T00:00:00Z",
            "gracePeriodDays": 30,
            "key": "RHEO-NOHT-TPTE-ST01",
            "serverSignature": server_sig,
            "signedPayload": signed_payload,
        });
        {
            let conn = pool.get().unwrap();
            upsert_system_state(
                &conn,
                DB_KEY_LICENSE,
                &serde_json::to_string(&db_record).unwrap(),
            )
            .unwrap();
        }

        let rt = tokio::runtime::Runtime::new().unwrap();
        let start = std::time::Instant::now();
        let result = rt.block_on(engine.check_local_startup(&pool));
        let elapsed = start.elapsed();

        assert_eq!(result.status, LicenseStatus::Active);
        assert!(
            elapsed.as_secs() < 2,
            "Key path took {} ms — likely made an HTTP call (budget: <2 s)",
            elapsed.as_millis()
        );
    }

    // ── Unlicensed path (no stored license) ──────────────────────────
    {
        let (_db_dir, pool) = setup_test_pool();
        let app_dir = tempfile::tempdir().unwrap();
        let engine = LicenseEngine::new(app_dir.path().to_path_buf());

        let rt = tokio::runtime::Runtime::new().unwrap();
        let start = std::time::Instant::now();
        let result = rt.block_on(engine.check_local_startup(&pool));
        let elapsed = start.elapsed();

        assert_eq!(result.status, LicenseStatus::Demo);
        assert_eq!(result.days_remaining, Some(30));
        assert!(
            elapsed.as_secs() < 2,
            "Demo startup path took {} ms — likely made an HTTP call (budget: <2 s)",
            elapsed.as_millis()
        );
    }
}

// ── Audit-v2 LIC-002 ──────────────────────────────────────────────────

/// `invalidate_cache_time` must drop the TTL marker (`cache_time = None`)
/// while leaving the cached *value* intact.  This is the primitive that
/// `register_experiment` uses to force the next `check()` past its
/// 120-second TTL fast-path after the demo counter is bumped.
#[test]
fn invalidate_cache_time_clears_only_the_marker() {
    use crate::commands::licensing::types::{LicenseSource, LicenseStatus};

    let tmp = tempfile::tempdir().unwrap();
    let engine = LicenseEngine::new(tmp.path().to_path_buf());

    let rt = tokio::runtime::Runtime::new().unwrap();

    // Populate cache + cache_time as a real `check()` call would.
    let cached_value = LicenseCheckResult {
        status: LicenseStatus::Demo,
        source: LicenseSource::Demo,
        features: crate::commands::licensing::features::demo_features(),
        key: None,
        license_type: None,
        customer_name: None,
        expires_at: None,
        days_remaining: None,
        experiments_remaining: Some(7),
        message: None,
        show_warning: false,
    };
    rt.block_on(engine.set_cache(cached_value.clone()));

    // Pre-condition: cache_time IS Some after set_cache.
    assert!(
        rt.block_on(engine.cache_time_for_test()).is_some(),
        "set_cache must populate cache_time"
    );

    // Act: invalidate.
    rt.block_on(engine.invalidate_cache_time());

    // Post-condition: cache_time is None, cached value is preserved.
    assert!(
        rt.block_on(engine.cache_time_for_test()).is_none(),
        "invalidate_cache_time must clear cache_time"
    );
    let still_cached = rt.block_on(engine.cached());
    assert!(
        still_cached.is_some(),
        "invalidate_cache_time must NOT drop the cached value"
    );
    let still_cached = still_cached.unwrap();
    assert_eq!(still_cached.status, LicenseStatus::Demo);
    assert_eq!(still_cached.experiments_remaining, Some(7));
}

#[test]
fn can_write_allows_active_grace_and_demo_only() {
    use crate::commands::licensing::features::{demo_features, expired_features, full_features};
    use crate::commands::licensing::types::{LicenseSource, LicenseStatus};

    let tmp = tempfile::tempdir().unwrap();
    let engine = LicenseEngine::new(tmp.path().to_path_buf());
    let rt = tokio::runtime::Runtime::new().unwrap();

    for status in [
        LicenseStatus::Active,
        LicenseStatus::Grace,
        LicenseStatus::Demo,
    ] {
        let features = if status == LicenseStatus::Demo {
            demo_features()
        } else {
            full_features()
        };
        let source = if status == LicenseStatus::Demo {
            LicenseSource::Demo
        } else {
            LicenseSource::Key
        };
        rt.block_on(engine.set_cache(LicenseCheckResult {
            status,
            source,
            features,
            key: None,
            license_type: None,
            customer_name: None,
            expires_at: None,
            days_remaining: None,
            experiments_remaining: None,
            message: None,
            show_warning: false,
        }));
        assert!(
            rt.block_on(engine.can_write()),
            "{status:?} must allow write-gated demo/licensed workflows"
        );
    }

    for status in [
        LicenseStatus::DemoExpired,
        LicenseStatus::Expired,
        LicenseStatus::Invalid,
        LicenseStatus::Revoked,
    ] {
        rt.block_on(engine.set_cache(LicenseCheckResult {
            status,
            source: LicenseSource::Unlicensed,
            features: expired_features(),
            key: None,
            license_type: None,
            customer_name: None,
            expires_at: None,
            days_remaining: None,
            experiments_remaining: None,
            message: None,
            show_warning: true,
        }));
        assert!(
            !rt.block_on(engine.can_write()),
            "{status:?} must stay blocked"
        );
    }
}
