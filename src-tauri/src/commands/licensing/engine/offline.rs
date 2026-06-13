use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::super::crypto::{save_secure_last_check, upsert_system_state, verify_server_signature};
use super::super::features::features_for_type;
use super::super::hardware::{all_legacy_ids, get_or_create_machine_id};
use super::super::types::{
    LicenseCheckResult, LicenseSource, LicenseStatus, LicenseType, OfflineActivationRequestInfo,
    DB_KEY_LICENSE, DB_KEY_WAS_LICENSED, DEFAULT_GRACE_PERIOD_DAYS,
};
use super::{compute_days_remaining, mask_key, LicenseEngine};
use crate::db::DbPool;
use crate::error::{AppError, Result};

const REQUEST_PREFIX: &str = "RL-REQ1:";
const ACTIVATION_PREFIX: &str = "RL-ACT1:";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfflineActivationRequestPayload {
    version: u8,
    request_type: String,
    machine_id: String,
    fingerprint_version: u8,
    platform: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfflineActivationEnvelope {
    payload: String,
    signature: String,
}

fn encode_prefixed<T: Serialize>(prefix: &str, payload: &T) -> Result<String> {
    let json = serde_json::to_vec(payload)?;
    Ok(format!("{prefix}{}", URL_SAFE_NO_PAD.encode(json)))
}

fn decode_prefixed_json<T: for<'de> Deserialize<'de>>(prefix: &str, code: &str) -> Result<T> {
    let compact = code
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>();
    let encoded = compact.strip_prefix(prefix).ok_or_else(|| {
        AppError::License(format!("Неверный формат кода. Ожидался префикс {prefix}"))
    })?;
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| AppError::License("Код повреждён или не является base64url".into()))?;
    serde_json::from_slice(&bytes)
        .map_err(|_| AppError::License("Код содержит неразбираемый JSON".into()))
}

pub(super) fn supported_payload_license_type(payload: &Value) -> Option<LicenseType> {
    LicenseType::from_str_supported(payload["type"].as_str().unwrap_or(""))
}

fn payload_machine_id(payload: &Value) -> Option<&str> {
    payload["machineId"]
        .as_str()
        .or_else(|| payload["machine_id"].as_str())
}

fn payload_offline_allowed(payload: &Value) -> bool {
    payload["offlineAllowed"].as_bool().unwrap_or(false)
        || payload["offline"].as_bool().unwrap_or(false)
        || payload["activationMode"].as_str() == Some("offline")
}

fn payload_hardware_bound(payload: &Value) -> bool {
    payload["hardwareBound"].as_bool().unwrap_or(false)
        || payload["hardware_bound"].as_bool().unwrap_or(false)
        || payload["bindingMode"].as_str() == Some("hardware")
}

fn payload_has_no_expiry(payload: &Value) -> bool {
    let expires_at = payload
        .get("expiresAt")
        .or_else(|| payload.get("expires_at"));
    expires_at.is_none_or(Value::is_null)
}

fn current_machine_matches(app_data_dir: &std::path::Path, payload: &Value) -> bool {
    let Some(expected) = payload_machine_id(payload) else {
        return false;
    };
    let current = get_or_create_machine_id(app_data_dir);
    if expected == current {
        return true;
    }
    all_legacy_ids(app_data_dir)
        .into_iter()
        .any(|legacy| legacy == expected)
}

pub(super) fn trusted_license_payload(data: &Value) -> Value {
    data["signedPayload"]
        .as_str()
        .and_then(|payload| serde_json::from_str::<Value>(payload).ok())
        .unwrap_or_else(|| data.clone())
}

pub(super) fn is_hardware_bound_license(payload: &Value) -> bool {
    supported_payload_license_type(payload) == Some(LicenseType::Corporate)
        || payload_hardware_bound(payload)
        || payload_offline_allowed(payload)
}

pub(super) fn is_local_permanent_license(payload: &Value) -> bool {
    supported_payload_license_type(payload) == Some(LicenseType::Corporate)
}

