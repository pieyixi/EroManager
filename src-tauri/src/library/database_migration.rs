//! 一次性并库：先生成含 WAL 的一致快照，再事务导入；提交后才归档旧库。
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use std::path::{Path, PathBuf};

const MARKER: &str = "unified_database_v1";
const TABLES: [&str; 3] = ["EhSettings", "EhGalleries", "EhFavoriteGalleries"];

fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}
fn names(conn: &Connection, query: &str) -> Result<Vec<String>, String> {
    conn.prepare(query)
        .and_then(|mut s| s.query_map([], |r| r.get(0))?.collect())
        .map_err(|e| e.to_string())
}
fn columns(conn: &Connection, schema: &str, table: &str) -> Result<Vec<String>, String> {
    conn.prepare(&format!("PRAGMA {schema}.table_info({})", quote(table)))
        .and_then(|mut s| s.query_map([], |r| r.get(1))?.collect())
        .map_err(|e| e.to_string())
}
fn check(conn: &Connection) -> Result<(), String> {
    let result: String = conn
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if result == "ok" {
        Ok(())
    } else {
        Err("数据库检查未通过，已停止并库".into())
    }
}
fn snapshot(conn: &Connection, path: &Path) -> Result<(), String> {
    conn.execute("VACUUM INTO ?1", [path.to_string_lossy().as_ref()])
        .map_err(|e| format!("并库前备份失败：{e}"))?;
    Ok(())
}
fn archive(app: &Path, backup: &Path) -> Result<(), String> {
    let original = backup.join("旧库原件");
    for name in ["eh-database.db", "eh-database.db-wal", "eh-database.db-shm"] {
        let source = app.join("db").join(name);
        if !source.exists() {
            continue;
        }
        std::fs::create_dir_all(&original).map_err(|e| e.to_string())?;
        let target = original.join(name);
        if target.exists() {
            return Err("旧库归档目标已存在，保留原文件等待处理".into());
        }
        std::fs::rename(source, target).map_err(|e| format!("并库已提交，旧库归档待重试：{e}"))?;
    }
    Ok(())
}

