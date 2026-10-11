use crate::eh::metadata::atomic_write;
use crate::eh::models::EhSettings;
use reqwest::blocking::{Client, RequestBuilder};
use std::path::{Path, PathBuf};

const MAX_IMAGE_BYTES: u64 = 100 * 1024 * 1024;
const MAX_PAGE_ATTEMPTS: usize = 3;

pub(super) fn make_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| format!("建立 Eh 下载连接失败: {error}"))
}

fn with_cookie(
    client: &Client,
    settings: &EhSettings,
    url: &str,
    referer: Option<&str>,
) -> RequestBuilder {
    let mut request = client
        .get(url)
        .header(
            reqwest::header::ACCEPT,
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        )
        .header(
            reqwest::header::ACCEPT_LANGUAGE,
            "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        );
    if let Some(referer) = referer.filter(|value| !value.trim().is_empty()) {
        request = request.header(reqwest::header::REFERER, referer);
    }
    if settings.ipb_member_id.trim().is_empty() {
        request
    } else {
        request.header(
            reqwest::header::COOKIE,
            format!(
                "ipb_member_id={}; ipb_pass_hash={}; igneous={}",
                settings.ipb_member_id.trim(),
                settings.ipb_pass_hash.trim(),
                settings.igneous.trim()
            ),
        )
    }
}

pub(super) fn fetch_text(
    client: &Client,
    settings: &EhSettings,
    url: &str,
    referer: Option<&str>,
) -> Result<String, String> {
    let response = with_cookie(client, settings, url, referer)
        .send()
        .map_err(|error| format!("请求页面失败: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("页面返回 HTTP {}", response.status()));
    }
    response
        .text()
        .map_err(|error| format!("读取页面失败: {error}"))
}

fn attribute_values(html: &str, attribute: &str) -> Vec<String> {
    let marker = format!("{}=", attribute);
    let mut values = Vec::new();
    let mut cursor = 0;
    while let Some(relative) = html[cursor..].find(&marker) {
        let start = cursor + relative + marker.len();
        let bytes = html.as_bytes();
        let mut value_start = start;
        while value_start < bytes.len() && bytes[value_start].is_ascii_whitespace() {
            value_start += 1;
        }
        if value_start >= bytes.len() {
            break;
        }
        let quote = bytes[value_start];
        if quote != b'"' && quote != b'\'' {
            cursor = value_start + 1;
            continue;
        }
        let content_start = value_start + 1;
        let Some(end) = html[content_start..].find(quote as char) else {
            break;
        };
        values.push(html[content_start..content_start + end].to_string());
        cursor = content_start + end + 1;
    }
    values
}

fn image_url_from_page(html: &str) -> Option<String> {
    let marker = html.find("id=\"img\"").or_else(|| html.find("id='img'"))?;
    let end = (marker + 4096).min(html.len());
    attribute_values(&html[marker..end], "src")
        .into_iter()
        .map(|source| source.replace("&amp;", "&"))
        .find(|source| source.starts_with("https://"))
}

fn allowed_image_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    let host = parsed.host_str().unwrap_or_default();
    ["hath.network", "ehgt.org", "e-hentai.org", "exhentai.org"]
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ImageKind {
    Jpeg,
    Png,
    Webp,
    Gif,
    Bmp,
    Avif,
}
impl ImageKind {
    fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::Webp => "webp",
            Self::Gif => "gif",
            Self::Bmp => "bmp",
            Self::Avif => "avif",
        }
    }
}
fn image_kind(bytes: &[u8]) -> Option<ImageKind> {
    if bytes.starts_with(b"\xFF\xD8\xFF") {
        Some(ImageKind::Jpeg)
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(ImageKind::Png)
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some(ImageKind::Webp)
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(ImageKind::Gif)
    } else if bytes.starts_with(b"BM") {
        Some(ImageKind::Bmp)
    } else if bytes.len() >= 12
        && &bytes[4..8] == b"ftyp"
        && (&bytes[8..12] == b"avif" || &bytes[8..12] == b"avis")
    {
        Some(ImageKind::Avif)
    } else {
        None
    }
}

