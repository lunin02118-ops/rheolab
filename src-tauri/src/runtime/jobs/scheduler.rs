use super::metrics::process_snapshot;
use super::types::{
    JobCancelResponse, JobFinishedEvent, JobKind, JobMetricPatch, JobMetrics, JobProgress,
    JobProgressEvent, JobRecord, JobStatus,
};
use crate::error::{AppError, Result};
use crate::utils::time::now_rfc3339;
use chrono::{DateTime, Utc};
use std::cell::UnsafeCell;
use std::collections::HashMap;
use std::ops::{Deref, DerefMut};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;
#[cfg(not(test))]
use tauri::AppHandle;
#[cfg(not(test))]
use tauri::Emitter;

#[cfg(not(test))]
type JobEventTarget = AppHandle;

#[cfg(test)]
type JobEventTarget = ();

const JOB_EVENT_CREATED: &str = "job://created";
const JOB_EVENT_PROGRESS: &str = "job://progress";
const JOB_EVENT_FINISHED: &str = "job://finished";
const OUTPUT_BYTES_UNSET: u64 = u64::MAX;
const MAX_FINISHED_JOBS: usize = 100;
const FINISHED_JOB_TTL_SECONDS: i64 = 60 * 60;

#[derive(Debug)]
struct SpinMutex<T> {
    locked: AtomicBool,
    value: UnsafeCell<T>,
}

unsafe impl<T: Send> Send for SpinMutex<T> {}
unsafe impl<T: Send> Sync for SpinMutex<T> {}

impl<T> SpinMutex<T> {
    fn new(value: T) -> Self {
        Self {
            locked: AtomicBool::new(false),
            value: UnsafeCell::new(value),
        }
    }

    fn lock(&self) -> SpinMutexGuard<'_, T> {
        while self
            .locked
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .is_err()
        {
            std::hint::spin_loop();
        }
        SpinMutexGuard { lock: self }
    }
}

struct SpinMutexGuard<'a, T> {
    lock: &'a SpinMutex<T>,
}

impl<T> Deref for SpinMutexGuard<'_, T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        unsafe { &*self.lock.value.get() }
    }
}

impl<T> DerefMut for SpinMutexGuard<'_, T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        unsafe { &mut *self.lock.value.get() }
    }
}

impl<T> Drop for SpinMutexGuard<'_, T> {
    fn drop(&mut self) {
        self.lock.locked.store(false, Ordering::Release);
    }
}

#[derive(Debug)]
struct JobGate {
    active: AtomicBool,
}

impl JobGate {
    fn new() -> Self {
        Self {
            active: AtomicBool::new(false),
        }
    }

    fn try_acquire(self: &Arc<Self>) -> Option<JobGatePermit> {
        self.active
            .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .ok()
            .map(|_| JobGatePermit {
                gate: Arc::clone(self),
            })
    }
}

struct JobGatePermit {
    gate: Arc<JobGate>,
}

impl Drop for JobGatePermit {
    fn drop(&mut self) {
        self.gate.active.store(false, Ordering::Release);
    }
}

#[derive(Debug)]
struct CancellationState {
    cancelled: AtomicBool,
}

#[derive(Debug, Clone)]
struct JobCancellationToken {
    state: Arc<CancellationState>,
}

impl JobCancellationToken {
    fn new() -> Self {
        Self {
            state: Arc::new(CancellationState {
                cancelled: AtomicBool::new(false),
            }),
        }
    }

    fn cancel(&self) {
        self.state.cancelled.store(true, Ordering::SeqCst);
    }

    fn is_cancelled(&self) -> bool {
        self.state.cancelled.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Default)]
struct JobMetricState {
    cache_hits: AtomicU64,
    cache_misses: AtomicU64,
    artifact_bytes_read: AtomicU64,
    artifact_bytes_written: AtomicU64,
    output_bytes: AtomicU64,
}

