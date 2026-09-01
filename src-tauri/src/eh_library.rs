use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::Emitter;

const EH_DATABASE_FILE: &str = "eh-database.db";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EhSettings {
    pub root_path: String,
    pub ipb_member_id: String,
    pub ipb_pass_hash: String,
    pub igneous: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEhSettingsInput {
    pub root_path: String,
    pub ipb_member_id: String,
    pub ipb_pass_hash: String,
    pub igneous: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EhGallerySummary {
    pub gid: i64,
    pub token: String,
    pub title: String,
    pub category: i64,
    pub artist: Vec<String>,
    pub group: Vec<String>,
    pub tags: Vec<String>,
    #[serde(default)]
    pub artist_display: Vec<String>,
    #[serde(default)]
    pub group_display: Vec<String>,
    #[serde(default)]
    pub tags_display: Vec<String>,
    pub pages: i64,
    pub posted: String,
    pub cover_path: String,
    pub folder_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EhMeta {
    gid: i64,
    token: String,
    title: String,
    category: i64,
    #[serde(default)]
    artist: Vec<String>,
    #[serde(default)]
    group: Vec<String>,
    #[serde(default)]
    tags: Vec<String>,
    pages: i64,
    #[serde(default)]
    posted: String,
}

impl EhMeta {
    fn into_summary(self, folder: &Path, cover: &Path) -> EhGallerySummary {
        EhGallerySummary {
            gid: self.gid,
            token: self.token,
            title: self.title,
            category: self.category,
            artist: self.artist,
            group: self.group,
            tags: self.tags,
            artist_display: Vec::new(),
            group_display: Vec::new(),
            tags_display: Vec::new(),
            pages: self.pages,
            posted: self.posted,
            cover_path: cover.to_string_lossy().to_string(),
            folder_path: folder.to_string_lossy().to_string(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct EhTagTranslations {
    artist: HashMap<String, String>,
    group: HashMap<String, String>,
    female: HashMap<String, String>,
}

fn tag_translations() -> &'static EhTagTranslations {
    static TRANSLATIONS: OnceLock<EhTagTranslations> = OnceLock::new();
    TRANSLATIONS.get_or_init(|| {
        serde_json::from_str(include_str!("../resources/eh-tag-translations.json"))
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

fn localize_gallery(mut gallery: EhGallerySummary) -> EhGallerySummary {
    let translations = tag_translations();
    gallery.artist_display = translated_values(&gallery.artist, &translations.artist);
    gallery.group_display = translated_values(&gallery.group, &translations.group);
    gallery.tags_display = translated_values(&gallery.tags, &translations.female);
    gallery
}

#[derive(Debug, Serialize)]
pub struct EhLibraryOverview {
    pub root_path: String,
    pub database_path: String,
    pub total_count: i64,
    pub total_pages: i64,
}

#[derive(Debug, Serialize)]
pub struct EhCategoryMetric {
    pub category: i64,
    pub label: &'static str,
    pub count: i64,
    pub bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct EhLibraryDashboard {
    pub total_count: i64,
    pub total_pages: i64,
    pub total_bytes: u64,
    pub categories: Vec<EhCategoryMetric>,
}

#[derive(Debug, Serialize)]
pub struct EhScanResult {
    pub folders: usize,
    pub indexed: usize,
    pub created_meta: usize,
    pub created_cover: usize,
    pub removed_records: usize,
    pub skipped: usize,
    pub errors: Vec<EhScanIssue>,
}

#[derive(Debug, Serialize)]
pub struct EhScanIssue {
    pub title: String,
    pub folder_path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
struct EhScanProgress {
    percent: usize,
    text: String,
}

fn portable_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    value.strip_prefix(r"\\?\").unwrap_or(&value).to_string()
}

#[derive(Debug, Serialize)]
pub struct EhReaderPageInfo {
    pub index: usize,
    pub path: String,
    pub width: usize,
    pub height: usize,
}

#[derive(Debug, Deserialize)]
struct GDataResponse {
    #[serde(default)]
    gmetadata: Vec<GDataGallery>,
}

#[derive(Debug, Deserialize)]
struct GDataGallery {
    gid: i64,
    token: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    title_jpn: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    posted: String,
    #[serde(default)]
    filecount: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    error: String,
}

fn eh_db_path() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
        .join(EH_DATABASE_FILE)
}

fn open_eh_db() -> Result<Connection, String> {
    let path = eh_db_path();
    let connection = Connection::open(&path)
        .map_err(|error| format!("无法打开 Eh 数据库 {}: {error}", path.display()))?;
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
               UpdatedAt TEXT NOT NULL DEFAULT (datetime('now','localtime'))
             );",
        )
        .map_err(|error| error.to_string())?;
    Ok(connection)
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

fn write_eh_setting(connection: &Connection, key: &str, value: &str) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO EhSettings(Key,Value) VALUES(?1,?2)
             ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value",
            params![key, value],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn read_eh_settings(connection: &Connection) -> Result<EhSettings, String> {
    Ok(EhSettings {
        root_path: setting(connection, "root_path")?,
        ipb_member_id: setting(connection, "ipb_member_id")?,
        ipb_pass_hash: setting(connection, "ipb_pass_hash")?,
        igneous: setting(connection, "igneous")?,
    })
}

fn validate_root(root_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(root_path.trim());
    if root_path.trim().is_empty() {
        return Err("Eh 库目录不能为空".to_string());
    }
    if !root.is_dir() {
        return Err(format!("Eh 库目录不存在: {}", root.display()));
    }
    fs::canonicalize(&root).map_err(|error| format!("无法读取 Eh 库目录: {error}"))
}

fn parse_ehviewer(path: &Path) -> Result<(i64, String), String> {
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

fn category_number(category: &str) -> i64 {
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

fn category_label(category: i64) -> &'static str {
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

fn directory_size(root: &Path) -> u64 {
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

fn clean_display_title(value: &str) -> String {
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

fn fetch_gallery(gid: i64, token: &str, settings: &EhSettings) -> Result<EhGallerySummary, String> {
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
        cover_path: String::new(),
        folder_path: String::new(),
    })
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let partial = path.with_extension(format!(
        "{}.partial",
        path.extension().and_then(|v| v.to_str()).unwrap_or("tmp")
    ));
    fs::write(&partial, bytes)
        .map_err(|error| format!("写入 {} 失败: {error}", partial.display()))?;
    fs::rename(&partial, path).map_err(|error| {
        let _ = fs::remove_file(&partial);
        format!("保存 {} 失败: {error}", path.display())
    })
}

fn read_meta(path: &Path, folder: &Path) -> Result<EhGallerySummary, String> {
    let bytes = fs::read(path).map_err(|error| format!("读取 meta.json 失败: {error}"))?;
    let meta: EhMeta =
        serde_json::from_slice(&bytes).map_err(|error| format!("meta.json 格式错误: {error}"))?;
    let cover = find_cover(&folder.join("data")).unwrap_or_default();
    Ok(meta.into_summary(folder, &cover))
}

fn find_cover(data_dir: &Path) -> Option<PathBuf> {
    ["cover.webp", "cover.jpg", "cover.jpeg", "cover.png"]
        .iter()
        .map(|name| data_dir.join(name))
        .find(|path| path.is_file())
}

fn create_cover_from_available_source(folder: &Path, data_dir: &Path) -> Result<(), String> {
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

fn upsert_gallery(connection: &Connection, gallery: &EhGallerySummary) -> Result<(), String> {
    connection.execute(
        "INSERT INTO EhGalleries(Gid,Token,Title,Category,ArtistJson,GroupJson,TagsJson,Pages,Posted,CoverPath,FolderPath,UpdatedAt)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,datetime('now','localtime'))
         ON CONFLICT(Gid) DO UPDATE SET Token=excluded.Token,Title=excluded.Title,Category=excluded.Category,
         ArtistJson=excluded.ArtistJson,GroupJson=excluded.GroupJson,TagsJson=excluded.TagsJson,Pages=excluded.Pages,
         Posted=excluded.Posted,CoverPath=excluded.CoverPath,FolderPath=excluded.FolderPath,UpdatedAt=excluded.UpdatedAt",
        params![gallery.gid, gallery.token, gallery.title, gallery.category,
            serde_json::to_string(&gallery.artist).map_err(|e| e.to_string())?,
            serde_json::to_string(&gallery.group).map_err(|e| e.to_string())?,
            serde_json::to_string(&gallery.tags).map_err(|e| e.to_string())?, gallery.pages, gallery.posted,
            gallery.cover_path, gallery.folder_path],
    ).map(|_| ()).map_err(|error| error.to_string())
}

fn scan_eh_library<F>(
    root: &Path,
    settings: &EhSettings,
    mut report_progress: F,
) -> Result<EhScanResult, String>
where
    F: FnMut(usize, usize, &str),
{
    let connection = open_eh_db()?;
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
        seen.insert(folder.to_string_lossy().to_string());
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
            Ok(gallery) => match upsert_gallery(&connection, &gallery) {
                Ok(()) => result.indexed += 1,
                Err(error) => result.errors.push(EhScanIssue {
                    title: label,
                    folder_path: portable_path(&folder),
                    reason: format!("数据库写入失败: {error}"),
                }),
            },
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
        if !seen.contains(&folder) {
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
            let percent = if total == 0 {
                100
            } else {
                completed.saturating_mul(100) / total
            };
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

#[tauri::command]
pub fn eh_get_library_overview() -> Result<EhLibraryOverview, String> {
    let connection = open_eh_db()?;
    let settings = read_eh_settings(&connection)?;
    let (total_count, total_pages) = connection
        .query_row(
            "SELECT COUNT(*),COALESCE(SUM(Pages),0) FROM EhGalleries",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    Ok(EhLibraryOverview {
        root_path: settings.root_path,
        database_path: eh_db_path().to_string_lossy().to_string(),
        total_count,
        total_pages,
    })
}

#[tauri::command]
pub async fn eh_get_library_dashboard() -> Result<EhLibraryDashboard, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let connection = open_eh_db()?;
        let (total_count, total_pages) = connection
            .query_row(
                "SELECT COUNT(*),COALESCE(SUM(Pages),0) FROM EhGalleries",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| error.to_string())?;
        let mut statement = connection
            .prepare("SELECT Category,FolderPath FROM EhGalleries ORDER BY Category")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| error.to_string())?;
        let mut grouped = std::collections::BTreeMap::<i64, (i64, u64)>::new();
        for row in rows {
            let (category, folder_path) = row.map_err(|error| error.to_string())?;
            let bytes = directory_size(Path::new(&folder_path));
            let metric = grouped.entry(category).or_default();
            metric.0 += 1;
            metric.1 = metric.1.saturating_add(bytes);
        }
        let categories = grouped
            .into_iter()
            .map(|(category, (count, bytes))| EhCategoryMetric {
                category,
                label: category_label(category),
                count,
                bytes,
            })
            .collect::<Vec<_>>();
        Ok(EhLibraryDashboard {
            total_count,
            total_pages,
            total_bytes: categories.iter().map(|item| item.bytes).sum(),
            categories,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn eh_list_local_galleries() -> Result<Vec<EhGallerySummary>, String> {
    let connection = open_eh_db()?;
    let mut statement = connection.prepare(
        "SELECT Gid,Token,Title,Category,ArtistJson,GroupJson,TagsJson,Pages,Posted,CoverPath,FolderPath FROM EhGalleries ORDER BY Posted DESC"
    ).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
            ))
        })
        .map_err(|error| error.to_string())?;
    Ok(rows
        .filter_map(Result::ok)
        .map(|v| {
            localize_gallery(EhGallerySummary {
                gid: v.0,
                token: v.1,
                title: v.2,
                category: v.3,
                artist: serde_json::from_str(&v.4).unwrap_or_default(),
                group: serde_json::from_str(&v.5).unwrap_or_default(),
                tags: serde_json::from_str(&v.6).unwrap_or_default(),
                artist_display: Vec::new(),
                group_display: Vec::new(),
                tags_display: Vec::new(),
                pages: v.7,
                posted: v.8,
                cover_path: v.9,
                folder_path: v.10,
            })
        })
        .collect())
}

fn gallery_folder(connection: &Connection, gid: i64) -> Result<PathBuf, String> {
    connection
        .query_row(
            "SELECT FolderPath FROM EhGalleries WHERE Gid=?1",
            [gid],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .map(PathBuf::from)
        .ok_or_else(|| format!("Eh 数据库中不存在 GID {gid}"))
}

#[tauri::command]
pub fn eh_delete_gallery_record(gid: i64) -> Result<(), String> {
    let connection = open_eh_db()?;
    let changed = connection
        .execute("DELETE FROM EhGalleries WHERE Gid=?1", [gid])
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err(format!("Eh 数据库中不存在 GID {gid}"));
    }
    Ok(())
}

#[tauri::command]
pub fn eh_delete_gallery_folder(gid: i64) -> Result<(), String> {
    let connection = open_eh_db()?;
    let settings = read_eh_settings(&connection)?;
    let root = validate_root(&settings.root_path)?
        .canonicalize()
        .map_err(|error| format!("无法解析 Eh 库目录：{error}"))?;
    let folder = gallery_folder(&connection, gid)?
        .canonicalize()
        .map_err(|error| format!("无法解析作品目录：{error}"))?;
    if folder == root || !folder.starts_with(&root) {
        return Err(format!(
            "拒绝删除 Eh 库范围外的目录：{}",
            folder.display()
        ));
    }
    fs::remove_dir_all(&folder)
        .map_err(|error| format!("删除作品目录失败：{error}"))?;
    connection
        .execute("DELETE FROM EhGalleries WHERE Gid=?1", [gid])
        .map_err(|error| format!("目录已删除，但移除数据库记录失败：{error}"))?;
    Ok(())
}

fn is_page_image(path: &Path) -> bool {
    path.extension()
        .and_then(|v| v.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "avif"
            )
        })
        .unwrap_or(false)
}

#[tauri::command]
pub async fn eh_get_gallery_pages(gid: i64) -> Result<Vec<EhReaderPageInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let connection = open_eh_db()?;
        let folder: String = connection
            .query_row(
                "SELECT FolderPath FROM EhGalleries WHERE Gid=?1",
                [gid],
                |row| row.get(0),
            )
            .map_err(|_| format!("Eh 作品不存在: {gid}"))?;
        let mut paths: Vec<PathBuf> = fs::read_dir(&folder)
            .map_err(|error| error.to_string())?
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.is_file() && is_page_image(path))
            .collect();
        paths.sort_by(|left, right| left.file_name().cmp(&right.file_name()));
        Ok(paths
            .into_iter()
            .enumerate()
            .map(|(index, path)| EhReaderPageInfo {
                index,
                path: path.to_string_lossy().to_string(),
                width: 0,
                height: 0,
            })
            .collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod eh_library_tests {
    use super::*;

    #[test]
    fn localizes_supported_metadata_without_replacing_canonical_values() {
        let gallery = localize_gallery(EhGallerySummary {
            gid: 1,
            token: String::new(),
            title: String::new(),
            category: 2,
            artist: vec!["1-gou".to_string()],
            group: vec!["0846net".to_string()],
            tags: vec!["big breasts".to_string()],
            artist_display: Vec::new(),
            group_display: Vec::new(),
            tags_display: Vec::new(),
            pages: 1,
            posted: String::new(),
            cover_path: String::new(),
            folder_path: String::new(),
        });
        assert_eq!(gallery.artist, ["1-gou"]);
        assert_eq!(gallery.artist_display, ["1号"]);
        assert_eq!(gallery.group_display, ["オヤシロネット"]);
        assert_eq!(gallery.tags_display, ["巨乳"]);
    }

    #[test]
    fn parses_ehviewer_identity() {
        let root = std::env::temp_dir().join(format!("ehviewer-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let path = root.join(".ehviewer");
        fs::write(&path, "VERSION2\n00000000\n440955\n0b9113090f\n1\n2\n").unwrap();
        assert_eq!(
            parse_ehviewer(&path).unwrap(),
            (440955, "0b9113090f".to_string())
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cleans_gallery_credits_and_release_qualifiers() {
        assert_eq!(
            clean_display_title("(C89) [幸せ共和国 (幸せのかたち)] 幸せのかたち＋ペーパー"),
            "幸せのかたち"
        );
        assert_eq!(
            clean_display_title("[世徒ゆうき] レベルＣ (COMIC MUJIN 2011年5月号) [無修正]"),
            "レベルＣ"
        );
        assert_eq!(
            clean_display_title("[DOZA Village] 女神すぎるママ [DL版]"),
            "女神すぎるママ"
        );
    }

    #[test]
    fn removes_windows_extended_path_prefix_for_display_and_storage() {
        assert_eq!(portable_path(Path::new(r"\\?\D:\Ehentai")), r"D:\Ehentai");
        assert_eq!(
            portable_path(Path::new(r"\\?\UNC\server\library")),
            r"\\server\library"
        );
    }

    #[test]
    fn falls_back_to_the_first_page_when_thumb_is_missing() {
        let root = std::env::temp_dir().join(format!("eh-cover-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("002.png"), b"second").unwrap();
        fs::write(root.join("001.jpg"), b"first").unwrap();
        let data = root.join("data");
        create_cover_from_available_source(&root, &data).unwrap();
        assert_eq!(fs::read(data.join("cover.jpg")).unwrap(), b"first");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    #[ignore = "explicit integration test; writes only to EH_SCAN_TEST_ROOT"]
    fn scans_explicit_test_library() {
        let root = std::env::var("EH_SCAN_TEST_ROOT").expect("EH_SCAN_TEST_ROOT is required");
        let root = validate_root(&root).unwrap();
        let settings = EhSettings {
            root_path: root.to_string_lossy().to_string(),
            ..EhSettings::default()
        };
        let result = scan_eh_library(&root, &settings, |_, _, _| {}).unwrap();
        assert!(result.errors.is_empty(), "{:#?}", result.errors);
        assert_eq!(result.indexed, result.folders);
    }
}
