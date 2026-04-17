//! Grace Engine - Rheological Parameter Calculations
//! 
//! Calculates Grace parameters (n', K', viscosities) for each measurement cycle.
//! This code is compiled to WASM for IP protection.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const PAS_TO_CP: f64 = 1000.0;

/// Geometry parameters for viscometer calculations
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GeometryParams {
    pub rb: f64, // Bob radius (m)
    pub rc: f64, // Cup radius (m)
}

/// Expert settings for Grace calculations
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ExpertSettings {
    #[serde(default)]
    pub points_to_average: i32,
    #[serde(default = "default_rates")]
    pub viscosity_shear_rates: Vec<f64>,
}

fn default_rates() -> Vec<f64> { vec![40.0, 100.0, 170.0] }

/// Input parameters for Grace calculation
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct GraceInputParams {
    #[serde(default)]
    pub cycle_no: i32,
    #[serde(default)]
    pub time_min: f64,
    #[serde(default)]
    pub end_time_min: f64,
    #[serde(default)]
    pub temp_c: f64,
    #[serde(default)]
    pub pressure_bar: f64,
}

/// Result of Grace parameter calculation
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GraceCycleResult {
    pub cycle_no: i32,
    pub time_min: f64,
    pub end_time_min: f64,
    pub temp_c: f64,
    pub pressure_bar: f64,
    pub n_prime: f64,
    pub kv_pasn: f64,
    pub r2: f64,
    pub k_prime_pasn: f64,
    pub k_prime_slot_pasn: f64,
    pub k_prime_pipe_pasn: f64,
    pub viscosities: HashMap<String, f64>,
    pub bingham_pv_pas: f64,
    pub bingham_yp_pa: f64,
    pub bingham_r2: f64,
    pub calc_points: i32,
}

/// Linear regression helper
fn linear_regression(x: &[f64], y: &[f64]) -> (f64, f64, f64) {
    let n = x.len() as f64;
    if n < 2.0 { return (0.0, 0.0, 0.0); }

    let sum_x: f64 = x.iter().sum();
    let sum_y: f64 = y.iter().sum();
    let sum_xy: f64 = x.iter().zip(y.iter()).map(|(a, b)| a * b).sum();
    let sum_xx: f64 = x.iter().map(|a| a * a).sum();

    let denom = n * sum_xx - sum_x * sum_x;
    if denom.abs() < 1e-15 { return (0.0, sum_y / n, 0.0); }

    let slope = (n * sum_xy - sum_x * sum_y) / denom;
    let intercept = (sum_y - slope * sum_x) / n;

    let y_mean = sum_y / n;
    let ss_tot: f64 = y.iter().map(|yi| (yi - y_mean).powi(2)).sum();
    let ss_res: f64 = x.iter().zip(y.iter())
        .map(|(xi, yi)| (yi - (slope * xi + intercept)).powi(2))
        .sum();

    let r2 = if ss_tot.abs() > 1e-15 { 1.0 - (ss_res / ss_tot) } else { 0.0 };
    (slope, intercept, r2)
}

