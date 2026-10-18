//! Resumable Eh gallery download orchestration.
//!
//! Listing discovery, network transfer, and local persistence are separated
//! so changes to one protocol boundary do not silently affect the others.
mod listing;
mod network;
mod storage;

use crate::eh::database::{
    open_eh_db, portable_path, read_eh_settings, upsert_downloaded_gallery, validate_root,
};
use crate::eh::metadata::{create_cover_from_available_source, fetch_gallery, find_cover};
use crate::eh::models::*;
use listing::PageUrlResolver;
use network::{download_page, make_client};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use storage::{existing_page, prepare_target, requested_pages, write_meta, write_source_marker};
use tauri::Emitter;

// A corruption guard, not an assumed Eh listing-page size.
const MAX_GALLERY_PAGES: usize = 100_000;
const MAX_METADATA_ATTEMPTS: usize = 3;

fn metadata_error_is_retryable(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    if lower.starts_with("eh api:") {
        return false;
    }
    if let Some(status) = lower
        .strip_prefix("eh api 返回 http ")
        .and_then(|value| value.split_whitespace().next())
        .and_then(|value| value.parse::<u16>().ok())
    {
        return status == 429 || status >= 500;
    }
    true
}

fn retry_operation<T, F, W>(attempts: usize, mut operation: F, mut wait: W) -> Result<T, String>
where
    F: FnMut() -> Result<T, String>,
    W: FnMut(usize),
{
    let attempts = attempts.max(1);
    for attempt in 1..=attempts {
        match operation() {
            Ok(value) => return Ok(value),
            Err(error) if attempt < attempts && metadata_error_is_retryable(&error) => {
                wait(attempt)
            }
            Err(error) => return Err(error),
        }
    }
    unreachable!("retry loop always returns on its final attempt")
}

fn fetch_gallery_with_retry(
    gid: i64,
    token: &str,
    settings: &EhSettings,
) -> Result<EhGallerySummary, String> {
    retry_operation(
        MAX_METADATA_ATTEMPTS,
        || fetch_gallery(gid, token, settings),
        |attempt| {
            let delay_ms = if attempt == 1 { 500 } else { 1_500 };
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        },
    )
}

type DownloadJob = (usize, usize, String);
type DownloadOutcome = (usize, usize, Result<PathBuf, String>);

fn download_jobs(
    client: &reqwest::blocking::Client,
    settings: &EhSettings,
    folder: &Path,
    jobs: Vec<DownloadJob>,
) -> Vec<DownloadOutcome> {
    let (sender, receiver) = mpsc::channel();
    std::thread::scope(|scope| {
        for (position, page, url) in jobs {
            let sender = sender.clone();
            scope.spawn(move || {
                let result = download_page(client, settings, folder, page, &url);
                let _ = sender.send((position, page, result));
            });
        }
        drop(sender);
        receiver.into_iter().collect()
    })
}

fn validate_token(token: &str) -> Result<String, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("token 不能为空".to_string());
    }
    if token.len() > 200
        || token.chars().any(|character| {
            character.is_whitespace() || matches!(character, '/' | '\\' | '?' | '#' | '&')
        })
    {
        return Err("token 格式无效".to_string());
    }
    Ok(token.to_string())
}

pub(super) fn redact_token(message: &str, token: &str) -> String {
    if token.is_empty() {
        message.to_string()
    } else {
        message.replace(token, "<token>")
    }
}

fn emit_progress(app: &tauri::AppHandle, gid: i64, page: usize, total: usize, text: &str) {
    let percent = page.saturating_mul(100).checked_div(total).unwrap_or(100);
    let _ = app.emit(
        "eh-download-progress",
        EhDownloadProgress {
            gid,
            page,
            total_pages: total,
            percent,
            text: text.to_string(),
        },
    );
}

