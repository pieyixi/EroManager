//! Directory scan workflow and scan-related commands.
use crate::eh::database::upsert_gallery;
use crate::eh::database::{
    open_eh_db, portable_path, read_eh_settings, validate_root, write_eh_setting,
};
use crate::eh::metadata::{
    atomic_write, create_cover_from_available_source, fetch_gallery, find_cover, parse_ehviewer,
    read_meta,
};
use crate::eh::models::*;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Emitter;
pub(crate) fn scan_eh_library<F>(
    root: &Path,
    settings: &EhSettings,
    report_progress: F,
) -> Result<EhScanResult, String>
where
    F: FnMut(usize, usize, &str),
{
    let connection = open_eh_db()?;
    scan_eh_library_with_connection(&connection, root, settings, report_progress)
}

pub(crate) fn scan_eh_library_with_connection<F>(
    connection: &rusqlite::Connection,
    root: &Path,
    settings: &EhSettings,
    mut report_progress: F,
) -> Result<EhScanResult, String>
where
    F: FnMut(usize, usize, &str),
{
    let mut result = EhScanResult {
        folders: 0,
        indexed: 0,
        created_meta: 0,
        created_cover: 0,
        removed_records: 0,
        skipped: 0,
        errors: Vec::new(),
    };
    let mut seen = BTreeSet::new();
    let folders: Vec<PathBuf> = fs::read_dir(root)
        .map_err(|error| error.to_string())?
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    let total = folders.len();
    report_progress(0, total, "正在准备扫描");
    for (index, folder) in folders.into_iter().enumerate() {
        result.folders += 1;
        let label = folder
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("未知目录")
            .to_string();
        report_progress(index, total, &format!("正在扫描 {} / {total}", index + 1));
        // 数据库存的是去掉 Windows \\?\ 前缀的便携路径；扫描时必须使用同一表示，
        // 否则下一步的缺失目录清理会把仍然存在的作品误判为已删除。
        seen.insert(portable_path(&folder));
        if folder.join("data/hitomi-source.json").is_file()
            && !folder.join("data/meta.json").is_file()
        {
            result.skipped += 1;
            report_progress(index + 1, total, &format!("已扫描 {} / {total}", index + 1));
            continue;
        }
        let mut process = || -> Result<EhGallerySummary, String> {
            let data_dir = folder.join("data");
            let meta_path = data_dir.join("meta.json");
            if meta_path.is_file() {
                if find_cover(&data_dir).is_none() {
                    create_cover_from_available_source(&folder, &data_dir)?;
                    result.created_cover += 1;
                }
                return read_meta(&meta_path, &folder);
            }
            let viewer = folder.join(".ehviewer");
            let (gid, token) = parse_ehviewer(&viewer)?;
            let mut gallery = fetch_gallery(gid, &token, settings)?;
            fs::create_dir_all(&data_dir).map_err(|error| format!("建立 data 失败: {error}"))?;
            if find_cover(&data_dir).is_none() {
                create_cover_from_available_source(&folder, &data_dir)?;
                result.created_cover += 1;
            }
            gallery.folder_path = folder.to_string_lossy().to_string();
            gallery.cover_path = find_cover(&data_dir)
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let meta = EhMeta {
                gid: gallery.gid,
                token: gallery.token.clone(),
                title: gallery.title.clone(),
                category: gallery.category,
                artist: gallery.artist.clone(),
                group: gallery.group.clone(),
                tags: gallery.tags.clone(),
                pages: gallery.pages,
                posted: gallery.posted.clone(),
            };
            let meta_bytes = serde_json::to_vec_pretty(&meta).map_err(|error| error.to_string())?;
            atomic_write(&meta_path, &meta_bytes)?;
            result.created_meta += 1;
            Ok(gallery)
        };
        match process() {
            Ok(mut gallery) => {
                gallery.folder_path = portable_path(&folder);
                gallery.cover_path = portable_path(Path::new(&gallery.cover_path));
                match upsert_gallery(connection, &gallery) {
                    Ok(()) => result.indexed += 1,
                    Err(error) => result.errors.push(EhScanIssue {
                        title: label,
                        folder_path: portable_path(&folder),
                        reason: format!("数据库写入失败: {error}"),
                    }),
                }
            }
            Err(error) => {
                result.skipped += 1;
                result.errors.push(EhScanIssue {
                    title: label,
                    folder_path: portable_path(&folder),
                    reason: error,
                });
            }
        }
        report_progress(index + 1, total, &format!("已扫描 {} / {total}", index + 1));
    }
    let stored: Vec<(i64, String)> = {
        let mut statement = connection
            .prepare("SELECT Gid,FolderPath FROM EhGalleries")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?;
        rows.filter_map(Result::ok).collect()
    };
    for (gid, folder) in stored {
        if !seen.contains(&portable_path(Path::new(&folder))) {
            connection
                .execute("DELETE FROM EhGalleries WHERE Gid=?1", [gid])
                .map_err(|e| e.to_string())?;
            result.removed_records += 1;
        }
    }
    report_progress(total, total, "扫描完成");
    Ok(result)
}
#[tauri::command]
pub fn eh_get_settings() -> Result<EhSettings, String> {
    read_eh_settings(&open_eh_db()?)
}

