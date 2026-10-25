use crate::library::database::Database;
use crate::library::models::is_video_file;
use crate::paths::{portable_backup_dir, portable_database_path};
use crate::shared::*;
use tauri::Emitter;

#[tauri::command(async)]
pub fn backup_database(backup_path: String, db: State<Database>) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&backup_path)
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("VACUUM INTO ?1", params![backup_path])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(async)]
pub fn restore_database(
    restore_path: String,
    db: State<Database>,
    session: State<crate::accounts::Session>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let db_file = portable_database_path("database.db").map_err(|error| error.to_string())?;
    let source_path = std::path::Path::new(&restore_path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if source_path == db_file.canonicalize().map_err(|e| e.to_string())? {
        return Err("不能用正在运行的数据库恢复自身".into());
    }
    // 与其他个人数据命令保持 session -> db 的锁序。
    let mut state = session.0.lock().map_err(|e| e.to_string())?;
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    restore_snapshot(
        &mut conn,
        &source_path,
        &portable_backup_dir().map_err(|e| e.to_string())?,
    )?;
    state.token.clear();
    state.key = None;
    let initialized = crate::accounts::initialize(&mut conn, false);
    let _ = app.emit("accounts-admin-changed", true);
    initialized?;
    Ok(())
}

fn restore_snapshot(
    conn: &mut Connection,
    source_path: &std::path::Path,
    backup_root: &std::path::Path,
) -> Result<(), String> {
    let source =
        Connection::open_with_flags(source_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| e.to_string())?;
    let result: String = source
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| format!("备份无法读取：{e}"))?;
    if result != "ok" {
        return Err("备份完整性检查失败".into());
    }
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .and_then(|mut s| s.query_map([], |r| r.get(0))?.collect())
        .map_err(|e| e.to_string())?;
    for table in tables {
        let quoted = format!("\"{}\"", table.replace('"', "\"\""));
        let columns: Vec<String> = conn
            .prepare(&format!("PRAGMA table_info({quoted})"))
            .and_then(|mut s| s.query_map([], |r| r.get::<_, String>(1))?.collect())
            .map_err(|e| e.to_string())?;
        let source_columns: Vec<String> = source
            .prepare(&format!("PRAGMA table_info({quoted})"))
            .and_then(|mut s| s.query_map([], |r| r.get::<_, String>(1))?.collect())
            .map_err(|e| e.to_string())?;
        // v6 的 AV 索引是可追加重建的表；完整的旧并库备份可以没有它。
        if table == "AvWorks" && source_columns.is_empty() { continue; }
        if columns.iter().any(|name| !source_columns.contains(name)) {
            return Err("备份缺少当前数据表或字段，请选择并库后的完整数据库备份".into());
        }
    }
    let unified: bool = source
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM AppSettings WHERE Key='unified_database_v1')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !unified {
        return Err("请选择并库后的完整数据库备份，旧分库备份不能单独覆盖主库".into());
    }
    if source
        .prepare("PRAGMA foreign_key_check")
        .and_then(|mut s| s.exists([]))
        .map_err(|e| e.to_string())?
    {
        return Err("备份中存在无效的数据关联，已取消恢复".into());
    }
    let timestamp: String = conn
        .query_row(
            "SELECT strftime('%Y-%m-%d_%H-%M-%f','now','localtime')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let before = backup_root.join(format!("恢复前_{}.db", timestamp.replace('.', "-")));
    conn.execute("VACUUM INTO ?1", [before.to_string_lossy().as_ref()])
        .map_err(|e| format!("恢复前备份失败：{e}"))?;
    // SQLite backup API 在同一数据库连接上原子替换，正确处理 WAL；失败时保留原数据库。
    {
        let restore = rusqlite::backup::Backup::new(&source, conn).map_err(|e| e.to_string())?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            match restore.step(256).map_err(|e| e.to_string())? {
                rusqlite::backup::StepResult::Done => break,
                rusqlite::backup::StepResult::More => {}
                _ if std::time::Instant::now() < deadline => {
                    std::thread::sleep(std::time::Duration::from_millis(50))
                }
                _ => return Err("数据库仍被占用，已取消恢复，请稍后重试".into()),
            }
        }
    }
    crate::av::invalidate_inflight();
    crate::av::initialize(conn)?;
    Ok(())
}

