use tauri::{Emitter, Manager};
pub fn install(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut previous = std::time::SystemTime::now();
        let mut was_minimized = false;
        #[cfg(windows)]
        let mut was_locked = false;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(1));
            let now = std::time::SystemTime::now();
            if now.duration_since(previous).unwrap_or_default().as_secs() > 10 {
                let _ = app.emit("privacy-system-boundary", ());
            }
            previous = now;
            if let Some(window) = app.get_webview_window("main") {
                let minimized =
                    window.is_minimized().unwrap_or(false) || !window.is_visible().unwrap_or(true);
                if minimized && !was_minimized {
                    let _ = app.emit("privacy-minimized", ());
                }
                was_minimized = minimized;
            }
            #[cfg(windows)]
            unsafe {
                use windows_sys::Win32::System::StationsAndDesktops::*;
                let desktop = OpenInputDesktop(0, 0, DESKTOP_SWITCHDESKTOP);
                let locked = desktop.is_null() || SwitchDesktop(desktop) == 0;
                if !desktop.is_null() {
                    CloseDesktop(desktop);
                }
                if locked && !was_locked {
                    let _ = app.emit("privacy-system-boundary", ());
                }
                was_locked = locked;
            }
        }
    });
}
