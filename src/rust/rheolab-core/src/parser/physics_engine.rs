//! Physics Engine - Data correction and geometry inference
//!
//! Migrated from src/lib/parser/PhysicsEngine.ts
//! Provides physics consistency enforcement and geometry inference functions.

use crate::types::RheoPoint;
use serde::{Deserialize, Serialize};

// Geometry K-factors for shear rate calculation: γ̇ = RPM × K
const K_FACTOR_R1B1: f64 = 1.703;
const K_FACTOR_R1B2: f64 = 0.377;
const K_FACTOR_R1B5: f64 = 0.847;
const K_FACTOR_DIRECT: f64 = 1.0;
const DEFAULT_K_FACTOR: f64 = K_FACTOR_R1B5;

/// Result of physics enforcement
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PhysicsResult {
    pub sr_recovered: bool,
    pub rpm_corrected: bool,
}

/// Get K-factor for the specified geometry
fn get_k_factor(geometry: Option<&str>) -> f64 {
    match geometry {
        Some("R1B1") => K_FACTOR_R1B1,
        Some("R1B2") => K_FACTOR_R1B2,
        Some("R1B5") => K_FACTOR_R1B5,
        Some("DIRECT") | Some("F1.0") => K_FACTOR_DIRECT,
        _ => DEFAULT_K_FACTOR,
    }
}

/// Public accessor for K-factor by geometry name
pub fn get_k_factor_for_geometry(geometry: Option<&str>) -> f64 {
    get_k_factor(geometry)
}

/// Enforce physics consistency on rheology data points
///
/// 1. Calculate SR from Viscosity & Stress (Priority!)
/// 2. If SR defined, ensure RPM matches Geometry (RPM = SR / K)
///
/// This function mutates the data in-place.
pub fn enforce_physics_and_geometry(
    data: &mut [RheoPoint],
    geometry: Option<&str>,
) -> PhysicsResult {
    let mut sr_recovered = false;
    let mut rpm_corrected = false;
    let k_factor = get_k_factor(geometry);

    for point in data.iter_mut() {
        let viscosity = point.viscosity_cp;
        let stress = point.shear_stress.unwrap_or(0.0);
        let current_sr = point.shear_rate.unwrap_or(0.0);
        let current_rpm = point.rpm.unwrap_or(0.0);

        // 1. Calculate SR from Physics (Visc/Stress)
        let mut physics_sr = 0.0;
        if viscosity > 0.0 && stress > 0.0 {
            physics_sr = (stress * 1000.0) / viscosity;
        }

        // Verify/Correct SR based on Physics.
        //
        // Two rules:
        // 1. current_sr == 0  → fill unconditionally (missing column).
        // 2. physics_sr > current_sr by >5%  → the file value is *smaller* than
        //    expected: likely a unit-scaling issue (e.g. Fann dial units where
        //    the stored value is 10× too small). Overwrite with physics.
        //
        // We deliberately do NOT overwrite when current_sr > physics_sr.
        // That pattern indicates a controlled-shear setpoint (e.g. 511 1/s
        // programmed) whose early-transient stress/viscosity hasn't yet
        // reached steady state — overwriting would replace the correct setpoint
        // with a transient physics estimate.
        if physics_sr > 0.0 {
            if current_sr == 0.0 {
                point.shear_rate = Some(physics_sr);
                sr_recovered = true;
            } else if physics_sr > current_sr {
                let diff = (physics_sr - current_sr) / physics_sr;
                if diff > 0.05 {
                    point.shear_rate = Some(physics_sr);
                    sr_recovered = true;
                }
            }
        }
        // 2. Fallback: If SR is still 0/missing, use RPM * K
        else if current_sr == 0.0 && current_rpm > 0.0 {
            point.shear_rate = Some(current_rpm * k_factor);
            sr_recovered = true;
        }

        // Get updated shear rate
        let final_sr = point.shear_rate.unwrap_or(0.0);

        // 3. Auto-correct RPM to match SR / K
        if final_sr > 0.0 {
            let expected_rpm = final_sr / k_factor;
            if current_rpm == 0.0 || (current_rpm - expected_rpm).abs() / expected_rpm > 0.05 {
                point.rpm = Some(expected_rpm);
                rpm_corrected = true;
            }
        }
    }

    PhysicsResult {
        sr_recovered,
        rpm_corrected,
    }
}

