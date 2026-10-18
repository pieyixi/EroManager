use crate::eh::metadata::atomic_write;
use crate::eh::models::{EhGallerySummary, EhMeta};
use rusqlite::OptionalExtension;
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

fn sanitize_component(value: &str) -> String {
    let mut output = String::with_capacity(value.len().min(120));
    for character in value.chars() {
        if character.is_control()
            || matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            )
        {
            output.push('_');
        } else {
            output.push(character);
        }
        if output.chars().count() >= 120 {
            break;
        }
    }
    let trimmed = output.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "gallery".to_string()
    } else {
        trimmed.to_string()
    }
}
pub(super) fn make_folder_name(gid: i64, title: &str) -> String {
    format!("{}-{}", gid, sanitize_component(title))
}

pub(super) fn existing_page(folder: &Path, page: usize) -> Option<PathBuf> {
    ["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif"]
        .iter()
        .map(|extension| folder.join(format!("page_{page:04}.{extension}")))
        .find(|path| path.is_file())
}

pub(super) fn requested_pages(
    input: Option<Vec<usize>>,
    total: usize,
) -> Result<Vec<usize>, String> {
    let pages = input.unwrap_or_else(|| (1..=total).collect());
    if pages.is_empty() {
        return Err("没有要下载的页面".to_string());
    }
    if pages.iter().any(|page| *page == 0 || *page > total) {
        return Err(format!("页面编号必须在 1 到 {} 之间", total));
    }
    Ok(pages
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect())
}

fn existing_target(
    connection: &rusqlite::Connection,
    gid: i64,
    root: &Path,
) -> Result<Option<PathBuf>, String> {
    let stored = connection
        .query_row(
            "SELECT FolderPath FROM EhGalleries WHERE Gid=?1",
            [gid],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(stored) = stored else {
        return Ok(None);
    };
    let path = PathBuf::from(stored);
    if !path.exists() {
        return Ok(None);
    }
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("无法解析已有作品目录: {error}"))?;
    if canonical == root || !canonical.starts_with(root) {
        return Err("已有作品目录不在当前 本子库根目录内，已拒绝下载".to_string());
    }
    Ok(Some(canonical))
}

pub(super) fn prepare_target(
    connection: &rusqlite::Connection,
    root: &Path,
    gid: i64,
    title: &str,
    token: &str,
) -> Result<PathBuf, String> {
    if let Some(path) = existing_target(connection, gid, root)? {
        return Ok(path);
    }
    let folder = root.join(make_folder_name(gid, title));
    if folder.exists() {
        if !folder.is_dir() {
            return Err("目标作品路径已存在且不是文件夹".to_string());
        }
        if source_marker_matches(&folder, gid, token) {
            return Ok(folder);
        }
        if fs::read_dir(&folder)
            .map_err(|error| format!("读取目标作品目录失败: {error}"))?
            .next()
            .is_some()
        {
            return Err(format!(
                "目标作品目录已存在且未被当前 Eh 索引接管: {}",
                folder.display()
            ));
        }
    } else {
        fs::create_dir(&folder).map_err(|error| format!("建立作品目录失败: {error}"))?;
    }
    Ok(folder)
}

pub(super) fn write_source_marker(folder: &Path, gid: i64, token: &str) -> Result<(), String> {
    let marker = folder.join(".ehviewer");
    if marker.exists() {
        return Ok(());
    }
    atomic_write(&marker, format!("VERSION 1\n\n{gid}\n{token}\n").as_bytes())
}

pub(super) fn source_marker_matches(folder: &Path, gid: i64, token: &str) -> bool {
    let Ok(contents) = fs::read_to_string(folder.join(".ehviewer")) else {
        return false;
    };
    let gid_line = gid.to_string();
    let mut lines = contents.lines();
    lines.next() == Some("VERSION 1")
        && lines.next() == Some("")
        && lines.next() == Some(gid_line.as_str())
        && lines.next() == Some(token)
}

pub(super) fn write_meta(folder: &Path, gallery: &EhGallerySummary) -> Result<PathBuf, String> {
    let data_dir = folder.join("data");
    fs::create_dir_all(&data_dir).map_err(|error| format!("建立 data 失败: {error}"))?;
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
    let path = data_dir.join("meta.json");
    let bytes = serde_json::to_vec_pretty(&meta).map_err(|error| error.to_string())?;
    atomic_write(&path, &bytes)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sanitizes_names_and_page_ranges() {
        assert_eq!(make_folder_name(123, "../bad:<name>"), "123-_bad__name_");
        assert_eq!(requested_pages(Some(vec![3, 1, 3]), 4).unwrap(), vec![1, 3]);
        assert!(requested_pages(Some(vec![0]), 4).is_err());
    }
    #[test]
    fn recognizes_only_a_matching_owned_folder() {
        let temp = std::env::temp_dir().join(format!("ero-manager-marker-{}", std::process::id()));
        std::fs::create_dir_all(&temp).unwrap();
        std::fs::write(temp.join(".ehviewer"), "VERSION 1\n\n123\nabc-token\n").unwrap();
        assert!(source_marker_matches(&temp, 123, "abc-token"));
        assert!(!source_marker_matches(&temp, 123, "other"));
        std::fs::remove_dir_all(temp).unwrap();
    }
}
