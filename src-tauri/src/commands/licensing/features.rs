#![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
//! License feature presets.
//!
//! Pure functions that return [`LicenseFeatures`] for each license type / status.
//! No I/O, no side-effects.

#[cfg(test)]
use super::types::DEMO_MAX_EXPERIMENTS;
#[cfg(test)]
use super::types::{LicenseCheckResult, LicenseStatus};
use super::types::{LicenseFeatures, LicenseType};

// ── Feature presets ────────────────────────────────────────────────────

/// Corporate license: full production feature set except calibration tooling.
pub(super) fn full_features() -> LicenseFeatures {
    LicenseFeatures {
        max_experiments: -1,
        max_comparison_experiments: 8,
        export_pdf: true,
        export_excel: true,
        ai_parsing: true,
        comparison: true,
        watermark: false,
        calibration_analysis: false,
        calibration_parsing: false,
        chandler5550_support: true,
        bsl_r1_support: true,
    }
}

/// Trial license: most features but with watermark and lower limits.
pub(super) fn trial_features() -> LicenseFeatures {
    LicenseFeatures {
        max_experiments: 50,
        max_comparison_experiments: 3,
        export_pdf: true,
        export_excel: true,
        ai_parsing: true,
        comparison: true,
        watermark: true,
        calibration_analysis: false,
        calibration_parsing: false,
        chandler5550_support: true,
        bsl_r1_support: true,
    }
}

/// Developer license: everything unlocked including calibration.
pub(super) fn developer_features() -> LicenseFeatures {
    LicenseFeatures {
        max_experiments: -1,
        max_comparison_experiments: 8,
        export_pdf: true,
        export_excel: true,
        ai_parsing: true,
        comparison: true,
        watermark: false,
        calibration_analysis: true,
        calibration_parsing: true,
        chandler5550_support: true,
        bsl_r1_support: true,
    }
}

/// Superuser (project owner) license.
///
/// Feature-wise identical to the Developer preset — everything unlocked.
/// The behavioural difference lives one layer up in `get_update_channel`,
/// which routes Superuser clients to the `alpha` release channel so they
/// receive new builds before Developer licences do.
pub(super) fn superuser_features() -> LicenseFeatures {
    // Intentionally reuses developer_features() so that adding a new flag
    // automatically applies to both tiers. Do not duplicate the literal — it
    // would drift the two presets apart over time.
    developer_features()
}

/// Demo (unregistered / trial period): limited experiments, watermark.
#[cfg(test)]
pub(super) fn demo_features() -> LicenseFeatures {
    LicenseFeatures {
        max_experiments: DEMO_MAX_EXPERIMENTS,
        max_comparison_experiments: 3,
        export_pdf: true,
        export_excel: true,
        ai_parsing: true,
        comparison: true,
        watermark: true,
        calibration_analysis: false,
        calibration_parsing: false,
        chandler5550_support: true,
        bsl_r1_support: true,
    }
}

/// Expired / invalid / revoked: nothing allowed.
pub(super) fn expired_features() -> LicenseFeatures {
    LicenseFeatures {
        max_experiments: 0,
        max_comparison_experiments: 0,
        export_pdf: false,
        export_excel: false,
        ai_parsing: false,
        comparison: false,
        watermark: true,
        calibration_analysis: false,
        calibration_parsing: false,
        chandler5550_support: false,
        bsl_r1_support: false,
    }
}

// ── Lookup helpers ─────────────────────────────────────────────────────

/// Get features for a given license type (used during activation).
pub(super) fn features_for_type(license_type: LicenseType) -> LicenseFeatures {
    match license_type {
        LicenseType::Superuser => superuser_features(),
        LicenseType::Developer => developer_features(),
        LicenseType::Trial => trial_features(),
        LicenseType::Corporate => full_features(),
    }
}

