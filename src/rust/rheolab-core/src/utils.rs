//! Utility functions for rheolab-core

/// Set panic hook (no-op in native mode; previously used console_error_panic_hook for WASM)
pub fn set_panic_hook() {
    // In native Tauri mode, panics are handled by the Rust runtime.
}

/// Log to stderr (replaces console.log for native mode)
pub fn log(s: &str) {
    eprintln!("[rheolab-core] {}", s);
}

#[allow(unused_macros)]
macro_rules! console_log {
    ($($t:tt)*) => {
        $crate::utils::log(&format!($($t)*))
    }
}

#[allow(unused_imports)]
pub(crate) use console_log;