fn download_gallery(
    app: tauri::AppHandle,
    input: EhDownloadInput,
) -> Result<EhDownloadResult, String> {
    let parallel_images = crate::settings::download_parallelism(input.parallel_images)?;
    if input.gid <= 0 {
        return Err("GID 必须是正整数".to_string());
    }
    let token = validate_token(&input.token)?;
    let connection = open_eh_db()?;
    let settings = read_eh_settings(&connection)?;
    let root = validate_root(&settings.root_path)?;
    let client = make_client()?;
    let mut gallery = fetch_gallery_with_retry(input.gid, &token, &settings)
        .map_err(|error| redact_token(&error, &token))?;
    let total_pages =
        usize::try_from(gallery.pages).map_err(|_| "Eh 返回的页数无效".to_string())?;
    if total_pages == 0 {
        return Err("Eh 作品没有可下载页面".to_string());
    }
    if total_pages > MAX_GALLERY_PAGES {
        return Err(format!(
            "Eh 返回的页数过大（最多支持 {MAX_GALLERY_PAGES} 页）"
        ));
    }
    let pages = requested_pages(input.page_indices, total_pages)?;
    let folder = prepare_target(&connection, &root, input.gid, &gallery.title, &token)?;
    write_source_marker(&folder, input.gid, &token)?;
    let data_dir = folder.join("data");
    fs::create_dir_all(&data_dir).map_err(|error| format!("建立 data 失败: {error}"))?;

    let mut resolver = PageUrlResolver::new(&client, &settings, input.gid, &token, total_pages);
    let mut failures = Vec::new();
    let mut downloaded_pages = 0;
    let mut completed_pages = 0;
    for chunk in pages.chunks(parallel_images) {
        let mut jobs = Vec::with_capacity(chunk.len());
        for page in chunk.iter().copied() {
            emit_progress(
                &app,
                input.gid,
                completed_pages,
                pages.len(),
                &format!("正在准备第 {page} / {total_pages} 页"),
            );
            if existing_page(&folder, page).is_some() {
                downloaded_pages += 1;
                completed_pages += 1;
                emit_progress(
                    &app,
                    input.gid,
                    completed_pages,
                    pages.len(),
                    &format!("已存在第 {page} / {total_pages} 页"),
                );
                continue;
            }
            match resolver
                .resolve_page(page)
                .and_then(|url| url.ok_or_else(|| "作品列表中没有找到该页".to_string()))
            {
                Ok(url) => jobs.push((completed_pages, page, url)),
                Err(reason) => {
                    failures.push(EhDownloadFailure {
                        page,
                        reason: redact_token(&reason, &token),
                    });
                    completed_pages += 1;
                }
            }
        }
        for (_, page, result) in download_jobs(&client, &settings, &folder, jobs) {
            completed_pages += 1;
            match result {
                Ok(_) => downloaded_pages += 1,
                Err(reason) => failures.push(EhDownloadFailure {
                    page,
                    reason: redact_token(&reason, &token),
                }),
            }
            emit_progress(
                &app,
                input.gid,
                completed_pages,
                pages.len(),
                &format!("已处理第 {page} / {total_pages} 页"),
            );
        }
    }
    failures.sort_by_key(|failure| failure.page);

    if find_cover(&data_dir).is_none() {
        let _ = create_cover_from_available_source(&folder, &data_dir);
    }
    gallery.token = token;
    gallery.folder_path = portable_path(&folder);
    gallery.cover_path = find_cover(&data_dir)
        .map(|path| portable_path(&path))
        .unwrap_or_default();
    let meta_path = write_meta(&folder, &gallery)?;
    // A successful download/retry is a fresh local admission event. Scans use
    // the regular upsert and deliberately do not disturb this ordering field.
    upsert_downloaded_gallery(&connection, &gallery)?;
    emit_progress(
        &app,
        input.gid,
        pages.len(),
        pages.len(),
        if failures.is_empty() {
            "下载完成"
        } else {
            "下载完成，存在失败页面"
        },
    );
    Ok(EhDownloadResult {
        gid: gallery.gid,
        title: gallery.title,
        folder_path: gallery.folder_path,
        total_pages,
        downloaded_pages,
        failures,
        meta_path: portable_path(&meta_path),
        cover_path: gallery.cover_path,
    })
}

#[tauri::command]
pub async fn eh_download_gallery(
    app: tauri::AppHandle,
    input: EhDownloadInput,
) -> Result<EhDownloadResult, String> {
    tauri::async_runtime::spawn_blocking(move || download_gallery(app, input))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_tokens_and_redacts_network_errors() {
        assert!(validate_token("abc123").is_ok());
        assert!(validate_token("bad/token").is_err());
        assert_eq!(
            redact_token("https://exhentai.org/g/1/secret/ failed", "secret"),
            "https://exhentai.org/g/1/<token>/ failed"
        );
    }

    #[test]
    fn retries_transient_metadata_errors_three_times() {
        let mut calls = 0;
        let result = retry_operation(
            3,
            || {
                calls += 1;
                (calls == 3)
                    .then_some("ok")
                    .ok_or_else(|| "请求 Eh API 失败: timeout".to_string())
            },
            |_| {},
        );
        assert_eq!(result.unwrap(), "ok");
        assert_eq!(calls, 3);
    }

    #[test]
    fn does_not_retry_permanent_metadata_errors() {
        let mut calls = 0;
        let result = retry_operation::<(), _, _>(
            3,
            || {
                calls += 1;
                Err("Eh API: Key missing, or incorrect key provided.".to_string())
            },
            |_| {},
        );
        assert!(result.is_err());
        assert_eq!(calls, 1);
    }

    #[test]
    #[ignore = "explicit network smoke test; writes only to EH_DOWNLOAD_TEST_ROOT"]
    fn downloads_six_pages_with_the_parallel_worker() {
        let gid = std::env::var("EH_DOWNLOAD_TEST_GID")
            .expect("EH_DOWNLOAD_TEST_GID is required")
            .parse::<i64>()
            .expect("EH_DOWNLOAD_TEST_GID must be numeric");
        let token =
            std::env::var("EH_DOWNLOAD_TEST_TOKEN").expect("EH_DOWNLOAD_TEST_TOKEN is required");
        let root = PathBuf::from(
            std::env::var("EH_DOWNLOAD_TEST_ROOT").expect("EH_DOWNLOAD_TEST_ROOT is required"),
        );
        assert!(root.is_absolute(), "test root must be absolute");
        fs::create_dir_all(&root).unwrap();
        let settings = EhSettings {
            root_path: root.to_string_lossy().to_string(),
            ipb_member_id: std::env::var("EH_DOWNLOAD_TEST_MEMBER_ID").unwrap_or_default(),
            ipb_pass_hash: std::env::var("EH_DOWNLOAD_TEST_PASS_HASH").unwrap_or_default(),
            igneous: std::env::var("EH_DOWNLOAD_TEST_IGNEOUS").unwrap_or_default(),
        };
        let client = make_client().unwrap();
        let gallery = fetch_gallery_with_retry(gid, &token, &settings).unwrap();
        let total_pages = usize::try_from(gallery.pages).unwrap();
        let mut resolver = PageUrlResolver::new(&client, &settings, gid, &token, total_pages);
        let jobs = (1..=6)
            .map(|page| {
                let url = resolver.resolve_page(page).unwrap().unwrap();
                (page - 1, page, url)
            })
            .collect();
        let outcomes = download_jobs(&client, &settings, &root, jobs);
        assert_eq!(outcomes.len(), 6);
        for (_, page, result) in outcomes {
            assert!(result.is_ok(), "page {page} failed: {:?}", result.err());
        }
    }
}
