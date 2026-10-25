//! 只在本机、同一便携目录间传递管理请求；不开放网络端口或写出凭据。
use super::admin::{self, Guard, Reply, Request};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    time::Duration,
};

pub fn pipe_name() -> String {
    let path = crate::paths::portable_app_dir()
        .to_string_lossy()
        .to_lowercase();
    format!(
        r"\\.\pipe\ero-manager-admin-{:08x}",
        crc32fast::hash(path.as_bytes())
    )
}
fn read_frame<T: serde::de::DeserializeOwned>(file: &mut File, limit: usize) -> Result<T, String> {
    let mut size = [0; 4];
    file.read_exact(&mut size).map_err(|e| e.to_string())?;
    let size = u32::from_le_bytes(size) as usize;
    if size == 0 || size > limit {
        return Err("管理请求大小无效".into());
    }
    let mut bytes = vec![0; size];
    file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "管理消息格式无效".into())
}
fn write_frame<T: serde::Serialize>(file: &mut File, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    file.write_all(&(bytes.len() as u32).to_le_bytes())
        .and_then(|_| file.write_all(&bytes))
        .map_err(|e| e.to_string())
}
pub struct Client {
    local: Option<crate::library::database::Database>,
    guard: Guard,
    pub online: bool,
}
impl Client {
    pub fn new() -> Self {
        Self {
            local: None,
            guard: Guard::default(),
            online: false,
        }
    }
    pub fn call(&mut self, request: Request) -> Result<Reply, String> {
        // 已连接的请求不得在返回途中断线时自动重放，避免重复创建/切换状态。
        if let Ok(mut pipe) = OpenOptions::new().read(true).write(true).open(pipe_name()) {
            self.online = true;
            self.local = None;
            write_frame(&mut pipe, &request)?;
            return read_frame(&mut pipe, 4_000_000).and_then(checked);
        }
        // 只在一次离线事务期间持有应用锁；TUI 停留在菜单时，GUI 可以正常启动。
        let lock = match super::process_lock() {
            Ok(lock) => lock,
            Err(_) => {
                for _ in 0..30 {
                    std::thread::sleep(Duration::from_millis(100));
                    if let Ok(mut pipe) =
                        OpenOptions::new().read(true).write(true).open(pipe_name())
                    {
                        self.online = true;
                        self.local = None;
                        write_frame(&mut pipe, &request)?;
                        return read_frame(&mut pipe, 4_000_000).and_then(checked);
                    }
                }
                return Err("主程序管理服务尚未就绪；请确认主程序也已更新".into());
            }
        };
        self.online = false;
        if self.local.is_none() {
            self.local = Some(crate::library::database::init_db()?);
        }
        let mut conn = self
            .local
            .as_ref()
            .unwrap()
            .conn
            .lock()
            .map_err(|e| e.to_string())?;
        super::initialize(&mut conn, true)?;
        let result = admin::handle(&conn, &mut self.guard, request).map(|(reply, _)| reply);
        drop(lock);
        result
    }
}
fn checked(reply: Reply) -> Result<Reply, String> {
    if let Some(error) = &reply.error {
        Err(error.clone())
    } else {
        Ok(reply)
    }
}

#[cfg(windows)]
pub fn install(app: &tauri::AppHandle) {
    use std::os::windows::io::FromRawHandle;
    use tauri::{Emitter, Manager};
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_PIPE_CONNECTED, INVALID_HANDLE_VALUE},
        Storage::FileSystem::PIPE_ACCESS_DUPLEX,
        System::Pipes::*,
    };
    let app = app.clone();
    std::thread::spawn(move || {
        let mut guard = Guard::default();
        let name = pipe_name()
            .encode_utf16()
            .chain(Some(0))
            .collect::<Vec<_>>();
        loop {
            let handle = unsafe {
                CreateNamedPipeW(
                    name.as_ptr(),
                    PIPE_ACCESS_DUPLEX,
                    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                    1,
                    65536,
                    8192,
                    2000,
                    std::ptr::null(),
                )
            };
            if handle == INVALID_HANDLE_VALUE {
                return;
            }
            let mut pipe = unsafe { File::from_raw_handle(handle) };
            let connected = unsafe {
                ConnectNamedPipe(handle, std::ptr::null_mut()) != 0
                    || GetLastError() == ERROR_PIPE_CONNECTED
            };
            if connected {
                let mut changed = None;
                let response = (|| -> Result<Reply, String> {
                    let request: Request = read_frame(&mut pipe, 8192)?;
                    // 与登录使用相同锁序：会话 -> 主库；重置当前账号时同步使旧 scope 失效。
                    let session = app.state::<super::Session>();
                    let mut state = session.0.lock().map_err(|e| e.to_string())?;
                    let db = app.state::<crate::library::database::Database>();
                    let conn = db.conn.lock().map_err(|e| e.to_string())?;
                    let (reply, change) = admin::handle(&conn, &mut guard, request)?;
                    if let Some(change) = change {
                        let revoke = change.apply(&mut state);
                        changed = Some(revoke);
                    }
                    Ok(reply)
                })()
                .unwrap_or_else(Reply::failure);
                let _ = write_frame(&mut pipe, &response);
                unsafe {
                    windows_sys::Win32::Storage::FileSystem::FlushFileBuffers(handle);
                    DisconnectNamedPipe(handle);
                }
                if let Some(revoke) = changed {
                    let _ = app.emit("accounts-admin-changed", revoke);
                }
            }
        }
    });
}