impl JobMetricState {
    fn snapshot(&self) -> JobMetricPatch {
        let output_bytes = self.output_bytes.load(Ordering::SeqCst);
        JobMetricPatch {
            cache_hits: self.cache_hits.load(Ordering::SeqCst),
            cache_misses: self.cache_misses.load(Ordering::SeqCst),
            artifact_bytes_read: self.artifact_bytes_read.load(Ordering::SeqCst),
            artifact_bytes_written: self.artifact_bytes_written.load(Ordering::SeqCst),
            output_bytes: (output_bytes != OUTPUT_BYTES_UNSET).then_some(output_bytes),
        }
    }
}

#[derive(Debug)]
pub struct JobScheduler {
    registry: SpinMutex<HashMap<String, JobRecord>>,
    cancellation: SpinMutex<HashMap<String, JobCancellationToken>>,
    comparison_reports: Arc<JobGate>,
    imports: Arc<JobGate>,
    maintenance: Arc<JobGate>,
}

impl Default for JobScheduler {
    fn default() -> Self {
        Self::new()
    }
}

impl JobScheduler {
    pub fn new() -> Self {
        Self {
            registry: SpinMutex::new(HashMap::new()),
            cancellation: SpinMutex::new(HashMap::new()),
            comparison_reports: Arc::new(JobGate::new()),
            imports: Arc::new(JobGate::new()),
            maintenance: Arc::new(JobGate::new()),
        }
    }

    pub fn list(&self) -> Vec<JobRecord> {
        self.prune_finished_jobs();
        let mut records = self.registry.lock().values().cloned().collect::<Vec<_>>();
        records.sort_by(|a, b| b.created_at.cmp(&a.created_at).then(a.id.cmp(&b.id)));
        records
    }

    pub fn get(&self, job_id: &str) -> Result<JobRecord> {
        self.registry
            .lock()
            .get(job_id)
            .cloned()
            .ok_or_else(|| AppError::BadRequest(format!("Unknown job id: {job_id}")))
    }

    pub fn cancel(
        &self,
        app_handle: Option<JobEventTarget>,
        job_id: &str,
    ) -> Result<JobCancelResponse> {
        let (status, progress_record) = {
            let mut registry = self.registry.lock();
            let record = registry
                .get_mut(job_id)
                .ok_or_else(|| AppError::BadRequest(format!("Unknown job id: {job_id}")))?;

            if record.status.is_terminal() {
                return Ok(JobCancelResponse {
                    job_id: job_id.to_owned(),
                    status: record.status,
                    cancelled: false,
                });
            }

            record.status = JobStatus::Cancelling;
            record.progress.phase = "cancelling".into();
            record.progress.message = Some("Cancellation requested".into());
            (record.status, record.clone())
        };
        emit_progress(&app_handle, &progress_record);

        if let Some(token) = self.cancellation.lock().get(job_id).cloned() {
            token.cancel();
        }

        Ok(JobCancelResponse {
            job_id: job_id.to_owned(),
            status,
            cancelled: true,
        })
    }

