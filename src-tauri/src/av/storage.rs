use super::{provider, AvWork};
use crate::eh::metadata::atomic_write;
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
};

pub fn path_in_root(path: &str, root: &str) -> bool {
    if path.is_empty()
        || root.is_empty()
        || Path::new(path)
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return false;
    }
    let normalized = |value: &str| {
        crate::eh::database::portable_path(Path::new(value))
            .replace('/', "\\")
            .trim_end_matches('\\')
            .to_lowercase()
    };
    normalized(path).starts_with(&(normalized(root) + "\\"))
}

/// 只读核验已建档目录；供目录重建索引和修改磁链共用，不创建任何文件。
pub fn owned_folder(folder: &Path, code: &str) -> Result<PathBuf, String> {
    let folder = folder.canonicalize().map_err(|e| e.to_string())?;
    let parent = folder.parent().ok_or("作品目录无效")?;
    root(&crate::eh::database::portable_path(parent))?;
    if !folder
        .file_name()
        .and_then(|v| v.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case(code))
    {
        return Err("作品目录名与番号不一致".into());
    }
    let marker = folder.join(".av-source.json");
    if !marker
        .canonicalize()
        .map_err(|_| "缺少作品来源标记")?
        .starts_with(&folder)
    {
        return Err("来源标记指向了作品目录之外".into());
    }
    let marker: Value = serde_json::from_slice(&fs::read(marker).map_err(|e| e.to_string())?)
        .map_err(|_| "作品来源标记损坏")?;
    if marker["source"].as_str() != Some("javdb") || marker["code"].as_str() != Some(code) {
        return Err("作品目录标记不匹配".into());
    }
    let data = folder
        .join("data")
        .canonicalize()
        .map_err(|_| "缺少作品 data 目录")?;
    if !data.starts_with(&folder) {
        return Err("资料子目录指向了其它作品或目录".into());
    }
    Ok(folder)
}

fn local_asset(folder: &Path, path: &str) -> Result<String, String> {
    if path.is_empty() {
        return Ok(String::new());
    }
    let asset = Path::new(path);
    if asset
        .components()
        .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err("JSON 图片路径包含越界片段".into());
    }
    let joined = if asset.is_absolute() {
        asset.to_path_buf()
    } else {
        folder.join(asset)
    };
    let checked = if joined.exists() {
        joined.canonicalize().map_err(|e| e.to_string())?
    } else {
        joined
    };
    if !checked.starts_with(folder) {
        return Err("JSON 图片路径超出作品目录".into());
    }
    Ok(crate::eh::database::portable_path(&checked))
}

pub fn read_owned_root(root: &Path) -> Result<Vec<AvWork>, String> {
    let mut works = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let folder = entry.path();
        if !folder.is_dir()
            || !folder.join(".av-source.json").is_file()
            || !folder.join("data/meta.json").is_file()
        {
            continue;
        }
        let code = provider::normalize_code(&entry.file_name().to_string_lossy())?;
        let owned = owned_folder(&folder, &code)?;
        if owned.parent() != Some(root) {
            return Err(format!("{code} 的目录链接超出资料根目录"));
        }
        let meta = owned.join("data/meta.json");
        if !meta
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(&owned)
            || fs::metadata(&meta).map_err(|e| e.to_string())?.len() > 16_000_000
        {
            return Err(format!("{code} 的 JSON 路径或大小异常"));
        }
        let mut work: AvWork = serde_json::from_slice(&fs::read(&meta).map_err(|e| e.to_string())?)
            .map_err(|e| format!("{code} 的 JSON 无法读取：{e}"))?;
        if work.code != code {
            return Err(format!("{code} 的 JSON 番号不匹配"));
        }
        work.folder_path = crate::eh::database::portable_path(&owned);
        work.cover = local_asset(&owned, &work.cover)?;
        for actor in &mut work.actresses {
            actor.photo = local_asset(&owned, &actor.photo)?;
        }
        work.previews = work
            .previews
            .iter()
            .map(|path| local_asset(&owned, path))
            .collect::<Result<_, _>>()?;
        works.push(work);
    }
    Ok(works)
}

