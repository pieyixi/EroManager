use std::time::Duration;

use windows_sys::Win32::Foundation::RECT;
use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Bounds {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

fn fit_into_work_area(window: Bounds, work: RECT) -> Bounds {
    let work_width = (work.right - work.left).max(1);
    let work_height = (work.bottom - work.top).max(1);
    let width = window.width.clamp(1, work_width);
    let height = window.height.clamp(1, work_height);
    Bounds {
        x: window.x.clamp(work.left, work.right - width),
        y: window.y.clamp(work.top, work.bottom - height),
        width,
        height,
    }
}

pub(super) fn clamp_after_dpi_change(window: &tauri::Window) {
    // Windows may apply WM_DPICHANGED's suggested size after Tauri emits the scale event.
    // Defer the final physical-pixel clamp so a 100% -> 125% move cannot leave the
    // ordinary window below the secondary monitor's taskbar.
    let window = window.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(160));
        let on_main_thread = window.clone();
        let _ = window.run_on_main_thread(move || clamp_normal_window(&on_main_thread));
    });
}

fn clamp_normal_window(window: &tauri::Window) {
    if window.is_fullscreen().unwrap_or(true)
        || window.is_maximized().unwrap_or(true)
        || window.is_minimized().unwrap_or(true)
    {
        return;
    }

    let Ok(hwnd) = window.hwnd() else { return };
    let hwnd = hwnd.0;
    let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
    if monitor.is_null() {
        return;
    }
    let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
    info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
    if unsafe { GetMonitorInfoW(monitor, &mut info) } == 0 {
        return;
    }

    let mut rect: RECT = unsafe { std::mem::zeroed() };
    if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return;
    }
    let current = Bounds {
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
    };
    let fitted = fit_into_work_area(current, info.rcWork);
    if fitted != current {
        unsafe {
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                fitted.x,
                fitted.y,
                fitted.width,
                fitted.height,
                SWP_NOACTIVATE | SWP_NOZORDER,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamps_cross_dpi_window_to_negative_origin_work_area() {
        let work = RECT {
            left: -1920,
            top: -5,
            right: 0,
            bottom: 1015,
        };
        assert_eq!(
            fit_into_work_area(
                Bounds {
                    x: -1700,
                    y: 20,
                    width: 1720,
                    height: 1136,
                },
                work
            ),
            Bounds {
                x: -1720,
                y: -5,
                width: 1720,
                height: 1020,
            }
        );
    }

    #[test]
    fn keeps_fully_visible_window_unchanged() {
        let work = RECT {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1040,
        };
        let window = Bounds {
            x: 200,
            y: 100,
            width: 1360,
            height: 900,
        };
        assert_eq!(fit_into_work_area(window, work), window);
    }
}
