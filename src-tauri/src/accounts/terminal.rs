//! Windows 原生控制台输入及重绘；不依赖额外终端运行时。
use std::io::{self, Write};
#[cfg(windows)]
use windows_sys::Win32::{Foundation::HANDLE, System::Console::*};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Key {
    Up,
    Down,
    Left,
    Right,
    Tab,
    Enter,
    Escape,
    Backspace,
    Char(char),
    Resize,
}
pub struct Field {
    pub label: &'static str,
    pub value: String,
    pub secret: bool,
    pub numeric: bool,
    pub limit: usize,
}
impl Field {
    pub fn text(label: &'static str, value: &str, limit: usize) -> Self {
        Self {
            label,
            value: value.into(),
            secret: false,
            numeric: false,
            limit,
        }
    }
    pub fn pin(label: &'static str) -> Self {
        Self {
            label,
            value: String::new(),
            secret: true,
            numeric: true,
            limit: 4,
        }
    }
    pub fn id(label: &'static str, value: &str) -> Self {
        Self {
            numeric: true,
            ..Self::text(label, value, 4)
        }
    }
}
pub fn fit(value: &str, width: usize) -> String {
    let mut result = String::new();
    let mut used = 0;
    for ch in value.chars().filter(|c| !c.is_control()) {
        let columns = if ch.is_ascii() { 1 } else { 2 };
        if used + columns > width {
            break;
        }
        result.push(ch);
        used += columns;
    }
    result.push_str(&" ".repeat(width.saturating_sub(used)));
    result
}
#[cfg(windows)]
pub struct Terminal {
    input: HANDLE,
    output: HANDLE,
    input_mode: u32,
    output_mode: u32,
    input_cp: u32,
    output_cp: u32,
    surrogate: Option<u16>,
}
#[cfg(windows)]
impl Terminal {
    pub fn new() -> Result<Self, String> {
        unsafe {
            let input = GetStdHandle(STD_INPUT_HANDLE);
            let output = GetStdHandle(STD_OUTPUT_HANDLE);
            let mut input_mode = 0;
            let mut output_mode = 0;
            if GetConsoleMode(input, &mut input_mode) == 0
                || GetConsoleMode(output, &mut output_mode) == 0
            {
                return Err("请双击账号管理程序，或在 Windows 终端中打开".into());
            }
            let terminal = Self {
                input,
                output,
                input_mode,
                output_mode,
                input_cp: GetConsoleCP(),
                output_cp: GetConsoleOutputCP(),
                surrogate: None,
            };
            if SetConsoleMode(output, output_mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING) == 0 {
                return Err("当前终端不支持彩色界面，请使用 Windows 终端".into());
            }
            SetConsoleMode(
                input,
                (input_mode | ENABLE_WINDOW_INPUT | ENABLE_EXTENDED_FLAGS)
                    & !(ENABLE_LINE_INPUT
                        | ENABLE_ECHO_INPUT
                        | ENABLE_QUICK_EDIT_MODE
                        | ENABLE_PROCESSED_INPUT),
            );
            SetConsoleCP(65001);
            SetConsoleOutputCP(65001);
            print!("\x1b[?1049h\x1b[?25l");
            io::stdout().flush().map_err(|e| e.to_string())?;
            Ok(terminal)
        }
    }
    pub fn size(&self) -> (usize, usize) {
        unsafe {
            let mut info: CONSOLE_SCREEN_BUFFER_INFO = std::mem::zeroed();
            if GetConsoleScreenBufferInfo(self.output, &mut info) != 0 {
                (
                    (info.srWindow.Right - info.srWindow.Left + 1) as usize,
                    (info.srWindow.Bottom - info.srWindow.Top + 1) as usize,
                )
            } else {
                (80, 25)
            }
        }
    }
    pub fn key(&mut self) -> Result<Key, String> {
        loop {
            unsafe {
                let mut record: INPUT_RECORD = std::mem::zeroed();
                let mut count = 0;
                if ReadConsoleInputW(self.input, &mut record, 1, &mut count) == 0 {
                    return Err("终端输入已关闭".into());
                }
                if record.EventType == WINDOW_BUFFER_SIZE_EVENT as u16 {
                    return Ok(Key::Resize);
                }
                if record.EventType != KEY_EVENT as u16 {
                    continue;
                }
                let key = record.Event.KeyEvent;
                if key.bKeyDown == 0 {
                    continue;
                }
                if key.dwControlKeyState & 12 != 0 && key.wVirtualKeyCode == 0x43 {
                    return Ok(Key::Escape);
                }
                let result = match key.wVirtualKeyCode {
                    0x26 => Some(Key::Up),
                    0x28 => Some(Key::Down),
                    0x25 => Some(Key::Left),
                    0x27 => Some(Key::Right),
                    0x09 => Some(Key::Tab),
                    0x0d => Some(Key::Enter),
                    0x1b => Some(Key::Escape),
                    0x08 => Some(Key::Backspace),
                    _ => None,
                };
                if let Some(result) = result {
                    return Ok(result);
                }
                let code = key.uChar.UnicodeChar;
                if (0xd800..=0xdbff).contains(&code) {
                    self.surrogate = Some(code);
                    continue;
                }
                let ch = if let Some(high) = self.surrogate.take() {
                    char::decode_utf16([high, code]).next().and_then(Result::ok)
                } else {
                    char::from_u32(code as u32)
                };
                if let Some(ch) = ch.filter(|ch| !ch.is_control()) {
                    return Ok(Key::Char(ch));
                }
            }
        }
    }
    pub fn draw(&self, lines: &[String]) -> Result<(), String> {
        let (width, height) = self.size();
        let mut frame = String::from("\x1b[H\x1b[0m\x1b[2J");
        for (index, line) in lines.iter().take(height.saturating_sub(1)).enumerate() {
            frame.push_str(&format!("\x1b[{};1H{}\x1b[0m\x1b[K", index + 1, line));
        }
        if width < 72 || height < 22 {
            frame = "\x1b[H\x1b[2J请将终端扩大至至少 72 列 × 22 行；Esc 可退出。".into();
        }
        print!("{frame}");
        io::stdout().flush().map_err(|e| e.to_string())
    }
    pub fn form(
        &mut self,
        title: &str,
        mut fields: Vec<Field>,
        help: &str,
    ) -> Result<Option<Vec<String>>, String> {
        let mut current = 0;
        loop {
            let (width, _) = self.size();
            let content_width = width.saturating_sub(8).clamp(30, 68);
            let mut lines = vec![
                String::new(),
                format!("  \x1b[1;38;2;125;162;242m裏界箱庭  /  {title}"),
                String::new(),
                format!("  {}", fit(help, content_width)),
                String::new(),
            ];
            for (index, field) in fields.iter().enumerate() {
                lines.push(format!("  {}", field.label));
                let value = if field.secret {
                    "●".repeat(field.value.chars().count())
                } else {
                    field.value.clone()
                };
                lines.push(format!(
                    "  {} {} \x1b[0m",
                    if index == current {
                        "\x1b[48;2;40;54;79m\x1b[97m▌"
                    } else {
                        "\x1b[90m│"
                    },
                    fit(&value, content_width.saturating_sub(4))
                ));
                lines.push(String::new());
            }
            lines.push("  \x1b[90mTab / ↑↓ 切换字段   Enter 下一项 / 提交   Esc 取消".into());
            self.draw(&lines)?;
            match self.key()? {
                Key::Escape => return Ok(None),
                Key::Tab | Key::Down => current = (current + 1) % fields.len(),
                Key::Up => current = (current + fields.len() - 1) % fields.len(),
                Key::Enter if current + 1 == fields.len() => {
                    return Ok(Some(fields.into_iter().map(|field| field.value).collect()))
                }
                Key::Enter => current += 1,
                Key::Backspace => {
                    fields[current].value.pop();
                }
                Key::Char(ch)
                    if (!fields[current].numeric || ch.is_ascii_digit())
                        && fields[current].value.chars().count() < fields[current].limit =>
                {
                    fields[current].value.push(ch)
                }
                _ => {}
            }
        }
    }
    pub fn notice(&mut self, message: &str) -> Result<(), String> {
        self.draw(&[
            String::new(),
            "  \x1b[1;94m裏界箱庭 · 账号管理".into(),
            String::new(),
            format!("  {}", fit(message, self.size().0.saturating_sub(4))),
            String::new(),
            "  \x1b[90m按任意键退出".into(),
        ])?;
        self.key().map(|_| ())
    }
}
#[cfg(windows)]
impl Drop for Terminal {
    fn drop(&mut self) {
        print!("\x1b[0m\x1b[?25h\x1b[?1049l");
        let _ = io::stdout().flush();
        unsafe {
            SetConsoleMode(self.input, self.input_mode);
            SetConsoleMode(self.output, self.output_mode);
            SetConsoleCP(self.input_cp);
            SetConsoleOutputCP(self.output_cp);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn text_cells_align_chinese_and_strip_console_controls() {
        assert_eq!(fit("中文A", 6), "中文A ");
        assert_eq!(fit("中文A", 3), "中 ");
        assert!(!fit("a\x1bb\nc", 10).contains('\x1b'));
    }
}
