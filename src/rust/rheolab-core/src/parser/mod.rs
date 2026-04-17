#![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
pub mod header_detector;
pub mod row_mapper;
pub mod date_detector;
pub mod types;

pub mod rheo_parser;
pub mod instrument_detector;
pub mod geometry_verifier;
pub mod calibration;
pub mod validator;
pub mod physics_engine;
pub mod filename_parser;