#[derive(Debug)]
struct PageDownloadError {
    reason: String,
    retryable: bool,
}
impl PageDownloadError {
    fn retryable(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
            retryable: true,
        }
    }
    fn permanent(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
            retryable: false,
        }
    }
}

fn download_page_once(
    client: &Client,
    settings: &EhSettings,
    folder: &Path,
    page: usize,
    url: &str,
) -> Result<PathBuf, PageDownloadError> {
    let html =
        fetch_text(client, settings, url, Some(url)).map_err(PageDownloadError::retryable)?;
    let image_url = image_url_from_page(&html)
        .ok_or_else(|| PageDownloadError::retryable("页面中没有找到原图地址"))?;
    if !allowed_image_url(&image_url) {
        return Err(PageDownloadError::retryable(
            "页面中的原图地址不是受支持的 HTTPS Eh 图片地址",
        ));
    }
    let response = with_cookie(client, settings, &image_url, Some(url))
        .send()
        .map_err(|error| PageDownloadError::retryable(format!("下载原图失败: {error}")))?;
    if !response.status().is_success() {
        return Err(PageDownloadError::retryable(format!(
            "原图返回 HTTP {}",
            response.status()
        )));
    }
    if !allowed_image_url(response.url().as_str()) {
        return Err(PageDownloadError::retryable(
            "原图重定向到了不受支持的 HTTPS Eh 图片地址",
        ));
    }
    if response.content_length().unwrap_or(0) > MAX_IMAGE_BYTES {
        return Err(PageDownloadError::permanent("原图超过 100 MB，已拒绝写入"));
    }
    let bytes = response
        .bytes()
        .map_err(|error| PageDownloadError::retryable(format!("读取原图失败: {error}")))?;
    if bytes.is_empty() {
        return Err(PageDownloadError::retryable("原图为空"));
    }
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err(PageDownloadError::permanent("原图超过 100 MB，已拒绝写入"));
    }
    // Content-Type is advisory: several failure pages are served as image/jpeg.
    // Only persist payloads with a recognized image signature.
    let kind = image_kind(&bytes)
        .ok_or_else(|| PageDownloadError::retryable("服务器未返回有效图片数据"))?;
    let path = folder.join(format!("page_{page:04}.{}", kind.extension()));
    atomic_write(&path, &bytes).map_err(PageDownloadError::permanent)?;
    Ok(path)
}

pub(super) fn download_page(
    client: &Client,
    settings: &EhSettings,
    folder: &Path,
    page: usize,
    url: &str,
) -> Result<PathBuf, String> {
    let mut last_error = None;
    for attempt in 1..=MAX_PAGE_ATTEMPTS {
        match download_page_once(client, settings, folder, page, url) {
            Ok(path) => return Ok(path),
            Err(error) => {
                let retry = error.retryable && attempt < MAX_PAGE_ATTEMPTS;
                last_error = Some(error.reason);
                if retry {
                    std::thread::sleep(std::time::Duration::from_millis(200 * attempt as u64));
                } else {
                    break;
                }
            }
        }
    }
    Err(last_error.unwrap_or_else(|| "下载原图失败".to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_eh_cdn_hosts_only() {
        assert!(allowed_image_url("https://a.b.hath.network/h/key.webp"));
        assert!(allowed_image_url("https://ehgt.org/h/key.jpg"));
        assert!(!allowed_image_url("http://ehgt.org/h/key.jpg"));
        assert!(!allowed_image_url("https://example.invalid/key.jpg"));
    }
    #[test]
    fn recognizes_supported_signatures_and_rejects_mislabeled_text() {
        assert_eq!(image_kind(b"\xFF\xD8\xFFrest"), Some(ImageKind::Jpeg));
        assert_eq!(image_kind(b"GIF89arest"), Some(ImageKind::Gif));
        assert_eq!(image_kind(b"BMrest"), Some(ImageKind::Bmp));
        assert_eq!(image_kind(b"HTTP error served as image/jpeg"), None);
    }
}
