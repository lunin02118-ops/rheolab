//! Formatters
//! 
//! Number and unit formatting functions matching report-formatters.ts
//! 
//! ЕДИНЫЙ ИСТОЧНИК форматирования для PDF и Excel
//! Все значения должны форматироваться одинаково в обоих форматах!

/// Константы для количества знаков после запятой
/// ЕДИНЫЙ ИСТОЧНИК для PDF и Excel
pub mod decimals {
    /// Время (минуты): 1 знак после запятой
    pub const TIME: u32 = 1;
    /// Температура (°C): 1 знак
    pub const TEMPERATURE: u32 = 1;
    /// Давление (bar): 1 знак
    pub const PRESSURE: u32 = 1;
    /// n' (индекс поведения): 3 знака
    pub const N_PRIME: u32 = 3;
    /// K' (индекс консистенции): 4 знака
    pub const K_PRIME: u32 = 4;
    /// R² (коэффициент детерминации): 4 знака
    pub const R_SQUARED: u32 = 4;
    /// Вязкость при фиксированных скоростях сдвига (η@40, η@100, η@170): 0 знаков
    pub const VISCOSITY_FIXED: u32 = 0;
    /// PV (пластическая вязкость): 2 знака
    pub const PV: u32 = 2;
    /// YP (предел текучести): 1 знак
    pub const YP: u32 = 1;
    /// Bingham R²: 4 знака
    pub const BINGHAM_R2: u32 = 4;
    /// Анализ воды: 1 знак
    pub const WATER_PARAMS: u32 = 1;
    /// Калибровка R²: 6 знаков
    pub const CAL_R2: u32 = 6;
    /// Калибровка slope/intercept: 4 знака
    pub const CAL_SLOPE: u32 = 4;
    /// Калибровка hysteresis/stdev: 2 знака
    pub const CAL_HYST: u32 = 2;
}

/// Excel форматы для числовых ячеек
/// Соответствуют константам из decimals
pub mod excel_formats {
    pub const TIME: &str = "0.0";
    pub const TEMPERATURE: &str = "0.0";
    pub const PRESSURE: &str = "0.0";
    pub const N_PRIME: &str = "0.000";
    pub const K_PRIME: &str = "0.0000";
    pub const R_SQUARED: &str = "0.0000";
    pub const VISCOSITY_FIXED: &str = "0";
    pub const PV: &str = "0.00";
    pub const YP: &str = "0.0";
    pub const BINGHAM_R2: &str = "0.0000";
    pub const WATER_PARAMS: &str = "0.0";
    pub const DEFAULT: &str = "0.00";
}

/// Format number with specified decimal places
/// Matches formatNumber from TypeScript
pub fn format_number(value: Option<f64>, decimals: u32) -> String {
    match value {
        Some(v) if v.is_finite() => {
            format!("{:.prec$}", v, prec = decimals as usize)
        }
        _ => "-".to_string()
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

/// Convert consistency index K' based on unit system
/// SI: Pa·sⁿ (keep as is)
/// Imperial: lbf/100ft² (multiply by 47.88)
pub fn convert_consistency_index(k_prime: f64, unit_system: &str) -> f64 {
    if unit_system == "Imperial" {
        k_prime * 47.88
    } else {
        k_prime
    }
}

/// Convert PV based on unit system
/// SI: Pa·s (keep as is)
/// Imperial: cP (multiply by 1000)
pub fn convert_pv(pv: f64, unit_system: &str) -> f64 {
    if unit_system == "Imperial" {
        pv * 1000.0
    } else {
        pv
    }
}

/// Convert YP based on unit system
/// SI: Pa (keep as is)
/// Imperial: lbf/100ft² (multiply by 2.0885)
pub fn convert_yp(yp: f64, unit_system: &str) -> f64 {
    if unit_system == "Imperial" {
        yp * 2.0885
    } else {
        yp
    }
}

/// Get K' unit label
pub fn get_k_unit(unit_system: &str) -> &'static str {
    if unit_system == "Imperial" {
        "lbf/100ft²"
    } else {
        "Pa·s^n"
    }
}

/// Get PV unit label
pub fn get_pv_unit(unit_system: &str) -> &'static str {
    if unit_system == "Imperial" {
        "cP"
    } else {
        "Pa·s"
    }
}

