#[derive(Debug, Clone, Copy, Default)]
pub struct ProcessSnapshot {
    pub rss_mb: Option<f64>,
    pub cpu_ms_total: Option<u64>,
}

pub fn process_snapshot() -> ProcessSnapshot {
    platform_process_snapshot()
}

#[cfg(target_os = "windows")]
fn platform_process_snapshot() -> ProcessSnapshot {
    windows_process_snapshot()
}

#[cfg(not(target_os = "windows"))]
fn platform_process_snapshot() -> ProcessSnapshot {
    ProcessSnapshot::default()
}

#[cfg(target_os = "windows")]
fn windows_process_snapshot() -> ProcessSnapshot {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};

    type Bool = i32;
    type Dword = u32;
    type Handle = *mut c_void;

    #[repr(C)]
    #[allow(non_snake_case)]
    struct FileTime {
        dwLowDateTime: Dword,
        dwHighDateTime: Dword,
    }

    #[repr(C)]
    #[allow(non_snake_case)]
    struct ProcessMemoryCounters {
        cb: Dword,
        PageFaultCount: Dword,
        PeakWorkingSetSize: usize,
        WorkingSetSize: usize,
        QuotaPeakPagedPoolUsage: usize,
        QuotaPagedPoolUsage: usize,
        QuotaPeakNonPagedPoolUsage: usize,
        QuotaNonPagedPoolUsage: usize,
        PagefileUsage: usize,
        PeakPagefileUsage: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcess() -> Handle;
        fn GetProcessTimes(
            hProcess: Handle,
            lpCreationTime: *mut FileTime,
            lpExitTime: *mut FileTime,
            lpKernelTime: *mut FileTime,
            lpUserTime: *mut FileTime,
        ) -> Bool;
    }

    #[link(name = "psapi")]
    extern "system" {
        fn GetProcessMemoryInfo(
            Process: Handle,
            ppsmemCounters: *mut ProcessMemoryCounters,
            cb: Dword,
        ) -> Bool;
    }

    fn filetime_to_100ns(file_time: FileTime) -> u64 {
        ((file_time.dwHighDateTime as u64) << 32) | file_time.dwLowDateTime as u64
    }

    unsafe {
        let process = GetCurrentProcess();

        let mut counters: ProcessMemoryCounters = zeroed();
        counters.cb = size_of::<ProcessMemoryCounters>() as Dword;
        let rss_mb = if GetProcessMemoryInfo(
            process,
            &mut counters,
            size_of::<ProcessMemoryCounters>() as Dword,
        ) != 0
        {
            Some(counters.WorkingSetSize as f64 / 1024.0 / 1024.0)
        } else {
            None
        };

        let mut creation_time: FileTime = zeroed();
        let mut exit_time: FileTime = zeroed();
        let mut kernel_time: FileTime = zeroed();
        let mut user_time: FileTime = zeroed();
        let cpu_ms_total = if GetProcessTimes(
            process,
            &mut creation_time,
            &mut exit_time,
            &mut kernel_time,
            &mut user_time,
        ) != 0
        {
            Some((filetime_to_100ns(kernel_time) + filetime_to_100ns(user_time)) / 10_000)
        } else {
            None
        };

        ProcessSnapshot {
            rss_mb,
            cpu_ms_total,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    #[test]
    fn process_snapshot_reports_windows_process_metrics() {
        let snapshot = process_snapshot();
        assert!(snapshot.rss_mb.unwrap_or_default() > 0.0);
        assert!(snapshot.cpu_ms_total.is_some());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn process_snapshot_is_empty_on_unsupported_platforms() {
        let snapshot = process_snapshot();
        assert!(snapshot.rss_mb.is_none());
        assert!(snapshot.cpu_ms_total.is_none());
    }
}
