//! 本地账号：个人资料统一主库；作用域在请求开始时捕获，不跟随切换中的“当前用户”。
mod admin;
mod admin_pipe;
#[cfg(windows)]
mod admin_screen;
mod commands;
mod privacy;
mod security;
mod storage;
mod terminal;
#[cfg(test)]
mod tests;
mod tui;
pub use commands::*;
use rusqlite::Connection;
use std::{
    fs::File,
    sync::Mutex,
    time::{Duration, Instant},
};
pub(crate) use storage::{read_value, write_value};

pub struct Session(pub Mutex<SessionState>);
pub struct SessionState {
    pub key: Option<i64>,
    pub token: String,
    failures: u32,
    cooldown: Option<Instant>,
}
impl SessionState {
    pub fn authorize(&self, scope: &str) -> Result<i64, String> {
        if scope.is_empty() || self.token != scope {
            return Err("账号已锁定或已切换，请重新进入".into());
        }
        self.key.ok_or_else(|| "请先选择账号".into())
    }
    pub fn check_attempt(&self) -> Result<(), String> {
        if let Some(left) = self
            .cooldown
            .and_then(|at| at.checked_duration_since(Instant::now()))
        {
            return Err(format!("尝试过多，请 {} 秒后再试", left.as_secs() + 1));
        }
        Ok(())
    }
    pub fn failed(&mut self) {
        self.failures += 1;
        if self.failures >= 5 {
            self.cooldown = Some(Instant::now() + Duration::from_secs(30));
            self.failures = 0;
        }
    }
    pub fn activate(&mut self, key: i64) -> Result<(), String> {
        use base64::Engine;
        self.key = Some(key);
        self.token = base64::engine::general_purpose::STANDARD.encode(security::random_bytes(32)?);
        self.failures = 0;
        self.cooldown = None;
        Ok(())
    }
}
impl Session {
    pub fn new(conn: &Connection) -> Result<Self, String> {
        let key = storage::last_account(conn)?;
        let mut state = SessionState {
            key: Some(key),
            token: String::new(),
            failures: 0,
            cooldown: None,
        };
        if !storage::has_pin(conn, key)? {
            state.activate(key)?;
        }
        Ok(Self(Mutex::new(state)))
    }
    pub fn authorize(&self, scope: &str) -> Result<i64, String> {
        let state = self.0.lock().map_err(|e| e.to_string())?;
        state.authorize(scope)
    }
}
pub fn initialize(conn: &mut Connection, backup: bool) -> Result<(), String> {
    storage::initialize(conn, backup)
}
pub fn process_lock() -> Result<File, String> {
    named_lock("application.lock")
}
fn named_lock(name: &str) -> Result<File, String> {
    let directory = crate::paths::portable_database_path("database.db")
        .map_err(|e| e.to_string())?
        .parent()
        .unwrap()
        .to_path_buf();
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(0);
    }
    options
        .open(directory.join(name))
        .map_err(|_| "软件或管理终端正在运行，请先关闭另一个窗口".into())
}
pub fn entry() {
    let admin = std::env::args().any(|arg| arg == "--admin");
    if admin {
        std::process::exit(admin_entry());
    }
    let _lock = match process_lock() {
        Ok(lock) => lock,
        Err(error) => {
            tui::report(&error);
            return;
        }
    };
    crate::runtime::run();
}
pub fn admin_entry() -> i32 {
    let stdio = std::env::args().any(|arg| arg == "--stdio");
    if !stdio {
        tui::attach_console();
    }
    let lock = if stdio {
        process_lock()
    } else {
        named_lock("admin.lock").map_err(|_| "账号管理窗口已在运行".to_string())
    };
    let _lock = match lock {
        Ok(lock) => lock,
        Err(error) => {
            tui::report(&error);
            return 2;
        }
    };
    #[cfg(windows)]
    let result = if stdio {
        tui::run()
    } else {
        admin_screen::run()
    };
    #[cfg(not(windows))]
    let result = tui::run();
    match result {
        Ok(()) => 0,
        Err(error) => {
            tui::report(&error);
            1
        }
    }
}
pub(crate) fn install_admin_service(app: &tauri::AppHandle) {
    #[cfg(windows)]
    admin_pipe::install(app);
}
pub(crate) fn install_privacy(app: &tauri::AppHandle) {
    privacy::install(app);
}
pub(crate) fn forget_gallery(conn: &Connection, gid: i64) -> Result<(), String> {
    conn.execute(
        "DELETE FROM AccountValues WHERE Kind='favorite-book' AND Item=?1",
        [gid.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