pub fn root(path: &str) -> Result<PathBuf, String> {
    let path = Path::new(path)
        .canonicalize()
        .map_err(|_| "请先选择已存在的 AV 资料目录")?;
    if !path.is_dir() {
        return Err("资料目录不是文件夹".into());
    }
    let app = crate::paths::portable_app_dir()
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if path.starts_with(&app) {
        return Err("请选择程序安装目录之外的资料目录".into());
    }
    Ok(path)
}
pub fn prepare(root: &Path, code: &str) -> Result<PathBuf, String> {
    provider::normalize_code(code)?;
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let folder = root.join(code);
    if folder.exists() {
        let resolved = folder.canonicalize().map_err(|e| e.to_string())?;
        if resolved.parent() != Some(root.as_path()) {
            return Err("作品文件夹超出资料目录".into());
        }
        if fs::read_dir(&folder)
            .map_err(|e| e.to_string())?
            .next()
            .is_some()
        {
            let marker: Value = serde_json::from_slice(
                &fs::read(folder.join(".av-source.json"))
                    .map_err(|_| "同名目录不是本软件创建，已停止写入")?,
            )
            .map_err(|_| "作品标记损坏，已停止写入")?;
            if marker["code"].as_str() != Some(code) || marker["source"].as_str() != Some("javdb") {
                return Err("作品目录标记不匹配".into());
            }
        }
    } else {
        fs::create_dir(&folder).map_err(|e| e.to_string())?;
    }
    let data = folder.join("data");
    fs::create_dir_all(&data).map_err(|e| e.to_string())?;
    if !data
        .canonicalize()
        .map_err(|e| e.to_string())?
        .starts_with(&folder.canonicalize().map_err(|e| e.to_string())?)
    {
        return Err("资料子目录超出资料目录".into());
    }
    atomic_write(
        &folder.join(".av-source.json"),
        serde_json::json!({"source":"javdb","code":code,"version":1})
            .to_string()
            .as_bytes(),
    )?;
    Ok(folder)
}

