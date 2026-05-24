use crate::types::RheoPoint;

const R1_ROTOR_RADIUS_CM: f64 = 1.8415;
const R1B1_BOB_RADIUS_CM: f64 = 1.7245;
const R1B2_BOB_RADIUS_CM: f64 = 1.2276;
const R1B5_BOB_RADIUS_CM: f64 = 1.5987;
const R1B1_RATIO: f64 = 0.9365;
const R1B2_RATIO: f64 = 0.6666;
const R1B5_RATIO: f64 = 0.8682;

pub fn detect_geometry(rows: &[Vec<String>]) -> Option<String> {
    // Scan up to 100 rows — some instruments store geometry metadata
    // deeper than row 50 (e.g. BSL header blocks, Grace multi-section files).
    let scan_limit = std::cmp::min(rows.len(), 100);
    let full_text = rows
        .iter()
        .take(scan_limit)
        .map(|r| r.join(" ").to_lowercase())
        .collect::<Vec<_>>()
        .join(" ");

    // Normalize common geometry separators before matching
    let normalized = full_text.replace("r1/b", "r1b");

    // Many BSL test reports include a Fann35 pre-test line (sample prep viscosity)
    // in various formats.  None of these describe the actual rotor/bob pair used
    // for the main experiment — exclude them all to prevent misidentification.
    //
    // Known patterns (all appear in the metadata header, not in data rows):
    //   "Fann35 @ R1B1"   — BSL protocol header style
    //   "Fann35(R1B1)"    — compact form
    //   "Fann35 (R1B1)"   — spaced compact form
    //   "Fann35@R1B1"     — no-space variant
    //   "Fann 35 R1B1"    — space-separated
    // After normalisation the string is lower-case and r1/b→r1b, so we match
    // every separator variant with a single set of checks.
    let has_fann35_r1b1 = {
        // Build a collapsed version: remove all spaces and @ signs so that
        // "fann35 @ r1b1" → "fann35r1b1" and "fann35(r1b1)" → "fann35(r1b1)"
        let collapsed = normalized
            .replace('@', "")
            .replace('(', "")
            .replace(')', "")
            .replace(' ', "");
        collapsed.contains("fann35r1b1") || collapsed.contains("fann35ar1b1")
    };

    if normalized.contains("r1b1") && !has_fann35_r1b1 {
        return Some("R1B1".to_string());
    }
    if normalized.contains("r1b2") {
        return Some("R1B2".to_string());
    }
    if normalized.contains("r1b5") {
        return Some("R1B5".to_string());
    }

    // Spindle/Bob detection from context text
    // e.g. "Spindle: B1" or "Bob B5"
    if full_text.contains("spindle") || full_text.contains("bob") {
        // Check B5/B2 first as they are more specific than B1 (which might match other things)
        // Use spaces to avoid partial matches
        let text_padded = format!(" {} ", full_text);
        if text_padded.contains(" b5 ") || text_padded.contains(" b 5 ") {
            return Some("R1B5".to_string());
        }
        if text_padded.contains(" b2 ") || text_padded.contains(" b 2 ") {
            return Some("R1B2".to_string());
        }
        if text_padded.contains(" b1 ") || text_padded.contains(" b 1 ") {
            return Some("R1B1".to_string());
        }
    }

    if let Some(geometry) = detect_geometry_from_dimensions(&rows[..scan_limit]) {
        return Some(geometry);
    }

    None
}

fn detect_geometry_from_dimensions(rows: &[Vec<String>]) -> Option<String> {
    let mut rotor_radius_cm = None;
    let mut bob_radius_cm = None;
    let mut radius_ratio = None;

    for row in rows {
        let label = row.first().map(|s| s.as_str()).unwrap_or_default();
        let normalized = label
            .replace('\u{00A0}', " ")
            .replace(',', ".")
            .to_lowercase();

        if (normalized.contains("rotor") || normalized.contains("ротор"))
            && (normalized.contains("radius") || normalized.contains("радиус"))
        {
            rotor_radius_cm = single_numeric_value_after_label(row);
        } else if (normalized.contains("bob") || normalized.contains("боб"))
            && (normalized.contains("radius") || normalized.contains("радиус"))
        {
            bob_radius_cm = single_numeric_value_after_label(row);
        } else if normalized.contains("radii ratio")
            || normalized.contains("radius ratio")
            || normalized.contains("отнош")
        {
            radius_ratio = single_numeric_value_after_label(row);
        }
    }

    if let Some(rb) = bob_radius_cm {
        let rotor_is_r1 = rotor_radius_cm
            .map(|rc| approx_abs(rc, R1_ROTOR_RADIUS_CM, 0.02))
            .unwrap_or(true);
        if rotor_is_r1 {
            if approx_abs(rb, R1B1_BOB_RADIUS_CM, 0.005) {
                return Some("R1B1".to_string());
            }
            if approx_abs(rb, R1B2_BOB_RADIUS_CM, 0.005) {
                return Some("R1B2".to_string());
            }
            if approx_abs(rb, R1B5_BOB_RADIUS_CM, 0.005) {
                return Some("R1B5".to_string());
            }
        }
    }

    if let Some(ratio) = radius_ratio {
        if approx_abs(ratio, R1B1_RATIO, 0.005) {
            return Some("R1B1".to_string());
        }
        if approx_abs(ratio, R1B2_RATIO, 0.005) {
            return Some("R1B2".to_string());
        }
        if approx_abs(ratio, R1B5_RATIO, 0.005) {
            return Some("R1B5".to_string());
        }
    }

    None
}

