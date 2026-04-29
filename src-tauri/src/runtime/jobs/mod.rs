//! Lightweight job scheduler used by long-running desktop work.

mod metrics;
mod scheduler;
mod types;

pub use scheduler::{JobContext, JobScheduler};
pub use types::{
    JobCancelResponse, JobFinishedEvent, JobKind, JobMetricPatch, JobMetrics, JobProgress,
    JobProgressEvent, JobRecord, JobStatus,
};
