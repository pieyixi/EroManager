//! Reader page enumeration for an indexed Eh gallery.
use crate::eh::database::open_eh_db;
use crate::eh::models::EhReaderPageInfo;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
pub(crate) fn is_page_image(path: &Path) -> bool {
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

fn numbered_page(path: &Path) -> Option<usize> {
    let stem = path.file_stem()?.to_str()?;
    let digits = stem.strip_prefix("page_").unwrap_or(stem);
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

#[tauri::command]
pub async fn eh_get_gallery_pages(gid: i64) -> Result<Vec<EhReaderPageInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let connection = open_eh_db()?;
        list_gallery_pages(&connection, gid)
    })
    .await
    .map_err(|error| error.to_string())?
}

pub(crate) fn list_gallery_pages(
    connection: &Connection,
    gid: i64,
) -> Result<Vec<EhReaderPageInfo>, String> {
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
    paths.sort_by(
        |left, right| match (numbered_page(left), numbered_page(right)) {
            (Some(a), Some(b)) if a != b => a.cmp(&b),
            _ => left.file_name().cmp(&right.file_name()),
        },
    );
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hitomi_negative_id_uses_same_ordered_reader_as_eh() {
        let root = std::env::temp_dir().join(format!(
            "ark-hitomi-reader-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir(&root).unwrap();
        fs::create_dir(root.join("data")).unwrap();
        for name in [
            "page_10000.webp",
            "page_9999.webp",
            "page_0002.webp",
            "page_0001.webp",
            "data/cover.webp",
        ] {
            fs::write(root.join(name), b"image").unwrap();
        }
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute(
                "CREATE TABLE EhGalleries(Gid INTEGER PRIMARY KEY,FolderPath TEXT NOT NULL)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO EhGalleries(Gid,FolderPath) VALUES(?1,?2)",
                rusqlite::params![-123, root.to_string_lossy()],
            )
            .unwrap();
        let pages = list_gallery_pages(&connection, -123).unwrap();
        assert_eq!(pages.len(), 4);
        assert!(pages[0].path.ends_with("page_0001.webp"));
        assert!(pages[1].path.ends_with("page_0002.webp"));
        assert!(pages[2].path.ends_with("page_9999.webp"));
        assert!(pages[3].path.ends_with("page_10000.webp"));
        assert!(root.starts_with(std::env::temp_dir()));
        fs::remove_dir_all(&root).unwrap();
    }
}
