//! Hitomi download route: configurable image concurrency, resume, admission and deletion.
mod metadata;
mod protocol;
mod storage;

use self::metadata::metadata;
pub(crate) use self::metadata::HitomiMeta;
use self::protocol::HitomiInfo;
use self::protocol::{client, fetch, get_info, Gg, DATA_HOST, MAX_IMAGE_BYTES};
use self::storage::{marker_matches, parse_id, target, valid_page, valid_webp_size};
use crate::eh::database::{
    open_eh_db, portable_path, read_eh_settings, upsert_downloaded_gallery, validate_root,
};
use crate::eh::metadata::{atomic_write, create_cover_from_available_source, find_cover};
use crate::eh::models::{EhDownloadFailure, EhDownloadProgress, EhDownloadResult};
use reqwest::blocking::Client;
use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Emitter;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HitomiDownloadInput {
    pub id: i64,
    #[serde(default)]
    pub page_indices: Option<Vec<usize>>,
    #[serde(default)]
    pub parallel_images: Option<usize>,
}

fn selected_pages(input: Option<Vec<usize>>, total: usize) -> Result<Vec<usize>, String> {
    let mut pages = input.unwrap_or_else(|| (1..=total).collect());
    if pages.is_empty() || pages.iter().any(|page| *page == 0 || *page > total) {
        return Err("Hitomi 重试页码无效".into());
    }
    pages.sort_unstable();
    pages.dedup();
    Ok(pages)
}
fn progress(app: &tauri::AppHandle, id: i64, done: usize, total: usize, text: &str) {
    let _ = app.emit(
        "hitomi-download-progress",
        EhDownloadProgress {
            gid: -id,
            page: done,
            total_pages: total,
            percent: done * 100 / total,
            text: text.into(),
        },
    );
}
fn download(app: tauri::AppHandle, input: HitomiDownloadInput) -> Result<EhDownloadResult, String> {
    crate::settings::download_parallelism(input.parallel_images)?;
    let id = input.id;
    parse_id(&id.to_string())?;
    let connection = open_eh_db()?;
    let settings = read_eh_settings(&connection)?;
    let root = validate_root(&settings.root_path)?;
    let client = client()?;
    download_into(&connection, &root, &client, input, |done, total, text| {
        progress(&app, id, done, total, text)
    })
}

fn download_into<F>(
    connection: &Connection,
    root: &Path,
    client: &Client,
    input: HitomiDownloadInput,
    report: F,
) -> Result<EhDownloadResult, String>
where
    F: FnMut(usize, usize, &str),
{
    crate::settings::download_parallelism(input.parallel_images)?;
    let id = input.id;
    parse_id(&id.to_string())?;
    let info = get_info(client, id)?;
    let gg_bytes = fetch(
        client,
        &format!("https://{DATA_HOST}/gg.js"),
        1024 * 1024,
        false,
    )?;
    let gg = Gg::parse(std::str::from_utf8(&gg_bytes).map_err(|e| e.to_string())?)?;
    download_known_gallery(connection, root, client, input, info, gg, report)
}

