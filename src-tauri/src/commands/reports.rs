//! Native report generation commands for desktop mode.
//!
//! These commands execute the Rust report engine directly in Tauri runtime
//! and return report bytes to the frontend.
//!
//! Raw bytes are returned via `tauri::ipc::Response` to avoid JSON serialization
//! overhead (eliminates triple-copy: Vec<u8> → JSON number array → JS Array → Uint8Array).

use crate::error::{AppError, Result};
use crate::state::AppState;
use crate::commands::licensing::can_write_via_engine;
use rheolab_core::report_generator::ReportInput;
use rheolab_core::report_generator::comparison::ComparisonReportInput;
use tauri::State;

/// Inner implementation used by tests — returns raw bytes.
async fn generate_pdf_bytes(input: ReportInput) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || {
        rheolab_core::report_generator::generate_pdf_from_input(&input)
            .map_err(|error| AppError::Other(format!("PDF generation failed: {}", error)))
    })
    .await
    .map_err(AppError::Join)?
}

/// Inner implementation used by tests — returns raw bytes.
async fn generate_excel_bytes(input: ReportInput) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || {
        rheolab_core::report_generator::generate_excel_from_input(&input)
            .map_err(|error| AppError::Other(format!("Excel generation failed: {:?}", error)))
    })
    .await
    .map_err(AppError::Join)?
}

/// Inner implementation used by tests — returns raw comparison PDF bytes.
async fn generate_comparison_pdf_bytes(input: ComparisonReportInput) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || {
        rheolab_core::report_generator::generate_comparison_pdf(&input)
            .map_err(|error| {
                tracing::error!("Comparison PDF generation failed: {}", error);
                AppError::Other(format!("Comparison PDF generation failed: {}", error))
            })
    })
    .await
    .map_err(AppError::Join)?
}

/// Inner implementation used by tests — returns raw comparison XLSX bytes.
async fn generate_comparison_excel_bytes(input: ComparisonReportInput) -> Result<Vec<u8>> {
    tokio::task::spawn_blocking(move || {
        rheolab_core::report_generator::generate_comparison_excel(&input)
            .map_err(|error| AppError::Other(format!("Comparison Excel generation failed: {}", error)))
    })
    .await
    .map_err(AppError::Join)?
}

