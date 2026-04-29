use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum JobKind {
    ComparisonPdf,
    ComparisonExcel,
    SinglePdf,
    SingleExcel,
    ImportDb,
    BackupRestore,
    AnalysisCachePrune,
    AnalysisCacheWarmup,
    ExperimentProjectionRebuild,
    ExperimentFacetRebuild,
    Maintenance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum JobStatus {
    Queued,
    Running,
    Cancelling,
    Cancelled,
    Succeeded,
    Failed,
}

impl JobStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            JobStatus::Cancelled | JobStatus::Succeeded | JobStatus::Failed
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub phase: String,
    pub current: u64,
    pub total: Option<u64>,
    pub message: Option<String>,
}

impl Default for JobProgress {
    fn default() -> Self {
        Self {
            phase: "queued".into(),
            current: 0,
            total: None,
            message: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct JobMetrics {
    pub queued_ms: u64,
    pub wall_ms: u64,
    pub cpu_ms_delta: Option<u64>,
    pub rss_mb_start: Option<f64>,
    pub rss_mb_peak: Option<f64>,
    pub rss_mb_end: Option<f64>,
    pub cache_hits: Option<u64>,
    pub cache_misses: Option<u64>,
    pub artifact_bytes_read: Option<u64>,
    pub artifact_bytes_written: Option<u64>,
    pub output_bytes: Option<u64>,
}

#[derive(Debug, Clone, Default)]
pub struct JobMetricPatch {
    pub cache_hits: u64,
    pub cache_misses: u64,
    pub artifact_bytes_read: u64,
    pub artifact_bytes_written: u64,
    pub output_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct JobRecord {
    pub id: String,
    pub kind: JobKind,
    pub status: JobStatus,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub progress: JobProgress,
    pub error: Option<String>,
    pub metrics: Option<JobMetrics>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct JobCancelResponse {
    pub job_id: String,
    pub status: JobStatus,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct JobProgressEvent {
    pub job_id: String,
    pub kind: JobKind,
    pub status: JobStatus,
    pub phase: String,
    pub current: u64,
    pub total: Option<u64>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct JobFinishedEvent {
    pub job_id: String,
    pub kind: JobKind,
    pub status: JobStatus,
    pub error: Option<String>,
    pub metrics: Option<JobMetrics>,
}
