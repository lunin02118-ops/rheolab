//! Comparison report generator.
//!
//! Assembles a single PDF / XLSX document combining:
//! - sheet/page 1 — multi-experiment chart + summary roll-up,
//! - sheets/pages 2..N+1 — one compact per-experiment report each.
//!
//! See `docs/adr/ADR-0010-comparison-report-generation.md` for the approved
//! plan and the decisions locked in §6.
//!
//! Phases 1.B–1.G will fill in the actual renderers; for now this module
//! owns the type contract (`types.rs`) and utility helpers (sheet-name
//! sanitisation) that both the Excel and PDF paths share.

pub mod summary;
pub mod types;

#[cfg(feature = "excel")]
pub mod excel_comparison;

#[cfg(feature = "pdf")]
pub mod pdf_comparison;

pub use summary::{build_summaries, ExperimentSummary};
pub use types::{
    ComparisonChartConfig, ComparisonExperimentEntry, ComparisonMetrics, ComparisonReportInput,
    SectionToggles, TouchPointConfig,
};

#[cfg(feature = "excel")]
pub use excel_comparison::generate_comparison_excel;

#[cfg(feature = "pdf")]
pub use pdf_comparison::generate_comparison_pdf;

// ── Shared helpers ──────────────────────────────────────────────────────────

/// Maximum allowed worksheet-name length in Excel.  Hard-coded in the OOXML
/// spec and enforced by `rust_xlsxwriter`.
pub const EXCEL_SHEET_NAME_MAX_LEN: usize = 31;

/// Characters Excel forbids in worksheet names, plus leading/trailing apostrophes.
///
/// <https://support.microsoft.com/en-us/office/rename-a-worksheet-3f1f7148-ee83-404d-8ef0-9ff99fbad1f9>
const FORBIDDEN_SHEET_NAME_CHARS: &[char] = &['[', ']', ':', '*', '?', '/', '\\'];

/// Sanitize a single proposed sheet name: strip forbidden characters, trim
/// whitespace, and truncate to Excel's 31-char limit.  Does **not** perform
/// collision resolution — callers pass a mutable counter to
/// [`deduplicate_sheet_name`] for that.
///
/// Guaranteed post-conditions:
/// - length ≤ 31 characters (UTF-8 char count, not byte count);
/// - contains none of `[ ] : * ? / \`;
/// - is non-empty (falls back to `"Sheet"` if sanitisation emptied it).
pub fn sanitize_sheet_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| !FORBIDDEN_SHEET_NAME_CHARS.contains(c))
        .collect();

    let cleaned = cleaned.trim().trim_matches('\'').to_string();
    if cleaned.is_empty() {
        return "Sheet".to_string();
    }

    // UTF-8 safe truncate to EXCEL_SHEET_NAME_MAX_LEN *chars*.
    cleaned.chars().take(EXCEL_SHEET_NAME_MAX_LEN).collect()
}

/// Apply deterministic `_2, _3, …` suffixes when `proposed` collides with an
/// existing name in `seen`.  Respects the 31-char limit: if appending the
/// suffix would exceed it, the base name is further truncated.
///
/// The caller is expected to add the final name into `seen` — this function
/// only reads it.
///
/// ```ignore
/// # use rheolab_core::report_generator::comparison::deduplicate_sheet_name;
/// let mut seen: Vec<String> = vec!["Report".into()];
/// assert_eq!(deduplicate_sheet_name("Report", &seen), "Report_2");
/// ```
pub fn deduplicate_sheet_name(proposed: &str, seen: &[String]) -> String {
    if !seen.iter().any(|s| s == proposed) {
        return proposed.to_string();
    }

    // Start from _2 (matches common spreadsheet behaviour).
    let mut suffix = 2_usize;
    loop {
        let suffix_str = format!("_{suffix}");
        // Compute how much of the base name fits so that
        // `<base>_<suffix>` is still ≤ 31 chars.
        let base_len = EXCEL_SHEET_NAME_MAX_LEN.saturating_sub(suffix_str.chars().count());
        let base: String = proposed.chars().take(base_len).collect();
        let candidate = format!("{base}{suffix_str}");
        if !seen.iter().any(|s| s == &candidate) {
            return candidate;
        }
        suffix = suffix.saturating_add(1);
        // Defensive upper bound — we will never realistically hit this with
        // sane input sizes, but the loop must terminate.
        if suffix > 9_999 {
            return format!("Sheet_{}", suffix);
        }
    }
}

