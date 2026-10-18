//! 关闭请求统一交给前端选择；真正退出与隐藏分开，避免关闭窗口后留下不可恢复的进程。
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

fn restore(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_visible(false);
    }
}

pub(super) fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "restore", "打开裏界箱庭", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "退出应用", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &exit])?;
    let icon = app.default_window_icon().ok_or("缺少托盘图标")?.clone();
    let tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("裏界箱庭")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "restore" => restore(app),
            "exit" => {
                restore(app);
                let _ = app.emit("app-exit-requested", ());
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                restore(tray.app_handle());
            }
        })
        .build(app)?;
    tray.set_visible(false)?;
    Ok(())
}

#[tauri::command]
pub fn apply_close_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    match action.as_str() {
        "tray" => {
            let tray = app.tray_by_id("main").ok_or("系统托盘未就绪")?;
            let window = app.get_webview_window("main").ok_or("主窗口不存在")?;
            tray.set_visible(true).map_err(|e| e.to_string())?;
            if let Err(error) = window.hide() {
                let _ = tray.set_visible(false);
                return Err(error.to_string());
            }
            Ok(())
        }
        "exit" => {
            app.exit(0);
            Ok(())
        }
        _ => Err("关闭方式无效".into()),
    }
}
