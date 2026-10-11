//! Hitomi gallery information, gg.js routing, and bounded network transfers.
use regex::Regex;
use reqwest::blocking::Client;
use serde::Deserialize;
use std::collections::HashSet;
use std::io::Read;
use std::time::Duration;

pub(super) const DATA_HOST: &str = "ltn.gold-usergeneratedcontent.net";
const MAX_PAGES: usize = 100_000;
pub(super) const MAX_IMAGE_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
pub(super) struct HitomiFile {
    pub(super) hash: String,
}
#[derive(Debug, Clone, Deserialize)]
pub(super) struct HitomiName {
    pub(super) artist: Option<String>,
    pub(super) group: Option<String>,
    pub(super) parody: Option<String>,
    pub(super) character: Option<String>,
}
#[derive(Debug, Clone, Deserialize)]
pub(super) struct HitomiTag {
    pub(super) tag: String,
    pub(super) female: Option<serde_json::Value>,
    pub(super) male: Option<serde_json::Value>,
}
#[derive(Debug, Clone, Deserialize)]
pub(super) struct HitomiInfo {
    pub(super) id: serde_json::Value,
    pub(super) title: String,
    pub(super) japanese_title: Option<String>,
    #[serde(rename = "type")]
    pub(super) kind: String,
    pub(super) date: String,
    pub(super) language: Option<String>,
    pub(super) artists: Option<Vec<HitomiName>>,
    pub(super) groups: Option<Vec<HitomiName>>,
    pub(super) parodys: Option<Vec<HitomiName>>,
    pub(super) characters: Option<Vec<HitomiName>>,
    pub(super) tags: Option<Vec<HitomiTag>>,
    pub(super) files: Vec<HitomiFile>,
}

#[derive(Clone)]
pub(super) struct Gg {
    base: String,
    default: u8,
    special: u8,
    cases: HashSet<u16>,
}
impl Gg {
    pub(super) fn parse(text: &str) -> Result<Self, String> {
        let capture = |pattern: &str| -> Result<String, String> {
            Regex::new(pattern)
                .map_err(|e| e.to_string())?
                .captures(text)
                .and_then(|m| m.get(1).map(|v| v.as_str().to_string()))
                .ok_or_else(|| "Hitomi gg.js 格式已变化".to_string())
        };
        let default = capture(r"var o = (\d+)")?
            .parse::<u8>()
            .map_err(|e| e.to_string())?;
        let special = capture(r"o = (\d+); break;")?
            .parse::<u8>()
            .map_err(|e| e.to_string())?;
        let base = capture(r"b: '([0-9]+/)'")?;
        let cases = Regex::new(r"case (\d+):")
            .unwrap()
            .captures_iter(text)
            .filter_map(|m| m[1].parse::<u16>().ok())
            .collect();
        Ok(Self {
            base,
            default,
            special,
            cases,
        })
    }
    pub(super) fn image_url(&self, hash: &str) -> Result<String, String> {
        if hash.len() != 64
            || !hash
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            return Err("Hitomi 图片哈希无效".into());
        }
        let tail = &hash[61..];
        let swapped = format!("{}{}", &tail[2..], &tail[..2]);
        let shard = u16::from_str_radix(&swapped, 16).map_err(|e| e.to_string())?;
        let bucket = if self.cases.contains(&shard) {
            self.special
        } else {
            self.default
        };
        Ok(format!(
            "https://w{}.gold-usergeneratedcontent.net/{}{}/{}.webp",
            bucket + 1,
            self.base,
            shard,
            hash
        ))
    }
}

pub(super) fn client() -> Result<Client, String> {
    Client::builder().user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/118.0 Safari/537.36")
        .timeout(Duration::from_secs(40)).build().map_err(|e| e.to_string())
}
fn allowed_url(url: &reqwest::Url, image: bool) -> bool {
    if url.scheme() != "https" {
        return false;
    }
    let host = url.host_str().unwrap_or_default();
    if image {
        host.ends_with(".gold-usergeneratedcontent.net") && host.starts_with('w')
    } else {
        host == DATA_HOST
    }
}
pub(super) fn fetch(client: &Client, url: &str, max: u64, image: bool) -> Result<Vec<u8>, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| e.to_string())?;
    if !allowed_url(&parsed, image) {
        return Err("Hitomi 下载地址无效".into());
    }
    let mut last = String::new();
    for attempt in 0..3 {
        let response = client
            .get(url)
            .header(reqwest::header::REFERER, "https://hitomi.la/")
            .send();
        match response {
            Ok(response) if response.status().is_success() => {
                if !allowed_url(response.url(), image) {
                    return Err("Hitomi 响应跳转到了非预期站点".into());
                }
                if response.content_length().is_some_and(|len| len > max) {
                    return Err("Hitomi 响应体过大".into());
                }
                let expected = response.content_length();
                let mut bytes = Vec::new();
                if let Err(error) = response.take(max + 1).read_to_end(&mut bytes) {
                    last = format!("读取 Hitomi 响应失败: {error}");
                    if attempt < 2 {
                        std::thread::sleep(Duration::from_millis(500 * (attempt + 1) as u64));
                    }
                    continue;
                }
                if bytes.len() as u64 > max {
                    return Err("Hitomi 响应体过大".into());
                }
                if expected.is_some_and(|len| len != bytes.len() as u64) {
                    last = "Hitomi 响应未完整传输".into();
                    if attempt < 2 {
                        std::thread::sleep(Duration::from_millis(500 * (attempt + 1) as u64));
                    }
                    continue;
                }
                return Ok(bytes);
            }
            Ok(response) => {
                last = format!("Hitomi 返回 HTTP {}", response.status());
                if response.status().as_u16() != 429 && !response.status().is_server_error() {
                    break;
                }
            }
            Err(error) => last = format!("请求 Hitomi 失败: {error}"),
        }
        if attempt < 2 {
            std::thread::sleep(Duration::from_millis(500 * (attempt + 1) as u64));
        }
    }
    Err(last)
}
pub(super) fn get_info(client: &Client, id: i64) -> Result<HitomiInfo, String> {
    let url = format!("https://{DATA_HOST}/galleries/{id}.js");
    let bytes = fetch(client, &url, 5 * 1024 * 1024, false)?;
    let text = std::str::from_utf8(&bytes).map_err(|e| e.to_string())?;
    let json = text
        .trim()
        .strip_prefix("var galleryinfo = ")
        .ok_or("Hitomi 作品信息格式已变化")?
        .trim_end_matches(';');
    let info: HitomiInfo =
        serde_json::from_str(json).map_err(|e| format!("解析 Hitomi 作品信息失败: {e}"))?;
    if info.id.as_i64() != Some(id) && info.id.as_str() != Some(id.to_string().as_str()) {
        return Err("Hitomi 返回的作品 ID 不一致".into());
    }
    if info.files.is_empty() || info.files.len() > MAX_PAGES {
        return Err("Hitomi 作品页数无效".into());
    }
    Ok(info)
}