fn push_u16(buf: &mut Vec<u8>, value: u16) {
    buf.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(buf: &mut Vec<u8>, value: u32) {
    buf.extend_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod zip_filename_tests {
    use super::{write_streaming_store_zip, BackupFile};

    #[test]
    fn marks_local_and_central_names_as_utf8() {
        let root = std::env::temp_dir().join(format!(
            "ero-manager-utf8-zip-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let source = root.join("meta.json");
        let path = root.join("backup.zip");
        let name = "姉SUMMER！/data/meta.json";
        std::fs::write(&source, b"{}").unwrap();
        write_streaming_store_zip(
            &path,
            &[BackupFile {
                path: source,
                name: name.to_string(),
                size: 2,
            }],
            |_, _| {},
        )
        .unwrap();

        let data = std::fs::read(&path).unwrap();
        let local_flags = u16::from_le_bytes([data[6], data[7]]);
        let central_offset = data
            .windows(4)
            .position(|bytes| bytes == b"\x50\x4b\x01\x02")
            .unwrap();
        let central_flags =
            u16::from_le_bytes([data[central_offset + 8], data[central_offset + 9]]);

        assert_ne!(local_flags & 0x0800, 0);
        assert_ne!(central_flags & 0x0800, 0);
        assert!(data
            .windows(name.len())
            .any(|bytes| bytes == name.as_bytes()));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn streams_files_with_progress_and_preserves_an_existing_backup_on_failure() {
        let root = std::env::temp_dir().join(format!(
            "ero-manager-streaming-zip-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let source = root.join("meta.json");
        let output = root.join("backup.zip");
        std::fs::write(&source, br#"{"title":"test"}"#).unwrap();
        let files = vec![BackupFile {
            path: source.clone(),
            name: "作品/data/meta.json".to_string(),
            size: std::fs::metadata(&source).unwrap().len(),
        }];
        let mut progress = Vec::new();

        write_streaming_store_zip(&output, &files, |percent, _| progress.push(percent)).unwrap();
        let data = std::fs::read(&output).unwrap();
        assert_eq!(u16::from_le_bytes([data[6], data[7]]) & 0x0808, 0x0808);
        assert!(data.windows(4).any(|bytes| bytes == b"\x50\x4b\x07\x08"));
        assert!(data.windows(4).any(|bytes| bytes == b"\x50\x4b\x01\x02"));
        assert_eq!(progress.last(), Some(&98));

        let original = std::fs::read(&output).unwrap();
        let missing = vec![BackupFile {
            path: root.join("missing.json"),
            name: "missing.json".to_string(),
            size: 1,
        }];
        assert!(write_streaming_store_zip(&output, &missing, |_, _| {}).is_err());
        assert_eq!(std::fs::read(&output).unwrap(), original);
        assert!(!output.with_extension("zip.partial").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[derive(Clone, serde::Serialize)]
struct BackupProgressEvent {
    percent: u8,
    text: String,
}

struct BackupFile {
    path: std::path::PathBuf,
    name: String,
    size: u64,
}

struct ZipCentralEntry {
    name: String,
    crc: u32,
    size: u32,
    offset: u32,
}

fn emit_backup_progress(app: &tauri::AppHandle, percent: u8, text: impl Into<String>) {
    use tauri::Emitter as _;
    let _ = app.emit(
        "backup-data-package-progress",
        BackupProgressEvent {
            percent,
            text: text.into(),
        },
    );
}

fn collect_non_video_files(
    root: &std::path::Path,
    dir: &std::path::Path,
    prefix: &str,
    files: &mut Vec<BackupFile>,
) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            collect_non_video_files(root, &path, prefix, files)?;
        } else if path.is_file() && !is_video_file(&path) {
            let rel = path.strip_prefix(root).map_err(|e| e.to_string())?;
            let name = format!("{}/{}", prefix, rel.to_string_lossy().replace('\\', "/"));
            let size = entry.metadata().map_err(|e| e.to_string())?.len();
            if size > u32::MAX as u64 {
                return Err(format!(
                    "单个资料文件超过 4 GB，无法写入资料包: {}",
                    path.display()
                ));
            }
            files.push(BackupFile { path, name, size });
        }
    }
    Ok(())
}

fn write_streaming_store_zip(
    path: &std::path::Path,
    files: &[BackupFile],
    mut progress: impl FnMut(u8, String),
) -> Result<(), String> {
    use std::io::{Read as _, Write as _};

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let partial_path = path.with_extension("zip.partial");
    let result = (|| {
        let file = std::fs::File::create(&partial_path).map_err(|e| e.to_string())?;
        let mut writer = std::io::BufWriter::with_capacity(1024 * 1024, file);
        let mut offset = 0u64;
        let total_bytes = files.iter().map(|file| file.size).sum::<u64>().max(1);
        let mut written_bytes = 0u64;
        let mut last_percent = 11u8;
        let mut central_entries = Vec::with_capacity(files.len());
        let mut buffer = vec![0u8; 1024 * 1024];

        for backup_file in files {
            if offset > u32::MAX as u64 {
                return Err("资料包超过 ZIP32 的 4 GB 上限".to_string());
            }
            let name = backup_file.name.replace('\\', "/");
            let name_bytes = name.as_bytes();
            if name_bytes.len() > u16::MAX as usize {
                return Err(format!("资料路径过长: {}", name));
            }
            let local_offset = offset as u32;
            let mut header = Vec::with_capacity(30 + name_bytes.len());
            push_u32(&mut header, 0x0403_4b50);
            push_u16(&mut header, 20);
            push_u16(&mut header, 0x0808);
            push_u16(&mut header, 0);
            push_u16(&mut header, 0);
            push_u16(&mut header, 0);
            push_u32(&mut header, 0);
            push_u32(&mut header, 0);
            push_u32(&mut header, 0);
            push_u16(&mut header, name_bytes.len() as u16);
            push_u16(&mut header, 0);
            header.extend_from_slice(name_bytes);
            writer.write_all(&header).map_err(|e| e.to_string())?;
            offset += header.len() as u64;

            let mut source = std::fs::File::open(&backup_file.path)
                .map_err(|e| format!("读取资料文件失败: {} ({})", backup_file.path.display(), e))?;
            let mut crc = crc32fast::Hasher::new();
            let mut file_bytes = 0u64;
            loop {
                let count = source.read(&mut buffer).map_err(|e| e.to_string())?;
                if count == 0 {
                    break;
                }
                writer
                    .write_all(&buffer[..count])
                    .map_err(|e| e.to_string())?;
                crc.update(&buffer[..count]);
                file_bytes += count as u64;
                written_bytes += count as u64;
                offset += count as u64;
                let percent = 12 + ((written_bytes.saturating_mul(85) / total_bytes) as u8).min(85);
                if percent > last_percent {
                    last_percent = percent;
                    progress(
                        percent,
                        format!(
                            "正在写入资料文件 {}/{}",
                            central_entries.len() + 1,
                            files.len()
                        ),
                    );
                }
            }
            if file_bytes != backup_file.size {
                return Err(format!(
                    "备份时文件大小发生变化: {}",
                    backup_file.path.display()
                ));
            }
            let crc = crc.finalize();
            let size = file_bytes as u32;
            let mut descriptor = Vec::with_capacity(16);
            push_u32(&mut descriptor, 0x0807_4b50);
            push_u32(&mut descriptor, crc);
            push_u32(&mut descriptor, size);
            push_u32(&mut descriptor, size);
            writer.write_all(&descriptor).map_err(|e| e.to_string())?;
            offset += descriptor.len() as u64;
            central_entries.push(ZipCentralEntry {
                name,
                crc,
                size,
                offset: local_offset,
            });
        }

        if central_entries.len() > u16::MAX as usize || offset > u32::MAX as u64 {
            return Err("资料包超过 ZIP32 格式上限".to_string());
        }
        progress(98, "正在完成资料包索引".to_string());
        let central_offset = offset as u32;
        let mut central = Vec::new();
        for entry in &central_entries {
            let name_bytes = entry.name.as_bytes();
            push_u32(&mut central, 0x0201_4b50);
            push_u16(&mut central, 20);
            push_u16(&mut central, 20);
            push_u16(&mut central, 0x0808);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u32(&mut central, entry.crc);
            push_u32(&mut central, entry.size);
            push_u32(&mut central, entry.size);
            push_u16(&mut central, name_bytes.len() as u16);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u16(&mut central, 0);
            push_u32(&mut central, 0);
            push_u32(&mut central, entry.offset);
            central.extend_from_slice(name_bytes);
        }
        if central.len() > u32::MAX as usize {
            return Err("资料包文件索引过大".to_string());
        }
        writer.write_all(&central).map_err(|e| e.to_string())?;
        let mut footer = Vec::with_capacity(22);
        push_u32(&mut footer, 0x0605_4b50);
        push_u16(&mut footer, 0);
        push_u16(&mut footer, 0);
        push_u16(&mut footer, central_entries.len() as u16);
        push_u16(&mut footer, central_entries.len() as u16);
        push_u32(&mut footer, central.len() as u32);
        push_u32(&mut footer, central_offset);
        push_u16(&mut footer, 0);
        writer.write_all(&footer).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&partial_path);
        return result;
    }
    let previous_path = path.with_extension("zip.previous");
    if previous_path.exists() {
        std::fs::remove_file(&previous_path).map_err(|e| e.to_string())?;
    }
    if path.exists() {
        std::fs::rename(path, &previous_path).map_err(|e| e.to_string())?;
    }
    if let Err(error) = std::fs::rename(&partial_path, path) {
        if previous_path.exists() {
            let _ = std::fs::rename(&previous_path, path);
        }
        return Err(error.to_string());
    }
    let _ = std::fs::remove_file(previous_path);
    Ok(())
}

#[tauri::command]
pub async fn backup_data_package(
    backup_path: String,
    db: State<'_, Database>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    emit_backup_progress(&app, 2, "正在读取媒体库清单");
    let (folders, temp_db) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let folders = {
            let mut statement = conn
                .prepare("SELECT DISTINCT FolderPath FROM Works")
                .map_err(|e| e.to_string())?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<String>, _>>()
                .map_err(|e| e.to_string())?
        };

        emit_backup_progress(&app, 4, "正在生成数据库快照");
        let temp_db = portable_backup_dir()
            .map_err(|e| e.to_string())?
            .join("temp")
            .join("backup-database.db");
        if let Some(parent) = temp_db.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let _ = std::fs::remove_file(&temp_db);
        conn.execute(
            "VACUUM INTO ?1",
            params![temp_db.to_string_lossy().to_string()],
        )
        .map_err(|e| e.to_string())?;
        (folders, temp_db)
    };

    tauri::async_runtime::spawn_blocking(move || {
        let result = (|| {
            let mut files = Vec::new();
            for (index, folder) in folders.iter().enumerate() {
                let root = std::path::Path::new(folder);
                if root.is_dir() {
                    let name = root
                        .file_name()
                        .and_then(|value| value.to_str())
                        .unwrap_or("unknown");
                    collect_non_video_files(root, root, name, &mut files)?;
                }
                let percent = 5 + (((index + 1) * 6 / folders.len().max(1)) as u8).min(6);
                emit_backup_progress(
                    &app,
                    percent,
                    format!("正在清点资料文件 {}/{}", index + 1, folders.len()),
                );
            }
            if let Ok(metadata) = std::fs::metadata(&temp_db) {
                files.push(BackupFile {
                    path: temp_db.clone(),
                    name: "_hanime_manager/database.db".to_string(),
                    size: metadata.len(),
                });
            }
            if files.is_empty() {
                return Err("没有可备份的资料文件".to_string());
            }
            let out_path = std::path::PathBuf::from(backup_path);
            emit_backup_progress(&app, 12, format!("准备写入 {} 个资料文件", files.len()));
            write_streaming_store_zip(&out_path, &files, |percent, text| {
                emit_backup_progress(&app, percent, text)
            })?;
            emit_backup_progress(&app, 100, "资料包备份完成");
            Ok(out_path.to_string_lossy().to_string())
        })();
        let _ = std::fs::remove_file(&temp_db);
        result
    })
    .await
    .map_err(|error| error.to_string())?
}

// ─── App Entry ────────────────────────────────────────────

#[cfg(test)]
mod restore_tests {
    use super::*;
    #[test]
    fn restores_wal_database_through_live_connection_and_rejects_incomplete_backup() {
        let root = std::env::temp_dir().join(format!(
            "ero-restore-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let mut target = Connection::open(root.join("database.db")).unwrap();
        target.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE AppSettings(Key TEXT PRIMARY KEY,Value TEXT); INSERT INTO AppSettings VALUES('unified_database_v1',''); CREATE TABLE EhGalleries(Gid INTEGER PRIMARY KEY,Title TEXT); INSERT INTO EhGalleries VALUES(-123,'before');").unwrap();
        let source = Connection::open(root.join("source.db")).unwrap();
        source.execute_batch("CREATE TABLE AppSettings(Key TEXT PRIMARY KEY,Value TEXT); INSERT INTO AppSettings VALUES('unified_database_v1',''); CREATE TABLE EhGalleries(Gid INTEGER PRIMARY KEY,Title TEXT); INSERT INTO EhGalleries VALUES(123,'restored');").unwrap();
        drop(source);
        // v5 统一备份没有 AV 表，升级后仍须能够恢复，并重新建立空索引。
        crate::av::initialize(&target).unwrap();
        let reader = Connection::open(root.join("database.db")).unwrap();
        restore_snapshot(&mut target, &root.join("source.db"), &root).unwrap();
        assert_eq!(target.query_row("SELECT COUNT(*) FROM AvWorks", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        assert_eq!(
            target
                .query_row("SELECT Gid FROM EhGalleries", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            123
        );
        assert_eq!(
            reader
                .query_row("SELECT Title FROM EhGalleries", [], |r| r
                    .get::<_, String>(0))
                .unwrap(),
            "restored"
        );
        assert_eq!(
            target
                .query_row("PRAGMA quick_check", [], |r| r.get::<_, String>(0))
                .unwrap(),
            "ok"
        );
        let before = std::fs::read_dir(&root)
            .unwrap()
            .flatten()
            .find(|e| e.file_name().to_string_lossy().starts_with("恢复前_"))
            .unwrap();
        let before = Connection::open(before.path()).unwrap();
        assert_eq!(
            before
                .query_row("SELECT Gid FROM EhGalleries", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            -123
        );
        drop(before);
        let invalid = Connection::open(root.join("old.db")).unwrap();
        invalid
            .execute_batch("CREATE TABLE AppSettings(Key TEXT PRIMARY KEY,Value TEXT);")
            .unwrap();
        drop(invalid);
        assert!(restore_snapshot(&mut target, &root.join("old.db"), &root).is_err());
        assert_eq!(
            target
                .query_row("SELECT Gid FROM EhGalleries", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            123
        );
        drop(reader);
        drop(target);
        std::fs::remove_dir_all(root).unwrap();
    }
}