#[tauri::command]
pub fn eh_save_settings(input: SaveEhSettingsInput) -> Result<EhSettings, String> {
    let connection = open_eh_db()?;
    let root = validate_root(&input.root_path)?;
    write_eh_setting(&connection, "root_path", &portable_path(&root))?;
    write_eh_setting(&connection, "ipb_member_id", input.ipb_member_id.trim())?;
    write_eh_setting(&connection, "ipb_pass_hash", input.ipb_pass_hash.trim())?;
    write_eh_setting(&connection, "igneous", input.igneous.trim())?;
    read_eh_settings(&connection)
}

#[tauri::command]
pub fn eh_bind_local_library(root_path: String) -> Result<EhSettings, String> {
    let connection = open_eh_db()?;
    let root = validate_root(&root_path)?;
    write_eh_setting(&connection, "root_path", &portable_path(&root))?;
    read_eh_settings(&connection)
}

#[tauri::command]
pub async fn eh_scan_local_library(
    app: tauri::AppHandle,
    root_path: String,
) -> Result<EhScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = validate_root(&root_path)?;
        let connection = open_eh_db()?;
        write_eh_setting(&connection, "root_path", &portable_path(&root))?;
        let settings = read_eh_settings(&connection)?;
        scan_eh_library(&root, &settings, |completed, total, text| {
            let percent = completed
                .saturating_mul(100)
                .checked_div(total)
                .unwrap_or(100);
            let _ = app.emit(
                "eh-scan-progress",
                EhScanProgress {
                    percent,
                    text: text.to_string(),
                },
            );
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eh::database::initialize_eh_schema;
    use crate::eh::query::list_local_galleries;
    use rusqlite::Connection;

    #[test]
    fn rescanning_same_number_sources_keeps_both_and_preserves_admission_time() {
        let root = std::env::temp_dir().join(format!(
            "ark-hitomi-scan-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let eh = root.join("eh-123").join("data");
        let hitomi = root.join("hitomi-123-example").join("data");
        let partial = root.join("hitomi-456-partial").join("data");
        for folder in [&eh, &hitomi, &partial] {
            fs::create_dir_all(folder).unwrap();
        }
        fs::write(eh.join("cover.jpg"), b"cover").unwrap();
        fs::write(
            eh.join("meta.json"),
            r#"{"gid":123,"token":"token","title":"Eh 123","category":2,"pages":1}"#,
        )
        .unwrap();
        fs::write(hitomi.join("cover.webp"), b"cover").unwrap();
        fs::write(
            hitomi.join("hitomi-source.json"),
            r#"{"source":"hitomi","source_id":"123"}"#,
        )
        .unwrap();
        fs::write(hitomi.join("meta.json"), r#"{"source":"hitomi","source_id":"123","title":"Hitomi 123","category":4,"artist":[],"group":[],"tags":["sample"],"pages":1,"posted":"2020-01-01","language":"japanese","source_category":"manga","source_tags":["female:sample"],"series":[],"characters":[],"image_format":"webp"}"#).unwrap();
        fs::write(
            partial.join("hitomi-source.json"),
            r#"{"source":"hitomi","source_id":"456"}"#,
        )
        .unwrap();
        let connection = Connection::open_in_memory().unwrap();
        initialize_eh_schema(&connection).unwrap();
        let first = scan_eh_library_with_connection(
            &connection,
            &root,
            &EhSettings::default(),
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(
            (first.indexed, first.skipped, first.removed_records),
            (2, 1, 0)
        );
        assert!(first.errors.is_empty());
        connection
            .execute("UPDATE EhGalleries SET AddedAt='2000-01-01 00:00:00'", [])
            .unwrap();
        let second = scan_eh_library_with_connection(
            &connection,
            &root,
            &EhSettings::default(),
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(
            (second.indexed, second.skipped, second.removed_records),
            (2, 1, 0)
        );
        let rows: Vec<(i64, String, String, String)> = connection
            .prepare("SELECT Gid,Source,SourceId,AddedAt FROM EhGalleries ORDER BY Gid")
            .unwrap()
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            rows,
            vec![
                (
                    -123,
                    "hitomi".into(),
                    "123".into(),
                    "2000-01-01 00:00:00".into()
                ),
                (123, "eh".into(), "123".into(), "2000-01-01 00:00:00".into()),
            ]
        );
        let listed = list_local_galleries(&connection).unwrap();
        assert_eq!(listed.len(), 2);
        let hitomi = listed.iter().find(|gallery| gallery.gid == -123).unwrap();
        assert_eq!(hitomi.source, "hitomi");
        assert_eq!(hitomi.tags, ["sample"]);
        assert_eq!(
            listed
                .iter()
                .find(|gallery| gallery.gid == 123)
                .unwrap()
                .source,
            "eh"
        );
        assert!(root.starts_with(std::env::temp_dir()));
        fs::remove_dir_all(&root).unwrap();
    }
}
