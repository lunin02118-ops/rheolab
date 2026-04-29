#[derive(Debug, Clone, Copy, Default)]
pub struct ProcessSnapshot {
    pub rss_mb: Option<f64>,
    pub cpu_ms_total: Option<u64>,
}

pub fn process_snapshot() -> ProcessSnapshot {
    platform_process_snapshot()
}

fn platform_process_snapshot() -> ProcessSnapshot {
    ProcessSnapshot::default()
}