fn download_known_gallery<F>(
    connection: &Connection,
    root: &Path,
    client: &Client,
    input: HitomiDownloadInput,
    info: HitomiInfo,
    gg: Gg,
    mut report: F,
) -> Result<EhDownloadResult, String>
where
    F: FnMut(usize, usize, &str),
{
    let id = input.id;
    let parallel_images = crate::settings::download_parallelism(input.parallel_images)?;
    let pages = selected_pages(input.page_indices, info.files.len())?;
    let meta = metadata(&info);
    let folder = target(connection, root, id, &meta.title)?;
    let mut failures = Vec::new();
    let mut processed = 0;
    for chunk in pages.chunks(parallel_images) {
        let mut jobs = Vec::new();
        for &page in chunk {
            let path = folder.join(format!("page_{page:04}.webp"));
            if valid_page(&path) {
                processed += 1;
                report(processed, pages.len(), "正在核对已下载页面");
                continue;
            }
            match gg.image_url(&info.files[page - 1].hash) {
                Ok(url) => jobs.push((page, url)),
                Err(reason) => {
                    failures.push(EhDownloadFailure { page, reason });
                    processed += 1;
                }
            }
        }
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::scope(|scope| {
            for (page, url) in jobs {
                let tx = tx.clone();
                let folder = &folder;
                scope.spawn(move || {
                    let result = fetch(client, &url, MAX_IMAGE_BYTES, true).and_then(|bytes| {
                        if !valid_webp_size(&bytes, bytes.len() as u64) {
                            return Err("Hitomi 返回内容不是 WebP 图片".into());
                        }
                        atomic_write(&folder.join(format!("page_{page:04}.webp")), &bytes)
                    });
                    let _ = tx.send((page, result));
                });
            }
            drop(tx);
            for (page, result) in rx {
                processed += 1;
                if let Err(reason) = result {
                    failures.push(EhDownloadFailure { page, reason });
                }
                report(
                    processed,
                    pages.len(),
                    &format!("已处理第 {page} / {} 页", info.files.len()),
                );
            }
        });
    }
    failures.sort_by_key(|v| v.page);
    let complete =
        (1..=info.files.len()).all(|page| valid_page(&folder.join(format!("page_{page:04}.webp"))));
    let mut meta_path = String::new();
    let mut cover_path = String::new();
    if complete {
        let data = folder.join("data");
        if find_cover(&data).is_none() {
            create_cover_from_available_source(&folder, &data)?;
        }
        let cover = find_cover(&data).ok_or("无法生成 Hitomi 封面")?;
        let path = data.join("meta.json");
        atomic_write(
            &path,
            &serde_json::to_vec_pretty(&meta).map_err(|e| e.to_string())?,
        )?;
        let gallery = meta.into_summary(&folder, &cover)?;
        upsert_downloaded_gallery(connection, &gallery)?;
        meta_path = portable_path(&path);
        cover_path = portable_path(&cover);
    }
    let downloaded_pages = (1..=info.files.len())
        .filter(|page| valid_page(&folder.join(format!("page_{page:04}.webp"))))
        .count();
    report(
        pages.len(),
        pages.len(),
        if complete {
            "下载完成并已入库"
        } else {
            "部分页面下载失败，可增量重试"
        },
    );
    Ok(EhDownloadResult {
        gid: -id,
        title: info.title,
        folder_path: portable_path(&folder),
        total_pages: info.files.len(),
        downloaded_pages,
        failures,
        meta_path,
        cover_path,
    })
}