/// Full pipeline: sanitise + deduplicate a single proposed name, then push
/// the final name into `seen`.  Returns the final name used.
pub fn allocate_sheet_name(raw: &str, seen: &mut Vec<String>) -> String {
    let sanitised = sanitize_sheet_name(raw);
    let final_name = deduplicate_sheet_name(&sanitised, seen);
    seen.push(final_name.clone());
    final_name
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_forbidden_characters() {
        assert_eq!(sanitize_sheet_name("Report/[1]:*?"), "Report1");
        assert_eq!(sanitize_sheet_name("a\\b"), "ab");
    }

    #[test]
    fn truncates_to_thirty_one_chars() {
        let long = "a".repeat(80);
        let sanitised = sanitize_sheet_name(&long);
        assert_eq!(sanitised.chars().count(), EXCEL_SHEET_NAME_MAX_LEN);
    }

    #[test]
    fn handles_unicode_truncate_safely() {
        // 50 × "π" (2-byte UTF-8 char). Truncate must happen at char boundary,
        // not byte boundary, otherwise Rust would panic.
        let input = "π".repeat(50);
        let sanitised = sanitize_sheet_name(&input);
        assert_eq!(sanitised.chars().count(), EXCEL_SHEET_NAME_MAX_LEN);
    }

    #[test]
    fn empty_after_sanitisation_falls_back_to_sheet() {
        assert_eq!(sanitize_sheet_name("[]:*?"), "Sheet");
        assert_eq!(sanitize_sheet_name("   "), "Sheet");
    }

    #[test]
    fn deduplicates_with_underscore_suffix() {
        let mut seen: Vec<String> = vec!["Report".into()];
        let n = allocate_sheet_name("Report", &mut seen);
        assert_eq!(n, "Report_2");

        let n2 = allocate_sheet_name("Report", &mut seen);
        assert_eq!(n2, "Report_3");

        let n3 = allocate_sheet_name("OtherName", &mut seen);
        assert_eq!(n3, "OtherName");

        assert_eq!(seen, vec!["Report", "Report_2", "Report_3", "OtherName"]);
    }

    #[test]
    fn deduplication_respects_31_char_limit() {
        // 31 chars exactly
        let long = "x".repeat(31);
        let mut seen = vec![long.clone()];
        let n = allocate_sheet_name(&long, &mut seen);
        // _2 suffix must fit → base is truncated to 29 chars.
        assert!(n.chars().count() <= EXCEL_SHEET_NAME_MAX_LEN);
        assert!(n.ends_with("_2"));
        assert_ne!(n, long); // dedupe must return different name
    }

    #[test]
    fn forbidden_chars_removed_before_dedup() {
        let mut seen: Vec<String> = vec!["A_B".into()];
        // After sanitize "A:B" becomes "AB", then dedup doesn't trigger.
        let n = allocate_sheet_name("A:B", &mut seen);
        assert_eq!(n, "AB");
    }

    #[test]
    fn identical_sanitised_names_collide_and_dedupe() {
        // Two raw names that sanitise to the same value must get _2 / _3.
        let mut seen: Vec<String> = Vec::new();
        let a = allocate_sheet_name("Report/1", &mut seen); // → "Report1"
        let b = allocate_sheet_name("Report[1]", &mut seen); // → "Report1_2"
        assert_eq!(a, "Report1");
        assert_eq!(b, "Report1_2");
    }
}
