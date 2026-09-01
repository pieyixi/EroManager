fn normalize_title_for_duplicate(title: &str) -> String {
    title
        .to_lowercase()
        .chars()
        .filter(|c| {
            !c.is_whitespace() && !matches!(c, '-' | '_' | '[' | ']' | '(' | ')' | '（' | '）')
        })
        .collect()
}

fn folder_video_stats(folder_path: &str) -> Result<(i32, u64), String> {
    let mut count = 0;
    let mut total = 0;
    let folder = std::path::Path::new(folder_path);
    if !folder.is_dir() {
        return Ok((0, 0));
    }
    let entries = std::fs::read_dir(folder)
        .map_err(|e| format!("读取目录失败 {}: {}", folder.display(), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败 {}: {}", folder.display(), e))?;
        let path = entry.path();
        if path.is_file() && is_video_file(&path) {
            count += 1;
            total += entry
                .metadata()
                .map_err(|e| format!("读取文件信息失败 {}: {}", path.display(), e))?
                .len();
        }
    }
    Ok((count, total))
}

fn duplicate_signature(title: &str, video_count: i32, total_size: u64) -> String {
    let normalized = normalize_title_for_duplicate(title);
    let size_bucket = if total_size > 0 {
        total_size / 1_048_576
    } else {
        0
    };
    format!("{}|{}|{}", normalized, video_count, size_bucket)
}

#[tauri::command]
fn detect_duplicates(
    root_path: String,
    db: State<Database>,
) -> Result<Vec<DuplicateGroup>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut buckets: std::collections::HashMap<String, Vec<DuplicateItem>> =
        std::collections::HashMap::new();

    let mut stmt = conn
        .prepare("SELECT Title, FolderPath FROM Works")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let row = row.map_err(|e| e.to_string())?;
        let (video_count, total_size) = folder_video_stats(&row.1)?;
        let signature = duplicate_signature(&row.0, video_count, total_size);
        buckets.entry(signature).or_default().push(DuplicateItem {
            title: row.0,
            folder_path: row.1,
            source: "数据库".to_string(),
            video_count,
            total_size,
        });
    }

    let root = std::path::Path::new(&root_path);
    if root.exists() {
        let entries = std::fs::read_dir(root)
            .map_err(|e| format!("读取媒体库目录失败 {}: {}", root.display(), e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("读取媒体库目录项失败: {}", e))?;
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
            if title.is_empty() {
                continue;
            }
            let (video_count, total_size) = folder_video_stats(&folder_path)?;
            if video_count <= 0 {
                continue;
            }
            let signature = duplicate_signature(&title, video_count, total_size);
            let list = buckets.entry(signature).or_default();
            if !list
                .iter()
                .any(|item| item.folder_path.eq_ignore_ascii_case(&folder_path))
            {
                list.push(DuplicateItem {
                    title,
                    folder_path,
                    source: "磁盘".to_string(),
                    video_count,
                    total_size,
                });
            }
        }
    }

    let mut groups: Vec<DuplicateGroup> = buckets
        .into_iter()
        .filter(|(_, items)| items.len() > 1)
        .map(|(signature, items)| DuplicateGroup { signature, items })
        .collect();
    groups.sort_by(|a, b| {
        b.items
            .len()
            .cmp(&a.items.len())
            .then_with(|| a.signature.cmp(&b.signature))
    });
    Ok(groups)
}

#[tauri::command]
fn list_unarchived_folders(root_path: String) -> Result<Vec<UnarchivedFolder>, String> {
    let root = std::path::Path::new(&root_path);
    if !root.exists() {
        return Err("路径不存在".to_string());
    }
    let mut result = Vec::new();
    let entries = std::fs::read_dir(root)
        .map_err(|e| format!("读取媒体库目录失败 {}: {}", root.display(), e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("读取媒体库目录项失败: {}", e))?;
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
    result.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(result)
}

// ─── Database ──────────────────────────────────────────────