/// Infer average K-factor from data points
///
/// Returns Some(avg_k) if enough valid data, None otherwise.
pub fn infer_k_factor_from_data(data: &[RheoPoint]) -> Option<f64> {
    let valid_points: Vec<&RheoPoint> = data
        .iter()
        .filter(|p| {
            p.viscosity_cp > 0.0
                && p.shear_stress.unwrap_or(0.0) > 0.0
                && p.rpm.unwrap_or(0.0) > 0.0
        })
        .collect();

    if valid_points.len() < 5 {
        return None;
    }

    let sum_k: f64 = valid_points
        .iter()
        .map(|p| {
            let stress = p.shear_stress.unwrap_or(0.0);
            let rpm = p.rpm.unwrap_or(1.0); // Avoid division by zero
            let calc_rate = (stress * 1000.0) / p.viscosity_cp;
            calc_rate / rpm
        })
        .sum();

    Some(sum_k / valid_points.len() as f64)
}

/// Infer geometry from K-factor
pub fn infer_geometry_from_k_factor(avg_k: f64) -> Option<String> {
    if (avg_k - K_FACTOR_R1B1).abs() < 0.2 {
        return Some("R1B1".to_string());
    }
    if (avg_k - K_FACTOR_R1B2).abs() < 0.1 {
        return Some("R1B2".to_string());
    }
    if (avg_k - K_FACTOR_R1B5).abs() < 0.15 {
        return Some("R1B5".to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_point(visc: f64, stress: f64, rpm: f64, sr: f64) -> RheoPoint {
        RheoPoint {
            time_sec: 0.0,
            viscosity_cp: visc,
            temperature_c: 25.0,
            rpm: if rpm > 0.0 { Some(rpm) } else { None },
            shear_rate: if sr > 0.0 { Some(sr) } else { None },
            shear_stress: if stress > 0.0 { Some(stress) } else { None },
            pressure_bar: None,
            bath_temperature_c: None,
        }
    }

    #[test]
    fn test_enforce_physics_calculates_sr_from_physics() {
        let mut data = vec![
            create_test_point(100.0, 0.5, 50.0, 0.0), // SR should be (0.5 * 1000) / 100 = 5
        ];

        let result = enforce_physics_and_geometry(&mut data, Some("R1B5"));

        assert!(result.sr_recovered);
        assert!((data[0].shear_rate.unwrap() - 5.0).abs() < 0.01);
    }

    #[test]
    fn test_enforce_physics_uses_rpm_fallback() {
        let mut data = vec![
            create_test_point(0.0, 0.0, 100.0, 0.0), // SR should be 100 * 0.847 = 84.7
        ];

        let result = enforce_physics_and_geometry(&mut data, Some("R1B5"));

        assert!(result.sr_recovered);
        assert!((data[0].shear_rate.unwrap() - 84.7).abs() < 0.1);
    }

    #[test]
    fn test_enforce_physics_corrects_rpm() {
        let mut data = vec![
            create_test_point(100.0, 8.47, 0.0, 84.7), // Expected RPM = 84.7 / 0.847 = 100
        ];

        let result = enforce_physics_and_geometry(&mut data, Some("R1B5"));

        assert!(result.rpm_corrected);
        assert!((data[0].rpm.unwrap() - 100.0).abs() < 0.1);
    }

    #[test]
    fn test_infer_k_factor() {
        // Create points that should give K ≈ 0.847 (R1B5)
        let data = vec![
            create_test_point(100.0, 8.47, 100.0, 84.7),
            create_test_point(100.0, 8.47, 100.0, 84.7),
            create_test_point(100.0, 8.47, 100.0, 84.7),
            create_test_point(100.0, 8.47, 100.0, 84.7),
            create_test_point(100.0, 8.47, 100.0, 84.7),
        ];

        let avg_k = infer_k_factor_from_data(&data);
        assert!(avg_k.is_some());
        assert!((avg_k.unwrap() - 0.847).abs() < 0.01);
    }

    #[test]
    fn test_infer_geometry() {
        assert_eq!(
            infer_geometry_from_k_factor(1.703),
            Some("R1B1".to_string())
        );
        assert_eq!(
            infer_geometry_from_k_factor(0.377),
            Some("R1B2".to_string())
        );
        assert_eq!(
            infer_geometry_from_k_factor(0.850),
            Some("R1B5".to_string())
        );
        assert_eq!(infer_geometry_from_k_factor(5.0), None);
    }
}
