//! Filename Parser - Extracts recipe and metadata from structured filenames
//!
//! Migrated from src/lib/parser/FilenameParser.ts
//!
//! Supported filename format:
//! {testId} {testType} {fieldName}_({destination}) {recipe}@{temp}C {date}.csv
//!
//! Example: 8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25.csv

use regex::Regex;
use serde::{Deserialize, Serialize};

/// Recipe component extracted from filename
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RecipeComponent {
    pub abbreviation: String,
    pub concentration: f64,
    pub unit: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reagent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reagent_name: Option<String>,
}

/// Metadata extracted from filename
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FilenameMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_type_full: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination: Option<String>,
    pub recipe: Vec<RecipeComponent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_date: Option<String>, // ISO format date string
    pub raw_filename: String,
}

/// Catalog item for matching reagents
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CatalogItem {
    pub id: String,
    pub name: String,
    pub category: String,
}

// ── Static regex patterns ───────────────────────────────────────────────────
//
// The `.expect()` calls below are executed at most once per pattern (first
// access to the `LazyLock`) and are invariant-guarded: each pattern is a
// compile-time string literal known to be a valid regex.  A failure here
// would indicate a developer error in editing the pattern string, which is
// caught by `parser::tests::regex_patterns_compile` on every test run.

// Recipe regex: CONCENTRATION(REAGENT_NAME)
static RECIPE_REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"(\d+(?:\.\d+)?)\(([A-Za-z0-9\-]+)\)").expect("RECIPE_REGEX pattern is static and valid"));
// Date regex: DD.MM.YY or DD.MM.YYYY at end
static DATE_REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"(\d{2})\.(\d{2})(?:\.(\d{2,4}))?$").expect("DATE_REGEX pattern is static and valid"));
// Temperature regex: @XXC
static TEMP_REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"@(\d+)[Cc]").expect("TEMP_REGEX pattern is static and valid"));
// Field and destination regex: FieldName_(destination)
static FIELD_DEST_REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"([A-Za-zА-Яа-яёЁ]+)_\(([^)]+)\)").expect("FIELD_DEST_REGEX pattern is static and valid"));
// Test ID: digits at start
static TEST_ID_REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"^\d+$").expect("TEST_ID_REGEX pattern is static and valid"));
// Test type: 2-4 uppercase letters
static TEST_TYPE_REGEX: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"^[A-Z]{2,4}$").expect("TEST_TYPE_REGEX pattern is static and valid"));
// Category patterns
static GELLING_AGENT_PATTERN: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"(?i)^(WG-\d+|HPG-\d+|HEC-\d+|CMC|ГУАР|Guar)").expect("GELLING_AGENT_PATTERN pattern is static and valid"));
static CROSSLINKER_PATTERN: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"(?i)^(WCL|XL-\d+|CL-\d+|Borate|Zirconate|Titanate|СШ-\d+)").expect("CROSSLINKER_PATTERN pattern is static and valid"));
static BREAKER_PATTERN: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"(?i)^(HT-\d+|EB-\d+|OX-\d+|Breaker|Деструктор)").expect("BREAKER_PATTERN pattern is static and valid"));
static BUFFER_PATTERN: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"(?i)^(Buffer|pH-\d+|Буфер)").expect("BUFFER_PATTERN pattern is static and valid"));
static FRICTION_REDUCER_PATTERN: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"(?i)^FR-\d+").expect("FRICTION_REDUCER_PATTERN pattern is static and valid"));
static CLAY_CONTROL_PATTERN: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"(?i)^KCl$").expect("CLAY_CONTROL_PATTERN pattern is static and valid"));
static STABILIZER_PATTERN: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| Regex::new(r"(?i)^(THPS|TS-\d+)").expect("STABILIZER_PATTERN pattern is static and valid"));

/// Get full test type name
fn get_test_type_full(test_type: &str) -> &'static str {
    match test_type {
        "SST" => "Shear Stability Test (тест на сдвиг)",
        "SWB" => "Shear sweep With Breaker (тест с брейкером)",
        "HST" => "High Shear Test",
        "LVT" => "Low Viscosity Test",
        _ => "Unknown Test Type",
    }
}

