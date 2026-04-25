//! Integration tests: AI parsing verified against gold standard.
//!
//! For EVERY fixture, checks ALL fields of EVERY row from firstRows AND lastRows
//! as defined in tests/fixtures/gold-standard.json (version 2.0).
//!
//! Run sanitized real-provider AI smoke tests:
//!   $env:RUN_REAL_GROQ_AI_TESTS="1"
//!   $env:GROQ_API_KEY="gsk_..."
//!   cargo test --test ai_parsing test_ai_smoke_ -- --nocapture
//!
//! Run unsanitized real fixture tests explicitly:
//!   $env:RUN_REAL_GROQ_FIXTURE_TESTS="1"
//!   $env:GROQ_API_KEY="gsk_..."
//!   cargo test --test ai_parsing test_ai_ -- --nocapture

use async_trait::async_trait;
use calamine::Reader;
use rheolab_core::parser::rheo_parser::{extract_ai_context_candidates, extract_candidate_headers};
use rheolab_core::parser::types::{AiContextCandidate, AiMappedColumn, AiMappingResponse};
use rheolab_enterprise::commands::parsing::{
    parsing_parse_file_with_ai_mapper, parsing_parse_file_with_resolved_ai_key, AiColumnMapper,
    ParseFileResponse, ParseRequest, StubAiColumnMapper,
};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

/// Temporary structural diagnostic: print BSL XLSX raw cell layout.
/// cargo test --test ai_parsing test_bsl_structure -- --nocapture
#[test]
fn test_bsl_structure() {
    use std::fs;
    use std::io::Cursor;
    for fixture in [
        "Отчёт BSL.xlsx",
        "562@60C.xlsx",
        "Отчёт Chandler.xls",
        "November102008-2.xls",
    ] {
        let path = fixtures_dir().join(fixture);
        let bytes = fs::read(&path).expect("fixture read");
        eprintln!("\n══ {fixture} ══");

        macro_rules! print_wb {
            ($wb:expr) => {{
                for sheet in $wb.sheet_names().to_owned() {
                    if let Some(Ok(range)) = $wb.worksheet_range(&sheet) {
                        eprintln!(
                            "  sheet={:?}  {}r×{}c",
                            sheet,
                            range.height(),
                            range.width()
                        );
                        let rows: Vec<Vec<String>> = range
                            .rows()
                            .map(|row| {
                                row.iter()
                                    .map(|c| match c {
                                        calamine::DataType::String(v) => format!("S|{v}"),
                                        calamine::DataType::Int(v) => format!("I|{v}"),
                                        calamine::DataType::Float(v) => format!("F|{:.3}", v),
                                        calamine::DataType::Bool(b) => format!("B|{b}"),
                                        _ => String::new(),
                                    })
                                    .collect()
                            })
                            .collect();
                        // Print first 5 rows + rows around index 33-42
                        let print_range: Vec<usize> =
                            (0..5).chain(15..28).chain(33..43.min(rows.len())).collect();
                        let mut last = usize::MAX;
                        for i in print_range {
                            if i >= rows.len() {
                                break;
                            }
                            if i != last.wrapping_add(1) && last != usize::MAX {
                                eprintln!("    ...");
                            }
                            let non_empty: Vec<_> = rows[i]
                                .iter()
                                .enumerate()
                                .filter(|(_, v)| !v.is_empty())
                                .collect();
                            if !non_empty.is_empty() {
                                eprintln!("    row[{i:>4}]: {:?}", non_empty);
                            }
                            last = i;
                        }
                    }
                }
            }};
        }

        let cursor = Cursor::new(bytes.clone());
        if let Ok(mut wb) = calamine::open_workbook_from_rs::<calamine::Xlsx<_>, _>(cursor) {
            print_wb!(wb);
        } else if let Ok(mut wb) =
            calamine::open_workbook_from_rs::<calamine::Xls<_>, _>(Cursor::new(bytes))
        {
            print_wb!(wb);
        }
    }
}

// ── Infrastructure ────────────────────────────────────────────────────────────

fn fixtures_dir() -> PathBuf {
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    PathBuf::from(manifest).join("../tests/fixtures")
}

fn require_smoke_api_key() -> Option<String> {
    if std::env::var("RUN_REAL_GROQ_AI_TESTS").ok().as_deref() != Some("1") {
        eprintln!("SKIP - RUN_REAL_GROQ_AI_TESTS != 1");
        return None;
    }
    match std::env::var("GROQ_API_KEY") {
        Ok(k) if !k.is_empty() => Some(k),
        _ => {
            eprintln!("SKIP - GROQ_API_KEY not set");
            None
        }
    }
}

fn require_fixture_api_key() -> Option<String> {
    if std::env::var("RUN_REAL_GROQ_FIXTURE_TESTS").ok().as_deref() != Some("1") {
        eprintln!("SKIP - RUN_REAL_GROQ_FIXTURE_TESTS != 1");
        return None;
    }
    match std::env::var("GROQ_API_KEY") {
        Ok(k) if !k.is_empty() => Some(k),
        _ => {
            eprintln!("SKIP - GROQ_API_KEY not set");
            None
        }
    }
}

fn mapping_from_candidate(candidate: &AiContextCandidate) -> AiMappingResponse {
    let mut mapping = BTreeMap::new();
    let heuristic = &candidate.heuristic_mapping;

    if let Some(index) = heuristic.time_col {
        mapping.insert(
            "time_sec".to_string(),
            AiMappedColumn {
                index,
                confidence: Some(0.99),
            },
        );
    }
    if let Some(index) = heuristic.viscosity_col {
        mapping.insert(
            "viscosity_cp".to_string(),
            AiMappedColumn {
                index,
                confidence: Some(0.99),
            },
        );
    }
    if let Some(index) = heuristic.temperature_col {
        mapping.insert(
            "temperature_c".to_string(),
            AiMappedColumn {
                index,
                confidence: Some(0.99),
            },
        );
    }
    if let Some(index) = heuristic.bath_temp_col {
        mapping.insert(
            "bath_temperature_c".to_string(),
            AiMappedColumn {
                index,
                confidence: Some(0.99),
            },
        );
    }
    if let Some(index) = heuristic.rpm_col {
        mapping.insert(
            "speed_rpm".to_string(),
            AiMappedColumn {
                index,
                confidence: Some(0.99),
            },
        );
    }
    if let Some(index) = heuristic.shear_rate_col {
        mapping.insert(
            "shear_rate_s1".to_string(),
            AiMappedColumn {
                index,
                confidence: Some(0.99),
            },
        );
    }
    if let Some(index) = heuristic.shear_stress_col {
        mapping.insert(
            "shear_stress_pa".to_string(),
            AiMappedColumn {
                index,
                confidence: Some(0.99),
            },
        );
    }
    if let Some(index) = heuristic.pressure_col {
        mapping.insert(
            "pressure_bar".to_string(),
            AiMappedColumn {
                index,
                confidence: Some(0.99),
            },
        );
    }

    AiMappingResponse {
        selected_candidate: 0,
        mapping,
    }
}

