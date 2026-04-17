use crate::types::RheoPoint;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct ValidationResult {
    pub warnings: Vec<String>,
    pub has_shear_rate_issue: bool,
}

#[derive(Debug, Clone, Default)]
pub struct CandidateValidationReport {
    pub warnings: Vec<String>,
    pub severe_errors: Vec<String>,
    pub row_count: usize,
    pub mandatory_field_coverage: usize,
    pub time_monotonicity_score: u32,
    pub physics_consistency_score: u32,
    pub hard_valid: bool,
    pub suspicious: bool,
}

pub fn validate_data(data: &[RheoPoint], geometry: Option<String>) -> ValidationResult {
    let mut warnings = Vec::new();
    let mut has_shear_rate_issue = false;

    // 1. Check Temperature Stability
    check_temperature_stability(data, &mut warnings);

    // 2. Validate Shear Rate Consistency
    if validate_shear_rate_consistency(data, &mut warnings) {
        has_shear_rate_issue = true;
    }

    // 3. Validate RPM Consistency
    validate_rpm_consistency(data, geometry.as_deref(), &mut warnings);

    ValidationResult {
        warnings,
        has_shear_rate_issue,
    }
}

pub fn build_candidate_validation_report(
    data: &[RheoPoint],
    geometry: Option<String>,
) -> CandidateValidationReport {
    let validation = validate_data(data, geometry.clone());
    let row_count = data.len();
    let time_values: Vec<f64> = data
        .iter()
        .map(|point| point.time_sec)
        .filter(|value| value.is_finite())
        .collect();
    let invalid_time_count = data.len().saturating_sub(time_values.len())
        + data.iter().filter(|point| point.time_sec < 0.0).count();

    let mandatory_field_coverage = data
        .iter()
        .filter(|point| {
            point.time_sec.is_finite()
                && point.time_sec >= 0.0
                && (point.viscosity_cp > 0.0 || point.rpm.unwrap_or(0.0) > 0.0)
        })
        .count();

    let monotonic_pairs = data
        .windows(2)
        .filter(|pair| pair[0].time_sec.is_finite() && pair[1].time_sec.is_finite())
        .count();
    let monotonic_ok = data
        .windows(2)
        .filter(|pair| pair[0].time_sec.is_finite() && pair[1].time_sec.is_finite())
        .filter(|pair| pair[1].time_sec >= pair[0].time_sec)
        .count();
    let time_monotonicity_score = if monotonic_pairs == 0 {
        1000
    } else {
        ((monotonic_ok as f64 / monotonic_pairs as f64) * 1000.0).round() as u32
    };

    let physics_checks: Vec<bool> = data
        .iter()
        .filter_map(|point| {
            let stress = point.shear_stress?;
            let shear_rate = point.shear_rate?;
            if point.viscosity_cp <= 0.0 || stress <= 0.0 || shear_rate <= 0.0 {
                return None;
            }

            let expected_shear_rate = (stress * 1000.0) / point.viscosity_cp;
            if expected_shear_rate <= 0.0 || !expected_shear_rate.is_finite() {
                return None;
            }

            let ratio = shear_rate / expected_shear_rate;
            Some((0.90..=1.10).contains(&ratio))
        })
        .take(50)
        .collect();
    let physics_consistency_score = if physics_checks.len() < 3 {
        1000
    } else {
        let ok_count = physics_checks.iter().filter(|ok| **ok).count();
        ((ok_count as f64 / physics_checks.len() as f64) * 1000.0).round() as u32
    };

    let mut severe_errors = Vec::new();
    if row_count == 0 {
        severe_errors.push("No data rows parsed".to_string());
    }
    if invalid_time_count > 0 {
        severe_errors.push(format!("Invalid time values detected: {}", invalid_time_count));
    }
    if mandatory_field_coverage == 0 {
        severe_errors.push("No rows with mandatory time + viscosity/RPM coverage".to_string());
    }
    if time_monotonicity_score < 950 {
        severe_errors.push(format!(
            "Time monotonicity score too low: {}",
            time_monotonicity_score
        ));
    }
    if validation.has_shear_rate_issue {
        severe_errors.push("Shear-rate consistency check failed".to_string());
    }

    CandidateValidationReport {
        warnings: validation.warnings,
        severe_errors: severe_errors.clone(),
        row_count,
        mandatory_field_coverage,
        time_monotonicity_score,
        physics_consistency_score,
        hard_valid: severe_errors.is_empty(),
        suspicious: !severe_errors.is_empty(),
    }
}