/// Detect reagent category from abbreviation
fn detect_category(abbreviation: &str) -> Option<String> {
    if GELLING_AGENT_PATTERN.is_match(abbreviation) {
        return Some("Gelling Agent".to_string());
    }
    if CROSSLINKER_PATTERN.is_match(abbreviation) {
        return Some("Crosslinker".to_string());
    }
    if BREAKER_PATTERN.is_match(abbreviation) {
        return Some("Breaker".to_string());
    }
    if BUFFER_PATTERN.is_match(abbreviation) {
        return Some("Buffer".to_string());
    }
    if FRICTION_REDUCER_PATTERN.is_match(abbreviation) {
        return Some("Friction Reducer".to_string());
    }
    if CLAY_CONTROL_PATTERN.is_match(abbreviation) {
        return Some("Clay Control".to_string());
    }
    if STABILIZER_PATTERN.is_match(abbreviation) {
        return Some("Stabilizer".to_string());
    }
    None
}

/// Parse a filename to extract recipe and metadata
pub fn parse_filename(filename: &str) -> FilenameMetadata {
    // Remove file extension
    let base_name = filename
        .trim_end_matches(".csv")
        .trim_end_matches(".CSV")
        .trim_end_matches(".xlsx")
        .trim_end_matches(".XLSX")
        .trim_end_matches(".xls")
        .trim_end_matches(".XLS")
        .trim_end_matches(".txt")
        .trim_end_matches(".TXT")
        .trim_end_matches(".dat")
        .trim_end_matches(".DAT");

    let mut result = FilenameMetadata {
        test_id: None,
        test_type: None,
        test_type_full: None,
        field_name: None,
        destination: None,
        recipe: Vec::new(),
        temperature: None,
        test_date: None,
        raw_filename: filename.to_string(),
    };

    // Extract test date (DD.MM.YY or DD.MM.YYYY at end)
    //
    // Groups 1 and 2 are mandatory in DATE_REGEX, so `.get(1)` / `.get(2)`
    // are guaranteed to be `Some(..)` when `captures()` returns `Some`.
    // We still use `.and_then(parse)` + `.unwrap_or(default)` to keep the
    // function panic-free even if that invariant ever changes.
    if let Some(caps) = DATE_REGEX.captures(base_name) {
        let day: u32 = caps.get(1)
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(1);
        let month: u32 = caps.get(2)
            .and_then(|m| m.as_str().parse().ok())
            .unwrap_or(1);
        let year: i32 = caps.get(3)
            .and_then(|m| m.as_str().parse::<i32>().ok())
            .map(|y| if y < 100 { y + 2000 } else { y })
            .unwrap_or(2026); // default if no year provided
        result.test_date = Some(format!("{:04}-{:02}-{:02}", year, month, day));
    }

    // Extract temperature (@XXC pattern)
    if let Some(caps) = TEMP_REGEX.captures(base_name) {
        result.temperature = caps.get(1).and_then(|m| m.as_str().parse().ok());
    }

    // Extract recipe components: CONCENTRATION(REAGENT_NAME)
    //
    // RECIPE_REGEX declares both groups as mandatory; if either group is
    // missing we treat the match as malformed and skip it instead of
    // panicking.
    for caps in RECIPE_REGEX.captures_iter(base_name) {
        let Some(concentration_match) = caps.get(1) else { continue };
        let Some(abbreviation_match) = caps.get(2) else { continue };
        let concentration: f64 = concentration_match.as_str().parse().unwrap_or(0.0);
        let abbreviation = abbreviation_match.as_str().to_string();
        let category = detect_category(&abbreviation);

        result.recipe.push(RecipeComponent {
            abbreviation,
            concentration,
            unit: "kg/m³".to_string(),
            category,
            reagent_id: None,
            reagent_name: None,
        });
    }

    // Extract test ID and type (first two words)
    let parts: Vec<&str> = base_name.split_whitespace().collect();
    if !parts.is_empty() && TEST_ID_REGEX.is_match(parts[0]) {
        result.test_id = Some(parts[0].to_string());
    }
    if parts.len() >= 2 && TEST_TYPE_REGEX.is_match(parts[1]) {
        result.test_type = Some(parts[1].to_string());
        result.test_type_full = Some(get_test_type_full(parts[1]).to_string());
    }

    // Extract field name and destination: FieldName_(destination)
    if let Some(caps) = FIELD_DEST_REGEX.captures(base_name) {
        result.field_name = caps.get(1).map(|m| m.as_str().to_string());
        result.destination = caps.get(2).map(|m| m.as_str().replace('_', " "));
    }

    result
}