    pub async fn run_blocking<T, F>(
        self: &Arc<Self>,
        app_handle: Option<JobEventTarget>,
        kind: JobKind,
        work: F,
    ) -> Result<T>
    where
        T: Send + 'static,
        F: FnOnce(JobContext) -> Result<T> + Send + 'static,
    {
        let job_id = uuid::Uuid::new_v4().to_string();
        let token = JobCancellationToken::new();
        let metrics_state = Arc::new(JobMetricState {
            output_bytes: AtomicU64::new(OUTPUT_BYTES_UNSET),
            ..JobMetricState::default()
        });

        let record = JobRecord {
            id: job_id.clone(),
            kind,
            status: JobStatus::Queued,
            created_at: now_rfc3339(),
            started_at: None,
            finished_at: None,
            progress: JobProgress::default(),
            error: None,
            metrics: None,
        };
        self.registry.lock().insert(job_id.clone(), record.clone());
        self.cancellation
            .lock()
            .insert(job_id.clone(), token.clone());
        emit_created(&app_handle, &record);

        let scheduler = Arc::clone(self);
        let outer_app_handle = app_handle.clone();
        let outer_job_id = job_id.clone();
        let join_result = tokio::task::spawn_blocking(move || {
            let queue_started = Instant::now();
            let limit = scheduler.limit_for(kind);
            let permit = loop {
                if token.is_cancelled() {
                    scheduler.finish_cancelled(
                        &app_handle,
                        &job_id,
                        0,
                        0,
                        metrics_state.snapshot(),
                    );
                    return Err(AppError::Other("Job cancelled".into()));
                }
                if let Some(permit) = limit.try_acquire() {
                    break permit;
                }
                // Avoid tokio::time here: it links Windows waitable-timer APIs
                // that are unavailable in some supported test environments.
                std::thread::sleep(std::time::Duration::from_millis(25));
            };
            let queued_ms = queue_started.elapsed().as_millis() as u64;

            if token.is_cancelled() {
                drop(permit);
                scheduler.finish_cancelled(
                    &app_handle,
                    &job_id,
                    queued_ms,
                    0,
                    metrics_state.snapshot(),
                );
                return Err(AppError::Other("Job cancelled".into()));
            }

            scheduler.mark_running(&app_handle, &job_id);
            let wall_started = Instant::now();
            let start_snapshot = process_snapshot();

            let ctx = JobContext {
                id: job_id.clone(),
                kind,
                scheduler: Arc::clone(&scheduler),
                app_handle: app_handle.clone(),
                cancellation: token.clone(),
                metrics_state: Arc::clone(&metrics_state),
            };

            let work_result = work(ctx);
            drop(permit);

            let wall_ms = wall_started.elapsed().as_millis() as u64;
            let end_snapshot = process_snapshot();
            let rss_mb_peak = max_optional_f64(start_snapshot.rss_mb, end_snapshot.rss_mb);

            match work_result {
                Ok(output) => {
                    let metrics = build_metrics(
                        queued_ms,
                        wall_ms,
                        start_snapshot.rss_mb,
                        rss_mb_peak,
                        end_snapshot.rss_mb,
                        start_snapshot.cpu_ms_total,
                        end_snapshot.cpu_ms_total,
                        metrics_state.snapshot(),
                    );
                    scheduler.finish_succeeded(&app_handle, &job_id, metrics);
                    Ok(output)
                }
                Err(error) => {
                    if token.is_cancelled() {
                        scheduler.finish_cancelled(
                            &app_handle,
                            &job_id,
                            queued_ms,
                            wall_ms,
                            metrics_state.snapshot(),
                        );
                        Err(AppError::Other("Job cancelled".into()))
                    } else {
                        let message = error.to_string();
                        let metrics = build_metrics(
                            queued_ms,
                            wall_ms,
                            start_snapshot.rss_mb,
                            rss_mb_peak,
                            end_snapshot.rss_mb,
                            start_snapshot.cpu_ms_total,
                            end_snapshot.cpu_ms_total,
                            metrics_state.snapshot(),
                        );
                        scheduler.finish_failed(&app_handle, &job_id, message, metrics);
                        Err(error)
                    }
                }
            }
        })
        .await;

        match join_result {
            Ok(result) => result,
            Err(error) => {
                let message = format!("Job task join error: {error}");
                let metrics = build_metrics(
                    0,
                    0,
                    None,
                    None,
                    None,
                    None,
                    None,
                    JobMetricPatch::default(),
                );
                self.finish_failed(&outer_app_handle, &outer_job_id, message, metrics);
                Err(AppError::Join(error))
            }
        }
    }

    fn limit_for(&self, kind: JobKind) -> Arc<JobGate> {
        match kind {
            JobKind::ComparisonPdf | JobKind::ComparisonExcel => {
                Arc::clone(&self.comparison_reports)
            }
            JobKind::ImportDb | JobKind::BackupRestore => Arc::clone(&self.imports),
            JobKind::AnalysisCachePrune
            | JobKind::AnalysisCacheWarmup
            | JobKind::ExperimentProjectionRebuild
            | JobKind::ExperimentFacetRebuild
            | JobKind::Maintenance => Arc::clone(&self.maintenance),
            JobKind::SinglePdf | JobKind::SingleExcel => Arc::clone(&self.comparison_reports),
        }
    }

