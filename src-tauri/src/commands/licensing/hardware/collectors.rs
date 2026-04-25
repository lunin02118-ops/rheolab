//! Hardware component collectors — PowerShell invocations that pull CPU /
//! motherboard / BIOS serial-style identifiers from WMI, plus the bogus-value
//! filter that normalises OEM placeholders.

#[cfg(target_os = "windows")]
use super::super::types::POWERSHELL_PATH;
use std::sync::OnceLock;

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
    "0000000000000000",                     // Some CPUs return all-zero ProcessorId
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

#[derive(Clone, Default)]
struct HardwareSnapshot {
    cpu_raw: String,
    motherboard_raw: String,
    bios_raw: String,
}

#[derive(serde::Deserialize)]
struct HardwareSnapshotPayload {
    #[serde(default)]
    cpu: String,
    #[serde(default)]
    mobo: String,
    #[serde(default)]
    bios: String,
}

static HARDWARE_SNAPSHOT_CACHE: OnceLock<HardwareSnapshot> = OnceLock::new();

fn query_value(command: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = hidden_command(POWERSHELL_PATH)
            .args(["-NoProfile", "-Command", command])
            .output()
        {
            if output.status.success() {
                let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !value.is_empty() {
                    return value;
                }
            }
        }
    }
    String::new()
}

fn collect_snapshot_fallback() -> HardwareSnapshot {
    HardwareSnapshot {
        cpu_raw: query_value(
            "Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty ProcessorId",
        ),
        motherboard_raw: query_value(
            "Get-CimInstance Win32_ComputerSystemProduct | Select-Object -ExpandProperty UUID",
        ),
        bios_raw: query_value(
            "Get-CimInstance Win32_BIOS | Select-Object -ExpandProperty SerialNumber",
        ),
    }
}

fn collect_snapshot() -> HardwareSnapshot {
    #[cfg(target_os = "windows")]
    {
        let script = concat!(
            "$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 -ExpandProperty ProcessorId; ",
            "$mobo = Get-CimInstance Win32_ComputerSystemProduct | Select-Object -ExpandProperty UUID; ",
            "$bios = Get-CimInstance Win32_BIOS | Select-Object -ExpandProperty SerialNumber; ",
            "[pscustomobject]@{ cpu = $cpu; mobo = $mobo; bios = $bios } | ConvertTo-Json -Compress"
        );

        if let Ok(output) = hidden_command(POWERSHELL_PATH)
            .args(["-NoProfile", "-Command", script])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Ok(payload) = serde_json::from_str::<HardwareSnapshotPayload>(&stdout) {
                    let snapshot = HardwareSnapshot {
                        cpu_raw: payload.cpu.trim().to_string(),
                        motherboard_raw: payload.mobo.trim().to_string(),
                        bios_raw: payload.bios.trim().to_string(),
                    };
                    if !snapshot.cpu_raw.is_empty()
                        || !snapshot.motherboard_raw.is_empty()
                        || !snapshot.bios_raw.is_empty()
                    {
                        return snapshot;
                    }
                }
            }
        }
    }

    collect_snapshot_fallback()
}

fn hardware_snapshot() -> &'static HardwareSnapshot {
    HARDWARE_SNAPSHOT_CACHE.get_or_init(collect_snapshot)
}

// ── Hardware queries (v2 — no disks) ───────────────────────────────────

/// CPU `ProcessorId` from `Win32_Processor` (CPUID instruction result).
///
/// This is a 16-hex-char identifier burned into the CPU silicon.
/// It does NOT change on OS reinstall, BIOS update, or disk replacement.
/// Available on all Windows versions (10, 11, Server 2019+).
pub(super) fn get_cpu_id() -> String {
    sanitize(&hardware_snapshot().cpu_raw).unwrap_or_default()
}

/// Motherboard UUID from `Win32_ComputerSystemProduct` (SMBIOS type-1).
pub(super) fn get_motherboard_uuid() -> String {
    sanitize(&hardware_snapshot().motherboard_raw).unwrap_or_default()
}

/// BIOS serial from `Win32_BIOS` (SMBIOS type-0).
pub(super) fn get_bios_serial() -> String {
    sanitize(&hardware_snapshot().bios_raw).unwrap_or_default()
}

// ── Debug wrappers (same functions, pub within the licensing module) ──
//
// These exist so `hardware::debug_fingerprint_info` can surface raw
// components to the UI without widening visibility on the `pub(super)`
// collectors themselves.

pub(in super::super) fn get_cpu_id_pub() -> String {
    get_cpu_id()
}

pub(in super::super) fn get_motherboard_uuid_pub() -> String {
    get_motherboard_uuid()
}

pub(in super::super) fn get_bios_serial_pub() -> String {
    get_bios_serial()
}

// ── Legacy v1 raw getters (no sanitization — preserves v1 quirks) ──────

pub(super) fn get_first_disk_serial_raw() -> String {
    query_value(
        "Get-CimInstance Win32_DiskDrive | Select-Object -ExpandProperty SerialNumber | Select-Object -First 1",
    )
}

pub(super) fn get_motherboard_uuid_raw() -> String {
    hardware_snapshot().motherboard_raw.clone()
}

pub(super) fn get_bios_serial_raw() -> String {
    hardware_snapshot().bios_raw.clone()
}
