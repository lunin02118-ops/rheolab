//! Logger commands for frontend logging

/// Log an info message from the frontend
#[tauri::command]
pub fn log_info(message: String) {
    tracing::info!("[Renderer] {}", message);
}

/// Log an error message from the frontend
#[tauri::command]
pub fn log_error(message: String) {
    tracing::error!("[Renderer] {}", message);
}