async fn parse_with_stub_mapper(
    filename: &str,
    bytes: Option<Vec<u8>>,
    force_ai: bool,
    mapper: &dyn AiColumnMapper,
) -> ParseFileResponse {
    let file_path = if bytes.is_none() {
        let path = fixtures_dir().join(filename);
        assert!(path.exists(), "Fixture not found: {}", path.display());
        Some(path.to_str().unwrap().to_string())
    } else {
        None
    };
    let req = ParseRequest {
        filename: filename.to_string(),
        file_path,
        bytes,
        force_ai: Some(force_ai),
        ai_model: Some("stub-model".to_string()),
    };
    parsing_parse_file_with_ai_mapper(req, Some("stub-key".to_string()), mapper)
        .await
        .unwrap_or_else(|e| panic!("stub parsing failed for {filename}: {e}"))
}

struct CountingFailMapper {
    calls: Arc<AtomicUsize>,
}

#[async_trait]
impl AiColumnMapper for CountingFailMapper {
    async fn map_columns(
        &self,
        _candidates: &[AiContextCandidate],
        _requested_model: Option<&str>,
    ) -> rheolab_enterprise::error::Result<AiMappingResponse> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Err("counting mapper should not have been called"
            .to_string()
            .into())
    }

    fn provider_name(&self) -> &'static str {
        "counting-stub"
    }

    fn prompt_version(&self) -> &'static str {
        "counting-stub"
    }

    fn resolve_model_name(&self, requested_model: Option<&str>) -> String {
        requested_model.unwrap_or("counting-stub").to_string()
    }
}

async fn parse_force_ai(filename: &str, api_key: &str) -> ParseFileResponse {
    let file_path = fixtures_dir().join(filename);
    assert!(
        file_path.exists(),
        "Fixture not found: {}",
        file_path.display()
    );
    let req = ParseRequest {
        filename: filename.to_string(),
        file_path: Some(file_path.to_str().unwrap().to_string()),
        bytes: None,
        force_ai: Some(true),
        ai_model: Some("meta-llama/llama-4-scout-17b-16e-instruct".to_string()),
    };
    parsing_parse_file_with_resolved_ai_key(req, Some(api_key.to_string()))
        .await
        .unwrap_or_else(|e| panic!("parsing_parse_file failed for {filename}: {e}"))
}

async fn parse_force_ai_bytes(filename: &str, bytes: Vec<u8>, api_key: &str) -> ParseFileResponse {
    let req = ParseRequest {
        filename: filename.to_string(),
        file_path: None,
        bytes: Some(bytes),
        force_ai: Some(true),
        ai_model: Some("meta-llama/llama-4-scout-17b-16e-instruct".to_string()),
    };
    parsing_parse_file_with_resolved_ai_key(req, Some(api_key.to_string()))
        .await
        .unwrap_or_else(|e| panic!("parsing_parse_file failed for {filename}: {e}"))
}

async fn parse_heuristic(filename: &str) -> ParseFileResponse {
    let file_path = fixtures_dir().join(filename);
    let req = ParseRequest {
        filename: filename.to_string(),
        file_path: Some(file_path.to_str().unwrap().to_string()),
        bytes: None,
        force_ai: None,
        ai_model: None,
    };
    parsing_parse_file_with_resolved_ai_key(req, None)
        .await
        .unwrap_or_else(|e| panic!("heuristic parse failed for {filename}: {e}"))
}

// ── Gold row type ─────────────────────────────────────────────────────────────

/// One row from gold-standard.json with all fields.
struct GoldRow {
    time_sec: f64,
    sample_temp_c: f64,
    bath_temperature_c: Option<f64>,
    shear_rate_1s: f64,
    shear_stress_pa: Option<f64>,
    viscosity_cp: f64,
    pressure_bar: Option<f64>,
}

impl GoldRow {
    fn check(&self, actual: &rheolab_enterprise::commands::parsing::ParsedPoint, label: &str) {
        chk(
            actual.time_sec,
            self.time_sec,
            2.0,
            &format!("{label} time_sec"),
        );
        chk(
            actual.temperature_c,
            self.sample_temp_c,
            2.0,
            &format!("{label} temperature_c"),
        );
        chk(
            actual.viscosity_cp,
            self.viscosity_cp,
            2.0,
            &format!("{label} viscosity_cp"),
        );
        chk(
            actual.shear_rate_s1,
            self.shear_rate_1s,
            2.0,
            &format!("{label} shear_rate"),
        );
        if let Some(ss) = self.shear_stress_pa {
            chk(
                actual.shear_stress_pa,
                ss,
                2.0,
                &format!("{label} shear_stress_pa"),
            );
        }
        if let Some(p) = self.pressure_bar {
            if p > 0.0 {
                chk(
                    actual.pressure_bar,
                    p,
                    5.0,
                    &format!("{label} pressure_bar"),
                );
            }
        }
        if let Some(bath) = self.bath_temperature_c {
            let got = actual.bath_temperature_c.unwrap_or(f64::NAN);
            chk(got, bath, 2.0, &format!("{label} bath_temperature_c"));
        }
    }
}

/// Assert two f64 are within `tol_pct`% of each other (relative tolerance).
fn chk(actual: f64, expected: f64, tol_pct: f64, label: &str) {
    if expected == 0.0 {
        assert!(actual.abs() < 0.01, "{label}: expected 0 got {actual}");
        return;
    }
    let pct = (actual - expected).abs() / expected.abs() * 100.0;
    assert!(
        pct < tol_pct,
        "{label}:\n  expected = {expected:.6}\n  actual   = {actual:.6}\n  diff     = {pct:.2}% (tolerance {tol_pct}%)"
    );
}

fn check_rows(
    data: &[rheolab_enterprise::commands::parsing::ParsedPoint],
    gold: &[GoldRow],
    tag: &str,
) {
    for (i, row) in gold.iter().enumerate() {
        row.check(&data[i], &format!("{tag}[{i}]"));
    }
}

// ── Gold-standard data ────────────────────────────────────────────────────────

