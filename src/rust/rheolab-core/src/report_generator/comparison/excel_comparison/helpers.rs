//! Shared internal helpers for the excel-comparison renderer:
//! palette, key-normalisation, colour parsing, dash-style mapping.

use rust_xlsxwriter::ChartLineDashType;

/// Default palette — matches `EXPERIMENT_COLORS` in `comparison-chart-constants.ts`.
pub(super) const DEFAULT_PALETTE: &[u32] = &[
    0x1E90FF, // DodgerBlue
    0xFF4500, // OrangeRed
    0x228B22, // ForestGreen
    0xFF1493, // DeepPink
    0xFFD700, // Gold
    0x8A2BE2, // BlueViolet
    0x00CED1, // DarkTurquoise
    0xFF6347, // Tomato
];

/// Bridge canonical UI metric keys to internal short keys.
///
/// The production UI sends canonical keys like `"shear_rate_s1"` while the
/// chart builder expects short keys (`"shear_rate"`).  Unknown / already-
/// internal keys pass through unchanged.
pub(super) fn canonical_to_internal(key: &str) -> &str {
    match key {
        "shear_rate_s1" | "shearRate" | "shear_rate" => "shear_rate",
        "viscosity_cp" | "viscosityCp" | "viscosity" => "viscosity",
        "temperature_c" | "temperatureC" | "temperature" => "temperature",
        "bath_temperature_c" | "bathTemperatureC" | "bath_temperature" => "bath_temperature",
        "pressure_bar" | "pressureBar" | "pressure" => "pressure",
        other => other,
    }
}

pub(super) fn parse_color_hex(hex: &str) -> u32 {
    let hex = hex.trim_start_matches('#');
    u32::from_str_radix(hex, 16).unwrap_or(0x3B82F6)
}

pub(super) fn style_to_dash(style: &str) -> ChartLineDashType {
    match style {
        "dashed" => ChartLineDashType::Dash,
        "dotted" => ChartLineDashType::RoundDot,
        _ => ChartLineDashType::Solid,
    }
}
