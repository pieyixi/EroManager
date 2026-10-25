//! 仅枚举作品目录第一层的视频；番号匹配、原版/剪辑版排序不依赖文件枚举顺序。
use super::{storage, AvVideo};
use std::path::Path;

fn compact(value: &str) -> Option<String> {
    let mut result = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            result.push(ch.to_ascii_uppercase());
        } else if ch != '-' && ch != '_' && !ch.is_whitespace() {
            return None;
        }
    }
    Some(result)
}

fn variant(stem: &str, code: &str) -> Option<&'static str> {
    let stem = stem.trim();
    let (number, kind) = match stem.rsplit_once('~') {
        Some((number, suffix)) if suffix.trim().eq_ignore_ascii_case("cut") => {
            (number.trim(), "cut")
        }
        Some(_) => return None,
        None => (stem, "original"),
    };
    (compact(number)? == compact(code)?).then_some(kind)
}

pub fn list(folder: &str, code: &str) -> Vec<AvVideo> {
    let Ok(folder) = storage::owned_folder(Path::new(folder), code) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(&folder) else {
        return Vec::new();
    };
    let mut paths: Vec<_> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| crate::library::models::is_video_file(path))
        .collect();
    paths.sort_by_key(|path| {
        path.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase()
    });
    let mut videos = Vec::new();
    for path in paths {
        let Some(stem) = path.file_stem().and_then(|name| name.to_str()) else {
            continue;
        };
        let Some(kind) = variant(stem, code) else {
            continue;
        };
        if videos.iter().any(|video: &AvVideo| video.kind == kind) {
            continue;
        }
        let Ok(resolved) = path.canonicalize() else {
            continue;
        };
        // 不接受其它目录的链接，也不递归搜寻 data/ 或无关视频。
        if !resolved.is_file() || resolved.parent() != Some(folder.as_path()) {
            continue;
        }
        videos.push(AvVideo {
            id: if kind == "original" { 1 } else { 2 },
            kind: kind.into(),
            file_name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            video_path: crate::eh::database::portable_path(&resolved),
        });
    }
    videos.sort_by_key(|video| video.id);
    videos
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_separator_case_and_variant_without_matching_another_number() {
        for name in ["IPX607", "ipx-607", "ipx 607", "IPX_607"] {
            assert_eq!(variant(name, "IPX-607"), Some("original"));
        }
        for name in ["IPX-607~cut", "ipx 607 ~ CUT", "IPX607~Cut"] {
            assert_eq!(variant(name, "IPX-607"), Some("cut"));
        }
        for name in [
            "IPX-6070",
            "IPX-607-preview",
            "IPX-607~trailer",
            "IPX~607",
            "IPX-607~cut~cut",
        ] {
            assert_eq!(variant(name, "IPX-607"), None);
        }
    }
    #[test]
    fn discovers_local_files_original_first_and_observes_addition_and_removal() {
        let root = std::env::temp_dir().join(format!(
            "ero-av-video-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let folder = storage::prepare(&root, "IPX-607").unwrap();
        let path = folder.to_string_lossy();
        assert!(list(&path, "IPX-607").is_empty());
        std::fs::write(folder.join("IPX-607~cut.mp4"), b"fixture").unwrap();
        assert_eq!(list(&path, "IPX-607")[0].kind, "cut");
        std::fs::write(folder.join("ipx 607.WMV"), b"fixture").unwrap();
        std::fs::write(folder.join("OTHER-607.avi"), b"fixture").unwrap();
        std::fs::write(folder.join("IPX607.txt"), b"fixture").unwrap();
        std::fs::write(folder.join("data/IPX607.mp4"), b"fixture").unwrap();
        let videos = list(&path, "IPX-607");
        assert_eq!(
            videos
                .iter()
                .map(|video| video.kind.as_str())
                .collect::<Vec<_>>(),
            ["original", "cut"]
        );
        std::fs::remove_file(folder.join("ipx 607.WMV")).unwrap();
        std::fs::remove_file(folder.join("IPX-607~cut.mp4")).unwrap();
        assert!(list(&path, "IPX-607").is_empty());
        // 此测试只保留系统 Temp 下自己的中性夹具，不清理任何用户目录。
    }
}
