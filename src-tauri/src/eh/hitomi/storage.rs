//! Owned Hitomi directories, resumable pages, and on-disk validation.
use crate::eh::metadata::atomic_write;
use rusqlite::OptionalExtension;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

pub(super) fn parse_id(value: &str) -> Result<i64, String> {
    let id = value
        .parse::<i64>()
        .map_err(|_| "Hitomi ID 必须是正整数".to_string())?;
    if id <= 0 {
        return Err("Hitomi ID 必须是正整数".into());
    }
    Ok(id)
}

fn safe_name(title: &str) -> String {
    let value: String = title
        .chars()
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(90)
        .collect();
    let value = value.trim().trim_matches('.').trim();
    if value.is_empty() {
        "gallery".into()
    } else {
        value.into()
    }
}
pub(super) fn marker_matches(folder: &Path, id: i64) -> bool {
    fs::read_to_string(folder.join("data/hitomi-source.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .is_some_and(|value| {
            value["source"] == "hitomi"
                && value["source_id"]
                    .as_str()
                    .and_then(|v| v.parse::<i64>().ok())
                    == Some(id)
        })
}
pub(super) fn target(
    connection: &rusqlite::Connection,
    root: &Path,
    id: i64,
    title: &str,
) -> Result<PathBuf, String> {
    let occupied: Option<(String, String)> = connection
        .query_row(
            "SELECT Source,SourceId FROM EhGalleries WHERE Gid=?1",
            [-id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if occupied
        .as_ref()
        .is_some_and(|(source, source_id)| source != "hitomi" || source_id != &id.to_string())
    {
        return Err("本地作品标识已被其它来源占用，已拒绝覆盖".into());
    }
    let stored: Option<String> = connection
        .query_row(
            "SELECT FolderPath FROM EhGalleries WHERE Source='hitomi' AND SourceId=?1",
            [id.to_string()],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let prefix = format!("hitomi-{id}-");
    let mut candidates = Vec::new();
    if let Some(path) = stored {
        let path = PathBuf::from(path);
        if path.exists() && !marker_matches(&path, id) {
            return Err("已有 Hitomi 记录的目录缺少匹配来源标记，已拒绝覆盖".into());
        }
        candidates.push(path);
    }
    for entry in fs::read_dir(root).map_err(|e| e.to_string())?.flatten() {
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            if !marker_matches(&entry.path(), id) {
                return Err("发现同 ID 的无标记目录，已拒绝覆盖".into());
            }
            candidates.push(entry.path());
        }
    }
    let mut valid = Vec::new();
    for path in candidates {
        if !path.exists() || !marker_matches(&path, id) {
            continue;
        }
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        if path == root || !path.starts_with(root) {
            return Err("Hitomi 作品目录越界".into());
        }
        valid.push(path);
    }
    valid.sort();
    valid.dedup();
    if valid.len() > 1 {
        return Err("发现多个同 ID 的 Hitomi 目录，请手动处理".into());
    }
    if let Some(path) = valid.into_iter().next() {
        return Ok(path);
    }
    let path = root.join(format!("{prefix}{}", safe_name(title)));
    if path.exists() {
        return Err("同名目录已存在且不属于该 Hitomi 作品".into());
    }
    fs::create_dir(&path).map_err(|e| e.to_string())?;
    fs::create_dir(path.join("data")).map_err(|e| e.to_string())?;
    atomic_write(
        &path.join("data/hitomi-source.json"),
        format!("{{\"source\":\"hitomi\",\"source_id\":\"{id}\"}}").as_bytes(),
    )?;
    Ok(path)
}
pub(super) fn valid_page(path: &Path) -> bool {
    let Ok(mut file) = fs::File::open(path) else {
        return false;
    };
    let mut header = [0u8; 20];
    file.read_exact(&mut header).is_ok()
        && file
            .metadata()
            .is_ok_and(|metadata| valid_webp_size(&header, metadata.len()))
}
pub(super) fn valid_webp_size(header: &[u8], file_size: u64) -> bool {
    header.len() >= 20
        && &header[..4] == b"RIFF"
        && &header[8..12] == b"WEBP"
        && matches!(&header[12..16], b"VP8 " | b"VP8L" | b"VP8X")
        && u32::from_le_bytes(header[16..20].try_into().unwrap()) as u64 + 20 <= file_size
        && u32::from_le_bytes(header[4..8].try_into().unwrap()) as u64 + 8 == file_size
}
