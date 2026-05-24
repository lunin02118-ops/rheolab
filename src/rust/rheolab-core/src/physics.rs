//! # Physics Engine - Rheological Model Calculations
//!
//! This module implements the core rheological models used for fluid characterization:
//!
//! ## Bingham Plastic Model
//!
//! The Bingham Plastic model describes fluids that require a minimum stress (yield point)
//! before they begin to flow. Once flowing, they exhibit linear viscous behavior.
//!
//! **Mathematical Formula:**
//! ```text
//! τ = τ₀ + μₚ × γ̇
//! ```
//!
//! Where:
//! - τ = Shear stress (Pa)
//! - τ₀ = Yield Point (YP) - minimum stress to initiate flow (Pa)
//! - μₚ = Plastic Viscosity (PV) - resistance to flow once moving (Pa·s)
//! - γ̇ = Shear rate (s⁻¹)
//!
//! **Applications:** Drilling fluids, cement slurries, paint
//!
//! ## Power Law Model (Ostwald-de Waele)
//!
//! The Power Law model describes shear-thinning or shear-thickening fluids
//! where viscosity changes with shear rate.
//!
//! **Mathematical Formula:**
//! ```text
//! τ = K × γ̇ⁿ
//! ```
//!
//! Where:
//! - τ = Shear stress (Pa)
//! - K = Consistency index (Pa·sⁿ) - fluid "thickness"
//! - n = Flow behavior index (dimensionless):
//!   - n < 1: Shear-thinning (pseudoplastic)
//!   - n = 1: Newtonian
//!   - n > 1: Shear-thickening (dilatant)
//! - γ̇ = Shear rate (s⁻¹)
//!
//! **Applications:** Polymer solutions, blood, fracturing fluids
//!
//! ## C# Port Considerations
//!
//! When porting to C#:
//! 1. `linear_regression` → Implement as a static utility method
//! 2. Use `Math.Log` for natural logarithm in Power Law linearization
//! 3. Preserve the exact tolerance checks (1e-15, 1e-7, etc.)
//! 4. HashMap<String, f64> → Dictionary<string, double>

use serde::{Deserialize, Serialize};

/// Result of a rheological model calculation.
///
/// Contains the fitted model parameters and goodness-of-fit metric (R²).
///
/// # Fields
/// * `model_name` - Human-readable model name ("Bingham Plastic" or "Power Law")
/// * `parameters` - Model parameters as key-value pairs:
///   - Bingham: "pv" (Plastic Viscosity), "yp" (Yield Point)
///   - Power Law: "k" (Consistency), "n" (Flow Index), "k_ind", "k_slot"
/// * `r2` - Coefficient of determination (R²), range 0.0 to 1.0
///   - 1.0 = perfect fit
///   - > 0.95 = excellent fit
///   - < 0.80 = poor fit, model may not be appropriate
///
/// # C# Equivalent
/// ```csharp
/// public class ModelResult {
///     public string ModelName { get; set; }
///     public Dictionary<string, double> Parameters { get; set; }
///     public double R2 { get; set; }
/// }
/// ```
#[derive(Serialize, Deserialize, Clone, Debug)]
#[allow(dead_code)]
pub struct ModelResult {
    pub model_name: String,
    pub parameters: std::collections::HashMap<String, f64>,
    pub r2: f64,
}

/// Geometry parameters for concentric cylinder (Couette) viscometer calculations.
///
/// Used for calculating corrected consistency index (K') values that account
/// for the specific measurement geometry.
///
/// # Fields
/// * `rb` - Bob (inner cylinder) radius in meters
/// * `rc` - Cup (outer cylinder) radius in meters
/// * `l` - Bob length in meters
///
/// # Common Geometries
/// - Fann 35: rb = 0.017245m, rc = 0.018415m
/// - Grace M5600: rb = 0.008890m, rc = 0.010160m
///
/// # C# Equivalent
/// ```csharp
/// public class GeometryParams {
///     public double Rb { get; set; }  // Bob radius (m)
///     public double Rc { get; set; }  // Cup radius (m)
///     public double L { get; set; }   // Bob length (m)
/// }
/// ```
#[derive(Serialize, Deserialize, Clone, Debug)]
#[allow(dead_code)]
pub struct GeometryParams {
    /// Bob (inner cylinder) radius in meters
    pub rb: f64,
    /// Cup (outer cylinder) radius in meters
    pub rc: f64,
    /// Bob length in meters
    pub l: f64,
}

