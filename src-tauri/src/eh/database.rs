//! SQLite connection and path/settings persistence for the Eh library.
use crate::eh::models::{EhGallerySummary, EhSettings};
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};
const EH_DATABASE_FILE: &str = "eh-database.db";
pub(crate) fn portable_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    value.strip_prefix(r"\\?\").unwrap_or(&value).to_string()
}
pub(crate) fn eh_db_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
        .join(EH_DATABASE_FILE)
}

pub(crate) fn open_eh_db() -> Result<Connection, String> {
    let path = eh_db_path();
    let connection = Connection::open(&path)
        .map_err(|error| format!("无法打开 本子数据库 {}: {error}", path.display()))?;
    initialize_eh_schema(&connection)?;
    Ok(connection)
}

pub(crate) fn initialize_eh_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE IF NOT EXISTS EhSettings (
               Key TEXT PRIMARY KEY,
               Value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS EhGalleries (
               Gid INTEGER PRIMARY KEY,
               Token TEXT NOT NULL,
               Title TEXT NOT NULL,
               Category INTEGER NOT NULL,
               ArtistJson TEXT NOT NULL,
               GroupJson TEXT NOT NULL,
               TagsJson TEXT NOT NULL,
               Pages INTEGER NOT NULL,
               Posted TEXT NOT NULL,
               CoverPath TEXT NOT NULL,
               FolderPath TEXT NOT NULL UNIQUE,
               Source TEXT NOT NULL DEFAULT 'eh',
               SourceId TEXT NOT NULL DEFAULT '',
               Language TEXT NOT NULL DEFAULT '',
               AddedAt TEXT NOT NULL DEFAULT (datetime('now','localtime')),
               UpdatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
             );",
        )
        .map_err(|error| error.to_string())?;
    let has_added_at = connection
        .prepare("PRAGMA table_info(EhGalleries)")
        .and_then(|mut statement| {
            let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
            Ok(columns.filter_map(Result::ok).any(|name| name == "AddedAt"))
        })
        .map_err(|error| error.to_string())?;
    if !has_added_at {
        connection
            .execute_batch("ALTER TABLE EhGalleries ADD COLUMN AddedAt TEXT;")
            .map_err(|error| format!("升级 Eh 入库时间字段失败: {error}"))?;
    }
    for (name, definition) in [
        ("Source", "TEXT NOT NULL DEFAULT 'eh'"),
        ("SourceId", "TEXT NOT NULL DEFAULT ''"),
        ("Language", "TEXT NOT NULL DEFAULT ''"),
    ] {
        let exists = connection
            .prepare("PRAGMA table_info(EhGalleries)")
            .and_then(|mut statement| {
                let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
                Ok(columns.filter_map(Result::ok).any(|column| column == name))
            })
            .map_err(|error| error.to_string())?;
        if !exists {
            connection
                .execute_batch(&format!(
                    "ALTER TABLE EhGalleries ADD COLUMN {name} {definition};"
                ))
                .map_err(|error| format!("升级 Eh 来源字段失败: {error}"))?;
        }
    }
    connection
        .execute(
            "UPDATE EhGalleries SET SourceId=CAST(Gid AS TEXT) WHERE SourceId=''",
            [],
        )
        .map_err(|error| format!("修复 Eh 来源标识失败: {error}"))?;
    connection.execute_batch("CREATE UNIQUE INDEX IF NOT EXISTS EhGalleries_SourceIdentity ON EhGalleries(Source,SourceId);")
        .map_err(|error| format!("建立 Eh 来源索引失败: {error}"))?;
    // SQLite cannot add a non-constant datetime default with ALTER TABLE.
    // Repair every migrated database on open, including rows inserted by an
    // older build after the nullable AddedAt column had already been created.
    connection
        .execute(
            "UPDATE EhGalleries
             SET AddedAt=COALESCE(NULLIF(UpdatedAt,''), datetime('now','localtime'))
             WHERE AddedAt IS NULL OR AddedAt=''",
            [],
        )
        .map_err(|error| format!("修复 Eh 入库时间失败: {error}"))?;
    Ok(())
}

