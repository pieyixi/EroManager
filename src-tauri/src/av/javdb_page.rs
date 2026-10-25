//! 官方作品页回退，只解析元数据和静态图片引用，不执行页面脚本、不取视频。
use super::{provider, AvActress, AvWork};
use regex::{Captures, Regex};

fn text(value: &str) -> String {
    let value = Regex::new(r"(?s)<[^>]*>").unwrap().replace_all(value, " ");
    let value =
        Regex::new(r"\\u([0-9a-fA-F]{4})")
            .unwrap()
            .replace_all(&value, |caps: &Captures| {
                u32::from_str_radix(&caps[1], 16)
                    .ok()
                    .and_then(char::from_u32)
                    .map(|c| c.to_string())
                    .unwrap_or_else(|| caps[0].to_string())
            });
    let value = Regex::new(r"&#(x[0-9a-fA-F]+|[0-9]+);")
        .unwrap()
        .replace_all(&value, |caps: &Captures| {
            let n = if let Some(hex) = caps[1].strip_prefix('x') {
                u32::from_str_radix(hex, 16)
            } else {
                caps[1].parse()
            };
            n.ok()
                .and_then(char::from_u32)
                .map(|c| c.to_string())
                .unwrap_or_else(|| caps[0].to_string())
        });
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
fn attribute(attrs: &str, name: &str) -> String {
    Regex::new(&format!(
        r#"\b{}\s*=\s*(?:"([^"]*)"|'([^']*)')"#,
        regex::escape(name)
    ))
    .unwrap()
    .captures(attrs)
    .and_then(|caps| {
        caps.get(1)
            .or_else(|| caps.get(2))
            .map(|value| text(value.as_str()))
    })
    .unwrap_or_default()
}
fn anchors(body: &str) -> Vec<(String, String)> {
    Regex::new(r"(?is)<a\b([^>]*)>(.*?)</a>")
        .unwrap()
        .captures_iter(body)
        .map(|caps| (caps[1].to_string(), caps[2].to_string()))
        .collect()
}
pub fn parse(html: &str, code: &str, id: &str) -> Result<AvWork, String> {
    let mut work = AvWork {
        code: code.into(),
        source_url: format!("https://javdb.com/v/{id}"),
        cover_layout: "jacket".into(),
        ..Default::default()
    };
    work.title = Regex::new(
        r#"(?s)<(?:strong|span)\b[^>]*class=["']origin-title["'][^>]*>(.*?)</(?:strong|span)>"#,
    )
    .unwrap()
    .captures(html)
    .map(|caps| text(&caps[1]))
    .filter(|title| !title.is_empty())
    .or_else(|| {
        Regex::new(r#"(?s)<strong\b[^>]*class=["']current-title["'][^>]*>(.*?)</strong>"#)
            .unwrap()
            .captures(html)
            .map(|caps| text(&caps[1]))
    })
    .unwrap_or_default();
    let mut identity = String::new();
    for panel in Regex::new(r#"(?s)<div\b[^>]*class=["']panel-block[^"']*["'][^>]*>(.*?)</div>"#)
        .unwrap()
        .captures_iter(html)
    {
        let body = &panel[1];
        let label = Regex::new(r"(?s)<strong[^>]*>(.*?)</strong>")
            .unwrap()
            .captures(body)
            .map(|caps| text(&caps[1]).trim_end_matches([':', '：']).to_string())
            .unwrap_or_default();
        let Some(value) = Regex::new(r#"(?s)<span\b[^>]*class=["']value["'][^>]*>(.*)"#)
            .unwrap()
            .captures(body)
        else {
            continue;
        };
        match label.as_str() {
            "番號" | "番号" | "品番" | "ID" => {
                identity = text(value[1].split("</span>").next().unwrap_or(&value[1]))
                    .chars()
                    .filter(|ch| !ch.is_whitespace())
                    .collect()
            }
            "日期" | "発売日" | "Release Date" => work.release_date = text(&value[1]),
            "時長" | "収録時間" | "Duration" => {
                work.duration_minutes = Regex::new(r"[0-9]+")
                    .unwrap()
                    .find(&value[1])
                    .and_then(|value| value.as_str().parse().ok())
                    .unwrap_or(0)
            }
            "片商" | "メーカー" | "Maker" => work.studio = text(&value[1]),
            "系列" | "シリーズ" | "Series" => work.series = text(&value[1]),
            "類別" | "ジャンル" | "Tags" => {
                for (_, label) in anchors(&value[1]) {
                    let label = text(&label);
                    if !label.is_empty() && !work.tags.contains(&label) {
                        work.tags.push(label);
                    }
                }
            }
            "演員" | "出演者" | "Actor(s)" => {
                for (attrs, label) in anchors(&value[1]) {
                    if !attribute(&attrs, "class")
                        .split_whitespace()
                        .any(|c| c == "actor-female")
                    {
                        continue;
                    }
                    let href = attribute(&attrs, "href");
                    let Some(id) = href.strip_prefix("/actors/") else {
                        continue;
                    };
                    if !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric()) {
                        work.actresses.push(AvActress {
                            id: id.into(),
                            name: text(&label),
                            ..Default::default()
                        });
                    }
                }
            }
            _ => {}
        }
    }
    if provider::normalize_code(&identity).ok().as_deref() != Some(code) || work.title.is_empty() {
        return Err("作品页需要登录/验证或结构变化，未取得匹配番号的资料".into());
    }
    for img in Regex::new(r"(?is)<img\b([^>]*)>")
        .unwrap()
        .captures_iter(html)
    {
        if attribute(&img[1], "class")
            .split_whitespace()
            .any(|c| c == "video-cover")
        {
            work.cover = attribute(&img[1], "src");
            break;
        }
    }
    for (attrs, _) in anchors(html) {
        if attribute(&attrs, "data-fancybox") != "gallery" {
            continue;
        }
        let href = attribute(&attrs, "href");
        if href.starts_with("https://") && !work.previews.contains(&href) {
            work.previews.push(href);
            if work.previews.len() >= 48 {
                break;
            }
        }
    }
    if !work.cover.starts_with("https://") {
        return Err("作品页没有有效 HTTPS 封面".into());
    }
    Ok(work)
}
pub fn fetch(code: &str) -> Result<AvWork, String> {
    let client = provider::client()?;
    let html = provider::read_page(
        &client,
        &format!("https://javdb.com/search?q={code}&f=all&locale=ja"),
    )?;
    for (attrs, body) in anchors(&html) {
        let href = attribute(&attrs, "href");
        let Some(id) = href.strip_prefix("/v/") else {
            continue;
        };
        if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
            continue;
        }
        let number = Regex::new(r"(?s)<strong[^>]*>(.*?)</strong>")
            .unwrap()
            .captures(&body)
            .map(|caps| text(&caps[1]))
            .unwrap_or_default();
        if provider::normalize_code(&number).ok().as_deref() == Some(code) {
            let html =
                provider::read_page(&client, &format!("https://javdb.com/v/{id}?locale=ja"))?;
            return parse(&html, code, id);
        }
    }
    Err("JavDB 页面没有找到完全匹配的番号，或需要人工验证".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retains_original_words_and_only_static_gallery_images() {
        let html = r#"<strong class="current-title">翻訳された題名</strong><span class="origin-title">春の日記 &amp; 記録</span><div class="panel-block"><strong>番號:</strong><span class="value"><a href="/video_codes/TEST">TEST</a>-123</span></div><div class="panel-block"><strong>類別:</strong><span class="value"><a href="/tags/a">長髪</a></span></div><div class="panel-block"><strong>演員:</strong><span class="value"><a href="/actors/a1" class="actor-female">さくら</a><a href="/actors/b2">other</a></span></div><img src="https://example.com/cover.jpg" class="video-cover"><a class="tile-item" href="https://example.com/static.jpg" data-fancybox="gallery"><img></a><a href="https://example.com/trailer.mp4" data-fancybox="video">play</a>"#;
        let work = parse(html, "TEST-123", "abc").unwrap();
        assert_eq!(work.title, "春の日記 & 記録");
        assert_eq!(work.actresses.len(), 1);
        assert_eq!(work.tags, ["長髪"]);
        assert_eq!(work.previews.len(), 1);
        assert!(parse(html, "TEST-124", "abc").is_err());
    }
    #[test]
    #[ignore = "手动检查官方页面元数据，不请求图片"]
    fn live_page_metadata_only() {
        let work = fetch("IPX-607").unwrap();
        assert_eq!(work.code, "IPX-607");
        assert!(!work.previews.is_empty());
        println!("official page: exact number and static metadata parsed");
    }
}