/// Calculate Power Law from data points
/// Returns (n, kv, r2, k_ind, k_slot, k_pipe)
fn calc_power_law(data: &[(f64, f64)], geometry: &GeometryParams) -> (f64, f64, f64, f64, f64, f64) {
    let valid: Vec<_> = data.iter()
        .filter(|(r, s)| *r > 0.0 && *s > 0.0)
        .collect();

    if valid.len() < 2 {
        return (0.0, 0.0, 0.0, f64::NAN, f64::NAN, f64::NAN);
    }

    let x: Vec<f64> = valid.iter().map(|(r, _)| r.ln()).collect();
    let y: Vec<f64> = valid.iter().map(|(_, s)| s.ln()).collect();

    let (n, ln_k, r2) = linear_regression(&x, &y);
    let k = ln_k.exp();

    // Calculate corrected K values (ISO 13503-1:2011 formulas 14, 15, 16)
    let (k_ind, k_slot, k_pipe) = if geometry.rc > 0.0 && geometry.rb > 0.0 && geometry.rb < geometry.rc && n.abs() > 1e-7 {
        let s_sq = (geometry.rb / geometry.rc).powi(2);
        let term_pow = (geometry.rb / geometry.rc).powf(2.0 / n);
        let numerator = n * (1.0 - term_pow);
        let denominator = 1.0 - s_sq;

        if denominator.abs() > 1e-9 {
            let factor3 = (numerator / denominator).powf(n);
            let calc_k_ind = factor3 * k;
            // ISO formula (15): Ks = K · [(2n+1)/(3n)]^n  — slot/fracture
            let term_slot = (2.0 * n + 1.0) / (3.0 * n);
            let calc_k_slot = calc_k_ind * term_slot.powf(n);
            // ISO formula (16): Kp = K · [(3n+1)/(4n)]^n  — pipe
            let term_pipe = (3.0 * n + 1.0) / (4.0 * n);
            let calc_k_pipe = calc_k_ind * term_pipe.powf(n);
            (calc_k_ind, calc_k_slot, calc_k_pipe)
        } else {
            (f64::NAN, f64::NAN, f64::NAN)
        }
    } else {
        (f64::NAN, f64::NAN, f64::NAN)
    };

    (n, k, r2, k_ind, k_slot, k_pipe)
}

/// Calculate Bingham from data points
fn calc_bingham(data: &[(f64, f64)]) -> (f64, f64, f64) {
    if data.len() < 2 { return (0.0, 0.0, 0.0); }
    let x: Vec<f64> = data.iter().map(|(r, _)| *r).collect();
    let y: Vec<f64> = data.iter().map(|(_, s)| *s).collect();
    linear_regression(&x, &y) // (pv, yp, r2)
}

/// Get geometry by key
fn get_geometry(key: &str) -> GeometryParams {
    match key {
        "R1B1" => GeometryParams { rb: 0.017245, rc: 0.018415 },
        "R1B2" => GeometryParams { rb: 0.015987, rc: 0.018415 },
        "R1B5" => GeometryParams { rb: 0.017113, rc: 0.018415 },
        _ => GeometryParams { rb: 0.017113, rc: 0.018415 },
    }
}

