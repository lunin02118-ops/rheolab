//! Report Generator Module
//! 
//! Complete report generation for PDF and Excel, matching JavaScript implementation exactly.
//! This module is designed to produce byte-identical output to the React-PDF and ExcelJS versions.

#[cfg(feature = "excel")]
pub mod excel;

#[cfg(feature = "pdf")]
pub mod pdf;

pub mod types;
pub mod translations;
pub mod formatters;
pub mod touch_point;

#[cfg(feature = "pdf")]
pub mod typst_renderer;

#[cfg(feature = "charts")]
pub mod chart_generator;

/// Comparison report generator (ADR-0010).
///
/// Feature-gated on either `excel` or `pdf` because the module's concrete
/// renderers rely on those features; the shared contract types and
/// sheet-name helpers compile in all build modes.
#[cfg(any(feature = "excel", feature = "pdf"))]
pub mod comparison;

#[cfg(feature = "excel")]
pub use excel::{generate_excel_report, generate_excel_from_input};

#[cfg(feature = "pdf")]
pub use pdf::{generate_pdf_report, generate_pdf_from_input};

// Comparison report entry points (ADR-0010, Phase 1.E).
#[cfg(feature = "excel")]
pub use comparison::generate_comparison_excel;

#[cfg(feature = "pdf")]
pub use comparison::generate_comparison_pdf;

pub use types::*;
