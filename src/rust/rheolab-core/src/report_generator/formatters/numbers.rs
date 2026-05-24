//! Number / date / ramp stringification helpers.
//!
//! These produce the locale-independent number text the report tables
//! print verbatim — they do **no** unit conversion (use `units.rs` for
//! that) and **no** time-format dispatch (`time.rs` owns that path).

/// Format number with specified decimal places
/// Matches formatNumber from TypeScript
pub fn format_number(value: Option<f64>, decimals: u32) -> String {
    match value {
        Some(v) if v.is_finite() => {
            format!("{:.prec$}", v, prec = decimals as usize)
        }
        _ => "-".to_string(),
    }
}

/// Format number from f64 directly
pub fn format_number_direct(value: f64, decimals: u32) -> String {
    if value.is_finite() {
        format!("{:.prec$}", value, prec = decimals as usize)
    } else {
        "-".to_string()
    }
}

/// Format date string from ISO format to locale format
pub fn format_date(date_str: &Option<String>, lang: &str) -> String {
    match date_str {
        Some(s) if !s.is_empty() => {
            // Try to parse ISO date
            let parts: Vec<&str> = s.split('T').next().unwrap_or(s).split('-').collect();
            if parts.len() == 3 {
                if lang == "ru" {
                    format!("{}.{}.{}", parts[2], parts[1], parts[0])
                } else {
                    format!("{}/{}/{}", parts[1], parts[2], parts[0])
                }
            } else {
                s.clone()
            }
        }
        _ => "-".to_string(),
    }
}

/// Build ramp string from cycle steps
pub fn build_ramp_string(cycles: &[super::super::types::CycleInfo]) -> Option<String> {
    // Find first cycle with steps
    let target_cycle = cycles.iter().find(|c| !c.steps.is_empty())?;

    if target_cycle.steps.is_empty() {
        return None;
    }

    let rates: Vec<String> = target_cycle
        .steps
        .iter()
        .map(|s| format!("{}", s.avg_shear_rate.round() as i32))
        .collect();

    Some(rates.join(" - "))
}