    fn mark_running(&self, app_handle: &Option<JobEventTarget>, job_id: &str) {
        let record = {
            let mut registry = self.registry.lock();
            let Some(record) = registry.get_mut(job_id) else {
                return;
            };
            record.status = JobStatus::Running;
            record.started_at = Some(now_rfc3339());
            record.progress.phase = "running".into();
            record.clone()
        };
        emit_progress(app_handle, &record);
    }

    fn update_progress(
        &self,
        app_handle: &Option<JobEventTarget>,
        job_id: &str,
        progress: JobProgress,
    ) {
        let record = {
            let mut registry = self.registry.lock();
            let Some(record) = registry.get_mut(job_id) else {
                return;
            };
            record.progress = progress;
            record.clone()
        };
        emit_progress(app_handle, &record);
    }

    fn finish_succeeded(
        &self,
        app_handle: &Option<JobEventTarget>,
        job_id: &str,
        metrics: JobMetrics,
    ) {
        let record = {
            let mut registry = self.registry.lock();
            let Some(record) = registry.get_mut(job_id) else {
                return;
            };
            record.status = JobStatus::Succeeded;
            record.finished_at = Some(now_rfc3339());
            record.progress.phase = "done".into();
            record.progress.current = record.progress.total.unwrap_or(record.progress.current);
            record.error = None;
            record.metrics = Some(metrics);
            record.clone()
        };
        self.remove_cancellation(job_id);
        emit_finished(app_handle, &record);
        self.prune_finished_jobs();
    }

    fn finish_cancelled(
        &self,
        app_handle: &Option<JobEventTarget>,
        job_id: &str,
        queued_ms: u64,
        wall_ms: u64,
        patch: JobMetricPatch,
    ) {
        let metrics = build_metrics(queued_ms, wall_ms, None, None, None, None, None, patch);
        let record = {
            let mut registry = self.registry.lock();
            let Some(record) = registry.get_mut(job_id) else {
                return;
            };
            record.status = JobStatus::Cancelled;
            record.finished_at = Some(now_rfc3339());
            record.progress.phase = "cancelled".into();
            record.error = Some("Job cancelled".into());
            record.metrics = Some(metrics);
            record.clone()
        };
        self.remove_cancellation(job_id);
        emit_finished(app_handle, &record);
        self.prune_finished_jobs();
    }

    fn finish_failed(
        &self,
        app_handle: &Option<JobEventTarget>,
        job_id: &str,
        error: String,
        metrics: JobMetrics,
    ) {
        let record = {
            let mut registry = self.registry.lock();
            let Some(record) = registry.get_mut(job_id) else {
                return;
            };
            record.status = JobStatus::Failed;
            record.finished_at = Some(now_rfc3339());
            record.error = Some(error);
            record.metrics = Some(metrics);
            record.clone()
        };
        self.remove_cancellation(job_id);
        emit_finished(app_handle, &record);
        self.prune_finished_jobs();
    }

    fn remove_cancellation(&self, job_id: &str) {
        self.cancellation.lock().remove(job_id);
    }

    fn prune_finished_jobs(&self) {
        let pruned_ids = {
            let mut registry = self.registry.lock();
            prune_finished_records(&mut registry)
        };

        if pruned_ids.is_empty() {
            return;
        }

        let mut cancellation = self.cancellation.lock();
        for job_id in pruned_ids {
            cancellation.remove(&job_id);
        }
    }
}

#[derive(Clone)]
pub struct JobContext {
    id: String,
    kind: JobKind,
    scheduler: Arc<JobScheduler>,
    app_handle: Option<JobEventTarget>,
    cancellation: JobCancellationToken,
    metrics_state: Arc<JobMetricState>,
}

impl JobContext {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn kind(&self) -> JobKind {
        self.kind
    }

