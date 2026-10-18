//! Explicit, root-bounded gallery deletion commands.
use crate::eh::database::{gallery_folder, open_eh_db, read_eh_settings, validate_root};
use std::fs;
use std::path::{Path, PathBuf};

fn validate_delete_target(root: &Path, folder: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("无法解析 本子库目录：{error}"))?;
    let folder = folder
        .canonicalize()
        .map_err(|error| format!("无法解析作品目录：{error}"))?;
    if folder == root || !folder.starts_with(&root) {
        return Err(format!("拒绝删除 本子库范围外的目录：{}", folder.display()));
    }
    Ok(folder)
}

#[tauri::command]
pub fn eh_delete_gallery_record(
    gid: i64,
    db: tauri::State<crate::library::database::Database>,
) -> Result<(), String> {
    let connection = open_eh_db()?;
    // Deletion is intentionally idempotent: browser history is auxiliary and
    // may outlive a database row removed by a scan or another UI surface.
    connection
        .execute("DELETE FROM EhGalleries WHERE Gid=?1", [gid])
        .map_err(|error| error.to_string())?;
    crate::accounts::forget_gallery(&*db.conn.lock().map_err(|e| e.to_string())?, gid)?;
    Ok(())
}

#[tauri::command]
pub fn eh_delete_gallery_folder(
    gid: i64,
    db: tauri::State<crate::library::database::Database>,
) -> Result<(), String> {
    let connection = open_eh_db()?;
    let settings = read_eh_settings(&connection)?;
    let root = validate_root(&settings.root_path)?;
    let folder = validate_delete_target(&root, &gallery_folder(&connection, gid)?)?;
    fs::remove_dir_all(&folder).map_err(|error| format!("删除作品目录失败：{error}"))?;
    connection
        .execute("DELETE FROM EhGalleries WHERE Gid=?1", [gid])
        .map_err(|error| format!("目录已删除，但移除数据库记录失败：{error}"))?;
    crate::accounts::forget_gallery(&*db.conn.lock().map_err(|e| e.to_string())?, gid)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_delete_target;

    fn temp_root(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "ero-manager-delete-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn accepts_only_a_child_of_the_configured_root() {
        let base = temp_root("bounds");
        let root = base.join("root");
        let child = root.join("gallery");
        let outside = base.join("outside");
        std::fs::create_dir_all(&child).unwrap();
        std::fs::create_dir_all(&outside).unwrap();

        assert_eq!(
            validate_delete_target(&root, &child).unwrap(),
            child.canonicalize().unwrap()
        );
        assert!(validate_delete_target(&root, &root).is_err());
        assert!(validate_delete_target(&root, &outside).is_err());

        std::fs::remove_dir_all(base).unwrap();
    }
}