/// Get features for a computed [`LicenseCheckResult`].
/// This is the primary accessor the engine uses after determining status.
#[cfg(test)]
pub(super) fn features_for_status(result: &LicenseCheckResult) -> LicenseFeatures {
    match result.status {
        LicenseStatus::Active | LicenseStatus::Grace => {
            // If the result already carries a license_type, use it
            if let Some(ref lt) = result.license_type {
                let lt = LicenseType::from_str_loose(lt);
                features_for_type(lt)
            } else {
                full_features()
            }
        }
        LicenseStatus::Demo => demo_features(),
        LicenseStatus::Expired
        | LicenseStatus::DemoExpired
        | LicenseStatus::Invalid
        | LicenseStatus::Revoked => expired_features(),
    }
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::licensing::types::LicenseSource;

    #[test]
    fn corporate_features_no_watermark() {
        let f = full_features();
        assert!(!f.watermark);
        assert_eq!(f.max_experiments, -1);
        assert!(!f.calibration_analysis);
        assert!(!f.calibration_parsing);
    }

    #[test]
    fn developer_has_calibration() {
        let f = developer_features();
        assert!(f.calibration_analysis);
        assert!(f.calibration_parsing);
        assert!(!f.watermark);
    }

    #[test]
    fn superuser_matches_developer_feature_set() {
        // Superuser and Developer must stay feature-equivalent — the only
        // difference is the update channel routing.  If this assertion ever
        // fails, update superuser_features() deliberately.
        let s = superuser_features();
        let d = developer_features();
        assert_eq!(s.max_experiments, d.max_experiments);
        assert_eq!(s.max_comparison_experiments, d.max_comparison_experiments);
        assert_eq!(s.export_pdf, d.export_pdf);
        assert_eq!(s.export_excel, d.export_excel);
        assert_eq!(s.ai_parsing, d.ai_parsing);
        assert_eq!(s.comparison, d.comparison);
        assert_eq!(s.watermark, d.watermark);
        assert_eq!(s.calibration_analysis, d.calibration_analysis);
        assert_eq!(s.calibration_parsing, d.calibration_parsing);
        assert_eq!(s.chandler5550_support, d.chandler5550_support);
        assert_eq!(s.bsl_r1_support, d.bsl_r1_support);
    }

    #[test]
    fn features_for_type_superuser_routes_to_superuser_preset() {
        let f = features_for_type(LicenseType::Superuser);
        assert!(f.calibration_analysis);
        assert!(f.calibration_parsing);
        assert!(!f.watermark);
        assert_eq!(f.max_experiments, -1);
    }

    #[test]
    fn demo_has_limited_experiments() {
        let f = demo_features();
        assert_eq!(f.max_experiments, DEMO_MAX_EXPERIMENTS);
        assert!(f.watermark);
    }

    #[test]
    fn expired_features_all_locked() {
        let f = expired_features();
        assert_eq!(f.max_experiments, 0);
        assert!(!f.export_pdf);
        assert!(!f.export_excel);
        assert!(!f.ai_parsing);
        assert!(f.watermark);
    }

    #[test]
    fn features_for_type_trial() {
        let f = features_for_type(LicenseType::Trial);
        assert_eq!(f.max_experiments, 50);
        assert!(f.watermark);
    }

    #[test]
    fn features_for_type_corporate() {
        let f = features_for_type(LicenseType::Corporate);
        assert_eq!(f.max_experiments, -1);
        assert!(!f.watermark);
        assert!(f.comparison);
        assert!(!f.calibration_analysis);
        assert!(!f.calibration_parsing);
    }

    #[test]
    fn features_for_status_active_developer() {
        let result = LicenseCheckResult {
            status: LicenseStatus::Active,
            source: LicenseSource::Key,
            features: developer_features(),
            key: None,
            license_type: Some("developer".to_string()),
            customer_name: None,
            expires_at: None,
            days_remaining: None,
            experiments_remaining: None,
            message: None,
            show_warning: false,
        };
        let f = features_for_status(&result);
        assert!(f.calibration_analysis);
    }

    #[test]
    fn features_for_status_revoked() {
        let result = LicenseCheckResult {
            status: LicenseStatus::Revoked,
            source: LicenseSource::Key,
            features: expired_features(),
            key: None,
            license_type: None,
            customer_name: None,
            expires_at: None,
            days_remaining: None,
            experiments_remaining: None,
            message: None,
            show_warning: false,
        };
        let f = features_for_status(&result);
        assert_eq!(f.max_experiments, 0);
    }
}
