//! 统一数据库索引与目录切换；本地 JSON 可恢复索引，旧目录的文件不被搬迁或删除。
use super::{storage, AvSettings, AvWork};
use rusqlite::{Connection, OptionalExtension};

pub fn initialize(conn: &Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS AvWorks (Code TEXT PRIMARY KEY NOT NULL, MetaJson TEXT NOT NULL);").map_err(|e| e.to_string())
}
pub fn settings(conn: &Connection) -> Result<AvSettings, String> {
    Ok(AvSettings {
        root_path: conn
            .query_row(
                "SELECT Value FROM AppSettings WHERE Key='av_root_path'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or_default(),
    })
}
pub fn list_all(conn: &Connection) -> Result<Vec<AvWork>, String> {
    let mut stmt = conn
        .prepare("SELECT Code, MetaJson FROM AvWorks ORDER BY Code")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;
    rows.map(|row| {
        let (code, json) = row.map_err(|e| e.to_string())?;
        let mut work: AvWork =
            serde_json::from_str(&json).map_err(|e| format!("{code} 的 JSON 无法读取：{e}"))?;
        work.code = code;
        Ok(work)
    })
    .collect()
}
pub fn list_active(conn: &Connection) -> Result<Vec<AvWork>, String> {
    let root = settings(conn)?.root_path;
    if root.is_empty() {
        return Ok(Vec::new());
    }
    Ok(list_all(conn)?
        .into_iter()
        .filter(|work| storage::path_in_root(&work.folder_path, &root))
        .collect())
}
pub fn admit(conn: &Connection, work: &AvWork) -> Result<(), String> {
    conn.execute("INSERT INTO AvWorks(Code,MetaJson) VALUES(?1,?2) ON CONFLICT(Code) DO UPDATE SET MetaJson=excluded.MetaJson",rusqlite::params![work.code,serde_json::to_string(work).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    Ok(())
}
pub fn bind(
    conn: &mut Connection,
    root: &std::path::Path,
    works: &[AvWork],
) -> Result<AvSettings, String> {
    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    for work in works {
        admit(&transaction, work)?;
    }
    transaction.execute("INSERT INTO AppSettings(Key,Value) VALUES('av_root_path',?1) ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value",[crate::eh::database::portable_path(root)]).map_err(|e|e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?;
    settings(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn switching_root_preserves_other_indexes_without_exposing_them_in_current_view() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE AppSettings(Key TEXT PRIMARY KEY, Value TEXT);")
            .unwrap();
        initialize(&conn).unwrap();
        let root = std::env::temp_dir().join("ero-av-catalog-fixture");
        let a = root.join("a");
        let b = root.join("b");
        let first = AvWork {
            code: "TEST-100".into(),
            folder_path: a.join("TEST-100").to_string_lossy().into(),
            ..Default::default()
        };
        bind(&mut conn, &a, &[first]).unwrap();
        assert_eq!(list_active(&conn).unwrap().len(), 1);
        bind(&mut conn, &b, &[]).unwrap();
        assert!(list_active(&conn).unwrap().is_empty());
        assert_eq!(list_all(&conn).unwrap().len(), 1);
    }
}
