use super::{storage, Session};
use crate::library::database::Database;
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;

#[derive(Serialize)]
pub struct AccountInfo {
    pub key: i64,
    pub id: String,
    pub nickname: String,
    pub avatar: String,
    pub has_pin: bool,
}
#[derive(Serialize)]
pub struct AccountState {
    pub accounts: Vec<AccountInfo>,
    pub current: Option<AccountInfo>,
    pub last_id: String,
    pub scope: String,
    pub locked: bool,
}
fn info(row: &rusqlite::Row<'_>) -> rusqlite::Result<AccountInfo> {
    let image: Vec<u8> = row.get(3)?;
    Ok(AccountInfo {
        key: row.get(0)?,
        id: row.get(1)?,
        nickname: row.get(2)?,
        avatar: if image.is_empty() {
            String::new()
        } else {
            format!("data:image/png;base64,{}", STANDARD.encode(image))
        },
        has_pin: row.get(4)?,
    })
}
fn snapshot(
    conn: &rusqlite::Connection,
    state: &super::SessionState,
) -> Result<AccountState, String> {
    let mut stmt=conn.prepare("SELECT AccountKey,LoginId,Nickname,Avatar,length(PinHash)>0 FROM Accounts WHERE LoginId!='0000' AND Disabled=0 ORDER BY LoginId").map_err(|e|e.to_string())?;
    let accounts = stmt
        .query_map([], info)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let current = accounts
        .iter()
        .position(|a| Some(a.key) == state.key)
        .map(|n| AccountInfo {
            key: accounts[n].key,
            id: accounts[n].id.clone(),
            nickname: accounts[n].nickname.clone(),
            avatar: accounts[n].avatar.clone(),
            has_pin: accounts[n].has_pin,
        });
    let last_id = current.as_ref().map(|a| a.id.clone()).unwrap_or_default();
    Ok(AccountState {
        accounts,
        current,
        last_id,
        scope: state.token.clone(),
        locked: state.token.is_empty(),
    })
}
#[tauri::command(async)]
pub fn account_state(
    db: tauri::State<Database>,
    session: tauri::State<Session>,
) -> Result<AccountState, String> {
    let state = session.0.lock().map_err(|e| e.to_string())?;
    snapshot(&*db.conn.lock().map_err(|e| e.to_string())?, &state)
}
#[tauri::command(async)]
pub fn account_auth(
    id: String,
    pin: String,
    db: tauri::State<Database>,
    session: tauri::State<Session>,
) -> Result<AccountState, String> {
    let mut state = session.0.lock().map_err(|e| e.to_string())?;
    state.check_attempt()?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let key: Option<i64> = conn
        .query_row(
            "SELECT AccountKey FROM Accounts WHERE LoginId=?1 AND LoginId!='0000' AND Disabled=0",
            [&id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(key) = key {
        if storage::verify_pin(&conn, key, &pin)? {
            state.activate(key)?;
            conn.execute("INSERT INTO AppSettings(Key,Value) VALUES('active_account_v1',?1) ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value",[key.to_string()]).map_err(|e|e.to_string())?;
            return snapshot(&conn, &state);
        }
    }
    state.failed();
    state.check_attempt()?;
    Err("账号不可用或 PIN 不正确".into())
}
#[tauri::command(async)]
pub fn account_lock(session: tauri::State<Session>) -> Result<(), String> {
    session.0.lock().map_err(|e| e.to_string())?.token.clear();
    Ok(())
}
#[tauri::command(async)]
pub fn account_logout(session: tauri::State<Session>) -> Result<(), String> {
    let mut state = session.0.lock().map_err(|e| e.to_string())?;
    state.token.clear();
    state.key = None;
    Ok(())
}
#[tauri::command(async)]
pub fn account_update_profile(
    scope: String,
    nickname: String,
    avatar: String,
    db: tauri::State<Database>,
    session: tauri::State<Session>,
) -> Result<(), String> {
    let state = session.0.lock().map_err(|e| e.to_string())?;
    let key = state.authorize(&scope)?;
    let name = nickname.trim();
    if name.is_empty() || name.chars().count() > 24 {
        return Err("昵称应为1至24个字符".into());
    }
    let bytes = if avatar.is_empty() {
        vec![]
    } else {
        let value = avatar
            .strip_prefix("data:image/png;base64,")
            .ok_or("头像格式无效")?;
        if value.len() > 2_800_000 {
            return Err("头像过大，请重新裁剪".into());
        }
        let bytes = STANDARD.decode(value).map_err(|_| "头像无法读取")?;
        if bytes.len() < 24 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err("头像不是有效 PNG".into());
        }
        let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
        let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
        if width != 512 || height != 512 {
            return Err("请使用512像素圆形裁剪头像".into());
        }
        bytes
    };
    db.conn
        .lock()
        .map_err(|e| e.to_string())?
        .execute(
            "UPDATE Accounts SET Nickname=?1,Avatar=?2 WHERE AccountKey=?3",
            params![name, bytes, key],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command(async)]
pub fn account_change_pin(
    scope: String,
    new_pin: String,
    db: tauri::State<Database>,
    session: tauri::State<Session>,
) -> Result<(), String> {
    let state = session.0.lock().map_err(|e| e.to_string())?;
    let key = state.authorize(&scope)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    // 当前账号已经解锁；原位开关/回车修改由此会话授权，PIN仍只保存盐和校验值。
    storage::set_pin(&conn, key, &new_pin)
}
#[tauri::command(async)]
pub fn account_get_data(
    scope: String,
    kind: String,
    item: String,
    db: tauri::State<Database>,
    session: tauri::State<Session>,
) -> Result<Option<String>, String> {
    let key = session.authorize(&scope)?;
    validate_kind(&kind, &item)?;
    storage::read_value(
        &*db.conn.lock().map_err(|e| e.to_string())?,
        key,
        &kind,
        &item,
    )
}
fn validate_kind(kind: &str, item: &str) -> Result<(), String> {
    if (kind == "privacy" && item.is_empty())
        || (kind == "draw" && ["media", "book"].contains(&item))
    {
        Ok(())
    } else {
        Err("账号数据类型无效".into())
    }
}
#[tauri::command(async)]
pub fn account_set_data(
    scope: String,
    kind: String,
    item: String,
    value: String,
    db: tauri::State<Database>,
    session: tauri::State<Session>,
) -> Result<(), String> {
    let key = session.authorize(&scope)?;
    validate_kind(&kind, &item)?;
    if value.len() > 8_000_000 {
        return Err("账号记录过大".into());
    }
    let data: serde_json::Value = serde_json::from_str(&value).map_err(|_| "账号记录格式无效")?;
    if kind == "draw" {
        for name in ["seen", "recent"] {
            let ids = data[name].as_array().ok_or("抽卡记录无效")?;
            if ids.len() > 1_000_000 || ids.iter().any(|n| n.as_i64().is_none() || n == 0) {
                return Err("抽卡ID无效".into());
            }
        }
        if data["recent"].as_array().unwrap().len() > 20 {
            return Err("最近抽卡记录过长".into());
        }
    } else {
        let idle = data["idle_seconds"].as_u64().ok_or("闲置时间无效")?;
        let delay = data["background_seconds"].as_u64().ok_or("后台时间无效")?;
        if idle > 86400 || delay > 86400 {
            return Err("锁定时间应在0至86400秒内".into());
        }
        for name in ["minimize", "system", "while_playing"] {
            if !data[name].is_boolean() {
                return Err("隐私设置无效".into());
            }
        }
    }
    storage::write_value(
        &*db.conn.lock().map_err(|e| e.to_string())?,
        key,
        &kind,
        &item,
        &value,
    )
}

pub(crate) fn personal_favorites(
    conn: &rusqlite::Connection,
    key: i64,
    kind: &str,
) -> Result<Vec<String>, String> {
    storage::favorites(conn, key, kind)
}
pub(crate) fn set_personal_favorite(
    conn: &rusqlite::Connection,
    key: i64,
    kind: &str,
    item: &str,
    favorite: bool,
) -> Result<(), String> {
    storage::favorite(conn, key, kind, item, favorite)
}
