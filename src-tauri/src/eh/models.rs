//! Data transfer objects shared by the Eh domain.
use serde::{Deserialize, Serialize};
use std::path::Path;
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EhSettings {
    pub root_path: String,
    pub ipb_member_id: String,
    pub ipb_pass_hash: String,
    pub igneous: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEhSettingsInput {
    pub root_path: String,
    pub ipb_member_id: String,
    pub ipb_pass_hash: String,
    pub igneous: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EhDownloadInput {
    pub gid: i64,
    pub token: String,
    #[serde(default)]
    pub page_indices: Option<Vec<usize>>,
    #[serde(default)]
    pub parallel_images: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EhDownloadFailure {
    pub page: usize,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct EhDownloadResult {
    pub gid: i64,
    pub title: String,
    pub folder_path: String,
    pub total_pages: usize,
    pub downloaded_pages: usize,
    pub failures: Vec<EhDownloadFailure>,
    pub meta_path: String,
    pub cover_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EhDownloadProgress {
    pub gid: i64,
    pub page: usize,
    pub total_pages: usize,
    pub percent: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EhGallerySummary {
    pub gid: i64,
    pub token: String,
    #[serde(default = "default_eh_source")]
    pub source: String,
    #[serde(default)]
    pub source_id: String,
    #[serde(default)]
    pub language: String,
    pub title: String,
    pub category: i64,
    pub artist: Vec<String>,
    pub group: Vec<String>,
    pub tags: Vec<String>,
    #[serde(default)]
    pub artist_display: Vec<String>,
    #[serde(default)]
    pub group_display: Vec<String>,
    #[serde(default)]
    pub tags_display: Vec<String>,
    pub pages: i64,
    pub posted: String,
    #[serde(default)]
    pub added_at: String,
    pub cover_path: String,
    pub folder_path: String,
}

pub(crate) fn default_eh_source() -> String {
    "eh".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct EhMeta {
    pub(crate) gid: i64,
    pub(crate) token: String,
    pub(crate) title: String,
    pub(crate) category: i64,
    #[serde(default)]
    pub(crate) artist: Vec<String>,
    #[serde(default)]
    pub(crate) group: Vec<String>,
    #[serde(default)]
    pub(crate) tags: Vec<String>,
    pub(crate) pages: i64,
    #[serde(default)]
    pub(crate) posted: String,
}

impl EhMeta {
    pub(crate) fn into_summary(self, folder: &Path, cover: &Path) -> EhGallerySummary {
        EhGallerySummary {
            gid: self.gid,
            token: self.token,
            source: default_eh_source(),
            source_id: self.gid.to_string(),
            language: String::new(),
            title: self.title,
            category: self.category,
            artist: self.artist,
            group: self.group,
            tags: self.tags,
            artist_display: Vec::new(),
            group_display: Vec::new(),
            tags_display: Vec::new(),
            pages: self.pages,
            posted: self.posted,
            added_at: String::new(),
            cover_path: cover.to_string_lossy().to_string(),
            folder_path: folder.to_string_lossy().to_string(),
        }
    }
}
#[derive(Debug, Serialize)]
pub struct EhLibraryOverview {
    pub root_path: String,
    pub database_path: String,
    pub total_count: i64,
    pub total_pages: i64,
}

#[derive(Debug, Serialize)]
pub struct EhCategoryMetric {
    pub category: i64,
    pub label: &'static str,
    pub count: i64,
    pub bytes: u64,
}

#[derive(Debug, Serialize)]
pub struct EhLibraryDashboard {
    pub total_count: i64,
    pub total_pages: i64,
    pub total_bytes: u64,
    pub categories: Vec<EhCategoryMetric>,
}

#[derive(Debug, Serialize)]
pub struct EhScanResult {
    pub folders: usize,
    pub indexed: usize,
    pub created_meta: usize,
    pub created_cover: usize,
    pub removed_records: usize,
    pub skipped: usize,
    pub errors: Vec<EhScanIssue>,
}

#[derive(Debug, Serialize)]
pub struct EhScanIssue {
    pub title: String,
    pub folder_path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct EhScanProgress {
    pub(crate) percent: usize,
    pub(crate) text: String,
}
#[derive(Debug, Serialize)]
pub struct EhReaderPageInfo {
    pub index: usize,
    pub path: String,
    pub width: usize,
    pub height: usize,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GDataResponse {
    #[serde(default)]
    pub(crate) gmetadata: Vec<GDataGallery>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GDataGallery {
    pub(crate) gid: i64,
    pub(crate) token: String,
    #[serde(default)]
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) title_jpn: String,
    #[serde(default)]
    pub(crate) category: String,
    #[serde(default)]
    pub(crate) posted: String,
    #[serde(default)]
    pub(crate) filecount: String,
    #[serde(default)]
    pub(crate) tags: Vec<String>,
    #[serde(default)]
    pub(crate) error: String,
}
