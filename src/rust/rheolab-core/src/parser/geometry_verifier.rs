use crate::types::RheoPoint;

pub fn detect_geometry(rows: &[Vec<String>]) -> Option<String> {
    // Scan up to 100 rows — some instruments store geometry metadata
    // deeper than row 50 (e.g. BSL header blocks, Grace multi-section files).
    let scan_limit = std::cmp::min(rows.len(), 100);
    let full_text = rows.iter().take(scan_limit)
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
        if text_padded.contains(" b5 ") || text_padded.contains(" b 5 ") { return Some("R1B5".to_string()); }
        if text_padded.contains(" b2 ") || text_padded.contains(" b 2 ") { return Some("R1B2".to_string()); }
        if text_padded.contains(" b1 ") || text_padded.contains(" b 1 ") { return Some("R1B1".to_string()); }
    }

    None
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
