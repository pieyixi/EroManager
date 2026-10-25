//! 应用偏好与作品记录分开存储；重置偏好绝不触碰目录、凭据或历史。
use crate::library::database::Database;
#[cfg(test)]
use rusqlite::params;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(default, deny_unknown_fields)]
pub struct UserPreferences {
    pub theme: String,
    pub startup_page: String,
    pub media_sort: String,
    pub book_sort: String,
    pub player_loop: String,
    pub player_auto_next: bool,
    pub player_volume: f64,
    pub player_speed: f64,
    pub player_fit: String,
    pub remember_playback: bool,
    pub reader_mode: String,
    pub reader_direction: String,
    pub reader_wheel: bool,
    pub reader_zoom: f64,
    pub remember_reading: bool,
    pub download_notify: bool,
    pub eh_parallel_images: usize,
    pub hitomi_parallel_images: usize,
    pub close_action: String,
    pub close_prompt: bool,
}

impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            theme: String::new(),
            startup_page: "home".into(),
            media_sort: "time-desc".into(),
            book_sort: "added-desc".into(),
            player_loop: "off".into(),
            player_auto_next: false,
            player_volume: 80.0,
            player_speed: 1.0,
            player_fit: "contain".into(),
            remember_playback: true,
            reader_mode: "double".into(),
            reader_direction: "rtl".into(),
            reader_wheel: true,
            reader_zoom: 100.0,
            remember_reading: true,
            download_notify: true,
            eh_parallel_images: 3,
            hitomi_parallel_images: 3,
            close_action: "tray".into(),
            close_prompt: true,
        }
    }
}

fn validate(p: &UserPreferences) -> Result<(), String> {
    let enums: &[(&str, &[&str])] = &[
        (&p.theme, &["", "light", "dark", "system"]),
        (&p.startup_page, &["home", "media-library", "eh-library"]),
        (
            &p.media_sort,
            &["time-desc", "time-asc", "name-asc", "name-desc"],
        ),
        (
            &p.book_sort,
            &[
                "added-desc",
                "added-asc",
                "time-desc",
                "time-asc",
                "name-asc",
                "name-desc",
            ],
        ),
        (&p.player_loop, &["off", "one", "all", "random"]),
        (&p.player_fit, &["contain", "fill", "original"]),
        (&p.reader_mode, &["double", "single"]),
        (&p.reader_direction, &["rtl", "ltr"]),
        (&p.close_action, &["tray", "exit"]),
    ];
    if enums
        .iter()
        .any(|(value, allowed)| !allowed.contains(value))
        || !p.player_volume.is_finite()
        || !(0.0..=100.0).contains(&p.player_volume)
        || !p.player_speed.is_finite()
        || !(0.25..=4.0).contains(&p.player_speed)
        || !p.reader_zoom.is_finite()
        || !(50.0..=160.0).contains(&p.reader_zoom)
        || !(1..=5).contains(&p.eh_parallel_images)
        || !(1..=5).contains(&p.hitomi_parallel_images)
    {
        return Err("偏好包含无效选项或超出范围的数值".into());
    }
    Ok(())
}

/// 每部作品开始时固定其来源的并发值；不改变两个来源各自的 FIFO。
pub(crate) fn download_parallelism(value: Option<usize>) -> Result<usize, String> {
    let value = value.unwrap_or(3);
    if !(1..=5).contains(&value) {
        return Err("同时下载图片数必须为 1–5".into());
    }
    Ok(value)
}

fn read_preferences(conn: &Connection) -> Result<UserPreferences, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT Value FROM AppSettings WHERE Key='user_preferences_v1'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let p: UserPreferences = match raw {
        Some(raw) => serde_json::from_str(&raw)
            .map_err(|_| "偏好记录无法读取，请重试或恢复默认偏好".to_string())?,
        None => UserPreferences::default(),
    };
    validate(&p)?;
    Ok(p)
}

