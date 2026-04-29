//! Persistent analysis artifact cache.
//!
//! The cache sits above the pure analysis kernel. It owns stable key
//! construction and artifact encoding; SQLite persistence lives in
//! `db::repositories::analysis_artifacts`.

pub mod artifact_codec;
pub mod key;

pub use artifact_codec::{
    decode_analysis_artifact, encode_analysis_artifact, ANALYSIS_ARTIFACT_ENCODING,
    MAX_ANALYSIS_ARTIFACT_BYTES,
};
pub use key::{
    build_analysis_cache_key, hash_experiment_data_bytes, AnalysisCacheKey,
    ANALYSIS_CACHE_ALGORITHM_VERSION,
};