/// Match parsed recipe components against a reagent catalog
pub fn match_with_catalog(recipe: &mut [RecipeComponent], catalog: &[CatalogItem]) {
    for component in recipe.iter_mut() {
        // Try exact name match
        if let Some(item) = catalog.iter().find(|c| c.name.eq_ignore_ascii_case(&component.abbreviation)) {
            component.reagent_id = Some(item.id.clone());
            component.reagent_name = Some(item.name.clone());
            component.category = Some(item.category.clone());
            continue;
        }

        // Try to find by category (if only one match)
        if let Some(cat) = &component.category {
            let category_matches: Vec<&CatalogItem> = catalog.iter()
                .filter(|c| c.category == *cat)
                .collect();
            if category_matches.len() == 1 {
                component.reagent_id = Some(category_matches[0].id.clone());
                component.reagent_name = Some(category_matches[0].name.clone());
            }
        }
    }
}

/// Check if filename looks like it contains recipe information
pub fn has_recipe_format(filename: &str) -> bool {
    RECIPE_REGEX.is_match(filename)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_filename_full() {
        let filename = "8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25.csv";
        let result = parse_filename(filename);

        assert_eq!(result.test_id, Some("8958".to_string()));
        assert_eq!(result.test_type, Some("SWB".to_string()));
        assert_eq!(result.field_name, Some("Mamontovskoe".to_string()));
        assert_eq!(result.destination, Some("lake 274 pad".to_string()));
        assert_eq!(result.temperature, Some(96));
        assert_eq!(result.test_date, Some("2025-10-30".to_string()));

        assert_eq!(result.recipe.len(), 3);
        assert_eq!(result.recipe[0].abbreviation, "WG-9000F");
        assert!((result.recipe[0].concentration - 3.4).abs() < 0.01);
        assert_eq!(result.recipe[0].category, Some("Gelling Agent".to_string()));

        assert_eq!(result.recipe[1].abbreviation, "WCL");
        assert_eq!(result.recipe[1].category, Some("Crosslinker".to_string()));

        assert_eq!(result.recipe[2].abbreviation, "HT-3");
        assert_eq!(result.recipe[2].category, Some("Breaker".to_string()));
    }

    #[test]
    fn test_parse_filename_sst() {
        let filename = "8957 SST Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@63C 30.10.25.csv";
        let result = parse_filename(filename);

        assert_eq!(result.test_id, Some("8957".to_string()));
        assert_eq!(result.test_type, Some("SST".to_string()));
        assert_eq!(result.test_type_full, Some("Shear Stability Test (тест на сдвиг)".to_string()));
        assert_eq!(result.temperature, Some(63));
    }

    #[test]
    fn test_has_recipe_format() {
        assert!(has_recipe_format("3.4(WG-9000F)-2.8(WCL).csv"));
        assert!(!has_recipe_format("some_random_file.csv"));
        assert!(!has_recipe_format("test_data_2025.xlsx"));
    }

    #[test]
    fn test_detect_category() {
        assert_eq!(detect_category("WG-9000F"), Some("Gelling Agent".to_string()));
        assert_eq!(detect_category("HPG-100"), Some("Gelling Agent".to_string()));
        assert_eq!(detect_category("WCL"), Some("Crosslinker".to_string()));
        assert_eq!(detect_category("HT-3"), Some("Breaker".to_string()));
        assert_eq!(detect_category("Buffer"), Some("Buffer".to_string()));
        assert_eq!(detect_category("KCl"), Some("Clay Control".to_string()));
        assert_eq!(detect_category("UNKNOWN"), None);
    }

    #[test]
    fn test_match_with_catalog() {
        let mut recipe = vec![
            RecipeComponent {
                abbreviation: "WG-9000F".to_string(),
                concentration: 3.4,
                unit: "kg/m³".to_string(),
                category: Some("Gelling Agent".to_string()),
                reagent_id: None,
                reagent_name: None,
            },
        ];

        let catalog = vec![
            CatalogItem {
                id: "reagent-001".to_string(),
                name: "WG-9000F".to_string(),
                category: "Gelling Agent".to_string(),
            },
        ];

        match_with_catalog(&mut recipe, &catalog);

        assert_eq!(recipe[0].reagent_id, Some("reagent-001".to_string()));
        assert_eq!(recipe[0].reagent_name, Some("WG-9000F".to_string()));
    }
}