/// Get YP unit label
pub fn get_yp_unit(unit_system: &str) -> &'static str {
    if unit_system == "Imperial" {
        "lbf/100ft²"
    } else {
        "Pa"
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
        _ => "-".to_string()
    }
}

/// Build ramp string from cycle steps
pub fn build_ramp_string(cycles: &[super::types::CycleInfo]) -> Option<String> {
    // Find first cycle with steps
    let target_cycle = cycles.iter().find(|c| !c.steps.is_empty())?;
    
    if target_cycle.steps.is_empty() {
        return None;
    }

    let rates: Vec<String> = target_cycle.steps
        .iter()
        .map(|s| format!("{}", s.avg_shear_rate.round() as i32))
        .collect();
    
    Some(rates.join(" - "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::types::{CycleInfo, StepInfo};

    #[test]
    fn test_format_number() {
        assert_eq!(format_number(Some(123.456789), 2), "123.46");
        assert_eq!(format_number(Some(0.1234), 4), "0.1234");
        assert_eq!(format_number(None, 2), "-");
    }

    #[test]
    fn test_format_number_direct() {
        assert_eq!(format_number_direct(3.14159, 2), "3.14");
        assert_eq!(format_number_direct(0.0, 3), "0.000");
        assert_eq!(format_number_direct(f64::NAN, 2), "-");
        assert_eq!(format_number_direct(f64::INFINITY, 1), "-");
    }

    #[test]
    fn test_convert_k_prime() {
        assert_eq!(convert_consistency_index(1.0, "SI"), 1.0);
        assert!((convert_consistency_index(1.0, "Imperial") - 47.88).abs() < 0.01);
    }

    #[test]
    fn test_convert_pv() {
        assert_eq!(convert_pv(0.05, "SI"), 0.05);
        assert!((convert_pv(0.05, "Imperial") - 50.0).abs() < 0.01);
    }

    #[test]
    fn test_convert_yp() {
        assert_eq!(convert_yp(10.0, "SI"), 10.0);
        assert!((convert_yp(10.0, "Imperial") - 20.885).abs() < 0.01);
    }

    #[test]
    fn test_get_k_unit() {
        assert_eq!(get_k_unit("SI"), "Pa·s^n");
        assert_eq!(get_k_unit("Imperial"), "lbf/100ft²");
    }

    #[test]
    fn test_get_pv_unit() {
        assert_eq!(get_pv_unit("SI"), "Pa·s");
        assert_eq!(get_pv_unit("Imperial"), "cP");
    }

    #[test]
    fn test_get_yp_unit() {
        assert_eq!(get_yp_unit("SI"), "Pa");
        assert_eq!(get_yp_unit("Imperial"), "lbf/100ft²");
    }

    #[test]
    fn test_format_date() {
        assert_eq!(format_date(&Some("2026-01-03".to_string()), "ru"), "03.01.2026");
        assert_eq!(format_date(&Some("2026-01-03".to_string()), "en"), "01/03/2026");
        assert_eq!(format_date(&None, "ru"), "-");
        assert_eq!(format_date(&Some("".to_string()), "en"), "-");
        assert_eq!(format_date(&Some("2026-01-03T12:30:00Z".to_string()), "ru"), "03.01.2026");
    }

    #[test]
    fn test_build_ramp_string() {
        let cycles = vec![CycleInfo {
            cycle_type: "ramp".to_string(),
            steps: vec![
                StepInfo { avg_shear_rate: 5.6 },
                StepInfo { avg_shear_rate: 100.0 },
                StepInfo { avg_shear_rate: 170.4 },
            ],
        }];
        assert_eq!(build_ramp_string(&cycles), Some("6 - 100 - 170".to_string()));
    }

    #[test]
    fn test_build_ramp_string_empty() {
        let cycles: Vec<CycleInfo> = vec![];
        assert_eq!(build_ramp_string(&cycles), None);

        let empty_cycle = vec![CycleInfo {
            cycle_type: "ramp".to_string(),
            steps: vec![],
        }];
        assert_eq!(build_ramp_string(&empty_cycle), None);
    }
}