#[tauri::command]
pub async fn hitomi_download_gallery(
    app: tauri::AppHandle,
    input: HitomiDownloadInput,
) -> Result<EhDownloadResult, String> {
    tauri::async_runtime::spawn_blocking(move || download(app, input))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn hitomi_delete_gallery_folder(
    id: i64,
    db: tauri::State<crate::library::database::Database>,
) -> Result<(), String> {
    parse_id(&id.to_string())?;
    let connection = open_eh_db()?;
    let settings = read_eh_settings(&connection)?;
    let root = validate_root(&settings.root_path)?;
    let prefix = format!("hitomi-{id}-");
    let mut found = Vec::new();
    let stored: Option<String> = connection
        .query_row(
            "SELECT FolderPath FROM EhGalleries WHERE Source='hitomi' AND SourceId=?1",
            [id.to_string()],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(stored) = stored {
        let path = PathBuf::from(stored);
        if path.exists() {
            let path = path.canonicalize().map_err(|e| e.to_string())?;
            if path != root && path.starts_with(&root) && marker_matches(&path, id) {
                found.push(path);
            }
        }
    }
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())?.flatten() {
        if !entry.file_name().to_string_lossy().starts_with(&prefix) {
            continue;
        }
        let path = entry.path().canonicalize().map_err(|e| e.to_string())?;
        if path != root && path.starts_with(&root) && marker_matches(&path, id) {
            found.push(path);
        }
    }
    found.sort();
    found.dedup();
    if found.len() != 1 {
        return Err("无法唯一确认 Hitomi 本地目录，未删除任何文件".into());
    }
    fs::remove_dir_all(&found[0]).map_err(|e| format!("删除 Hitomi 本地目录失败: {e}"))?;
    connection
        .execute(
            "DELETE FROM EhGalleries WHERE Source='hitomi' AND SourceId=?1",
            [id.to_string()],
        )
        .map_err(|e| format!("文件已删除，但移除数据库记录失败: {e}"))?;
    crate::accounts::forget_gallery(&*db.conn.lock().map_err(|e| e.to_string())?, -id)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eh::database::initialize_eh_schema;
    #[test]
    fn gg_matches_hash_routing_and_rejects_bad_hashes() {
        let gg = Gg::parse("var o = 1; case 429: o = 0; break; b: '123/'").unwrap();
        let hash = format!("{}ad1", "a".repeat(61));
        assert_eq!(
            gg.image_url(&hash).unwrap(),
            format!("https://w1.gold-usergeneratedcontent.net/123/429/{hash}.webp")
        );
        assert!(gg.image_url("bad").is_err());
    }
    #[test]
    fn hitomi_ids_do_not_overlap_positive_eh_gids() {
        assert_eq!(parse_id("123").unwrap().checked_neg(), Some(-123));
        assert!(parse_id("0").is_err());
    }
    #[test]
    fn metadata_keeps_numeric_identity_and_namespaced_tags_without_eh_token() {
        let info: HitomiInfo = serde_json::from_str(
            r#"{
            "id":123,"title":"Example","type":"manga","date":"2020-01-01",
            "language":"japanese","tags":[{"tag":"glasses","female":1,"male":""}],
            "files":[{"hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]
        }"#,
        )
        .unwrap();
        let meta = metadata(&info);
        assert_eq!(meta.source_id, "123");
        assert_eq!(meta.category, 4);
        assert_eq!(meta.tags, ["glasses"]);
        assert_eq!(meta.source_tags, ["female:glasses"]);
        let json = serde_json::to_string(&meta).unwrap();
        assert!(!json.contains("\"token\""));
        assert!(!json.contains("\"gid\""));
        let restored: HitomiMeta = serde_json::from_str(&json).unwrap();
        let summary = restored
            .into_summary(Path::new("gallery"), Path::new("cover.webp"))
            .unwrap();
        assert_eq!(summary.gid, -123);
        assert_eq!(summary.source, "hitomi");
        assert_eq!(summary.source_id, "123");
    }
    #[test]
    fn webp_validation_rejects_truncated_or_html_payloads() {
        let mut header = b"RIFF\0\0\0\0WEBPVP8 \0\0\0\0".to_vec();
        header[4..8].copy_from_slice(&12u32.to_le_bytes());
        assert!(valid_webp_size(&header, 20));
        assert!(!valid_webp_size(&header, 19));
        assert!(!valid_webp_size(b"<html>denied", 20));
    }
    #[test]
    fn retry_page_selection_is_unique_and_bounded() {
        assert_eq!(selected_pages(Some(vec![3, 1, 3]), 5).unwrap(), [1, 3]);
        assert!(selected_pages(Some(vec![0]), 5).is_err());
        assert!(selected_pages(Some(vec![6]), 5).is_err());
    }
    #[test]
    fn resume_requires_owned_marker_and_complete_page_bytes() {
        let root = std::env::temp_dir().join(format!(
            "ark-hitomi-resume-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        initialize_eh_schema(&connection).unwrap();
        let folder = target(&connection, &root, 123, "Sample").unwrap();
        assert!(marker_matches(&folder, 123));
        assert_eq!(target(&connection, &root, 123, "Renamed").unwrap(), folder);
        connection.execute(
            "INSERT INTO EhGalleries(Gid,Token,Title,Category,ArtistJson,GroupJson,TagsJson,Pages,Posted,CoverPath,FolderPath,Source,SourceId)
             VALUES(-123,'','Sample',4,'[]','[]','[]',1,'','',?1,'hitomi','123')",
            [portable_path(&folder)],
        ).unwrap();
        assert_eq!(target(&connection, &root, 123, "Renamed").unwrap(), folder);
        let mut page = b"RIFF\0\0\0\0WEBPVP8 \0\0\0\0".to_vec();
        page[4..8].copy_from_slice(&12u32.to_le_bytes());
        let path = folder.join("page_0001.webp");
        fs::write(&path, &page).unwrap();
        assert!(valid_page(&path));
        fs::write(&path, &page[..19]).unwrap();
        assert!(!valid_page(&path));
        fs::create_dir(root.join("hitomi-124-unmarked")).unwrap();
        assert!(target(&connection, &root, 124, "Elsewhere").is_err());
        assert!(root.starts_with(std::env::temp_dir().canonicalize().unwrap()));
        fs::remove_dir_all(&root).unwrap();
    }
    #[test]
    #[ignore = "explicit network smoke test; downloads three sample images into memory only"]
    fn current_site_metadata_and_image_route() {
        const SAMPLE_IMAGES: usize = 3;
        let client = client().unwrap();
        let info = get_info(&client, 1469394).unwrap();
        assert!(info.files.len() >= SAMPLE_IMAGES);
        let bytes = fetch(
            &client,
            &format!("https://{DATA_HOST}/gg.js"),
            1024 * 1024,
            false,
        )
        .unwrap();
        let gg = Gg::parse(std::str::from_utf8(&bytes).unwrap()).unwrap();
        std::thread::scope(|scope| {
            let workers: Vec<_> = info.files[..SAMPLE_IMAGES]
                .iter()
                .map(|file| {
                    let url = gg.image_url(&file.hash).unwrap();
                    let client = &client;
                    scope.spawn(move || {
                        let image = fetch(client, &url, MAX_IMAGE_BYTES, true).unwrap();
                        assert!(valid_webp_size(&image, image.len() as u64));
                    })
                })
                .collect();
            for worker in workers {
                worker.join().unwrap();
            }
        });
    }
    #[test]
    #[ignore = "explicit network test of three real images; writes only to a new system-temp folder"]
    fn downloads_three_real_pages_then_resumes_scans_and_reads_in_isolation() {
        use crate::eh::database::initialize_eh_schema;
        use crate::eh::models::EhSettings;
        use crate::eh::query::list_local_galleries;
        use crate::eh::reader::list_gallery_pages;
        use crate::eh::scan::scan_eh_library_with_connection;

        let root = std::env::temp_dir().join(format!(
            "ark-hitomi-full-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        let root = root.canonicalize().unwrap();
        struct Cleanup(PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                if self
                    .0
                    .starts_with(std::env::temp_dir().canonicalize().unwrap())
                {
                    let _ = fs::remove_dir_all(&self.0);
                }
            }
        }
        let _cleanup = Cleanup(root.clone());
        let connection = Connection::open_in_memory().unwrap();
        initialize_eh_schema(&connection).unwrap();
        let client = client().unwrap();
        let mut info = get_info(&client, 1469394).unwrap();
        info.files.truncate(3);
        let gg_bytes = fetch(
            &client,
            &format!("https://{DATA_HOST}/gg.js"),
            1024 * 1024,
            false,
        )
        .unwrap();
        let gg = Gg::parse(std::str::from_utf8(&gg_bytes).unwrap()).unwrap();
        let result = download_known_gallery(
            &connection,
            &root,
            &client,
            HitomiDownloadInput {
                parallel_images: Some(3),
                id: 1469394,
                page_indices: None,
            },
            info.clone(),
            gg.clone(),
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(
            (
                result.total_pages,
                result.downloaded_pages,
                result.failures.len()
            ),
            (3, 3, 0),
            "{:?}",
            result.failures
        );
        assert!(Path::new(&result.meta_path).is_file());
        assert!(Path::new(&result.cover_path).is_file());
        let gallery = list_local_galleries(&connection).unwrap().remove(0);
        assert_eq!(
            (
                gallery.gid,
                gallery.source.as_str(),
                gallery.source_id.as_str()
            ),
            (-1469394, "hitomi", "1469394")
        );
        let reader_pages = list_gallery_pages(&connection, -1469394).unwrap();
        assert_eq!(reader_pages.len(), 3);
        let page_one = Path::new(&reader_pages[0].path);
        let modified = fs::metadata(page_one).unwrap().modified().unwrap();
        let scan = scan_eh_library_with_connection(
            &connection,
            &root,
            &EhSettings::default(),
            |_, _, _| {},
        )
        .unwrap();
        assert_eq!(
            (scan.indexed, scan.removed_records, scan.errors.len()),
            (1, 0, 0)
        );
        let retry = download_known_gallery(
            &connection,
            &root,
            &client,
            HitomiDownloadInput {
                parallel_images: Some(3),
                id: 1469394,
                page_indices: Some(vec![1, 2, 3]),
            },
            info.clone(),
            gg.clone(),
            |_, _, _| {},
        )
        .unwrap();
        assert!(retry.failures.is_empty());
        assert_eq!(retry.downloaded_pages, 3);
        assert_eq!(
            fs::metadata(page_one).unwrap().modified().unwrap(),
            modified
        );
        let page_two = Path::new(&reader_pages[1].path);
        fs::write(page_two, b"truncated").unwrap();
        assert!(!valid_page(page_two));
        let incremental = download_known_gallery(
            &connection,
            &root,
            &client,
            HitomiDownloadInput {
                parallel_images: Some(3),
                id: 1469394,
                page_indices: Some(vec![2]),
            },
            info,
            gg,
            |_, _, _| {},
        )
        .unwrap();
        assert!(incremental.failures.is_empty());
        assert_eq!(incremental.downloaded_pages, 3);
        assert!(valid_page(page_two));
        assert_eq!(
            fs::metadata(page_one).unwrap().modified().unwrap(),
            modified
        );
        assert!(root.starts_with(std::env::temp_dir().canonicalize().unwrap()));
    }
}