fn write_preferences(conn: &Connection, p: UserPreferences) -> Result<UserPreferences, String> {
    validate(&p)?;
    let raw = serde_json::to_string(&p).map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO AppSettings(Key,Value) VALUES('user_preferences_v1',?1) ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value", [raw]).map_err(|e| e.to_string())?;
    Ok(p)
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct WorkRecord {
    pub kind: String,
    pub content_id: i64,
    pub position: f64,
    pub pair_offset: i32,
    pub merged_pairs: Vec<String>,
}

#[cfg(test)]
fn ensure_records(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS WorkRecords (Kind TEXT NOT NULL, ContentId INTEGER NOT NULL, Position REAL NOT NULL DEFAULT 0, PairOffset INTEGER NOT NULL DEFAULT 1, MergedPairs TEXT NOT NULL DEFAULT '[]', UpdatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(Kind,ContentId));").map_err(|e| e.to_string())
}

fn validate_record(record: &WorkRecord) -> Result<(), String> {
    if !["media", "book"].contains(&record.kind.as_str())
        || record.content_id == 0
        || !record.position.is_finite()
        || record.position < 0.0
        || record.position > 1e9
        || !(0..=1).contains(&record.pair_offset)
        || record.merged_pairs.len() > 10000
        || (record.kind == "book" && (record.position.fract() != 0.0 || record.position > 100000.0))
        || record.merged_pairs.iter().any(|key| {
            let values: Vec<_> = key.split(':').collect();
            values.len() != 2
                || values
                    .iter()
                    .any(|v| v.parse::<u32>().map_or(true, |n| n > 100000))
        })
    {
        return Err("作品记录无效".into());
    }
    Ok(())
}

#[cfg(test)]
fn save_record(conn: &Connection, record: WorkRecord) -> Result<(), String> {
    validate_record(&record)?;
    ensure_records(conn)?;
    conn.execute("INSERT INTO WorkRecords(Kind,ContentId,Position,PairOffset,MergedPairs) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(Kind,ContentId) DO UPDATE SET Position=excluded.Position,PairOffset=excluded.PairOffset,MergedPairs=excluded.MergedPairs,UpdatedAt=CURRENT_TIMESTAMP", params![record.kind,record.content_id,record.position,record.pair_offset,serde_json::to_string(&record.merged_pairs).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    Ok(())
}

#[tauri::command(async)]
pub fn get_user_preferences(
    scope: String,
    db: tauri::State<Database>,
    session: tauri::State<crate::accounts::Session>,
) -> Result<UserPreferences, String> {
    let state = session.0.lock().map_err(|e| e.to_string())?;
    let key = state.authorize(&scope).ok();
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let global = read_preferences(&conn)?;
    let mut preferences = if let Some(key) = key {
        crate::accounts::read_value(&conn, key, "preferences", "")?
            .map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string()))
            .transpose()?
            .unwrap_or_default()
    } else {
        UserPreferences::default()
    };
    preferences.close_action = global.close_action;
    preferences.close_prompt = global.close_prompt;
    Ok(preferences)
}
#[tauri::command(async)]
pub fn set_user_preferences(
    scope: String,
    preferences: UserPreferences,
    db: tauri::State<Database>,
    session: tauri::State<crate::accounts::Session>,
) -> Result<UserPreferences, String> {
    let state = session.0.lock().map_err(|e| e.to_string())?;
    let key = if scope.is_empty() {
        None
    } else {
        Some(state.authorize(&scope)?)
    };
    validate(&preferences)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    if let Some(key) = key {
        crate::accounts::write_value(
            &conn,
            key,
            "preferences",
            "",
            &serde_json::to_string(&preferences).map_err(|e| e.to_string())?,
        )?;
    }
    let mut global = read_preferences(&conn)?;
    global.close_action = preferences.close_action.clone();
    global.close_prompt = preferences.close_prompt;
    write_preferences(&conn, global)?;
    Ok(preferences)
}
#[tauri::command(async)]
pub fn get_work_record(
    scope: String,
    kind: String,
    content_id: i64,
    db: tauri::State<Database>,
    session: tauri::State<crate::accounts::Session>,
) -> Result<Option<WorkRecord>, String> {
    let state = session.0.lock().map_err(|e| e.to_string())?;
    let key = state.authorize(&scope)?;
    crate::accounts::read_value(
        &*db.conn.lock().map_err(|e| e.to_string())?,
        key,
        "record",
        &format!("{kind}:{content_id}"),
    )?
    .map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string()))
    .transpose()
}
#[tauri::command(async)]
pub fn set_work_record(
    scope: String,
    record: WorkRecord,
    db: tauri::State<Database>,
    session: tauri::State<crate::accounts::Session>,
) -> Result<(), String> {
    let state = session.0.lock().map_err(|e| e.to_string())?;
    let key = state.authorize(&scope)?;
    // 与旧记录使用相同校验，但不再写全局进度表。
    validate_record(&record)?;
    crate::accounts::write_value(
        &*db.conn.lock().map_err(|e| e.to_string())?,
        key,
        "record",
        &format!("{}:{}", record.kind, record.content_id),
        &serde_json::to_string(&record).map_err(|e| e.to_string())?,
    )
}

