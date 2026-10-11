//! Archive inspection and completeness checks.
use crate::library::archive_cover::{find_existing_cover, has_any_image};
use crate::library::inspection::folder_video_stats;
use crate::library::models::{
    collect_numbered_video_paths, ArchiveDraft, ArchiveEpisodeDraft, ArchiveEpisodeTags,
    UnarchivedFolder,
};

pub(crate) fn value_non_empty_string(v: Option<&serde_json::Value>) -> bool {
    v.and_then(|v| v.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
}

pub(crate) fn value_non_empty_array(v: Option<&serde_json::Value>) -> bool {
    v.and_then(|v| v.as_array())
        .map(|a| !a.is_empty())
        .unwrap_or(false)
}

fn value_string_vec(v: Option<&serde_json::Value>) -> Vec<String> {
    v.and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn archive_missing_reasons(dir_path: &str) -> Vec<String> {
    let path = std::path::Path::new(dir_path);
    let data_dir = path.join("data");
    let meta_path = data_dir.join("meta.json");
    let mut reasons = Vec::new();

    if !data_dir.exists() {
        reasons.push("缺少 data 文件夹".to_string());
    }
    if let Err(err) = collect_numbered_video_paths(path) {
        reasons.push(err);
    }
    if !meta_path.exists() {
        reasons.push("缺少 data/meta.json".to_string());
        if !has_any_image(&data_dir, "cover") {
            reasons.push("缺少主封面".to_string());
        }
        let video_count = match folder_video_stats(dir_path) {
            Ok((count, _)) => count,
            Err(error) => {
                reasons.push(error);
                0
            }
        };
        for i in 1..=video_count {
            if !has_any_image(&data_dir, &format!("cover_ep{}", i)) {
                reasons.push(format!("缺少第{}集封面", i));
            }
        }
        return reasons;
    }

    let content = match std::fs::read_to_string(&meta_path) {
        Ok(content) => content,
        Err(_) => {
            reasons.push("meta.json 无法读取".to_string());
            return reasons;
        }
    };
    let json: serde_json::Value = match serde_json::from_str(&content) {
        Ok(json) => json,
        Err(_) => {
            reasons.push("meta.json 格式错误".to_string());
            return reasons;
        }
    };

    if !value_non_empty_string(json.get("title")) {
        reasons.push("缺少标题".to_string());
    }
    if !value_non_empty_string(json.get("studio")) {
        reasons.push("缺少制作商".to_string());
    }
    if !value_non_empty_string(json.get("synopsis")) {
        reasons.push("缺少简介".to_string());
    }
    let characters_complete = json
        .get("characters")
        .and_then(|v| v.as_object())
        .map(|m| {
            !m.is_empty()
                && m.values()
                    .any(|v| v.as_str().map(|s| !s.trim().is_empty()).unwrap_or(false))
        })
        .unwrap_or(false);
    if !characters_complete {
        reasons.push("缺少女主/角色".to_string());
    }
    if !has_any_image(&data_dir, "cover") {
        reasons.push("缺少主封面".to_string());
    }

    let video_count = match folder_video_stats(dir_path) {
        Ok((count, _)) => count,
        Err(error) => {
            reasons.push(error);
            0
        }
    };
    let episodes = json.get("episode_list").and_then(|v| v.as_array());
    if episodes.map(|e| e.len()).unwrap_or(0) != video_count as usize {
        reasons.push("集数列表与视频数量不一致".to_string());
    }
    for i in 1..=video_count {
        if !has_any_image(&data_dir, &format!("cover_ep{}", i)) {
            reasons.push(format!("缺少第{}集封面", i));
        }
    }
    if let Some(episodes) = episodes {
        for (idx, ep) in episodes.iter().enumerate() {
            let n = idx + 1;
            if !value_non_empty_string(ep.get("release_date")) {
                reasons.push(format!("第{}集缺少发售时间", n));
            }
            let tags = ep.get("tags");
            let has_tags = value_non_empty_array(tags.and_then(|t| t.get("theme")))
                || value_non_empty_array(tags.and_then(|t| t.get("attribute")))
                || value_non_empty_array(tags.and_then(|t| t.get("scene")));
            if !has_tags {
                reasons.push(format!("第{}集缺少 Tag", n));
            }
        }
    }

    reasons
}

#[tauri::command]
pub fn list_unarchived_folders(root_path: String) -> Result<Vec<UnarchivedFolder>, String> {
    let root = std::path::Path::new(&root_path);
    if !root.exists() {
        return Err("路径不存在".to_string());
    }
    let mut result = Vec::new();
    let entries = std::fs::read_dir(root)
        .map_err(|error| format!("读取媒体库目录失败 {}: {error}", root.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取媒体库目录项失败: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let folder_path = path.to_string_lossy().to_string();
        let title = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_string();
        let (video_count, _) = folder_video_stats(&folder_path)?;
        if video_count <= 0 {
            continue;
        }
        let data_dir = path.join("data");
        let meta_json = data_dir.join("meta.json");
        let missing_reasons = archive_missing_reasons(&folder_path);
        if !missing_reasons.is_empty() {
            result.push(UnarchivedFolder {
                title,
                folder_path,
                video_count,
                has_data_dir: data_dir.exists(),
                has_meta_json: meta_json.exists(),
                missing_reasons,
            });
        }
    }
    result.sort_by(|left, right| left.title.cmp(&right.title));
    Ok(result)
}

fn make_archive_draft(dir_path: &str) -> Result<ArchiveDraft, String> {
    let path = std::path::Path::new(dir_path);
    if !path.is_dir() {
        return Err("不是目录".to_string());
    }
    let dir_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    let data_dir = path.join("data");

    let videos = collect_numbered_video_paths(path)?;

    let mut episode_list = videos
        .iter()
        .enumerate()
        .map(|(i, video)| {
            let id = (i + 1) as i32;
            ArchiveEpisodeDraft {
                id,
                subtitle: String::new(),
                release_date: String::new(),
                video_path: video.to_string_lossy().to_string(),
                cover_path: find_existing_cover(&data_dir, &format!("cover_ep{}", id)),
                tags: ArchiveEpisodeTags::default(),
            }
        })
        .collect::<Vec<_>>();

    let mut title = dir_name.clone();
    let mut search_aliases = Vec::new();
    let mut studio = String::new();
    let mut synopsis = String::new();
    let mut characters = std::collections::HashMap::new();

    let meta_path = data_dir.join("meta.json");
    if let Ok(content) = std::fs::read_to_string(&meta_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if title == dir_name {
                if let Some(value) = json
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                {
                    title = value.to_string();
                }
            }
            if let Some(value) = json.get("studio").and_then(|v| v.as_str()) {
                studio = value.to_string();
            }
            search_aliases = value_string_vec(json.get("search_aliases"));
            if let Some(value) = json.get("synopsis").and_then(|v| v.as_str()) {
                synopsis = value.to_string();
            }
            if let Some(map) = json.get("characters").and_then(|v| v.as_object()) {
                for (key, value) in map {
                    if let Some(name) = value.as_str().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                        characters.insert(key.clone(), name.to_string());
                    }
                }
            }
            if let Some(existing_episodes) = json.get("episode_list").and_then(|v| v.as_array()) {
                for (idx, existing) in existing_episodes.iter().enumerate() {
                    let existing_id = existing
                        .get("id")
                        .and_then(|v| v.as_i64())
                        .map(|v| v as i32)
                        .unwrap_or((idx + 1) as i32);
                    if let Some(ep) = episode_list.iter_mut().find(|ep| ep.id == existing_id) {
                        if let Some(value) = existing.get("subtitle").and_then(|v| v.as_str()) {
                            ep.subtitle = value.to_string();
                        }
                        if let Some(value) = existing.get("release_date").and_then(|v| v.as_str()) {
                            ep.release_date = value.to_string();
                        }
                        let tags = existing.get("tags");
                        ep.tags = ArchiveEpisodeTags {
                            theme: value_string_vec(tags.and_then(|t| t.get("theme"))),
                            attribute: value_string_vec(tags.and_then(|t| t.get("attribute"))),
                            scene: value_string_vec(tags.and_then(|t| t.get("scene"))),
                        };
                    }
                }
            }
        }
    }

    Ok(ArchiveDraft {
        dir_path: dir_path.to_string(),
        title,
        search_aliases,
        episodes: episode_list.len() as i32,
        studio,
        synopsis,
        characters,
        episode_list,
        cover_path: find_existing_cover(&data_dir, "cover"),
        getchu_url: String::new(),
        hanime_url: String::new(),
    })
}

#[tauri::command]
pub fn inspect_archive_folder(dir_path: String) -> Result<ArchiveDraft, String> {
    make_archive_draft(&dir_path)
}

fn ensure_archive_data_dir_path(path: &std::path::Path) -> Result<std::path::PathBuf, String> {
    if !path.is_dir() {
        return Err("作品目录不存在或不是文件夹".to_string());
    }
    let data_dir = path.join("data");
    if data_dir.exists() {
        if data_dir.is_dir() {
            return Ok(data_dir);
        }
        return Err("data 已存在，但不是文件夹".to_string());
    }
    match std::fs::create_dir(&data_dir) {
        Ok(()) => Ok(data_dir),
        Err(_) if data_dir.is_dir() => Ok(data_dir),
        Err(err) => Err(format!("创建 data 文件夹失败: {}", err)),
    }
}

#[tauri::command]
pub fn ensure_archive_data_dir(dir_path: String) -> Result<String, String> {
    ensure_archive_data_dir_path(std::path::Path::new(&dir_path))
        .map(|path| path.to_string_lossy().to_string())
}

#[cfg(test)]
mod archive_data_dir_tests {
    use super::ensure_archive_data_dir_path;

    #[test]
    fn creates_data_once_without_touching_existing_files() {
        let root = std::env::temp_dir().join(format!(
            "hanime-manager-data-dir-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();

        let data_dir = ensure_archive_data_dir_path(&root).unwrap();
        let marker = data_dir.join("keep.txt");
        std::fs::write(&marker, "keep").unwrap();
        let second = ensure_archive_data_dir_path(&root).unwrap();

        assert_eq!(data_dir, second);
        assert_eq!(std::fs::read_to_string(marker).unwrap(), "keep");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_a_data_file_without_replacing_it() {
        let root = std::env::temp_dir().join(format!(
            "hanime-manager-data-file-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        let data_file = root.join("data");
        std::fs::write(&data_file, "keep").unwrap();

        assert!(ensure_archive_data_dir_path(&root).is_err());
        assert_eq!(std::fs::read_to_string(data_file).unwrap(), "keep");
        std::fs::remove_dir_all(root).unwrap();
    }
}
