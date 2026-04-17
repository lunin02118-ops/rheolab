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
    assert_eq!(dt.unwrap().date_naive(), NaiveDate::from_ymd_opt(2025, 12, 31).unwrap());
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
        );"
    ).unwrap();
    conn
}

/// Helper: sign with the dev private key (same as in crypto::tests).
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

#[test]
fn load_verified_accepts_valid_rsa() {
    // R-1: License with valid HMAC + valid RSA signedPayload → accepted
    let conn = setup_test_db();
    let tmp = std::env::temp_dir().join("rheolab_test_engine_rsa_valid");
    let _ = std::fs::create_dir_all(&tmp);

    let engine = LicenseEngine::new(tmp.clone());

    let signed_payload = r#"{"id":1,"type":"standard","customerName":"Test","expiresAt":"2099-01-01"}"#;
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
    assert!(result.is_some(), "Valid HMAC + valid RSA should be accepted");

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
    ).unwrap();

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
