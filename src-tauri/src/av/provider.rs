//! 公开 Web 数据接口适配：精确番号核验、日文原题、有限请求与资源响应。
use super::{AvActress, AvWork};
use regex::Regex;
use reqwest::blocking::Client;
use serde_json::Value;
use std::{
    io::Read,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const WEB: &str = "https://catembylegacy.fastcdn.dpdns.org";
const API: &str = "https://jdforrepam.com/api";
static REQUEST: Mutex<Option<Instant>> = Mutex::new(None);
static SIGNATURE: OnceLock<Mutex<Option<(Instant, String, String)>>> = OnceLock::new();

pub fn normalize_code(input: &str) -> Result<String, String> {
    let text = input.trim().to_ascii_uppercase();
    let compact = Regex::new(r"^([A-Z]{2,12})([0-9]{2,9})$").unwrap();
    let code = compact.replace(&text, "$1-$2").to_string();
    if Regex::new(r"^(?:[A-Z][A-Z0-9]{1,15}-[0-9]{2,9}|FC2-PPV-[0-9]{3,10})$")
        .unwrap()
        .is_match(&code)
    {
        Ok(code)
    } else {
        Err("请输入有效番号，例如 IPX-607".into())
    }
}

pub fn client() -> Result<Client, String> {
    Client::builder().user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(25)).https_only(true).redirect(reqwest::redirect::Policy::limited(4)).build().map_err(|e| e.to_string())
}
fn pause() -> Result<(), String> {
    let mut last = REQUEST.lock().map_err(|e| e.to_string())?;
    if let Some(at) = *last {
        std::thread::sleep(Duration::from_secs(3).saturating_sub(at.elapsed()));
    }
    *last = Some(Instant::now());
    Ok(())
}
fn body(response: reqwest::blocking::Response, limit: u64) -> Result<Vec<u8>, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!("来源返回 HTTP {}，请稍后重试", status.as_u16()));
    }
    if response.content_length().unwrap_or(0) > limit {
        return Err("来源响应超过大小限制".into());
    }
    let mut bytes = Vec::new();
    response
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err("来源响应超过大小限制".into());
    }
    Ok(bytes)
}
fn metadata_response(
    request: reqwest::blocking::RequestBuilder,
    limit: u64,
) -> Result<Vec<u8>, String> {
    let mut last = String::new();
    for attempt in 0..3 {
        pause()?;
        let response = request.try_clone().ok_or("无法重试来源请求")?.send();
        match response {
            Ok(response) if response.status().is_server_error() && attempt < 2 => {
                last = format!("来源暂时返回 HTTP {}", response.status().as_u16());
            }
            Ok(response) => return body(response, limit),
            Err(error) => {
                last = format!("连接来源失败：{error}");
                if !error.is_timeout() && !error.is_connect() {
                    break;
                }
            }
        }
    }
    Err(last)
}
pub(super) fn read_page(client: &Client, url: &str) -> Result<String, String> {
    String::from_utf8(metadata_response(
        client.get(url).header("accept-language", "ja-JP,ja;q=0.9"),
        2_000_000,
    )?)
    .map_err(|e| e.to_string())
}
fn public_signature(client: &Client) -> Result<(String, String), String> {
    let mut cached = SIGNATURE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|e| e.to_string())?;
    if let Some((at, middle, suffix)) = &*cached {
        if at.elapsed() < Duration::from_secs(1800) {
            return Ok((middle.clone(), suffix.clone()));
        }
    }
    let html = read_page(client, &format!("{WEB}/"))?;
    let asset = Regex::new(r#"src="(/assets/index-[A-Za-z0-9_-]+\.js)""#)
        .unwrap()
        .captures(&html)
        .ok_or("来源页面结构已变化，暂时无法获取")?[1]
        .to_string();
    let js = String::from_utf8(metadata_response(
        client.get(format!("{WEB}{asset}")),
        4_000_000,
    )?)
    .map_err(|e| e.to_string())?;
    // 识别公开请求表达式；不执行来源脚本，不依赖压缩变量的固定名称。
    let expression =
        Regex::new(r"return`\$\{(\w+)\}\.\$\{(\w+)\}\.\$\{\w+\(\w+\+(\w+)\)\}`").unwrap();
    let fields = expression
        .captures(&js)
        .ok_or("来源请求格式已变化，请更新适配")?;
    let literal = |name: &str| -> Result<String, String> {
        let re = Regex::new(&format!(
            r#"\b{}="([^"\r\n]{{1,256}})""#,
            regex::escape(name)
        ))
        .map_err(|e| e.to_string())?;
        Ok(re.captures(&js).ok_or("来源请求参数已变化")?[1].to_string())
    };
    let middle = literal(&fields[2])?;
    let suffix = literal(&fields[3])?;
    *cached = Some((Instant::now(), middle.clone(), suffix.clone()));
    Ok((middle, suffix))
}
fn api(client: &Client, path: &str, query: &[(&str, &str)]) -> Result<Value, String> {
    let (middle, suffix) = public_signature(client)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs()
        .to_string();
    let signature = format!(
        "{stamp}.{middle}.{}",
        super::signature::md5(format!("{stamp}{suffix}").as_bytes())
    );
    let response = metadata_response(
        client
            .get(format!("{API}{path}"))
            .query(query)
            .header("accept", "application/json")
            .header("accept-language", "ja-JP,ja;q=0.9")
            .header("referer", format!("{WEB}/"))
            .header("jdsignature", signature),
        4_000_000,
    );
    if response.is_err() {
        if let Ok(mut cached) = SIGNATURE.get_or_init(|| Mutex::new(None)).lock() {
            *cached = None;
        }
    }
    let bytes = response?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "来源未返回有效 JSON，可能需要人工验证")?;
    if value["success"].as_i64() != Some(1) {
        if let Ok(mut cached) = SIGNATURE.get_or_init(|| Mutex::new(None)).lock() {
            *cached = None;
        }
        return Err("来源未返回有效资料，请稍后重试".into());
    }
    Ok(value["data"].clone())
}
fn string(value: &Value, keys: &[&str]) -> String {
    keys.iter()
        .filter_map(|key| value[*key].as_str())
        .find(|s| !s.trim().is_empty())
        .unwrap_or("")
        .trim()
        .to_string()
}
pub fn parse_movie(value: &Value, code: &str) -> Result<AvWork, String> {
    if normalize_code(value["number"].as_str().unwrap_or(""))? != code {
        return Err("来源详情番号不一致，已拒绝建档".into());
    }
    let id = value["id"].as_str().ok_or("来源缺少作品标识")?;
    if !id.chars().all(|c| c.is_ascii_alphanumeric()) || id.is_empty() {
        return Err("来源作品标识无效".into());
    }
    let actresses = value["actors"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|actor| actor["gender"].as_i64() == Some(0))
        .map(|actor| AvActress {
            id: string(actor, &["id"]),
            name: string(actor, &["origin_name", "name_ja", "name"]),
            aliases: Vec::new(),
            photo: string(actor, &["avatar_url"]),
        })
        .filter(|actor| !actor.name.is_empty())
        .take(30)
        .collect();
    let tags = value["tags"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|tag| string(tag, &["origin_name", "name_ja", "name"]))
        .filter(|tag| !tag.is_empty())
        .collect();
    let previews = value["preview_images"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|image| string(image, &["large_url", "thumb_url"]))
        .filter(|url| !url.is_empty())
        .take(48)
        .collect();
    Ok(AvWork {
        code: code.into(),
        title: string(value, &["origin_title", "title"]),
        cover: string(value, &["cover_url"]),
        cover_layout: "jacket".into(),
        release_date: string(value, &["release_date"]),
        duration_minutes: value["duration"].as_u64().unwrap_or(0).min(10000) as u32,
        studio: string(value, &["maker_origin_name", "maker_name_ja", "maker_name"]),
        series: string(
            value,
            &["series_origin_name", "series_name_ja", "series_name"],
        ),
        tags,
        actresses,
        folder_path: String::new(),
        source_url: format!("https://javdb.com/v/{id}"),
        queued_at: String::new(),
        previews,
        magnets: Vec::new(),
        videos: Vec::new(),
    })
}
pub fn fetch_metadata(code: &str) -> Result<AvWork, String> {
    match fetch_api_metadata(code) {
        Ok(work) => Ok(work),
        Err(api_error) => super::javdb_page::fetch(code)
            .map_err(|page_error| format!("公开数据接口：{api_error}；JavDB 页面：{page_error}")),
    }
}
fn fetch_api_metadata(code: &str) -> Result<AvWork, String> {
    let client = client()?;
    let data = api(
        &client,
        "/v2/search",
        &[("q", code), ("type", "movie"), ("page", "1")],
    )?;
    let found = data["movies"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|movie| {
            normalize_code(movie["number"].as_str().unwrap_or(""))
                .ok()
                .as_deref()
                == Some(code)
        })
        .ok_or("没有找到完全匹配的番号")?;
    let id = found["id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()))
        .ok_or("来源作品标识无效")?;
    let detail = api(&client, &format!("/v4/movies/{id}"), &[("locale", "ja")])?;
    parse_movie(&detail["movie"], code)
}

pub fn asset(client: &Client, url: &str) -> Result<(Vec<u8>, &'static str), String> {
    let url = reqwest::Url::parse(url).map_err(|_| "图片地址无效")?;
    if url.scheme() != "https" || !url.username().is_empty() || url.host_str().is_none() {
        return Err("图片必须使用有效 HTTPS 地址".into());
    }
    let bytes = body(
        client
            .get(url)
            .header("referer", "https://javdb.com/")
            .send()
            .map_err(|e| e.to_string())?,
        20_000_000,
    )?;
    decode_asset(bytes)
}

/// 来源公开图片组件的字节封装：原图、首字节异或及旧固定异或。
/// 只接受尺寸、签名和结尾全部通过的图片，网页/错误响应不能落盘。
fn decode_asset(bytes: Vec<u8>) -> Result<(Vec<u8>, &'static str), String> {
    let valid = |data: &[u8]| {
        crate::media::image_extension(data).filter(|_| crate::media::complete_image(data))
    };
    if let Some(extension) = valid(&bytes) {
        return Ok((bytes, extension));
    }
    let candidate = |key: u8, skip: usize| {
        bytes
            .iter()
            .skip(skip)
            .map(|byte| byte ^ key)
            .collect::<Vec<_>>()
    };
    if bytes.len() > 1 {
        let decoded = candidate(bytes[0], 1);
        if let Some(extension) = valid(&decoded) {
            return Ok((decoded, extension));
        }
    }
    for skip in 0..3 {
        let decoded = candidate(127, skip);
        if let Some(extension) = valid(&decoded) {
            return Ok((decoded, extension));
        }
    }
    Err("来源未返回完整的受支持图片".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn image_wrappers_decode_but_html_and_truncated_images_are_rejected() {
        use base64::Engine;
        let png = base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==").unwrap();
        for key in [0, 96, 127, 255] {
            let mut wrapped = vec![key];
            wrapped.extend(png.iter().map(|byte| byte ^ key));
            assert_eq!(decode_asset(wrapped).unwrap(), (png.clone(), "png"));
        }
        assert_eq!(
            decode_asset(png.iter().map(|byte| byte ^ 127).collect())
                .unwrap()
                .0,
            png
        );
        assert!(decode_asset(b"<html>verification</html>".to_vec()).is_err());
        assert!(decode_asset(png[..png.len() - 4].to_vec()).is_err());
    }
    #[test]
    #[ignore = "仅手动检查公开元数据网络，不下载或展示图片"]
    fn live_metadata_only() {
        let work = fetch_metadata("IPX-607").unwrap();
        assert_eq!(work.code, "IPX-607");
        assert!(!work.title.is_empty());
        assert!(!work.previews.is_empty());
        assert!(Regex::new("[ぁ-ヿ]").unwrap().is_match(&work.title));
        let output = std::env::temp_dir().join("ero-av-v6-live-metadata.json");
        std::fs::write(output, serde_json::to_vec_pretty(&work).unwrap()).unwrap();
        println!("metadata-only: exact identity, original Japanese title and static image references verified");
    }
    #[test]
    #[ignore = "手动核验来源的人物头像传输，只请求明确的 actors/avatars 路径"]
    fn live_portrait_transport() {
        let work = fetch_metadata("IPX-607").unwrap();
        let portrait = work
            .actresses
            .iter()
            .map(|actor| &actor.photo)
            .find(|url| {
                reqwest::Url::parse(url).is_ok_and(|url| {
                    url.path().contains("/actors/") || url.path().contains("/avatars/")
                })
            })
            .expect("来源未提供明确的人物头像地址，停止图片请求");
        let (bytes, extension) = asset(&client().unwrap(), portrait).unwrap();
        assert!(crate::media::complete_image(&bytes));
        println!(
            "portrait transport: HTTPS/signature/dimensions/completeness passed, {} bytes, {}",
            bytes.len(),
            extension
        );
    }
    #[test]
    fn exact_identity_and_original_language() {
        let json = serde_json::json!({"id":"abc", "number":"TEST-123", "title":"翻译标题", "origin_title":"春の日記", "tags":[{"name":"来源原词"}], "actors":[{"id":"a","name":"さくら","gender":0},{"id":"b","name":"other","gender":1}], "preview_images":[{"large_url":"https://example.com/image.jpg"}],"preview_video_url":"https://example.com/trailer.mp4"});
        let work = parse_movie(&json, "TEST-123").unwrap();
        assert_eq!(work.title, "春の日記");
        assert_eq!(work.actresses.len(), 1);
        assert_eq!(work.previews.len(), 1);
        assert!(parse_movie(&json, "TEST-124").is_err());
        assert_eq!(normalize_code("ipx607").unwrap(), "IPX-607");
        assert!(normalize_code("../TEST-123").is_err());
    }
}