/// 最多三个图片请求并行；封面、人物照片、静态预览沿用相同签名验证/原子落盘。
pub fn materialize(work: &mut AvWork, folder: &Path) -> Result<Vec<String>, String> {
    let client = provider::client()?;
    materialize_using(work, folder, |url| provider::asset(&client, url))
}
fn materialize_using<F>(work: &mut AvWork, folder: &Path, fetch: F) -> Result<Vec<String>, String>
where
    F: Fn(&str) -> Result<(Vec<u8>, &'static str), String> + Sync,
{
    let mut urls = vec![("cover".to_string(), work.cover.clone())];
    for (i, actor) in work.actresses.iter().enumerate() {
        if !actor.photo.is_empty() {
            urls.push((format!("actor_{i:02}"), actor.photo.clone()));
        }
    }
    for (i, image) in work.previews.iter().enumerate() {
        urls.push((format!("preview_{i:03}"), image.clone()));
    }
    let cursor = AtomicUsize::new(0);
    let manifest_path = folder.join("data/asset-sources.json");
    let manifest: std::collections::HashMap<String, String> = fs::read(&manifest_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let results = Mutex::new(Vec::<(String, Result<String, String>)>::new());
    std::thread::scope(|scope| {
        for _ in 0..3 {
            scope.spawn(|| loop {
                let i = cursor.fetch_add(1, Ordering::Relaxed);
                let Some((name, url)) = urls.get(i) else {
                    break;
                };
                let result = (|| {
                    for ext in ["jpg", "png", "webp"] {
                        let cached = folder.join("data").join(format!("{name}.{ext}"));
                        if cached.is_file()
                            && manifest.get(name) == Some(&format!("{url}\n{name}.{ext}"))
                        {
                            if !cached
                                .canonicalize()
                                .map_err(|e| e.to_string())?
                                .starts_with(folder)
                            {
                                return Err("缓存文件超出作品目录".into());
                            }
                            if fs::metadata(&cached).map_err(|e| e.to_string())?.len() > 20_000_000
                            {
                                continue;
                            }
                            let bytes = fs::read(&cached).map_err(|e| e.to_string())?;
                            if crate::media::complete_image(&bytes) {
                                return Ok(crate::eh::database::portable_path(&cached));
                            }
                        }
                    }
                    let mut last = String::new();
                    for attempt in 0..3 {
                        match fetch(url) {
                            Ok((bytes, ext)) => {
                                let path = folder.join("data").join(format!("{name}.{ext}"));
                                atomic_write(&path, &bytes)?;
                                return Ok(crate::eh::database::portable_path(&path));
                            }
                            Err(error) => {
                                last = error;
                                if attempt < 2 {
                                    std::thread::sleep(std::time::Duration::from_millis(
                                        300 * (attempt + 1),
                                    ));
                                }
                            }
                        }
                    }
                    Err(last)
                })();
                results.lock().unwrap().push((name.clone(), result));
            });
        }
    });
    let results: std::collections::HashMap<_, _> = results
        .into_inner()
        .map_err(|e| e.to_string())?
        .into_iter()
        .collect();
    let sources: std::collections::HashMap<_, _> = urls
        .iter()
        .filter_map(|(name, url)| {
            let path = results.get(name)?.as_ref().ok()?;
            Some((
                name.clone(),
                format!("{url}\n{}", Path::new(path).file_name()?.to_str()?),
            ))
        })
        .collect();
    atomic_write(
        &manifest_path,
        &serde_json::to_vec_pretty(&sources).map_err(|e| e.to_string())?,
    )?;
    work.cover = results
        .get("cover")
        .ok_or("没有取得封面")?
        .clone()
        .map_err(|e| format!("封面获取失败：{e}"))?;
    let mut warnings = Vec::new();
    let mut local = |name: String| -> String {
        match results.get(&name) {
            Some(Ok(path)) => path.clone(),
            Some(Err(error)) => {
                warnings.push(format!("{name}：{error}"));
                String::new()
            }
            None => String::new(),
        }
    };
    for (i, actor) in work.actresses.iter_mut().enumerate() {
        actor.photo = local(format!("actor_{i:02}"));
    }
    for (i, image) in work.previews.iter_mut().enumerate() {
        *image = local(format!("preview_{i:03}"));
    }
    work.folder_path = crate::eh::database::portable_path(folder);
    Ok(warnings)
}

pub fn save_metadata(work: &mut AvWork) -> Result<(), String> {
    write_metadata(work, None)
}

pub fn remove_magnet(work: &mut AvWork, magnet: &str) -> Result<(), String> {
    write_metadata(work, Some(magnet))
}

fn write_metadata(work: &mut AvWork, removed: Option<&str>) -> Result<(), String> {
    let folder = Path::new(&work.folder_path);
    let path = folder.join("data/meta.json");
    if path.exists()
        && !path
            .canonicalize()
            .map_err(|e| e.to_string())?
            .starts_with(folder.canonicalize().map_err(|e| e.to_string())?)
    {
        return Err("已有 meta.json 指向了作品目录之外".into());
    }
    let mut existing: Value = if path.exists() {
        serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|_| "已有 meta.json 无法读取，已保留原文件")?
    } else {
        serde_json::json!({})
    };
    if !existing.is_object() {
        return Err("已有 meta.json 不是对象，已保留原文件".into());
    }
    let pending = work.magnets.clone();
    work.magnets = existing["magnets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|magnet| Some(*magnet) != removed)
        .map(String::from)
        .collect();
    for magnet in pending {
        if Some(magnet.as_str()) != removed && !work.magnets.contains(&magnet) {
            work.magnets.push(magnet);
        }
    }
    let mut disk = work.clone();
    disk.folder_path.clear();
    let relative = |path: &str| {
        Path::new(path)
            .strip_prefix(folder)
            .ok()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default()
    };
    disk.cover = relative(&disk.cover);
    for actor in &mut disk.actresses {
        actor.photo = relative(&actor.photo);
    }
    disk.previews = disk.previews.iter().map(|path| relative(path)).collect();
    let mut fields = serde_json::to_value(&disk).map_err(|e| e.to_string())?;
    fields.as_object_mut().unwrap().remove("videos");
    fields.as_object_mut().unwrap().remove("magnets");
    existing.as_object_mut().unwrap().remove("magnets");
    existing
        .as_object_mut()
        .unwrap()
        .extend(fields.as_object().unwrap().clone());
    let mut json = serde_json::to_string_pretty(&existing).map_err(|e| e.to_string())?;
    json.truncate(json.trim_end().len() - 1);
    json = json.trim_end().to_string();
    json.push_str(&format!(
        ",\n  \"magnets\": {}\n}}\n",
        serde_json::to_string(&work.magnets).map_err(|e| e.to_string())?
    ));
    atomic_write(&path, json.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn protects_foreign_folders_and_preserves_manual_json() {
        let root = std::env::temp_dir().join(format!("ero-av-storage-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let foreign = root.join("TEST-100");
        fs::create_dir_all(&foreign).unwrap();
        fs::write(foreign.join("user.txt"), "keep").unwrap();
        assert!(prepare(&root, "TEST-100").is_err());
        let folder = prepare(&root, "TEST-101").unwrap();
        fs::write(
            folder.join("data/meta.json"),
            r#"{"custom":"keep","magnets":["magnet:?xt=old"]}"#,
        )
        .unwrap();
        let mut work = AvWork {
            code: "TEST-101".into(),
            title: "春の日記".into(),
            cover: folder.join("data/cover.jpg").to_string_lossy().into(),
            folder_path: folder.to_string_lossy().into(),
            ..Default::default()
        };
        save_metadata(&mut work).unwrap();
        let text = fs::read_to_string(folder.join("data/meta.json")).unwrap();
        let json: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(json["cover"], "data/cover.jpg");
        assert_eq!(json["custom"], "keep");
        assert_eq!(work.magnets, ["magnet:?xt=old"]);
        assert!(text.rfind("\"magnets\"").unwrap() > text.rfind("\"title\"").unwrap());
        work.magnets.push("magnet:?xt=second".into());
        save_metadata(&mut work).unwrap();
        remove_magnet(&mut work, "magnet:?xt=old").unwrap();
        assert_eq!(work.magnets, ["magnet:?xt=second"]);
        let disk: Value =
            serde_json::from_slice(&fs::read(folder.join("data/meta.json")).unwrap()).unwrap();
        assert_eq!(disk["magnets"], serde_json::json!(["magnet:?xt=second"]));
        assert_eq!(disk["custom"], "keep");
        // 保留隔离夹具；不删除用户路径。
    }
    #[test]
    fn neutral_assets_are_bounded_resumable_and_kept_as_relative_json_paths() {
        use base64::Engine;
        let root = std::env::temp_dir().join(format!("ero-av-assets-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let folder = prepare(&root, "TEST-201").unwrap();
        let source = AvWork {
            code: "TEST-201".into(),
            cover: "fixture-cover".into(),
            previews: (0..8).map(|i| format!("fixture-preview-{i}")).collect(),
            ..Default::default()
        };
        let png = base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==").unwrap();
        let in_flight = AtomicUsize::new(0);
        let maximum = AtomicUsize::new(0);
        let requests = AtomicUsize::new(0);
        let fetch = |_: &str| {
            requests.fetch_add(1, Ordering::Relaxed);
            let active = in_flight.fetch_add(1, Ordering::SeqCst) + 1;
            maximum.fetch_max(active, Ordering::SeqCst);
            std::thread::sleep(std::time::Duration::from_millis(10));
            in_flight.fetch_sub(1, Ordering::SeqCst);
            Ok((png.clone(), "png"))
        };
        let mut work = source.clone();
        assert!(materialize_using(&mut work, &folder, fetch)
            .unwrap()
            .is_empty());
        assert!(maximum.load(Ordering::SeqCst) <= 3);
        assert_eq!(requests.load(Ordering::Relaxed), 9);
        save_metadata(&mut work).unwrap();
        let mut retry = source;
        materialize_using(&mut retry, &folder, fetch).unwrap();
        assert_eq!(requests.load(Ordering::Relaxed), 9);
        let json: Value =
            serde_json::from_slice(&fs::read(folder.join("data/meta.json")).unwrap()).unwrap();
        assert_eq!(json["cover"], "data/cover.png");
        assert_eq!(json["previews"][0], "data/preview_000.png");
        let recovered = read_owned_root(&root.canonicalize().unwrap()).unwrap();
        assert_eq!(recovered.len(), 1);
        assert!(Path::new(&recovered[0].cover).is_file());
        assert_eq!(recovered[0].previews.len(), 8);
        assert!(local_asset(&folder, "../private.png").is_err());
    }
    #[test]
    fn partial_images_persist_as_retryable_slots_and_resume_without_refetching_successes() {
        use base64::Engine;
        let root = std::env::temp_dir().join(format!("ero-av-partial-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let folder = prepare(&root, "TEST-302").unwrap();
        let source = AvWork {
            code: "TEST-302".into(),
            cover: "cover".into(),
            previews: vec!["first".into(), "second".into()],
            ..Default::default()
        };
        let png=base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==").unwrap();
        let mut work = source.clone();
        let warnings = materialize_using(&mut work, &folder, |url| {
            if url == "second" {
                Err("fixture timeout".into())
            } else {
                Ok((png.clone(), "png"))
            }
        })
        .unwrap();
        assert_eq!(warnings.len(), 1);
        save_metadata(&mut work).unwrap();
        let recovered = read_owned_root(&root.canonicalize().unwrap()).unwrap();
        assert_eq!(recovered[0].previews[1], "");
        let requests = AtomicUsize::new(0);
        let mut retry = source;
        assert!(materialize_using(&mut retry, &folder, |_| {
            requests.fetch_add(1, Ordering::Relaxed);
            Ok((png.clone(), "png"))
        })
        .unwrap()
        .is_empty());
        assert_eq!(requests.load(Ordering::Relaxed), 1);
        assert!(Path::new(&retry.previews[1]).is_file());
    }
    #[cfg(windows)]
    #[test]
    fn a_data_junction_cannot_overwrite_another_work() {
        use std::os::windows::process::CommandExt;
        let root = std::env::temp_dir().join(format!("ero-av-junction-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let first = prepare(&root, "TEST-401").unwrap();
        let other = prepare(&root, "TEST-402").unwrap();
        let data = first.join("data");
        fs::remove_dir(&data).unwrap();
        let result = std::process::Command::new("cmd")
            .arg("/c")
            .arg("mklink")
            .arg("/J")
            .arg(&data)
            .arg(other.join("data"))
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(result.status.success());
        assert!(prepare(&root, "TEST-401").is_err());
        assert!(owned_folder(&first, "TEST-401").is_err());
    }
}
