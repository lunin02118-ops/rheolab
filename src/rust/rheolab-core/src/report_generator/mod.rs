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

#[cfg(feature = "excel")]
pub use excel::{generate_excel_report, generate_excel_from_input};

#[cfg(feature = "pdf")]
pub use pdf::{generate_pdf_report, generate_pdf_from_input};

pub use types::*;