pub(super) fn validate_supported_license_payload(
    app_data_dir: &std::path::Path,
    payload: &Value,
) -> Result<LicenseType> {
    let Some(license_type) = supported_payload_license_type(payload) else {
        return Err(AppError::License(
            "Тип лицензии не поддерживается. Используйте trial, corporate, developer или superuser."
                .into(),
        ));
    };

    if license_type == LicenseType::Corporate {
        if !payload_has_no_expiry(payload) {
            return Err(AppError::License(
                "Корпоративная лицензия должна быть постоянной: expiresAt должен быть null.".into(),
            ));
        }
        if !payload_hardware_bound(payload) {
            return Err(AppError::License(
                "Корпоративная лицензия должна быть привязана к железу: hardwareBound=true.".into(),
            ));
        }
    }

    if is_hardware_bound_license(payload) && !current_machine_matches(app_data_dir, payload) {
        return Err(AppError::License(
            "Лицензия выпущена для другого устройства".into(),
        ));
    }

    Ok(license_type)
}

fn validate_offline_activation_payload(
    app_data_dir: &std::path::Path,
    signed_payload: &str,
    signature: &str,
) -> Result<Value> {
    if signed_payload.trim().is_empty() || signature.trim().is_empty() {
        return Err(AppError::License(
            "Офлайн-ключ должен содержать payload и подпись".into(),
        ));
    }
    if !verify_server_signature(signed_payload, signature) {
        return Err(AppError::License("Подпись офлайн-ключа некорректна".into()));
    }

    let payload: Value = serde_json::from_str(signed_payload)
        .map_err(|_| AppError::License("Payload офлайн-ключа не является JSON".into()))?;

    if !payload_offline_allowed(&payload) {
        return Err(AppError::License(
            "Ключ не разрешает офлайн-активацию".into(),
        ));
    }
    let license_type = validate_supported_license_payload(app_data_dir, &payload)?;
    if license_type != LicenseType::Corporate {
        return Err(AppError::License(
            "Офлайн-активация доступна только для корпоративных лицензий".into(),
        ));
    }

    Ok(payload)
}

impl LicenseEngine {
    pub fn generate_offline_activation_request(&self) -> Result<OfflineActivationRequestInfo> {
        let machine_id = get_or_create_machine_id(&self.app_data_dir);
        let payload = OfflineActivationRequestPayload {
            version: 1,
            request_type: "corporate_offline_activation".to_string(),
            machine_id: machine_id.clone(),
            fingerprint_version: 2,
            platform: std::env::consts::OS.to_string(),
        };

        Ok(OfflineActivationRequestInfo {
            request_code: encode_prefixed(REQUEST_PREFIX, &payload)?,
            machine_id,
        })
    }

