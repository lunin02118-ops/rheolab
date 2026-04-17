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

#[cfg(test)]
mod tests {
    use super::generate_pdf_bytes;
    use super::generate_excel_bytes;
    use rheolab_core::report_generator::ReportInput;

    const REPORT_FIXTURE_JSON: &str = include_str!("../../../tests/fixtures/report_data.json");

    fn fixture_input() -> ReportInput {
        serde_json::from_str(REPORT_FIXTURE_JSON).expect("fixture should parse")
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
}
