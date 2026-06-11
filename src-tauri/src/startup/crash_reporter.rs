//! Crash report writer for Rust panics.
//!
//! The panic hook is intentionally tiny and best-effort: it writes a local
//! crash report, prunes old reports, then delegates to the previous hook so
//! the normal stderr behavior stays intact.

use std::backtrace::Backtrace;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

const REPORT_KEEP_COUNT: usize = 5;

/// Write a crash report and return the created file path.
///
/// The report intentionally contains only application/build metadata,
/// panic text, and the supplied backtrace. It does not read command-line
/// arguments, environment variables, or user file paths.
pub fn write_crash_report(
    dir: &Path,
    message: &str,
    backtrace: &str,
) -> std::io::Result<PathBuf> {
    fs::create_dir_all(dir)?;

    let timestamp = chrono::Utc::now();
    let file_name = format!("crash-{}.log", timestamp.format("%Y%m%d-%H%M%S"));
    let path = dir.join(file_name);
    let mut file = File::create(&path)?;

    writeln!(file, "RheoLab Enterprise crash report")?;
    writeln!(file, "version: {}", env!("CARGO_PKG_VERSION"))?;
    writeln!(file, "os: {}", std::env::consts::OS)?;
    writeln!(file, "timestamp_utc: {}", timestamp.to_rfc3339())?;
    writeln!(file)?;
    writeln!(file, "panic:")?;
    writeln!(file, "{message}")?;
    writeln!(file)?;
    writeln!(file, "backtrace:")?;
    writeln!(file, "{backtrace}")?;

    // Release builds use panic=abort; flush explicitly before the process
    // terminates instead of relying on Drop to reach the OS.
    let _ = file.sync_all();

    Ok(path)
}

/// Keep the newest `keep` crash reports and delete older ones best-effort.
pub fn prune_old_reports(dir: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    let mut reports: Vec<_> = entries
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().map(|ft| ft.is_file()).unwrap_or(false))
        .filter(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            name.starts_with("crash-") && name.ends_with(".log")
        })
        .collect();

    reports.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    for old in reports.iter().skip(keep) {
        let _ = fs::remove_file(old.path());
    }
}

/// Install a global panic hook that writes rotated crash reports.
pub fn install_panic_hook(dir: PathBuf) {
    let previous_hook = std::panic::take_hook();

    std::panic::set_hook(Box::new(move |panic_info| {
        let payload = panic_info
            .payload()
            .downcast_ref::<&str>()
            .map(|value| (*value).to_string())
            .or_else(|| panic_info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "<non-string panic>".to_string());
        let location = panic_info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "<unknown>".to_string());
        let message = format!("{payload}\nlocation: {location}");
        let backtrace = Backtrace::force_capture().to_string();

        let _ = write_crash_report(&dir, &message, &backtrace);
        prune_old_reports(&dir, REPORT_KEEP_COUNT);

        previous_hook(panic_info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_crash_report_creates_file_with_version_and_message() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let path = write_crash_report(tmp.path(), "crash reporter test", "fake backtrace")
            .expect("crash report");

        assert!(path.exists());
        let content = fs::read_to_string(path).expect("report content");
        assert!(content.contains(env!("CARGO_PKG_VERSION")));
        assert!(content.contains("crash reporter test"));
    }

    #[test]
    fn prune_old_reports_keeps_newest_reports_by_name() {
        let tmp = tempfile::tempdir().expect("tempdir");

        for index in 1..=7 {
            fs::write(
                tmp.path().join(format!("crash-20260101-12000{index}.log")),
                "old",
            )
            .expect("write report");
        }

        prune_old_reports(tmp.path(), 5);

        let mut remaining: Vec<_> = fs::read_dir(tmp.path())
            .expect("read dir")
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        remaining.sort();

        assert_eq!(remaining.len(), 5);
        assert_eq!(remaining.first().map(String::as_str), Some("crash-20260101-120003.log"));
        assert_eq!(remaining.last().map(String::as_str), Some("crash-20260101-120007.log"));
    }

    #[test]
    fn write_crash_report_does_not_include_username_env_value() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let username = "rheolab-crash-user";
        std::env::set_var("USERNAME", username);

        let path = write_crash_report(tmp.path(), "sanitization test", "fake backtrace")
            .expect("crash report");
        let content = fs::read_to_string(path).expect("report content");

        assert!(!content.contains(username));
    }
}