    pub fn progress(
        &self,
        phase: impl Into<String>,
        current: u64,
        total: Option<u64>,
        message: Option<String>,
    ) {
        let scheduler = Arc::clone(&self.scheduler);
        let app_handle = self.app_handle.clone();
        let job_id = self.id.clone();
        let progress = JobProgress {
            phase: phase.into(),
            current,
            total,
            message,
        };
        scheduler.update_progress(&app_handle, &job_id, progress);
    }

    pub fn ensure_not_cancelled(&self) -> Result<()> {
        if self.cancellation.is_cancelled() {
            Err(AppError::Other("Job cancelled".into()))
        } else {
            Ok(())
        }
    }

    pub fn record_cache_stats(
        &self,
        hits: u64,
        misses: u64,
        artifact_bytes_read: u64,
        artifact_bytes_written: u64,
    ) {
        self.metrics_state
            .cache_hits
            .fetch_add(hits, Ordering::SeqCst);
        self.metrics_state
            .cache_misses
            .fetch_add(misses, Ordering::SeqCst);
        self.metrics_state
            .artifact_bytes_read
            .fetch_add(artifact_bytes_read, Ordering::SeqCst);
        self.metrics_state
            .artifact_bytes_written
            .fetch_add(artifact_bytes_written, Ordering::SeqCst);
    }

    pub fn record_output_bytes(&self, output_bytes: u64) {
        self.metrics_state
            .output_bytes
            .store(output_bytes, Ordering::SeqCst);
    }
}

fn build_metrics(
    queued_ms: u64,
    wall_ms: u64,
    rss_mb_start: Option<f64>,
    rss_mb_peak: Option<f64>,
    rss_mb_end: Option<f64>,
    cpu_ms_start: Option<u64>,
    cpu_ms_end: Option<u64>,
    patch: JobMetricPatch,
) -> JobMetrics {
    JobMetrics {
        queued_ms,
        wall_ms,
        cpu_ms_delta: cpu_ms_start
            .zip(cpu_ms_end)
            .map(|(start, end)| end.saturating_sub(start)),
        rss_mb_start,
        rss_mb_peak,
        rss_mb_end,
        cache_hits: some_nonzero(patch.cache_hits),
        cache_misses: some_nonzero(patch.cache_misses),
        artifact_bytes_read: some_nonzero(patch.artifact_bytes_read),
        artifact_bytes_written: some_nonzero(patch.artifact_bytes_written),
        output_bytes: patch.output_bytes,
    }
}

fn some_nonzero(value: u64) -> Option<u64> {
    if value == 0 {
        None
    } else {
        Some(value)
    }
}

fn max_optional_f64(left: Option<f64>, right: Option<f64>) -> Option<f64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

fn prune_finished_records(registry: &mut HashMap<String, JobRecord>) -> Vec<String> {
    let mut pruned_ids = Vec::new();
    let now = Utc::now();

    let expired_ids = registry
        .iter()
        .filter_map(|(job_id, record)| {
            is_finished_record_expired(record, now).then(|| job_id.clone())
        })
        .collect::<Vec<_>>();

    for job_id in expired_ids {
        if registry.remove(&job_id).is_some() {
            pruned_ids.push(job_id);
        }
    }

    let mut terminal_records = registry
        .iter()
        .filter(|(_, record)| record.status.is_terminal())
        .map(|(job_id, record)| (job_id.clone(), terminal_sort_key(record)))
        .collect::<Vec<_>>();

    if terminal_records.len() <= MAX_FINISHED_JOBS {
        return pruned_ids;
    }

    terminal_records.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    for (job_id, _) in terminal_records.into_iter().skip(MAX_FINISHED_JOBS) {
        if registry.remove(&job_id).is_some() {
            pruned_ids.push(job_id);
        }
    }

    pruned_ids
}

fn terminal_sort_key(record: &JobRecord) -> String {
    record
        .finished_at
        .as_deref()
        .unwrap_or(&record.created_at)
        .to_owned()
}