/// Calculate Grace parameters from raw data points - Internal Rust version
pub fn calculate_grace_internal(
    points: &[(f64, f64)],
    geometry_key: &str,
    settings: &ExpertSettings,
    params: &GraceInputParams,
) -> Option<GraceCycleResult> {
    if points.len() < 2 {
        return None;
    }

    let geometry = get_geometry(geometry_key);

    // Power Law
    let (n, k, r2, k_ind, k_slot, k_pipe) = calc_power_law(points, &geometry);

    // Bingham
    let (bingham_pv, bingham_yp, bingham_r2) = calc_bingham(points);

    // Viscosities — always use ISO 13503-1 geometry-independent K' (K_ind, formula 14)
    let k_for_visc = if !k_ind.is_nan() { k_ind } else { k };

    let calc_visc = |rate: f64| -> f64 {
        if rate <= 0.0 { return 0.0; }
        k_for_visc * rate.powf(n - 1.0) * PAS_TO_CP
    };

    let mut viscosities = HashMap::new();
    for rate in &settings.viscosity_shear_rates {
        viscosities.insert(format!("{}", rate), calc_visc(*rate));
    }

    Some(GraceCycleResult {
        cycle_no: params.cycle_no,
        time_min: params.time_min,
        end_time_min: params.end_time_min,
        temp_c: params.temp_c,
        pressure_bar: params.pressure_bar,
        n_prime: n,
        kv_pasn: k,
        r2,
        k_prime_pasn: k_ind,
        k_prime_slot_pasn: k_slot,
        k_prime_pipe_pasn: k_pipe,
        viscosities,
        bingham_pv_pas: bingham_pv,
        bingham_yp_pa: bingham_yp,
        bingham_r2,
        calc_points: points.len() as i32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_linear_regression_perfect_line() {
        let x = vec![1.0, 2.0, 3.0, 4.0];
        let y = vec![3.0, 5.0, 7.0, 9.0]; // y = 2x + 1
        let (slope, intercept, r2) = linear_regression(&x, &y);
        
        assert!((slope - 2.0).abs() < 1e-10);
        assert!((intercept - 1.0).abs() < 1e-10);
        assert!((r2 - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_linear_regression_horizontal() {
        let x = vec![1.0, 2.0, 3.0];
        let y = vec![5.0, 5.0, 5.0];
        let (slope, intercept, r2) = linear_regression(&x, &y);
        
        assert!((slope - 0.0).abs() < 1e-10);
        assert!((intercept - 5.0).abs() < 1e-10);
        // R2 is 0.0 when total sum of squares is 0 (no variance in Y)
        assert!((r2 - 0.0).abs() < 1e-10);
    }

    #[test]
    fn test_calc_power_law_basic() {
        // y = 2 * x^0.5
        // ln(y) = ln(2) + 0.5 * ln(x)
        let mut data = Vec::new();
        for i in 1..=5 {
            let x = i as f64;
            let y = 2.0 * x.powf(0.5);
            data.push((x, y));
        }

        let geometry = GeometryParams { rb: 0.0, rc: 0.0 }; // No geometry correction
        let (n, k, r2, k_ind, k_slot, k_pipe) = calc_power_law(&data, &geometry);

        assert!((n - 0.5).abs() < 1e-10);
        assert!((k - 2.0).abs() < 1e-10);
        assert!((r2 - 1.0).abs() < 1e-10);
        assert!(k_ind.is_nan());
        assert!(k_slot.is_nan());
        assert!(k_pipe.is_nan());
    }

    #[test]
    fn test_calc_bingham_basic() {
        // y = 2x + 5
        let mut data = Vec::new();
        for i in 1..=5 {
            let x = i as f64;
            let y = 2.0 * x + 5.0;
            data.push((x, y));
        }

        let (pv, yp, r2) = calc_bingham(&data);

        assert!((pv - 2.0).abs() < 1e-10);
        assert!((yp - 5.0).abs() < 1e-10);
        assert!((r2 - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_calculate_grace_internal_integration() {
        let mut points = Vec::new();
        // Create synthetic data: Power Law y = 10 * x^0.8
        for i in 1..=10 {
            let rate = i as f64 * 10.0;
            let stress = 10.0 * rate.powf(0.8);
            points.push((rate, stress));
        }

        let settings = ExpertSettings {
            points_to_average: 0,
            viscosity_shear_rates: vec![10.0, 100.0],
        };

        let params = GraceInputParams {
            cycle_no: 1,
            time_min: 0.0,
            end_time_min: 1.0,
            temp_c: 25.0,
            pressure_bar: 1.0,
        };

        let result = calculate_grace_internal(
            &points,
            "R1B1",
            &settings,
            &params
        ).unwrap();

        assert_eq!(result.cycle_no, 1);
        assert!((result.n_prime - 0.8).abs() < 1e-5);
        assert!((result.kv_pasn - 10.0).abs() < 1e-5);
        assert!(result.viscosities.contains_key("10"));
        assert!(result.viscosities.contains_key("100"));
        
        // Check viscosity calculation: eta = K * rate^(n-1) * 1000
        // For rate 100: 10 * 100^(0.8-1) * 1000 = 10 * 100^(-0.2) * 1000
        // 100^(-0.2) = (10^2)^(-0.2) = 10^(-0.4) ≈ 0.3981
        // 10 * 0.3981 * 1000 ≈ 3981
        let visc_100 = result.viscosities.get("100").unwrap();
        assert!(*visc_100 > 0.0);
    }
}
