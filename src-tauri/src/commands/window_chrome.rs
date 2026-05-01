//! Native window chrome polish.
//!
//! Keeps the OS titlebar/buttons/resizing intact while matching the caption
//! colors to the app theme on Windows builds that support DWM caption colors.

#[tauri::command]
pub fn window_set_theme_chrome(window: tauri::WebviewWindow, theme: String) -> Result<(), String> {
    set_theme_chrome(&window, theme.as_str())
}

#[cfg(windows)]
fn set_theme_chrome(window: &tauri::WebviewWindow, theme: &str) -> Result<(), String> {
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR,
        DWMWA_USE_IMMERSIVE_DARK_MODE,
    };

    let hwnd = window
        .hwnd()
        .map_err(|error| format!("failed to access native HWND: {error}"))?;
    let dark = theme.eq_ignore_ascii_case("dark");

    let caption = if dark {
        colorref(2, 6, 23)
    } else {
        colorref(232, 241, 247)
    };
    let text = if dark {
        colorref(248, 250, 252)
    } else {
        colorref(15, 23, 42)
    };
    let border = if dark {
        colorref(30, 41, 59)
    } else {
        colorref(148, 163, 184)
    };
    let dark_mode: i32 = if dark { 1 } else { 0 };

    // These attributes are available on modern Windows builds.  Older builds
    // may reject one or more values; keep startup/theme switching non-fatal.
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            (&dark_mode as *const i32).cast(),
            std::mem::size_of_val(&dark_mode) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_COLOR,
            (&caption as *const u32).cast(),
            std::mem::size_of_val(&caption) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_TEXT_COLOR,
            (&text as *const u32).cast(),
            std::mem::size_of_val(&text) as u32,
        );
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            (&border as *const u32).cast(),
            std::mem::size_of_val(&border) as u32,
        );
    }

    Ok(())
}

#[cfg(not(windows))]
fn set_theme_chrome(_window: &tauri::WebviewWindow, _theme: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn colorref(red: u8, green: u8, blue: u8) -> u32 {
    red as u32 | ((green as u32) << 8) | ((blue as u32) << 16)
}
