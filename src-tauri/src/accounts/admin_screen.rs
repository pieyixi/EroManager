use super::{
    admin::{Action, Reply, Request, User},
    admin_pipe::Client,
    terminal::{fit, Field, Key, Terminal},
};

const ACTIONS: [&str; 7] = [
    "创建账号",
    "修改 ID",
    "修改昵称",
    "重置密码",
    "停用 / 启用",
    "删除账号",
    "管理员密码",
];
fn call(client: &mut Client, pin: &str, action: Action) -> Result<Reply, String> {
    client.call(Request {
        pin: pin.into(),
        action,
    })
}
fn password(values: &[String], start: usize, optional: bool) -> Result<String, String> {
    if values[start] != values[start + 1] {
        return Err("两次密码不一致，未保存".into());
    }
    let pin = &values[start];
    if !(optional && pin.is_empty()) && !super::security::valid_pin(pin) {
        return Err("密码必须是四位数字".into());
    }
    Ok(pin.clone())
}
fn perform(
    term: &mut Terminal,
    client: &mut Client,
    admin_pin: &mut String,
    action: usize,
    user: Option<&User>,
) -> Result<Option<Reply>, String> {
    if action == 0 {
        let fields = vec![
            Field::text("昵称（允许重名）", "", 24),
            Field::pin("密码（留空不设置）"),
            Field::pin("再次输入密码"),
            Field::id("复制偏好的账号 ID（可留空）", ""),
        ];
        let Some(values) = term.form(
            "创建账号",
            fields,
            "仅复制设置偏好，收藏、头像和进度不复制。",
        )?
        else {
            return Ok(None);
        };
        let pin = password(&values, 1, true)?;
        return call(
            client,
            admin_pin,
            Action::Create {
                nickname: values[0].clone(),
                pin,
                copy: values[3].clone(),
            },
        )
        .map(Some);
    }
    if action == 6 {
        let Some(values) = term.form(
            "管理员密码",
            vec![Field::pin("新的四位密码"), Field::pin("再次输入")],
            "用于管理员 0000；不会修改普通账号。",
        )?
        else {
            return Ok(None);
        };
        let pin = password(&values, 0, false)?;
        let reply = call(client, admin_pin, Action::AdminPin { pin: pin.clone() })?;
        *admin_pin = pin;
        return Ok(Some(reply));
    }
    let user = user
        .filter(|user| user.id != "0000")
        .ok_or("请在左侧选择一个普通账号")?;
    let help = format!("当前账号 {} · {}", user.id, user.nickname);
    let operation = match action {
        1 => {
            let Some(values) =
                term.form("修改 ID", vec![Field::id("新的四位 ID", &user.id)], &help)?
            else {
                return Ok(None);
            };
            Action::RenameId {
                key: user.key,
                id: values[0].clone(),
            }
        }
        2 => {
            let Some(values) = term.form(
                "修改昵称",
                vec![Field::text("新昵称", &user.nickname, 24)],
                &help,
            )?
            else {
                return Ok(None);
            };
            Action::Rename {
                key: user.key,
                nickname: values[0].clone(),
            }
        }
        3 => {
            let Some(values) = term.form(
                "重置密码",
                vec![Field::pin("新密码（留空关闭）"), Field::pin("再次输入")],
                "若这是 GUI 当前账号，保存后该账号会退出登录。",
            )?
            else {
                return Ok(None);
            };
            Action::ResetPin {
                key: user.key,
                pin: password(&values, 0, true)?,
            }
        }
        4 => {
            let Some(values) = term.form(
                "停用 / 启用",
                vec![Field::id("输入当前账号 ID 确认", "")],
                &help,
            )?
            else {
                return Ok(None);
            };
            if values[0] != user.id {
                return Err("确认 ID 不一致，未修改".into());
            }
            Action::Toggle { key: user.key }
        }
        5 => {
            let Some(values) = term.form(
                "删除账号",
                vec![Field::id("输入当前账号 ID 确认删除", "")],
                "只删除该账号的资料、收藏与进度，不删除共用媒体。",
            )?
            else {
                return Ok(None);
            };
            Action::Delete {
                key: user.key,
                confirm: values[0].clone(),
            }
        }
        _ => return Ok(None),
    };
    call(client, admin_pin, operation).map(Some)
}
pub fn run() -> Result<(), String> {
    let mut term = Terminal::new()?;
    let mut client = Client::new();
    let status = match call(&mut client, "", Action::Status) {
        Ok(status) => status,
        Err(error) => {
            term.notice(&error)?;
            return Err(error);
        }
    };
    let mut notice = String::new();
    let (mut pin, mut users) = loop {
        let fields = if status.configured {
            vec![Field::pin("管理员 0000 密码")]
        } else {
            vec![Field::pin("设置管理员四位密码"), Field::pin("再次输入")]
        };
        let hint = if notice.is_empty() {
            if status.configured {
                "验证管理员后进入账号管理。"
            } else {
                "首次使用，没有预设密码。"
            }
        } else {
            &notice
        };
        let Some(values) = term.form("管理员 0000", fields, hint)? else {
            return Ok(());
        };
        let candidate = if status.configured {
            Ok(values[0].clone())
        } else {
            password(&values, 0, false)
        };
        match candidate.and_then(|pin| {
            call(&mut client, &pin, Action::Authenticate).map(|reply| (pin, reply.users))
        }) {
            Ok(result) => break result,
            Err(error) => notice = error,
        }
    };
    notice.clear();
    let mut selected = usize::from(users.len() > 1);
    let mut action = 0;
    let mut actions_focused = false;
    loop {
        let (width, height) = term.size();
        let left = width.saturating_sub(36).clamp(30, 58);
        let visible = height.saturating_sub(10).max(7);
        selected = selected.min(users.len().saturating_sub(1));
        let top = selected.saturating_sub(visible.saturating_sub(1));
        let mut lines = vec![
            String::new(),
            "  \x1b[1;38;2;125;162;242m裏界箱庭  /  账号管理".into(),
            format!(
                "  \x1b[90m{}   管理员 0000",
                if client.online {
                    "已连接主程序"
                } else {
                    "独立管理 · 主程序可随时打开"
                }
            ),
            String::new(),
            format!("  {}  操作", fit("账号 / 状态", left)),
        ];
        for row in 0..visible {
            let index = top + row;
            let user_text = users
                .get(index)
                .map(|user| {
                    format!(
                        "{} {}  {} {}",
                        user.id,
                        user.nickname,
                        if user.disabled { "停用" } else { "启用" },
                        if user.has_pin { "[锁]" } else { "" }
                    )
                })
                .unwrap_or_default();
            let selection = if index == selected && !actions_focused {
                "\x1b[48;2;40;54;79m\x1b[97m"
            } else if index == selected {
                "\x1b[94m"
            } else {
                "\x1b[0m"
            };
            let right = if row < ACTIONS.len() {
                format!(
                    "{} {} ",
                    if actions_focused && row == action {
                        "\x1b[48;2;40;54;79m\x1b[97m▸"
                    } else {
                        "\x1b[0m "
                    },
                    ACTIONS[row]
                )
            } else {
                String::new()
            };
            lines.push(format!(
                "  {selection}{}\x1b[0m  {right}",
                fit(&user_text, left)
            ));
        }
        lines.extend([
            String::new(),
            format!(
                "  \x1b[38;2;125;162;242m{}",
                fit(&notice, width.saturating_sub(4))
            ),
            "  \x1b[90m↑↓ 选择   Tab / ←→ 切换   Enter 确认   R 刷新   Esc / Q 退出".into(),
        ]);
        term.draw(&lines)?;
        let mut execute = false;
        match term.key()? {
            Key::Escape | Key::Char('q' | 'Q') => return Ok(()),
            Key::Tab => actions_focused = !actions_focused,
            Key::Left => actions_focused = false,
            Key::Right => actions_focused = true,
            Key::Up if actions_focused => action = (action + ACTIONS.len() - 1) % ACTIONS.len(),
            Key::Down if actions_focused => action = (action + 1) % ACTIONS.len(),
            Key::Up if !users.is_empty() => selected = (selected + users.len() - 1) % users.len(),
            Key::Down if !users.is_empty() => selected = (selected + 1) % users.len(),
            Key::Enter if !actions_focused => actions_focused = true,
            Key::Enter => execute = true,
            Key::Char('r' | 'R') => match call(&mut client, &pin, Action::Authenticate) {
                Ok(reply) => {
                    users = reply.users;
                    notice = "列表已刷新".into();
                }
                Err(error) => notice = error,
            },
            _ => {}
        }
        if execute {
            let previous = users.get(selected).map(|user| user.key);
            match perform(
                &mut term,
                &mut client,
                &mut pin,
                action,
                users.get(selected),
            ) {
                Ok(Some(reply)) => {
                    notice = reply.message;
                    users = reply.users;
                    selected = users
                        .iter()
                        .position(|user| Some(user.key) == previous)
                        .unwrap_or(0);
                }
                Ok(None) => notice = "已取消".into(),
                Err(error) => notice = error,
            }
        }
    }
}
