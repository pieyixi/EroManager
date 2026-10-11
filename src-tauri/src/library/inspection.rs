//! Shared, read-only inspection of media-library folders.

use crate::library::models::is_video_file;

pub(crate) fn folder_video_stats(folder_path: &str) -> Result<(i32, u64), String> {
    let mut count = 0;
    let mut total = 0;
    let folder = std::path::Path::new(folder_path);
    if !folder.is_dir() {
        return Ok((0, 0));
    }
    let entries = std::fs::read_dir(folder)
        .map_err(|error| format!("读取目录失败 {}: {error}", folder.display()))?;
    for entry in entries {
        let entry =
            entry.map_err(|error| format!("读取目录项失败 {}: {error}", folder.display()))?;
        let path = entry.path();
        if path.is_file() && is_video_file(&path) {
            count += 1;
            total += entry
                .metadata()
                .map_err(|error| format!("读取文件信息失败 {}: {error}", path.display()))?
                .len();
        }
    }
    Ok((count, total))
}
