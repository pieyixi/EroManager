//! CLI 与全屏终端共用账号规则；IPC 请求只在通过 0000 PIN 验证后执行。
use super::{security, storage, tui};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct User {
    pub key: i64,
    pub id: String,
    pub nickname: String,
    pub disabled: bool,
    pub has_pin: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    Status,
    Authenticate,
    Create {
        nickname: String,
        pin: String,
        copy: String,
    },
    RenameId {
        key: i64,
        id: String,
    },
    Rename {
        key: i64,
        nickname: String,
    },
    ResetPin {
        key: i64,
        pin: String,
    },
    Toggle {
        key: i64,
    },
    Delete {
        key: i64,
        confirm: String,
    },
    AdminPin {
        pin: String,
    },
}
#[derive(Serialize, Deserialize)]
pub struct Request {
    pub pin: String,
    pub action: Action,
}
#[derive(Default, Debug, Serialize, Deserialize)]
pub struct Reply {
    pub configured: bool,
    pub users: Vec<User>,
    pub message: String,
    pub error: Option<String>,
}
impl Reply {
    pub fn failure(error: String) -> Self {
        Self {
            error: Some(error),
            ..Self::default()
        }
    }
}
#[derive(Default)]
pub struct Guard {
    failures: u8,
    cooldown: Option<Instant>,
}
impl Guard {
    fn check(&self) -> Result<(), String> {
        if let Some(left) = self
            .cooldown
            .and_then(|time| time.checked_duration_since(Instant::now()))
        {
            return Err(format!("尝试过多，请 {} 秒后再试", left.as_secs() + 1));
        }
        Ok(())
    }
    fn failed(&mut self) {
        self.failures += 1;
        if self.failures >= 5 {
            self.failures = 0;
            self.cooldown = Some(Instant::now() + Duration::from_secs(30));
        }
    }
}
pub struct Change {
    pub target: Option<i64>,
    pub revoke: bool,
}
impl Change {
    pub fn apply(&self, state: &mut super::SessionState) -> bool {
        let revoke = self.revoke && self.target == state.key;
        if revoke {
            state.token.clear();
        }
        revoke
    }
}

fn ordinary(conn: &Connection, key: i64) -> Result<String, String> {
    conn.query_row(
        "SELECT LoginId FROM Accounts WHERE AccountKey=?1 AND LoginId!='0000'",
        [key],
        |row| row.get(0),
    )
    .map_err(|_| "请选择一个普通账号".into())
}
fn valid_pin(value: &str, empty: bool) -> Result<(), String> {
    if (empty && value.is_empty()) || security::valid_pin(value) {
        Ok(())
    } else {
        Err("PIN 必须为四位数字".into())
    }
}
pub fn users(conn: &Connection) -> Result<Vec<User>, String> {
    let mut stmt = conn.prepare("SELECT AccountKey,LoginId,Nickname,Disabled,length(PinHash)>0 FROM Accounts ORDER BY LoginId").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(User {
                key: row.get(0)?,
                id: row.get(1)?,
                nickname: row.get(2)?,
                disabled: row.get(3)?,
                has_pin: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}
pub fn handle(
    conn: &Connection,
    guard: &mut Guard,
    request: Request,
) -> Result<(Reply, Option<Change>), String> {
    let admin: i64 = conn
        .query_row(
            "SELECT AccountKey FROM Accounts WHERE LoginId='0000'",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let configured = storage::has_pin(conn, admin)?;
    if matches!(request.action, Action::Status) {
        return Ok((
            Reply {
                configured,
                ..Reply::default()
            },
            None,
        ));
    }
    guard.check()?;
    if !configured {
        if !matches!(request.action, Action::Authenticate) {
            return Err("请先设置管理员 PIN".into());
        }
        valid_pin(&request.pin, false)?;
        storage::set_pin(conn, admin, &request.pin)?;
    } else if !storage::verify_pin(conn, admin, &request.pin)? {
        guard.failed();
        guard.check()?;
        return Err("管理员 PIN 不正确".into());
    }
    guard.failures = 0;
    guard.cooldown = None;
    let mut change = None;
    let mut message = String::new();
    if !matches!(request.action, Action::Authenticate) {
        // 复用现有 SQL 规则，在一个事务内完成校验与修改，避免最后账号保护的竞态。
        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let target = match &request.action {
            Action::RenameId { key, .. }
            | Action::Rename { key, .. }
            | Action::ResetPin { key, .. }
            | Action::Toggle { key }
            | Action::Delete { key, .. } => {
                ordinary(&tx, *key)?;
                Some(*key)
            }
            _ => None,
        };
        let mut revoke = false;
        match request.action {
            Action::Create {
                nickname,
                pin,
                copy,
            } => {
                let source = if copy.is_empty() {
                    None
                } else {
                    Some(tui::key_for(&tx, &copy)?)
                };
                message = format!(
                    "已创建账号 {}",
                    storage::create(&tx, &nickname, &pin, source)?
                );
            }
            Action::RenameId { key, id } => tui::rename_id(&tx, key, &id)?,
            Action::Rename { key, nickname } => tui::rename_nickname(&tx, key, &nickname)?,
            Action::ResetPin { key, pin } => {
                valid_pin(&pin, true)?;
                storage::set_pin(&tx, key, &pin)?;
                revoke = true;
            }
            Action::Toggle { key } => {
                tui::toggle(&tx, key)?;
                revoke = true;
            }
            Action::Delete { key, confirm } => {
                if ordinary(&tx, key)? != confirm {
                    return Err("确认 ID 不一致，未删除".into());
                }
                tui::delete(&tx, key)?;
                revoke = true;
            }
            Action::AdminPin { pin } => {
                valid_pin(&pin, false)?;
                storage::set_pin(&tx, admin, &pin)?;
            }
            _ => unreachable!(),
        }
        tx.commit().map_err(|e| e.to_string())?;
        change = Some(Change { target, revoke });
        if message.is_empty() {
            message = "操作完成".into();
        }
    }
    Ok((
        Reply {
            configured: true,
            users: users(conn)?,
            message,
            error: None,
        },
        change,
    ))
}
