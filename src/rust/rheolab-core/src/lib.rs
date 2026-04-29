//! # RheoLab Core - Rheological Calculation Engine
//!
//! This crate provides high-performance implementations of rheological models
//! and data processing algorithms for the RheoLab Enterprise desktop application.
//!
//! ## Overview
//!
//! The RheoLab Core module is the computational engine of the application, handling:
//! - **Rheological Model Calculations** - Bingham Plastic and Power Law models
//! - **Cycle Detection** - Automatic identification of test cycles (API, ISO, SST, Custom)
//! - **Schedule Detection** - Step detection from raw time-series data
//! - **Data Parsing** - Multi-format rheometer file parsing
//! - **Report Generation** - Excel and PDF report creation
//!
//! ## Architecture
//!
//! Used as a native Rust library via Tauri IPC:
//! - **Performance** - Native execution speed, no serialization overhead
//! - **Desktop-first** - Optimized for offline desktop workflows
//! - **Shared codebase** - Single Rust implementation for all platforms
//!
//! ## Module Structure
//!
//! - [`physics`] - Rheological model calculations (Bingham, Power Law)
//! - [`grace`] - Grace M5600 specific calculations
//! - [`detectors`] - Cycle detection algorithms
//! - [`schedule_detector`] - Step detection from raw data
//! - [`processor`] - Cycle processing pipeline
//! - [`parser`] - Multi-format file parsing
//! - [`types`] - Core data structures (RheoPoint, RheoStep, RheoCycle)
//! - [`analysis`] - Test classification and hydration analysis
//!
//! ## C# Port Considerations
//!
//! This module contains all core physics and algorithm implementations.
//! When porting to C#:
//! 1. All public functions should be ported as static methods
//! 2. Data structures in [`types`] map directly to C# classes
//! 3. Algorithm logic should be preserved exactly for consistency
//! 4. Unit tests provide reference implementations for validation

mod physics;
mod grace;
pub mod types;
mod detectors;
pub mod parser;
mod processor;
pub mod parasitic_filter;
pub mod schedule_detector;
pub mod report_generator;

// Always available (native Rust API)
pub use grace::{calculate_grace_internal, ExpertSettings, GraceInputParams, GraceCycleResult};
pub use detectors::{
    detect_anchor_cycles_internal, is_sst_pattern,
    detect_sst_cycles_internal, is_repeating_sequence_pattern,
    detect_repeating_sequence_cycles_internal,
};
pub use processor::process_cycle_for_calculation as process_cycle_internal;

// WASM-only exports removed -- native Tauri build does not use WASM.

#[cfg(feature = "excel")]
pub use report_generator::generate_excel_report;

#[cfg(feature = "pdf")]
pub use report_generator::generate_pdf_report;

pub mod analysis;

pub const RHEOLAB_CORE_VERSION: &str = env!("CARGO_PKG_VERSION");
