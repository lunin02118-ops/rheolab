//! Numerical utilities used by both BSL and Chandler calibration parsers:
//! linear regression, average curve grouping by RPM, hysteresis, standard
//! deviation, and linear interpolation on a sorted (signal, stress) curve.

use super::super::CalibrationDataPoint;

pub(super) struct LinearRegression {
    pub slope: f64,
    pub intercept: f64,
    pub r_squared: f64,
}

pub(super) fn calculate_linear_regression(x: &[f64], y: &[f64]) -> LinearRegression {
    let n = x.len() as f64;
    if n == 0.0 {
        return LinearRegression {
            slope: 0.0,
            intercept: 0.0,
            r_squared: 0.0,
        };
    }

    let sum_x: f64 = x.iter().sum();
    let sum_y: f64 = y.iter().sum();
    let sum_xy: f64 = x.iter().zip(y.iter()).map(|(xi, yi)| xi * yi).sum();
    let sum_xx: f64 = x.iter().map(|xi| xi * xi).sum();
    let sum_yy: f64 = y.iter().map(|yi| yi * yi).sum();

    let slope = (n * sum_xy - sum_x * sum_y) / (n * sum_xx - sum_x * sum_x);
    let intercept = (sum_y - slope * sum_x) / n;

    let numerator = n * sum_xy - sum_x * sum_y;
    let denominator = ((n * sum_xx - sum_x * sum_x) * (n * sum_yy - sum_y * sum_y)).sqrt();
    let r = if denominator != 0.0 {
        numerator / denominator
    } else {
        0.0
    };

    LinearRegression {
        slope,
        intercept,
        r_squared: r * r,
    }
}

/// Calculate average curve grouped by RPM, returns (signal, stress) sorted by signal.
pub(super) fn calculate_average_curve(data: &[CalibrationDataPoint]) -> Vec<(f64, f64)> {
    let mut groups: std::collections::HashMap<String, (f64, f64, usize)> =
        std::collections::HashMap::new();

    for p in data {
        let key = format!("{:.0}", p.rpm); // Group by RPM
        let entry = groups.entry(key).or_insert((0.0, 0.0, 0));
        entry.0 += p.signal; // sum of signals
        entry.1 += p.shear_stress; // sum of stresses
        entry.2 += 1; // count
    }

    let mut result: Vec<(f64, f64)> = groups
        .values()
        .map(|(sum_signal, sum_stress, count)| {
            let avg_signal = sum_signal / *count as f64;
            let avg_stress = sum_stress / *count as f64;
            (avg_signal, avg_stress) // (X, Y) = (signal, stress)
        })
        .collect();

    // Sort by signal (X) for correct interpolation
    result.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    result
}

pub(super) fn calculate_hysteresis(data: &[CalibrationDataPoint], avg_curve: &[(f64, f64)]) -> f64 {
    // Chandler calculates hysteresis as max deviation from average curve
    // Average curve is grouped by RPM, sorted by signal (X)
    if data.is_empty() || avg_curve.is_empty() {
        return 0.0;
    }

    let mut max_deviation = 0.0;

    for p in data {
        let theoretical_stress = interpolate_curve(p.signal, avg_curve);
        let deviation = (p.shear_stress - theoretical_stress).abs();
        if deviation > max_deviation {
            max_deviation = deviation;
        }
    }

    max_deviation
}

pub(super) fn calculate_stdev(data: &[CalibrationDataPoint], avg_curve: &[(f64, f64)]) -> f64 {
    // Chandler calculates STDEV of deviations from average curve
    // Uses N-1 (sample standard deviation)
    let n = data.len();
    if n < 2 {
        return 0.0;
    }

    let sum_sq_errors: f64 = data
        .iter()
        .map(|p| {
            let theoretical_stress = interpolate_curve(p.signal, avg_curve);
            let deviation = p.shear_stress - theoretical_stress;
            deviation * deviation
        })
        .sum();

    // N-1 for sample standard deviation
    (sum_sq_errors / (n - 1) as f64).sqrt()
}

/// Linear interpolation on average curve (sorted by signal/X).
fn interpolate_curve(x: f64, curve: &[(f64, f64)]) -> f64 {
    if curve.is_empty() {
        return 0.0;
    }
    if curve.len() == 1 {
        return curve[0].1;
    }

    // Extrapolate if x is outside range
    if x <= curve[0].0 {
        let (x1, y1) = curve[0];
        let (x2, y2) = curve[1];
        if (x2 - x1).abs() < 1e-9 {
            return y1;
        }
        return y1 + (x - x1) * (y2 - y1) / (x2 - x1);
    }
    if x >= curve[curve.len() - 1].0 {
        let (x1, y1) = curve[curve.len() - 2];
        let (x2, y2) = curve[curve.len() - 1];
        if (x2 - x1).abs() < 1e-9 {
            return y2;
        }
        return y1 + (x - x1) * (y2 - y1) / (x2 - x1);
    }

    // Find interval and interpolate
    for i in 0..curve.len() - 1 {
        let (x1, y1) = curve[i];
        let (x2, y2) = curve[i + 1];
        if x >= x1 && x <= x2 {
            if (x2 - x1).abs() < 1e-9 {
                return y1;
            }
            return y1 + (x - x1) * (y2 - y1) / (x2 - x1);
        }
    }

    0.0
}