fn setting(connection: &Connection, key: &str) -> Result<String, String> {
    connection
        .query_row("SELECT Value FROM EhSettings WHERE Key=?1", [key], |row| {
            row.get(0)
        })
        .optional()
        .map(|value| value.unwrap_or_default())
        .map_err(|error| error.to_string())
}

pub(crate) fn write_eh_setting(
    connection: &Connection,
    key: &str,
    value: &str,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO EhSettings(Key,Value) VALUES(?1,?2)
             ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value",
            params![key, value],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(crate) fn read_eh_settings(connection: &Connection) -> Result<EhSettings, String> {
    Ok(EhSettings {
        root_path: setting(connection, "root_path")?,
        ipb_member_id: setting(connection, "ipb_member_id")?,
        ipb_pass_hash: setting(connection, "ipb_pass_hash")?,
        igneous: setting(connection, "igneous")?,
    })
}

pub(crate) fn validate_root(root_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(root_path.trim());
    if root_path.trim().is_empty() {
        return Err("本子库目录不能为空".to_string());
    }
    if !root.is_dir() {
        return Err(format!("本子库目录不存在: {}", root.display()));
    }
    fs::canonicalize(&root).map_err(|error| format!("无法读取 本子库目录: {error}"))
}

pub(crate) fn upsert_gallery(
    connection: &Connection,
    gallery: &EhGallerySummary,
) -> Result<(), String> {
    upsert_gallery_internal(connection, gallery, false)
}

pub(crate) fn upsert_downloaded_gallery(
    connection: &Connection,
    gallery: &EhGallerySummary,
) -> Result<(), String> {
    upsert_gallery_internal(connection, gallery, true)
}

fn upsert_gallery_internal(
    connection: &Connection,
    gallery: &EhGallerySummary,
    refresh_added_at: bool,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO EhGalleries(Gid,Token,Title,Category,ArtistJson,GroupJson,TagsJson,Pages,Posted,CoverPath,FolderPath,Source,SourceId,Language,AddedAt,UpdatedAt)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?13,?14,?15,
                strftime('%Y-%m-%d %H:%M:%f','now','localtime'),
                strftime('%Y-%m-%d %H:%M:%f','now','localtime'))
             ON CONFLICT(Gid) DO UPDATE SET Token=excluded.Token,Title=excluded.Title,Category=excluded.Category,
             ArtistJson=excluded.ArtistJson,GroupJson=excluded.GroupJson,TagsJson=excluded.TagsJson,Pages=excluded.Pages,
             Posted=excluded.Posted,CoverPath=excluded.CoverPath,FolderPath=excluded.FolderPath,
             Source=excluded.Source,SourceId=excluded.SourceId,Language=excluded.Language,
             AddedAt=CASE WHEN ?12 THEN excluded.AddedAt ELSE COALESCE(NULLIF(EhGalleries.AddedAt,''),excluded.AddedAt) END,
             UpdatedAt=excluded.UpdatedAt",
            params![
                gallery.gid,
                gallery.token,
                gallery.title,
                gallery.category,
                serde_json::to_string(&gallery.artist).map_err(|e| e.to_string())?,
                serde_json::to_string(&gallery.group).map_err(|e| e.to_string())?,
                serde_json::to_string(&gallery.tags).map_err(|e| e.to_string())?,
                gallery.pages,
                gallery.posted,
                gallery.cover_path,
                gallery.folder_path,
                refresh_added_at,
                gallery.source,
                gallery.source_id,
                gallery.language,
            ],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(crate) fn gallery_folder(connection: &Connection, gid: i64) -> Result<PathBuf, String> {
    connection
        .query_row(
            "SELECT FolderPath FROM EhGalleries WHERE Gid=?1",
            [gid],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .map(PathBuf::from)
        .ok_or_else(|| format!("本子数据库中不存在 GID {gid}"))
}

#[cfg(test)]
mod tests {
    use super::{initialize_eh_schema, upsert_downloaded_gallery, upsert_gallery};
    use crate::eh::models::EhGallerySummary;
    use rusqlite::Connection;

    fn gallery() -> EhGallerySummary {
        EhGallerySummary {
            gid: 123,
            token: "token".to_string(),
            source: "eh".to_string(),
            source_id: "123".to_string(),
            language: String::new(),
            title: "gallery".to_string(),
            category: 2,
            artist: Vec::new(),
            group: Vec::new(),
            tags: Vec::new(),
            artist_display: Vec::new(),
            group_display: Vec::new(),
            tags_display: Vec::new(),
            pages: 1,
            posted: "2020-01-01".to_string(),
            added_at: String::new(),
            cover_path: String::new(),
            folder_path: "gallery-folder".to_string(),
        }
    }

    #[test]
    fn scans_preserve_admission_time_but_downloads_refresh_it() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE EhGalleries (
              Gid INTEGER PRIMARY KEY, Token TEXT NOT NULL, Title TEXT NOT NULL,
              Category INTEGER NOT NULL, ArtistJson TEXT NOT NULL, GroupJson TEXT NOT NULL,
              TagsJson TEXT NOT NULL, Pages INTEGER NOT NULL, Posted TEXT NOT NULL,
              CoverPath TEXT NOT NULL, FolderPath TEXT NOT NULL UNIQUE,
              Source TEXT NOT NULL DEFAULT 'eh', SourceId TEXT NOT NULL DEFAULT '', Language TEXT NOT NULL DEFAULT '',
              AddedAt TEXT,
              UpdatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
            );",
            )
            .unwrap();
        upsert_gallery(&connection, &gallery()).unwrap();
        let inserted: Option<String> = connection
            .query_row("SELECT AddedAt FROM EhGalleries", [], |row| row.get(0))
            .unwrap();
        assert!(inserted.is_some(), "new rows must always receive AddedAt");
        connection
            .execute("UPDATE EhGalleries SET AddedAt='2000-01-01 00:00:00'", [])
            .unwrap();
        upsert_gallery(&connection, &gallery()).unwrap();
        let scanned: String = connection
            .query_row("SELECT AddedAt FROM EhGalleries", [], |row| row.get(0))
            .unwrap();
        assert_eq!(scanned, "2000-01-01 00:00:00");
        upsert_downloaded_gallery(&connection, &gallery()).unwrap();
        let downloaded: String = connection
            .query_row("SELECT AddedAt FROM EhGalleries", [], |row| row.get(0))
            .unwrap();
        assert_ne!(downloaded, scanned);
    }

    #[test]
    fn legacy_eh_row_and_same_number_hitomi_row_coexist_after_migration() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE EhGalleries (
            Gid INTEGER PRIMARY KEY, Token TEXT NOT NULL, Title TEXT NOT NULL,
            Category INTEGER NOT NULL, ArtistJson TEXT NOT NULL, GroupJson TEXT NOT NULL,
            TagsJson TEXT NOT NULL, Pages INTEGER NOT NULL, Posted TEXT NOT NULL,
            CoverPath TEXT NOT NULL, FolderPath TEXT NOT NULL UNIQUE,
            UpdatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        ); INSERT INTO EhGalleries(Gid,Token,Title,Category,ArtistJson,GroupJson,TagsJson,Pages,Posted,CoverPath,FolderPath)
        VALUES(123,'token','Eh work',2,'[]','[]','[]',1,'2020-01-01','','eh-folder');").unwrap();
        initialize_eh_schema(&connection).unwrap();
        let mut hitomi = gallery();
        hitomi.gid = -123;
        hitomi.token.clear();
        hitomi.source = "hitomi".into();
        hitomi.source_id = "123".into();
        hitomi.folder_path = "hitomi-folder".into();
        upsert_downloaded_gallery(&connection, &hitomi).unwrap();
        let identities: Vec<(i64, String, String)> = connection
            .prepare("SELECT Gid,Source,SourceId FROM EhGalleries ORDER BY Gid")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            identities,
            vec![
                (-123, "hitomi".into(), "123".into()),
                (123, "eh".into(), "123".into())
            ]
        );
    }
}
