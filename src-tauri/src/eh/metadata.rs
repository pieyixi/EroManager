//! EhViewer/GData metadata parsing, translation and cover materialization.
use crate::eh::models::*;
use crate::eh::reader::is_page_image;
use serde::Deserialize;
use std::collections::{BTreeSet, HashMap};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;
#[derive(Debug, Deserialize)]
struct EhTagTranslations {
    artist: HashMap<String, String>,
    group: HashMap<String, String>,
    female: HashMap<String, String>,
}

fn tag_translations() -> &'static EhTagTranslations {
    static TRANSLATIONS: OnceLock<EhTagTranslations> = OnceLock::new();
    TRANSLATIONS.get_or_init(|| {
        serde_json::from_str(include_str!("../../resources/eh-tag-translations.json"))
            .expect("embedded Eh tag translations must be valid JSON")
    })
}

fn translated_values(values: &[String], translations: &HashMap<String, String>) -> Vec<String> {
    values
        .iter()
        .map(|value| {
            translations
                .get(value)
                .or_else(|| translations.get(&value.to_ascii_lowercase()))
                .filter(|translated| !translated.trim().is_empty())
                .cloned()
                .unwrap_or_else(|| value.clone())
        })
        .collect()
}

pub(crate) fn localize_gallery(mut gallery: EhGallerySummary) -> EhGallerySummary {
    let translations = tag_translations();
    gallery.artist_display = translated_values(&gallery.artist, &translations.artist);
    gallery.group_display = translated_values(&gallery.group, &translations.group);
    gallery.tags_display = translated_values(&gallery.tags, &translations.female);
    gallery
}
pub(crate) fn parse_ehviewer(path: &Path) -> Result<(i64, String), String> {
    if !path.is_file() {
        return Err("缺少 .ehviewer".to_string());
    }
    let content = fs::read_to_string(path).map_err(|_| ".ehviewer 无法读取".to_string())?;
    let mut lines = content.lines();
    let version = lines.next().unwrap_or_default();
    if !version.starts_with("VERSION") {
        return Err(".ehviewer 版本头无效".to_string());
    }
    let _ = lines.next();
    let gid = lines
        .next()
        .ok_or_else(|| ".ehviewer 缺少 gid".to_string())?
        .trim()
        .parse::<i64>()
        .map_err(|_| ".ehviewer gid 无效".to_string())?;
    let token = lines.next().unwrap_or_default().trim().to_string();
    if token.is_empty() {
        return Err(".ehviewer 缺少 token".to_string());
    }
    Ok((gid, token))
}

pub(crate) fn category_number(category: &str) -> i64 {
    match category.to_ascii_lowercase().as_str() {
        "misc" => 1,
        "doujinshi" => 2,
        "manga" => 4,
        "artist cg" => 8,
        "game cg" => 16,
        "image set" => 32,
        "cosplay" => 64,
        "asian porn" => 128,
        "non-h" => 256,
        "western" => 512,
        _ => 0,
    }
}

pub(crate) fn category_label(category: i64) -> &'static str {
    match category {
        1 => "Misc",
        2 => "Doujinshi",
        4 => "Manga",
        8 => "Artist CG",
        16 => "Game CG",
        32 => "Image Set",
        64 => "Cosplay",
        128 => "Asian Porn",
        256 => "Non-H",
        512 => "Western",
        _ => "Other",
    }
}

pub(crate) fn directory_size(root: &Path) -> u64 {
    let mut total = 0_u64;
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                pending.push(entry.path());
            } else if file_type.is_file() {
                total =
                    total.saturating_add(entry.metadata().map(|value| value.len()).unwrap_or(0));
            }
        }
    }
    total
}

fn split_metadata_tags(tags: &[String]) -> (Vec<String>, Vec<String>, Vec<String>) {
    let mut artists = BTreeSet::new();
    let mut groups = BTreeSet::new();
    let mut remaining = BTreeSet::new();
    for raw in tags {
        let (namespace, value) = raw.split_once(':').unwrap_or(("", raw.as_str()));
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        match namespace {
            "artist" => {
                artists.insert(value.to_string());
            }
            "group" => {
                groups.insert(value.to_string());
            }
            "language" | "reclass" => {}
            _ => {
                remaining.insert(value.to_string());
            }
        }
    }
    (
        artists.into_iter().collect(),
        groups.into_iter().collect(),
        remaining.into_iter().collect(),
    )
}

pub(crate) fn clean_display_title(value: &str) -> String {
    let mut title = value.trim().to_string();
    loop {
        let trimmed = title.trim_start();
        let closing = match trimmed.chars().next() {
            Some('[') => trimmed.find(']').map(|index| (index, ']')),
            Some('(') => trimmed.find(')').map(|index| (index, ')')),
            Some('【') => trimmed.find('】').map(|index| (index, '】')),
            _ => None,
        };
        let Some((index, delimiter)) = closing else {
            break;
        };
        title = trimmed[index + delimiter.len_utf8()..]
            .trim_start()
            .to_string();
    }
    loop {
        let trimmed = title.trim_end();
        let opening = if trimmed.ends_with(']') {
            trimmed.rfind('[')
        } else if trimmed.ends_with(')') {
            trimmed.rfind('(')
        } else if trimmed.ends_with('】') {
            trimmed.rfind('【')
        } else {
            None
        };
        let Some(index) = opening else { break };
        title = trimmed[..index].trim_end().to_string();
    }
    for suffix in ["＋ペーパー", "+ペーパー", "+ Paper", "+ paper"] {
        if title.ends_with(suffix) {
            title.truncate(title.len() - suffix.len());
            title = title.trim_end().to_string();
        }
    }
    if title.is_empty() {
        value.trim().to_string()
    } else {
        title
    }
}

