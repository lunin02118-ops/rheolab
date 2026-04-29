use crate::commands::analysis::AnalysisOutput;
use crate::error::{AppError, Result};
use std::io::Read;

pub const ANALYSIS_ARTIFACT_ENCODING: &str = "analysis-output.json+zstd:v1";
pub const MAX_ANALYSIS_ARTIFACT_BYTES: usize = 50 * 1024 * 1024;
const ZSTD_LEVEL: i32 = 3;

pub fn encode_analysis_artifact(output: &AnalysisOutput) -> Result<Vec<u8>> {
    let json = serde_json::to_vec(output)?;
    zstd::encode_all(json.as_slice(), ZSTD_LEVEL)
        .map_err(|error| AppError::Other(format!("analysis artifact zstd encode failed: {error}")))
}

pub fn decode_analysis_artifact(bytes: &[u8]) -> Result<AnalysisOutput> {
    let mut decoder = zstd::stream::read::Decoder::new(bytes).map_err(|error| {
        AppError::Other(format!("analysis artifact zstd decode failed: {error}"))
    })?;
    let mut json = Vec::new();
    decoder
        .by_ref()
        .take((MAX_ANALYSIS_ARTIFACT_BYTES + 1) as u64)
        .read_to_end(&mut json)
        .map_err(|error| {
            AppError::Other(format!("analysis artifact zstd decode failed: {error}"))
        })?;
    if json.len() > MAX_ANALYSIS_ARTIFACT_BYTES {
        return Err(AppError::Other(format!(
            "analysis artifact exceeds {} bytes after decompression",
            MAX_ANALYSIS_ARTIFACT_BYTES
        )));
    }
    serde_json::from_slice(&json).map_err(AppError::Serde)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rheolab_core::types::{RheoCycle, RheoStep};

    fn output() -> AnalysisOutput {
        AnalysisOutput {
            cycles: vec![RheoCycle {
                id: 1,
                cycle_index: Some(0),
                cycle_type: "test".into(),
                steps: vec![],
                description: "fixture".into(),
                duration: 42.0,
            }],
            results: vec![],
            all_steps: vec![RheoStep {
                id: 1,
                start_time: 0.0,
                end_time: 10.0,
                duration: 10.0,
                avg_shear_rate: 100.0,
                avg_shear_stress: 5.0,
                avg_viscosity: 50.0,
                avg_temperature: 25.0,
                avg_pressure: 1.0,
                points: vec![],
                calc_points_count: 1,
                is_ramp: false,
                start_index: 0,
                end_index: 1,
                is_split_start: false,
            }],
        }
    }

    #[test]
    fn encode_decode_roundtrip() {
        let original = output();
        let encoded = encode_analysis_artifact(&original).unwrap();
        assert!(!encoded.is_empty());

        let decoded = decode_analysis_artifact(&encoded).unwrap();
        assert_eq!(decoded.cycles.len(), 1);
        assert_eq!(decoded.cycles[0].cycle_type, "test");
        assert_eq!(decoded.all_steps.len(), 1);
    }

    #[test]
    fn invalid_zstd_is_rejected() {
        let err = decode_analysis_artifact(b"not-zstd")
            .unwrap_err()
            .to_string();
        assert!(err.contains("zstd decode"));
    }

    #[test]
    fn invalid_json_is_rejected() {
        let encoded = zstd::encode_all(b"{not json}".as_slice(), ZSTD_LEVEL).unwrap();
        let err = decode_analysis_artifact(&encoded).unwrap_err().to_string();
        assert!(err.contains("Serialization error"));
    }
}
