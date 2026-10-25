//! Windows 内核互斥体按便携目录隔离，不生成锁文件；GUI/TUI 各自单实例。
#[cfg(windows)]
pub struct ProcessLock {
    handle: windows_sys::Win32::Foundation::HANDLE,
    // Mutex 的释放必须留在取得所有权的线程。
    _thread: std::marker::PhantomData<std::rc::Rc<()>>,
}

#[cfg(windows)]
impl Drop for ProcessLock {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::System::Threading::ReleaseMutex(self.handle);
            windows_sys::Win32::Foundation::CloseHandle(self.handle);
        }
    }
}

#[cfg(windows)]
pub(super) fn named_lock(role: &str) -> Result<ProcessLock, String> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, WAIT_ABANDONED, WAIT_OBJECT_0},
        System::Threading::{CreateMutexW, WaitForSingleObject},
    };
    let root = crate::paths::portable_app_dir();
    let root = root.canonicalize().unwrap_or(root);
    let identity = root.to_string_lossy().to_lowercase();
    let hash = ring::digest::digest(&ring::digest::SHA256, identity.as_bytes());
    let hash: String = hash.as_ref().iter().map(|b| format!("{b:02x}")).collect();
    let name: Vec<u16> = format!(r"Local\ero-manager-{hash}-{role}")
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let handle = unsafe { CreateMutexW(std::ptr::null(), 0, name.as_ptr()) };
    if handle.is_null() {
        return Err(format!(
            "无法创建程序互斥体：{}",
            std::io::Error::last_os_error()
        ));
    }
    match unsafe { WaitForSingleObject(handle, 0) } {
        WAIT_OBJECT_0 | WAIT_ABANDONED => Ok(ProcessLock {
            handle,
            _thread: std::marker::PhantomData,
        }),
        _ => {
            unsafe {
                CloseHandle(handle);
            }
            Err("软件或管理终端正在运行，请先关闭另一个窗口".into())
        }
    }
}

#[cfg(not(windows))]
pub struct ProcessLock;
#[cfg(not(windows))]
pub(super) fn named_lock(_role: &str) -> Result<ProcessLock, String> {
    Err("本地账号管理需要 Windows 进程互斥支持".into())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    #[test]
    fn excludes_other_threads_and_recovers_abandoned_owner_without_files() {
        let role = format!(
            "test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let guard = named_lock(&role).unwrap();
        let other = role.clone();
        assert!(std::thread::spawn(move || named_lock(&other).is_err())
            .join()
            .unwrap());
        drop(guard);
        let other = role.clone();
        let abandoned = std::thread::spawn(move || {
            let guard = named_lock(&other).unwrap();
            let raw = guard.handle as usize;
            std::mem::forget(guard);
            raw
        })
        .join()
        .unwrap();
        let recovered = named_lock(&role).unwrap();
        drop(recovered);
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(abandoned as _);
        }
    }
}
