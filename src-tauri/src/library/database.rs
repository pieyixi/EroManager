use crate::paths::portable_database_path;
use crate::shared::*;
use std::sync::Mutex;

pub struct Database {
    pub conn: Mutex<Connection>,
}

fn get_db_path() -> Result<String, String> {
    let portable_db = portable_database_path("database.db").map_err(|e| e.to_string())?;
    Ok(portable_db.to_string_lossy().to_string())
}

pub(crate) fn parse_year_month(value: &str) -> Option<(i32, i32)> {
    let mut parts = value.split('-');
    let year = parts.next()?.parse().ok()?;
    let month = parts.next().and_then(|s| s.parse().ok()).unwrap_or(1);
    Some((year, month))
}

pub(crate) fn init_db() -> Result<Database, String> {
    let path = get_db_path()?;
    let mut conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .ok();

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS Works (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            Title TEXT NOT NULL,
            Year INTEGER NOT NULL,
            Month INTEGER NOT NULL,
            Studio TEXT NOT NULL DEFAULT '',
            Description TEXT,
            CoverPath TEXT,
            FolderPath TEXT NOT NULL,
            CreatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
            UpdatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS Episodes (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            WorkId INTEGER NOT NULL,
            Number INTEGER NOT NULL,
            Title TEXT NOT NULL DEFAULT '',
            VideoPath TEXT NOT NULL,
            CoverPath TEXT,
            FOREIGN KEY (WorkId) REFERENCES Works(Id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS Tags (
            Id INTEGER PRIMARY KEY AUTOINCREMENT,
            Name TEXT NOT NULL UNIQUE,
            Category TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS WorkTags (
            WorkId INTEGER NOT NULL,
            TagId INTEGER NOT NULL,
            PRIMARY KEY (WorkId, TagId),
            FOREIGN KEY (WorkId) REFERENCES Works(Id) ON DELETE CASCADE,
            FOREIGN KEY (TagId) REFERENCES Tags(Id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS AppSettings (
            Key TEXT PRIMARY KEY,
            Value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS LibrarySnapshots (
            WorkId INTEGER PRIMARY KEY,
            MetaSignature TEXT NOT NULL DEFAULT '',
            CoverSignature TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (WorkId) REFERENCES Works(Id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS FavoriteCharacters (
            CharacterName TEXT PRIMARY KEY,
            CreatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );",
    )
    .map_err(|e| e.to_string())?;

    // Optional search-only aliases were added after the initial portable schema.
    // SQLite has no IF NOT EXISTS form for ADD COLUMN, so an existing column is harmless here.
    conn.execute(
        "ALTER TABLE Works ADD COLUMN SearchAliases TEXT NOT NULL DEFAULT '[]'",
        [],
    )
    .ok();

    super::database_migration::unify(&mut conn, &crate::paths::portable_app_dir(), || {
        crate::paths::portable_backup_dir().map_err(|e| e.to_string())
    })
    .map_err(|e| format!("数据库迁移未完成，原件和备份已保留：{e}"))?;
    crate::eh::database::initialize_eh_schema(&conn)?;
    crate::av::initialize(&conn)?;

    Ok(Database {
        conn: Mutex::new(conn),
    })
}

// ─── Tauri Commands ───────────────────────────────────────
