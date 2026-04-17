//! RheoLab Enterprise - Tauri Application Entry Point
//!
//! This is the main entry point for the Tauri desktop application.

// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Guard: panic early in release if dev keys are still used
    rheolab_enterprise::commands::licensing::assert_production_keys();
    // Logging is handled by tauri_plugin_log in lib.rs
    rheolab_enterprise::run();
}