#[derive(Serialize)]
pub struct ApplicationInfo {
    pub version: String,
    pub app_directory: String,
    pub database_directory: String,
}
#[tauri::command]
pub fn get_application_info() -> ApplicationInfo {
    let root = crate::paths::portable_app_dir();
    ApplicationInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        app_directory: root.to_string_lossy().into_owned(),
        database_directory: root.join("db").to_string_lossy().into_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn random_playback_mode_is_persistent_and_does_not_change_other_preferences() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE AppSettings(Key TEXT PRIMARY KEY,Value TEXT);").unwrap();
        let p = UserPreferences { player_loop: "random".into(), ..UserPreferences::default() };
        write_preferences(&conn, p.clone()).unwrap();
        assert_eq!(read_preferences(&conn).unwrap(), p);
        assert!(validate(&UserPreferences { player_loop: "shuffle-episodes".into(), ..p }).is_err());
    }
    #[test]
    fn concurrency_is_source_specific_bounded_and_additive() {
        let old: UserPreferences = serde_json::from_str(r#"{"theme":"system"}"#).unwrap();
        assert_eq!((old.eh_parallel_images, old.hitomi_parallel_images), (3, 3));
        assert_eq!(download_parallelism(None).unwrap(), 3);
        for value in 1..=5 {
            assert_eq!(download_parallelism(Some(value)).unwrap(), value);
        }
        for value in [0, 6, usize::MAX] {
            assert!(download_parallelism(Some(value)).is_err());
        }
        let p = UserPreferences {
            eh_parallel_images: 1,
            hitomi_parallel_images: 5,
            ..old
        };
        assert!(validate(&p).is_ok());
        assert!(validate(&UserPreferences {
            hitomi_parallel_images: 0,
            ..p
        })
        .is_err());
    }
    #[test]
    fn preferences_roundtrip_and_reset_leave_other_settings_and_records_intact() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE AppSettings(Key TEXT PRIMARY KEY,Value TEXT); INSERT INTO AppSettings VALUES('media_root','keep');").unwrap();
        assert_eq!(read_preferences(&conn).unwrap(), UserPreferences::default());
        let p = UserPreferences {
            theme: "system".into(),
            player_speed: 1.5,
            reader_zoom: 125.0,
            ..UserPreferences::default()
        };
        write_preferences(&conn, p.clone()).unwrap();
        assert_eq!(read_preferences(&conn).unwrap(), p);
        save_record(
            &conn,
            WorkRecord {
                kind: "book".into(),
                content_id: -42,
                position: 7.0,
                pair_offset: 0,
                merged_pairs: vec!["6:7".into()],
            },
        )
        .unwrap();
        write_preferences(&conn, UserPreferences::default()).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT Value FROM AppSettings WHERE Key='media_root'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "keep"
        );
        assert_eq!(
            conn.query_row(
                "SELECT Position FROM WorkRecords WHERE ContentId=-42",
                [],
                |r| r.get::<_, f64>(0)
            )
            .unwrap(),
            7.0
        );
        let bad = UserPreferences {
            player_volume: 101.0,
            ..UserPreferences::default()
        };
        assert!(write_preferences(&conn, bad).is_err());
    }
    #[test]
    fn work_records_keep_signed_source_ids_and_raw_pages_separate() {
        let conn = Connection::open_in_memory().unwrap();
        for id in [-42, 42] {
            save_record(
                &conn,
                WorkRecord {
                    kind: "book".into(),
                    content_id: id,
                    position: 9.0,
                    pair_offset: 1,
                    merged_pairs: vec![],
                },
            )
            .unwrap();
        }
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM WorkRecords", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert!(save_record(
            &conn,
            WorkRecord {
                kind: "book".into(),
                content_id: 42,
                position: 1.5,
                pair_offset: 1,
                merged_pairs: vec![]
            }
        )
        .is_err());
    }
}