pub(super) fn unify(
    conn: &mut Connection,
    app: &Path,
    backup_root: impl FnOnce() -> Result<PathBuf, String>,
) -> Result<(), String> {
    let state: Option<String> = conn
        .query_row(
            "SELECT Value FROM AppSettings WHERE Key=?1",
            [MARKER],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let legacy = app.join("db").join("eh-database.db");
    if let Some(label) = state {
        // 上次可能在提交后、归档中途退出；只续做归档，绝不重新导入以复活已删作品。
        let pending = ["eh-database.db", "eh-database.db-wal", "eh-database.db-shm"]
            .iter()
            .any(|name| app.join("db").join(name).exists());
        if pending {
            if !label.starts_with("并库前_") || Path::new(&label).components().count() != 1 {
                return Err("主库已初始化，但发现额外旧本子库；未覆盖或重复导入".into());
            }
            let backup = backup_root()?.join(label);
            if !backup.join("eh-database.db").is_file() {
                return Err("并库恢复快照缺失，旧库保留原位".into());
            }
            archive(app, &backup)?;
        }
        return Ok(());
    }
    if !legacy.exists() {
        crate::eh::database::initialize_eh_schema(conn)?;
        conn.execute("INSERT INTO AppSettings(Key,Value) VALUES(?1,'')", [MARKER])
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let old = Connection::open_with_flags(&legacy, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    old.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    check(&old)?;
    check(conn)?;
    let tables = names(
        &old,
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )?;
    if tables.iter().any(|t| !TABLES.contains(&t.as_str())) {
        return Err("旧本子库含未识别的数据表，已停止迁移并保留原库".into());
    }
    let timestamp: String = conn
        .query_row(
            "SELECT strftime('%Y-%m-%d_%H-%M-%f','now','localtime')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let label = format!("并库前_{}", timestamp.replace('.', "-"));
    let backup = backup_root()?.join(&label);
    std::fs::create_dir(&backup).map_err(|e| e.to_string())?;
    snapshot(conn, &backup.join("database.db"))?;
    snapshot(&old, &backup.join("eh-database.db"))?;
    drop(old);
    crate::eh::database::initialize_eh_schema(conn)?;
    // 只读取快照，原库不参与写入，任何导入错误都回滚整个事务。
    conn.execute(
        "ATTACH DATABASE ?1 AS legacy_books",
        [backup.join("eh-database.db").to_string_lossy().as_ref()],
    )
    .map_err(|e| e.to_string())?;
    let imported = (|| -> Result<(), String> {
        let tx = conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        for table in TABLES {
            if !tables.iter().any(|t| t == table) {
                continue;
            }
            let mut cols = columns(&tx, "legacy_books", table)?;
            let target_cols = columns(&tx, "main", table)?;
            if cols.iter().any(|c| !target_cols.contains(c)) {
                return Err(format!("{table} 含未识别字段，已停止并库"));
            }
            let target_count: i64 = tx
                .query_row(
                    &format!("SELECT COUNT(*) FROM main.{}", quote(table)),
                    [],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if target_count != 0 {
                return Err(format!("主库已有 {table} 数据，拒绝覆盖"));
            }
            let mut expressions: Vec<String> = cols.iter().map(|c| quote(c)).collect();
            if table == "EhGalleries" {
                // 旧版本没有来源号或入库时间时，沿用原数据库升级的回填语义。
                let updated = if cols.iter().any(|c| c == "UpdatedAt") {
                    "NULLIF(UpdatedAt,'')"
                } else {
                    "NULL"
                };
                let added = cols.iter().position(|c| c == "AddedAt");
                let expression = format!(
                    "COALESCE({}, {updated}, datetime('now','localtime'))",
                    if added.is_some() {
                        "NULLIF(AddedAt,'')"
                    } else {
                        "NULL"
                    }
                );
                if let Some(index) = added {
                    expressions[index] = expression;
                } else {
                    cols.push("AddedAt".into());
                    expressions.push(expression);
                }
                if !cols.iter().any(|c| c == "SourceId") {
                    cols.push("SourceId".into());
                    expressions.push("CAST(ABS(Gid) AS TEXT)".into());
                } else if let Some(index) = cols.iter().position(|c| c == "SourceId") {
                    expressions[index] =
                        "COALESCE(NULLIF(SourceId,''),CAST(ABS(Gid) AS TEXT))".into();
                }
            }
            let fields = cols.iter().map(|c| quote(c)).collect::<Vec<_>>().join(",");
            let values = expressions.join(",");
            let target = format!("main.{}", quote(table));
            let source = format!("legacy_books.{}", quote(table));
            tx.execute(
                &format!("INSERT INTO {target} ({fields}) SELECT {values} FROM {source}"),
                [],
            )
            .map_err(|e| format!("{table} 导入失败：{e}"))?;
            let equal: bool = tx.query_row(&format!("SELECT (SELECT COUNT(*) FROM {target})=(SELECT COUNT(*) FROM {source}) AND NOT EXISTS(SELECT {values} FROM {source} EXCEPT SELECT {fields} FROM {target})"), [], |r| r.get(0)).map_err(|e| e.to_string())?;
            if !equal {
                return Err(format!("{table} 导入校验失败，事务已取消"));
            }
        }
        tx.execute(
            "INSERT INTO AppSettings(Key,Value) VALUES(?1,?2)",
            [MARKER, &label],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    })();
    let detached = conn
        .execute_batch("DETACH DATABASE legacy_books")
        .map_err(|e| e.to_string());
    imported?;
    detached?;
    archive(app, &backup)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (PathBuf, PathBuf, Connection) {
        let base = std::env::temp_dir().join(format!(
            "ero-unify-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let app = base.join("ero-manager");
        std::fs::create_dir_all(app.join("db")).unwrap();
        let conn = Connection::open(app.join("db/database.db")).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE AppSettings(Key TEXT PRIMARY KEY,Value TEXT); CREATE TABLE Accounts(AccountKey INTEGER PRIMARY KEY,Nickname TEXT); INSERT INTO Accounts VALUES(2,'keep');").unwrap();
        (base.clone(), app, conn)
    }
    #[test]
    fn consolidates_wal_preserves_all_rows_and_never_reimports_deleted_work() {
        let (base, app, mut main) = fixture();
        let old = Connection::open(app.join("db/eh-database.db")).unwrap();
        crate::eh::database::initialize_eh_schema(&old).unwrap();
        old.execute_batch("PRAGMA wal_autocheckpoint=0; INSERT INTO EhSettings VALUES('root_path','fixture'); INSERT INTO EhGalleries(Gid,Token,Title,Category,ArtistJson,GroupJson,TagsJson,Pages,Posted,CoverPath,FolderPath,Source,SourceId,Language,TotalBytes,AddedAt) VALUES(123,'private-token','a',2,'[]','[]','[]',7,'old','a','a','eh','123','japanese',1024,'2001-01-01'),(-123,'','b',3,'[]','[]','[]',8,'old','b','b','hitomi','123','english',NULL,'2002-02-02'); INSERT INTO EhFavoriteGalleries(Gid) VALUES(123),(-123);").unwrap();
        let backups = base.join("backup");
        std::fs::create_dir(&backups).unwrap();
        // 保持源连接打开，强制快照包含 WAL；Windows 可能暂时阻止归档。
        let first = unify(&mut main, &app, || Ok(backups.clone()));
        assert!(main
            .query_row(
                "SELECT Value FROM AppSettings WHERE Key=?1",
                [MARKER],
                |r| r.get::<_, String>(0)
            )
            .is_ok());
        drop(old);
        if first.is_err() {
            unify(&mut main, &app, || Ok(backups.clone())).unwrap();
        }
        assert!(!app.join("db/eh-database.db").exists());
        assert_eq!(
            main.query_row("SELECT COUNT(*) FROM EhGalleries", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            main.query_row("SELECT Token FROM EhGalleries WHERE Gid=123", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            "private-token"
        );
        assert_eq!(
            main.query_row("SELECT AddedAt FROM EhGalleries WHERE Gid=-123", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            "2002-02-02"
        );
        assert_eq!(
            main.query_row("SELECT COUNT(*) FROM EhFavoriteGalleries", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert_eq!(
            main.query_row("SELECT Nickname FROM Accounts", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            "keep"
        );
        main.execute("DELETE FROM EhGalleries WHERE Gid=123", [])
            .unwrap();
        unify(&mut main, &app, || {
            panic!("ordinary startup must not back up again")
        })
        .unwrap();
        assert_eq!(
            main.query_row("SELECT COUNT(*) FROM EhGalleries", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        drop(main);
        std::fs::remove_dir_all(base).unwrap();
    }
    #[test]
    fn conflicts_roll_back_every_table_and_keep_original_database() {
        let (base, app, mut main) = fixture();
        crate::eh::database::initialize_eh_schema(&main).unwrap();
        main.execute("INSERT INTO EhFavoriteGalleries(Gid) VALUES(9)", [])
            .unwrap();
        let old = Connection::open(app.join("db/eh-database.db")).unwrap();
        crate::eh::database::initialize_eh_schema(&old).unwrap();
        old.execute_batch("INSERT INTO EhSettings VALUES('sentinel','preserved'); INSERT INTO EhFavoriteGalleries(Gid) VALUES(123);").unwrap();
        drop(old);
        let backups = base.join("backup");
        std::fs::create_dir(&backups).unwrap();
        assert!(unify(&mut main, &app, || Ok(backups)).is_err());
        assert!(app.join("db/eh-database.db").exists());
        assert_eq!(
            main.query_row("SELECT COUNT(*) FROM EhSettings", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            main.query_row("SELECT Gid FROM EhFavoriteGalleries", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            9
        );
        assert_eq!(
            main.query_row(
                "SELECT COUNT(*) FROM AppSettings WHERE Key=?1",
                [MARKER],
                |r| r.get::<_, i64>(0)
            )
            .unwrap(),
            0
        );
        drop(main);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn upgrades_old_gallery_columns_and_fresh_install_never_creates_secondary_database() {
        let (base, app, mut main) = fixture();
        let old = Connection::open(app.join("db/eh-database.db")).unwrap();
        old.execute_batch("CREATE TABLE EhGalleries(Gid INTEGER PRIMARY KEY,Token TEXT,Title TEXT,Category INTEGER,ArtistJson TEXT,GroupJson TEXT,TagsJson TEXT,Pages INTEGER,Posted TEXT,CoverPath TEXT,FolderPath TEXT,UpdatedAt TEXT); INSERT INTO EhGalleries VALUES(1,'t','one',2,'[]','[]','[]',3,'old','','one','2000-01-01'),(2,'t','two',2,'[]','[]','[]',4,'old','','two','2001-01-01');").unwrap();
        drop(old);
        let backups = base.join("backup");
        std::fs::create_dir(&backups).unwrap();
        unify(&mut main, &app, || Ok(backups)).unwrap();
        assert_eq!(
            main.query_row(
                "SELECT SourceId || ':' || AddedAt FROM EhGalleries WHERE Gid=2",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "2:2001-01-01"
        );
        drop(main);
        std::fs::remove_dir_all(base).unwrap();
        let (base, app, mut main) = fixture();
        unify(&mut main, &app, || panic!("fresh install needs no backup")).unwrap();
        assert!(!app.join("db/eh-database.db").exists());
        assert!(main.prepare("SELECT Gid FROM EhGalleries").is_ok());
        unify(&mut main, &app, || {
            panic!("ordinary startup needs no backup")
        })
        .unwrap();
        drop(main);
        std::fs::remove_dir_all(base).unwrap();
    }
}