/// Performs ordinary least squares (OLS) linear regression.
///
/// Fits a line y = slope × x + intercept to the provided data points
/// using the closed-form solution (normal equations).
///
/// # Arguments
/// * `x` - Independent variable values (e.g., shear rates)
/// * `y` - Dependent variable values (e.g., shear stresses)
///
/// # Returns
/// Tuple of `(slope, intercept, r2)`:
/// * `slope` - Line slope (rise/run)
/// * `intercept` - Y-intercept (value when x = 0)
/// * `r2` - Coefficient of determination (goodness of fit)
///
/// # Mathematical Formulas
/// ```text
/// slope = (n×Σxy - Σx×Σy) / (n×Σx² - (Σx)²)
/// intercept = (Σy - slope×Σx) / n
/// R² = 1 - SS_res / SS_tot
/// ```
///
/// # Edge Cases
/// - Returns (0.0, 0.0, 0.0) if fewer than 2 points
/// - Returns (0.0, y_mean, 0.0) if all x values are identical
///
/// # C# Implementation Note
/// Use `double` precision throughout. Consider using a linear algebra
/// library for numerical stability on large datasets.
#[allow(dead_code)]
fn linear_regression(x: &[f64], y: &[f64]) -> (f64, f64, f64) {
    let n = x.len() as f64;
    if n < 2.0 {
        return (0.0, 0.0, 0.0);
    }

    let sum_x: f64 = x.iter().sum();
    let sum_y: f64 = y.iter().sum();
    let sum_xy: f64 = x.iter().zip(y.iter()).map(|(a, b)| a * b).sum();
    let sum_xx: f64 = x.iter().map(|a| a * a).sum();

    let denom = n * sum_xx - sum_x * sum_x;
    if denom.abs() < 1e-15 {
        return (0.0, sum_y / n, 0.0);
    }

    let slope = (n * sum_xy - sum_x * sum_y) / denom;
    let intercept = (sum_y - slope * sum_x) / n;

    // Calculate R² (coefficient of determination)
    let y_mean = sum_y / n;
    let ss_tot: f64 = y.iter().map(|yi| (yi - y_mean).powi(2)).sum();
    let ss_res: f64 = x
        .iter()
        .zip(y.iter())
        .map(|(xi, yi)| {
            let y_pred = slope * xi + intercept;
            (yi - y_pred).powi(2)
        })
        .sum();

    let r2 = if ss_tot.abs() > 1e-15 {
        1.0 - (ss_res / ss_tot)
    } else {
        0.0
    };

    (slope, intercept, r2)
}

/// Calculates Bingham Plastic model parameters from shear rate vs. stress data.
///
/// The Bingham Plastic model is the most common model for drilling fluids:
///
/// ```text
/// τ = YP + PV × γ̇
/// ```
///
/// This function fits a linear regression to the data, where:
/// - Slope = Plastic Viscosity (PV)
/// - Y-intercept = Yield Point (YP)
///
/// # Arguments
/// * `data` - JavaScript array of `[shear_rate, shear_stress]` tuples
///   - shear_rate: γ̇ in s⁻¹
///   - shear_stress: τ in Pa
///
/// # Returns
/// `ModelResult` with parameters:
/// - `"pv"`: Plastic Viscosity in Pa·s (to convert to cP, multiply by 1000)
/// - `"yp"`: Yield Point in Pa (to convert to lbf/100ft², multiply by 2.0886)
///
/// # Errors
/// Returns error if:
/// - Data cannot be parsed
/// - Fewer than 2 data points provided
///
/// # Example (JavaScript)
/// ```javascript
/// const data = [[100, 15], [200, 25], [300, 35]]; // [rate, stress]
/// const result = await wasmModule.calculate_bingham(data);
/// console.log(result.parameters.pv); // Plastic viscosity
/// console.log(result.parameters.yp); // Yield point
/// console.log(result.r2);            // R² fit quality
/// ```
///
/// # C# Port
/// ```csharp
/// public static ModelResult CalculateBingham(List<(double rate, double stress)> data) {
///     var x = data.Select(p => p.rate).ToArray();
///     var y = data.Select(p => p.stress).ToArray();
///     var (pv, yp, r2) = LinearRegression(x, y);
///     return new ModelResult("Bingham Plastic", new Dictionary<string, double> {
///         ["pv"] = pv, ["yp"] = yp
///     }, r2);
/// }
/// ```

// NOTE: WASM-specific wrapper functions (calculate_bingham, calculate_power_law,
// calculate_all_models) have been removed. The Tauri backend calls the
// underlying pure Rust functions (linear_regression, etc.) directly.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_linear_regression() {
        let x = vec![1.0, 2.0, 3.0, 4.0, 5.0];
        let y = vec![2.0, 4.0, 6.0, 8.0, 10.0];
        let (slope, intercept, r2) = linear_regression(&x, &y);

        assert!((slope - 2.0).abs() < 1e-10);
        assert!(intercept.abs() < 1e-10);
        assert!((r2 - 1.0).abs() < 1e-10);
    }
}