fn grace_first() -> Vec<GoldRow> {
    vec![
        GoldRow {
            time_sec: 19.2,
            sample_temp_c: 29.8,
            bath_temperature_c: Some(93.8),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(219.375),
            viscosity_cp: 2193.755,
            pressure_bar: Some(29.85),
        },
        GoldRow {
            time_sec: 25.2,
            sample_temp_c: 31.2,
            bath_temperature_c: Some(93.3),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(219.438),
            viscosity_cp: 2194.385,
            pressure_bar: Some(29.85),
        },
        GoldRow {
            time_sec: 31.2,
            sample_temp_c: 32.6,
            bath_temperature_c: Some(93.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(209.461),
            viscosity_cp: 2094.614,
            pressure_bar: Some(29.93),
        },
        GoldRow {
            time_sec: 37.2,
            sample_temp_c: 34.0,
            bath_temperature_c: Some(93.3),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(199.352),
            viscosity_cp: 1993.519,
            pressure_bar: Some(29.93),
        },
        GoldRow {
            time_sec: 44.4,
            sample_temp_c: 35.4,
            bath_temperature_c: Some(93.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(196.235),
            viscosity_cp: 1962.347,
            pressure_bar: Some(30.00),
        },
    ]
}
fn grace_last() -> Vec<GoldRow> {
    vec![
        GoldRow {
            time_sec: 10707.0,
            sample_temp_c: 107.2,
            bath_temperature_c: None,
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(23.568),
            viscosity_cp: 235.676,
            pressure_bar: Some(31.37),
        },
        GoldRow {
            time_sec: 10714.8,
            sample_temp_c: 107.2,
            bath_temperature_c: None,
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(23.267),
            viscosity_cp: 232.666,
            pressure_bar: Some(31.37),
        },
        GoldRow {
            time_sec: 10721.4,
            sample_temp_c: 107.2,
            bath_temperature_c: None,
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(23.154),
            viscosity_cp: 231.537,
            pressure_bar: Some(31.37),
        },
        GoldRow {
            time_sec: 10728.0,
            sample_temp_c: 107.2,
            bath_temperature_c: None,
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(23.116),
            viscosity_cp: 231.160,
            pressure_bar: Some(31.37),
        },
        GoldRow {
            time_sec: 10734.6,
            sample_temp_c: 107.2,
            bath_temperature_c: None,
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(22.883),
            viscosity_cp: 228.827,
            pressure_bar: Some(31.37),
        },
    ]
}

fn brookfield_first() -> Vec<GoldRow> {
    vec![
        GoldRow {
            time_sec: 5.0,
            sample_temp_c: 321.8,
            bath_temperature_c: None,
            shear_rate_1s: 99.9,
            shear_stress_pa: Some(187.27),
            viscosity_cp: 1873.40,
            pressure_bar: Some(21.58),
        },
        GoldRow {
            time_sec: 10.0,
            sample_temp_c: 321.8,
            bath_temperature_c: None,
            shear_rate_1s: 99.9,
            shear_stress_pa: Some(165.85),
            viscosity_cp: 1659.10,
            pressure_bar: Some(21.58),
        },
        GoldRow {
            time_sec: 15.0,
            sample_temp_c: 321.8,
            bath_temperature_c: None,
            shear_rate_1s: 99.9,
            shear_stress_pa: Some(148.57),
            viscosity_cp: 1486.30,
            pressure_bar: Some(21.58),
        },
        GoldRow {
            time_sec: 20.0,
            sample_temp_c: 321.8,
            bath_temperature_c: None,
            shear_rate_1s: 99.9,
            shear_stress_pa: Some(129.22),
            viscosity_cp: 1292.70,
            pressure_bar: Some(21.58),
        },
        GoldRow {
            time_sec: 25.0,
            sample_temp_c: 321.8,
            bath_temperature_c: None,
            shear_rate_1s: 99.9,
            shear_stress_pa: Some(125.77),
            viscosity_cp: 1258.20,
            pressure_bar: Some(21.65),
        },
    ]
}

fn chandler_first() -> Vec<GoldRow> {
    vec![
        GoldRow {
            time_sec: 60.0,
            sample_temp_c: 31.0,
            bath_temperature_c: Some(78.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(107.702),
            viscosity_cp: 1077.022,
            pressure_bar: Some(26.48),
        },
        GoldRow {
            time_sec: 120.0,
            sample_temp_c: 46.6,
            bath_temperature_c: Some(92.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(55.037),
            viscosity_cp: 550.372,
            pressure_bar: Some(26.48),
        },
        GoldRow {
            time_sec: 180.0,
            sample_temp_c: 60.1,
            bath_temperature_c: Some(94.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(59.416),
            viscosity_cp: 594.160,
            pressure_bar: Some(26.48),
        },
        GoldRow {
            time_sec: 241.0,
            sample_temp_c: 70.1,
            bath_temperature_c: Some(92.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(62.706),
            viscosity_cp: 627.062,
            pressure_bar: Some(26.48),
        },
        GoldRow {
            time_sec: 301.0,
            sample_temp_c: 77.5,
            bath_temperature_c: Some(91.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(64.320),
            viscosity_cp: 643.202,
            pressure_bar: Some(26.48),
        },
    ]
}

fn bsl_first() -> Vec<GoldRow> {
    vec![
        GoldRow {
            time_sec: 1.0,
            sample_temp_c: 24.100,
            bath_temperature_c: Some(54.570),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(3.661),
            viscosity_cp: 37.766,
            pressure_bar: Some(0.125),
        },
        GoldRow {
            time_sec: 2.0,
            sample_temp_c: 24.100,
            bath_temperature_c: Some(54.570),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(4.804),
            viscosity_cp: 47.973,
            pressure_bar: Some(0.125),
        },
        GoldRow {
            time_sec: 3.0,
            sample_temp_c: 24.100,
            bath_temperature_c: Some(54.570),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(4.804),
            viscosity_cp: 47.973,
            pressure_bar: Some(0.125),
        },
        GoldRow {
            time_sec: 4.0,
            sample_temp_c: 24.107,
            bath_temperature_c: Some(54.570),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(4.804),
            viscosity_cp: 47.973,
            pressure_bar: Some(0.125),
        },
        GoldRow {
            time_sec: 5.0,
            sample_temp_c: 24.140,
            bath_temperature_c: Some(54.469),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(4.804),
            viscosity_cp: 47.973,
            pressure_bar: Some(0.125),
        },
    ]
}
fn bsl_last() -> Vec<GoldRow> {
    vec![
        GoldRow {
            time_sec: 2287.0,
            sample_temp_c: 25.9,
            bath_temperature_c: None,
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(4.423),
            viscosity_cp: 44.169,
            pressure_bar: Some(0.125),
        },
        GoldRow {
            time_sec: 2288.0,
            sample_temp_c: 25.9,
            bath_temperature_c: None,
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(4.423),
            viscosity_cp: 44.169,
            pressure_bar: Some(0.125),
        },
        GoldRow {
            time_sec: 2289.0,
            sample_temp_c: 25.9,
            bath_temperature_c: None,
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(4.423),
            viscosity_cp: 44.169,
            pressure_bar: Some(0.125),
        },
        GoldRow {
            time_sec: 2290.0,
            sample_temp_c: 25.9,
            bath_temperature_c: None,
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(4.423),
            viscosity_cp: 44.169,
            pressure_bar: Some(0.125),
        },
        GoldRow {
            time_sec: 2291.0,
            sample_temp_c: 25.9,
            bath_temperature_c: None,
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(4.423),
            viscosity_cp: 44.169,
            pressure_bar: Some(0.125),
        },
    ]
}

fn bsl562_first() -> Vec<GoldRow> {
    vec![
        GoldRow {
            time_sec: 1.02,
            sample_temp_c: 28.173,
            bath_temperature_c: Some(36.853),
            shear_rate_1s: 511.0,
            shear_stress_pa: Some(33.829),
            viscosity_cp: 390.048,
            pressure_bar: Some(0.1247),
        },
        GoldRow {
            time_sec: 6.0,
            sample_temp_c: 27.627,
            bath_temperature_c: Some(35.514),
            shear_rate_1s: 511.0,
            shear_stress_pa: Some(48.071),
            viscosity_cp: 140.632,
            pressure_bar: Some(0.1247),
        },
        GoldRow {
            time_sec: 10.98,
            sample_temp_c: 27.300,
            bath_temperature_c: Some(34.381),
            shear_rate_1s: 511.0,
            shear_stress_pa: Some(62.382),
            viscosity_cp: 121.918,
            pressure_bar: Some(0.1247),
        },
        GoldRow {
            time_sec: 16.02,
            sample_temp_c: 27.367,
            bath_temperature_c: Some(33.660),
            shear_rate_1s: 511.0,
            shear_stress_pa: Some(58.898),
            viscosity_cp: 115.109,
            pressure_bar: Some(0.1283),
        },
        GoldRow {
            time_sec: 21.0,
            sample_temp_c: 27.487,
            bath_temperature_c: Some(33.454),
            shear_rate_1s: 511.0,
            shear_stress_pa: Some(55.346),
            viscosity_cp: 108.167,
            pressure_bar: Some(0.1247),
        },
    ]
}

fn bsl_mixed_first() -> Vec<GoldRow> {
    vec![
        GoldRow {
            time_sec: 1.02,
            sample_temp_c: 26.9,
            bath_temperature_c: Some(36.75),
            shear_rate_1s: 511.0,
            shear_stress_pa: Some(71.503),
            viscosity_cp: 1218.714,
            pressure_bar: Some(7.7752),
        },
        GoldRow {
            time_sec: 31.02,
            sample_temp_c: 28.98,
            bath_temperature_c: Some(34.793),
            shear_rate_1s: 511.0,
            shear_stress_pa: Some(261.382),
            viscosity_cp: 510.840,
            pressure_bar: Some(7.7569),
        },
        GoldRow {
            time_sec: 61.02,
            sample_temp_c: 30.913,
            bath_temperature_c: Some(36.132),
            shear_rate_1s: 511.0,
            shear_stress_pa: Some(246.353),
            viscosity_cp: 481.467,
            pressure_bar: Some(7.7642),
        },
        GoldRow {
            time_sec: 91.02,
            sample_temp_c: 33.24,
            bath_temperature_c: Some(43.342),
            shear_rate_1s: 511.0,
            shear_stress_pa: Some(221.233),
            viscosity_cp: 432.373,
            pressure_bar: Some(7.8449),
        },
        GoldRow {
            time_sec: 121.02,
            sample_temp_c: 37.313,
            bath_temperature_c: Some(50.655),
            shear_rate_1s: 511.0,
            shear_stress_pa: Some(195.130),
            viscosity_cp: 381.359,
            pressure_bar: Some(7.8815),
        },
    ]
}
fn bsl_mixed_last() -> Vec<GoldRow> {
    vec![
        GoldRow {
            time_sec: 2311.02,
            sample_temp_c: 84.9,
            bath_temperature_c: Some(85.057),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(37.893),
            viscosity_cp: 378.433,
            pressure_bar: Some(8.3911),
        },
        GoldRow {
            time_sec: 2341.02,
            sample_temp_c: 84.82,
            bath_temperature_c: Some(84.954),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(37.893),
            viscosity_cp: 378.433,
            pressure_bar: Some(8.4021),
        },
        GoldRow {
            time_sec: 2371.02,
            sample_temp_c: 84.9,
            bath_temperature_c: Some(85.057),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(37.893),
            viscosity_cp: 378.433,
            pressure_bar: Some(8.3801),
        },
        GoldRow {
            time_sec: 2401.02,
            sample_temp_c: 84.84,
            bath_temperature_c: Some(84.954),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(37.825),
            viscosity_cp: 377.751,
            pressure_bar: Some(8.3838),
        },
        GoldRow {
            time_sec: 2431.02,
            sample_temp_c: 84.8,
            bath_temperature_c: Some(85.057),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(37.722),
            viscosity_cp: 376.728,
            pressure_bar: Some(8.3911),
        },
    ]
}

fn november_first() -> Vec<GoldRow> {
    vec![
        // Source: November102008-2.xls sheet "November102008-2" (26-col Fann 50 format).
        // Time column is in minutes (units row says "Min") → converted to seconds (×60).
        // Stress column is in dyne/cm² → converted to Pa (×0.1).
        // Shear rate is already in sec⁻¹ — no physics override needed.
        // Row 22 = 0.600 min → 36.0 s; row 27 = 3.120 min → 187.2 s (row 26 has coeff n/K, no time).
        GoldRow {
            time_sec: 36.0,
            sample_temp_c: 29.0,
            bath_temperature_c: None,
            shear_rate_1s: 103.22,
            shear_stress_pa: Some(166.715),
            viscosity_cp: 1615.0,
            pressure_bar: None,
        },
        GoldRow {
            time_sec: 66.0,
            sample_temp_c: 31.0,
            bath_temperature_c: None,
            shear_rate_1s: 81.55,
            shear_stress_pa: Some(144.44),
            viscosity_cp: 1771.0,
            pressure_bar: None,
        },
        GoldRow {
            time_sec: 96.0,
            sample_temp_c: 32.0,
            bath_temperature_c: None,
            shear_rate_1s: 59.72,
            shear_stress_pa: Some(122.12),
            viscosity_cp: 2045.0,
            pressure_bar: None,
        },
        GoldRow {
            time_sec: 126.0,
            sample_temp_c: 34.0,
            bath_temperature_c: None,
            shear_rate_1s: 38.12,
            shear_stress_pa: Some(92.263),
            viscosity_cp: 2421.0,
            pressure_bar: None,
        },
        GoldRow {
            time_sec: 187.2,
            sample_temp_c: 37.0,
            bath_temperature_c: None,
            shear_rate_1s: 103.24,
            shear_stress_pa: Some(136.657),
            viscosity_cp: 1324.0,
            pressure_bar: None,
        },
    ]
}

fn sst8957_first() -> Vec<GoldRow> {
    vec![
        GoldRow {
            time_sec: 5.0,
            sample_temp_c: 24.0,
            bath_temperature_c: Some(26.0),
            shear_rate_1s: 511.0,
            shear_stress_pa: Some(17.115),
            viscosity_cp: 33.493,
            pressure_bar: Some(5.24),
        },
        GoldRow {
            time_sec: 10.0,
            sample_temp_c: 24.1,
            bath_temperature_c: Some(27.0),
            shear_rate_1s: 511.0,
            shear_stress_pa: None,
            viscosity_cp: 35.515,
            pressure_bar: Some(5.24),
        },
        GoldRow {
            time_sec: 16.0,
            sample_temp_c: 24.2,
            bath_temperature_c: Some(32.0),
            shear_rate_1s: 511.0,
            shear_stress_pa: None,
            viscosity_cp: 37.312,
            pressure_bar: Some(5.24),
        },
        GoldRow {
            time_sec: 21.0,
            sample_temp_c: 24.3,
            bath_temperature_c: Some(36.0),
            shear_rate_1s: 511.0,
            shear_stress_pa: None,
            viscosity_cp: 45.083,
            pressure_bar: Some(5.24),
        },
        GoldRow {
            time_sec: 26.0,
            sample_temp_c: 24.5,
            bath_temperature_c: Some(40.0),
            shear_rate_1s: 511.0,
            shear_stress_pa: None,
            viscosity_cp: 45.083,
            pressure_bar: Some(5.24),
        },
    ]
}

fn swb8958_first() -> Vec<GoldRow> {
    vec![
        GoldRow {
            time_sec: 5.0,
            sample_temp_c: 30.9,
            bath_temperature_c: Some(34.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(233.10),
            viscosity_cp: 2330.950,
            pressure_bar: Some(5.31),
        },
        GoldRow {
            time_sec: 10.0,
            sample_temp_c: 31.0,
            bath_temperature_c: Some(34.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(203.53),
            viscosity_cp: 2035.281,
            pressure_bar: Some(5.31),
        },
        GoldRow {
            time_sec: 16.0,
            sample_temp_c: 31.1,
            bath_temperature_c: Some(37.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(200.77),
            viscosity_cp: 2007.686,
            pressure_bar: Some(5.31),
        },
        GoldRow {
            time_sec: 21.0,
            sample_temp_c: 31.3,
            bath_temperature_c: Some(42.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(158.14),
            viscosity_cp: 1581.430,
            pressure_bar: Some(5.31),
        },
        GoldRow {
            time_sec: 26.0,
            sample_temp_c: 31.4,
            bath_temperature_c: Some(47.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(147.89),
            viscosity_cp: 1478.931,
            pressure_bar: Some(5.31),
        },
    ]
}
fn swb8958_last() -> Vec<GoldRow> {
    vec![
        GoldRow {
            time_sec: 6411.0,
            sample_temp_c: 94.3,
            bath_temperature_c: Some(96.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(9.411),
            viscosity_cp: 94.112,
            pressure_bar: Some(5.31),
        },
        GoldRow {
            time_sec: 6416.0,
            sample_temp_c: 94.4,
            bath_temperature_c: Some(96.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(9.310),
            viscosity_cp: 93.096,
            pressure_bar: Some(5.31),
        },
        GoldRow {
            time_sec: 6421.0,
            sample_temp_c: 94.4,
            bath_temperature_c: Some(96.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(9.208),
            viscosity_cp: 92.080,
            pressure_bar: Some(5.31),
        },
        GoldRow {
            time_sec: 6426.0,
            sample_temp_c: 94.4,
            bath_temperature_c: Some(96.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(9.157),
            viscosity_cp: 91.572,
            pressure_bar: Some(5.31),
        },
        GoldRow {
            time_sec: 6431.0,
            sample_temp_c: 94.3,
            bath_temperature_c: Some(96.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(9.056),
            viscosity_cp: 90.555,
            pressure_bar: Some(5.31),
        },
    ]
}

fn csv38_first() -> Vec<GoldRow> {
    vec![
        GoldRow {
            time_sec: 2.0,
            sample_temp_c: 24.4,
            bath_temperature_c: Some(25.0),
            shear_rate_1s: 511.0,
            shear_stress_pa: Some(110.19),
            viscosity_cp: 215.636,
            pressure_bar: Some(0.0),
        },
        GoldRow {
            time_sec: 4.0,
            sample_temp_c: 24.4,
            bath_temperature_c: Some(25.0),
            shear_rate_1s: 511.0,
            shear_stress_pa: Some(203.42),
            viscosity_cp: 398.087,
            pressure_bar: Some(0.0),
        },
        GoldRow {
            time_sec: 6.0,
            sample_temp_c: 24.4,
            bath_temperature_c: Some(25.0),
            shear_rate_1s: 511.0,
            shear_stress_pa: Some(238.45),
            viscosity_cp: 466.641,
            pressure_bar: Some(0.0),
        },
        GoldRow {
            time_sec: 8.0,
            sample_temp_c: 24.4,
            bath_temperature_c: Some(25.0),
            shear_rate_1s: 511.0,
            shear_stress_pa: Some(285.85),
            viscosity_cp: 559.385,
            pressure_bar: Some(0.0),
        },
        GoldRow {
            time_sec: 10.0,
            sample_temp_c: 24.4,
            bath_temperature_c: Some(25.0),
            shear_rate_1s: 511.0,
            shear_stress_pa: Some(302.86),
            viscosity_cp: 592.683,
            pressure_bar: Some(0.0),
        },
    ]
}
fn csv38_last() -> Vec<GoldRow> {
    vec![
        GoldRow {
            time_sec: 4140.0,
            sample_temp_c: 38.0,
            bath_temperature_c: Some(38.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(91.02),
            viscosity_cp: 910.228,
            pressure_bar: Some(0.0),
        },
        GoldRow {
            time_sec: 4142.0,
            sample_temp_c: 38.1,
            bath_temperature_c: Some(38.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(91.87),
            viscosity_cp: 918.735,
            pressure_bar: Some(0.0),
        },
        GoldRow {
            time_sec: 4144.0,
            sample_temp_c: 38.0,
            bath_temperature_c: Some(38.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(90.87),
            viscosity_cp: 908.726,
            pressure_bar: Some(0.0),
        },
        GoldRow {
            time_sec: 4146.0,
            sample_temp_c: 38.1,
            bath_temperature_c: Some(38.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(92.57),
            viscosity_cp: 925.741,
            pressure_bar: Some(0.0),
        },
        GoldRow {
            time_sec: 4148.0,
            sample_temp_c: 38.1,
            bath_temperature_c: Some(38.0),
            shear_rate_1s: 100.0,
            shear_stress_pa: Some(92.37),
            viscosity_cp: 923.740,
            pressure_bar: Some(0.0),
        },
    ]
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn test_stub_context_extractor_prefers_real_csv_header() {
    let csv = b"Project,Demo\nComment,metadata block\nOperator,QA\nClock,Value,ProbeA,Load\ns,cP,C,bar\n1,100,25,1\n2,101,26,1\n";
    let candidates = extract_ai_context_candidates(csv, "synthetic.csv");

    assert!(
        !candidates.is_empty(),
        "expected at least one AI context candidate"
    );
    assert_eq!(candidates[0].header_cells[0], "Clock");
    assert_eq!(candidates[0].header_cells[1], "Value");
    assert_eq!(
        candidates[0]
            .unit_row
            .as_ref()
            .map(|row| row.cells[0].as_str()),
        Some("s")
    );
}

#[test]
fn test_stub_context_extractor_prefers_raw_workbook_sheet() {
    use std::fs;

    let bytes = fs::read(fixtures_dir().join("Отчёт BSL.xlsx")).expect("fixture read");
    let candidates = extract_ai_context_candidates(&bytes, "Отчёт BSL.xlsx");

    assert!(
        !candidates.is_empty(),
        "expected workbook AI context candidates"
    );
    assert_eq!(candidates[0].source_sheet.as_deref(), Some("Сырые данные"));
    assert!(candidates[0]
        .header_cells
        .iter()
        .any(|cell| cell.contains("Время") || cell.contains("Time")));
}

#[test]
fn test_stub_context_extractor_prefers_raw_sheet_for_bsl_mixed_time_fixture() {
    use std::fs;

    let filename = "t-12.03.26-3BSL.xlsx";
    let bytes = fs::read(fixtures_dir().join(filename)).expect("fixture read");
    let candidates = extract_ai_context_candidates(&bytes, filename);

    assert!(
        !candidates.is_empty(),
        "expected workbook AI context candidates"
    );
    assert_eq!(candidates[0].source_sheet.as_deref(), Some("Сырые данные"));
    assert!(
        candidates[0]
            .header_cells
            .iter()
            .any(|cell| cell.contains("Вязкость") || cell.contains("Viscosity")),
        "top candidate must expose raw-data viscosity header"
    );
}

#[tokio::test]
async fn test_stub_force_ai_hard_fails_on_mapper_error() {
    let req = ParseRequest {
        filename: "synthetic.csv".to_string(),
        file_path: None,
        bytes: Some(b"Clock,Value,ProbeA,Load\ns,cP,C,bar\n1,100,25,1\n".to_vec()),
        force_ai: Some(true),
        ai_model: Some("stub-model".to_string()),
    };
    let mapper = StubAiColumnMapper::failure("stub mapper failure");

    let error = parsing_parse_file_with_ai_mapper(req, Some("stub-key".to_string()), &mapper)
        .await
        .expect_err("forceAI must fail when mapper fails");

    assert!(error.to_string().contains("AI parsing failed"));
}

#[tokio::test]
async fn test_stub_force_ai_hard_fails_without_configured_key() {
    let req = ParseRequest {
        filename: "synthetic.csv".to_string(),
        file_path: None,
        bytes: Some(b"Clock,Value\ns,cP\n1,100\n".to_vec()),
        force_ai: Some(true),
        ai_model: Some("stub-model".to_string()),
    };

    let error = parsing_parse_file_with_resolved_ai_key(req, None)
        .await
        .expect_err("forceAI must fail when no active key is available");

    assert!(error.to_string().contains("force_ai=true"));
}

#[tokio::test]
async fn test_stub_force_ai_uses_structured_mapping_for_fixture() {
    use std::fs;

    let filename = "t-12.03.26-3BSL.xlsx";
    let bytes = fs::read(fixtures_dir().join(filename)).expect("fixture read");
    let candidates = extract_ai_context_candidates(&bytes, filename);
    assert!(!candidates.is_empty(), "expected AI candidates for fixture");
    let mapper = StubAiColumnMapper::success(mapping_from_candidate(&candidates[0]));

    let result = parse_with_stub_mapper(filename, None, true, &mapper).await;

    assert!(result.success);
    assert_eq!(result.source, "ai");
    assert!(result.metadata.used_ai);
    assert!(result.metadata.ai_diagnostics.is_some());
    assert_eq!(result.data.len(), 82);
    assert!(
        result
            .summary
            .time_range
            .as_ref()
            .map(|r| r.duration_minutes)
            .unwrap_or_default()
            < 50.0
    );
}

#[tokio::test]
async fn test_stub_optional_ai_skips_mapper_when_heuristic_is_healthy() {
    let calls = Arc::new(AtomicUsize::new(0));
    let mapper = CountingFailMapper {
        calls: calls.clone(),
    };

    let result = parse_with_stub_mapper("Отчёт Grace.xlsx", None, false, &mapper).await;

    assert!(result.success);
    assert_eq!(result.source, "regex");
    assert!(!result.metadata.used_ai);
    assert_eq!(
        calls.load(Ordering::SeqCst),
        0,
        "healthy heuristic parse must not call AI"
    );
}

#[tokio::test]
async fn test_stub_optional_ai_uses_ai_when_heuristic_fails() {
    let csv = b"Project,Demo\nComment,metadata block\nOperator,QA\nClock,Value,ProbeA,Load\ns,cP,C,bar\n1,100,25,1\n2,101,26,1\n3,102,27,1\n".to_vec();
    let candidates = extract_ai_context_candidates(&csv, "synthetic.csv");
    assert!(
        !candidates.is_empty(),
        "expected AI candidates for synthetic CSV"
    );

    let mut mapping = BTreeMap::new();
    mapping.insert(
        "time_sec".to_string(),
        AiMappedColumn {
            index: 0,
            confidence: Some(0.99),
        },
    );
    mapping.insert(
        "viscosity_cp".to_string(),
        AiMappedColumn {
            index: 1,
            confidence: Some(0.99),
        },
    );
    mapping.insert(
        "temperature_c".to_string(),
        AiMappedColumn {
            index: 2,
            confidence: Some(0.99),
        },
    );
    mapping.insert(
        "pressure_bar".to_string(),
        AiMappedColumn {
            index: 3,
            confidence: Some(0.99),
        },
    );
    let mapper = StubAiColumnMapper::success(AiMappingResponse {
        selected_candidate: 0,
        mapping,
    });

    let result = parse_with_stub_mapper("synthetic.csv", Some(csv), false, &mapper).await;

    assert!(result.success);
    assert_eq!(result.source, "ai");
    assert!(result.metadata.used_ai);
    assert_eq!(result.data.len(), 3);
    assert!((result.data[0].time_sec - 1.0).abs() < 0.01);
    assert!((result.data[0].viscosity_cp - 100.0).abs() < 0.01);
}

#[tokio::test]
async fn test_stub_optional_ai_falls_back_to_heuristic_on_invalid_mapping() {
    // 5 rows with clear headers so the heuristic parses them cleanly.
    // Because these bytes are provided inline (not a file-path read), the
    // optional-AI path is always entered regardless of heuristic health —
    // the AI stub returns an out-of-range column index (99), which must be
    // captured in ai_diagnostics and trigger fallback to the heuristic result.
    let csv = b"Time,Viscosity,Shear Rate,Shear Stress\ns,cP,1/s,Pa\n1,100,100,1000\n2,110,100,1100\n3,120,100,1200\n4,130,100,1300\n5,140,100,1400\n".to_vec();
    let mapper = StubAiColumnMapper::success(AiMappingResponse {
        selected_candidate: 0,
        mapping: BTreeMap::from([(
            "time_sec".to_string(),
            AiMappedColumn {
                index: 99,
                confidence: Some(0.99),
            },
        )]),
    });

    let result = parse_with_stub_mapper("suspicious.csv", Some(csv), false, &mapper).await;

    assert!(result.success);
    assert_eq!(result.source, "regex");
    assert!(!result.metadata.used_ai);
    assert_eq!(result.data.len(), 5);
    assert_eq!(
        result
            .metadata
            .ai_diagnostics
            .as_ref()
            .and_then(|diagnostics| diagnostics.failure_reason.as_deref()),
        Some("AI mapped field 'time_sec' to out-of-range column index 99 (header has 4 columns)")
    );
}

#[tokio::test]
async fn test_ai_smoke_metadata_heavy_csv() {
    let Some(key) = require_smoke_api_key() else {
        return;
    };
    let bytes = b"Project,Sanitized Demo\n\
Operator,QA\n\
Comment,metadata block\n\
Elapsed Time,Viscosity,Sample Temp,Bath Temp,Pressure\n\
s,cP,C,C,bar\n\
1,101,25,40,1.2\n\
2,102,26,41,1.3\n\
3,103,27,42,1.4\n"
        .to_vec();

    let result = parse_force_ai_bytes("sanitized-metadata.csv", bytes, &key).await;

    assert!(result.success);
    assert_eq!(result.source, "ai");
    assert!(result.metadata.used_ai);
    assert_eq!(result.data.len(), 3);
    assert!((result.data[0].time_sec - 1.0).abs() < 0.01);
    assert!((result.data[0].viscosity_cp - 101.0).abs() < 0.01);
    assert!((result.data[0].temperature_c - 25.0).abs() < 0.01);
    assert_eq!(
        result.data[0]
            .bath_temperature_c
            .map(|value| value.round() as i32),
        Some(40)
    );
}

#[tokio::test]
async fn test_ai_smoke_dual_temperature_csv() {
    let Some(key) = require_smoke_api_key() else {
        return;
    };
    let bytes = b"Dataset,Sanitized Dual Temp\n\
Notes,AI smoke test\n\
Clock,Visc,Sample Temperature,Heater Temperature,RPM\n\
s,cP,C,C,rpm\n\
5,210,32,85,300\n\
10,220,33,86,300\n\
15,230,34,87,300\n"
        .to_vec();

    let result = parse_force_ai_bytes("sanitized-dual-temp.csv", bytes, &key).await;

    assert!(result.success);
    assert_eq!(result.source, "ai");
    assert!(result.metadata.used_ai);
    assert_eq!(result.data.len(), 3);
    assert!((result.data[0].time_sec - 5.0).abs() < 0.01);
    assert!((result.data[0].temperature_c - 32.0).abs() < 0.01);
    assert_eq!(
        result.data[0]
            .bath_temperature_c
            .map(|value| value.round() as i32),
        Some(85)
    );
    assert!((result.data[0].speed_rpm - 300.0).abs() < 0.01);
}

#[tokio::test]
async fn test_ai_grace() {
    let Some(key) = require_fixture_api_key() else {
        return;
    };
    let r = parse_force_ai("Отчёт Grace.xlsx", &key).await;
    assert!(r.success);
    assert_eq!(r.source, "ai");
    assert!(r.metadata.used_ai);
    assert_eq!(r.data.len(), 1219, "Grace: totalRows");
    check_rows(&r.data, &grace_first(), "Grace first");
    let last = grace_last();
    let offset = r.data.len() - last.len();
    check_rows(&r.data[offset..], &last, "Grace last");
    eprintln!(
        "OK Grace: {} rows, first visc={:.3} last visc={:.3}",
        r.data.len(),
        r.data[0].viscosity_cp,
        r.data.last().unwrap().viscosity_cp
    );
}

#[tokio::test]
async fn test_ai_brookfield() {
    let Some(key) = require_fixture_api_key() else {
        return;
    };
    let r = parse_force_ai("Brookfeild 4.xlsx", &key).await;
    assert!(r.success);
    assert_eq!(r.source, "ai");
    assert!(r.metadata.used_ai);
    assert_eq!(r.data.len(), 976, "Brookfield: totalRows");
    check_rows(&r.data, &brookfield_first(), "Brookfield first");
    eprintln!(
        "OK Brookfield: {} rows, first visc={:.3}",
        r.data.len(),
        r.data[0].viscosity_cp
    );
}

#[tokio::test]
async fn test_ai_chandler() {
    let Some(key) = require_fixture_api_key() else {
        return;
    };
    let r = parse_force_ai("Отчёт Chandler.xls", &key).await;
    assert!(r.success);
    assert_eq!(r.source, "ai");
    assert!(r.metadata.used_ai);
    assert_eq!(r.data.len(), 132, "Chandler: totalRows");
    check_rows(&r.data, &chandler_first(), "Chandler first");
    eprintln!(
        "OK Chandler: {} rows, first visc={:.3} bath={:?}",
        r.data.len(),
        r.data[0].viscosity_cp,
        r.data[0].bath_temperature_c
    );
}

#[tokio::test]
async fn test_ai_bsl() {
    let Some(key) = require_fixture_api_key() else {
        return;
    };
    let r = parse_force_ai("Отчёт BSL.xlsx", &key).await;
    assert!(r.success);
    assert_eq!(r.source, "ai");
    assert!(r.metadata.used_ai);
    assert_eq!(r.data.len(), 2291, "BSL: totalRows");
    check_rows(&r.data, &bsl_first(), "BSL first");
    let last = bsl_last();
    let offset = r.data.len() - last.len();
    check_rows(&r.data[offset..], &last, "BSL last");
    eprintln!("OK BSL: {} rows", r.data.len());
}

/// 562@60C: validates AI parsing AND the BSL dropped-decimal time fix.
#[tokio::test]
async fn test_ai_bsl_562() {
    let Some(key) = require_fixture_api_key() else {
        return;
    };
    let r = parse_force_ai("562@60C.xlsx", &key).await;
    assert!(r.success);
    assert_eq!(r.source, "ai");
    assert!(r.metadata.used_ai);
    assert_eq!(r.data.len(), 119, "562@60C: totalRows");
    check_rows(&r.data, &bsl562_first(), "562@60C first");
    let max_t = r
        .data
        .iter()
        .map(|p| p.time_sec)
        .fold(f64::NEG_INFINITY, f64::max);
    assert!(
        max_t < 1200.0,
        "562@60C: max_t={max_t:.1}s — time-unit bug regression"
    );
    eprintln!(
        "OK 562@60C: {} rows, t[0]={:.3}s max_t={:.1}s",
        r.data.len(),
        r.data[0].time_sec,
        max_t
    );
}

/// November: requiresAI=true. Uses 5% tolerance (legacy Fann-50 format).
#[tokio::test]
async fn test_ai_november() {
    let Some(key) = require_fixture_api_key() else {
        return;
    };
    let r = parse_force_ai("November102008-2.xls", &key).await;
    assert!(r.success);
    assert_eq!(r.source, "ai");
    assert!(r.metadata.used_ai);
    assert!(
        r.data.len() >= 100 && r.data.len() <= 210,
        "November: {} rows expected ~140",
        r.data.len()
    );
    let gold = november_first();
    for (i, row) in gold.iter().enumerate() {
        let a = &r.data[i];
        chk(
            a.time_sec,
            row.time_sec,
            5.0,
            &format!("November first[{i}] time_sec"),
        );
        chk(
            a.temperature_c,
            row.sample_temp_c,
            5.0,
            &format!("November first[{i}] temperature_c"),
        );
        chk(
            a.viscosity_cp,
            row.viscosity_cp,
            5.0,
            &format!("November first[{i}] viscosity_cp"),
        );
        chk(
            a.shear_rate_s1,
            row.shear_rate_1s,
            5.0,
            &format!("November first[{i}] shear_rate"),
        );
        if let Some(ss) = row.shear_stress_pa {
            chk(
                a.shear_stress_pa,
                ss,
                5.0,
                &format!("November first[{i}] shear_stress_pa"),
            );
        }
        assert!(
            a.viscosity_cp > 0.0 && a.viscosity_cp < 100_000.0,
            "November data[{i}].viscosity_cp={} out of range",
            a.viscosity_cp
        );
    }
    eprintln!(
        "OK November (AI-only): {} rows, t[0]={:.1}s visc[0]={:.1}cP",
        r.data.len(),
        r.data[0].time_sec,
        r.data[0].viscosity_cp
    );
}

#[tokio::test]
async fn test_ai_8957_sst() {
    let Some(key) = require_fixture_api_key() else {
        return;
    };
    let filename =
        "8957 SST Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@63C 30.10.25.csv";
    let r = parse_force_ai(filename, &key).await;
    assert!(r.success);
    assert_eq!(r.source, "ai");
    assert!(r.metadata.used_ai);
    assert_eq!(r.data.len(), 521, "8957 SST: totalRows");
    check_rows(&r.data, &sst8957_first(), "8957 SST first");
    eprintln!(
        "OK 8957 SST: {} rows, first visc={:.3}",
        r.data.len(),
        r.data[0].viscosity_cp
    );
}

#[tokio::test]
async fn test_ai_8958_swb() {
    let Some(key) = require_fixture_api_key() else {
        return;
    };
    let filename =
        "8958 SWB Mamontovskoe_(lake_274_pad) 3.4(WG-9000F)-2.8(WCL)-0.5(HT-3)@96C 30.10.25.csv";
    let r = parse_force_ai(filename, &key).await;
    assert!(r.success);
    assert_eq!(r.source, "ai");
    assert!(r.metadata.used_ai);
    assert_eq!(r.data.len(), 1237, "8958 SWB: totalRows");
    check_rows(&r.data, &swb8958_first(), "8958 SWB first");
    let last = swb8958_last();
    let offset = r.data.len() - last.len();
    check_rows(&r.data[offset..], &last, "8958 SWB last");
    eprintln!(
        "OK 8958 SWB: {} rows, first visc={:.3} last visc={:.3}",
        r.data.len(),
        r.data[0].viscosity_cp,
        r.data.last().unwrap().viscosity_cp
    );
}

#[tokio::test]
async fn test_ai_3_8_csv() {
    let Some(key) = require_fixture_api_key() else {
        return;
    };
    let filename = "3.8_2.0_0.2_41C(5610_56)23.04.csv";
    let r = parse_force_ai(filename, &key).await;
    assert!(r.success);
    assert_eq!(r.source, "ai");
    assert!(r.metadata.used_ai);
    assert_eq!(r.data.len(), 2074, "3.8_2.0 CSV: totalRows");
    check_rows(&r.data, &csv38_first(), "3.8_2.0 first");
    let last = csv38_last();
    let offset = r.data.len() - last.len();
    check_rows(&r.data[offset..], &last, "3.8_2.0 last");
    eprintln!("OK 3.8_2.0 CSV: {} rows", r.data.len());
}

/// Diagnostic: print extracted headers + first 5 rows for each failing file.
/// Run: cargo test --test ai_parsing test_diagnose -- --nocapture
#[tokio::test]
async fn test_diagnose() {
    let Some(key) = require_fixture_api_key() else {
        return;
    };
    use std::fs;

    let files = [
        "Отчёт BSL.xlsx",
        "562@60C.xlsx",
        "Отчёт Chandler.xls",
        "November102008-2.xls",
    ];
    for filename in files {
        let path = fixtures_dir().join(filename);
        let bytes = fs::read(&path).expect("fixture read");
        let headers = extract_candidate_headers(&bytes, filename);
        let (header_vec, source_sheet) = &headers;
        eprintln!("\n── {filename} ── (source_sheet={source_sheet:?})");
        eprintln!("  extracted headers ({}):", header_vec.len());
        for (i, h) in header_vec.iter().enumerate() {
            eprintln!("    [{i}] {h:?}");
        }

        let ai = parse_force_ai(filename, &key).await;
        eprintln!("  AI first 3 rows:");
        for (i, p) in ai.data.iter().take(3).enumerate() {
            eprintln!(
                "    [{i}] t={:.3} visc={:.3} temp_c={:.3} bath={:?} sr={:.1} ss={:.3} p={:.4}",
                p.time_sec,
                p.viscosity_cp,
                p.temperature_c,
                p.bath_temperature_c,
                p.shear_rate_s1,
                p.shear_stress_pa,
                p.pressure_bar
            );
        }
        let h = parse_heuristic(filename).await;
        eprintln!("  Heuristic first 3 rows:");
        for (i, p) in h.data.iter().take(3).enumerate() {
            eprintln!(
                "    [{i}] t={:.3} visc={:.3} temp_c={:.3} bath={:?} sr={:.1} ss={:.3} p={:.4}",
                p.time_sec,
                p.viscosity_cp,
                p.temperature_c,
                p.bath_temperature_c,
                p.shear_rate_s1,
                p.shear_stress_pa,
                p.pressure_bar
            );
        }
    }
}

// ── Heuristic regression tests (no API key required) ─────────────────────────

#[tokio::test]
async fn test_heuristic_grace_no_regression() {
    let r = parse_heuristic("Отчёт Grace.xlsx").await;
    assert!(r.success);
    assert_eq!(r.source, "regex");
    assert!(!r.metadata.used_ai);
    assert_eq!(r.data.len(), 1219);
    check_rows(&r.data, &grace_first(), "Grace heuristic first");
    let last = grace_last();
    let offset = r.data.len() - last.len();
    check_rows(&r.data[offset..], &last, "Grace heuristic last");
    eprintln!("OK Grace heuristic: {} rows (no regression)", r.data.len());
}

#[tokio::test]
async fn test_heuristic_bsl_562_time_fix() {
    let r = parse_heuristic("562@60C.xlsx").await;
    assert!(r.success);
    assert_eq!(r.data.len(), 119);
    check_rows(&r.data, &bsl562_first(), "562@60C heuristic first");
    let max_t = r
        .data
        .iter()
        .map(|p| p.time_sec)
        .fold(f64::NEG_INFINITY, f64::max);
    assert!(
        max_t < 1200.0,
        "562@60C heuristic: max_t={max_t:.1}s time bug regression"
    );
    eprintln!(
        "OK 562@60C heuristic: {} rows t[0]={:.3}s max_t={:.1}s",
        r.data.len(),
        r.data[0].time_sec,
        max_t
    );
}

#[tokio::test]
async fn test_heuristic_bsl_mixed_time_fix() {
    let r = parse_heuristic("t-12.03.26-3BSL.xlsx").await;
    assert!(r.success);
    assert_eq!(r.data.len(), 82);
    check_rows(
        &r.data,
        &bsl_mixed_first(),
        "t-12.03.26-3BSL heuristic first",
    );
    let last = bsl_mixed_last();
    let offset = r.data.len() - last.len();
    check_rows(&r.data[offset..], &last, "t-12.03.26-3BSL heuristic last");
    let max_t = r
        .data
        .iter()
        .map(|p| p.time_sec)
        .fold(f64::NEG_INFINITY, f64::max);
    assert!(
        max_t < 3000.0,
        "t-12.03.26-3BSL heuristic: max_t={max_t:.1}s time bug regression"
    );
    eprintln!(
        "OK t-12.03.26-3BSL heuristic: {} rows t[0]={:.3}s max_t={:.1}s",
        r.data.len(),
        r.data[0].time_sec,
        max_t
    );
}
