//! Hardware component collectors — PowerShell invocations that pull CPU /
//! motherboard / BIOS serial-style identifiers from WMI, plus the bogus-value
//! filter that normalises OEM placeholders.

#[cfg(target_os = "windows")]
use super::super::types::POWERSHELL_PATH;

/// Values commonly returned when the hardware doesn't expose a real identifier.
const BOGUS_PATTERNS: &[&str] = &[
    "to be filled by o.e.m.",
    "default string",
    "none",
    "no asset tag",
    "not available",
    "not specified",
    "system serial number",
    "chassis serial number",
    "0123456789abcdef",
    "123456789",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "03000200-0400-0500-0006-000700080009", // VMware default
    "0000000000000000", // Some CPUs return all-zero ProcessorId
];

/// Create a `Command` that won't flash a console window on Windows.
#[cfg(target_os = "windows")]
pub(super) fn hidden_command(program: &str) -> std::process::Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut cmd = std::process::Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Returns `None` if the value is empty, too short, or matches a known bogus pattern.
pub(crate) fn sanitize(raw: &str) -> Option<String> {
    let v = raw.trim().to_lowercase();
    if v.len() < 4 {
        return None;
    }
    if BOGUS_PATTERNS.iter().any(|p| v == *p) {
        return None;
    }
    // All-zeros or all-F's (any length)
    if v.chars().all(|c| c == '0') || v.chars().all(|c| c == 'f') {
        return None;
    }
    Some(v)
}

// ── Hardware queries (v2 — no disks) ───────────────────────────────────

/// CPU `ProcessorId` from `Win32_Processor` (CPUID instruction result).
///
/// This is a 16-hex-char identifier burned into the CPU silicon.
/// It does NOT change on OS reinstall, BIOS update, or disk replacement.
/// Available on all Windows versions (10, 11, Server 2019+).
pub(super) fn get_cpu_id() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = hidden_command(POWERSHELL_PATH)
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty ProcessorId",
            ])
            .output()
        {
            if output.status.success() {
                if let Some(v) = sanitize(&String::from_utf8_lossy(&output.stdout)) {
                    return v;
                }
            }
        }
    }
    String::new()
}

/// Motherboard UUID from `Win32_ComputerSystemProduct` (SMBIOS type-1).
pub(super) fn get_motherboard_uuid() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = hidden_command(POWERSHELL_PATH)
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_ComputerSystemProduct | Select-Object -ExpandProperty UUID",
            ])
            .output()
        {
            if output.status.success() {
                if let Some(v) = sanitize(&String::from_utf8_lossy(&output.stdout)) {
                    return v;
                }
            }
        }
    }
    String::new()
}

/// BIOS serial from `Win32_BIOS` (SMBIOS type-0).
pub(super) fn get_bios_serial() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = hidden_command(POWERSHELL_PATH)
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_BIOS | Select-Object -ExpandProperty SerialNumber",
            ])
            .output()
        {
            if output.status.success() {
                if let Some(v) = sanitize(&String::from_utf8_lossy(&output.stdout)) {
                    return v;
                }
            }
        }
    }
    String::new()
}

// ── Legacy v1 raw getters (no sanitization — preserves v1 quirks) ──────

pub(super) fn get_first_disk_serial_raw() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = hidden_command(POWERSHELL_PATH)
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_DiskDrive | Select-Object -ExpandProperty SerialNumber | Select-Object -First 1",
            ])
            .output()
        {
            if output.status.success() {
                let r = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !r.is_empty() {
                    return r;
                }
            }
        }
    }
    String::new()
}

pub(super) fn get_motherboard_uuid_raw() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = hidden_command(POWERSHELL_PATH)
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_ComputerSystemProduct | Select-Object -ExpandProperty UUID",
            ])
            .output()
        {
            if output.status.success() {
                let r = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !r.is_empty() {
                    return r;
                }
            }
        }
    }
    String::new()
}

pub(super) fn get_bios_serial_raw() -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = hidden_command(POWERSHELL_PATH)
            .args([
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_BIOS | Select-Object -ExpandProperty SerialNumber",
            ])
            .output()
        {
            if output.status.success() {
                let r = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !r.is_empty() {
                    return r;
                }
            }
        }
    }
    String::new()
}
