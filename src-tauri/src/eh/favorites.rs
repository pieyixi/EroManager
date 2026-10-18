//! 本子收藏以带符号的内部 GID 为键，同号 Eh/Hitomi 不会相互覆盖。
use crate::eh::database::open_eh_db;
#[cfg(test)]
use rusqlite::{params, Connection};

#[cfg(test)]
fn read_favorites(conn: &Connection) -> Result<Vec<i64>, String> {
    let mut statement = conn.prepare("SELECT f.Gid FROM EhFavoriteGalleries f JOIN EhGalleries g ON g.Gid=f.Gid ORDER BY f.Gid")
        .map_err(|error| error.to_string())?;
    let values = statement
        .query_map([], |row| row.get(0))
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<i64>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(values)
}

#[cfg(test)]
fn write_favorite(conn: &Connection, gid: i64, favorite: bool) -> Result<bool, String> {
    if favorite {
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM EhGalleries WHERE Gid=?1)",
                params![gid],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if !exists {
            return Err("作品不存在，无法收藏".to_string());
        }
        conn.execute(
            "INSERT OR IGNORE INTO EhFavoriteGalleries (Gid) VALUES (?1)",
            params![gid],
        )
    } else {
        conn.execute("DELETE FROM EhFavoriteGalleries WHERE Gid=?1", params![gid])
    }
    .map_err(|error| error.to_string())?;
    Ok(favorite)
}

#[tauri::command(async)]
pub fn eh_get_favorite_galleries(
    scope: String,
    db: tauri::State<crate::library::database::Database>,
    session: tauri::State<crate::accounts::Session>,
) -> Result<Vec<i64>, String> {
    let key = match session.authorize(&scope) {
        Ok(key) => key,
        Err(_) => return Ok(vec![]),
    };
    let ids = crate::accounts::personal_favorites(
        &*db.conn.lock().map_err(|e| e.to_string())?,
        key,
        "favorite-book",
    )?;
    let library = open_eh_db()?;
    Ok(ids
        .into_iter()
        .filter_map(|s| s.parse::<i64>().ok())
        .filter(|gid| {
            library
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM EhGalleries WHERE Gid=?1)",
                    [gid],
                    |r| r.get::<_, bool>(0),
                )
                .unwrap_or(false)
        })
        .collect())
}
#[tauri::command(async)]
pub fn eh_set_gallery_favorite(
    scope: String,
    gid: i64,
    favorite: bool,
    db: tauri::State<crate::library::database::Database>,
    session: tauri::State<crate::accounts::Session>,
) -> Result<bool, String> {
    let key = session.authorize(&scope)?;
    if favorite
        && !open_eh_db()?
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM EhGalleries WHERE Gid=?1)",
                [gid],
                |r| r.get::<_, bool>(0),
            )
            .map_err(|e| e.to_string())?
    {
        return Err("作品不存在，无法收藏".into());
    }
    crate::accounts::set_personal_favorite(
        &*db.conn.lock().map_err(|e| e.to_string())?,
        key,
        "favorite-book",
        &gid.to_string(),
        favorite,
    )?;
    Ok(favorite)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eh::database::initialize_eh_schema;

    #[test]
    fn signed_ids_remain_independent_and_survive_reopen_and_schema_refresh() {
        let path = std::env::temp_dir().join(format!(
            "ark-book-favorites-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        {
            let conn = Connection::open(&path).unwrap();
            initialize_eh_schema(&conn).unwrap();
            for (gid, source) in [(42, "eh"), (-42, "hitomi")] {
                conn.execute("INSERT INTO EhGalleries (Gid,Token,Title,Category,ArtistJson,GroupJson,TagsJson,Pages,Posted,CoverPath,FolderPath,Source,SourceId) VALUES (?1,'','test',2,'[]','[]','[]',1,'2026-01-01','',?2,?3,'42')", params![gid, format!("test-{gid}"), source]).unwrap();
                assert!(write_favorite(&conn, gid, true).unwrap());
            }
            write_favorite(&conn, 42, true).unwrap();
            assert_eq!(read_favorites(&conn).unwrap(), vec![-42, 42]);
            assert!(write_favorite(&conn, 999, true).is_err());
        }
        {
            let conn = Connection::open(&path).unwrap();
            initialize_eh_schema(&conn).unwrap();
            assert_eq!(read_favorites(&conn).unwrap(), vec![-42, 42]);
            assert!(!write_favorite(&conn, 42, false).unwrap());
            assert_eq!(read_favorites(&conn).unwrap(), vec![-42]);
            conn.execute("DELETE FROM EhGalleries WHERE Gid=-42", [])
                .unwrap();
            assert!(read_favorites(&conn).unwrap().is_empty());
            let remaining: i64 = conn
                .query_row("SELECT COUNT(*) FROM EhFavoriteGalleries", [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(remaining, 0);
        }
        std::fs::remove_file(path).unwrap();
    }
}
