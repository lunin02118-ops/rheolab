#![warn(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
pub mod date_detector;
pub mod header_detector;
pub mod row_mapper;
pub mod types;

pub mod calibration;
pub mod filename_parser;
pub mod geometry_verifier;
pub mod instrument_detector;
pub mod physics_engine;
pub mod rheo_parser;
pub mod text_encoding;
pub mod validator;