fn single_numeric_value_after_label(row: &[String]) -> Option<f64> {
    let values = row
        .iter()
        .skip(1)
        .filter_map(|cell| parse_number(cell))
        .filter(|value| value.is_finite() && *value > 0.0 && *value < 100.0)
        .collect::<Vec<_>>();

    if values.len() == 1 {
        Some(values[0])
    } else {
        None
    }
}

fn parse_number(value: &str) -> Option<f64> {
    value
        .trim()
        .replace('\u{00A0}', "")
        .replace(' ', "")
        .replace(',', ".")
        .parse::<f64>()
        .ok()
        .filter(|v| v.is_finite())
}

fn approx_abs(actual: f64, expected: f64, tolerance: f64) -> bool {
    (actual - expected).abs() <= tolerance
}

/// Minimum number of valid RPM+stress+viscosity triples required before we trust
/// physics-based geometry inference.  Too few points → the K-factor average is
/// unreliable (e.g. one-point calibration blobs).
const MIN_PHYSICS_POINTS: usize = 20;

/// Result of a physics-based geometry check.
#[derive(Debug, Clone)]
pub struct PhysicsGeometry {
    /// The inferred geometry name
    pub geometry: String,
    /// Median K-factor computed from the data
    pub avg_k: f64,
    /// Number of valid data points used
    pub n_points: usize,
}

pub fn verify_with_physics(data: &[RheoPoint]) -> Option<String> {
    physics_geometry(data).map(|r| r.geometry)
}

/// Full physics-geometry result including the computed K-factor and sample size.
/// Returns `None` when there are too few points or no geometry matches.
pub fn physics_geometry(data: &[RheoPoint]) -> Option<PhysicsGeometry> {
    // Project each point into (shear_stress, rpm, viscosity) where ALL three
    // values are present and > 0.  Using `filter_map` here eliminates the need
    // for separate `.filter(..) + .unwrap()` passes and removes two unwrap
    // call sites that relied on an implicit "fields-are-Some" invariant.
    let valid_points: Vec<(f64, f64, f64)> = data
        .iter()
        .filter_map(|p| {
            let stress = p.shear_stress?;
            let rpm = p.rpm?;
            if stress > 0.0 && rpm > 0.0 && p.viscosity_cp > 0.0 {
                Some((stress, rpm, p.viscosity_cp))
            } else {
                None
            }
        })
        .collect();

    if valid_points.len() < MIN_PHYSICS_POINTS {
        return None;
    }
    let n_points = valid_points.len();

    // Use median instead of mean to be robust against outlier rows
    // (e.g. ramp transitions, initial equilibration spikes).
    let mut k_values: Vec<f64> = valid_points
        .iter()
        .map(|(stress, rpm, viscosity)| {
            let calc_rate = (stress * 1000.0) / viscosity;
            calc_rate / rpm
        })
        .collect();
    k_values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mid = k_values.len() / 2;
    let median_k = if k_values.len() % 2 == 0 {
        (k_values[mid - 1] + k_values[mid]) / 2.0
    } else {
        k_values[mid]
    };

    let (geometry, tolerance) = if (median_k - 1.703).abs() < 0.25 {
        ("R1B1", 0.25)
    } else if (median_k - 0.377).abs() < 0.12 {
        ("R1B2", 0.12)
    } else if (median_k - 0.847).abs() < 0.18 {
        ("R1B5", 0.18)
    } else {
        return None;
    };
    let _ = tolerance;

    Some(PhysicsGeometry {
        geometry: geometry.to_string(),
        avg_k: median_k,
        n_points,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_geometry_from_explicit_rotor_and_bob_names() {
        let rows = vec![
            vec!["Rotor Number:".to_string(), "R1".to_string()],
            vec!["Bob Number:".to_string(), "B5".to_string()],
        ];

        assert_eq!(detect_geometry(&rows), Some("R1B5".to_string()));
    }

    #[test]
    fn detects_geometry_from_single_bob_radius_when_name_is_absent() {
        let rows = vec![
            vec!["Rotor Radius (cm)".to_string(), "1.8415".to_string()],
            vec!["Bob Radius (cm)".to_string(), "1.5987".to_string()],
        ];

        assert_eq!(detect_geometry(&rows), Some("R1B5".to_string()));
    }

    #[test]
    fn detects_r1b2_from_standard_bob_radius() {
        let rows = vec![
            vec!["Rotor Radius, cm".to_string(), "1.8415".to_string()],
            vec!["Bob Radius, cm".to_string(), "1.2276".to_string()],
        ];

        assert_eq!(detect_geometry(&rows), Some("R1B2".to_string()));
    }

    #[test]
    fn does_not_guess_from_reference_table_with_multiple_geometry_columns() {
        let rows = vec![vec![
            "Bob Radius, cm".to_string(),
            "1.7245".to_string(),
            "1.2276".to_string(),
            "1.5987".to_string(),
        ]];

        assert_eq!(detect_geometry(&rows), None);
    }
}