    pub async fn activate_offline(
        &self,
        activation_code: &str,
        db_pool: &DbPool,
    ) -> Result<LicenseCheckResult> {
        let envelope: OfflineActivationEnvelope =
            decode_prefixed_json(ACTIVATION_PREFIX, activation_code)?;
        let license = validate_offline_activation_payload(
            &self.app_data_dir,
            &envelope.payload,
            &envelope.signature,
        )?;

        let license_type_str = license["type"].as_str().unwrap_or("corporate").to_string();
        let license_type = LicenseType::from_str_loose(&license_type_str);
        let key = license["key"]
            .as_str()
            .or_else(|| license["licenseKey"].as_str())
            .unwrap_or("RHEO-OFFLINE-CORPORATE")
            .to_string();

        let db_record = serde_json::json!({
            "id": license["id"],
            "type": license_type_str,
            "customerName": license["customerName"].as_str().unwrap_or(""),
            "email": license["email"],
            "issuedAt": license["issuedAt"],
            "expiresAt": license["expiresAt"],
            "gracePeriodDays": license["gracePeriodDays"].as_i64().unwrap_or(DEFAULT_GRACE_PERIOD_DAYS),
            "machineId": payload_machine_id(&license),
            "seats": license["seats"],
            "features": license["features"],
            "key": key,
            "serverSignature": envelope.signature,
            "signedPayload": envelope.payload,
            "activatedAt": Utc::now().to_rfc3339(),
            "activationMode": "offline",
            "offlineAllowed": true,
        });

        let conn = db_pool.get().map_err(AppError::Pool)?;
        let value_str = serde_json::to_string(&db_record)?;
        upsert_system_state(&conn, DB_KEY_LICENSE, &value_str)?;

        let was_licensed = serde_json::json!({
            "wasLicensed": true,
            "date": Utc::now().to_rfc3339(),
            "via": "offline_corporate_activation",
        });
        let was_str = serde_json::to_string(&was_licensed)?;
        if let Err(e) = upsert_system_state(&conn, DB_KEY_WAS_LICENSED, &was_str) {
            tracing::warn!(
                "offline activation: failed to persist was-licensed flag: {}",
                e
            );
        }

        let today = Utc::now().format("%Y-%m-%d").to_string();
        if let Err(e) = save_secure_last_check(&self.app_data_dir, &today) {
            tracing::warn!("offline activation: failed to save last-check date: {}", e);
        }

        let features = features_for_type(license_type);
        let expires_at = license["expiresAt"].as_str().map(|s| s.to_string());
        let days_remaining = compute_days_remaining(expires_at.as_deref());
        let show_warning = days_remaining.is_some_and(|d| d <= 30);

        let result = LicenseCheckResult {
            status: LicenseStatus::Active,
            source: LicenseSource::Key,
            features,
            key: Some(mask_key(&key)),
            license_type: Some(license_type_str),
            customer_name: license["customerName"].as_str().map(|s| s.to_string()),
            expires_at,
            days_remaining,
            experiments_remaining: None,
            message: Some("Корпоративная лицензия активирована офлайн".to_string()),
            show_warning,
        };

        self.set_cache(result.clone()).await;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    fn setup_test_pool() -> (tempfile::TempDir, crate::db::DbPool) {
        let dir = tempfile::tempdir().expect("temp db dir");
        let db_path = dir.path().join("offline-license-test.db");
        let pool = crate::db::create_pool(&db_path).expect("pool");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS SystemState (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    signature TEXT NOT NULL,
                    updatedAt TEXT NOT NULL
                );",
            )
            .expect("schema");
        }
        (dir, pool)
    }

    #[test]
    fn request_code_roundtrips_with_prefix() {
        let payload = OfflineActivationRequestPayload {
            version: 1,
            request_type: "corporate_offline_activation".into(),
            machine_id: "machine-1".into(),
            fingerprint_version: 2,
            platform: "windows".into(),
        };

        let code = encode_prefixed(REQUEST_PREFIX, &payload).expect("encode");
        let decoded: OfflineActivationRequestPayload =
            decode_prefixed_json(REQUEST_PREFIX, &code).expect("decode");
        assert_eq!(decoded.machine_id, "machine-1");
    }

    #[test]
    fn generated_request_code_does_not_embed_license_key() {
        let app_dir = tempfile::tempdir().expect("app dir");
        let engine = LicenseEngine::new(app_dir.path().to_path_buf());

        let request = engine
            .generate_offline_activation_request()
            .expect("request");
        let encoded = request
            .request_code
            .strip_prefix(REQUEST_PREFIX)
            .expect("request prefix");
        let bytes = URL_SAFE_NO_PAD.decode(encoded).expect("base64url");
        let payload: Value = serde_json::from_slice(&bytes).expect("json");

        assert!(payload.get("licenseKey").is_none());
        assert!(payload.get("license_key").is_none());
        assert!(payload.get("requestId").is_none());
        assert!(payload.get("createdAt").is_none());
    }

    #[test]
    fn generated_request_code_is_stable_for_same_machine() {
        let app_dir = tempfile::tempdir().expect("app dir");
        let engine = LicenseEngine::new(app_dir.path().to_path_buf());

        let first = engine
            .generate_offline_activation_request()
            .expect("first request");
        let second = engine
            .generate_offline_activation_request()
            .expect("second request");

        assert_eq!(first.request_code, second.request_code);
        assert_eq!(first.machine_id, second.machine_id);
    }

    #[test]
    fn offline_payload_rejects_wrong_machine() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let payload = serde_json::json!({
            "id": "lic-1",
            "type": "corporate",
            "customerName": "ACME",
            "expiresAt": null,
            "hardwareBound": true,
            "machineId": "definitely-not-this-machine",
            "activationMode": "offline",
            "offlineAllowed": true,
            "key": "RHEO-OFFLINE-TEST-0001"
        });
        let signed_payload = serde_json::to_string(&payload).expect("json");
        let sig = sign_with_dev_private_key(signed_payload.as_bytes());

        let err = validate_offline_activation_payload(tmp.path(), &signed_payload, &sig)
            .expect_err("wrong machine must be rejected")
            .to_string();
        assert!(
            err.contains("другого устройства"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn offline_payload_requires_corporate() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let machine_id = get_or_create_machine_id(tmp.path());
        let payload = serde_json::json!({
            "id": "lic-1",
            "type": "trial",
            "customerName": "ACME",
            "machineId": machine_id,
            "activationMode": "offline",
            "offlineAllowed": true,
            "key": "RHEO-OFFLINE-TEST-0001"
        });
        let signed_payload = serde_json::to_string(&payload).expect("json");
        let sig = sign_with_dev_private_key(signed_payload.as_bytes());

        let err = validate_offline_activation_payload(tmp.path(), &signed_payload, &sig)
            .expect_err("trial offline must be rejected")
            .to_string();
        assert!(err.contains("корпоратив"), "unexpected error: {err}");
    }

    #[test]
    fn corporate_payload_requires_hardware_bound_flag() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let machine_id = get_or_create_machine_id(tmp.path());
        let payload = serde_json::json!({
            "id": "lic-1",
            "type": "corporate",
            "customerName": "ACME",
            "expiresAt": null,
            "machineId": machine_id,
            "key": "RHEO-CORP-TEST-0001"
        });

        let err = validate_supported_license_payload(tmp.path(), &payload)
            .expect_err("corporate payload without hardwareBound must be rejected")
            .to_string();
        assert!(err.contains("hardwareBound"), "unexpected error: {err}");
    }

    #[test]
    fn corporate_payload_requires_no_expiry() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let machine_id = get_or_create_machine_id(tmp.path());
        let payload = serde_json::json!({
            "id": "lic-1",
            "type": "corporate",
            "customerName": "ACME",
            "expiresAt": "2099-01-01T00:00:00Z",
            "hardwareBound": true,
            "machineId": machine_id,
            "key": "RHEO-CORP-TEST-0001"
        });

        let err = validate_supported_license_payload(tmp.path(), &payload)
            .expect_err("corporate payload with expiresAt must be rejected")
            .to_string();
        assert!(err.contains("expiresAt"), "unexpected error: {err}");
    }

    #[tokio::test]
    async fn activate_offline_persists_corporate_license() {
        let app_dir = tempfile::tempdir().expect("app dir");
        let (_db_dir, pool) = setup_test_pool();
        let engine = LicenseEngine::new(app_dir.path().to_path_buf());
        let machine_id = get_or_create_machine_id(app_dir.path());
        let payload = serde_json::json!({
            "id": "lic-offline-1",
            "type": "corporate",
            "customerName": "ACME Offline",
            "issuedAt": "2026-05-05T00:00:00Z",
            "expiresAt": null,
            "gracePeriodDays": 30,
            "machineId": machine_id,
            "hardwareBound": true,
            "permanent": true,
            "seats": 1,
            "activationMode": "offline",
            "offlineAllowed": true,
            "key": "RHEO-OFFL-TEST-0001"
        });
        let signed_payload = serde_json::to_string(&payload).expect("payload json");
        let envelope = OfflineActivationEnvelope {
            payload: signed_payload.clone(),
            signature: sign_with_dev_private_key(signed_payload.as_bytes()),
        };
        let activation_code =
            encode_prefixed(ACTIVATION_PREFIX, &envelope).expect("activation code");

        let result = engine
            .activate_offline(&activation_code, &pool)
            .await
            .expect("offline activation");

        assert_eq!(result.status, LicenseStatus::Active);
        assert_eq!(result.license_type.as_deref(), Some("corporate"));
        assert_eq!(result.customer_name.as_deref(), Some("ACME Offline"));

        let conn = pool.get().expect("conn");
        let stored = engine.load_verified_license(&conn);
        assert!(
            stored.is_some(),
            "offline license must be stored with RSA proof"
        );
    }
}
