use crate::error::{AppError, Result};
use crate::utils::validation::{validate_bounded_str, validate_hash_id};
use rheolab_core::schedule_detector::ScheduleConfig;
use rheolab_core::{ExpertSettings, RHEOLAB_CORE_VERSION};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MAX_GEOMETRY_BYTES: usize = 64;

pub const ANALYSIS_CACHE_ALGORITHM_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct AnalysisCacheKey {
    pub experiment_id: String,
    pub experiment_data_hash: String,
    pub geometry: String,
    pub analysis_settings_hash: String,
    pub report_viscosity_rates_hash: String,
    pub rheolab_core_version: String,
    pub algorithm_version: u32,
}

pub fn build_analysis_cache_key(
    experiment_id: &str,
    experiment_data_hash: &str,
    geometry: &str,
    expert_settings: &ExpertSettings,
    detection_settings: &ScheduleConfig,
    report_viscosity_rates: &[i32],
) -> Result<AnalysisCacheKey> {
    validate_hash_id(experiment_id, "experimentId")?;
    validate_bounded_str(experiment_data_hash, 64, "experimentDataHash")?;
    if experiment_data_hash.len() != 64 {
        return Err(AppError::BadRequest(
            "experimentDataHash must be a 64-character sha256 hex digest".into(),
        ));
    }
    if !experiment_data_hash
        .as_bytes()
        .iter()
        .all(|b| b.is_ascii_hexdigit())
    {
        return Err(AppError::BadRequest(
            "experimentDataHash must be hexadecimal".into(),
        ));
    }
    let geometry = normalize_geometry(geometry)?;

    Ok(AnalysisCacheKey {
        experiment_id: experiment_id.to_owned(),
        experiment_data_hash: experiment_data_hash.to_owned(),
        geometry,
        analysis_settings_hash: hash_analysis_settings(expert_settings, detection_settings)?,
        report_viscosity_rates_hash: canonical_json_hash(report_viscosity_rates)?,
        rheolab_core_version: RHEOLAB_CORE_VERSION.to_owned(),
        algorithm_version: ANALYSIS_CACHE_ALGORITHM_VERSION,
    })
}

pub fn hash_experiment_data_bytes(bytes: &[u8]) -> String {
    sha256_hex(bytes)
}

fn normalize_geometry(geometry: &str) -> Result<String> {
    let normalized = geometry.trim().to_ascii_uppercase();
    let normalized = if normalized.is_empty() {
        "R1B5".to_string()
    } else {
        normalized
    };
    validate_bounded_str(&normalized, MAX_GEOMETRY_BYTES, "geometry")?;
    Ok(normalized)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisSettingsKeyMaterial<'a> {
    expert_settings: &'a ExpertSettings,
    detection_settings: &'a ScheduleConfig,
}

fn hash_analysis_settings(
    expert_settings: &ExpertSettings,
    detection_settings: &ScheduleConfig,
) -> Result<String> {
    canonical_json_hash(&AnalysisSettingsKeyMaterial {
        expert_settings,
        detection_settings,
    })
}

fn canonical_json_hash<T: Serialize + ?Sized>(value: &T) -> Result<String> {
    let bytes = serde_json::to_vec(value)?;
    Ok(sha256_hex(&bytes))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex::encode(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> AnalysisCacheKey {
        build_analysis_cache_key(
            "exp_aaaaaaaaaaaaaaaaaaaa",
            &hash_experiment_data_bytes(b"fixture-data"),
            " r1b5 ",
            &ExpertSettings::default(),
            &ScheduleConfig::default(),
            &[40, 100, 170],
        )
        .unwrap()
    }

    #[test]
    fn key_is_deterministic_and_normalizes_geometry() {
        let a = key();
        let b = key();
        assert_eq!(a, b);
        assert_eq!(a.geometry, "R1B5");
        assert_eq!(a.rheolab_core_version, RHEOLAB_CORE_VERSION);
        assert_eq!(a.algorithm_version, 1);
    }

    #[test]
    fn data_hash_changes_key() {
        let a = key();
        let b = build_analysis_cache_key(
            "exp_aaaaaaaaaaaaaaaaaaaa",
            &hash_experiment_data_bytes(b"changed"),
            "R1B5",
            &ExpertSettings::default(),
            &ScheduleConfig::default(),
            &[40, 100, 170],
        )
        .unwrap();
        assert_ne!(a.experiment_data_hash, b.experiment_data_hash);
    }

    #[test]
    fn settings_change_key() {
        let a = key();
        let expert_settings = ExpertSettings {
            points_to_average: 3,
            viscosity_shear_rates: vec![40.0, 100.0, 170.0],
        };
        let b = build_analysis_cache_key(
            "exp_aaaaaaaaaaaaaaaaaaaa",
            &a.experiment_data_hash,
            "R1B5",
            &expert_settings,
            &ScheduleConfig::default(),
            &[40, 100, 170],
        )
        .unwrap();
        assert_ne!(a.analysis_settings_hash, b.analysis_settings_hash);
    }

    #[test]
    fn detection_settings_change_key() {
        let a = key();
        let detection_settings = ScheduleConfig {
            min_step_duration: ScheduleConfig::default().min_step_duration + 1.0,
            ..ScheduleConfig::default()
        };
        let b = build_analysis_cache_key(
            "exp_aaaaaaaaaaaaaaaaaaaa",
            &a.experiment_data_hash,
            "R1B5",
            &ExpertSettings::default(),
            &detection_settings,
            &[40, 100, 170],
        )
        .unwrap();
        assert_ne!(a.analysis_settings_hash, b.analysis_settings_hash);
    }

    #[test]
    fn geometry_change_key() {
        let a = key();
        let b = build_analysis_cache_key(
            "exp_aaaaaaaaaaaaaaaaaaaa",
            &a.experiment_data_hash,
            "R2B1",
            &ExpertSettings::default(),
            &ScheduleConfig::default(),
            &[40, 100, 170],
        )
        .unwrap();
        assert_ne!(a.geometry, b.geometry);
    }

    #[test]
    fn report_rates_change_key() {
        let a = key();
        let b = build_analysis_cache_key(
            "exp_aaaaaaaaaaaaaaaaaaaa",
            &a.experiment_data_hash,
            "R1B5",
            &ExpertSettings::default(),
            &ScheduleConfig::default(),
            &[100, 170],
        )
        .unwrap();
        assert_ne!(a.report_viscosity_rates_hash, b.report_viscosity_rates_hash);
    }

    #[test]
    fn rejects_bad_experiment_data_hash() {
        let non_hex_hash = "g".repeat(64);
        let err = build_analysis_cache_key(
            "exp_aaaaaaaaaaaaaaaaaaaa",
            &non_hex_hash,
            "R1B5",
            &ExpertSettings::default(),
            &ScheduleConfig::default(),
            &[40],
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("hexadecimal"));
    }

    #[test]
    fn rejects_short_hex_experiment_data_hash() {
        let err = build_analysis_cache_key(
            "exp_aaaaaaaaaaaaaaaaaaaa",
            "abcd",
            "R1B5",
            &ExpertSettings::default(),
            &ScheduleConfig::default(),
            &[40],
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("64-character"));
    }
}
