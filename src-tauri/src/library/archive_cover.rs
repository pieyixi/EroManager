//! Archive cover discovery and image persistence.
use crate::library::database::Database;
use crate::library::models::{ArchiveCoverSaveInput, ArchiveEpisodeCoverSaveInput};
use crate::shared::{params, State};

pub(crate) fn find_existing_cover(data_dir: &std::path::Path, stem: &str) -> Option<String> {
    for ext in ["jpg", "png", "jpeg", "webp"] {
        let path = data_dir.join(format!("{}.{}", stem, ext));
        if path.exists() {
            return Some(path.to_string_lossy().to_string());
        }
    }
    None
}

pub(crate) fn has_any_image(data_dir: &std::path::Path, stem: &str) -> bool {
    find_existing_cover(data_dir, stem).is_some()
}

fn image_ext_from_data(data: &[u8]) -> &'static str {
    if data.len() > 3 && &data[0..3] == b"\xFF\xD8\xFF" {
        "jpg"
    } else if data.len() > 4 && &data[0..4] == b"\x89PNG" {
        "png"
    } else if data.len() > 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        "webp"
    } else {
        "jpg"
    }
}

fn decode_data_url(input: &str) -> Vec<u8> {
    let data = if input.contains(";base64,") {
        let idx = input.find(";base64,").unwrap_or(0) + 8;
        &input[idx..]
    } else {
        input
    };
    base64_decode(data)
}

fn base64_decode(input: &str) -> Vec<u8> {
    let input = input.trim().replace(['\n', '\r', ' '], "");
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(&input)
        .unwrap_or_default()
}

pub(crate) fn write_image_data(
    data_dir: &std::path::Path,
    stem: &str,
    image_data: &str,
) -> Result<String, String> {
    let data = decode_data_url(image_data);
    if data.is_empty() {
        return Err("图片数据为空或无法解码".to_string());
    }
    std::fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
    let ext = image_ext_from_data(&data);
    let out_path = data_dir.join(format!("{}.{}", stem, ext));
    remove_cover_alternates(data_dir, stem, &out_path);
    std::fs::write(&out_path, data).map_err(|error| error.to_string())?;
    Ok(out_path.to_string_lossy().to_string())
}

fn remove_cover_alternates(data_dir: &std::path::Path, stem: &str, keep_path: &std::path::Path) {
    for old_ext in ["jpg", "jpeg", "png", "webp"] {
        let old_path = data_dir.join(format!("{}.{}", stem, old_ext));
        if old_path != keep_path && old_path.exists() {
            let _ = std::fs::remove_file(old_path);
        }
    }
}

pub(crate) fn find_import_cover(
    data_dir: &std::path::Path,
    dir_name: &str,
    stem: &str,
) -> Option<String> {
    for ext in ["jpg", "jpeg", "png", "webp"] {
        for candidate in [
            data_dir.join(format!("{}.{}", stem, ext)),
            data_dir.join(format!("{}_{}.{}", dir_name, stem, ext)),
        ] {
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }
    None
}

#[tauri::command]
pub fn save_archive_cover(
    input: ArchiveCoverSaveInput,
    db: State<Database>,
) -> Result<String, String> {
    let data_dir = std::path::Path::new(&input.dir_path).join("data");
    let stem = input
        .episode_id
        .map(|id| format!("cover_ep{}", id))
        .unwrap_or_else(|| "cover".to_string());
    let cover_path = write_image_data(&data_dir, &stem, &input.image_data)?;
    if let Ok(conn) = db.conn.lock() {
        if let Ok(work_id) = conn.query_row(
            "SELECT Id FROM Works WHERE lower(FolderPath) = lower(?1) LIMIT 1",
            params![input.dir_path],
            |row| row.get::<_, i64>(0),
        ) {
            if let Some(episode_number) = input.episode_id {
                conn.execute(
                    "UPDATE Episodes SET CoverPath=?1 WHERE WorkId=?2 AND Number=?3",
                    params![cover_path, work_id, episode_number],
                )
                .ok();
            } else {
                conn.execute(
                    "UPDATE Works SET CoverPath=?1, UpdatedAt=datetime('now','localtime') WHERE Id=?2",
                    params![cover_path, work_id],
                )
                .ok();
            }
        }
    }
    Ok(cover_path)
}

#[tauri::command]
pub fn save_archive_episode_covers(
    input: ArchiveEpisodeCoverSaveInput,
) -> Result<Vec<String>, String> {
    let data_dir = std::path::Path::new(&input.dir_path).join("data");
    input
        .covers
        .iter()
        .map(|cover| {
            write_image_data(
                &data_dir,
                &format!("cover_ep{}", cover.id),
                &cover.image_data,
            )
        })
        .collect()
}
