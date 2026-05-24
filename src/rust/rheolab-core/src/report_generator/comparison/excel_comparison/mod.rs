//! Excel comparison report assembler (ADR-0010, Phase 1.E).
//!
//! Produces an XLSX workbook with:
//! 1. A **Summary** sheet — per-experiment summary table (one row each).
//! 2. An **Overlap Chart** sheet — paired (time, viscosity) columns for
//!    every experiment plus a native Excel ScatterSmooth chart.
//! 3. One sheet per experiment, populated via
//!    [`super::super::excel::write_single_experiment_to_sheet`].
//! 4. A hidden **DebugInfo** sheet — single-experiment first entry's
//!    settings, mirroring the single-exp path for diagnostics.
//!
//! # Module layout
//!
//! Split into focused submodules so each section stays under ~500 LOC:
//!
//! | File | LOC | Responsibility |
//! |---|---:|---|
//! | `mod.rs` | ~120 | Entry + orchestrator (sheet allocation, save) |
//! | `helpers.rs` | ~50 | Palette, key-normalisation, colour parsing |
//! | `layout.rs` | ~250 | In-memory chart-data layout computation |
//! | `overlap_sheet.rs` | ~470 | Overlap-chart worksheet + touch-point tables |
//! | `tests.rs` | ~360 | All 14 tests |

use rust_xlsxwriter::{Workbook, XlsxError};

use super::super::excel::{write_single_experiment_to_sheet, Styles};
use super::allocate_sheet_name;
use super::types::ComparisonReportInput;

mod helpers;
mod layout;
mod overlap_sheet;

#[cfg(test)]
mod tests;

use layout::{compute_chart_data_layout, write_chart_data_to_sheet};
use overlap_sheet::write_overlap_chart_sheet;

/// Generate a comparison XLSX report.
///
/// Returns the complete workbook as a byte buffer ready to be streamed
/// back to the UI or written to disk.
pub fn generate_comparison_excel(input: &ComparisonReportInput) -> Result<Vec<u8>, String> {
    if input.experiments.is_empty() {
        return Err("comparison report requires at least one experiment".to_string());
    }

    generate_comparison_excel_internal(input)
        .map_err(|e| format!("Excel comparison generation error: {}", e))
}

fn generate_comparison_excel_internal(input: &ComparisonReportInput) -> Result<Vec<u8>, XlsxError> {
    let mut workbook = Workbook::new();
    let styles = Styles::new();
    let is_ru = input.language.trim().to_lowercase().starts_with("ru");

    // Track used sheet names so dedupe suffixes work across ALL sheets.
    let mut used_names: Vec<String> = Vec::new();

    // ── Pre-allocate per-experiment sheet names ─────────────────────────
    let exp_sheet_names: Vec<String> = input
        .experiments
        .iter()
        .map(|entry| allocate_sheet_name(&entry.display_name, &mut used_names))
        .collect();

    // ── Compute chart data in memory (no sheet yet) ─────────────────────
    // We compute everything first, then create sheets in the desired tab
    // order: visible sheets first, hidden _ChartData last.
    let data_sheet_name = allocate_sheet_name("_ChartData", &mut used_names);
    let chart_data = compute_chart_data_layout(input, is_ru)?;

    // ── Sheet 1 (visible): Overlap Chart ────────────────────────────────
    let overlap_name = allocate_sheet_name(
        if is_ru {
            "Общий график"
        } else {
            "Overlap Chart"
        },
        &mut used_names,
    );
    {
        let sheet = workbook.add_worksheet();
        sheet.set_name(&overlap_name)?;
        write_overlap_chart_sheet(sheet, input, &data_sheet_name, &chart_data, is_ru)?;
    }

    // ── Per-experiment report sheets ────────────────────────────────────
    for (i, entry) in input.experiments.iter().enumerate() {
        let mut per_exp = entry.report_input.clone();
        per_exp.settings.show_calibration = entry.section_toggles.show_calibration;
        per_exp.settings.show_raw_data = entry.section_toggles.show_raw_data;
        if !entry.section_toggles.show_rheology {
            per_exp.cycle_results.clear();
            per_exp.cycles.clear();
        }

        let name = &exp_sheet_names[i];
        let sheet = workbook.add_worksheet();
        sheet.set_name(name)?;
        write_single_experiment_to_sheet(sheet, name, &per_exp, &styles)?;
    }

    // ── Hidden data sheet — chart series reference this by name ─────────
    // Created after all visible sheets so it appears last in the tab bar.
    {
        let data_sheet = workbook.add_worksheet();
        data_sheet.set_name(&data_sheet_name)?;
        data_sheet.set_hidden(true);
        write_chart_data_to_sheet(data_sheet, &chart_data)?;
    }

    // ── Hidden DebugInfo sheet (mirrors single-exp path) ───────────────
    let debug_name = allocate_sheet_name("DebugInfo", &mut used_names);
    let debug = workbook.add_worksheet();
    debug.set_name(&debug_name)?;
    debug.set_hidden(true);
    debug.write_string(0, 0, "Setting")?;
    debug.write_string(0, 1, "Value")?;
    debug.write_string(1, 0, "Language")?;
    debug.write_string(1, 1, &input.language)?;
    debug.write_string(2, 0, "Unit System")?;
    debug.write_string(2, 1, &input.unit_system)?;
    debug.write_string(3, 0, "Experiments")?;
    debug.write_number(3, 1, input.experiments.len() as f64)?;
    debug.write_string(4, 0, "Axis Mode")?;
    debug.write_string(4, 1, &input.comparison_chart.axis_mode)?;
    debug.write_string(5, 0, "Generated At")?;
    debug.write_string(5, 1, &input.generated_at)?;

    workbook.save_to_buffer()
}