fn is_finished_record_expired(record: &JobRecord, now: DateTime<Utc>) -> bool {
    if !record.status.is_terminal() {
        return false;
    }

    let Some(finished_at) = record.finished_at.as_deref() else {
        return false;
    };

    let Ok(finished_at) = DateTime::parse_from_rfc3339(finished_at) else {
        return false;
    };

    now.signed_duration_since(finished_at.with_timezone(&Utc))
        .num_seconds()
        > FINISHED_JOB_TTL_SECONDS
}

fn emit_created(app_handle: &Option<JobEventTarget>, record: &JobRecord) {
    if let Err(error) = emit_app_event(app_handle, JOB_EVENT_CREATED, record) {
        tracing::warn!(job_id = %record.id, error = %error, "failed to emit job created event");
    }
}

fn emit_progress(app_handle: &Option<JobEventTarget>, record: &JobRecord) {
    let event = JobProgressEvent {
        job_id: record.id.clone(),
        kind: record.kind,
        status: record.status,
        phase: record.progress.phase.clone(),
        current: record.progress.current,
        total: record.progress.total,
        message: record.progress.message.clone(),
    };
    if let Err(error) = emit_app_event(app_handle, JOB_EVENT_PROGRESS, &event) {
        tracing::warn!(job_id = %record.id, error = %error, "failed to emit job progress event");
    }
}

fn emit_finished(app_handle: &Option<JobEventTarget>, record: &JobRecord) {
    let event = JobFinishedEvent {
        job_id: record.id.clone(),
        kind: record.kind,
        status: record.status,
        error: record.error.clone(),
        metrics: record.metrics.clone(),
    };
    if let Err(error) = emit_app_event(app_handle, JOB_EVENT_FINISHED, &event) {
        tracing::warn!(job_id = %record.id, error = %error, "failed to emit job finished event");
    }
}

#[cfg(not(test))]
fn emit_app_event<S: serde::Serialize + Clone>(
    app_handle: &Option<JobEventTarget>,
    event: &str,
    payload: &S,
) -> std::result::Result<(), tauri::Error> {
    if let Some(app_handle) = app_handle {
        app_handle.emit(event, payload)?;
    }
    Ok(())
}

