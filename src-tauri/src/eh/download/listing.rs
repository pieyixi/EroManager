use super::network::fetch_text;
use super::redact_token;
use crate::eh::models::EhSettings;
use reqwest::blocking::Client;
use std::collections::BTreeSet;

pub(super) const GALLERY_HOST: &str = "https://e-hentai.org";
pub(super) const EX_GALLERY_HOST: &str = "https://exhentai.org";
const MAX_NO_PROGRESS_ATTEMPTS: usize = 2;
const MAX_REQUEST_ATTEMPTS: usize = 3;

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
        let Some(end_relative) = html[content_start..].find(quote as char) else {
            break;
        };
        values.push(html[content_start..content_start + end_relative].to_string());
        cursor = content_start + end_relative + 1;
    }
    values
}

pub(super) fn page_number(url: &str, gid: i64) -> Option<usize> {
    let last = url
        .trim_end_matches('/')
        .rsplit('/')
        .next()?
        .split('?')
        .next()?;
    last.strip_prefix(&format!("{gid}-"))?.parse().ok()
}

pub(super) fn page_urls_from_listing(html: &str, gid: i64, host: &str) -> Vec<String> {
    let mut links = BTreeSet::new();
    for raw in attribute_values(html, "href") {
        let url = if raw.starts_with("/s/") {
            format!("{host}{raw}")
        } else {
            raw
        };
        if (url.starts_with("https://e-hentai.org/s/")
            || url.starts_with("https://exhentai.org/s/"))
            && page_number(&url, gid).is_some()
        {
            links.insert(url);
        }
    }
    links.into_iter().collect()
}

pub(super) fn merge_page_urls(
    pages: &mut [Option<String>],
    gid: i64,
    total: usize,
    links: impl IntoIterator<Item = String>,
) -> usize {
    for link in links {
        if let Some(number) = page_number(&link, gid) {
            if number > 0 && number <= total {
                pages[number] = Some(link);
            }
        }
    }
    pages.iter().skip(1).filter(|page| page.is_some()).count()
}

struct HostPageResolver<'a> {
    client: &'a Client,
    settings: &'a EhSettings,
    host: &'static str,
    gid: i64,
    token: &'a str,
    total_pages: usize,
    pages: Vec<Option<String>>,
    next_listing_index: usize,
    found_pages: usize,
    no_progress_attempts: usize,
    exhausted: bool,
}

impl<'a> HostPageResolver<'a> {
    fn new(
        client: &'a Client,
        settings: &'a EhSettings,
        host: &'static str,
        gid: i64,
        token: &'a str,
        total_pages: usize,
    ) -> Self {
        Self {
            client,
            settings,
            host,
            gid,
            token,
            total_pages,
            pages: vec![None; total_pages.saturating_add(1)],
            next_listing_index: 0,
            found_pages: 0,
            no_progress_attempts: 0,
            exhausted: false,
        }
    }

    fn resolve_page(&mut self, page: usize) -> Result<Option<String>, String> {
        if page == 0 || page > self.total_pages {
            return Ok(None);
        }
        // Resolve listing pages only until the requested image page is known.
        // This keeps first-click latency bounded even for very large galleries.
        while self.pages[page].is_none() && !self.exhausted {
            if self.next_listing_index >= self.total_pages.max(1) {
                self.exhausted = true;
                break;
            }
            let listing_index = self.next_listing_index;
            self.next_listing_index += 1;
            let url = format!(
                "{}/g/{}/{}/?p={listing_index}",
                self.host, self.gid, self.token
            );
            let mut html = None;
            let mut last_error = None;
            for attempt in 1..=MAX_REQUEST_ATTEMPTS {
                match fetch_text(self.client, self.settings, &url, Some(self.host)) {
                    Ok(body) => {
                        html = Some(body);
                        break;
                    }
                    Err(error) => {
                        last_error = Some(error);
                        if attempt < MAX_REQUEST_ATTEMPTS {
                            std::thread::sleep(std::time::Duration::from_millis(
                                200 * attempt as u64,
                            ));
                        }
                    }
                }
            }
            let html = html.ok_or_else(|| {
                redact_token(
                    &last_error.unwrap_or_else(|| "请求页面失败".to_string()),
                    self.token,
                )
            })?;
            let previous_found = self.found_pages;
            self.found_pages = merge_page_urls(
                &mut self.pages,
                self.gid,
                self.total_pages,
                page_urls_from_listing(&html, self.gid, self.host),
            );
            if self.found_pages == self.total_pages {
                self.exhausted = true;
            } else if self.found_pages == previous_found {
                self.no_progress_attempts += 1;
                if self.no_progress_attempts >= MAX_NO_PROGRESS_ATTEMPTS {
                    self.exhausted = true;
                } else {
                    self.next_listing_index = listing_index;
                }
            } else {
                self.no_progress_attempts = 0;
            }
        }
        Ok(self.pages[page].clone())
    }
}

pub(super) struct PageUrlResolver<'a> {
    hosts: [HostPageResolver<'a>; 2],
    current_host: usize,
    errors: Vec<String>,
}

impl<'a> PageUrlResolver<'a> {
    pub(super) fn new(
        client: &'a Client,
        settings: &'a EhSettings,
        gid: i64,
        token: &'a str,
        total_pages: usize,
    ) -> Self {
        Self {
            hosts: [
                HostPageResolver::new(client, settings, GALLERY_HOST, gid, token, total_pages),
                HostPageResolver::new(client, settings, EX_GALLERY_HOST, gid, token, total_pages),
            ],
            current_host: 0,
            errors: Vec::new(),
        }
    }
    pub(super) fn resolve_page(&mut self, page: usize) -> Result<Option<String>, String> {
        while self.current_host < self.hosts.len() {
            let host = self.hosts[self.current_host].host;
            match self.hosts[self.current_host].resolve_page(page) {
                Ok(Some(url)) => return Ok(Some(url)),
                Ok(None) => {
                    self.errors.push(format!("{host} 未找到作品页面链接"));
                    self.current_host += 1;
                }
                Err(error) => {
                    self.errors.push(format!("{host}: {error}"));
                    self.current_host += 1;
                }
            }
        }
        Err(format!(
            "无法读取作品页面列表：{}；如果作品位于 ExHentai，请先在 Cookie 设置中填写有效凭据",
            self.errors.join("；")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_matching_gallery_links() {
        let html = r#"<a href="https://e-hentai.org/s/key/123-1">1</a><a href="/s/key/123-2">2</a><a href="/g/123/t">no</a>"#;
        let links = page_urls_from_listing(html, 123, GALLERY_HOST);
        assert_eq!(links.len(), 2);
        assert_eq!(page_number(&links[1], 123), Some(2));
    }
    #[test]
    fn collects_a_five_hundred_page_gallery_without_page_size_assumptions() {
        let (gid, total) = (987654, 500);
        let mut pages = vec![None; total + 1];
        for first in (1..=total).step_by(20) {
            let html = (first..(first + 20).min(total + 1))
                .map(|page| format!(r#"<a href="/s/key/{gid}-{page}">{page}</a>"#))
                .collect::<String>();
            merge_page_urls(
                &mut pages,
                gid,
                total,
                page_urls_from_listing(&html, gid, GALLERY_HOST),
            );
        }
        assert!(pages.iter().skip(1).all(Option::is_some));
    }
}
