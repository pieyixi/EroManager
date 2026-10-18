use super::{security, storage};
use rusqlite::{params, Connection, OptionalExtension};
use std::io::{self, Write};

pub fn attach_console() {
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::System::Console::*;
        if AttachConsole(ATTACH_PARENT_PROCESS) == 0 {
            AllocConsole();
        }
        SetConsoleOutputCP(65001);
        SetConsoleCP(65001);
    }
}
pub fn report(error: &str) {
    eprintln!("{error}");
    if std::env::args().any(|arg| arg == "--stdio") {
        return;
    }
    #[cfg(windows)]
    unsafe {
        if windows_sys::Win32::System::Console::GetConsoleWindow().is_null() {
            let text: Vec<u16> = error.encode_utf16().chain(Some(0)).collect();
            let title: Vec<u16> = "裏界箱庭".encode_utf16().chain(Some(0)).collect();
            windows_sys::Win32::UI::WindowsAndMessaging::MessageBoxW(
                std::ptr::null_mut(),
                text.as_ptr(),
                title.as_ptr(),
                0,
            );
        }
    }
}
fn input(label: &str) -> Result<String, String> {
    print!("{label}");
    io::stdout().flush().map_err(|e| e.to_string())?;
    let mut value = String::new();
    if io::stdin()
        .read_line(&mut value)
        .map_err(|e| e.to_string())?
        == 0
    {
        return Err("输入已关闭".into());
    }
    Ok(value.trim().into())
}
fn pin(label: &str) -> Result<String, String> {
    #[cfg(windows)]
    let console = unsafe {
        use windows_sys::Win32::System::Console::*;
        let handle = GetStdHandle(STD_INPUT_HANDLE);
        let mut mode = 0;
        if GetConsoleMode(handle, &mut mode) != 0 {
            SetConsoleMode(handle, mode & !ENABLE_ECHO_INPUT);
            Some((handle, mode))
        } else {
            None
        }
    };
    let value = input(label);
    #[cfg(windows)]
    if let Some((handle, mode)) = console {
        unsafe {
            windows_sys::Win32::System::Console::SetConsoleMode(handle, mode);
        }
        println!();
    }
    value
}
fn new_pin(allow_empty: bool) -> Result<String, String> {
    let value = pin(if allow_empty {
        "新 PIN（四位数字，留空关闭）："
    } else {
        "新管理员 PIN（四位数字）："
    })?;
    if !(allow_empty && value.is_empty()) && !security::valid_pin(&value) {
        return Err("PIN 必须为四位数字".into());
    }
    if value != pin("再次输入：")? {
        return Err("两次输入不一致".into());
    }
    Ok(value)
}
pub fn key_for(conn: &Connection, id: &str) -> Result<i64, String> {
    if id == "0000" {
        return Err("此操作只适用于普通账号".into());
    }
    conn.query_row(
        "SELECT AccountKey FROM Accounts WHERE LoginId=?1",
        [id],
        |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "账号不存在".into())
}
pub fn rename_id(conn: &Connection, key: i64, id: &str) -> Result<(), String> {
    if id == "0000" || id.len() != 4 || !id.bytes().all(|b| b.is_ascii_digit()) {
        return Err("普通 ID 必须为0001至9999".into());
    }
    conn.execute(
        "UPDATE Accounts SET LoginId=?1 WHERE AccountKey=?2 AND LoginId!='0000'",
        params![id, key],
    )
    .map_err(|_| "ID 已被占用或无法修改".to_string())?;
    Ok(())
}
pub fn delete(conn: &Connection, key: i64) -> Result<(), String> {
    let ordinary: bool = conn
        .query_row(
            "SELECT LoginId!='0000' FROM Accounts WHERE AccountKey=?1",
            [key],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !ordinary {
        return Err("不能删除管理员".into());
    }
    let remaining: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM Accounts WHERE LoginId!='0000' AND Disabled=0 AND AccountKey!=?1",
            [key],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if remaining == 0 {
        return Err("请至少保留一个启用的普通账号".into());
    }
    conn.execute("DELETE FROM Accounts WHERE AccountKey=?1", [key])
        .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn rename_nickname(conn: &Connection, key: i64, name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 24 || name.chars().any(char::is_control) {
        return Err("昵称应为1至24个可见字符".into());
    }
    conn.execute(
        "UPDATE Accounts SET Nickname=?1 WHERE AccountKey=?2",
        params![name, key],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn toggle(conn: &Connection, key: i64) -> Result<(), String> {
    let active: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM Accounts WHERE LoginId!='0000' AND Disabled=0 AND AccountKey!=?1",
            [key],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let disabled: bool = conn
        .query_row(
            "SELECT Disabled FROM Accounts WHERE AccountKey=?1",
            [key],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !disabled && active == 0 {
        return Err("请至少保留一个启用的普通账号".into());
    }
    conn.execute(
        "UPDATE Accounts SET Disabled=1-Disabled WHERE AccountKey=?1",
        [key],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
pub fn run() -> Result<(), String> {
    let db = crate::library::database::init_db();
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    super::initialize(&mut conn, true)?;
    let admin: i64 = conn
        .query_row(
            "SELECT AccountKey FROM Accounts WHERE LoginId='0000'",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    println!("\n  裏界箱庭 · 本地账号管理\n  仅管理账号与个人记录，不操作共用媒体文件。\n");
    if !storage::has_pin(&conn, admin)? {
        println!("首次使用，请设置管理员 PIN。此 PIN 仅用于本地管理。");
        storage::set_pin(&conn, admin, &new_pin(false)?)?;
    } else {
        let mut verified = false;
        for attempt in 0..5 {
            if storage::verify_pin(&conn, admin, &pin("管理员 0000 PIN：")?)? {
                verified = true;
                break;
            }
            println!("PIN 不正确（剩余 {} 次）", 4 - attempt);
        }
        if !verified {
            return Err("验证失败，请重新打开管理工具".into());
        }
    }
    loop {
        println!("\n┌────────────────────────────────────────┐\n│  ID     昵称                 状态 / PIN │\n└────────────────────────────────────────┘");
        {
            let mut query=conn.prepare("SELECT LoginId,Nickname,Disabled,length(PinHash)>0 FROM Accounts ORDER BY LoginId").map_err(|e|e.to_string())?;
            for row in query
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, bool>(2)?,
                        r.get::<_, bool>(3)?,
                    ))
                })
                .map_err(|e| e.to_string())?
            {
                let (id, name, disabled, locked) = row.map_err(|e| e.to_string())?;
                println!(
                    "  {id}   {name:20} {} / {}",
                    if disabled { "停用" } else { "启用" },
                    if locked { "有 PIN" } else { "无 PIN" }
                );
            }
        }
        println!("\n  1 创建账号   2 修改 ID   3 修改昵称   4 重置 PIN\n  5 停用/启用  6 删除账号  7 修改管理员 PIN   0 退出");
        let action = input("选择：")?;
        if action == "0" {
            break;
        }
        let result = (|| -> Result<(), String> {
            if action == "1" {
                let name = input("昵称（可重名）：")?;
                let password = new_pin(true)?;
                let copy = input("复制偏好的账号 ID（留空使用默认）：")?;
                let from = if copy.is_empty() {
                    None
                } else {
                    Some(key_for(&conn, &copy)?)
                };
                println!(
                    "已创建 ID {}",
                    storage::create(&conn, &name, &password, from)?
                );
                return Ok(());
            }
            if action == "7" {
                storage::set_pin(&conn, admin, &new_pin(false)?)?;
                return Ok(());
            }
            if !["2", "3", "4", "5", "6"].contains(&action.as_str()) {
                return Err("请选择菜单编号".into());
            }
            let id = input("普通账号 ID：")?;
            let key = key_for(&conn, &id)?;
            match action.as_str() {
                "2" => rename_id(&conn, key, &input("新的四位 ID：")?)?,
                "3" => {
                    let name = input("新的昵称：")?;
                    rename_nickname(&conn, key, &name)?;
                }
                "4" => {
                    println!("重置后可以访问该账号的个人内容。");
                    storage::set_pin(&conn, key, &new_pin(true)?)?;
                }
                "5" => {
                    toggle(&conn, key)?;
                }
                "6" => {
                    if input(&format!("将删除 {id} 的资料、收藏及进度。输入该 ID 确认："))? != id
                    {
                        return Err("已取消".into());
                    }
                    delete(&conn, key)?;
                }
                _ => {}
            }
            Ok(())
        })();
        match result {
            Ok(()) => println!("操作完成。"),
            Err(error) => println!("未完成：{error}"),
        }
    }
    Ok(())
}