#[tauri::command]
pub async fn reports_generate_pdf(
    state: State<'_, AppState>,
    input: ReportInput,
) -> Result<tauri::ipc::Response> {
    // F-08: License gate — report generation requires a valid license or active demo
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    // E2E fast-path: return a minimal valid %PDF-1.4 header so the UI
    // flow completes instantly without running Typst (which at opt-level=0
    // takes 5+ minutes).  Set RHEOLAB_E2E_MOCK_REPORTS=1 to activate.
    // Gated to debug builds only — never available in release (F-02).
    #[cfg(debug_assertions)]
    {
        if std::env::var("RHEOLAB_E2E_MOCK_REPORTS").is_ok() {
            tracing::debug!("[E2E] reports_generate_pdf: returning mock PDF bytes");
            return Ok(tauri::ipc::Response::new(vec![
                0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, // %PDF-1.4
            ]));
        }
    }
    let bytes = generate_pdf_bytes(input).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn reports_generate_excel(
    state: State<'_, AppState>,
    input: ReportInput,
) -> Result<tauri::ipc::Response> {
    // F-08: License gate — report generation requires a valid license or active demo
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    // E2E fast-path: return a minimal PK ZIP header so the UI flow completes.
    // Gated to debug builds only — never available in release (F-02).
    #[cfg(debug_assertions)]
    {
        if std::env::var("RHEOLAB_E2E_MOCK_REPORTS").is_ok() {
            tracing::debug!("[E2E] reports_generate_excel: returning mock XLSX bytes");
            return Ok(tauri::ipc::Response::new(vec![0x50, 0x4b, 0x03, 0x04]));
        }
    }
    let bytes = generate_excel_bytes(input).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Generate a PDF comparison report from multiple experiments.
///
/// Returns raw PDF bytes via `tauri::ipc::Response` for zero-copy transfer to
/// the frontend.  License-gated identically to the single-experiment path.
#[tauri::command]
pub async fn reports_generate_comparison_pdf(
    state: State<'_, AppState>,
    input: serde_json::Value,
) -> Result<tauri::ipc::Response> {
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    #[cfg(debug_assertions)]
    {
        if std::env::var("RHEOLAB_E2E_MOCK_REPORTS").is_ok() {
            tracing::debug!("[E2E] reports_generate_comparison_pdf: returning mock PDF bytes");
            return Ok(tauri::ipc::Response::new(vec![
                0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, // %PDF-1.4
            ]));
        }
    }
    let parsed: ComparisonReportInput = serde_json::from_value(input).map_err(|e| {
        tracing::error!("Comparison PDF input deserialization failed: {}", e);
        AppError::Other(format!("Input deserialization failed: {}", e))
    })?;
    let bytes = generate_comparison_pdf_bytes(parsed).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Generate an XLSX comparison report from multiple experiments.
///
/// Returns raw XLSX bytes via `tauri::ipc::Response`.  License-gated.
#[tauri::command]
pub async fn reports_generate_comparison_excel(
    state: State<'_, AppState>,
    input: ComparisonReportInput,
) -> Result<tauri::ipc::Response> {
    if !can_write_via_engine(&state).await {
        return Err(AppError::License("required".into()));
    }
    #[cfg(debug_assertions)]
    {
        if std::env::var("RHEOLAB_E2E_MOCK_REPORTS").is_ok() {
            tracing::debug!("[E2E] reports_generate_comparison_excel: returning mock XLSX bytes");
            return Ok(tauri::ipc::Response::new(vec![0x50, 0x4b, 0x03, 0x04]));
        }
    }
    let bytes = generate_comparison_excel_bytes(input).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::generate_pdf_bytes;
    use super::generate_excel_bytes;
    use super::generate_comparison_excel_bytes;
    use super::generate_comparison_pdf_bytes;
    use rheolab_core::report_generator::ReportInput;
    use rheolab_core::report_generator::comparison::{
        ComparisonChartConfig, ComparisonExperimentEntry, ComparisonMetrics,
        ComparisonReportInput, SectionToggles, TouchPointConfig,
    };

    const REPORT_FIXTURE_JSON: &str = include_str!("../../../tests/fixtures/report_data.json");

    fn fixture_input() -> ReportInput {
        serde_json::from_str(REPORT_FIXTURE_JSON).expect("fixture should parse")
    }

    fn fixture_comparison_input() -> ComparisonReportInput {
        // Three identical per-exp inputs, distinguishable by display name.
        let make_entry = |id: &str, name: &str| ComparisonExperimentEntry {
            id: id.into(),
            display_name: name.into(),
            report_input: fixture_input(),
            section_toggles: SectionToggles {
                show_calibration: false,
                show_raw_data: false,
                show_recipe: true,
                show_water_analysis: false,
                show_rheology: true,
            },
        };
        ComparisonReportInput {
            language: "en".into(),
            unit_system: "SI".into(),
            company_name: None,
            company_logo_base64: None,
            generated_at: "2026-04-22T00:00:00Z".into(),
            comparison_chart: ComparisonChartConfig {
                metrics: ComparisonMetrics {
                    primary: "viscosity_cp".into(),
                    left_secondary: "none".into(),
                    secondary: "none".into(),
                    tertiary: "none".into(),
                },
                axis_mode: "shared".into(),
                brush_range: None,
                touch_point: TouchPointConfig::default(),
                line_settings: Default::default(),
                experiment_colors: vec!["#1E90FF".into(), "#FF0000".into(), "#008000".into()],
                time_format: "minutes".into(),
                downsample_mode: "smart".into(),
                chart_width: 1400,
                chart_height: 700,
            },
            experiments: vec![
                make_entry("e1", "Chandler A"),
                make_entry("e2", "Chandler B"),
                make_entry("e3", "Grace"),
            ],
        }
    }

    #[tokio::test]
    async fn reports_generate_pdf_returns_pdf_bytes() {
        let bytes = generate_pdf_bytes(fixture_input())
            .await
            .expect("native PDF generation should succeed for fixture input");

        assert!(!bytes.is_empty(), "PDF bytes should not be empty");
        assert!(
            bytes.starts_with(b"%PDF"),
            "PDF output must start with %PDF header"
        );
    }

    #[tokio::test]
    async fn reports_generate_excel_returns_xlsx_bytes() {
        let bytes = generate_excel_bytes(fixture_input())
            .await
            .expect("native Excel generation should succeed for fixture input");

        assert!(!bytes.is_empty(), "Excel bytes should not be empty");
        assert!(
            bytes.starts_with(b"PK"),
            "XLSX output must start with ZIP signature"
        );
    }

    #[tokio::test]
    async fn reports_generate_pdf_rejects_invalid_input() {
        let bad_input = ReportInput {
            metadata: Default::default(),
            cycle_results: vec![],
            recipe: vec![],
            settings: Default::default(),
            ..serde_json::from_str(r#"{"metadata":{"filename":""},"cycle_results":[],"recipe":[],"settings":{}}"#).unwrap()
        };
        // A minimal ReportInput should still produce some output (empty report)
        // or fail gracefully — either way, no panic.
        let _ = generate_pdf_bytes(bad_input).await;
    }

    // ── Phase 1.H self-verification: comparison report end-to-end ─────────
    //
    // These tests exercise the full assembler path with 3 synthetic
    // experiments and confirm the byte-level invariants from ADR-0010 §5:
    //   - Excel: PK ZIP header + ≥5 worksheets (Summary + 3 exps + DebugInfo).
    //   - PDF: %PDF header + non-trivial length (typst compile succeeded).

    #[tokio::test]
    async fn reports_generate_comparison_excel_produces_valid_xlsx() {
        let bytes = generate_comparison_excel_bytes(fixture_comparison_input())
            .await
            .expect("comparison Excel should succeed");
        assert!(!bytes.is_empty());
        assert!(bytes.starts_with(b"PK"), "XLSX must start with ZIP signature");

        // Count `xl/worksheets/sheetN.xml` entries inside the ZIP stream.
        let as_str = String::from_utf8_lossy(&bytes);
        for n in 1..=5 {
            let needle = format!("xl/worksheets/sheet{}.xml", n);
            assert!(as_str.contains(&needle), "expected workbook to contain {}", needle);
        }
    }

    #[tokio::test]
    async fn reports_generate_comparison_pdf_produces_valid_pdf() {
        let bytes = generate_comparison_pdf_bytes(fixture_comparison_input())
            .await
            .expect("comparison PDF should succeed");
        assert!(!bytes.is_empty());
        assert!(bytes.starts_with(b"%PDF"), "PDF must start with %PDF header");
        // Sanity-check size: a 3-experiment report with chart + summary table
        // is well above 20 KB on disk.  If we ever regress to a blank doc,
        // this catches it.
        assert!(bytes.len() > 20_000, "PDF too small: {} bytes", bytes.len());
    }
}