fn check_temperature_stability(data: &[RheoPoint], warnings: &mut Vec<String>) {
    if data.len() < 10 {
        return;
    }

    let temps: Vec<f64> = data.iter()
        .map(|p| p.temperature_c)
        .filter(|&t| t > 0.0)
        .collect();

    if temps.len() < 10 {
        return;
    }

    let min_temp = temps.iter().fold(f64::INFINITY, |a, &b| a.min(b));
    let max_temp = temps.iter().fold(f64::NEG_INFINITY, |a, &b| a.max(b));
    let temp_range = max_temp - min_temp;

    if temp_range < 0.5 {
        warnings.push(format!("⚠️ ВНИМАНИЕ: Температура не изменяется в ходе теста ({:.1}°C - {:.1}°C). Возможна проблема с датчиком температуры!", min_temp, max_temp));
    } else if temp_range < 2.0 && data.len() > 100 {
        warnings.push(format!("⚠️ Температура почти не меняется: Δ = {:.1}°C за {} точек измерений.", temp_range, data.len()));
    }
}

fn validate_shear_rate_consistency(data: &[RheoPoint], warnings: &mut Vec<String>) -> bool {
    if data.len() < 5 {
        return false;
    }

    let samples: Vec<&RheoPoint> = data.iter()
        .filter(|p| {
            p.viscosity_cp > 0.0 &&
            p.shear_stress.unwrap_or(0.0) > 0.0 &&
            p.shear_rate.unwrap_or(0.0) > 0.0
        })
        .take(20)
        .collect();

    if samples.len() < 3 {
        return false;
    }

    let mut mismatch_count = 0;
    let total_checked = samples.len();

    for point in &samples {
        let stress = point.shear_stress.unwrap_or(0.0);
        let sr = point.shear_rate.unwrap_or(0.0);
        let expected_shear_rate = (stress * 1000.0) / point.viscosity_cp;
        let ratio = sr / expected_shear_rate;

        if !(0.90..=1.10).contains(&ratio) {
            mismatch_count += 1;
        }
    }

    let has_issue = total_checked > 0 && (mismatch_count > total_checked / 2);

    if has_issue {
        let sample = samples[0];
        let stress = sample.shear_stress.unwrap_or(0.0);
        let sr = sample.shear_rate.unwrap_or(0.0);
        let expected_sr = (stress * 1000.0) / sample.viscosity_cp;

        warnings.push("⚠️ ОШИБКА: Скорость сдвига не соответствует соотношению η = τ/γ̇!".to_string());
        warnings.push(format!("Пример: η={:.1} cP, τ={:.2} Pa", sample.viscosity_cp, stress));
        warnings.push(format!("Ожидаемая γ̇ = {:.1} с⁻¹, Получена: {:.1} с⁻¹", expected_sr, sr));

        let k_needed = expected_sr / sr;
        warnings.push(format!("Отношение Ожидаемая/Полученная ≈ {:.3}", k_needed));

        if (k_needed - 0.847).abs() < 0.05 {
            warnings.push("💡 ГИПОТЕЗА: В колонке \"Скорость сдвига\" на самом деле RPM (для R1B5)!".to_string());
        } else if (k_needed - 1.703).abs() < 0.1 {
            warnings.push("💡 ГИПОТЕЗА: В колонке \"Скорость сдвига\" на самом деле RPM (для R1B1)!".to_string());
        } else if (k_needed - (1.0 / 0.847)).abs() < 0.05 {
            warnings.push("💡 ГИПОТЕЗА: В колонке \"RPM\" на самом деле уже указана Скорость сдвига (1/s)!".to_string());
        }
    }

    has_issue
}

fn validate_rpm_consistency(data: &[RheoPoint], geometry: Option<&str>, warnings: &mut Vec<String>) {
    let geometry = geometry.unwrap_or("R1B5");
    
    // K-Factors map (simplified)
    let k_factor = match geometry {
        "R1B1" => 1.703,
        "R1B2" => 0.377,
        "R1B5" => 0.847,
        "F1.0" | "DIRECT" => 1.0,
        _ => 0.847, // Default
    };

    if (k_factor - 1.0_f64).abs() < f64::EPSILON {
        return; // Direct/Raw mode
    }

    let mut mismatch_count = 0;
    
    let samples: Vec<&RheoPoint> = data.iter()
        .filter(|p| {
            p.shear_rate.unwrap_or(0.0) > 0.0 &&
            p.rpm.unwrap_or(0.0) > 0.0
        })
        .take(20)
        .collect();

    let total_checked = samples.len();
    if total_checked == 0 { return; }

    for point in &samples {
        let sr = point.shear_rate.unwrap_or(0.0);
        let rpm = point.rpm.unwrap_or(0.0);
        let expected_rpm = sr / k_factor;
        let ratio = rpm / expected_rpm;

        if !(0.90..=1.10).contains(&ratio) {
            mismatch_count += 1;
        }
    }

    if total_checked > 0 && mismatch_count > total_checked / 2 {
        warnings.push(format!("⚠️ RPM Warning: Обороты в файле не соответствуют геометрии {} (K={}).", geometry, k_factor));
        let sample = samples[0];
        let sr = sample.shear_rate.unwrap_or(0.0);
        let rpm = sample.rpm.unwrap_or(0.0);
        let expected_rpm = sr / k_factor;
        warnings.push(format!("Пример: SR={:.1}, RPM={:.1}. Ожидалось RPM={:.1}", sr, rpm, expected_rpm));
    }
}
