//! Portable runtime paths shared by independent backend domains.

pub(crate) fn portable_app_dir() -> std::path::PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(std::path::Path::to_path_buf))
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| std::path::PathBuf::from("."))
}

/// 备份独立于正式安装目录；便携移动后保持相同的同级 backup 布局。
pub(crate) fn portable_backup_dir() -> std::io::Result<std::path::PathBuf> {
    let app = portable_app_dir();
    let directory = app
        .parent()
        .unwrap_or(&app)
        .join("backup")
        .join("ero-manager backup");
    std::fs::create_dir_all(&directory)?;
    Ok(directory)
}

/// 所有运行数据库只使用 db 子目录；不探测根目录或旧 AppData，避免双库冲突。
pub(crate) fn portable_database_path(name: &str) -> std::io::Result<std::path::PathBuf> {
    database_path_in(&portable_app_dir(), name)
}

fn database_path_in(root: &std::path::Path, name: &str) -> std::io::Result<std::path::PathBuf> {
    if name != "database.db" {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "unsupported portable database name",
        ));
    }
    let directory = root.join("db");
    std::fs::create_dir_all(&directory)?;
    Ok(directory.join(name))
}

#[cfg(test)]
mod tests {
    use super::database_path_in;

    #[test]
    fn strict_db_layout_ignores_legacy_files_and_preserves_existing_data() {
        let root = std::env::temp_dir().join(format!(
            "ero-db-paths-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        for name in ["database.db"] {
            let target = root.join("db").join(name);
            assert_eq!(database_path_in(&root, name).unwrap(), target);
            let legacy = root.join(name);
            let connection = rusqlite::Connection::open(&legacy).unwrap();
            connection.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('preserved');").unwrap();
            assert_eq!(database_path_in(&root, name).unwrap(), target);
            let read = rusqlite::Connection::open(&legacy).unwrap();
            assert_eq!(
                read.query_row("SELECT value FROM sentinel", [], |row| row
                    .get::<_, String>(0))
                    .unwrap(),
                "preserved"
            );
            drop(read);
            drop(connection);
            let original = std::fs::read(&legacy).unwrap();
            let current = rusqlite::Connection::open(&target).unwrap();
            current
                .execute_batch(
                    "CREATE TABLE sentinel (value TEXT); INSERT INTO sentinel VALUES ('current');",
                )
                .unwrap();
            drop(current);
            assert_eq!(database_path_in(&root, name).unwrap(), target);
            let current =
                rusqlite::Connection::open(database_path_in(&root, name).unwrap()).unwrap();
            assert_eq!(
                current
                    .query_row("SELECT value FROM sentinel", [], |row| row
                        .get::<_, String>(0))
                    .unwrap(),
                "current"
            );
            drop(current);
            assert_eq!(std::fs::read(&legacy).unwrap(), original);
        }
        assert!(database_path_in(&root, "../outside.db").is_err());
        assert!(database_path_in(&root, "eh-database.db").is_err());
        // 测试仅移除自己创建且已验证位于系统临时目录的隔离夹具。
        assert!(root.starts_with(std::env::temp_dir()));
        std::fs::remove_dir_all(root).unwrap();
    }
}