#[cfg(test)]
fn emit_app_event<S: serde::Serialize + Clone>(
    _app_handle: &Option<JobEventTarget>,
    _event: &str,
    _payload: &S,
) -> std::result::Result<(), tauri::Error> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    #[tokio::test]
    async fn run_blocking_records_success_metrics() {
        let scheduler = Arc::new(JobScheduler::new());
        let output = scheduler
            .run_blocking(None, JobKind::Maintenance, |ctx| {
                ctx.progress("work", 1, Some(1), None);
                ctx.record_output_bytes(42);
                Ok::<_, AppError>("done")
            })
            .await
            .unwrap();

        assert_eq!(output, "done");
        let records = scheduler.list();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].status, JobStatus::Succeeded);
        assert_eq!(records[0].metrics.as_ref().unwrap().output_bytes, Some(42));
    }

    #[tokio::test]
    async fn comparison_jobs_are_serialized() {
        let scheduler = Arc::new(JobScheduler::new());
        let current = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));

        let first = {
            let scheduler = Arc::clone(&scheduler);
            let current = Arc::clone(&current);
            let peak = Arc::clone(&peak);
            tokio::spawn(async move {
                scheduler
                    .run_blocking(None, JobKind::ComparisonPdf, move |_ctx| {
                        let now = current.fetch_add(1, Ordering::SeqCst) + 1;
                        peak.fetch_max(now, Ordering::SeqCst);
                        std::thread::sleep(Duration::from_millis(120));
                        current.fetch_sub(1, Ordering::SeqCst);
                        Ok::<_, AppError>(())
                    })
                    .await
            })
        };

        let second = {
            let scheduler = Arc::clone(&scheduler);
            let current = Arc::clone(&current);
            let peak = Arc::clone(&peak);
            tokio::spawn(async move {
                scheduler
                    .run_blocking(None, JobKind::ComparisonExcel, move |_ctx| {
                        let now = current.fetch_add(1, Ordering::SeqCst) + 1;
                        peak.fetch_max(now, Ordering::SeqCst);
                        std::thread::sleep(Duration::from_millis(120));
                        current.fetch_sub(1, Ordering::SeqCst);
                        Ok::<_, AppError>(())
                    })
                    .await
            })
        };

        first.await.unwrap().unwrap();
        second.await.unwrap().unwrap();
        assert_eq!(peak.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn queued_job_can_be_cancelled() {
        let scheduler = Arc::new(JobScheduler::new());
        let first_started = Arc::new(AtomicBool::new(false));

        let first = {
            let scheduler = Arc::clone(&scheduler);
            let first_started = Arc::clone(&first_started);
            tokio::spawn(async move {
                scheduler
                    .run_blocking(None, JobKind::ComparisonPdf, move |_ctx| {
                        first_started.store(true, Ordering::SeqCst);
                        std::thread::sleep(Duration::from_millis(250));
                        Ok::<_, AppError>(())
                    })
                    .await
            })
        };

        while !first_started.load(Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }

        let second_started = Arc::new(AtomicBool::new(false));
        let second = {
            let scheduler = Arc::clone(&scheduler);
            let second_started = Arc::clone(&second_started);
            tokio::spawn(async move {
                scheduler
                    .run_blocking(None, JobKind::ComparisonPdf, move |_ctx| {
                        second_started.store(true, Ordering::SeqCst);
                        Ok::<_, AppError>(())
                    })
                    .await
            })
        };

        let queued_id = loop {
            if let Some(record) = scheduler
                .list()
                .into_iter()
                .find(|record| record.status == JobStatus::Queued)
            {
                break record.id;
            }
            tokio::task::yield_now().await;
        };

        let response = scheduler.cancel(None, &queued_id).unwrap();
        assert!(response.cancelled);

        first.await.unwrap().unwrap();
        let second_result = second.await.unwrap();
        assert!(second_result.is_err());
        assert!(!second_started.load(Ordering::SeqCst));
        assert_eq!(
            scheduler.get(&queued_id).unwrap().status,
            JobStatus::Cancelled
        );
    }

    #[tokio::test]
    async fn completed_jobs_are_pruned_by_retention_limit() {
        let scheduler = Arc::new(JobScheduler::new());

        for _ in 0..(MAX_FINISHED_JOBS + 5) {
            scheduler
                .run_blocking(None, JobKind::Maintenance, |_ctx| Ok::<_, AppError>(()))
                .await
                .unwrap();
        }

        let records = scheduler.list();
        assert_eq!(records.len(), MAX_FINISHED_JOBS);
        assert!(records
            .iter()
            .all(|record| record.status == JobStatus::Succeeded));
    }

    #[test]
    fn retention_keeps_active_jobs_and_prunes_expired_terminal_jobs() {
        let scheduler = JobScheduler::new();
        let fresh_finished_at = Utc::now().to_rfc3339();
        let old_finished_at =
            (Utc::now() - chrono::Duration::seconds(FINISHED_JOB_TTL_SECONDS + 5)).to_rfc3339();

        {
            let mut registry = scheduler.registry.lock();
            registry.insert(
                "fresh".into(),
                test_record("fresh", JobStatus::Succeeded, Some(fresh_finished_at)),
            );
            registry.insert(
                "old".into(),
                test_record("old", JobStatus::Succeeded, Some(old_finished_at.clone())),
            );
            registry.insert(
                "running".into(),
                test_record("running", JobStatus::Running, Some(old_finished_at)),
            );
        }

        let records = scheduler.list();
        assert!(records.iter().any(|record| record.id == "fresh"));
        assert!(records.iter().any(|record| record.id == "running"));
        assert!(!records.iter().any(|record| record.id == "old"));
    }

    fn test_record(id: &str, status: JobStatus, finished_at: Option<String>) -> JobRecord {
        JobRecord {
            id: id.into(),
            kind: JobKind::Maintenance,
            status,
            created_at: Utc::now().to_rfc3339(),
            started_at: None,
            finished_at,
            progress: JobProgress::default(),
            error: None,
            metrics: None,
        }
    }
}