pub(crate) fn fetch_gallery(
    gid: i64,
    token: &str,
    settings: &EhSettings,
) -> Result<EhGallerySummary, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("Mozilla/5.0 HainimeManager/3")
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let cookie = format!(
        "ipb_member_id={}; ipb_pass_hash={}; igneous={}",
        settings.ipb_member_id.trim(),
        settings.ipb_pass_hash.trim(),
        settings.igneous.trim()
    );
    let body = serde_json::json!({
        "method": "gdata",
        "gidlist": [[gid, token]],
        "namespace": 1
    });
    let mut request = client.post("https://api.e-hentai.org/api.php").json(&body);
    if !settings.ipb_member_id.trim().is_empty() {
        request = request.header(reqwest::header::COOKIE, cookie);
    }
    let response = request
        .send()
        .map_err(|error| format!("请求 Eh API 失败: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Eh API 返回 HTTP {}", response.status()));
    }
    let payload: GDataResponse = response
        .json()
        .map_err(|error| format!("解析 Eh API 响应失败: {error}"))?;
    let gallery = payload
        .gmetadata
        .into_iter()
        .next()
        .ok_or_else(|| "Eh API 未返回作品".to_string())?;
    if !gallery.error.is_empty() {
        return Err(format!("Eh API: {}", gallery.error));
    }
    let (artist, group, tags) = split_metadata_tags(&gallery.tags);
    Ok(EhGallerySummary {
        gid: gallery.gid,
        token: gallery.token,
        source: "eh".to_string(),
        source_id: gallery.gid.to_string(),
        language: String::new(),
        title: clean_display_title(if gallery.title_jpn.trim().is_empty() {
            &gallery.title
        } else {
            &gallery.title_jpn
        }),
        category: category_number(&gallery.category),
        artist,
        group,
        tags,
        artist_display: Vec::new(),
        group_display: Vec::new(),
        tags_display: Vec::new(),
        pages: gallery.filecount.parse().unwrap_or(0),
        posted: gallery.posted,
        added_at: String::new(),
        cover_path: String::new(),
        folder_path: String::new(),
    })
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("tmp");
    let partial = path.with_extension(format!(
        "{extension}.partial-{}-{sequence}",
        std::process::id()
    ));

    let write_result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        replace_file(&partial, path)
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&partial);
        return Err(format!("保存 {} 失败: {error}", path.display()));
    }
    Ok(())
}

#[cfg(windows)]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}
pub(crate) fn read_meta(path: &Path, folder: &Path) -> Result<EhGallerySummary, String> {
    let bytes = fs::read(path).map_err(|error| format!("读取 meta.json 失败: {error}"))?;
    let source = serde_json::from_slice::<serde_json::Value>(&bytes)
        .map_err(|error| format!("meta.json 格式错误: {error}"))?;
    if source.get("source").and_then(|value| value.as_str()) == Some("hitomi") {
        let meta: crate::eh::hitomi::HitomiMeta = serde_json::from_slice(&bytes)
            .map_err(|error| format!("Hitomi meta.json 格式错误: {error}"))?;
        let cover = find_cover(&folder.join("data")).unwrap_or_default();
        return meta.into_summary(folder, &cover);
    }
    if source
        .get("source")
        .and_then(|value| value.as_str())
        .is_some_and(|value| value != "eh")
    {
        return Err("meta.json 来源不受支持".to_string());
    }
    let meta: EhMeta =
        serde_json::from_slice(&bytes).map_err(|error| format!("meta.json 格式错误: {error}"))?;
    let cover = find_cover(&folder.join("data")).unwrap_or_default();
    Ok(meta.into_summary(folder, &cover))
}

pub(crate) fn find_cover(data_dir: &Path) -> Option<PathBuf> {
    ["cover.webp", "cover.jpg", "cover.jpeg", "cover.png"]
        .iter()
        .map(|name| data_dir.join(name))
        .find(|path| path.is_file())
}

pub(crate) fn create_cover_from_available_source(
    folder: &Path,
    data_dir: &Path,
) -> Result<(), String> {
    let thumb = folder.join(".thumb");
    let (source, extension) = if thumb.is_file() {
        (thumb, "webp".to_string())
    } else {
        let mut pages: Vec<PathBuf> = fs::read_dir(folder)
            .map_err(|error| format!("读取作品图片失败: {error}"))?
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_file() && is_page_image(path))
            .collect();
        pages.sort_by(|left, right| {
            left.file_name()
                .cmp(&right.file_name())
                .then_with(|| left.cmp(right))
        });
        let source = pages
            .into_iter()
            .next()
            .ok_or_else(|| "缺少 .thumb 且目录内没有可用图片，无法建立封面".to_string())?;
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("jpg")
            .to_ascii_lowercase();
        (source, extension)
    };
    let bytes = fs::read(&source).map_err(|error| format!("读取封面来源失败: {error}"))?;
    fs::create_dir_all(data_dir).map_err(|error| format!("建立 data 失败: {error}"))?;
    atomic_write(&data_dir.join(format!("cover.{extension}")), &bytes)
}

#[cfg(test)]
mod atomic_write_tests {
    use super::atomic_write;

    #[test]
    fn atomically_replaces_an_existing_file_without_partial_artifacts() {
        let root = std::env::temp_dir().join(format!(
            "hanime-manager-atomic-write-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let target = root.join("meta.json");
        atomic_write(&target, b"first").unwrap();
        atomic_write(&target, b"second").unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"second");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }
}
